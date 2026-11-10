package io.github.mitzacoder.aiki.features.tasks

import androidx.compose.foundation.layout.*
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedCard
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.github.mitzacoder.aiki.data.request
import io.github.mitzacoder.aiki.features.panels.panelData
import io.github.mitzacoder.aiki.features.panels.sortWorkers
import io.github.mitzacoder.aiki.navigation.ProjectScreenContext
import io.github.mitzacoder.aiki.protocol.*
import io.github.mitzacoder.aiki.ui.components.Lucide
import io.github.mitzacoder.aiki.ui.components.LucideGlyph
import io.github.mitzacoder.aiki.ui.components.StatusBadge
import io.github.mitzacoder.aiki.ui.theme.Jarvis

/**
 * The workers no task lists (web `LooseWorkers.svelte`): the coordinator started them without a task, so a task's
 * Workers section cannot reach them and this is the one place they open from. It sits at the bottom of every task view,
 * below the tasks. The running and idle ones are listed; the finished ones (failed, stopped, forgotten) fold under
 * "Finished (N)", which starts closed. Draws nothing when there are none.
 */
internal fun workersWithoutTask(workers: List<WorkerSummary>, taskWorkerIds: Collection<String>): List<WorkerSummary> {
    val owned = taskWorkerIds.toSet()
    return sortWorkers(workers.filter { it.id !in owned && it.taskId == null })
}

/** Failed, stopped or forgotten: nothing more will come of the worker (web `isFinishedWorker`). Running and idle ones are still in play. */
internal fun isFinishedWorker(status: String): Boolean = status == "failed" || status == "stopped" || status == "done"

/** The loose workers split into the ones in play and the finished ones, each keeping [workersWithoutTask]'s order. */
internal fun splitLooseWorkers(loose: List<WorkerSummary>): Pair<List<WorkerSummary>, List<WorkerSummary>> =
    loose.partition { !isFinishedWorker(it.status) }

@Composable
internal fun LooseWorkers(context: ProjectScreenContext, tasks: List<BoardTask>) {
    val project = context.route.projectId
    val connection by context.backend.client.state.collectAsStateWithLifecycle()
    if (!connection.supports("workers")) return
    val workers = panelData(context, "loose-workers", { it is WorkersStateEvent && it.projectId == project }) {
        context.backend.client.request(WorkersListRequest(projectId = project)).workers
    }.value.orEmpty()
    val loose = workersWithoutTask(workers, tasks.flatMap { it.workerIds })
    if (loose.isEmpty()) return
    val colors = Jarvis.colors
    val (active, finished) = splitLooseWorkers(loose)
    var finishedOpen by rememberSaveable(project) { mutableStateOf(false) }
    @Composable
    fun row(worker: WorkerSummary) = key(worker.threadId, worker.id) {
        OutlinedCard(onClick = { context.navigate(context.route.copy(threadId = worker.threadId, workerId = worker.id)) }, modifier = Modifier.fillMaxWidth(), shape = MaterialTheme.shapes.medium) {
            Row(Modifier.padding(horizontal = 12.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(worker.title.ifEmpty { worker.id }, Modifier.weight(1f), style = MaterialTheme.typography.titleSmall, maxLines = 1, overflow = TextOverflow.Ellipsis)
                StatusBadge(worker.status, domain = "worker")
                LucideGlyph(Lucide.ChevronRight, size = 14.dp, tint = colors.fgSubtle)
            }
        }
    }
    Column(Modifier.fillMaxWidth().semantics { contentDescription = "Workers without a task" }, verticalArrangement = Arrangement.spacedBy(6.dp)) {
        SectionTitle("Workers without a task", loose.size)
        active.forEach { row(it) }
        if (finished.isNotEmpty()) {
            FoldHeading("Finished (${finished.size})", finishedOpen, onToggle = { finishedOpen = !finishedOpen })
            if (finishedOpen) finished.forEach { row(it) }
        }
    }
}
