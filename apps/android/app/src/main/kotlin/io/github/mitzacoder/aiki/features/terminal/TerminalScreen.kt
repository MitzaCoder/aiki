package io.github.mitzacoder.aiki.features.terminal

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalWindowInfo
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.github.mitzacoder.aiki.data.*
import io.github.mitzacoder.aiki.features.settings.ConnectionBadge
import io.github.mitzacoder.aiki.features.status.ToneBanner
import io.github.mitzacoder.aiki.navigation.Destination
import io.github.mitzacoder.aiki.protocol.*
import io.github.mitzacoder.aiki.ui.components.*
import io.github.mitzacoder.aiki.ui.theme.Jarvis
import io.github.mitzacoder.aiki.ui.theme.JarvisColors
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.withTimeoutOrNull

/** The width of the window in dp (a split screen or a rotation changes it). */
@Composable
private fun screenWidthDp(): Int = with(LocalDensity.current) { LocalWindowInfo.current.containerSize.width.toDp().value.toInt() }

/** The theme's tones as the terminal palette takes them (the web's `readTerminalTones`). */
fun terminalTones(colors: JarvisColors, primary: Color): TerminalTones {
    fun hex(color: Color) = "#%06x".format(color.toArgb() and 0xFFFFFF)
    return TerminalTones(
        bg = hex(colors.bg), fg = hex(colors.fg), fgMuted = hex(colors.fgMuted), fgSubtle = hex(colors.fgSubtle), surface2 = hex(colors.surface2),
        primary = hex(primary), danger = hex(colors.danger), success = hex(colors.success), warning = hex(colors.warning),
        accent1 = hex(colors.accent1), accent2 = hex(colors.accent2), accent3 = hex(colors.accent3), accent4 = hex(colors.accent4),
    )
}

/**
 * A backend's terminals as one screen (the web's `TerminalPage`): tabs for the sessions this device has attached, a list of
 * the backend's other sessions to attach or end, the phone's key bar and the terminals themselves. Arriving from a project
 * or one of its workers opens (or finds) that project's session in the right folder. The state lives in the backend's
 * [TerminalDeck], so a rotation keeps the sessions and their scrollback.
 */
@Composable
fun TerminalScreen(backend: BackendSession, route: Destination.Terminal, onBack: () -> Unit, modifier: Modifier = Modifier) {
    val context = LocalContext.current
    val client = backend.client
    val deck = remember(backend) { backend.terminals(context) }
    val deckState by deck.state.collectAsStateWithLifecycle()
    val connection by client.state.collectAsStateWithLifecycle()
    val projects by backend.projects.collectAsStateWithLifecycle()
    val colors = Jarvis.colors
    val primary = MaterialTheme.colorScheme.primary
    val widthDp = screenWidthDp()
    val input = remember(context) { TerminalInput(context, widthDp) }
    val supported = connection.supports(HarnessFeature.TERMINAL)
    val ready = connection.status == ConnectionStatus.Ready
    val project = route.projectId?.let { id -> projects.firstOrNull { it.id == id } }
    val link = remember(route) { TerminalLink(route.projectId, route.workerId, route.session) }
    var sessionsOpen by rememberSaveable { mutableStateOf(false) }
    var entered by remember { mutableStateOf(false) }

    val palette = remember(colors, primary) { terminalPalette(terminalTones(colors, primary), colors.dark) }
    SideEffect { deck.setPalette(palette) }
    DisposableEffect(deck) { onDispose { deck.leave() } }

    LaunchedEffect(ready, supported, link) {
        if (!ready || !supported) return@LaunchedEffect
        if (entered) { deck.refreshListing(); return@LaunchedEffect }
        // The folder a worker's terminal opens in is on the project's worker list, which is asked for once.
        val worker = if (route.workerId != null && route.projectId != null && connection.supports("workers")) {
            try {
                client.request(WorkersListRequest(projectId = route.projectId)).workers.firstOrNull { it.id == route.workerId }
                    ?.let { TerminalWorker(it.id, it.workspacePath) } ?: TerminalWorker(route.workerId, null)
            } catch (error: kotlinx.coroutines.CancellationException) { throw error }
            catch (_: Exception) { TerminalWorker(route.workerId, null) }
        } else route.workerId?.let { TerminalWorker(it, null) }
        // A link opened before the project list arrived would name no folder; wait a moment for it.
        val known = if (route.projectId == null) null else withTimeoutOrNull(3_000) { backend.projects.first { list -> list.any { it.id == route.projectId } } }
            ?.firstOrNull { it.id == route.projectId }
        deck.enter(link, known?.let { TerminalProject(it.name, it.path) }, worker)
        entered = true
    }

    val listing = deckState.listing
    val unavailable = listing != null && !listing.available
    val tabs = deckState.tabs
    val openSessions = remember(tabs) { tabs.mapNotNull { it.session }.toSet() }
    val otherSessions = listing?.sessions.orEmpty().filterNot { it.name in openSessions }
    val worker = route.workerId?.let { id -> TerminalWorker(id, null) }
    val target = terminalTarget(project?.let { TerminalProject(it.name, it.path) }, worker)
    val subtitle = if (project == null) backend.config.name else "${backend.config.name} · ${project.name}${route.workerId?.let { " · $it" } ?: ""}"

    Column(modifier.fillMaxSize().imePadding()) {
        TerminalHeader(
            subtitle = subtitle, otherSessions = otherSessions.size, status = connection.status, attempt = connection.attempt,
            onBack = onBack, onSessions = { sessionsOpen = true },
        )
        if (deckState.restored && !unavailable && tabs.isNotEmpty()) {
            TabStrip(tabs, deckState.activeId, onSelect = deck::select, onClose = deck::closeTab, onNew = { deck.newTab(target) })
        }
        if (listing?.available == true && !listing.survivesRestart) {
            ToneBanner(io.github.mitzacoder.aiki.features.status.BannerTone.Warning, Modifier.padding(8.dp)) {
                Text(
                    "Sessions on this backend end when it restarts: it cannot start them outside its own service. " +
                        if (listing.multiplexer == "none") "" else "Lingering for its user and systemd-run make them survive.",
                    style = MaterialTheme.typography.bodySmall,
                )
            }
        }
        deckState.endError?.let { message ->
            ToneBanner(io.github.mitzacoder.aiki.features.status.BannerTone.Error, Modifier.padding(8.dp)) { Text(message, style = MaterialTheme.typography.bodySmall) }
        }
        Box(Modifier.weight(1f).fillMaxWidth()) {
            when {
                !supported -> CenteredNotice("This backend has no terminals", "It is either older than the feature or has it turned off (AIKI_TERMINALS=off).")
                unavailable -> UnavailableCard(backend.config.name, listing.reason, onCheck = { deck.checkAgain() })
                deckState.listError != null && listing == null -> Box(Modifier.fillMaxSize().padding(16.dp), contentAlignment = Alignment.Center) {
                    ToneBanner(io.github.mitzacoder.aiki.features.status.BannerTone.Error) { Text(deckState.listError.orEmpty(), style = MaterialTheme.typography.bodyMedium) }
                }
                !deckState.restored -> Row(Modifier.fillMaxSize(), horizontalArrangement = Arrangement.Center, verticalAlignment = Alignment.CenterVertically) {
                    CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 2.dp)
                    Spacer(Modifier.width(8.dp))
                    Text(if (ready) "Looking for sessions…" else "Connecting…", style = MaterialTheme.typography.bodyMedium, color = colors.fgMuted)
                }
                tabs.isEmpty() -> EmptyState(backend.config.name, otherSessions.size, onNew = { deck.newTab(target) }, onSessions = { sessionsOpen = true })
                // Only the tab in front has a view. Every tab keeps its emulator (and so its screen and scrollback) in the deck,
                // and a view for another tab would sit over this one and take its touches.
                else -> tabs.firstOrNull { it.id == deckState.activeId }?.let { tab ->
                    key(tab.id) {
                        val live = deck.session(tab.id)
                        if (live != null) TerminalPane(
                            live, input = input, fontSp = input.fontSp,
                            onClose = { deck.closeTab(tab.id) }, onRestart = { deck.restartTab(tab.id, target) },
                        )
                    }
                }
            }
        }
        if (deckState.restored && !unavailable && tabs.isNotEmpty()) TerminalKeyBar(input)
    }
    if (sessionsOpen) SessionsSheet(
        backendName = backend.config.name, listing = listing, openSessions = openSessions,
        onDismiss = { sessionsOpen = false },
        onAttach = { name -> sessionsOpen = false; deck.attachSession(name) },
        onNew = { sessionsOpen = false; deck.newTab(target) },
        onEnd = { name -> deck.endSession(name) },
    )
}

@Composable
private fun TerminalHeader(subtitle: String, otherSessions: Int, status: ConnectionStatus, attempt: Int, onBack: () -> Unit, onSessions: () -> Unit) {
    val colors = Jarvis.colors
    Row(Modifier.fillMaxWidth().height(52.dp).padding(horizontal = 4.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(2.dp)) {
        JarvisIconButton(Lucide.ArrowLeft, "Back", onClick = onBack)
        LucideGlyph(Lucide.Terminal, size = 16.dp, tint = colors.fgMuted)
        Spacer(Modifier.width(4.dp))
        Column(Modifier.weight(1f)) {
            Text("Terminal", style = MaterialTheme.typography.titleMedium, maxLines = 1)
            Text(subtitle, style = MaterialTheme.typography.bodySmall, color = colors.fgSubtle, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        TextButton(onClick = onSessions, modifier = Modifier.semantics { contentDescription = "Sessions on this backend" }, contentPadding = PaddingValues(horizontal = 10.dp)) {
            LucideGlyph(TerminalGlyphs.List, size = 16.dp)
            if (screenWidthDp() >= 600) { Spacer(Modifier.width(6.dp)); Text("Sessions") }
            if (otherSessions > 0) {
                Spacer(Modifier.width(6.dp))
                Box(Modifier.defaultMinSize(minWidth = 16.dp, minHeight = 16.dp).background(colors.accent2, CircleShape).padding(horizontal = 4.dp), contentAlignment = Alignment.Center) {
                    Text(otherSessions.toString(), style = MaterialTheme.typography.labelSmall, color = Color.White)
                }
            }
        }
        // A narrow header keeps its room for the title; the chip shows when something is wrong.
        if (screenWidthDp() >= 600 || status != ConnectionStatus.Ready) {
            Box(Modifier.padding(end = 4.dp)) { ConnectionBadge(status, attempt) }
        }
    }
}

@Composable
private fun TabStrip(tabs: List<TerminalTab>, activeId: String?, onSelect: (String) -> Unit, onClose: (String) -> Unit, onNew: () -> Unit) {
    val colors = Jarvis.colors
    val scroll = rememberScrollState()
    // A tab that was just added is at the end: bring it into view.
    var count by remember { mutableIntStateOf(tabs.size) }
    LaunchedEffect(tabs.size) { if (tabs.size > count) scroll.animateScrollTo(scroll.maxValue); count = tabs.size }
    Row(
        Modifier.fillMaxWidth().background(if (colors.dark) colors.surface else Color.White).height(40.dp).padding(start = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Row(
            Modifier.weight(1f, fill = false).horizontalScroll(scroll).semantics { contentDescription = "Open terminals" },
            verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(2.dp),
        ) {
            tabs.forEach { tab ->
                val selected = tab.id == activeId
                val label = tab.session ?: tab.title
                Surface(
                    shape = RoundedCornerShape(8.dp), color = if (selected) MaterialTheme.colorScheme.background else Color.Transparent,
                    contentColor = if (selected) colors.fg else colors.fgMuted, border = BorderStroke(1.dp, if (selected) colors.border else Color.Transparent),
                ) {
                    Row(Modifier.height(32.dp), verticalAlignment = Alignment.CenterVertically) {
                        Text(
                            label, Modifier.clickable { onSelect(tab.id) }.semantics { role = Role.Tab; this.selected = selected }.widthIn(max = 176.dp)
                                .fillMaxHeight().wrapContentHeight().padding(start = 12.dp, end = 6.dp),
                            fontFamily = FontFamily.Monospace, style = MaterialTheme.typography.labelMedium, maxLines = 1, overflow = TextOverflow.Ellipsis,
                        )
                        Box(
                            Modifier.padding(end = 6.dp).size(24.dp).clickable { onClose(tab.id) }.semantics { contentDescription = "Close $label, keeping its session running"; role = Role.Button },
                            contentAlignment = Alignment.Center,
                        ) { LucideGlyph(Lucide.X, size = 12.dp) }
                    }
                }
            }
        }
        // Pinned: a long list of tabs scrolls under it and the button never leaves the screen.
        JarvisIconButton(Lucide.Plus, "New terminal", onClick = onNew)
    }
}

@Composable
private fun CenteredNotice(title: String, text: String) {
    Box(Modifier.fillMaxSize().padding(24.dp), contentAlignment = Alignment.Center) {
        Column(Modifier.widthIn(max = 380.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(title, style = MaterialTheme.typography.titleSmall)
            Text(text, style = MaterialTheme.typography.bodyMedium, color = Jarvis.colors.fgMuted)
        }
    }
}

@Composable
private fun UnavailableCard(backendName: String, reason: String?, onCheck: () -> Unit) {
    val colors = Jarvis.colors
    Box(Modifier.fillMaxSize().padding(24.dp), contentAlignment = Alignment.Center) {
        Surface(Modifier.widthIn(max = 420.dp), shape = RoundedCornerShape(16.dp), color = if (colors.dark) colors.surface else Color.White, border = BorderStroke(1.dp, colors.border)) {
            Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text("A terminal cannot be opened on $backendName", style = MaterialTheme.typography.titleSmall)
                Text(reason.orEmpty(), style = MaterialTheme.typography.bodyMedium, color = colors.fgMuted)
                OutlinedButton(onClick = onCheck) { LucideGlyph(TerminalGlyphs.RotateCw, size = 16.dp); Spacer(Modifier.width(6.dp)); Text("Check again") }
            }
        }
    }
}

@Composable
private fun EmptyState(backendName: String, others: Int, onNew: () -> Unit, onSessions: () -> Unit) {
    Box(Modifier.fillMaxSize().padding(24.dp), contentAlignment = Alignment.Center) {
        Column(Modifier.widthIn(max = 380.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text("No terminal open", style = MaterialTheme.typography.titleSmall)
            Text(
                if (others > 0) "$backendName has $others session${if (others == 1) "" else "s"} you can attach, or you can start a new one. Closing a tab only detaches: what runs in a session keeps running."
                else "Start a terminal. It is a zellij session on $backendName: close the page and it keeps running.",
                style = MaterialTheme.typography.bodyMedium, color = Jarvis.colors.fgMuted,
            )
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Button(onClick = onNew) { LucideGlyph(Lucide.Plus, size = 16.dp); Spacer(Modifier.width(6.dp)); Text("New terminal") }
                if (others > 0) OutlinedButton(onClick = onSessions) { LucideGlyph(TerminalGlyphs.List, size = 16.dp); Spacer(Modifier.width(6.dp)); Text("Sessions") }
            }
        }
    }
}
