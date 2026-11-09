package com.mihaisaru.harness.features.chat

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.mihaisaru.harness.data.*
import com.mihaisaru.harness.navigation.ProjectScreenContext
import com.mihaisaru.harness.protocol.*
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch

internal fun workerDefaultsEditable(loaded: Boolean, ready: Boolean, saving: Boolean) = loaded && ready && !saving
internal fun coordinatorResetFields(model: ModelRef?, effort: String?) = buildSet {
    if(model == null) add("coordinatorModel")
    if(effort == null) add("coordinatorThinkingLevel")
}

@Composable internal fun ComposerSettings(context: ProjectScreenContext, modifier: Modifier = Modifier, threadModelNote: String? = null, onWorkerDefaults: (WorkerDefaults) -> Unit = {}) {
    val models by context.backend.models.collectAsStateWithLifecycle()
    val projects by context.backend.projects.collectAsStateWithLifecycle()
    val connection by context.backend.client.state.collectAsStateWithLifecycle()
    val project = projects.find { it.id == context.route.projectId }
    var workers by remember(context.route) { mutableStateOf(WorkerDefaults(null,null)) }
    var workersLoaded by remember(context.route) { mutableStateOf(false) }
    var savingWorker by remember(context.route) { mutableStateOf(false) }
    var savingCoordinator by remember(context.route) { mutableStateOf(false) }
    var error by remember(context.route) { mutableStateOf<String?>(null) }
    var revision by remember(context.route) { mutableIntStateOf(0) }
    var refresh by remember(context.route) { mutableIntStateOf(0) }
    val scope = rememberCoroutineScope()
    val ready = connection.status == ConnectionStatus.Ready
    val workerEnabled = workerDefaultsEditable(workersLoaded,ready,savingWorker)
    val onDefaults by rememberUpdatedState(onWorkerDefaults)
    // Project-wide settings must not silently change from a background thread, and its messages carry no worker defaults.
    val onMain = context.route.threadId == null || context.route.threadId == "main"
    LaunchedEffect(context.backend.client,context.route) {
        context.backend.client.events.collect { event ->
            if(event is WorkersStateEvent && event.projectId == context.route.projectId) {
                revision++; workers = event.defaults; workersLoaded = true
            }
        }
    }
    LaunchedEffect(connection,context.route,refresh) {
        // A disconnected/stale default cannot be used as the base of a whole-defaults write.
        workersLoaded = false
        if(onMain && ready && connection.supports("workers")) {
            val before = revision
            try {
                val defaults = context.backend.client.request(WorkersListRequest(projectId = context.route.projectId)).defaults
                if(before == revision) { workers = defaults; workersLoaded = true }
                error = null
            } catch(e: CancellationException) { throw e }
            catch(e: Exception) { if(before == revision) error = "Worker defaults unavailable: ${e.message}" }
        }
    }
    // Never publish guessed empty defaults before a snapshot/push has arrived.
    LaunchedEffect(workers,workersLoaded) { if(workersLoaded && onMain) onDefaults(workers) }
    fun saveWorker(value: WorkerDefaults) {
        if(!workerEnabled) return
        savingWorker = true
        val before = revision
        scope.launch {
            try {
                // WorkerDefaults fields are required nullable fields, encoded as explicit nulls.
                val saved = context.backend.client.request(WorkersDefaultsSetRequest(projectId = context.route.projectId,defaults = value)).defaults
                if(before == revision) { workers = saved; revision++ }
                error = null
            } catch(e: ClientException) {
                if(e.code == "unknown_request") {
                    if(before == revision) { workers = value; revision++ }
                    error = null // Legacy server: next submit carries this explicit override.
                } else error = e.message
            } catch(e: CancellationException) { throw e }
            catch(e: Exception) { error = e.message }
            finally { savingWorker = false }
        }
    }
    val providers = context.backend.modelCatalog.collectAsStateWithLifecycle().value?.providers.orEmpty()
    Column(modifier) {
        // A thread runs on its own model: the composer names it instead of offering pickers (web `modelNote`).
        if(!onMain) threadModelNote?.let { Text(it,style = MaterialTheme.typography.labelSmall,color = com.mihaisaru.harness.ui.theme.Jarvis.colors.fgSubtle,maxLines = 1,
            overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis,modifier = Modifier.padding(horizontal = 12.dp,vertical = 4.dp)) }
        else BoxWithConstraints(Modifier.fillMaxWidth()) {
        val layout = composerControlLayout(maxWidth.value,LocalDensity.current.fontScale)
        fun changeCoordinator(model: ModelRef?, effort: String?) {
            if(ready && project != null && !savingCoordinator) {
                savingCoordinator = true
                scope.launch {
                    try {
                        context.backend.client.request(ProjectsConfigureRequest(projectId = context.route.projectId,coordinatorModel = model,coordinatorThinkingLevel = effort),explicitNulls = coordinatorResetFields(model,effort))
                        context.backend.refreshProjects(); error = null
                    } catch(e: CancellationException) { throw e }
                    catch(e: Exception) { error = e.message }
                    finally { savingCoordinator = false }
                }
            }
        }
        if(composerControlsCompact(maxWidth.value,LocalDensity.current.fontScale)) {
            // One row on a phone: the model chip's name or, without room for all of it, its icon; the thinking and worker chips
            // are icons (their full text is their description).
            Row(Modifier.fillMaxWidth(),horizontalArrangement = Arrangement.spacedBy(0.dp),verticalAlignment = androidx.compose.ui.Alignment.CenterVertically) {
                ComposerModelChips(models,providers,project?.coordinator?.model,project?.coordinator?.thinkingLevel,onChange = ::changeCoordinator,
                    enabled = ready && project != null && !savingCoordinator,modifier = Modifier.weight(1f,fill = false),compact = true,iconOnlyEffort = true)
                if(ready && connection.supports("workers")) ComposerModelChips(models,providers,workers.model,workers.thinkingLevel,
                    onChange = { model,effort -> saveWorker(WorkerDefaults(model,effort)) },
                    enabled = workerEnabled && models.isNotEmpty(),worker = true,iconOnly = true,compact = true)
            }
        } else
        FlowRow(Modifier.fillMaxWidth(),horizontalArrangement = Arrangement.spacedBy(8.dp),verticalArrangement = Arrangement.spacedBy(0.dp)) {
            // The chips size to their text up to their share of the row, and wrap whole.
            ComposerModelChips(models,providers,project?.coordinator?.model,project?.coordinator?.thinkingLevel,
                onChange = ::changeCoordinator,enabled = ready && project != null && !savingCoordinator,modelWidthDp = layout.model,effortWidthDp = layout.effort)
            if(ready && connection.supports("workers")) ComposerModelChips(models,providers,workers.model,workers.thinkingLevel,
                onChange = { model,effort -> saveWorker(WorkerDefaults(model,effort)) },
                enabled = workerEnabled && models.isNotEmpty(),worker = true,modelWidthDp = layout.worker)
        }
        }
        error?.let { Text(it,color = MaterialTheme.colorScheme.error,modifier = Modifier.padding(horizontal = 16.dp)) }
        if(onMain && !workersLoaded && ready && error != null) TextButton(onClick = { refresh++ }) { Text("Retry worker defaults") }
    }
}
