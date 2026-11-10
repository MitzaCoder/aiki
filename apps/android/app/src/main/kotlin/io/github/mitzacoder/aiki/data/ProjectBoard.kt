package io.github.mitzacoder.aiki.data

import io.github.mitzacoder.aiki.protocol.*
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.*

/** The server's error code for a change made on a revision the row has moved past (packages/client `BOARD_CONFLICT_CODE`). */
const val BOARD_CONFLICT_CODE = "board_conflict"

fun boardConflict(error: Throwable): Boolean = (error as? ClientException)?.code == BOARD_CONFLICT_CODE

/** What one project's board holds right now. */
data class BoardView(
    /** Null until the first read or push. */
    val board: Board? = null,
    /** Archived tasks, read while [showArchived] is on. */
    val archived: List<BoardTask> = emptyList(),
    val showArchived: Boolean = false,
    /** The last failed read; cleared by the next good one. */
    val error: String? = null,
) {
    val loaded: Boolean get() = board != null
    /** Live tasks and, when asked for, the archived ones. */
    val tasks: List<BoardTask> get() {
        val live = board?.tasks.orEmpty()
        if (!showArchived) return live
        val ids = live.mapTo(HashSet()) { it.id }
        return live + archived.filterNot { it.id in ids }
    }
    val questions: List<BoardQuestion> get() = board?.questions.orEmpty()
    val openQuestionCount: Int get() = questions.count { it.status == "open" }
    fun task(id: String): BoardTask? = tasks.firstOrNull { it.id == id }
    fun question(id: String): BoardQuestion? = questions.firstOrNull { it.id == id }
}

sealed interface SaveOutcome {
    data class Saved(val task: BoardTask) : SaveOutcome
    /** The row moved on; [newer] is its current state, null when it is gone. */
    data class Conflict(val newer: BoardTask?) : SaveOutcome
    data class Failed(val message: String) : SaveOutcome
}

sealed interface AnswerOutcome {
    data class Answered(val question: BoardQuestion) : AnswerOutcome
    data class Conflict(val newer: BoardQuestion?) : AnswerOutcome
    data class Failed(val message: String) : AnswerOutcome
}

/**
 * One project's board, live, shared by every screen of a backend (tasks, chat links and pins, the board, header counts):
 * get it from [BackendSession.board] or [io.github.mitzacoder.aiki.navigation.ProjectScreenContext.board], never read
 * `board.get` per screen. The server pushes the whole board on every change (`board.state`); `board.get` fills it in on
 * connect and after a reconnect. A read that started before a push never overwrites it. Archived tasks are not pushed,
 * so they are read while shown. Saves and answers report a conflict as an outcome with the newer row read back. The web
 * twin is `apps/web/src/lib/board.svelte.ts`.
 */
class ProjectBoard(private val client: HarnessClient, val projectId: String, private val scope: CoroutineScope) {
    private val mutableView = MutableStateFlow(BoardView())
    val view: StateFlow<BoardView> = mutableView.asStateFlow()
    private val mutableLinkedTask = MutableStateFlow<String?>(null)
    val linkedTask = mutableLinkedTask.asStateFlow()
    fun showWithLinked(taskId: String?) { mutableLinkedTask.value = taskId }
    /** Bumped by every push, so a read that raced one is dropped. */
    @Volatile private var pushes = 0L

    init {
        // Collect pushes before the first read asks for a snapshot.
        scope.launch(start = CoroutineStart.UNDISPATCHED) {
            client.events.collect { event ->
                if (event !is BoardStateEvent || event.projectId != projectId) return@collect
                pushes++
                mutableView.update { it.copy(board = event.board, error = null) }
                if (view.value.showArchived) launch { readArchived() }
            }
        }
        // A reconnect loses the pushes sent while away, so read the board again.
        scope.launch {
            client.state.map { it.status == ConnectionStatus.Ready && it.supports("board") }.distinctUntilChanged().collect { ready ->
                if (ready) load()
            }
        }
    }

    suspend fun load() {
        if (!client.supports("board") || client.state.value.status != ConnectionStatus.Ready) return
        val before = pushes
        try {
            val board = client.request(BoardGetRequest(projectId = projectId, includeArchived = view.value.showArchived.takeIf { it })).board
            mutableView.update { current ->
                val archived = if (current.showArchived) board.tasks.filter { it.archived } else current.archived
                if (before != pushes) current.copy(archived = archived)
                else current.copy(board = board.copy(tasks = board.tasks.filterNot { it.archived }), archived = archived, error = null)
            }
        } catch (error: CancellationException) { throw error }
        catch (error: Exception) { mutableView.update { it.copy(error = error.message ?: "Could not read the board") } }
    }

    suspend fun setShowArchived(show: Boolean) {
        mutableView.update { it.copy(showArchived = show, archived = if (show) it.archived else emptyList()) }
        if (show) readArchived()
    }

    /** An archived task (settled for more than a week), which the live board leaves out; null when it is gone. */
    suspend fun findArchived(id: String): BoardTask? =
        client.request(BoardGetRequest(projectId = projectId, includeArchived = true)).board.tasks.firstOrNull { it.id == id }

    /** A task's snapshots, oldest first. Needs `task-reports`. */
    suspend fun history(taskId: String): List<BoardTaskSnapshot> = client.readTaskHistory(projectId, taskId)

    /**
     * Creates (no [taskId]) or changes a task read at [expectedRevision]. Leave `input.refs` null unless the user edited
     * them: null keeps the task's refs, a list replaces them. A [note] needs `board-moves` (see [HarnessClient.saveBoardTask]).
     */
    suspend fun saveTask(input: BoardTaskInput, taskId: String? = null, expectedRevision: Long? = null, note: String? = null): SaveOutcome = try {
        val task = client.saveBoardTask(projectId, input, taskId, expectedRevision, note)
        upsertTask(task)
        SaveOutcome.Saved(task)
    } catch (error: CancellationException) { throw error }
    catch (error: Exception) {
        if (boardConflict(error)) { load(); SaveOutcome.Conflict(taskId?.let { view.value.task(it) }) }
        else SaveOutcome.Failed(error.message ?: "Could not save the task")
    }

    /** Puts the tasks in this order; the list moves at once and a refusal reads the board again. Returns the error, if any. */
    suspend fun reorder(taskIds: List<String>): String? {
        val position = taskIds.withIndex().associate { (index, id) -> id to index.toDouble() }
        mutableView.update { current ->
            val board = current.board ?: return@update current
            current.copy(board = board.copy(tasks = board.tasks.map { it.copy(order = position[it.id] ?: (it.order + taskIds.size)) }.sortedBy { it.order }))
        }
        return try {
            client.request(BoardTasksReorderRequest(projectId = projectId, taskIds = taskIds))
            null
        } catch (error: CancellationException) { throw error }
        catch (error: Exception) { load(); error.message ?: "Could not reorder" }
    }

    suspend fun answer(questionId: String, expectedRevision: Long, answer: String): AnswerOutcome = try {
        val question = client.request(BoardQuestionAnswerRequest(projectId = projectId, questionId = questionId, expectedRevision = expectedRevision, answer = answer)).question
        mutableView.update { current ->
            val board = current.board ?: return@update current
            current.copy(board = board.copy(questions = board.questions.map { if (it.id == question.id) question else it }))
        }
        AnswerOutcome.Answered(question)
    } catch (error: CancellationException) { throw error }
    catch (error: Exception) {
        if (boardConflict(error)) { load(); AnswerOutcome.Conflict(view.value.question(questionId)) }
        else AnswerOutcome.Failed(error.message ?: "Could not answer")
    }

    private suspend fun readArchived() {
        try {
            val board = client.request(BoardGetRequest(projectId = projectId, includeArchived = true)).board
            mutableView.update { it.copy(archived = board.tasks.filter { task -> task.archived }) }
        } catch (error: CancellationException) { throw error }
        catch (error: Exception) { mutableView.update { it.copy(error = error.message ?: "Could not read archived tasks") } }
    }

    private fun upsertTask(task: BoardTask) = mutableView.update { current ->
        val board = current.board ?: return@update current
        val tasks = if (board.tasks.any { it.id == task.id }) board.tasks.map { if (it.id == task.id) task else it } else board.tasks + task
        current.copy(board = board.copy(tasks = tasks.sortedBy { it.order }))
    }
}
