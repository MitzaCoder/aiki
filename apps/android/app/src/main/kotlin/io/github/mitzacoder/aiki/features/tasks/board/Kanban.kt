package io.github.mitzacoder.aiki.features.tasks.board

import io.github.mitzacoder.aiki.features.tasks.*
import io.github.mitzacoder.aiki.protocol.*
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import kotlin.math.roundToLong

/*
 * The Tasks board: the project's tasks in one column per status (To do, Working, Blocked, Ready for review, Done), and
 * what moving a card means. A move is the user changing the task's status, which the server passes on to the
 * coordinator as a `[board]` note; so the rules here are the board's own: only the agents put a task up for review, and
 * a task sent back from review needs the user's reason. Reordering To do sets the priority the coordinator works by;
 * the other columns sort themselves. Pure functions ported from the web's `apps/web/src/lib/kanban.ts` with its tests
 * (KanbanTest); change both together.
 */

enum class KanbanColumnId(val label: String, val empty: String) {
    Todo("To do", "Nothing waiting to start."),
    Working("Working", "Nothing running."),
    Blocked("Blocked", "Nothing stuck."),
    Review("Ready for review", "Nothing to look at yet."),
    Waiting("Waiting", "No external dependencies waiting."),
    Done("Done", "Nothing closed this week."),
}

/** The column a status sits in: done and dropped share Done. An unknown status sits in To do. */
fun columnOfStatus(status: String): KanbanColumnId = when (status) {
    "in_progress" -> KanbanColumnId.Working
    "blocked" -> KanbanColumnId.Blocked
    "review" -> KanbanColumnId.Review
    "waiting" -> KanbanColumnId.Waiting
    "done", "dropped" -> KanbanColumnId.Done
    else -> KanbanColumnId.Todo
}

/** A task on the board with its open questions and warnings, warnings first. A card with any wears the needs-you look. */
data class KanbanCard(val task: BoardTask, val waiting: List<BoardQuestion>, val column: KanbanColumnId)

/** A column, present even when empty; [hidden] counts the closed tasks left out of Done because only the newest show. */
data class KanbanColumn(val id: KanbanColumnId, val cards: List<KanbanCard>, val hidden: Int) {
    val label: String get() = id.label
    val empty: String get() = id.empty
    val total: Int get() = cards.size + hidden
}

/** How many closed tasks Done shows before "Show N more". */
const val DONE_SHOWN = 12

private val byOrder: Comparator<BoardTask> = compareBy<BoardTask> { it.order }.thenComparing({ it.id }, taskIdOrder)

/**
 * How a column sorts: To do and Blocked by the board's order (To do's is the user's priority), Working by time in
 * progress (longest first), Ready for review by how long it has waited (longest first), Done by when it closed (newest
 * first).
 */
private fun compareIn(column: KanbanColumnId): Comparator<BoardTask> = when (column) {
    KanbanColumnId.Working -> compareByDescending<BoardTask> { it.inProgressMinutes ?: 0L }.then(byOrder)
    KanbanColumnId.Review -> compareBy<BoardTask> { isoMillis(it.updatedAt) }.then(byOrder)
    KanbanColumnId.Done -> compareByDescending<BoardTask> { isoMillis(it.settledAt ?: it.updatedAt) }.then(byOrder)
    else -> byOrder
}

/**
 * The board's columns, every one present even when empty. Archived tasks are left out unless asked for; Done shows the
 * newest [doneShown] closed tasks and counts the rest in `hidden`. [onlyNeedsYou] keeps just the cards with open
 * questions or warnings.
 */
fun kanbanColumns(
    tasks: List<BoardTask>,
    questions: List<BoardQuestion>,
    includeArchived: Boolean = false,
    doneShown: Int = DONE_SHOWN,
    onlyNeedsYou: Boolean = false,
): List<KanbanColumn> {
    val cards = tasks.filter { includeArchived || !it.archived }
        .map { KanbanCard(it, waitingOn(questions, it.id), columnOfStatus(it.status)) }
        .filter { !onlyNeedsYou || it.waiting.isNotEmpty() }
    return KanbanColumnId.entries.map { id ->
        val compare = compareIn(id)
        val inColumn = cards.filter { it.column == id }.sortedWith { left, right -> compare.compare(left.task, right.task) }
        val limit = if (id == KanbanColumnId.Done) doneShown else Int.MAX_VALUE
        KanbanColumn(id, inColumn.take(limit), maxOf(0, inColumn.size - limit))
    }
}

/**
 * The board header's "Needs you" count: open tasks with a question or warning waiting, plus the questions and warnings
 * that name no task.
 */
fun needsYouCount(tasks: List<BoardTask>, questions: List<BoardQuestion>): Int {
    val waitingTasks = tasks.count { !it.archived && !isSettled(it.status) && waitingOn(questions, it.id).isNotEmpty() }
    return waitingTasks + looseWaiting(Board(tasks = tasks, questions = questions, decisions = emptyList(), updatedAt = null)).size
}

private fun sectionOf(column: KanbanColumnId): TaskSectionId = when (column) {
    KanbanColumnId.Todo -> TaskSectionId.Todo
    KanbanColumnId.Working -> TaskSectionId.Working
    KanbanColumnId.Blocked -> TaskSectionId.Blocked
    KanbanColumnId.Review -> TaskSectionId.Review
    KanbanColumnId.Waiting -> TaskSectionId.Waiting
    KanbanColumnId.Done -> TaskSectionId.Closed
}

/** The line under a card's title: the waiting question when one is, else the report line that fits its column. */
fun cardGist(card: KanbanCard): String =
    rowGist(TaskRow(card.task, card.waiting, if (card.waiting.isNotEmpty()) TaskSectionId.NeedsYou else sectionOf(card.column)))

/** A card's time, and the longer words a screen reader says for it. */
data class CardTime(val text: String, val title: String)

/**
 * A card's time: time in progress while working, how long it has waited in review, when it closed in Done, else when it
 * last changed.
 */
fun cardTime(card: KanbanCard, now: Long): CardTime {
    val task = card.task
    when (card.column) {
        KanbanColumnId.Working -> task.inProgressMinutes?.let { minutes ->
            val text = formatMinutes(minutes.toDouble())
            return CardTime(text, "$text in progress")
        }
        KanbanColumnId.Review -> return CardTime(compactRelativeTime(task.updatedAt, now), "Ready for review ${relativeTime(task.updatedAt, now)}")
        KanbanColumnId.Done -> {
            val at = task.settledAt ?: task.updatedAt
            return CardTime(compactRelativeTime(at, now), "${if (task.status == "dropped") "Dropped" else "Done"} ${relativeTime(at, now)}")
        }
        else -> Unit
    }
    return CardTime(compactRelativeTime(task.updatedAt, now), "Updated ${relativeTime(task.updatedAt, now)}")
}

// --- times (web lib/relative-time.ts) ------------------------------------------------------------------------------

private fun parsedMillis(at: String): Long? =
    runCatching { java.time.OffsetDateTime.parse(at).toInstant().toEpochMilli() }.recoverCatching { Instant.parse(at).toEpochMilli() }.getOrNull()

/** A timestamp as a short phrase relative to [now]: "just now", "5 min ago", "3 h ago", "2 d ago", then a date. */
fun relativeTime(at: String, now: Long, zone: ZoneId = ZoneId.systemDefault()): String {
    val ms = parsedMillis(at) ?: return "at an unknown time"
    val seconds = ((now - ms) / 1000.0).roundToLong()
    if (seconds < 45) return "just now"
    val minutes = (seconds / 60.0).roundToLong()
    if (minutes < 60) return "${maxOf(1, minutes)} min ago"
    val hours = (minutes / 60.0).roundToLong()
    if (hours < 24) return "$hours h ago"
    val days = (hours / 24.0).roundToLong()
    if (days < 30) return "$days d ago"
    return DateTimeFormatter.ofLocalizedDate(FormatStyle.SHORT).format(Instant.ofEpochMilli(ms).atZone(zone))
}

/** [relativeTime] for a narrow column, one unit and no "ago": "now", "5m", "3h", "2d", then a short date. */
fun compactRelativeTime(at: String, now: Long, zone: ZoneId = ZoneId.systemDefault()): String {
    val ms = parsedMillis(at) ?: return ""
    val seconds = ((now - ms) / 1000.0).roundToLong()
    if (seconds < 45) return "now"
    val minutes = (seconds / 60.0).roundToLong()
    if (minutes < 60) return "${maxOf(1, minutes)}m"
    val hours = (minutes / 60.0).roundToLong()
    if (hours < 24) return "${hours}h"
    val days = (hours / 24.0).roundToLong()
    if (days < 30) return "${days}d"
    return DateTimeFormatter.ofPattern("MMM d").format(Instant.ofEpochMilli(ms).atZone(zone))
}

// --- what a card says about the work around it (web lib/board.ts, lib/threads.ts) ----------------------------------

/** A task another one waits for; an unknown ID counts as settled, so it never holds a card up. */
data class Blocker(val id: String, val title: String, val status: String, val settled: Boolean)

fun blockersOf(task: BoardTask, tasks: List<BoardTask>): List<Blocker> = task.blockedBy.map { id ->
    val found = tasks.firstOrNull { it.id == id } ?: return@map Blocker(id, "", "unknown", true)
    Blocker(id, found.title, found.status, isSettled(found.status))
}

/** The open tasks a card waits for; none once it is closed. */
fun waitsFor(task: BoardTask, tasks: List<BoardTask>): List<Blocker> =
    if (isSettled(task.status)) emptyList() else blockersOf(task, tasks).filterNot { it.settled }

/** The running workers on a task: those that name it, or (from an older server) those it lists. */
fun runningWorkers(task: BoardTask, workers: List<WorkerSummary>): List<WorkerSummary> =
    workers.filter { it.status == "running" && (it.taskId == task.id || (it.taskId == null && it.id in task.workerIds)) }

/** The background thread holding a task, by name; null when main holds it, nobody does, or the server has no claims. */
fun holdingThread(task: BoardTask, threads: List<ThreadSummary>): String? {
    val owner = task.ownerThreadId ?: return null
    if (isMainThread(owner)) return null
    return threadName(owner, threads)
}

// --- moves -------------------------------------------------------------------------------------------------------

/** A status the user may move a task to: any but review, which is the agents' call. */
data class MoveChoice(val target: String, val label: String, val hint: String)

private val MOVE_CHOICES = listOf(
    MoveChoice("todo", "To do", "Not started"),
    MoveChoice("in_progress", "Working", "Start it now"),
    MoveChoice("blocked", "Blocked", "Waiting on something"),
    MoveChoice("done", "Done", "Close it"),
    MoveChoice("dropped", "Dropped", "It will not be done"),
)

/** The moves a "Move to…" menu offers for a task: every target but where it already is. */
fun moveChoices(status: String): List<MoveChoice> = MOVE_CHOICES.filter { it.target != status }

/** The status a drop on a column means; null for Ready for review, which only the agents fill. */
fun dropTarget(column: KanbanColumnId, dropped: Boolean = false): String? = when (column) {
    KanbanColumnId.Todo -> "todo"
    KanbanColumnId.Working -> "in_progress"
    KanbanColumnId.Blocked -> "blocked"
    KanbanColumnId.Waiting, KanbanColumnId.Review -> null
    KanbanColumnId.Done -> if (dropped) "dropped" else "done"
}

/**
 * What a move needs from the user first: sending a task back from review to work needs a reason the agents get;
 * blocking one asks, optionally, what it waits on. Other moves go at once.
 */
enum class MoveQuestion { None, Reason, BlockedReason }

fun moveQuestion(from: String, to: String): MoveQuestion = when {
    from == "review" && to == "in_progress" -> MoveQuestion.Reason
    to == "blocked" && from != "blocked" -> MoveQuestion.BlockedReason
    else -> MoveQuestion.None
}

/**
 * The save that moves a task: everything as it is but the status. A task leaving Blocked loses its reason (what it was
 * waiting on is over); one moved to Blocked takes the user's. Refs stay null, so the server keeps them.
 */
fun moveInput(task: BoardTask, to: String, blockedReason: String? = null): BoardTaskInput {
    val reason = blockedReason?.trim().orEmpty()
    return BoardTaskInput(
        title = task.title,
        description = task.description,
        acceptance = task.acceptance,
        refs = null,
        status = to,
        blockedBy = task.blockedBy,
        blockedReason = if (to == "blocked") reason.ifEmpty { null } ?: task.blockedReason else null,
        writeScopes = task.writeScopes,
    )
}

/** To do's order with [taskId] put at [index] (counted without it): the IDs `board.tasks.reorder` takes. */
fun todoOrderWith(todoIds: List<String>, taskId: String, index: Int): List<String> {
    val rest = todoIds.filter { it != taskId }
    val at = index.coerceIn(0, rest.size)
    return rest.take(at) + taskId + rest.drop(at)
}

/** What the board says after a move, with an Undo beside it. */
fun moveNotice(taskId: String, to: String): String = when (to) {
    "todo" -> "$taskId is back in To do."
    "in_progress" -> "$taskId moved to Working. The coordinator will start it."
    "blocked" -> "$taskId moved to Blocked."
    "done" -> "$taskId is done."
    "dropped" -> "$taskId was dropped."
    else -> "$taskId moved to ${taskStatusWords(to)}."
}

/**
 * The chat message that carries the reason on a backend whose saves take no note (older than `board-moves`): the
 * task reference says which task, this says why it is back.
 */
fun reasonMessage(reason: String): String = "Back to working: ${reason.trim()}"

// --- the remembered view -----------------------------------------------------------------------------------------

/** How the Tasks view shows the tasks; per device, list unless the board was chosen. */
enum class TasksViewMode(val stored: String) { List("list"), Board("board"), Graph("graph") }

/** Unknown stored choices safely fall back to List. */
fun tasksViewMode(stored: String?): TasksViewMode = TasksViewMode.entries.find { it.stored == stored } ?: TasksViewMode.List
