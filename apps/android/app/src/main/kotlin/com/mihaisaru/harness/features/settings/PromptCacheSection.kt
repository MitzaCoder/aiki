package com.mihaisaru.harness.features.settings

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.mihaisaru.harness.data.*
import com.mihaisaru.harness.protocol.ProjectSummary

/** The choices of `longPromptCache`, in the web's order and words. */
private val LONG_PROMPT_CACHE_CHOICES = listOf(
    "coordinators" to "Coordinators (default)",
    "all" to "Coordinators and workers",
    "off" to "Nobody",
)

/**
 * Project → Prompt cache (web `PromptCacheSection.svelte`): who keeps the provider's prompt cache for an hour instead of
 * 5 minutes. One choice, saved as soon as it is picked; shown only when the backend sends `longPromptCache`.
 */
@Composable
internal fun PromptCacheSection(backend: BackendSession, project: ProjectSummary) {
    val stored = project.longPromptCache ?: return
    val models by backend.models.collectAsStateWithLifecycle()
    val supported = models.any { it.provider == project.coordinator.model?.provider && it.modelId == project.coordinator.model.modelId && it.provider == "anthropic" && it.api == "anthropic-messages" }
    val warmSave = rememberSaveState(project.id + "-warm")
    fun setWarm(setting: ProjectSetting) { warmSave.launch { backend.client.configureProject(project.id, setting); backend.refreshProjects() } }
    var pending by remember(project.id) { mutableStateOf<String?>(null) }
    val save = rememberSaveState(project.id)
    val value = pending ?: stored
    fun pick(next: String) {
        if (next == value) return
        pending = next
        save.launch {
            try { backend.client.configureProject(project.id, ProjectSetting.LongPromptCache(next)); backend.refreshProjects() }
            finally { pending = null }
        }
    }
    SettingsSectionPage("Prompt cache", "How long Claude keeps a conversation it has already read.", SettingsIcon.DatabaseZap) {
        SettingsGroup(title = "One-hour cache") {
            SettingsRow(
                "Keep the cache for an hour for", hint = "Costs more per write, saves paying for the whole conversation again after a long wait.",
                control = RowControl.Full, status = save, onRetry = { pick(value) },
                learn = { Text("Claude keeps what it has read for 5 minutes, and the next request pays a tenth of the price for it. A coordinator often waits longer than that for its workers. An hour makes each write dearer (twice the input price instead of 1.25 times). Workers rarely wait 5 minutes, so for them the dearer writes usually cost more than they save. Codex models ignore this. A change applies from the next request.") },
            ) {
                Column(Modifier.selectableGroup()) {
                    LONG_PROMPT_CACHE_CHOICES.forEach { (choice, label) ->
                        Row(
                            Modifier.fillMaxWidth().heightIn(min = 48.dp).selectable(value == choice, enabled = save.status != SaveStatus.Saving, role = Role.RadioButton) { pick(choice) },
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            RadioButton(selected = value == choice, onClick = null, enabled = save.status != SaveStatus.Saving)
                            Spacer(Modifier.width(12.dp))
                            Text(label, style = MaterialTheme.typography.bodyMedium)
                        }
                    }
                }
            }
        }
        if (backend.client.supports("cache-keep-warm")) SettingsGroup(title = "While idle") {
            SettingsRow("Keep coordinator cache warm", hint = "Uses cached-input tokens while idle. Claude only.", status = warmSave) {
                Switch(checked = project.keepPromptCacheWarm ?: true, onCheckedChange = { setWarm(ProjectSetting.KeepPromptCacheWarm(it)) }, enabled = supported)
            }
            if (!supported) Text("Not supported for this provider", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(16.dp))
            SettingsRow("Stop after", hint = "From the last real request, not the last refresh.", control = RowControl.Full) {
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    listOf(1L, 2L, 4L, 8L).forEach { hours ->
                        FilterChip(enabled = supported, selected = (project.promptCacheWarmHours ?: 8L) == hours, onClick = { setWarm(ProjectSetting.PromptCacheWarmHours(hours)) }, label = { Text("$hours h") })
                    }
                }
            }
        }
    }
}
