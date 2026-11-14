package io.github.mitzacoder.kemiri.features.settings

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.github.mitzacoder.kemiri.data.*
import io.github.mitzacoder.kemiri.protocol.*
import io.github.mitzacoder.kemiri.ui.theme.Jarvis

@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun ProjectSkillsSection(backend: BackendSession, projectId: String, snackbar: SnackbarHostState) {
    val connection by backend.client.state.collectAsStateWithLifecycle()
    if (!connection.supports(PROJECT_SKILLS_FEATURE)) return
    val choices = remember(backend, projectId) { backend.projectSkills(projectId) }
    val state by choices.state.collectAsStateWithLifecycle()
    var filter by remember(backend, projectId) { mutableStateOf(ProjectSkillFilter.All) }
    var detail by remember(backend, projectId) { mutableStateOf<ProjectSkill?>(null) }
    LaunchedEffect(choices, connection.status) {
        if (connection.status == ConnectionStatus.Ready) choices.refresh()
    }
    LaunchedEffect(state.error) { state.error?.let { snackbar.showSnackbar("Skills: $it") } }
    SettingsSectionPage("Skills", "What this project's agents know how to do.", SettingsIcon.Folder) {
        if (!state.loaded) {
            if (state.error == null) LinearProgressIndicator(Modifier.fillMaxWidth())
            else TextButton(onClick = choices::refresh) { Text("Retry loading skills") }
        } else {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("${state.skills.size} found · ${state.skills.count(::projectSkillOffered)} offered", style = MaterialTheme.typography.bodyMedium)
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    ProjectSkillFilter.entries.forEach { option ->
                        FilterChip(selected = filter == option, onClick = { filter = option },
                            label = { Text(option.label) }, modifier = Modifier.heightIn(min = 48.dp))
                    }
                }
                if (state.saving) Text("Saving…", style = MaterialTheme.typography.labelSmall)
            }
            val groups = projectSkillGroups(state.skills, filter)
            if (groups.isEmpty()) Text("No skills match this filter.", color = Jarvis.colors.fgMuted)
            groups.forEach { group ->
                SettingsGroup(title = group.label) {
                    group.skills.forEach { skill ->
                        GroupRow(onClick = { detail = skill }) {
                            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                                    Text(skill.name, style = MaterialTheme.typography.titleSmall)
                                    Text(skill.description, maxLines = 2, overflow = TextOverflow.Ellipsis,
                                        style = MaterialTheme.typography.bodySmall, color = Jarvis.colors.fgMuted)
                                    Text(projectSkillSourceLabel(skill), style = MaterialTheme.typography.labelSmall, color = Jarvis.colors.fgSubtle)
                                    if (!skill.decided) StatusChip("New", ChipTone.Info, dot = false)
                                    if (projectSkillSomeRoles(skill)) Text("Some roles", style = MaterialTheme.typography.labelSmall)
                                    projectSkillHiddenNote(skill)?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = Jarvis.colors.fgMuted) }
                                }
                                Switch(checked = projectSkillOffered(skill), onCheckedChange = { choices.setOffered(skill.name, it) },
                                    enabled = connection.status == ConnectionStatus.Ready,
                                    modifier = Modifier.sizeIn(minWidth = 48.dp, minHeight = 48.dp).semantics {
                                        contentDescription = "Offer ${skill.name} to this project's agents"
                                    })
                            }
                        }
                    }
                }
            }
            Text("Saved for this project on this backend. A change reaches each conversation at its next turn. Off hides the skill from the agents' list; the file stays readable.",
                style = MaterialTheme.typography.bodySmall, color = Jarvis.colors.fgMuted)
        }
    }
    detail?.let { skill ->
        ModalBottomSheet(onDismissRequest = { detail = null }) {
            SelectionContainer {
                Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(24.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    Text(skill.name, style = MaterialTheme.typography.titleLarge)
                    Text(skill.description, style = MaterialTheme.typography.bodyMedium)
                    Text(projectSkillSourceLabel(skill), style = MaterialTheme.typography.labelMedium)
                    Text("SKILL.md path", style = MaterialTheme.typography.titleSmall)
                    Text(skill.path, style = MaterialTheme.typography.bodySmall)
                    if (skill.hides.isNotEmpty()) {
                        Text("Hidden by this skill", style = MaterialTheme.typography.titleSmall)
                        skill.hides.forEach { Text(it, style = MaterialTheme.typography.bodySmall) }
                    }
                    TextButton(onClick = { detail = null }, modifier = Modifier.heightIn(min = 48.dp).align(Alignment.End)) { Text("Close") }
                }
            }
        }
    }
}
