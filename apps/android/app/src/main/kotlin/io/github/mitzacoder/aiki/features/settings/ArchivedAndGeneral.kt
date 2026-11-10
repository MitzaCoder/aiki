package io.github.mitzacoder.aiki.features.settings

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.github.mitzacoder.aiki.data.*
import io.github.mitzacoder.aiki.navigation.Destination
import io.github.mitzacoder.aiki.navigation.ProjectScreenContext
import io.github.mitzacoder.aiki.protocol.ProjectSummary
import io.github.mitzacoder.aiki.protocol.ProjectsConfigureRequest
import io.github.mitzacoder.aiki.ui.components.Lucide
import io.github.mitzacoder.aiki.ui.components.LucideGlyph
import io.github.mitzacoder.aiki.ui.theme.Jarvis
import kotlinx.coroutines.launch

fun ProjectSummary.isArchived() = archived == true

/** A backend's projects as the project lists show them: the archived ones are left out (web `archivedProjects` is the other half). */
fun List<ProjectSummary>.unarchived() = filterNot { it.isArchived() }
fun List<ProjectSummary>.archivedOnes() = filter { it.isArchived() }

/** Sets a project's archived flag and reads the projects again so every list follows. */
internal suspend fun BackendSession.setArchived(projectId: String, archived: Boolean) {
    client.request(ProjectsConfigureRequest(projectId = projectId, archived = archived))
    refreshProjects()
}

/**
 * General → Archived projects: every backend's archived projects, each opening the project and carrying an Unarchive
 * button. Nothing is deleted.
 */
@Composable
internal fun ArchivedSection(repository: HarnessRepository, navigate: (Destination) -> Unit) {
    val sessions by repository.sessions.collectAsStateWithLifecycle()
    val lists = sessions.map { it to it.projects.collectAsStateWithLifecycle().value.archivedOnes() }
    SettingsSectionPage("Archived projects", "Hidden from the project list; nothing is deleted.", SettingsIcon.Archive) {
        if (lists.sumOf { it.second.size } == 0) SettingsGroup {
            GroupNote("No archived projects. Archive one from its own settings, under General.")
        }
        else lists.forEach { (backend, projects) -> if (projects.isNotEmpty()) SettingsGroup(title = backend.config.name) {
            projects.forEach { project -> key(project.id) {
                val save = rememberSaveState(backend.config.key, project.id)
                GroupRow {
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        Column(Modifier.weight(1f).clickable { navigate(Destination.Chat(backend.config.key, project.id)) }.heightIn(min = 44.dp), verticalArrangement = Arrangement.Center) {
                            Text(project.name, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                            Text(project.path, style = MaterialTheme.typography.labelMedium, fontFamily = FontFamily.Monospace, color = Jarvis.colors.fgMuted, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        }
                        OutlinedButton(enabled = save.status != SaveStatus.Saving, modifier = Modifier.heightIn(min = 44.dp), onClick = { save.launch { backend.setArchived(project.id, false) } }) {
                            if (save.status == SaveStatus.Saving) CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 2.dp)
                            else LucideGlyph(Lucide.Archive, size = 16.dp)
                            Spacer(Modifier.width(6.dp)); Text("Unarchive")
                        }
                    }
                    if (save.status == SaveStatus.Failed) SaveStatusLine(save, reserve = false)
                }
            } }
        } }
    }
}

/** Project → General: its name (saved when you leave the field), where it lives, and archiving. */
@Composable
internal fun ProjectGeneralSection(context: ProjectScreenContext, project: ProjectSummary) {
    val connection by context.backend.client.state.collectAsStateWithLifecycle()
    val nameSave = rememberSaveState(project.id)
    val archiveSave = rememberSaveState(project.id)
    var confirming by rememberSaveable { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    SettingsSectionPage("General", "What this project is called and where it lives.", SettingsIcon.Folder) {
        SettingsGroup(title = "Project") {
            SettingsRow("Name", hint = "Shown in the drawer and the chat's header.", status = nameSave) {
                AutoInput(project.name, nameSave, label = "Project name") { next ->
                    require(next.isNotEmpty()) { "A project needs a name." }
                    context.backend.client.request(ProjectsConfigureRequest(projectId = project.id, name = next))
                    context.backend.refreshProjects()
                }
            }
            SettingsRow("Folder", hint = "On ${context.backend.config.name}. The folder cannot be changed here.", control = RowControl.Auto) {
                CopyableValue(project.path, "Copy the folder path")
            }
            SettingsRow("Backend", hint = "The server that runs this project.", control = RowControl.Auto) {
                ConnectionBadge(connection.status, connection.attempt)
            }
        }
        if (connection.supports("project-archive")) {
            val archived = project.isArchived()
            SettingsGroup(title = "Archive") {
                SettingsRow(
                    if (archived) "This project is archived" else "Archive this project",
                    hint = if (archived) "Hidden from the project list; schedules and triggers are paused." else "Hide it and pause its schedules. Nothing is deleted.",
                    control = RowControl.Auto, status = archiveSave,
                    learn = {
                        Text(if (archived) "It is not in the project list and its scheduled tasks and event triggers are paused. Unarchive it to put it back as it was."
                        else "The project leaves the project list and its schedules and event triggers stop firing and stay as they are. Conversations, board, memory and artifacts stay, and you can unarchive it from Settings → Archived projects.")
                    },
                ) {
                    if (archived) OutlinedButton(enabled = archiveSave.status != SaveStatus.Saving, modifier = Modifier.heightIn(min = 44.dp), onClick = { archiveSave.launch { context.backend.setArchived(project.id, false) } }) { Text("Unarchive") }
                    else OutlinedButton(modifier = Modifier.heightIn(min = 44.dp), onClick = { archiveSave.reset(); confirming = true }) { Text("Archive") }
                }
            }
        }
    }
    if (confirming) AlertDialog(
        onDismissRequest = { if (archiveSave.status != SaveStatus.Saving) confirming = false },
        title = { Text("Archive ${project.name}?") },
        text = { Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("It leaves the project list, and its scheduled tasks and event triggers stop firing and stay as they are. Nothing is deleted. You can unarchive it from the Archived list.")
            if (archiveSave.status == SaveStatus.Failed) Text(archiveSave.error ?: "Not archived.", color = Jarvis.colors.danger, style = MaterialTheme.typography.bodySmall)
        } },
        confirmButton = { Button(enabled = archiveSave.status != SaveStatus.Saving, onClick = { scope.launch { if (archiveSave.run { context.backend.setArchived(project.id, true) }) confirming = false } }) { Text("Archive") } },
        dismissButton = { TextButton(enabled = archiveSave.status != SaveStatus.Saving, onClick = { confirming = false }) { Text("Cancel") } },
    )
}
