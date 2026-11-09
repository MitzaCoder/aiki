package com.mihaisaru.harness.navigation

import androidx.compose.animation.core.animateDpAsState
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.draw.clip
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.mihaisaru.harness.data.*
import com.mihaisaru.harness.features.settings.ConnectionBadge
import com.mihaisaru.harness.features.settings.GeneralPage
import com.mihaisaru.harness.features.settings.GeneralSection
import com.mihaisaru.harness.features.settings.unarchived
import com.mihaisaru.harness.features.settings.ProjectDirectoryBrowser
import com.mihaisaru.harness.features.settings.canBrowseDirectories
import com.mihaisaru.harness.features.settings.connectionLabel
import com.mihaisaru.harness.features.status.StatusGlyphs
import com.mihaisaru.harness.protocol.ProjectSummary
import com.mihaisaru.harness.ui.components.*
import com.mihaisaru.harness.ui.theme.Jarvis
import kotlinx.coroutines.delay

/**
 * The projects drawer, the twin of the web's `ProjectsSidebar` below its wide width: projects grouped by backend, each
 * row with one status glyph and short line, plus an unread dot. Needs you gathers cross-project questions, failures
 * and quieter reviews; backend groups retain Add and archives. Usage and Settings stay at the foot.
 */
@Composable
fun ProjectsDrawer(repository: HarnessRepository, current: Destination, navigate: (Destination) -> Unit, unknownBackend: String? = null, dismissUnknownBackend: () -> Unit = {}) {
    ModalDrawerSheet {
        Text("Projects", style = MaterialTheme.typography.titleLarge, modifier = Modifier.padding(start = 24.dp, top = 20.dp, bottom = 12.dp))
        unknownBackend?.let { UnknownBackendNotice(it, navigate, dismissUnknownBackend) }
        ProjectsNav(repository, current, navigate, rail = false)
    }
}

/**
 * The same list kept open beside the chat on a wide screen: 264dp of rows or, [collapsed], a 56dp rail of project
 * initials with a status dot, action-count badge and unread ring.
 */
@Composable
fun ProjectsSidebar(
    repository: HarnessRepository,
    current: Destination,
    navigate: (Destination) -> Unit,
    collapsed: Boolean,
    toggleCollapsed: () -> Unit,
    modifier: Modifier = Modifier,
    unknownBackend: String? = null,
    dismissUnknownBackend: () -> Unit = {},
) {
    val colors = Jarvis.colors
    val width by animateDpAsState(if (collapsed) 56.dp else 264.dp, label = "projects sidebar width")
    // The drawer sheet's colours, which a bare Row would not give the rows' texts.
    Surface(modifier.fillMaxHeight().width(width), color = MaterialTheme.colorScheme.background, contentColor = MaterialTheme.colorScheme.onSurface) {
    Row(Modifier.fillMaxSize().background(colors.surface.copy(alpha = .4f))) {
        Column(Modifier.weight(1f).fillMaxHeight().windowInsetsPadding(WindowInsets.safeDrawing.only(WindowInsetsSides.Vertical + WindowInsetsSides.Start))) {
            Row(
                Modifier.fillMaxWidth().padding(horizontal = 6.dp, vertical = 4.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = if (collapsed) Arrangement.Center else Arrangement.Start,
            ) {
                if (!collapsed) Text(
                    "PROJECTS", Modifier.weight(1f).padding(horizontal = 6.dp), style = MaterialTheme.typography.labelSmall,
                    fontWeight = FontWeight.SemiBold, color = colors.fgSubtle, maxLines = 1,
                )
                JarvisIconButton(
                    if (collapsed) NavGlyphs.ChevronsRight else NavGlyphs.ChevronsLeft,
                    if (collapsed) "Expand the projects sidebar" else "Collapse the projects sidebar",
                    onClick = toggleCollapsed,
                )
            }
            if (!collapsed) unknownBackend?.let { UnknownBackendNotice(it, navigate, dismissUnknownBackend) }
            ProjectsNav(repository, current, navigate, rail = collapsed)
        }
        VerticalDivider(color = colors.border)
    }
    }
}

/** A link named a backend this device does not have (web: the "Unknown backend" page): what happened and where to add it. */
@Composable
private fun UnknownBackendNotice(backendId: String, navigate: (Destination) -> Unit, dismiss: () -> Unit) {
    val colors = Jarvis.colors
    Surface(
        Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 4.dp),
        shape = RoundedCornerShape(12.dp), color = colors.warning.copy(alpha = .12f), border = androidx.compose.foundation.BorderStroke(1.dp, colors.warning.copy(alpha = .45f)),
    ) {
        Column(Modifier.padding(start = 12.dp, top = 4.dp, bottom = 4.dp, end = 4.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("Unknown backend", Modifier.weight(1f), style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
                IconButton(onClick = dismiss) { LucideGlyph(Lucide.X, size = 16.dp, contentDescription = "Dismiss") }
            }
            Text("The link names the backend \"$backendId\", which is not on this device. Add it under Backends, then open the link again.",
                style = MaterialTheme.typography.bodySmall, color = colors.fgMuted, modifier = Modifier.padding(end = 8.dp))
            TextButton(onClick = { navigate(Destination.Settings(GeneralPage(GeneralSection.Backends))) }) { Text("Open Backends") }
        }
    }
}

/** The backends, their projects and the footer, as rows (the drawer, the open sidebar) or as a rail of tiles. */
@Composable
private fun ColumnScope.ProjectsNav(repository: HarnessRepository, current: Destination, navigate: (Destination) -> Unit, rail: Boolean) {
    val sessions by repository.sessions.collectAsStateWithLifecycle()
    val settings by repository.settings.collectAsStateWithLifecycle()
    val currentChat = current.chatRoute()
    var now by remember { mutableLongStateOf(System.currentTimeMillis()) }
    LaunchedEffect(Unit) { while (true) { delay(15_000); now = System.currentTimeMillis() } }
    var adding by remember { mutableStateOf<BackendSession?>(null) }
    val attentionProjects = sessions.map { backend ->
        val projects by backend.projects.collectAsStateWithLifecycle()
        BackendAttentionProjects(backend.config.key, backend.config.name, projects)
    }
    val attentionLinks = needsYouLinks(attentionProjects)
    LazyColumn(Modifier.weight(1f).fillMaxWidth(), horizontalAlignment = if (rail) Alignment.CenterHorizontally else Alignment.Start) {
        if (!rail && attentionLinks.isNotEmpty()) item(key = "needs-you") { NeedsYou(attentionLinks, navigate) }
        sessions.forEach { backend ->
            item(key = backend.config.key) {
                val connection by backend.client.state.collectAsStateWithLifecycle()
                if (rail) RailBackend(backend.config.name, connection.status, connection.attempt)
                else Row(Modifier.padding(start = 24.dp, end = 12.dp, top = 12.dp, bottom = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        Text(backend.config.name, style = MaterialTheme.typography.titleSmall)
                        if (connection.status != ConnectionStatus.Ready) {
                            Spacer(Modifier.height(6.dp))
                            ConnectionBadge(connection.status, connection.attempt)
                        }
                    }
                    if (canBrowseDirectories(connection)) IconButton(onClick = { adding = backend }) {
                        LucideGlyph(StatusGlyphs.FolderPlus, size = 18.dp, contentDescription = "Add a project to ${backend.config.name}")
                    }
                }
            }
            item(key = backend.config.key + ":projects") {
                val allProjects by backend.projects.collectAsStateWithLifecycle()
                val projects = allProjects.unarchived()
                val connection by backend.client.state.collectAsStateWithLifecycle()
                Column(horizontalAlignment = if (rail) Alignment.CenterHorizontally else Alignment.Start, verticalArrangement = Arrangement.spacedBy(if (rail) 4.dp else 0.dp)) {
                    if (projects.isEmpty() && !rail) Text(
                        when { connection.status != ConnectionStatus.Ready -> "Waiting for ${backend.config.name}…"; connection.supports("projects") -> "No projects yet."; else -> "This backend has no projects." },
                        Modifier.padding(horizontal = 24.dp, vertical = 4.dp), style = MaterialTheme.typography.bodySmall, color = Jarvis.colors.fgSubtle,
                    )
                    var showArchived by remember { mutableStateOf(false) }
                    val archived = allProjects.filter { it.archived == true }
                    projects.forEach { project ->
                        val unread = (project.activity?.lastReplyEntryId ?: 0) > (settings.seenReplies[backend.config.key]?.get(project.id) ?: 0)
                        val selected = currentChat?.backendKey == backend.config.key && currentChat.projectId == project.id
                        val open = { navigate(Destination.Chat(backend.config.key, project.id)) }
                        if (rail) RailProject(backend.config.name, project, unread, selected, now, open)
                        else ProjectRow(project, unread, selected, now, open)
                    }
                    if (!rail && archived.isNotEmpty()) {
                        TextButton(onClick = { showArchived = !showArchived }, modifier = Modifier.padding(horizontal = 16.dp)) { Text("Archived (${archived.size}) ${if (showArchived) "⌃" else "⌄"}", style = MaterialTheme.typography.labelSmall, color = Jarvis.colors.fgSubtle) }
                        if (showArchived || archived.any { currentChat?.backendKey == backend.config.key && currentChat.projectId == it.id }) archived.forEach { project ->
                            ProjectRow(project, false, currentChat?.backendKey == backend.config.key && currentChat.projectId == project.id, now) { navigate(Destination.Chat(backend.config.key, project.id)) }
                        }
                    }
                }
            }
        }
        if (sessions.isEmpty() && !rail) item { Text("Add a backend to see projects.", Modifier.padding(24.dp)) }
    }
    HorizontalDivider()
    FooterItem(NavGlyphs.Gauge, "Usage", "Subscription limits", "Usage: subscription limits and when they reset", current == Destination.Usage, rail) { navigate(Destination.Usage) }
    FooterItem(NavGlyphs.Settings, "Settings", "Appearance, backends, notifications", "Settings: appearance, backends, notifications, archived projects", current is Destination.Settings, rail) { navigate(Destination.Settings()) }
    Spacer(Modifier.height(if (rail) 8.dp else 16.dp))
    adding?.let { backend ->
        var error by remember(backend) { mutableStateOf<String?>(null) }
        AlertDialog(
            onDismissRequest = { adding = null },
            title = { Text("Add a project to ${backend.config.name}") },
            text = {
                Column(Modifier.heightIn(max = 520.dp).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    ProjectDirectoryBrowser(backend, { adding = null; navigate(it) }) { error = it }
                    error?.let { Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall) }
                }
            },
            confirmButton = { TextButton(onClick = { adding = null }) { Text("Close") } },
        )
    }
}

/** A footer link: icon, name and what it holds ("Subscription limits"); the rail shows the icon alone. */
@Composable
private fun ColumnScope.FooterItem(icon: LucideIcon, label: String, detail: String, description: String, selected: Boolean, rail: Boolean, onClick: () -> Unit) {
    if (rail) {
        val colors = Jarvis.colors
        Box(
            Modifier.align(Alignment.CenterHorizontally).padding(vertical = 2.dp).size(40.dp).clip(RoundedCornerShape(8.dp))
                .background(if (selected) colors.surface2 else Color.Transparent)
                .clickable(onClickLabel = label, onClick = onClick)
                .semantics { contentDescription = description },
            contentAlignment = Alignment.Center,
        ) { LucideGlyph(icon, size = 18.dp, tint = if (selected) colors.fg else colors.fgMuted) }
        return
    }
    NavigationDrawerItem(
        icon = { LucideGlyph(icon) },
        label = {
            Column {
                Text(label, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text(detail, style = MaterialTheme.typography.bodySmall, color = Jarvis.colors.fgSubtle, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
        },
        selected = selected,
        onClick = onClick,
        modifier = Modifier.padding(horizontal = 12.dp).semantics(mergeDescendants = true) { contentDescription = description },
    )
}

/** A backend's divider in the rail: a short rule and its connection dot. */
@Composable
private fun RailBackend(name: String, status: ConnectionStatus, attempt: Int) {
    val colors = Jarvis.colors
    val dot = when (connectionTone(status)) {
        ConnectionTone.Ok -> colors.success
        ConnectionTone.Warn -> colors.warning
        ConnectionTone.Error -> colors.danger
        ConnectionTone.Muted -> colors.fgSubtle.copy(alpha = .5f)
    }
    Row(
        Modifier.padding(vertical = 6.dp).width(36.dp).semantics { contentDescription = "$name — ${connectionLabel(status, attempt)}" },
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        Box(Modifier.weight(1f).height(1.dp).background(colors.border))
        Box(Modifier.size(6.dp).background(dot, CircleShape))
    }
}

/** A project in the rail: its initial, a ring for an unseen reply, action count and status dot. */
@Composable
private fun RailProject(backendName: String, project: ProjectSummary, unread: Boolean, selected: Boolean, now: Long, onClick: () -> Unit) {
    val status = projectStatus(project, now)
    val colors = Jarvis.colors
    val count = attentionCount(project)
    val actionBadge = questionBadgeText(count)
    val summary = sidebarStatus(project, status)
    val description = buildString {
        append("$backendName: ${project.name} — ${summary.label}")
        status.detail?.let { append(" · $it") }
        if (unread) append(", new reply")
        if (actionBadge != null) append(", $count outstanding actions")
    }
    Box(Modifier.size(40.dp)) {
        Box(
            Modifier.align(Alignment.Center).size(36.dp).clip(RoundedCornerShape(8.dp))
                .background(if (selected) colors.surface2 else Color.Transparent)
                .then(if (unread) Modifier.border(2.dp, MaterialTheme.colorScheme.primary, RoundedCornerShape(8.dp)) else Modifier)
                .clickable(onClick = onClick)
                .semantics { contentDescription = description },
            contentAlignment = Alignment.Center,
        ) {
            Text(projectInitial(project.name), style = MaterialTheme.typography.labelMedium, fontWeight = FontWeight.SemiBold, color = if (selected) colors.fg else colors.fgMuted)
            Box(Modifier.align(Alignment.BottomEnd).padding(2.dp).size(8.dp).background(toneDot(status.tone), CircleShape))
        }
        actionBadge?.let { Badge(Modifier.align(Alignment.TopEnd), containerColor = if (summary.urgent) colors.warning else colors.surface2, contentColor = if (summary.urgent) colors.surface else colors.fgMuted) { Text(it) } }
    }
}

/** The letter a project's rail tile shows (web `projectInitial`). */
internal fun projectInitial(name: String): String = name.trim().firstOrNull()?.uppercase() ?: "?"

@Composable
private fun ProjectRow(project: ProjectSummary, unread: Boolean, selected: Boolean, now: Long, onClick: () -> Unit) {
    val status = projectStatus(project, now)
    val colors = Jarvis.colors
    val summary = sidebarStatus(project, status)
    val description = listOfNotNull(project.name, summary.label, if (unread) "New reply since you last looked" else null).joinToString(", ")
    NavigationDrawerItem(
        label = {
            Row(verticalAlignment = Alignment.Top, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                Box(Modifier.width(20.dp).height(28.dp), contentAlignment = Alignment.Center) {
                    Text(summary.glyph, color = when { summary.urgent -> colors.warning; summary.working -> colors.accent2; else -> colors.fgSubtle }, fontWeight = FontWeight.SemiBold)
                }
                Column(Modifier.weight(1f)) {
                    Text(project.name, fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Medium, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    Text(summary.label, style = MaterialTheme.typography.bodySmall,
                        color = if (summary.urgent) colors.warning else colors.fgSubtle, maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
                if (unread) Box(Modifier.padding(top = 6.dp).size(8.dp).background(MaterialTheme.colorScheme.primary, CircleShape))
            }
        },
        selected = selected,
        onClick = onClick,
        modifier = Modifier.padding(horizontal = 12.dp).semantics(mergeDescendants = true) { contentDescription = description },
    )
}

@Composable
private fun toneDot(tone: ProjectStatusTone): Color = when (tone) {
    ProjectStatusTone.Ok -> Jarvis.colors.success
    ProjectStatusTone.Busy -> Jarvis.colors.accent2
    ProjectStatusTone.Warn -> Jarvis.colors.warning
    ProjectStatusTone.Error -> Jarvis.colors.danger
    ProjectStatusTone.Muted -> Jarvis.colors.fgSubtle.copy(alpha = .5f)
}
