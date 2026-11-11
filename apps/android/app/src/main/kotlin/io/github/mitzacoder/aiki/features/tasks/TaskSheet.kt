package io.github.mitzacoder.aiki.features.tasks

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.DragInteraction
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.content.contentReceiver
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.text.input.rememberTextFieldState
import androidx.compose.foundation.text.input.setTextAndPlaceCursorAtEnd
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.compose.ui.window.DialogWindowProvider
import androidx.core.view.WindowCompat
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.github.mitzacoder.aiki.data.*
import io.github.mitzacoder.aiki.features.panels.panelData
import io.github.mitzacoder.aiki.features.tasks.media.ARTIFACT_TAGS_FEATURE
import io.github.mitzacoder.aiki.features.tasks.media.TaskFiles
import io.github.mitzacoder.aiki.features.chat.ComposerQuotes
import io.github.mitzacoder.aiki.features.chat.DraftImage
import io.github.mitzacoder.aiki.features.chat.INPUT_MAX_IMAGES
import io.github.mitzacoder.aiki.features.chat.MessageComposer
import io.github.mitzacoder.aiki.features.chat.attachFiles
import io.github.mitzacoder.aiki.features.chat.imageBlock
import io.github.mitzacoder.aiki.features.chat.messageLimitError
import io.github.mitzacoder.aiki.features.chat.rememberImageIntake
import io.github.mitzacoder.aiki.features.chat.sha256Hex
import io.github.mitzacoder.aiki.features.chat.LocalQuoteHandler
import io.github.mitzacoder.aiki.features.refs.refLinkedText
import io.github.mitzacoder.aiki.navigation.ProjectScreenContext
import io.github.mitzacoder.aiki.protocol.*
import io.github.mitzacoder.aiki.ui.components.*
import io.github.mitzacoder.aiki.ui.theme.Jarvis
import io.github.mitzacoder.aiki.ui.theme.JetBrainsMono
import io.github.mitzacoder.aiki.ui.theme.TaskStatusTone
import io.github.mitzacoder.aiki.ui.theme.Text as TextStyles
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonPrimitive

/**
 * A task as a sheet over the chat it was opened from ([io.github.mitzacoder.aiki.navigation.Destination.Task]; web
 * `TaskSheet.svelte`): the whole screen on a phone, a wide panel from the side on a tablet. The Dashboard leads with
 * questions, report, feedback and files in one column, with sticky section navigation,
 * followed by folded history and brief. The user closes the task from here (Done, Drop, Reopen)
 * and talks about it in the reply box, which sends to main's conversation with the task's ID, also from a thread's
 * page. HarnessApp shows it; dismissing goes back.
 */
@Composable
fun TaskSheet(context: ProjectScreenContext, taskId: String, onDismiss: () -> Unit) {
    Dialog(onDismissRequest = onDismiss, properties = DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false)) {
        val view = LocalView.current
        val dark = Jarvis.colors.dark
        SideEffect {
            (view.parent as? DialogWindowProvider)?.window?.let { window ->
                WindowCompat.getInsetsController(window, view).apply {
                    isAppearanceLightStatusBars = !dark
                    isAppearanceLightNavigationBars = !dark
                }
            }
        }
        // Text selected in the sheet can be quoted into the chat under it (not a worker's transcript); the sheet closes so
        // the message can be written.
        val quote: ((String) -> Unit)? = if (context.route.workerId == null) { text -> ComposerQuotes.send(context.route, text); onDismiss() } else null
        CompositionLocalProvider(LocalQuoteHandler provides quote) {
        BoxWithConstraints(Modifier.fillMaxSize()) {
            // From a tablet's width the sheet is a panel from the end with the chat dimmed beside it; a tap there closes it.
            val wide = maxWidth >= 600.dp
            if (wide) {
                Box(Modifier.fillMaxSize().clickable(interactionSource = remember { MutableInteractionSource() }, indication = null, onClickLabel = "Close the task", onClick = onDismiss))
                Surface(
                    Modifier.align(Alignment.CenterEnd).fillMaxHeight().width(minOf(1184.dp, maxWidth - 48.dp)),
                    shape = RoundedCornerShape(topStart = 16.dp, bottomStart = 16.dp),
                    color = Jarvis.colors.bg,
                    shadowElevation = 12.dp,
                    border = androidx.compose.foundation.BorderStroke(1.dp, Jarvis.colors.border),
                ) { key(taskId) { TaskSheetContent(context, taskId, wide = true, onDismiss = onDismiss) } }
            } else Surface(Modifier.fillMaxSize(), color = Jarvis.colors.bg) { key(taskId) { TaskSheetContent(context, taskId, wide = false, onDismiss = onDismiss) } }
        }
        }
    }
}

@Composable
private fun TaskSheetContent(context: ProjectScreenContext, taskId: String, wide: Boolean, onDismiss: () -> Unit) {
    val deviceSettings by context.repository.settings.collectAsStateWithLifecycle()
    val colors = Jarvis.colors
    val board = context.board
    val view by board.view.collectAsStateWithLifecycle()
    val connection by context.backend.client.state.collectAsStateWithLifecycle()
    val project = context.route.projectId
    val liveTask = view.task(taskId)
    // A task the live board does not list may be archived; read once to see.
    var archivedTask by remember { mutableStateOf<BoardTask?>(null) }
    var lookedUp by remember { mutableStateOf(false) }
    LaunchedEffect(view.loaded, liveTask == null) {
        if (!view.loaded || liveTask != null || lookedUp) return@LaunchedEffect
        try { archivedTask = board.findArchived(taskId) } catch (cause: CancellationException) { throw cause } catch (_: Exception) {}
        lookedUp = true
    }
    val task = liveTask ?: archivedTask
    val insets = Modifier.windowInsetsPadding(WindowInsets.safeDrawing.only(if (wide) WindowInsetsSides.Vertical + WindowInsetsSides.End else WindowInsetsSides.Vertical + WindowInsetsSides.Horizontal))
    if (task == null) {
        Column(Modifier.fillMaxSize().then(insets)) {
            Row(Modifier.fillMaxWidth().padding(start = 16.dp, end = 4.dp, top = 4.dp, bottom = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                Text(taskId, Modifier.weight(1f), style = TextStyles.base.copy(fontWeight = FontWeight.SemiBold), color = colors.fg)
                IconButton(onClick = onDismiss) { LucideGlyph(Lucide.X, size = 18.dp, contentDescription = "Close the task") }
            }
            HorizontalDivider(color = colors.border)
            if (!view.loaded || !lookedUp) Column(Modifier.padding(16.dp).semantics { contentDescription = "Loading $taskId" }, verticalArrangement = Arrangement.spacedBy(8.dp)) {
                listOf(.35f to 20, .25f to 12, .8f to 14, 1f to 14, .9f to 14, .66f to 12).forEach { (width, height) ->
                    Box(Modifier.fillMaxWidth(width).height(height.dp).background(colors.surface2, RoundedCornerShape(4.dp)))
                }
            }
            else Text("$taskId is not on the board any more.", Modifier.padding(16.dp), style = TextStyles.sm, color = colors.fgSubtle)
        }
        return
    }

    val threads = if (connection.supports("threads")) panelData(context, "sheet-threads", { it is ThreadsStateEvent && it.projectId == project }) {
        context.backend.client.request(ThreadsListRequest(projectId = project, includeArchived = true)).threads
    }.value.orEmpty() else emptyList()
    val workers = if (connection.supports("workers")) panelData(context, "sheet-workers", { it is WorkersStateEvent && it.projectId == project }) {
        context.backend.client.request(WorkersListRequest(projectId = project)).workers
    }.value.orEmpty() else emptyList()
    val artifacts = if (connection.supports("artifacts")) panelData(context, "sheet-artifacts-$taskId", { it is ArtifactsChangedEvent && it.projectId == project }) {
        context.backend.client.request(ArtifactsListRequest(projectId = project, taskId = taskId, limit = 200)).artifacts
    }.value.orEmpty() else emptyList()
    val now by produceState(System.currentTimeMillis()) { while (true) { delay(30_000); value = System.currentTimeMillis() } }

    var editing by rememberSaveable { mutableStateOf(false) }
    var confirmDrop by remember { mutableStateOf(false) }
    var waitingForm by remember(taskId) { mutableStateOf(false) }
    var problem by remember { mutableStateOf<String?>(null) }
    var closing by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    val linksEnabled = connection.supports(HarnessFeature.TASK_LINKS)
    var timeline by remember(taskId) { mutableStateOf<BoardTaskTimelineResponse?>(null) }
    var timelineProblem by remember(taskId) { mutableStateOf<String?>(null) }
    var feedbackBusy by remember(taskId) { mutableStateOf(false) }
    var timelineRefresh by remember(taskId) { mutableIntStateOf(0) }
    LaunchedEffect(linksEnabled, connection.status, task.timelineRevision, task.feedback, task.status, task.report.revision, timelineRefresh) {
        if (!linksEnabled) return@LaunchedEffect
        try {
            timeline = context.backend.client.readTaskTimeline(project, taskId)
            timelineProblem = null
        } catch (cause: CancellationException) { throw cause }
        catch (cause: Exception) { timelineProblem = cause.message ?: "Could not read timeline" }
    }
    fun setFeedback(entry: BoardFeedback, state: String) {
        if (feedbackBusy) return
        feedbackBusy = true
        scope.launch {
            try {
                val updated = context.backend.client.setFeedbackState(project, taskId, entry.id, state)
                timeline = timeline?.let { it.copy(feedback = it.feedback.map { old -> if (old.id == updated.id) updated else old }) }
                timelineRefresh++
            } catch (cause: CancellationException) { throw cause }
            catch (cause: Exception) { timelineProblem = cause.message ?: "Could not change feedback" }
            finally { feedbackBusy = false }
        }
    }
    val questions = waitingOn(view.questions, task.id)
    val decisions = decisionsFor(view.board?.decisions.orEmpty(), task.id)
    val blockers = blockersOf(task, view.tasks).filterNot { it.settled }
    val owner = taskOwner(task, threads)
    fun writerName(writer: BoardWriter) = shortWriterLabel(writer, threads)

    fun setStatus(target: String, waitingFor: String? = null, waitUntil: String? = null) {
        if (closing) return
        closing = true
        problem = null
        confirmDrop = false
        scope.launch {
            // No refs: a status change keeps the task's own.
            val input = task.editorDraft().toInput(baseRefs = task.refs).copy(status = target, waitingFor = waitingFor, waitUntil = waitUntil)
            when (val outcome = board.saveTask(input, task.id, task.revision)) {
                is SaveOutcome.Saved -> { waitingForm = false; if (archivedTask?.id == task.id) archivedTask = outcome.task }
                is SaveOutcome.Conflict -> problem = "${task.id} changed while you were looking. Check it and try again."
                is SaveOutcome.Failed -> problem = outcome.message
            }
            closing = false
        }
    }

    // Budget from the space ABOVE the IME, not the full display. Non-weighted headers used to consume all
    // Column constraints before the reply was measured, leaving a focused but invisible input/send button.
    BoxWithConstraints(Modifier.fillMaxSize().then(insets).imePadding()) {
    val headerMaxHeight = minOf(360.dp, maxHeight * .35f, (maxHeight - 220.dp).coerceAtLeast(56.dp))
    val refsMaxHeight = minOf(240.dp, maxHeight * .25f)
    val replyInputMaxHeight = (maxHeight * .20f).coerceIn(40.dp, 160.dp)
    val shortViewport = maxHeight < 400.dp
    Column(Modifier.fillMaxSize()) {
        // The header: ID, status, edit and close; the title, its tickets, when it moved; what the user can do with it.
        Column(Modifier.fillMaxWidth().heightIn(max = headerMaxHeight).verticalScroll(rememberScrollState()).padding(start = 16.dp, end = 4.dp, bottom = 12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(task.id, style = TaskType.xs.copy(fontFamily = JetBrainsMono), color = colors.fgSubtle)
                TaskStatusMenu(task.status, connection.supports("task-waiting"), !closing) { status ->
                    confirmDrop = status == "dropped"
                    waitingForm = status == "waiting"
                    if (!confirmDrop && !waitingForm) setStatus(status)
                }
                Spacer(Modifier.weight(1f))
                if (!editing) IconButton(onClick = { editing = true }) { LucideGlyph(TaskIcons.Pencil, size = 18.dp, contentDescription = "Edit ${task.id}") }
                IconButton(onClick = onDismiss) { LucideGlyph(Lucide.X, size = 18.dp, contentDescription = "Close the task") }
            }
            Column(Modifier.padding(end = 12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(refLinkedText(task.title), Modifier.semantics { heading() }, style = TextStyles.lg.copy(fontWeight = FontWeight.SemiBold), color = colors.fg)
                if (task.refs.isNotEmpty()) TaskRefs(task.refs, refsMaxHeight)
                Text(
                    listOfNotNull(
                        inProgressLine(task),
                        "Updated ${relativeTime(task.updatedAt, now)}",
                        owner.label.takeIf { owner.claimed && !owner.main },
                        "Archived".takeIf { task.archived },
                    ).plus(taskSheetMeta(task, now)).joinToString(" · "),
                    style = TaskType.xs, color = colors.fgSubtle,
                )
                if (waitingForm) TaskWaitingForm(task.waiting, closing, deviceSettings.workDayStart, { note, until -> setStatus("waiting", note, until) }, { waitingForm = false })
                else if (confirmDrop) FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text("Drop ${task.id}? It will not be done.", style = TaskType.xs, color = colors.fgMuted)
                    Button(onClick = { setStatus("dropped") }, enabled = !closing, colors = ButtonDefaults.buttonColors(containerColor = colors.danger, contentColor = colors.bg)) { Text("Drop it") }
                    TextButton(onClick = { confirmDrop = false }) { Text("Keep") }
                }
                problem?.let { Text(it, style = TaskType.xs, color = colors.danger) }
            }
        }
        HorizontalDivider(color = colors.border)

        val bodyState = rememberLazyListState()
        val reducedMotion = rememberReducedMotion()
        val sections = taskSheetSections(
            task, questions.size, artifacts.size,
            linkGroups(task, view.tasks, view.board?.archivedLinks.orEmpty()).sumOf { it.items.size },
            decisions.size, linksEnabled,
            if (task.feedback != null) openFeedbackCount(task).toInt()
            else timeline?.feedback.orEmpty().count { it.state == "open" || it.state == "handling" },
            timeline?.entries.orEmpty().size,
            workers.count { it.id in task.workerIds && it.status == "running" },
        )
        var sectionSelection by remember(task.id) { mutableStateOf(TaskSectionSelection()) }
        var navigationJob by remember(task.id) { mutableStateOf<Job?>(null) }
        LaunchedEffect(bodyState, task.id) {
            bodyState.interactionSource.interactions.collect { interaction ->
                if (interaction is DragInteraction.Start) {
                    navigationJob?.cancel()
                    sectionSelection = sectionSelection.userScroll()
                }
            }
        }
        val currentSection by remember(sections, bodyState) {
            derivedStateOf {
                val layout = bodyState.layoutInfo
                val lastVisible = layout.visibleItemsInfo.lastOrNull {
                    it.offset < layout.viewportEndOffset && it.offset + it.size > layout.viewportStartOffset
                }?.index ?: bodyState.firstVisibleItemIndex
                val index = taskSectionIndex(bodyState.firstVisibleItemIndex, lastVisible, !bodyState.canScrollForward, sections.size)
                val spy = sections.getOrNull(index)?.kind
                if (sections.any { it.kind == sectionSelection.pinned }) sectionSelection.current(spy) else spy
            }
        }
        Column(Modifier.weight(1f).fillMaxWidth()) {
            // On a short IME/landscape viewport, keep space for the actual sections rather than only their nav.
            if (!editing && !shortViewport) TaskSectionNav(sections, currentSection, reducedMotion) { kind ->
                sectionSelection = sectionSelection.select(kind)
                navigationJob?.cancel()
                navigationJob = scope.launch {
                    val index = sections.indexOfFirst { it.kind == kind }
                    // Header/chips are outside this viewport: item offset zero is already below both.
                    if (reducedMotion) bodyState.scrollToItem(index) else bodyState.animateScrollToItem(index)
                }
            }
            LazyColumn(
                state = bodyState, modifier = Modifier.fillMaxSize(),
                contentPadding = PaddingValues(if (shortViewport) 8.dp else 16.dp), verticalArrangement = Arrangement.spacedBy(20.dp),
            ) {
                if (editing) item(key = "editor") { TaskEditor(context, task, view.tasks, onBack = { editing = false }, scrolls = false) }
                else {
                    items(sections, key = { it.kind.name }) { section ->
                        when (section.kind) {
                            TaskSectionKind.Questions -> {
                                if (questions.isNotEmpty()) TaskSection(TaskSectionKind.Questions, count = "${questions.size} open") {
                                    questions.forEach { question -> key(question.id) { QuestionCard(context, question, askedBy = questionAskedBy(question, threads)) } }
                                }
                            }
                            TaskSectionKind.Report -> {
                                Column(verticalArrangement = Arrangement.spacedBy(20.dp)) {
                                    if (task.status == "blocked" && (!task.blockedReason.isNullOrBlank() || blockers.isNotEmpty())) Column(
                                        Modifier.fillMaxWidth().border(1.dp, colors.danger.copy(alpha = .3f), RoundedCornerShape(12.dp)).padding(horizontal = 12.dp, vertical = 10.dp),
                                        verticalArrangement = Arrangement.spacedBy(6.dp),
                                    ) {
                                        task.blockedReason?.takeIf { it.isNotBlank() }?.let { Text(it, style = TextStyles.task, color = colors.danger) }
                                        if (blockers.isNotEmpty()) FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp), itemVerticalAlignment = Alignment.CenterVertically) {
                                            Text("Waits for", style = TaskType.xs, color = colors.fgMuted)
                                            blockers.forEach { blocker -> TaskChip(blocker.id, onOpen = { context.openTask(blocker.id) }) }
                                        }
                                    }
                                    ReportSectionView(task, now, ::writerName, connection.supports("task-freshness"), connection.supports("task-activity"), context)
                                }
                            }
                            TaskSectionKind.Feedback -> {
                                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                                    timelineProblem?.let {
                                        Text(it, style = TaskType.xs, color = colors.danger)
                                        TextButton(onClick = { timelineRefresh++ }) { Text("Retry") }
                                    }
                                    if (timeline != null) TaskFeedback(timeline!!.feedback, feedbackBusy, ::setFeedback)
                                    else if (timelineProblem == null) Text("Loading feedback…", style = TaskType.xs, color = colors.fgSubtle)
                                }
                            }
                            TaskSectionKind.Files -> {
                                if (artifacts.isNotEmpty()) TaskSection(TaskSectionKind.Files, count = artifacts.size.toString()) {
                                    val tagsEditable = connection.supports(ARTIFACT_TAGS_FEATURE)
                                    TaskFiles(context, artifacts, onUpdateTags = if (tagsEditable) { artifact, tags ->
                                        context.backend.client.request(ArtifactsUpdateRequest(projectId = project, artifactId = artifact.id, tags = tags)).artifact
                                    } else null)
                                }
                            }
                            TaskSectionKind.Related -> {
                                TaskRelations(task, view.tasks, view.board?.archivedLinks.orEmpty(), context::openTask) {
                                    board.showWithLinked(task.id)
                                    context.navigate(io.github.mitzacoder.aiki.navigation.Destination.Panel(context.route, io.github.mitzacoder.aiki.navigation.PanelTab.Board))
                                }
                            }
                            TaskSectionKind.Workers -> {
                                if (task.workerIds.isNotEmpty()) TaskSection(TaskSectionKind.Workers, count = taskWorkerCount(task.workerIds.size, workers.count { it.id in task.workerIds && it.status == "running" })) {
                                    task.workerIds.forEach { id ->
                                        val worker = workers.firstOrNull { it.id == id }
                                        if (worker == null) Text(id, Modifier.padding(horizontal = 12.dp, vertical = 6.dp).semantics { contentDescription = "$id, this worker was forgotten" }, style = TaskType.xs.copy(fontFamily = JetBrainsMono), color = colors.fgSubtle)
                                        else Row(
                                            Modifier.fillMaxWidth().clip(RoundedCornerShape(10.dp)).border(1.dp, colors.border.copy(alpha = .7f), RoundedCornerShape(10.dp))
                                            .clickable(onClickLabel = "Read ${worker.title.ifEmpty { worker.id }}") { context.navigate(context.route.copy(threadId = worker.threadId, workerId = worker.id)) }
                                            .heightIn(min = 44.dp).padding(horizontal = 12.dp, vertical = 6.dp),
                                            verticalAlignment = Alignment.CenterVertically,
                                            horizontalArrangement = Arrangement.spacedBy(8.dp),
                                        ) {
                                            Text(worker.title.ifEmpty { worker.id }, Modifier.weight(1f), style = TaskType.sectionTitle.copy(fontWeight = FontWeight.Medium), color = colors.fg, maxLines = 1, overflow = TextOverflow.Ellipsis)
                                            StatusBadge(worker.status, domain = "worker")
                                            LucideGlyph(Lucide.ChevronRight, size = 14.dp, tint = colors.fgSubtle)
                                        }
                                    }
                                }
                            }
                            TaskSectionKind.Decisions -> {
                                if (decisions.isNotEmpty()) TaskSection(TaskSectionKind.Decisions, count = decisions.size.toString()) {
                                    decisions.forEach { DecisionCard(it, now, withTask = false) }
                                }
                            }
                            TaskSectionKind.Timeline -> {
                                TaskTimeline(timeline?.entries.orEmpty(), deviceSettings.timelineNewestFirst, { scope.launch { context.repository.setTimelineNewestFirst(!deviceSettings.timelineNewestFirst) } }, ::writerName, now)
                            }
                            TaskSectionKind.History -> {
                                if (task.snapshots > 0) {
                                    var historyOpen by rememberSaveable { mutableStateOf(false) }
                                    TaskSection(TaskSectionKind.History, count = task.snapshots.toString(), expanded = historyOpen, onToggle = { historyOpen = !historyOpen }) {
                                        if (historyOpen) TaskHistory(context, task, ::writerName)
                                    }
                                }
                            }
                            TaskSectionKind.Brief -> {
                                if (task.description.isNotBlank() || !task.acceptance.isNullOrBlank()) {
                                    var briefOpen by rememberSaveable { mutableStateOf(false) }
                                    TaskSection(TaskSectionKind.Brief, count = "Reference", expanded = briefOpen, onToggle = { briefOpen = !briefOpen }) {
                                        if (briefOpen) Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                                            if (task.description.isNotBlank()) ReportMarkdown(task.description)
                                            task.acceptance?.takeIf { it.isNotBlank() }?.let {
                                                Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                                                    Text("Done when", style = TaskType.xsSemibold, color = colors.fgMuted)
                                                    ReportMarkdown(it)
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
        if (!editing) {
            HorizontalDivider(color = colors.border)
            ReplyBox(context, task, owner, onDismiss, replyInputMaxHeight)
        }
    }
    }
}

@Composable
private fun ButtonLabel(icon: LucideIcon, text: String) {
    LucideGlyph(icon, size = 16.dp)
    Spacer(Modifier.width(6.dp))
    Text(text)
}

/**
 * Talk about the task: the message goes to the coordinator in main's chat with the task's ID (the server writes
 * `[task T4] ` before it), whichever chat the sheet sits on; main passes it on to a thread that holds the task.
 */
@OptIn(androidx.compose.foundation.ExperimentalFoundationApi::class)
@Composable
private fun ReplyBox(context: ProjectScreenContext, task: BoardTask, owner: TaskOwner, onDismiss: () -> Unit, inputMaxHeight: androidx.compose.ui.unit.Dp) {
    val colors = Jarvis.colors
    // Typed in a text field's own state, so the field can take pasted and keyboard images; kept per task.
    val reply = key(task.id) { rememberTextFieldState() }
    var sending by remember { mutableStateOf(false) }
    var sent by remember { mutableStateOf(false) }
    var replyProblem by remember { mutableStateOf<String?>(null) }
    // Images wait here, in memory only (the reply has no draft), until the message is sent.
    var images by remember(task.id) { mutableStateOf(listOf<DraftImage>()) }
    var attaching by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    // Typing again after a send clears "Sent".
    LaunchedEffect(reply) { snapshotFlow { reply.text.toString() }.collect { if (it.isNotEmpty()) sent = false } }
    val intake = rememberImageIntake { files ->
        attaching = true
        try {
            replyProblem = attachFiles(files) { image ->
                val id = sha256Hex(image.bytes)
                when {
                    images.any { it.ref.id == id } -> null
                    else -> messageLimitError(images.size, images.sumOf { it.bytes?.size ?: 0 }, image.bytes.size, image.name) ?: run {
                        images = images + DraftImage(DraftAttachment(id = id, mimeType = image.mimeType, size = image.bytes.size.toLong(), name = image.name), image.bytes)
                        null
                    }
                }
            }
        } finally { attaching = false }
    }
    fun send() {
        val text = reply.text.toString().trim()
        if ((text.isEmpty() && images.isEmpty()) || sending || attaching) return
        sending = true
        replyProblem = null
        val sentImages = images
        scope.launch {
            try {
                val blocks = sentImages.mapNotNull { image -> image.bytes?.let { imageBlock(image.ref.mimeType, it) } }
                context.backend.client.request(ConversationSubmitRequest(
                    projectId = context.route.projectId, threadId = null, requestId = java.util.UUID.randomUUID().toString(),
                    content = if (blocks.isEmpty()) JsonPrimitive(text) else kotlinx.serialization.json.buildJsonArray {
                        if (text.isNotEmpty()) add(kotlinx.serialization.json.buildJsonObject { put("type", JsonPrimitive("text")); put("text", JsonPrimitive(text)) })
                        blocks.forEach { add(it) }
                    },
                    whenBusy = "steer", taskId = task.id,
                ))
                reply.setTextAndPlaceCursorAtEnd("")
                // What was sent goes; images added while the request was out stay.
                images = images.filterNot { image -> sentImages.any { it.ref.id == image.ref.id } }
                sent = true
            } catch (cause: CancellationException) { throw cause }
            catch (cause: Exception) { replyProblem = cause.message ?: "Could not send" }
            finally { sending = false }
        }
    }
    Column(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        MessageComposer(
            textState = reply,
            hint = "To main · about ${task.id}" + if (owner.claimed && !owner.main) " · ${owner.label}" else "",
            hintMaxLines = 1,
            images = images,
            onRemoveImage = { id -> images = images.filterNot { it.ref.id == id } },
            attaching = attaching,
            attachEnabled = !attaching && !sending && images.size < INPUT_MAX_IMAGES,
            onAttach = intake.pick,
            sendLabel = if (sending) "Sending" else "Send to the coordinator about ${task.id}",
            sendEnabled = !sending && !attaching && (reply.text.isNotBlank() || images.isNotEmpty()),
            onSend = ::send,
            modifier = Modifier.fillMaxWidth(),
            fieldModifier = Modifier.heightIn(max = inputMaxHeight).contentReceiver(intake.receiver).semantics { contentDescription = "Message about ${task.id}" },
            keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences),
        )
        when {
            replyProblem != null -> Text(replyProblem.orEmpty(), style = TaskType.xs, color = colors.danger)
            sent -> Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("Sent. The answer appears in the chat.", style = TaskType.xs, color = colors.fgMuted)
                Text("Back to the chat", Modifier.clickableLink("Back to the chat", onDismiss).padding(vertical = 4.dp),
                    style = TaskType.xs.copy(textDecoration = androidx.compose.ui.text.style.TextDecoration.Underline), color = colors.fgMuted)
            }
        }
    }
}
