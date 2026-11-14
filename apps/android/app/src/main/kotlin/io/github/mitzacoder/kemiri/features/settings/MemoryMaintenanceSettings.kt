package io.github.mitzacoder.kemiri.features.settings

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.github.mitzacoder.kemiri.data.*
import io.github.mitzacoder.kemiri.protocol.*
import io.github.mitzacoder.kemiri.ui.theme.Jarvis
import kotlinx.coroutines.CancellationException

internal fun maintenanceRequest(model: ModelRef?, thinking: String?, time: String, writes: String): MemorySettingsSetRequest {
    require(Regex("^([01][0-9]|2[0-3]):[0-5][0-9]$").matches(time)) { "Use a time like 03:00." }
    val count = writes.toLongOrNull()
    require(count != null && count in 1..1000) { "Enter a whole number from 1 to 1000." }
    require(model == null || (model.provider.isNotBlank() && model.modelId.isNotBlank())) { "Choose a valid model." }
    require(thinking == null || thinking in THINKING_ORDER) { "Choose a supported thinking level." }
    return MemorySettingsSetRequest(maintenance = MemoryMaintenanceSettings(model, if (model == null) null else thinking, time, count))
}

/** What the maintenance settings say in a line (web `memoryMaintenanceSummary`). */
internal fun maintenanceSummary(settings: MemoryMaintenanceSettings, timezone: String): String =
    if (settings.model == null) "Off: no model is chosen, so maintenance does not run."
    else "Runs nightly at ${io.github.mitzacoder.kemiri.data.displayWallTime(settings.time)} (${timezone.ifEmpty { "the backend's timezone" }}) and after ${settings.afterWrites} new writes to a scope."

/**
 * A backend's memory maintenance: the model and thinking level a run uses, the nightly time in the backend's timezone and
 * how many writes to a scope start a run. No model means off. Each field saves at once (`memory.settings.set`).
 */
@Composable
internal fun MemoryMaintenanceGroup(backend: BackendSession) {
    val connection by backend.client.state.collectAsStateWithLifecycle()
    val models by backend.models.collectAsStateWithLifecycle()
    val catalog by backend.modelCatalog.collectAsStateWithLifecycle()
    var settings by remember(backend) { mutableStateOf<MemoryMaintenanceSettings?>(null) }
    var timezone by remember(backend) { mutableStateOf("") }
    var readError by remember(backend) { mutableStateOf<String?>(null) }
    val modelSave = rememberSaveState(backend)
    val thinkingSave = rememberSaveState(backend)
    val timeSave = rememberSaveState(backend)
    val writesSave = rememberSaveState(backend)
    LaunchedEffect(backend, connection.status) {
        if (connection.status != ConnectionStatus.Ready) return@LaunchedEffect
        try {
            val status = backend.client.request(MemoryStatusRequest(scope = "global"))
            settings = status.maintenance; timezone = status.timezone; readError = null
        } catch (e: CancellationException) { throw e }
        catch (_: Exception) { readError = "Unable to read the maintenance settings." }
    }
    val current = settings
    suspend fun apply(request: MemorySettingsSetRequest) { settings = backend.client.request(request).maintenance }
    val off = current?.model == null
    SettingsGroup(
        title = "Memory maintenance", description = "Tidies the memory notes on this backend, one commit per run.",
        actions = { StatusChip(if (off) "Off" else "On", if (off) ChipTone.Muted else ChipTone.Ok) },
    ) {
        if (current == null) GroupNote(readError ?: "Reading the maintenance settings…")
        else {
            val options = remember(models, catalog) { listOf(ComboOption("", "No model (off)", "Maintenance does not run")) + modelOptions(models, catalog?.providers.orEmpty()) }
            val levels = models.firstOrNull { it.provider == current.model?.provider && it.modelId == current.model?.modelId }?.thinkingLevels.orEmpty()
            SettingsRow(
                "Model", hint = "Pick a model to turn maintenance on.", status = modelSave,
                learn = { Text("A run merges duplicates, resolves contradictions, fixes titles, tags and links, and archives stale memories. A scope is maintained only when it changed since its last run. Undoing an extraction or a run from the Memory tab works whether this is on or off.") },
            ) {
                Combobox(options, current.model?.let(::modelKey) ?: "", { key ->
                    val model = models.firstOrNull { modelKey(it) == key }
                    val keep = validThinking(current.thinkingLevel, model)
                    modelSave.launch { apply(maintenanceRequest(model?.let { ModelRef(it.provider, it.modelId) }, keep, current.time, current.afterWrites.toString())) }
                }, "Maintenance model", placeholder = "Choose a model…", searchPlaceholder = "Search models or providers…", enabled = models.isNotEmpty())
            }
            SettingsRow("Thinking level", hint = "How hard the model thinks during a run.", status = thinkingSave) {
                ThinkingSelect(levels, current.thinkingLevel, { level ->
                    thinkingSave.launch { apply(maintenanceRequest(current.model, level, current.time, current.afterWrites.toString())) }
                }, enabled = !off)
            }
            SettingsRow("Nightly at", hint = "Backend time (${timezone.ifEmpty { "the backend's timezone" }}).", control = RowControl.Auto, status = timeSave) {
                AutoInput(current.time, timeSave, Modifier.widthIn(max = 160.dp), enabled = !off, label = "Nightly time") { text ->
                    apply(maintenanceRequest(current.model, current.thinkingLevel, text, current.afterWrites.toString()))
                }
            }
            SettingsRow("After writes", hint = "Also run once a scope has this many new writes.", control = RowControl.Auto, status = writesSave) {
                AutoInput(current.afterWrites.toString(), writesSave, Modifier.widthIn(max = 140.dp), enabled = !off, numeric = true, label = "After writes") { text ->
                    apply(maintenanceRequest(current.model, current.thinkingLevel, current.time, text))
                }
            }
            GroupRow { Text(maintenanceSummary(current, timezone), style = MaterialTheme.typography.bodySmall, color = Jarvis.colors.fgMuted) }
        }
    }
}
