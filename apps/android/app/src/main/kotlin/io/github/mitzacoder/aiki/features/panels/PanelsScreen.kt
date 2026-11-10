package io.github.mitzacoder.aiki.features.panels

import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.relocation.BringIntoViewRequester
import androidx.compose.foundation.relocation.bringIntoViewRequester
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.Alignment
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.semantics.*
import androidx.compose.foundation.clickable
import androidx.compose.ui.draw.alpha
import kotlinx.coroutines.launch
import androidx.compose.runtime.saveable.rememberSaveable
import io.github.mitzacoder.aiki.ui.components.*
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.github.mitzacoder.aiki.data.*
import io.github.mitzacoder.aiki.features.tasks.board.TasksView
import io.github.mitzacoder.aiki.navigation.*
import io.github.mitzacoder.aiki.protocol.*
import io.github.mitzacoder.aiki.features.tasks.QuestionCard
import io.github.mitzacoder.aiki.features.tasks.TaskEditor
import io.github.mitzacoder.aiki.features.tasks.TasksPanel
import io.github.mitzacoder.aiki.features.tasks.questionAskedBy
import io.github.mitzacoder.aiki.features.tasks.questionTaskLabel
import io.github.mitzacoder.aiki.features.tasks.rememberTasksView

@Composable
fun PanelsScreen(context: ProjectScreenContext, initialTab: PanelTab = PanelTab.Info, modifier: Modifier = Modifier) {
    val connection by context.backend.client.state.collectAsStateWithLifecycle()
    // Keep the last hello through reconnect: a temporary offline state must not close an editor.
    val tabs = rememberPanelTabs(context.backend.client).filter { it != PanelTab.Threads || (normalizedThread(context.route.threadId) == "main" && context.route.workerId == null) }.sortedBy { panelTabOrder.indexOf(it) }
    val active = resolvedPanelTab(initialTab, tabs)
    val project = context.route.projectId
    val counts = if (PanelTab.Threads in tabs) panelData(context, "tab-counts", { it is ThreadsStateEvent && it.projectId == project }) {
        context.backend.client.request(ThreadsListRequest(projectId = project)).threads
    }.value else null
    // The shared board's open questions, for the Board/Tasks tab's badge.
    val board by context.board.view.collectAsStateWithLifecycle()
    val tasksView = rememberTasksView(context.backend.client)
    Column(modifier.padding(horizontal = 12.dp)) {
        BoxWithConstraints(Modifier.fillMaxWidth()) {
            val labels = panelVisibleLabels(maxWidth.value, tabs, active, tasksView)
            Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()), verticalAlignment = Alignment.CenterVertically) {
            tabs.forEach { tab ->
                val count = when (tab) {
                    PanelTab.Board -> board.questions.count { it.status == "open" && panelQuestionVisible(context.route.threadId, it.threadId) }
                    PanelTab.Threads -> counts.orEmpty().count { !it.main && it.status == "running" && !it.archived }
                    else -> 0
                }
                val selected = active == tab
                val bringIntoView = remember(tab) { BringIntoViewRequester() }
                LaunchedEffect(selected, labels) { if (selected) bringIntoView.bringIntoView() }
                Surface(onClick = { context.navigate(Destination.Panel(context.route, tab)) }, shape = MaterialTheme.shapes.medium,
                    color = if (selected) MaterialTheme.colorScheme.secondaryContainer else MaterialTheme.colorScheme.surface.copy(alpha = 0f),
                    modifier = Modifier.bringIntoViewRequester(bringIntoView).semantics { contentDescription = panelTabDescription(tab, count, tasksView); this.selected = selected; role = Role.Tab }) {
                    Row(Modifier.sizeIn(minWidth = 48.dp, minHeight = 48.dp).padding(horizontal = 12.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        BadgedBox(badge = { if (count > 0) PanelTabBadge(tab, count) }) { LucideGlyph(panelTabIcon(tab), size = 18.dp) }
                        if (tab in labels) Text(panelTabLabel(tab, tasksView), style = MaterialTheme.typography.labelMedium)
                    }
                }
            }
        }
        }
        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
        if (connection.status != ConnectionStatus.Ready) Text("Offline · showing last loaded data", color = MaterialTheme.colorScheme.error)
        key(context.backend.client, context.route, active) {
            when (active) {
                // The Tasks view (list or board) on a backend with task reports; older backends keep the old board.
                PanelTab.Board -> if (tasksView) TasksTab(context, Modifier.weight(1f)) else BoardPanel(context)
                PanelTab.Threads -> ThreadsPanel(context)
                PanelTab.Info -> InfoPanel(context)
                PanelTab.Memory -> MemoryPanel(context)
                PanelTab.Artifacts -> ArtifactsPanel(context)
                null -> Text("No panels advertised by this backend.")
            }
        }
    }
}

/**
 * The Tasks tab: the Tasks list or the board behind the List | Board switch. The board shows loose questions with the
 * list's question card and adds tasks with the list's editor.
 */
@Composable
private fun TasksTab(context: ProjectScreenContext, modifier: Modifier) {
    val view by context.board.view.collectAsStateWithLifecycle()
    val connection by context.backend.client.state.collectAsStateWithLifecycle()
    val project = context.route.projectId
    val threads = if (connection.supports("threads")) panelData(context, "task-threads", { it is ThreadsStateEvent && it.projectId == project }) {
        context.backend.client.request(ThreadsListRequest(projectId = project, includeArchived = true)).threads
    }.value.orEmpty() else emptyList()
    TasksView(
        context, modifier,
        looseQuestion = { question ->
            QuestionCard(
                context, question,
                askedBy = questionAskedBy(question, threads),
                taskLabel = questionTaskLabel(question, view::task),
                onOpenTask = question.taskId?.let { id -> { context.openTask(id) } },
            )
        },
        addTask = { close ->
            Dialog(onDismissRequest = close, properties = DialogProperties(usePlatformDefaultWidth = false)) {
                // The panel's own margin, which the editor expects around it.
                Surface(Modifier.fillMaxSize()) { TaskEditor(context, task = null, tasks = view.tasks, onBack = close, modifier = Modifier.fillMaxSize().padding(horizontal = 12.dp)) }
            }
        },
    ) { start -> TasksPanel(context, toolbarStart = start) }
}

/** A tab's count, coloured like the header's buttons: questions in the primary colour, running threads in the accent. */
@Composable private fun PanelTabBadge(tab: PanelTab, count: Int) {
    val colors = io.github.mitzacoder.aiki.ui.theme.Jarvis.colors
    Badge(containerColor = if (tab == PanelTab.Board) MaterialTheme.colorScheme.primary else colors.accent2,
        contentColor = if (tab != PanelTab.Board && colors.neutral) colors.bg else androidx.compose.ui.graphics.Color.White) { Text(if (count > 9) "9+" else count.toString()) }
}

/** Relative times in a panel move on while it is open. */
@Composable private fun rememberPanelNow(): Long {
    var now by remember { mutableLongStateOf(System.currentTimeMillis()) }
    LaunchedEffect(Unit) { while (true) { kotlinx.coroutines.delay(30_000); now = System.currentTimeMillis() } }
    return now
}

/** The schedules' titles by ID, so a thread or worker a schedule started says which one. */
@Composable private fun scheduleNames(context: ProjectScreenContext, key: String): (String) -> String? {
    val project = context.route.projectId
    val connection by context.backend.client.state.collectAsStateWithLifecycle()
    val schedules = if (connection.supports("schedules")) panelData(context, key, { it is SchedulesStateEvent && it.projectId == project }) {
        context.backend.client.request(SchedulesListRequest(projectId = project)).schedules
    }.value.orEmpty() else emptyList()
    return { id -> schedules.firstOrNull { it.id == id }?.title?.takeIf { it.isNotEmpty() } }
}

/**
 * Main's background threads (web `BackgroundPanel.svelte`): what each does now, its workers, tasks and questions, who
 * started it and when, with Stop (behind a confirmation), Archive or Restore, and Open; archived ones behind a toggle.
 */
@Composable internal fun ThreadsPanel(context: ProjectScreenContext) {
    var showArchived by rememberSaveable(context.route) { mutableStateOf(false) }
    val client = context.backend.client
    val project = context.route.projectId
    val data = panelData(context, showArchived, { it is ThreadsStateEvent && it.projectId == project }) {
        client.request(ThreadsListRequest(projectId = project, includeArchived = showArchived)).threads
    }
    val now = rememberPanelNow()
    val scheduleName = scheduleNames(context, "thread-schedules")
    val colors = io.github.mitzacoder.aiki.ui.theme.Jarvis.colors
    var stopping by remember { mutableStateOf<ThreadSummary?>(null) }
    var busy by remember { mutableStateOf<String?>(null) }
    var problem by remember { mutableStateOf<Pair<String, String>?>(null) }
    val scope = rememberCoroutineScope()
    fun act(thread: ThreadSummary, done: () -> Unit = {}, request: suspend () -> Unit) {
        busy = thread.id
        problem = null
        scope.launch {
            try { request(); done(); data.refresh.trySend(Unit) }
            catch (e: kotlinx.coroutines.CancellationException) { throw e }
            catch (e: Exception) { problem = thread.id to panelError(e) }
            finally { busy = null }
        }
    }
    Column {
        Text("Big jobs main handed off. They report back to main, which relays them; ask main to start, steer or stop one.",
            Modifier.padding(vertical = 8.dp), style = MaterialTheme.typography.bodySmall, color = colors.fgSubtle)
        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
        PanelBody(data) { threads ->
            val ordered = threads.filter { !it.main && it.id != "main" }.sortedWith(compareBy<ThreadSummary> { threadRank(it) }.thenByDescending { it.updatedAt })
            val live = ordered.filter { !it.archived }
            val archived = ordered.filter { it.archived }
            @Composable fun Row(thread: ThreadSummary) = key(thread.id) {
                ThreadRow(context, thread, now, scheduleName, busy == thread.id, problem?.takeIf { it.first == thread.id }?.second,
                    stop = { stopping = thread },
                    archive = { act(thread) { client.request(ThreadsArchiveRequest(projectId = project, threadId = thread.id, archived = !thread.archived)) } })
            }
            if (live.isEmpty()) Text("Nothing runs in the background. Main starts a thread when a job is big enough, or a schedule does.",
                style = MaterialTheme.typography.bodyMedium, color = colors.fgSubtle)
            live.forEach { Row(it) }
            TextButton(onClick = { showArchived = !showArchived }, modifier = Modifier.semantics { selected = showArchived }) {
                LucideGlyph(Lucide.Archive, size = 14.dp)
                Spacer(Modifier.width(6.dp))
                Text(if (showArchived) "Hide archived${if (archived.isNotEmpty()) " (${archived.size})" else ""}" else "Show archived", style = MaterialTheme.typography.labelMedium)
            }
            if (showArchived) {
                if (archived.isEmpty()) Text("No archived threads.", style = MaterialTheme.typography.bodySmall, color = colors.fgSubtle)
                archived.forEach { Row(it) }
            }
        }
    }
    stopping?.let { thread ->
        AlertDialog(onDismissRequest = { if (busy != thread.id) stopping = null }, title = { Text("Stop ${thread.title.ifEmpty { "this thread" }}?") }, text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("Its running turn and its workers are aborted, and it does no more work. Main keeps what it reported so far.")
                problem?.takeIf { it.first == thread.id }?.let { Text(it.second, color = MaterialTheme.colorScheme.error) }
            }
        }, confirmButton = {
            TextButton(enabled = busy != thread.id, colors = ButtonDefaults.textButtonColors(contentColor = MaterialTheme.colorScheme.error), onClick = {
                act(thread, done = { stopping = null }) { client.request(ThreadsStopRequest(projectId = project, threadId = thread.id)) }
            }) { Text("Stop") }
        }, dismissButton = { TextButton(enabled = busy != thread.id, onClick = { stopping = null }) { Text("Keep it running") } })
    }
}

/** One background thread: title and status, what it does now, its facts, who started it and when; then its actions. */
@Composable private fun ThreadRow(context: ProjectScreenContext, thread: ThreadSummary, now: Long, scheduleName: (String) -> String?, busy: Boolean, problem: String?, stop: () -> Unit, archive: () -> Unit) {
    val colors = io.github.mitzacoder.aiki.ui.theme.Jarvis.colors
    val open = { context.navigate(threadRoute(context.route, thread)) }
    val (time, timeTitle) = threadTimeText(thread, now)
    OutlinedCard(Modifier.fillMaxWidth().alpha(if (thread.archived) 0.75f else 1f), shape = MaterialTheme.shapes.medium,
        colors = CardDefaults.outlinedCardColors(containerColor = MaterialTheme.colorScheme.surfaceContainerLow)) {
        Column(Modifier.fillMaxWidth().clickable(onClickLabel = "Open ${thread.title}", onClick = open).padding(horizontal = 12.dp, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(thread.title.ifEmpty { thread.id }, Modifier.weight(1f), style = MaterialTheme.typography.titleSmall, maxLines = 1, overflow = TextOverflow.Ellipsis)
                StatusBadge(thread.status, domain = "thread")
                LucideGlyph(Lucide.ChevronRight, size = 14.dp, tint = colors.fgSubtle)
            }
            Text(threadActivity(thread), style = MaterialTheme.typography.bodySmall, maxLines = 2, overflow = TextOverflow.Ellipsis,
                color = if (thread.status == "failed") MaterialTheme.colorScheme.error else colors.fgMuted)
            val facts = listOfNotNull(
                openQuestionsText(thread.openQuestions)?.let { Triple(it, PanelIcons.CircleHelp, true) },
                runningWorkersText(thread.runningWorkers)?.let { Triple(it, PanelIcons.Bot, false) },
                ownedTasksText(thread.ownedTasks)?.let { Triple(it, PanelIcons.ClipboardList, false) },
            )
            if (facts.isNotEmpty()) FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                facts.forEach { (text, icon, needsYou) ->
                    Surface(shape = MaterialTheme.shapes.small, color = if (needsYou) colors.accent2.copy(alpha = 0.12f) else colors.surface2, contentColor = if (needsYou) colors.accent2 else colors.fgSubtle) {
                        Row(Modifier.padding(horizontal = 6.dp, vertical = 1.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                            LucideGlyph(icon, size = 12.dp)
                            Text(text, style = MaterialTheme.typography.labelSmall, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        }
                    }
                }
            }
            Row(Modifier.semantics(mergeDescendants = true) { contentDescription = "${threadStartedByText(thread, scheduleName)} · $time. $timeTitle" },
                verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                if (thread.startedBy == "schedule") LucideGlyph(io.github.mitzacoder.aiki.features.status.StatusGlyphs.CalendarClock, size = 12.dp, tint = colors.fgSubtle)
                Text("${threadStartedByText(thread, scheduleName)} · $time", style = MaterialTheme.typography.labelSmall, color = colors.fgSubtle, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
            thread.summary?.takeIf { it.isNotBlank() && thread.status == "done" }?.let { Detail("Report", it, markdown = true) }
        }
        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.6f))
        Row(Modifier.fillMaxWidth().padding(horizontal = 4.dp), verticalAlignment = Alignment.CenterVertically) {
            @Composable fun Small(label: String, icon: LucideIcon, enabled: Boolean = true, onClick: () -> Unit) =
                TextButton(onClick = onClick, enabled = enabled, contentPadding = PaddingValues(horizontal = 8.dp)) {
                    LucideGlyph(icon, size = 14.dp); Spacer(Modifier.width(6.dp)); Text(label, style = MaterialTheme.typography.labelMedium)
                }
            if (threadActive(thread)) Small("Stop", PanelIcons.CircleStop, onClick = stop)
            if (thread.archived) Small("Restore", PanelIcons.ArchiveRestore, enabled = !busy, onClick = archive)
            else if (!threadActive(thread)) Small("Archive", Lucide.Archive, enabled = !busy, onClick = archive)
            Spacer(Modifier.weight(1f))
            TextButton(onClick = open, contentPadding = PaddingValues(horizontal = 8.dp)) { Text("Open", style = MaterialTheme.typography.labelMedium, color = colors.fgMuted) }
        }
        problem?.let { Text(it, Modifier.padding(start = 12.dp, end = 12.dp, bottom = 6.dp), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error) }
    }
}

/**
 * The project's artifacts, newest first: from this conversation on a thread or worker page, else the whole project,
 * narrowed by kind with the web's chips (All 3 · Videos 2 · Image 1) once there is more than one kind.
 */
@Composable internal fun ArtifactsPanel(context: ProjectScreenContext) {
    val project = context.route.projectId
    val threadId = context.route.threadId
    val workerId = context.route.workerId
    val data = panelData(context, Unit, { it is ArtifactsChangedEvent && it.projectId == project }) {
        context.backend.client.request(ArtifactsListRequest(projectId = project, threadId = threadId, workerId = workerId)).artifacts
    }
    var kind by rememberSaveable(context.route) { mutableStateOf("all") }
    val all = data.value.orEmpty()
    val kinds = panelArtifactKinds(all)
    // A kind whose last artifact went away falls back to all.
    if (kind != "all" && data.value != null && kinds.none { it.first == kind }) kind = "all"
    val shown = remember(data) { PanelData<List<Artifact>>() }
    shown.value = data.value?.let { list -> if (kind == "all") list else list.filter { it.kind == kind } }
    shown.error = data.error
    shown.loading = data.loading
    LaunchedEffect(shown) { for (ask in shown.refresh) data.refresh.trySend(ask) }
    Column {
        if (kinds.size > 1) FlowRow(Modifier.fillMaxWidth().padding(top = 8.dp).semantics { contentDescription = "Filter by kind" }, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            FilterChip(kind == "all", { kind = "all" }, label = { Text("All ${all.size}") })
            kinds.forEach { (value, count) -> FilterChip(kind == value, { kind = value }, label = { Text("${panelArtifactKindLabel(value, count > 1)} $count") }) }
        }
        ArtifactTiles(context, shown)
    }
}
