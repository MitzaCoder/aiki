package io.github.mitzacoder.kemiri.features.tasks.graph

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.paneTitle
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import io.github.mitzacoder.kemiri.ui.theme.Jarvis

/** Selection is an ID, not a captured task: every watched replacement appears here without closing the panel. */
@Composable
internal fun GraphDetails(id: String, model: GraphModel, now: Long, onSelect: (String) -> Unit, onOpen: () -> Unit, onClose: () -> Unit, modifier: Modifier = Modifier) {
    val d = model.details[id]
    val colors = Jarvis.colors
    Column(modifier.semantics { paneTitle = "Task details" }.verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            Text(id, color = colors.fg, style = MaterialTheme.typography.titleLarge)
            TextButton(onClick = onClose, modifier = Modifier.heightIn(min = 48.dp)) { Text("Close") }
        }
        if (d == null) Text("This task is no longer on the board. Your selection is kept until you close it.", color = colors.fg)
        else {
            Text(d.task.title, color = colors.fg, style = MaterialTheme.typography.titleLarge, modifier = Modifier.semantics { heading() })
            val status = graphStatus(d.task.status)
            Text("${status.mark} ${status.label}", color = colors.fg)
            if (d.reasons.isNotEmpty()) {
                GraphDetailHeading("Needs you")
                d.reasons.forEach { reason ->
                    val mark = graphReasons.first { it.key == reason }
                    Text("${mark.mark} ${mark.label}", color = colors.fg)
                    when (reason) {
                        "blocked" -> d.task.blockedReason?.let { Text(it, color = colors.fg) }
                        "waiting" -> {
                            d.task.waiting?.note?.let { Text(it, color = colors.fg) }
                            d.task.waiting?.until?.let { Text("${graphWaitingDate(it, now)} · $it", color = colors.fg) }
                        }
                        "question" -> d.questions.forEach { Text("${it.kind ?: "question"}: ${it.text}", color = colors.fg) }
                        "failed" -> d.workers.filter { it.status == "failed" }.forEach { Text("${it.id}: ${it.failure ?: "Worker failed"}", color = colors.fg) }
                    }
                }
            }
            if (d.quiet) Text("◴ ${graphQuietAge(d.task.updatedAt, now)} · last updated ${d.task.updatedAt}", color = colors.fg)
            GraphDetailHeading("Family")
            Text(d.familyTitle, color = colors.fg)
            Text(d.progress, color = colors.fg)
            d.task.parent?.let { GraphTaskLinks("Parent", listOf(it), model, onSelect) }
            GraphTaskLinks("Subtasks", d.children, model, onSelect)
            GraphTaskLinks("Blocked by", d.task.blockedBy, model, onSelect)
            val holds = model.holdsUp(id)
            GraphTaskLinks("Holds up · ${holds.direct} direct", model.directDependents(id).toList(), model, onSelect)
            GraphTaskLinks("Holds up · ${holds.total - holds.direct} indirect", (model.allDependents(id) - model.directDependents(id)).toList(), model, onSelect)
            GraphDetailHeading("Workers and threads")
            if (d.workers.isEmpty() && d.threads.isEmpty()) Text("No workers or threads assigned.", color = colors.fg)
            d.workers.forEach { worker ->
                Text("${worker.id} · ${worker.title} · ${worker.status}", color = colors.fg)
                worker.lastReport?.takeIf { it.isNotBlank() }?.let { Text(it, color = colors.fg) }
                worker.failure?.let { Text(it, color = colors.fg) }
            }
            d.threads.forEach { thread ->
                Text("${thread.title} · ${thread.status}", color = colors.fg)
                (thread.current ?: thread.summary)?.let { Text(it, color = colors.fg) }
                thread.failure?.let { Text(it, color = colors.fg) }
            }
            GraphDetailHeading("Last report")
            val activity = io.github.mitzacoder.kemiri.features.tasks.taskActivity(d.task, io.github.mitzacoder.kemiri.features.tasks.LocalTaskActivityEnabled.current)
            if (activity != null) io.github.mitzacoder.kemiri.features.tasks.TaskActivityView(activity)
            else Text(d.task.report.now.ifBlank { "No report yet." }, color = colors.fg)
            if (d.task.report.results.isNotBlank()) Text(d.task.report.results, color = colors.fg)
            Button(onClick = onOpen, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) { Text("Open task") }
        }
        Spacer(Modifier.height(16.dp))
    }
}

@Composable
private fun GraphDetailHeading(text: String) {
    Text(text, color = Jarvis.colors.fg, style = MaterialTheme.typography.titleMedium, modifier = Modifier.padding(top = 8.dp).semantics { heading() })
}

@Composable
private fun GraphTaskLinks(title: String, ids: List<String>, model: GraphModel, onSelect: (String) -> Unit) {
    if (ids.isEmpty()) return
    GraphDetailHeading(title)
    ids.distinct().forEach { id ->
        TextButton(onClick = { onSelect(id) }, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) {
            Text("$id · ${model.details[id]?.task?.title ?: "Task not on this board"}", modifier = Modifier.fillMaxWidth())
        }
    }
}
