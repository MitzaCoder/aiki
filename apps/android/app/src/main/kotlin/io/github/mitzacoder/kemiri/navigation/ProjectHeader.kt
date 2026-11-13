package io.github.mitzacoder.kemiri.navigation

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.github.mitzacoder.kemiri.data.*
import io.github.mitzacoder.kemiri.features.settings.ConnectionBadge
import io.github.mitzacoder.kemiri.features.status.ReleaseLine
import io.github.mitzacoder.kemiri.features.status.SERVER_STATUS_FEATURE
import io.github.mitzacoder.kemiri.features.status.StatusGlyphs
import io.github.mitzacoder.kemiri.protocol.*
import io.github.mitzacoder.kemiri.ui.components.*
import io.github.mitzacoder.kemiri.ui.theme.Jarvis
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch

/**
 * The chat's top bar, the twin of the web's `ProjectChat` header: the project's name over a meta line (backend ·
 * coordinator model · running tool · release), Tasks with its count always in the row, and Background,
 * Info, Memory, the mute bell and Settings beside them on a wide screen or in a "⋯" menu on a phone. The menu carries a
 * dot in the connection's tone when it is not connected, the connection badge and the release.
 */

/**
 * The header's mute bell, provided by the notifications feature (track F) around the app. Null, or a null [muted] flow
 * for a backend, hides the bell.
 */
interface ProjectMute {
    /** Whether this device has [projectId] muted; null when [backend] cannot push to this device. */
    fun muted(backend: BackendSession, projectId: String): StateFlow<Boolean>?
    suspend fun toggle(backend: BackendSession, projectId: String)
}

val LocalProjectMute = staticCompositionLocalOf<ProjectMute?> { null }

/** One control in the header: a panel tab or a utility (mute, settings). */
private data class HeaderAction(
    val id: String,
    /** What it is called, count included, for accessibility. */
    val name: String,
    val label: String,
    val icon: LucideIcon,
    val count: String? = null,
    /** Tasks stays in the row on a phone. */
    val primary: Boolean = false,
    val pressed: Boolean = false,
    val onClick: () -> Unit,
)

/** Where the header's row is wide enough for every control (a tablet, or a phone in landscape). */
private val INLINE_HEADER_WIDTH: Dp = 600.dp
/** Where Tasks also shows its label. */
private val PRIMARY_LABELS_HEADER_WIDTH: Dp = 720.dp
/** Where every panel button shows its label. */
private val LABELLED_HEADER_WIDTH: Dp = 960.dp

enum class ConnectionTone { Ok, Warn, Error, Muted }

fun connectionTone(status: ConnectionStatus): ConnectionTone = when (status) {
    ConnectionStatus.Ready -> ConnectionTone.Ok
    ConnectionStatus.Connecting, ConnectionStatus.Reconnecting -> ConnectionTone.Warn
    ConnectionStatus.Closed -> ConnectionTone.Error
    ConnectionStatus.Idle -> ConnectionTone.Muted
}

private fun threadOf(id: String?): String = id?.ifBlank { null } ?: MAIN_THREAD_ID

/** A model as it reads: its catalog name, else provider/id, "No model" when none is chosen (web `modelLabel`). */
fun modelLabel(model: ModelRef?, models: List<ModelInfo>): String {
    if (model == null) return "No model"
    return models.firstOrNull { it.provider == model.provider && it.modelId == model.modelId }?.name ?: "${model.provider}/${model.modelId}"
}

/** A list the backend pushes whole (`workers.state`, `threads.state`), read on connect and replaced by each push. */
@Composable
private fun <T> rememberPushedList(client: HarnessClient, key: Any, enabled: Boolean, pushed: (ProtocolEvent) -> List<T>?, read: suspend () -> List<T>): List<T> {
    var items by remember(client, key) { mutableStateOf(emptyList<T>()) }
    val ready = client.state.collectAsStateWithLifecycle().value.status == ConnectionStatus.Ready
    LaunchedEffect(client, key, enabled, ready) {
        if (!enabled || !ready) return@LaunchedEffect
        var pushes = 0
        launch(start = CoroutineStart.UNDISPATCHED) { client.events.collect { event -> pushed(event)?.let { pushes++; items = it } } }
        val before = pushes
        try { read().let { if (pushes == before) items = it } }
        catch (error: CancellationException) { throw error }
        catch (_: Exception) { /* The counts stay as they were; the panels show the error. */ }
    }
    return items
}

/**
 * The chat's title and the line under it (web `ProjectChat` / `WorkerTranscript` headers). Main: the project's name over
 * backend · coordinator model · running tool. A thread: a back arrow, its title (and status on a wide screen) over
 * "Background thread of main · project · model · what it does now". A worker: a back arrow, its title over "id · project".
 * The line ends in amber with the connection's state while it is not connected.
 */
@Composable
fun ProjectHeaderTitle(context: ProjectScreenContext, width: Dp) {
    val backend = context.backend
    val route = context.route
    val client = backend.client
    val projects by backend.projects.collectAsStateWithLifecycle()
    val models by backend.models.collectAsStateWithLifecycle()
    val connection by client.state.collectAsStateWithLifecycle()
    val status by backend.serverStatus.status.collectAsStateWithLifecycle()
    val project = projects.firstOrNull { it.id == route.projectId }
    var now by remember { mutableLongStateOf(System.currentTimeMillis()) }
    LaunchedEffect(Unit) { while (true) { delay(15_000); now = System.currentTimeMillis() } }
    val thread = threadOf(route.threadId) != MAIN_THREAD_ID
    val workers = rememberPushedList(client, route.projectId, route.workerId != null && connection.supports("workers"),
        pushed = { (it as? WorkersStateEvent)?.takeIf { event -> event.projectId == route.projectId }?.workers },
        read = { client.request(WorkersListRequest(projectId = route.projectId)).workers })
    val threads = rememberPushedList(client, route.projectId, thread && route.workerId == null && connection.supports("threads"),
        pushed = { (it as? ThreadsStateEvent)?.takeIf { event -> event.projectId == route.projectId }?.threads },
        read = { client.request(ThreadsListRequest(projectId = route.projectId, includeArchived = true)).threads })
    val worker = route.workerId?.let { id -> workers.firstOrNull { it.id == id && threadOf(it.threadId) == threadOf(route.threadId) } }
    val threadSummary = if (thread) threads.firstOrNull { it.id == route.threadId } else null
    val title = when {
        route.workerId != null -> worker?.title?.ifBlank { null } ?: route.workerId
        thread -> threadSummary?.title?.ifBlank { null } ?: route.threadId.orEmpty()
        else -> project?.name ?: "Project"
    }
    val meta = buildList {
        when {
            route.workerId != null -> { add(route.workerId); project?.let { add(it.name) } }
            thread -> {
                add("Background thread of main" + (project?.let { " · ${it.name}" } ?: ""))
                threadSummary?.model?.let { add(modelLabel(it, models)) }
                threadSummary?.let { add(io.github.mitzacoder.kemiri.features.panels.threadActivity(it)) }
            }
            else -> {
                add(backend.config.name)
                project?.let { add(modelLabel(it.coordinator.model, models)) }
                project?.activity?.runningTool?.let { tool ->
                    val elapsed = elapsedFor(tool.startedAt, now)
                    add("Running ${tool.name}${if (elapsed.isNotEmpty()) " · $elapsed" else ""}")
                }
            }
        }
    }
    val away = connectionAwayWord(connection.status)
    Row(verticalAlignment = Alignment.CenterVertically) {
        if (route.workerId != null || thread) {
            val back = if (route.workerId != null) (if (thread) "Back to the thread" else "Back to the coordinator") else "Back to main"
            IconButton(onClick = { context.navigate(if (route.workerId != null) route.copy(workerId = null) else route.copy(threadId = null, workerId = null)) },
                modifier = Modifier.size(40.dp).semantics { contentDescription = back }) { LucideGlyph(Lucide.ArrowLeft, size = 18.dp) }
        }
        Column(Modifier.weight(1f, fill = false)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(title, Modifier.weight(1f, fill = false), style = MaterialTheme.typography.titleMedium, maxLines = 1, overflow = TextOverflow.Ellipsis)
                if (width >= INLINE_HEADER_WIDTH) threadSummary?.let { StatusBadge(it.status, domain = "thread") }
            }
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                Text(meta.joinToString(" · "), Modifier.weight(1f, fill = false), style = MaterialTheme.typography.bodySmall, color = Jarvis.colors.fgSubtle,
                    maxLines = 1, overflow = TextOverflow.Ellipsis)
                // The release is in the menu on a phone, so the line stays one line; a tablet has room for it here.
                if (route.workerId == null && width >= INLINE_HEADER_WIDTH && connection.supports(SERVER_STATUS_FEATURE) && status != null) {
                    Text("·", style = MaterialTheme.typography.bodySmall, color = Jarvis.colors.fgSubtle)
                    ReleaseLine(status, compact = true)
                }
                if (away != null) {
                    Text("·", style = MaterialTheme.typography.bodySmall, color = Jarvis.colors.fgSubtle)
                    Text(away, style = MaterialTheme.typography.bodySmall, color = Jarvis.colors.warning, maxLines = 1)
                }
            }
        }
    }
}

/** The word the header's line ends with while the backend is not connected (web: the transcript's state, in amber). */
fun connectionAwayWord(status: ConnectionStatus): String? = when (status) {
    ConnectionStatus.Ready -> null
    ConnectionStatus.Idle, ConnectionStatus.Connecting -> "connecting"
    ConnectionStatus.Reconnecting -> "reconnecting"
    ConnectionStatus.Closed -> "stopped"
}

/**
 * The header's controls for a project route. [panel] is the open panel (a toggle closes it on a tablet); [width] is the
 * chat column's width, which decides between the inline row and the phone's menu.
 */
@Composable
fun RowScope.ProjectHeaderActions(context: ProjectScreenContext, panel: Destination.Panel?, width: Dp, close: () -> Unit) {
    val backend = context.backend
    val route = context.route
    val client = backend.client
    val connection by client.state.collectAsStateWithLifecycle()
    val tabs = rememberPanelTabs(client)
    val main = threadOf(route.threadId) == MAIN_THREAD_ID && route.workerId == null
    val board by context.board.view.collectAsStateWithLifecycle()
    val workers = rememberPushedList(client, route.projectId, route.workerId != null && connection.supports("workers"),
        pushed = { (it as? WorkersStateEvent)?.takeIf { event -> event.projectId == route.projectId }?.workers },
        read = { client.request(WorkersListRequest(projectId = route.projectId)).workers })
    val threads = rememberPushedList(client, route.projectId, PanelTab.Threads in tabs && main,
        pushed = { (it as? ThreadsStateEvent)?.takeIf { event -> event.projectId == route.projectId }?.threads },
        read = { client.request(ThreadsListRequest(projectId = route.projectId)).threads })
    val mute = LocalProjectMute.current
    // Asked again on every connection: whether the bell shows depends on what the backend supports.
    val mutedFlow = remember(mute, backend, route.projectId, connection.hello) { mute?.muted(backend, route.projectId) }
    val muted = mutedFlow?.collectAsStateWithLifecycle()?.value
    val scope = rememberCoroutineScope()
    val status by backend.serverStatus.status.collectAsStateWithLifecycle()

    fun toggle(tab: PanelTab) { if (panel?.tab == tab) close() else context.navigate(Destination.Panel(route, tab)) }
    val questions = board.openQuestionCount.toLong()
    val background = activeBackgroundCount(threads)
    val tasksName = if (connection.supports(HarnessFeature.TASK_REPORTS)) "Tasks" else "Board"
    // A worker's page offers what reads its transcript: its context and memory (web `WorkerTranscript`).
    val worker = route.workerId != null
    val actions = buildList {
        if (PanelTab.Board in tabs && !worker) add(HeaderAction("board", tasksName + if (questions > 0) " (${questionsWaitingLabel(questions)})" else "", tasksName,
            StatusGlyphs.ClipboardList, questionBadgeText(questions), primary = true, pressed = panel?.tab == PanelTab.Board) { toggle(PanelTab.Board) })
        if (PanelTab.Threads in tabs && main) add(HeaderAction("background", "Background" + if (background > 0) " ($background running)" else "", "Background",
            Lucide.Layers, background.takeIf { it > 0 }?.toString(), pressed = panel?.tab == PanelTab.Threads) { toggle(PanelTab.Threads) })
        if (PanelTab.Info in tabs) add(HeaderAction("info", if (worker) "This worker's context" else "Conversation info", "Info", Lucide.Info, pressed = panel?.tab == PanelTab.Info) { toggle(PanelTab.Info) })
        if (PanelTab.Memory in tabs) add(HeaderAction("memory", "Memory", "Memory", StatusGlyphs.BookOpen, pressed = panel?.tab == PanelTab.Memory) { toggle(PanelTab.Memory) })
        // A shell on this backend in the project's folder (a worker's page: in its workspace), on a screen of its own.
        if (connection.supports(HarnessFeature.TERMINAL)) {
            val workspace = route.workerId?.let { id -> workers.firstOrNull { it.id == id }?.workspacePath }
            add(HeaderAction("terminal", if (worker && workspace != null) "Open a terminal in this worker's workspace" else if (worker) "Open a terminal in the project folder" else "A terminal on this backend, in the project folder",
                "Terminal", Lucide.Terminal) { context.navigate(Destination.Terminal(backend.config.key, route.projectId, route.workerId)) })
        }
        if (mute != null && muted != null && !worker) add(HeaderAction("mute", if (muted) "Unmute notifications for this project" else "Mute notifications for this project",
            if (muted) "Unmute notifications" else "Mute notifications", if (muted) StatusGlyphs.BellOff else StatusGlyphs.Bell, pressed = muted) {
            scope.launch { mute.toggle(backend, route.projectId) }
        })
        if (!worker) add(HeaderAction("settings", "Project settings", "Project settings", Lucide.Settings2) { context.navigate(Destination.ProjectSettings(route)) })
    }
    val inline = width >= INLINE_HEADER_WIDTH
    val labelled = width >= LABELLED_HEADER_WIDTH
    val primaryLabelled = width >= PRIMARY_LABELS_HEADER_WIDTH
    val tone = connectionTone(connection.status)
    if (inline) {
        // The mute bell and the gear stay icons at every width, as on the web.
        actions.forEach { HeaderButton(it, showLabel = it.id !in setOf("mute", "settings") && (labelled || (primaryLabelled && it.primary))) }
        Box(Modifier.padding(horizontal = 4.dp)) { ConnectionBadge(connection.status, connection.attempt) }
        return
    }
    actions.filter { it.primary }.forEach { HeaderButton(it, showLabel = false) }
    var menu by remember { mutableStateOf(false) }
    Box {
        IconButton(onClick = { menu = true }, modifier = Modifier.semantics { contentDescription = "More actions" + if (tone != ConnectionTone.Ok) ", ${connection.status.name.lowercase()}" else "" }) {
            Box {
                LucideGlyph(Lucide.MoreHorizontal, size = 20.dp)
                if (tone != ConnectionTone.Ok) Box(Modifier.align(Alignment.TopEnd).offset(x = 3.dp, y = (-3).dp).size(7.dp).background(toneColor(tone), CircleShape))
            }
        }
        DropdownMenu(menu, { menu = false }) {
            actions.filterNot { it.primary }.forEach { action ->
                DropdownMenuItem(
                    text = { Text(action.label + (action.count?.let { " · $it" } ?: "")) },
                    leadingIcon = { LucideGlyph(action.icon, size = 18.dp) },
                    trailingIcon = if (action.pressed && action.id != "mute") ({ LucideGlyph(Lucide.Check, size = 16.dp) }) else null,
                    onClick = { menu = false; action.onClick() },
                    modifier = Modifier.semantics { contentDescription = action.name },
                )
            }
            HorizontalDivider(Modifier.padding(vertical = 4.dp))
            Column(Modifier.padding(horizontal = 12.dp, vertical = 4.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                ConnectionBadge(connection.status, connection.attempt)
                if (connection.supports(SERVER_STATUS_FEATURE)) ReleaseLine(status, compact = true)
            }
        }
    }
}

@Composable
private fun toneColor(tone: ConnectionTone): Color = when (tone) {
    ConnectionTone.Ok -> Jarvis.colors.success
    ConnectionTone.Warn -> Jarvis.colors.warning
    ConnectionTone.Error -> Jarvis.colors.danger
    ConnectionTone.Muted -> Jarvis.colors.fgSubtle
}

@Composable
private fun HeaderButton(action: HeaderAction, showLabel: Boolean) {
    val colors = Jarvis.colors
    val tint = if (action.pressed) colors.fg else colors.fgMuted
    val badge: @Composable BoxScope.() -> Unit = {
        action.count?.let { Badge(containerColor = if (action.primary && action.id == "board") MaterialTheme.colorScheme.primary else colors.accent2, contentColor = Color.White) { Text(it) } }
    }
    if (showLabel) {
        TextButton(onClick = action.onClick, modifier = Modifier.semantics { contentDescription = action.name },
            colors = ButtonDefaults.textButtonColors(contentColor = tint, containerColor = if (action.pressed) colors.surface2 else Color.Transparent)) {
            LucideGlyph(action.icon, size = 18.dp)
            Spacer(Modifier.width(6.dp))
            Text(action.label)
            action.count?.let { Spacer(Modifier.width(6.dp)); Badge(containerColor = if (action.id == "board") MaterialTheme.colorScheme.primary else colors.accent2, contentColor = Color.White) { Text(it) } }
        }
    } else {
        IconButton(onClick = action.onClick, modifier = Modifier.semantics { contentDescription = action.name },
            colors = IconButtonDefaults.iconButtonColors(containerColor = if (action.pressed) colors.surface2 else Color.Transparent)) {
            BadgedBox(badge = badge) { LucideGlyph(action.icon, size = 20.dp, tint = tint) }
        }
    }
}
