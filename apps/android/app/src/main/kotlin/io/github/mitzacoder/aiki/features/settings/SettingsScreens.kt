package io.github.mitzacoder.aiki.features.settings

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.github.mitzacoder.aiki.data.*
import io.github.mitzacoder.aiki.features.notifications.NotificationsSection
import io.github.mitzacoder.aiki.features.status.BannerTone
import io.github.mitzacoder.aiki.features.status.ToneBanner
import io.github.mitzacoder.aiki.navigation.Destination
import io.github.mitzacoder.aiki.navigation.ProjectScreenContext
import io.github.mitzacoder.aiki.ui.theme.Jarvis
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.flowOf

/**
 * General settings (web `/settings/...`): Appearance, Backends (the list, one backend, its Accounts), Notifications and
 * Archived projects, in the shared settings frame. [page] says which screen is open.
 */
@Composable
fun GeneralSettingsScreen(
    repository: HarnessRepository,
    page: GeneralPage,
    navigator: SettingsNavigator,
    navigate: (Destination) -> Unit,
    connectPayload: String?,
    onConnectHandled: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val sessions by repository.sessions.collectAsStateWithLifecycle()
    val settings by repository.settings.collectAsStateWithLifecycle()
    val counts by remember(sessions) {
        val flows: List<Flow<Pair<Boolean, Int>>> = sessions.map { s -> combine(s.client.state, s.projects) { c, p -> (c.status != ConnectionStatus.Ready) to p.archivedOnes().size } }
        if (flows.isEmpty()) flowOf(0 to 0) else combine(flows) { rows -> rows.count { it.first } to rows.sumOf { it.second } }
    }.collectAsStateWithLifecycle(0 to 0)
    val chips = generalChips(counts.first, settings.notifications.enabled, counts.second)
    val items = GeneralSection.entries.map { SettingsNavItem(it, chips[it]) }
    val parent = generalParent(page)
    val parentLabel = when {
        parent == null -> null
        parent.section == null -> "Settings"
        parent.backendKey == null -> "Backends"
        else -> sessions.firstOrNull { it.config.key == parent.backendKey }?.config?.name ?: "Back"
    }
    SettingsShell(
        items, page.section?.id, GeneralSection.Appearance.id, "Settings sections", "Projects", { navigate(Destination.Home) },
        parentLabel, parent?.let { { navigator.up(Destination.Settings(it)) } },
        onSelect = { id, split -> generalSectionFor(id)?.let { navigator.go(Destination.Settings(GeneralPage(it)), split) } },
        modifier = modifier,
        header = {
            Text("Settings", Modifier.padding(horizontal = 8.dp), style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
            Text("This device and its backends.", Modifier.padding(horizontal = 8.dp), style = MaterialTheme.typography.bodyMedium, color = Jarvis.colors.fgMuted)
        },
    ) { active ->
        when (generalSectionFor(active)) {
            GeneralSection.Appearance, null -> AppearanceSection(repository)
            GeneralSection.Backends -> {
                val backend = page.backendKey?.let { key -> sessions.firstOrNull { it.config.key == key } }
                when {
                    page.backendKey == null -> BackendsSection(repository, navigator, connectPayload, onConnectHandled)
                    backend == null -> NotFound("Unknown backend", "This device has no backend with that address. Add it under Backends.")
                    page.accounts -> AccountsPage(backend)
                    else -> BackendPage(repository, backend, navigator)
                }
            }
            GeneralSection.Notifications -> NotificationsSection(repository)
            GeneralSection.Archived -> ArchivedSection(repository, navigate)
        }
    }
}

@Composable
private fun NotFound(title: String, text: String) {
    SettingsGroup { GroupNote("$title. $text") }
}

/**
 * A project's settings (web `.../settings/<section>`): General, Coordinator, Workers, Scheduled tasks, Tickets and pull
 * requests, Prompt cache and Storage; a section the backend does not offer is left out. [section] null is the list.
 */
@Composable
fun ProjectSettingsScreen(context: ProjectScreenContext, section: ProjectSection?, scheduleId: String?, navigator: SettingsNavigator, modifier: Modifier = Modifier) {
    key(context.backend.config.key, context.route.projectId) { ProjectSettingsContent(context, section, scheduleId, navigator, modifier) }
}

@Composable
private fun ProjectSettingsContent(context: ProjectScreenContext, section: ProjectSection?, scheduleId: String?, navigator: SettingsNavigator, modifier: Modifier) {
    val projects by context.backend.projects.collectAsStateWithLifecycle()
    val connection by context.backend.client.state.collectAsStateWithLifecycle()
    val project = projects.firstOrNull { it.id == context.route.projectId }
    val offered = ProjectSection.entries.filter { projectSectionAvailable(it, ProjectSectionSupport(connection::supports, project?.links != null, project?.longPromptCache != null)) }
    val chips = projectChips(project?.coordinator?.model != null)
    val items = offered.map { SettingsNavItem(it, chips[it]) }
    val effective = section?.takeIf { it in offered }
    SettingsShell(
        items, effective?.id, wideSection(null, offered)?.id, "Project settings sections", "Back to chat", { navigator.up(context.route) },
        "${project?.name ?: "Project"} settings", { navigator.up(Destination.ProjectSettings(context.route)) },
        onSelect = { id, split -> projectSectionFor(id)?.let { navigator.go(Destination.ProjectSettings(context.route, it), split) } },
        modifier = modifier,
        header = {
            Row(Modifier.padding(horizontal = 8.dp), verticalAlignment = Alignment.Top, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Column(Modifier.weight(1f)) {
                    Text(project?.name ?: "Project settings", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
                    Text(context.backend.config.name + (project?.let { " · ${it.path}" } ?: ""), style = MaterialTheme.typography.labelMedium, fontFamily = FontFamily.Monospace, color = Jarvis.colors.fgMuted)
                }
                ConnectionBadge(connection.status, connection.attempt)
            }
        },
    ) { active ->
        if (project == null) {
            SettingsGroup { GroupNote(if (connection.status == ConnectionStatus.Ready) "This project no longer exists on ${context.backend.config.name}." else "Waiting for ${context.backend.config.name}…") }
            return@SettingsShell
        }
        Column(verticalArrangement = Arrangement.spacedBy(20.dp)) {
            if (project.state == "failed") ToneBanner(BannerTone.Error) { Text(project.failure ?: "The project failed to open.", style = MaterialTheme.typography.bodySmall) }
            when (projectSectionFor(active) ?: ProjectSection.General) {
                ProjectSection.General -> ProjectGeneralSection(context, project)
                ProjectSection.Coordinator -> CoordinatorSection(context, project, context.navigate)
                ProjectSection.Workers -> WorkersSection(context, project)
                ProjectSection.Schedules -> SchedulesSection(context, scheduleId)
                ProjectSection.Tickets -> project.links?.let { TicketsSection(context, it) }
                ProjectSection.Cache -> PromptCacheSection(context.backend, project)
                ProjectSection.Storage -> StorageSection(context.backend, project.id)
            }
        }
    }
}
