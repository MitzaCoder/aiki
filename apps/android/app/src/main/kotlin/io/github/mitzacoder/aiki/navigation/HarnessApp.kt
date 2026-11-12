package io.github.mitzacoder.aiki.navigation

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.saveable.rememberSaveableStateHolder
import androidx.compose.ui.Modifier
import androidx.compose.ui.Alignment
import androidx.compose.ui.text.style.TextOverflow
import io.github.mitzacoder.aiki.ui.components.*
import android.content.Context
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.compose.ui.window.DialogWindowProvider
import androidx.core.content.edit
import androidx.core.view.WindowCompat
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.github.mitzacoder.aiki.data.*
import io.github.mitzacoder.aiki.features.chat.*
import io.github.mitzacoder.aiki.features.panels.PanelsScreen
import io.github.mitzacoder.aiki.features.settings.*
import io.github.mitzacoder.aiki.features.notifications.HandleAppLink
import io.github.mitzacoder.aiki.features.notifications.PendingAppLink
import io.github.mitzacoder.aiki.features.notifications.ReportScreenPresence
import io.github.mitzacoder.aiki.features.refs.ProvideRefLinks
import io.github.mitzacoder.aiki.features.tasks.ProvideTaskLinks
import io.github.mitzacoder.aiki.features.tasks.TaskSheet
import io.github.mitzacoder.aiki.features.tasks.board.showsTasksBoard
import io.github.mitzacoder.aiki.features.tasks.rememberTasksView
import io.github.mitzacoder.aiki.features.terminal.TerminalScreen
import io.github.mitzacoder.aiki.features.usage.UsageScreen
import io.github.mitzacoder.aiki.ui.theme.Jarvis
import kotlinx.coroutines.launch

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun HarnessApp(
    repository: HarnessRepository,
    connectPayload: String? = null,
    onConnectHandled: () -> Unit = {},
    pendingLink: PendingAppLink? = null,
    onLinkHandled: () -> Unit = {},
) {
    var stack by rememberSaveable { mutableStateOf(listOf(wireJson.encodeToString(Destination.serializer(), Destination.Home))) }
    val current = remember(stack) { wireJson.decodeFromString(Destination.serializer(), stack.last()) }
    val scope = rememberCoroutineScope()
    val screenState = rememberSaveableStateHolder()
    // Panel content moves between a Dialog and the tablet Row. An explicit registry key
    // preserves editors across Activity recreation even though those call sites differ.
    val panelState = rememberSaveableStateHolder()
    val drawer = rememberDrawerState(DrawerValue.Closed)
    val sessions by repository.sessions.collectAsStateWithLifecycle()
    val loaded by repository.loaded.collectAsStateWithLifecycle()
    // Wide screens keep the projects sidebar open beside the chat (web: 64rem and up); its rail state is remembered.
    val navPreferences = LocalContext.current.let { remember(it) { it.getSharedPreferences(PROJECTS_NAV_PREFERENCES, Context.MODE_PRIVATE) } }
    var sidebarCollapsed by remember { mutableStateOf(navPreferences.getBoolean("collapsed", false)) }
    var wideNav by remember { mutableStateOf(false) }
    // The ID a link named that no backend here has (web: the "Unknown backend" page), shown atop the drawer until it
    // closes, the user dismisses it or goes somewhere.
    var unknownBackend by remember { mutableStateOf<String?>(null) }
    fun pop() { if (stack.size > 1) stack = stack.dropLast(1) }
    val navigate: (Destination) -> Unit = { next ->
        val encoded = wireJson.encodeToString(Destination.serializer(), next)
        if (stack.last() != encoded) {
            // Panels are a presentation of their chat, not another nested chat/navigation stack.
            val base = if (current is Destination.Panel && next is Destination.Panel) stack.dropLast(1) else stack
            stack = (base + encoded).takeLast(30)
        }
        unknownBackend = null
        scope.launch { drawer.close() }
    }
    // Settings screens swap themselves on a wide screen (list and section share it) and go "up" on a phone, popping when the
    // screen above is where we came from.
    val replaceTop: (Destination) -> Unit = { next ->
        val encoded = wireJson.encodeToString(Destination.serializer(), next)
        if (stack.last() != encoded) stack = (if (stack.size > 1) stack.dropLast(1) else stack) + encoded
        unknownBackend = null
    }
    val goUp: (Destination) -> Unit = { target ->
        val encoded = wireJson.encodeToString(Destination.serializer(), target)
        if (stack.size > 1 && stack[stack.lastIndex - 1] == encoded) pop() else replaceTop(target)
    }
    val settingsNavigator = SettingsNavigator(navigate, replaceTop, goUp)
    io.github.mitzacoder.aiki.features.chat.ShareConversationDialog(repository, navigate)
    LaunchedEffect(connectPayload) { if (connectPayload != null) navigate(Destination.Settings(GeneralPage(GeneralSection.Backends))) }
    HandleAppLink(pendingLink, loaded, sessions.map { it.config }, navigate, onUnknownBackend = { id ->
        // A phone's panel or a task sheet would cover the drawer: back to their chat first.
        val uncovered = stack.dropLastWhile { wireJson.decodeFromString(Destination.serializer(), it).let { open -> open is Destination.Panel || open is Destination.Task } }
        if (uncovered.isNotEmpty()) stack = uncovered
        unknownBackend = id
        if (wideNav) sidebarCollapsed = false else scope.launch { drawer.open() }
    }, onLinkHandled)
    LaunchedEffect(drawer.targetValue) { if (drawer.targetValue == DrawerValue.Closed && !wideNav) unknownBackend = null }
    BackHandler(drawer.isOpen || stack.size > 1) {
        if (drawer.isOpen) scope.launch { drawer.close() } else pop()
    }
    val chat = current.chatRoute()
    ReportScreenPresence(chat?.backendKey, chat?.projectId)
    val backend = sessions.firstOrNull { it.config.key == chat?.backendKey }
    val terminal = current as? Destination.Terminal
    val highlight = (current as? Destination.Chat)?.highlight
    val context = if (backend != null && chat != null) ProjectScreenContext(repository, backend, chat, navigate, highlight = highlight) else null
    // A task sheet opened from a panel keeps the panel under it, so closing the sheet returns to the panel as it was.
    val panelUnderTask = (current as? Destination.Task)?.let { task ->
        panelBehindTask(stack.dropLast(1).map { wireJson.decodeFromString(Destination.serializer(), it) }, task)
    }
    val panel = current as? Destination.Panel ?: panelUnderTask
    val latestPanelContext by rememberUpdatedState(context)
    val latestPanelTab by rememberUpdatedState(panel?.tab ?: PanelTab.Info)
    // A side panel beside the chat can expand over it (web ⤢); closing the panel collapses it again.
    var panelExpanded by rememberSaveable { mutableStateOf(false) }
    LaunchedEffect(panel == null) { if (panel == null) panelExpanded = false }
    var panelExpandable by remember { mutableStateOf(false) }
    // One stable composition identity regardless of which adaptive parent hosts it.
    val panelBody = remember {
        movableContentOf<Modifier> { panelModifier ->
            latestPanelContext?.let { currentContext ->
                panelState.SaveableStateProvider(currentContext.route.screenStateKey()) {
                    PanelSurface(
                        currentContext, latestPanelTab, ::pop, panelModifier,
                        expanded = panelExpanded, toggleExpanded = if (panelExpandable) ({ panelExpanded = !panelExpanded }) else null,
                    )
                }
            }
        }
    }
    val tabs = if (backend != null) rememberPanelTabs(backend.client) else emptyList()
    BoxWithConstraints(Modifier.fillMaxSize()) {
    val wide = maxWidth >= 1024.dp
    SideEffect { wideNav = wide }
    LaunchedEffect(wide) { if (wide) drawer.snapTo(DrawerValue.Closed) }
    ModalNavigationDrawer(drawerState = drawer, gesturesEnabled = !wide || drawer.isOpen, drawerContent = { if (!wide) ProjectsDrawer(repository, current, navigate, unknownBackend) { unknownBackend = null } }) {
        Row(Modifier.fillMaxSize()) {
        if (wide) ProjectsSidebar(repository, current, navigate, sidebarCollapsed, toggleCollapsed = {
            sidebarCollapsed = !sidebarCollapsed
            navPreferences.edit { putBoolean("collapsed", sidebarCollapsed) }
        }, unknownBackend = unknownBackend, dismissUnknownBackend = { unknownBackend = null })
        // Task and ref links reach the chat, the panels and the task sheet, which all sit inside.
        ProvideTaskLinks(context) { ProvideRefLinks(context) {
        BoxWithConstraints(Modifier.weight(1f).fillMaxHeight()) {
            val sideBySide = panel != null && maxWidth >= 840.dp && context != null
            val visibleContext = context?.copy(activePanel = if (sideBySide) resolvedPanelTab(panel.tab, tabs) else null)
            // The Tasks board takes the full width over the chat, not the side panel's.
            val boardWide = sideBySide && showsTasksBoard(visibleContext!!, visibleContext.activePanel)
            val panelWide = boardWide || (sideBySide && panelExpanded)
            SideEffect { panelExpandable = sideBySide && !boardWide }
            // The header's row follows the chat column, which narrows while a panel sits beside it.
            val chatWidth = if (sideBySide && !panelWide) maxWidth - 401.dp else maxWidth
            Row(Modifier.fillMaxSize()) {
                Scaffold(
                    modifier = Modifier.weight(1f),
                    topBar = {
                        // The terminal screen draws its own header: Sessions, the connection and the tabs belong to it.
                        if (terminal == null) TopAppBar(
                            title = {
                                if (current is Destination.Settings) Text("Settings")
                                else if (current is Destination.ProjectSettings) Text("Project settings")
                                else if (context != null) ProjectHeaderTitle(context, chatWidth)
                                else Text(if (current == Destination.Usage) "Usage" else "Aiki")
                            },
                            navigationIcon = {
                                if (!wide) JarvisIconButton(Lucide.Menu, "Open projects", onClick = { scope.launch { drawer.open() } })
                            },
                            actions = {
                                val chatRoute = current is Destination.Chat || current is Destination.Panel || current is Destination.Task
                                if (stack.size > 1 && !chatRoute) JarvisIconButton(Lucide.ArrowLeft, "Back", onClick = ::pop)
                                if (context != null && chatRoute) ProjectHeaderActions(context, panel, chatWidth, ::pop)
                            },
                        )
                    },
                ) { padding ->
                    val modifier = Modifier.fillMaxSize().padding(padding)
                    if (!loaded) Box(modifier) { CircularProgressIndicator() }
                    else screenState.SaveableStateProvider(current.screenStateKey()) {
                        when (current) {
                            Destination.Home -> ProjectsHome(repository, navigate, modifier)
                            Destination.Usage -> UsageScreen(repository, modifier)
                            is Destination.Settings -> GeneralSettingsScreen(repository, current.page, settingsNavigator, navigate, connectPayload, onConnectHandled, modifier)
                            is Destination.ProjectSettings -> if (context != null) ProjectSettingsScreen(context, current.section, current.scheduleId, settingsNavigator, modifier) else MissingBackend(modifier)
                            is Destination.Chat, is Destination.Panel, is Destination.Task -> if (context != null) ChatScreen(visibleContext!!, modifier) else MissingBackend(modifier)
                            is Destination.Artifact -> if (context != null) ArtifactScreen(context, current.artifactId, modifier) else MissingBackend(modifier)
                            is Destination.Terminal -> sessions.firstOrNull { it.config.key == current.backendKey }
                                ?.let { TerminalScreen(it, current, onBack = ::pop, modifier = modifier) } ?: MissingBackend(modifier)
                        }
                    }
                }
                if (sideBySide && !panelWide) {
                    VerticalDivider(Modifier.fillMaxHeight())
                    panelBody(Modifier.width(400.dp).fillMaxHeight())
                }
            }
            if (panelWide) Surface(Modifier.fillMaxSize()) { panelBody(Modifier.fillMaxSize()) }
            if (panel != null && !sideBySide && context != null) {
                // Fullscreen phone sheet: explicit opening only, back/dismiss returns to the same chat/watch.
                Dialog(onDismissRequest = ::pop, properties = DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false)) {
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
                    panelBody(Modifier.fillMaxSize())
                }
            }
            // After the panel's dialog, so the sheet opens over it.
            if (current is Destination.Task && context != null) TaskSheet(context, current.taskId, onDismiss = ::pop)
        }
        } }
        }
    }
    }
}

/** SharedPreferences holding the projects sidebar's rail state (web `aiki.projects-nav.v1`). */
private const val PROJECTS_NAV_PREFERENCES = io.github.mitzacoder.aiki.BuildConfig.PREFERENCES_PREFIX + ".projects-nav.v1"

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun PanelSurface(
    context: ProjectScreenContext,
    initialTab: PanelTab,
    close: () -> Unit,
    modifier: Modifier,
    expanded: Boolean = false,
    toggleExpanded: (() -> Unit)? = null,
) {
    val title = io.github.mitzacoder.aiki.features.panels.panelTabLabel(initialTab, rememberTasksView(context.backend.client))
    Scaffold(modifier.semantics { contentDescription = title }, topBar = {
        TopAppBar(title = { Text(title) }, navigationIcon = {
            JarvisIconButton(Lucide.X, "Close panels", onClick = close)
        }, actions = {
            // Beside the chat only: a phone's panel and the Tasks board already take the whole width.
            toggleExpanded?.let {
                JarvisIconButton(
                    if (expanded) NavGlyphs.Minimize2 else NavGlyphs.Maximize2,
                    if (expanded) "Collapse the sidebar" else "Expand the sidebar",
                    onClick = it,
                )
            }
        })
    }) { padding -> PanelsScreen(context, initialTab, Modifier.fillMaxSize().padding(padding)) }
}

@Composable private fun MissingBackend(modifier: Modifier) { Text("This backend was removed. Choose a project from the drawer.", modifier) }
