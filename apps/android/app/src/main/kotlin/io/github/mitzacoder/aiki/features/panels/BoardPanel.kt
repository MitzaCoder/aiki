package io.github.mitzacoder.aiki.features.panels

import io.github.mitzacoder.aiki.features.tasks.BoardMarkdown

import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.ui.Modifier
import androidx.compose.ui.Alignment
import androidx.compose.ui.semantics.*
import io.github.mitzacoder.aiki.ui.components.*
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import io.github.mitzacoder.aiki.data.*
import io.github.mitzacoder.aiki.navigation.*
import io.github.mitzacoder.aiki.protocol.*
import kotlinx.coroutines.*
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.BorderStroke
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withStyle
import io.github.mitzacoder.aiki.features.tasks.QuestionCard
import io.github.mitzacoder.aiki.features.tasks.TaskEditor
import io.github.mitzacoder.aiki.features.tasks.blockersOf
import io.github.mitzacoder.aiki.features.tasks.inProgressText
import io.github.mitzacoder.aiki.features.tasks.questionAskedBy
import io.github.mitzacoder.aiki.features.tasks.questionTaskLabel
import io.github.mitzacoder.aiki.features.tasks.taskOwner
import io.github.mitzacoder.aiki.features.tasks.taskStatusTone
import io.github.mitzacoder.aiki.ui.theme.Jarvis
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.draw.clip
import io.github.mitzacoder.aiki.features.chat.ArtifactThumb
import io.github.mitzacoder.aiki.features.chat.artifactTitle
import io.github.mitzacoder.aiki.features.chat.artifactsByTask
import io.github.mitzacoder.aiki.features.chat.rememberTranscriptArtifacts

internal fun validateTask(draft: TaskDraft, tasks: List<BoardTask>): String? {
    if (draft.input.title.isBlank()) return "A title is required."
    val byId = tasks.associateBy { it.id }
    fun reachesSelf(id: String, visited: MutableSet<String>): Boolean {
        if (id == draft.id) return true
        if (!visited.add(id)) return false
        return byId[id]?.blockedBy?.any { reachesSelf(it, visited) } == true
    }
    // Retained blockers can be archived out of this snapshot; the server checks the full graph.
    if (draft.input.blockedBy.any { it !in byId && it !in draft.retainedBlockedBy }) return "Every dependency must be an existing task ID."
    if (draft.input.blockedBy.any { reachesSelf(it, mutableSetOf()) }) return "Dependencies must not form a cycle."
    return null
}

/** The board's group order and names (web `lib/board.ts` `GROUP_ORDER`, `taskStatusLabel`). */
internal val boardGroupOrder = listOf("in_progress", "review", "waiting", "blocked", "todo", "done", "dropped")

internal fun boardStatusLabel(status: String): String = when (status) {
    "todo" -> "Todo"
    "in_progress" -> "In progress"
    "blocked" -> "Blocked"
    "review" -> "Review"
    "waiting" -> "Waiting"
    "done" -> "Done"
    "dropped" -> "Dropped"
    else -> status
}

/** One status' tasks, in board order; done and dropped start folded. */
internal data class BoardGroup(val status: String, val label: String, val tasks: List<BoardTask>, val collapsedByDefault: Boolean)

/** Tasks grouped in the order the panel shows them; archived ones only when asked for, empty groups left out (web `groupTasks`). */
internal fun groupBoardTasks(tasks: List<BoardTask>, includeArchived: Boolean): List<BoardGroup> {
    val shown = tasks.filter { includeArchived || !it.archived }
    return boardGroupOrder.mapNotNull { status ->
        val group = shown.filter { it.status == status || (status == "todo" && it.status !in boardGroupOrder) }.sortedWith(compareBy<BoardTask> { it.order }.thenBy { it.id.filter(Char::isDigit).toIntOrNull() ?: 0 }.thenBy { it.id })
        if (group.isEmpty()) null else BoardGroup(status, boardStatusLabel(status), group, status == "done" || status == "dropped" || status == "waiting")
    }
}

/**
 * The full order after moving a task [delta] places within its status group; the other groups keep their places. Null when
 * nothing would move (web `reorderedIds`).
 */
internal fun boardReorderedIds(tasks: List<BoardTask>, taskId: String, delta: Int): List<String>? {
    val moved = tasks.firstOrNull { it.id == taskId } ?: return null
    val all = tasks.filter { !it.archived }.sortedWith(compareBy<BoardTask> { it.order }.thenBy { it.id }).map { it.id }
    val status = tasks.associate { it.id to it.status }
    val group = all.filter { status[it] == moved.status }
    val from = group.indexOf(taskId)
    if (from == -1) return null
    val to = (from + delta).coerceIn(0, group.lastIndex)
    if (to == from) return null
    val next = group.toMutableList().apply { removeAt(from); add(to, taskId) }.iterator()
    return all.map { if (status[it] == moved.status) next.next() else it }
}

/**
 * The Board tab on a backend without task reports (web `BoardPanel.svelte`): the questions waiting on the user with the
 * Tasks list's question card, the tasks by status with their status badge and coloured edge, owner, blockers, scopes,
 * artifacts and workers, moved with ↑ ↓ and dropped with ⊘, then the answered questions and the decisions. A task opens
 * in the task editor in place of the list. Reads the shared board ([ProjectScreenContext.board]).
 */
@Composable internal fun BoardPanel(context: ProjectScreenContext) {
    val project = context.route.projectId
    val client = context.backend.client
    val view by context.board.view.collectAsStateWithLifecycle()
    val connection by client.state.collectAsStateWithLifecycle()
    val threads = if (connection.supports("threads")) panelData(context, "board-owners", { it is ThreadsStateEvent && it.projectId == project }) {
        client.request(ThreadsListRequest(projectId = project, includeArchived = true)).threads
    }.value.orEmpty() else emptyList()
    val workers = if (connection.supports("workers")) panelData(context, "board-workers", { it is WorkersStateEvent && it.projectId == project }) {
        client.request(WorkersListRequest(projectId = project)).workers
    }.value.orEmpty() else emptyList()
    // The project's newest artifacts, read once for every row, by the task each is evidence for (web: 500 of them).
    val artifacts = if (connection.supports("artifacts")) rememberTranscriptArtifacts(context) else emptyList()
    val taskArtifacts = remember(artifacts) { artifactsByTask(artifacts) }
    val draftKey = boardDraftKey(context.backend.config.key, project, "board", "")
    /** The task being edited, "new" for the add form, or null for the list. */
    var editing by rememberSaveable(draftKey) { mutableStateOf<String?>(null) }
    var problem by remember { mutableStateOf<String?>(null) }
    var answeredOpen by rememberSaveable(draftKey) { mutableStateOf(false) }
    var decisionsOpen by rememberSaveable(draftKey) { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    val colors = Jarvis.colors
    val tasks = view.tasks
    val editingTask = editing?.takeIf { it != "new" }?.let { view.task(it) }
    if (editing != null && (editing == "new" || editingTask != null)) {
        TaskEditor(context, task = editingTask, tasks = tasks, onBack = { editing = null }, modifier = Modifier.fillMaxSize().padding(top = 12.dp))
        return
    }
    fun move(task: BoardTask, delta: Int) {
        val ids = boardReorderedIds(tasks, task.id, delta) ?: return
        scope.launch { problem = context.board.reorder(ids) }
    }
    fun drop(task: BoardTask) {
        scope.launch {
            problem = when (val outcome = context.board.saveTask(task.input().copy(status = "dropped"), task.id, task.revision)) {
                is SaveOutcome.Saved -> null
                is SaveOutcome.Conflict -> "${task.id} changed meanwhile. Open it to review the newer version."
                is SaveOutcome.Failed -> outcome.message
            }
        }
    }
    @Composable fun Heading(title: String, count: Int? = null, modifier: Modifier = Modifier) =
        Text(title.uppercase() + (count?.let { " ($it)" } ?: ""), modifier, style = MaterialTheme.typography.labelSmall, color = colors.fgSubtle)
    @Composable fun Fold(title: String, count: Int, open: Boolean, toggle: () -> Unit, dot: (@Composable () -> Unit)? = null) =
        Row(Modifier.fillMaxWidth().clickable(onClickLabel = if (open) "Fold $title" else "Unfold $title", onClick = toggle).heightIn(min = 36.dp).padding(horizontal = 4.dp),
            verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            LucideGlyph(if (open) Lucide.ChevronDown else Lucide.ChevronRight, size = 14.dp, tint = colors.fgSubtle)
            dot?.invoke()
            Text(title, style = MaterialTheme.typography.labelLarge, color = colors.fgMuted)
            Text("($count)", style = MaterialTheme.typography.labelMedium, color = colors.fgSubtle)
        }
    val questions = view.questions.filter { it.status == "open" }
    val answered = view.questions.filter { it.status == "answered" }
    val decisions = view.board?.decisions.orEmpty()
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(vertical = 12.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        editing?.let { Banner("$it is no longer on the board.", colors.warning) }
        view.error?.let { Banner(it, MaterialTheme.colorScheme.error) }
        problem?.let { Banner(it, MaterialTheme.colorScheme.error) }
        if (questions.isNotEmpty()) Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Heading("Questions for you", questions.size)
            questions.forEach { question -> key(question.id) {
                QuestionCard(context, question, askedBy = questionAskedBy(question, threads), taskLabel = questionTaskLabel(question, view::task),
                    onOpenTask = question.taskId?.takeIf { view.task(it) != null }?.let { id -> { editing = id } })
            } }
        }
        Row(verticalAlignment = Alignment.CenterVertically) {
            Heading("Tasks", modifier = Modifier.weight(1f))
            TextButton(onClick = { editing = "new" }, contentPadding = PaddingValues(horizontal = 8.dp)) {
                LucideGlyph(Lucide.Plus, size = 14.dp); Spacer(Modifier.width(6.dp)); Text("Add task", style = MaterialTheme.typography.labelMedium)
            }
        }
        val groups = groupBoardTasks(tasks, view.showArchived)
        when {
            !view.loaded -> Text("Loading the board…", style = MaterialTheme.typography.bodySmall, color = colors.fgSubtle)
            groups.isEmpty() -> Text(
                if (tasks.isEmpty() && questions.isEmpty() && decisions.isEmpty()) "Nothing on the board yet. The coordinator adds tasks as it plans, or add one yourself." else "No tasks yet.",
                style = MaterialTheme.typography.bodyMedium, color = colors.fgSubtle)
        }
        groups.forEach { group -> key(group.status) {
            var open by rememberSaveable(draftKey, group.status) { mutableStateOf(!group.collapsedByDefault) }
            Fold(group.label, group.tasks.size, open, { open = !open }) { TaskStatusDot(group.status) }
            if (open) group.tasks.forEach { task -> key(task.id) {
                BoardTaskRow(context, task, tasks, threads, workers, taskArtifacts[task.id].orEmpty(), open = { editing = task.id }, move = { move(task, it) }, drop = { drop(task) })
            } }
        } }
        val archivedCount = if (view.showArchived) tasks.count { it.archived } else 0
        TextButton(onClick = { scope.launch { context.board.setShowArchived(!view.showArchived) } }, modifier = Modifier.semantics { selected = view.showArchived }) {
            LucideGlyph(Lucide.Archive, size = 14.dp); Spacer(Modifier.width(6.dp))
            Text(if (view.showArchived) "Hide archived${if (archivedCount > 0) " ($archivedCount)" else ""}" else "Show archived", style = MaterialTheme.typography.labelMedium)
        }
        if (answered.isNotEmpty()) {
            Fold("Answered questions", answered.size, answeredOpen, { answeredOpen = !answeredOpen })
            if (answeredOpen) answered.forEach { question -> BoardNote {
                Text(question.id, fontFamily = FontFamily.Monospace, color = colors.fgSubtle)
                BoardMarkdown(question.text)
                BoardMarkdown(question.answer.orEmpty())
            } }
        }
        if (decisions.isNotEmpty()) {
            Fold("Decisions", decisions.size, decisionsOpen, { decisionsOpen = !decisionsOpen })
            if (decisionsOpen) decisions.forEach { decision -> BoardNote {
                Text(decision.id, fontFamily = FontFamily.Monospace, color = colors.fgSubtle)
                BoardMarkdown(decision.text)
                decision.why?.let { BoardMarkdown(it) }
                Text((decision.taskId?.let { "$it · " } ?: "") + io.github.mitzacoder.aiki.features.status.relativeTime(decision.at, System.currentTimeMillis()),
                    style = MaterialTheme.typography.labelSmall, color = colors.fgSubtle)
            } }
        }
        // Last: below every task, the answered questions and the decisions.
        if (view.loaded) io.github.mitzacoder.aiki.features.tasks.LooseWorkers(context, tasks)
    }
}

@Composable private fun Banner(text: String, tone: androidx.compose.ui.graphics.Color) {
    Surface(Modifier.fillMaxWidth(), shape = MaterialTheme.shapes.medium, color = tone.copy(alpha = 0.10f), contentColor = tone, border = BorderStroke(1.dp, tone.copy(alpha = 0.35f))) {
        Text(text, Modifier.padding(horizontal = 12.dp, vertical = 8.dp), style = MaterialTheme.typography.bodySmall)
    }
}

/** An answered question or a decision: a quiet bordered note. */
@Composable private fun BoardNote(content: @Composable ColumnScope.() -> Unit) {
    Surface(Modifier.fillMaxWidth(), shape = MaterialTheme.shapes.medium, border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.6f)), color = MaterialTheme.colorScheme.surface.copy(alpha = 0f)) {
        Column(Modifier.padding(horizontal = 10.dp, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            CompositionLocalProvider(LocalTextStyle provides io.github.mitzacoder.aiki.ui.theme.Text.taskSm) { content() }
        }
    }
}

/** One task on the old board: ID and title (opens the editor), status badge, owner, progress, blockers, scopes, workers, and ↑ ↓ ⊘. */
@Composable private fun BoardTaskRow(
    context: ProjectScreenContext, task: BoardTask, tasks: List<BoardTask>, threads: List<ThreadSummary>, workers: List<WorkerSummary>,
    artifacts: List<Artifact>, open: () -> Unit, move: (Int) -> Unit, drop: () -> Unit,
) {
    val colors = Jarvis.colors
    val edge = colors.taskStatus(taskStatusTone(task.status))
    val settled = task.status == "done" || task.status == "dropped"
    val movable = !task.archived && !settled
    val shape = MaterialTheme.shapes.medium
    Surface(
        Modifier.fillMaxWidth().alpha(if (settled) 0.75f else 1f).semantics {
            customActions = if (!movable) emptyList() else listOf(
                CustomAccessibilityAction("Move ${task.id} up") { move(-1); true },
                CustomAccessibilityAction("Move ${task.id} down") { move(1); true },
                CustomAccessibilityAction("Drop ${task.id}") { drop(); true },
            )
        },
        shape = shape, color = MaterialTheme.colorScheme.surfaceContainerLow, border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
    ) {
        Row(Modifier.height(IntrinsicSize.Min)) {
            Box(Modifier.width(3.dp).fillMaxHeight().background(edge))
            Column(Modifier.weight(1f).padding(start = 9.dp, end = 10.dp, top = 8.dp, bottom = if (movable) 2.dp else 8.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Row(verticalAlignment = Alignment.Top, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(buildAnnotatedString {
                        withStyle(SpanStyle(fontFamily = FontFamily.Monospace, fontWeight = FontWeight.Normal, color = colors.fgSubtle, fontSize = MaterialTheme.typography.labelMedium.fontSize)) { append(task.id) }
                        append(" ${task.title}")
                    }, Modifier.weight(1f).clickable(onClickLabel = "Edit ${task.id}: ${task.title}", onClick = open), style = io.github.mitzacoder.aiki.ui.theme.Text.task, fontWeight = FontWeight.SemiBold)
                    TaskStatusBadge(task.status)
                }
                val owner = if (threads.isEmpty() && task.ownerThreadId == null) null else taskOwner(task, threads)
                if (owner?.claimed == true) Surface(shape = MaterialTheme.shapes.small, color = if (owner.main) colors.surface2 else MaterialTheme.colorScheme.primary.copy(alpha = 0.12f),
                    contentColor = if (owner.main) colors.fgMuted else MaterialTheme.colorScheme.primary) {
                    Row(Modifier.padding(horizontal = 6.dp, vertical = 1.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                        LucideGlyph(Lucide.Layers, size = 12.dp); Text(owner.label, style = MaterialTheme.typography.labelSmall, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    }
                } else if (owner != null && threads.any { !it.main } && !settled) Text("Unclaimed", style = MaterialTheme.typography.labelSmall, color = colors.fgSubtle)
                if (task.status == "in_progress") inProgressText(task)?.let { text ->
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                        LucideGlyph(PanelIcons.Timer, size = 12.dp, tint = colors.fgSubtle); Text(text, style = MaterialTheme.typography.labelMedium, color = colors.fgSubtle)
                    }
                }
                if (task.status == "waiting") Text(io.github.mitzacoder.aiki.features.tasks.waitingSummary(task), style = MaterialTheme.typography.bodySmall, color = colors.fgSubtle)
                if (task.status == "blocked") task.blockedReason?.let { reason ->
                    Row(verticalAlignment = Alignment.Top, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                        LucideGlyph(PanelIcons.Lock, Modifier.padding(top = 2.dp), size = 12.dp, tint = colors.danger); Text(reason, style = MaterialTheme.typography.labelMedium, color = colors.danger)
                    }
                }
                val blockers = blockersOf(task, tasks)
                if (blockers.isNotEmpty()) FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(2.dp), itemVerticalAlignment = Alignment.CenterVertically) {
                    Text("Waits for", style = MaterialTheme.typography.labelMedium, color = colors.fgSubtle)
                    blockers.forEach { blocker ->
                        Surface(shape = MaterialTheme.shapes.extraSmall, border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant), color = MaterialTheme.colorScheme.surface.copy(alpha = 0f),
                            modifier = Modifier.semantics { contentDescription = "${blocker.id}: ${blocker.title.ifEmpty { "Archived" }} · ${if (blocker.status == "unknown") "archived" else boardStatusLabel(blocker.status)}" }) {
                            Text(blocker.id, Modifier.padding(horizontal = 4.dp), style = MaterialTheme.typography.labelMedium, fontFamily = FontFamily.Monospace, color = colors.fgSubtle,
                                textDecoration = if (blocker.settled) TextDecoration.LineThrough else null)
                        }
                    }
                }
                if (task.writeScopes.isNotEmpty()) FlowRow(horizontalArrangement = Arrangement.spacedBy(4.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) { task.writeScopes.forEach { PanelMetaChip(it, monospace = true) } }
                if (artifacts.isNotEmpty()) TaskArtifactStrip(context, artifacts)
                if (task.workerIds.isNotEmpty()) Row(Modifier.height(IntrinsicSize.Min).semantics(mergeDescendants = false) { contentDescription = "Workers on ${task.id}" }) {
                    Box(Modifier.width(2.dp).fillMaxHeight().background(MaterialTheme.colorScheme.outlineVariant))
                    Column(Modifier.padding(start = 8.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                        task.workerIds.forEach { id ->
                            // A worker ID is unique per thread, not per project: name it only when one worker has it.
                            val worker = workers.singleOrNull { it.id == id }
                            if (worker != null) Row(Modifier.fillMaxWidth().clickable { context.navigate(context.route.copy(threadId = worker.threadId, workerId = worker.id)) }.heightIn(min = 32.dp),
                                verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                                Text(worker.title.ifEmpty { worker.id }, Modifier.weight(1f), style = MaterialTheme.typography.labelMedium, maxLines = 1, overflow = TextOverflow.Ellipsis)
                                StatusBadge(worker.status, domain = "worker")
                                LucideGlyph(Lucide.ChevronRight, size = 12.dp, tint = colors.fgSubtle)
                            } else Text(id, Modifier.semantics { contentDescription = "$id, this worker was forgotten" }, style = MaterialTheme.typography.labelMedium, fontFamily = FontFamily.Monospace, color = colors.fgSubtle)
                        }
                    }
                }
                if (movable) Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                    IconAction("Move ${task.id} up", Lucide.ArrowUp) { move(-1) }
                    IconAction("Move ${task.id} down", Lucide.ArrowDown) { move(1) }
                    IconAction("Drop ${task.id}", PanelIcons.Ban) { drop() }
                }
            }
        }
    }
}

/** A task's newest four artifacts as small thumbnails, "+N" for the rest, each opening the artifact (web `ArtifactStrip`). */
@Composable private fun TaskArtifactStrip(context: ProjectScreenContext, artifacts: List<Artifact>, max: Int = 4) {
    var expanded by rememberSaveable(artifacts.first().taskId) { mutableStateOf(false) }
    val shape = RoundedCornerShape(8.dp)
    FlowRow(Modifier.semantics { contentDescription = "Artifacts" }, horizontalArrangement = Arrangement.spacedBy(6.dp), itemVerticalAlignment = Alignment.CenterVertically) {
        (if (expanded) artifacts else artifacts.take(max)).forEach { artifact ->
            key(artifact.id) {
                val title = artifactTitle(artifact)
                Surface(onClick = { context.navigate(stageArtifactDestination(context.route, artifact)) }, shape = shape,
                    border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant), modifier = Modifier.semantics { contentDescription = "Open $title" }) {
                    ArtifactThumb(context, artifact, Modifier.size(width = 52.dp, height = 36.dp).clip(shape), duration = false)
                }
            }
        }
        if (artifacts.size > max) OutlinedButton(onClick = { expanded = !expanded }, shape = shape, contentPadding = PaddingValues(horizontal = 8.dp),
            modifier = Modifier.heightIn(min = 36.dp)) {
            Text(if (expanded) "Fewer" else "+${artifacts.size - max}", style = MaterialTheme.typography.labelMedium)
        }
    }
}

@Composable internal fun TaskEditor(context: ProjectScreenContext, initial: TaskDraft, tasks: List<BoardTask>, close: () -> Unit, saved: () -> Unit) {
    val draftKey = boardDraftKey(context.backend.config.key, context.route.projectId, "task", initial.id ?: "new")
    var editor by rememberSaveable(draftKey, stateSaver = boardDraftSaver(draftKey, TaskEditorState.serializer())) { mutableStateOf(TaskEditorState(initial)) }
    val draft = editor.draft
    var busy by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    fun save(value: TaskDraft) {
        if (busy) return
        busy = true; editor = editor.copy(error = null)
        scope.launch {
            try {
                context.backend.client.request(BoardTaskSaveRequest(projectId = context.route.projectId, taskId = value.id, expectedRevision = value.revision, task = value.input))
                saved()
            } catch (e: CancellationException) { throw e }
            catch (e: Exception) {
                editor = editor.copy(error = panelError(e))
                if ((e as? ClientException)?.code == "board_conflict") {
                    try {
                        val conflict = context.backend.client.request(BoardGetRequest(projectId = context.route.projectId, includeArchived = true)).board.tasks.find { it.id == value.id }
                        editor = editor.copy(conflict = conflict, error = if (conflict == null) "Task no longer exists. Your draft is preserved." else "Task changed elsewhere. Your draft is preserved.")
                    } catch (read: Exception) { if (read is CancellationException) throw read; editor = editor.copy(error = "Conflict; could not load latest task. ${panelError(read)}") }
                }
            } finally { busy = false }
        }
    }
    Dialog(onDismissRequest = { if (!busy) close() }) {
        Surface(shape = MaterialTheme.shapes.large) {
            Column(Modifier.padding(16.dp).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(if (draft.id == null) "New task" else "Edit task", style = MaterialTheme.typography.headlineSmall)
                fun update(input: BoardTaskInput) { editor = editor.copy(draft = editor.draft.copy(input = input)) }
                OutlinedTextField(draft.input.title, { update(draft.input.copy(title = it)) }, enabled = !busy, label = { Text("Title") })
                OutlinedTextField(draft.input.description, { update(draft.input.copy(description = it)) }, enabled = !busy, label = { Text("Description") }, minLines = 3)
                OutlinedTextField(draft.input.acceptance.orEmpty(), { update(draft.input.copy(acceptance = it.ifBlank { null })) }, enabled = !busy, label = { Text("Acceptance criteria") })
                Row(Modifier.horizontalScroll(rememberScrollState())) {
                    listOf("todo", "in_progress", "blocked", "review", "done", "dropped").forEach { status -> FilterChip(draft.input.status == status, { update(draft.input.copy(status = status)) }, enabled = !busy, label = { Text(workbenchStatus(status).label) }) }
                }
                OutlinedTextField(draft.input.blockedReason.orEmpty(), { update(draft.input.copy(blockedReason = it.ifBlank { null })) }, enabled = !busy, label = { Text("Blocked reason") })
                OutlinedTextField(editor.blockers, { editor = editor.copy(blockers = it); update(draft.input.copy(blockedBy = splitIds(it))) }, enabled = !busy, label = { Text("Dependency IDs, comma separated") })
                OutlinedTextField(editor.scopes, { editor = editor.copy(scopes = it); update(draft.input.copy(writeScopes = splitIds(it))) }, enabled = !busy, label = { Text("Write scopes, comma separated") })
                val validation = validateTask(draft, tasks)
                validation?.let { Text(it, color = MaterialTheme.colorScheme.error) }
                editor.error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
                editor.conflict?.let { latest ->
                    Text("Latest: ${latest.title} · revision ${latest.revision}")
                    val differences = taskConflictFields(draft, latest)
                    if (differences.isEmpty()) Text("Their editable fields match your draft.")
                    differences.forEach { (field, value) ->
                        Text("$field, now", style = MaterialTheme.typography.labelLarge)
                        SelectionContainer { Text(value.ifEmpty { "(empty)" }) }
                    }
                    TextButton(enabled = !busy, onClick = { editor = TaskEditorState(draft.useTheirs(latest)) }) { Text("Use theirs") }
                    TextButton(enabled = !busy && validation == null, onClick = {
                        val mine = draft.keepMine(latest)
                        editor = editor.copy(draft = mine, conflict = null)
                        save(mine)
                    }) { Text("Save mine against revision ${latest.revision}") }
                }
                Row {
                    TextButton(enabled = !busy, onClick = close) { Text("Cancel") }
                    Button(enabled = !busy && validation == null && editor.conflict == null, onClick = { save(draft) }) { Text(if (busy) "Saving…" else "Save") }
                }
            }
        }
    }
}
internal fun splitIds(value: String) = value.split(',').map { it.trim() }.filter { it.isNotEmpty() }.distinct()

/** A question with the Tasks list's card (the board's loose questions default to it). */
@Composable
fun BoardQuestionEditor(context: ProjectScreenContext, question: BoardQuestion, onAnswered: () -> Unit = {}) {
    QuestionCard(context, question)
}
