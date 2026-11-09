package com.mihaisaru.harness.features.settings

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.LinkAnnotation
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.withLink
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.mihaisaru.harness.data.*
import com.mihaisaru.harness.features.status.BannerTone
import com.mihaisaru.harness.features.status.StatusGlyphs
import com.mihaisaru.harness.features.status.ToneBanner
import com.mihaisaru.harness.navigation.Destination
import com.mihaisaru.harness.navigation.modelLabel
import com.mihaisaru.harness.ui.components.LucideGlyph
import com.mihaisaru.harness.ui.theme.Jarvis
import kotlinx.coroutines.launch

/**
 * The projects home (web `/`): every backend's projects with what they run on, Add a project, and, before any backend is
 * there, the first-run form. Managing backends moved to Settings → Backends.
 */
@Composable
fun ProjectsHome(repository: HarnessRepository, navigate: (Destination) -> Unit, modifier: Modifier = Modifier) {
    val sessions by repository.sessions.collectAsStateWithLifecycle()
    var adding by remember { mutableStateOf<BackendSession?>(null) }
    Column(
        modifier.fillMaxWidth().wrapContentWidth().widthIn(max = 840.dp).verticalScroll(rememberScrollState()).padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text("Projects", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
                Text("Every backend's projects.", style = MaterialTheme.typography.bodyMedium, color = Jarvis.colors.fgMuted)
            }
            OutlinedButton(onClick = { navigate(Destination.Settings()) }, modifier = Modifier.heightIn(min = 44.dp)) { Text("Settings") }
        }
        if (sessions.isEmpty()) FirstBackendForm(repository, navigate)
        sessions.forEach { backend -> key(backend.config.key) {
            val connection by backend.client.state.collectAsStateWithLifecycle()
            val projects by backend.projects.collectAsStateWithLifecycle()
            val models by backend.models.collectAsStateWithLifecycle()
            val backendError by backend.error.collectAsStateWithLifecycle()
            SettingsGroup(
                title = backend.config.name,
                actions = {
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                        ConnectionBadge(connection.status, connection.attempt)
                        if (canBrowseDirectories(connection)) TextButton(onClick = { adding = backend }, modifier = Modifier.heightIn(min = 44.dp)) {
                            LucideGlyph(StatusGlyphs.FolderPlus, size = 16.dp); Spacer(Modifier.width(6.dp)); Text("Add a project")
                        }
                    }
                },
            ) {
                backendError?.let { GroupRow { Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall) } }
                val shown = projects.unarchived()
                if (shown.isEmpty()) GroupNote(when {
                    connection.status != ConnectionStatus.Ready -> "Waiting for ${backend.config.name}…"
                    connection.supports("projects") -> "No projects yet."
                    else -> "This backend has no projects."
                })
                shown.forEach { project ->
                    val route = Destination.Chat(backend.config.key, project.id)
                    GroupRow(onClick = { navigate(route) }) {
                        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            Text(project.name, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.SemiBold, modifier = Modifier.weight(1f))
                            StatusChip(project.state, when (project.state) { "open" -> ChipTone.Ok; "failed" -> ChipTone.Err; else -> ChipTone.Warn })
                            SettingsAction("Settings for ${project.name}", com.mihaisaru.harness.ui.components.Lucide.Settings2) { navigate(Destination.ProjectSettings(route)) }
                        }
                        Text(project.path, style = MaterialTheme.typography.labelMedium, fontFamily = FontFamily.Monospace, color = Jarvis.colors.fgMuted)
                        Text("Coordinator: ${modelLabel(project.coordinator.model, models)}", style = MaterialTheme.typography.bodySmall, color = Jarvis.colors.fgMuted)
                        if (project.coordinator.model == null && connection.supports("models")) Box(Modifier.padding(top = 8.dp)) { ToneBanner(BannerTone.Warning) {
                            Text(buildAnnotatedString {
                                append("No coordinator model yet. ")
                                withLink(LinkAnnotation.Clickable("choose-model") { navigate(Destination.ProjectSettings(route, ProjectSection.Coordinator)) }) {
                                    withStyle(SpanStyle(textDecoration = TextDecoration.Underline)) { append("Choose a model") }
                                }
                                append(" before chatting.")
                            }, style = MaterialTheme.typography.bodySmall)
                        } }
                        if (project.state == "failed") Box(Modifier.padding(top = 8.dp)) { ToneBanner(BannerTone.Error) {
                            Text(project.failure ?: "The project failed to open.", style = MaterialTheme.typography.bodySmall)
                        } }
                    }
                }
            }
        } }
    }
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

/** The first-run card: a backend runs the projects and holds the credentials; give its address and it connects. */
@Composable
private fun FirstBackendForm(repository: HarnessRepository, navigate: (Destination) -> Unit) {
    val scope = rememberCoroutineScope()
    var address by rememberSaveable { mutableStateOf("") }
    var name by rememberSaveable { mutableStateOf("") }
    var error by remember { mutableStateOf<String?>(null) }
    SettingsGroup(title = "Connect your first backend", description = "A backend runs your projects and stores your provider credentials.") {
        GroupRow {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedTextField(address, { address = it }, label = { Text("URL, host, or published name") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                OutlinedTextField(name, { name = it }, label = { Text("Name (optional)") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                runCatching { resolveBackend(address, name, emptyList()) }.getOrNull()?.takeIf { address.isNotBlank() }?.let {
                    Text("Will add ${it.name} · ${it.url}", style = MaterialTheme.typography.bodySmall, color = Jarvis.colors.fgMuted)
                }
                error?.let { Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall) }
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Button(enabled = address.isNotBlank(), modifier = Modifier.heightIn(min = 44.dp), onClick = {
                        scope.launch { runCatching { repository.addBackends(listOf(resolveBackend(address, name, emptyList()))); address = ""; name = ""; error = null }.onFailure { error = it.message } }
                    }) { Text("Add backend") }
                    TextButton(onClick = { navigate(Destination.Settings(GeneralPage(GeneralSection.Backends))) }, modifier = Modifier.heightIn(min = 44.dp)) { Text("More ways to connect") }
                }
            }
        }
    }
}
