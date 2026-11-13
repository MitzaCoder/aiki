package io.github.mitzacoder.kemiri.features.settings

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.github.mitzacoder.kemiri.data.BackendSession
import io.github.mitzacoder.kemiri.protocol.*
import io.github.mitzacoder.kemiri.ui.theme.Jarvis
import kotlinx.coroutines.delay
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

@Composable
internal fun ReportAuditSettings(backend: BackendSession, project: ProjectSummary) {
    val connection by backend.client.state.collectAsStateWithLifecycle()
    if (!reportAuditVisible(connection.hello?.features)) return
    val models by backend.models.collectAsStateWithLifecycle()
    val catalog by backend.modelCatalog.collectAsStateWithLifecycle()
    val providers = catalog?.providers.orEmpty()
    val options = remember(models, providers) { modelOptions(models, providers) }
    val stored = project.reportAudit ?: DEFAULT_REPORT_AUDIT_SETTINGS
    var latest by remember(project.id, stored) { mutableStateOf(stored) }
    var choosing by remember(project.id, stored.mode) { mutableStateOf(false) }
    val modeSave = rememberSaveState(project.id, "audit-mode")
    val modelSave = rememberSaveState(project.id, "audit-model")
    val budgetSave = rememberSaveState(project.id, "audit-budget")
    val queue = remember(project.id) { Mutex() }
    val enabled = listOf(modeSave, modelSave, budgetSave).none { it.status == SaveStatus.Saving }
    val now by produceState(System.currentTimeMillis()) { while (true) { delay(30_000); value = System.currentTimeMillis() } }

    suspend fun persist(change: (ProjectsConfigureRequestReportAudit) -> ProjectsConfigureRequestReportAudit) {
        queue.withLock {
            val target = change(latest)
            backend.configure(ProjectsConfigureRequest(projectId = project.id, reportAudit = target))
            latest = target
        }
    }
    fun pickMode(mode: String) {
        if (mode == "model" && latest.model == null) { choosing = true; return }
        choosing = false
        modeSave.launch { persist { it.copy(mode = mode, model = if (mode == "model") it.model else null) } }
    }
    fun pickModel(key: String) {
        val chosen = models.firstOrNull { modelKey(it) == key } ?: return
        modelSave.launch {
            persist { it.copy(mode = "model", model = ModelRef(provider = chosen.provider, modelId = chosen.modelId)) }
            choosing = false
        }
    }
    SettingsGroup(title = "Report check") {
        GroupNote("A small model checks once an hour whether active tasks' reports missed something, and asks the coordinator to update them", center = false)
        SettingsRow("Mode", hint = "Automatic uses the cheapest small model you're signed in to (Claude Haiku 5.5, else GPT-5 nano)", status = modeSave, onRetry = { pickMode(if (choosing) "model" else latest.mode) }) {
            Combobox(listOf(ComboOption("auto", "Automatic"), ComboOption("off", "Off"), ComboOption("model", "Choose a model")),
                if (choosing) "model" else latest.mode, ::pickMode, "Report check mode", enabled = enabled, invalid = modeSave.status == SaveStatus.Failed)
        }
        if (choosing || latest.mode == "model") SettingsRow("Report check model", hint = "Choose a model to save this mode.", status = modelSave) {
            Combobox(options, latest.model?.let(::modelKey).orEmpty(), ::pickModel, "Report check model",
                placeholder = "Choose a model…", searchPlaceholder = "Search models or providers…", enabled = enabled && models.isNotEmpty(), invalid = modelSave.status == SaveStatus.Failed)
        }
        SettingsRow("Daily token budget", hint = "Resets each day at midnight UTC. From 0 to 10,000,000 tokens; default 65,000.", status = budgetSave) {
            AutoInput(latest.dailyTokens.toString(), budgetSave, numeric = true, label = "Report check daily token budget", enabled = enabled) { text ->
                val tokens = reportAuditBudget(text) ?: throw IllegalArgumentException("Enter a whole number from 0 to 10,000,000.")
                persist { it.copy(dailyTokens = tokens) }
            }
        }
        val status = project.reportAuditStatus
        GroupNote(
            reportAuditModel(status?.effectiveModel, models, providers) + " · " +
                reportAuditUsage(status?.tokensUsed ?: 0, latest.dailyTokens) + "\n" +
                reportAuditStatusWords(status, now), center = false)
    }
}
