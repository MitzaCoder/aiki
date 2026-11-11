package io.github.mitzacoder.aiki.features.settings

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.background
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.github.mitzacoder.aiki.data.*
import io.github.mitzacoder.aiki.features.status.BannerTone
import io.github.mitzacoder.aiki.features.status.ToneBanner
import io.github.mitzacoder.aiki.navigation.Destination
import io.github.mitzacoder.aiki.navigation.ProjectScreenContext
import io.github.mitzacoder.aiki.navigation.modelLabel
import io.github.mitzacoder.aiki.protocol.*
import io.github.mitzacoder.aiki.ui.components.Lucide
import io.github.mitzacoder.aiki.ui.components.LucideGlyph
import io.github.mitzacoder.aiki.ui.theme.Jarvis
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

/** A thinking level being saved; null inside is "Model default". */
private class ThinkingPick(val level: String?)

internal suspend fun BackendSession.configure(request: ProjectsConfigureRequest, nulls: Set<String> = emptySet()) {
    client.request(request, explicitNulls = nulls)
    refreshProjects()
}

/**
 * Project → Coordinator: which model the project's main agent runs on, and how hard it thinks. Each field saves the
 * moment it changes and says so beside itself; there is no form to submit.
 */
@Composable
internal fun CoordinatorSection(context: ProjectScreenContext, project: ProjectSummary, navigate: (Destination) -> Unit) {
    val backend = context.backend
    val models by backend.models.collectAsStateWithLifecycle()
    val catalog by backend.modelCatalog.collectAsStateWithLifecycle()
    val providers = catalog?.providers.orEmpty()
    val storedModel = project.coordinator.model?.let(::modelKey).orEmpty()
    val storedThinking = project.coordinator.thinkingLevel
    // The value on screen is the one being saved until the backend answers, so the control never jumps back.
    var pendingModel by remember(project.id) { mutableStateOf<String?>(null) }
    var pendingThinking by remember(project.id) { mutableStateOf<ThinkingPick?>(null) }
    val modelSave = rememberSaveState(project.id)
    val thinkingSave = rememberSaveState(project.id)
    val uiProofSave = rememberSaveState(project.id)
    var pendingUiProof by remember(project.id) { mutableStateOf<String?>(null) }
    val storedUiProof = project.uiProof
    val uiProofValue = pendingUiProof ?: storedUiProof ?: "screenshots-and-videos"
    val modelValue = pendingModel ?: storedModel
    val thinkingValue = pendingThinking?.let { it.level } ?: if (pendingThinking != null) null else storedThinking
    val options = remember(models, providers) { modelOptions(models, providers) }
    val info = models.firstOrNull { modelKey(it) == modelValue }
    val provider = info?.let { found -> providers.firstOrNull { it.id == found.provider } }

    fun pickModel(next: String) {
        val chosen = models.firstOrNull { modelKey(it) == next } ?: return
        // A level the new model lacks goes back to its default; one it has stays.
        val keep = validThinking(storedThinking, chosen)
        pendingModel = next
        if (keep != storedThinking) pendingThinking = ThinkingPick(null)
        modelSave.launch {
            try {
                val patch = coordinatorPatch(project.id, ModelRef(chosen.provider, chosen.modelId), keep)
                backend.configure(patch.request, patch.explicitNulls)
            } finally { pendingModel = null; pendingThinking = null }
        }
    }
    fun pickThinking(next: String?) {
        pendingThinking = ThinkingPick(next)
        thinkingSave.launch {
            try { backend.configure(ProjectsConfigureRequest(projectId = project.id, coordinatorThinkingLevel = next), setOfNotNull("coordinatorThinkingLevel".takeIf { next == null })) }
            finally { pendingThinking = null }
        }
    }

    fun pickUiProof(next: String) {
        pendingUiProof = next
        uiProofSave.launch {
            try { backend.client.configureProject(project.id, ProjectSetting.UiProof(next)); backend.refreshProjects() }
            finally { pendingUiProof = null }
        }
    }

    SettingsSectionPage("Coordinator", "The model this project's main agent runs on.", SettingsIcon.Cpu) {
        if (project.coordinator.model == null && pendingModel == null) ToneBanner(BannerTone.Warning) {
            Text("This project has no coordinator model, so it cannot start a conversation. Choose one below.", style = MaterialTheme.typography.bodySmall)
        }
        SettingsGroup(title = "Model") {
            SettingsRow(
                "Coordinator model", hint = "Type to search every model this backend offers.", status = modelSave,
                onRetry = { pickModel(pendingModel ?: modelValue) },
                learn = { Text("There are no model defaults: every project names its own coordinator. Workers and background threads pick their own models; see Workers.") },
                below = {
                    if (info != null) {
                        @OptIn(ExperimentalLayoutApi::class)
                        FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                            StatusChip(providerName(providers, info.provider) + if (provider?.configured == false) ": no credential" else "", if (provider?.configured == false) ChipTone.Warn else ChipTone.Ok)
                            StatusChip("${contextSize(info.contextWindow)} context", ChipTone.Muted, dot = false)
                            if (info.reasoning) StatusChip("Reasons", ChipTone.Muted, dot = false, icon = Lucide.Brain)
                            if ("image" in info.input) StatusChip("Sees images", ChipTone.Muted, dot = false, icon = Lucide.Image)
                        }
                        if (provider != null && !provider.configured) Row(Modifier.padding(top = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                            Text("${provider.name} has no credential on ${backend.config.name}, so requests will fail.", Modifier.weight(1f, fill = false), style = MaterialTheme.typography.bodySmall, color = Jarvis.colors.warning)
                            TextButton(onClick = { navigate(Destination.Settings(GeneralPage(GeneralSection.Backends, backend.config.key, accounts = true))) }) { Text("Add one") }
                        }
                    }
                },
            ) {
                Combobox(
                    options, modelValue, ::pickModel, "Coordinator model",
                    placeholder = if (models.isEmpty()) "Loading models…" else "Choose a model…", searchPlaceholder = "Search models or providers…",
                    emptyText = "No model matches.", enabled = models.isNotEmpty(), invalid = modelSave.status == SaveStatus.Failed,
                )
            }
            SettingsRow(
                "Thinking level", hint = if (info == null) "Choose a model to see its levels." else "How much the model reasons before it answers.",
                status = thinkingSave, onRetry = { pickThinking(thinkingValue) },
                learn = { Text("“Model default” leaves the level to the model. A higher level reasons longer: better on hard work, slower and dearer. The composer can still change it for one conversation.") },
            ) {
                ThinkingSelect(info?.thinkingLevels.orEmpty(), thinkingValue, ::pickThinking, enabled = info != null)
            }
        }
        // An older backend does not send the setting, so the group stays out.
        if (storedUiProof != null) SettingsGroup(title = "Show UI changes") {
            SettingsRow(
                "Prove UI work with", hint = "Agents show web and app changes before review; backends and terminals are never recorded.",
                status = uiProofSave, onRetry = { pickUiProof(uiProofValue) },
                learn = { Text("Any change a user can see in a web page or an app screen is shown before it goes to review: a bug before and after, using the real UI in a headless browser, emulator or device. The agent saves the pictures (and the recording) on the task. The coordinator works out how to demo this project once and keeps the recipe in memory. A change reaches the coordinator on its next turn and workers started after it.") },
            ) {
                Combobox(UI_PROOF_OPTIONS, uiProofValue, ::pickUiProof, "Show UI changes", invalid = uiProofSave.status == SaveStatus.Failed)
            }
        }
        ReportAuditSettings(backend, project)
    }
}

/** The choices of `uiProof`, in the web's order and words. */
private val UI_PROOF_OPTIONS = listOf(
    ComboOption("screenshots-and-videos", "Screenshots and videos", description = "Before/after screenshots and a short recording. The default."),
    ComboOption("screenshots", "Screenshots", description = "Before/after screenshots only."),
    ComboOption("off", "Off", description = "Agents are not asked to show UI changes."),
)

/**
 * Project → Workers: the ordered list of default worker models (each with the thinking level workers get on it) and the
 * coordinator's check-ins while workers run. Every edit saves at once; the project summary the backend answers with is what
 * shows, so another device's change appears here too.
 */
@Composable
internal fun WorkersSection(context: ProjectScreenContext, project: ProjectSummary) {
    val backend = context.backend
    val models by backend.models.collectAsStateWithLifecycle()
    val catalog by backend.modelCatalog.collectAsStateWithLifecycle()
    val providers = catalog?.providers.orEmpty()
    val scope = rememberCoroutineScope()
    val stored = project.workerModels
    var draft by remember(project.id, workerModelsSignature(stored)) { mutableStateOf(stored) }
    val modelsSave = rememberSaveState(project.id)
    // Saves run one at a time and always send the latest list, so a burst of taps cannot land out of order.
    val queue = remember(project.id) { Mutex() }
    var latest by remember(project.id) { mutableStateOf(stored) }
    fun persist(next: List<WorkerModel>) {
        draft = next; latest = next
        scope.launch {
            queue.withLock {
                val target = latest
                val ok = modelsSave.run { backend.configure(ProjectsConfigureRequest(projectId = project.id, workerModels = target)) }
                if (!ok) { draft = project.workerModels; latest = project.workerModels }
            }
        }
    }
    val addable = remember(models, providers, draft) { modelOptions(models.filter { model -> draft.none { sameModel(it, ModelRef(model.provider, model.modelId)) } }, providers) }
    fun levelsFor(model: WorkerModel) = models.firstOrNull { it.provider == model.provider && it.modelId == model.modelId }?.thinkingLevels ?: THINKING_ORDER

    val checkInsSave = rememberSaveState(project.id)
    val minutesSave = rememberSaveState(project.id)
    val resetSave = rememberSaveState(project.id)
    val checkIns = project.checkIns
    SettingsSectionPage("Workers", "Which models workers run on, and when the coordinator checks on them.", SettingsIcon.Users) {
        SettingsGroup(title = "Default worker models", description = "Tried in this order when nothing else names a model.") {
            if (draft.isEmpty()) GroupNote("None yet. The coordinator then has to name a model when it delegates, or you pick one in the composer.")
            draft.forEachIndexed { index, model -> key(modelKey(model.provider, model.modelId)) {
                val name = modelLabel(ModelRef(model.provider, model.modelId), models)
                GroupRow {
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        Box(Modifier.size(28.dp).background(Jarvis.colors.surface2, CircleShape), contentAlignment = Alignment.Center) {
                            Text("${index + 1}", style = MaterialTheme.typography.labelMedium, fontWeight = FontWeight.SemiBold, color = Jarvis.colors.fgMuted)
                        }
                        Column(Modifier.weight(1f)) {
                            Text(name, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                            Text(modelKey(model.provider, model.modelId), style = MaterialTheme.typography.labelMedium, fontFamily = FontFamily.Monospace, color = Jarvis.colors.fgMuted, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        }
                    }
                    Row(Modifier.padding(top = 10.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(2.dp)) {
                        ThinkingSelect(levelsFor(model), model.thinkingLevel, { level ->
                            val next = setWorkerModelThinkingLevel(draft, ModelRef(model.provider, model.modelId), level)
                            if (next != draft) persist(next)
                        }, Modifier.weight(1f), label = "Thinking level for $name")
                        SettingsAction("Move $name up", Lucide.ArrowUp, enabled = index > 0) { persist(moveWorkerModel(draft, index, -1)) }
                        SettingsAction("Move $name down", Lucide.ArrowDown, enabled = index < draft.lastIndex) { persist(moveWorkerModel(draft, index, 1)) }
                        SettingsAction("Remove $name", Lucide.X) { persist(removeWorkerModel(draft, ModelRef(model.provider, model.modelId))) }
                    }
                }
            } }
            SettingsRow(
                "Add a model", hint = "Pick one to put it at the end of the list.", status = modelsSave, onRetry = { persist(draft) },
                learn = { Text("New workers run on the model the coordinator names when it delegates, else the one picked in the composer, else the first of these that this backend offers. A model's thinking level applies unless the coordinator or the composer names one; “Model default” leaves it to the model.") },
            ) {
                Combobox(
                    addable, "", { key ->
                        val model = models.firstOrNull { modelKey(it) == key } ?: return@Combobox
                        persist(draft + WorkerModel(model.provider, model.modelId, null))
                    }, "Add a worker model",
                    placeholder = if (addable.isEmpty()) "Every model is in the list" else "Add a model…", searchPlaceholder = "Search models or providers…", enabled = addable.isNotEmpty(),
                )
            }
        }
        SettingsGroup(title = "Check-ins") {
            SettingsRow(
                "Wake the coordinator while workers run", hint = "A short digest of each worker, so it can steer one that is stuck.", control = RowControl.Inline, status = checkInsSave,
                learn = { Text("While at least one worker runs, the coordinator is woken every few minutes with each worker's status, how long since its last activity and its recent tool calls. The check-in waits for the coordinator's next turn instead of interrupting one, and nothing is sent while no worker runs.") },
            ) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    StatusChip(if (checkIns.enabled) "On" else "Off", if (checkIns.enabled) ChipTone.Ok else ChipTone.Muted)
                    SettingsSwitch(checkIns.enabled, { on ->
                        checkInsSave.launch { backend.configure(ProjectsConfigureRequest(projectId = project.id, checkIns = checkIns.copy(enabled = on))) }
                    }, "Wake the coordinator while workers run")
                }
            }
            SettingsRow("Every", hint = "Ten minutes by default; shorter costs more model turns.", control = RowControl.Auto, status = minutesSave) {
                AutoInput(checkIns.intervalMinutes.toString(), minutesSave, Modifier.widthIn(max = 160.dp), suffix = "minutes", enabled = checkIns.enabled, numeric = true, label = "Check-in interval in minutes") { text ->
                    val minutes = parseCheckInMinutes(text) ?: throw IllegalArgumentException("Enter a whole number of minutes between 1 and 1440.")
                    backend.configure(ProjectsConfigureRequest(projectId = project.id, checkIns = checkIns.copy(intervalMinutes = minutes)))
                }
            }
            SettingsRow("Defaults", hint = "Back to the backend's own check-in settings.", control = RowControl.Auto, status = resetSave) {
                OutlinedButton(modifier = Modifier.heightIn(min = 44.dp), onClick = {
                    resetSave.launch { backend.configure(ProjectsConfigureRequest(projectId = project.id), setOf("checkIns")) }
                }) { Text("Reset check-ins") }
            }
        }
    }
}
