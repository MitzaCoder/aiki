package io.github.mitzacoder.aiki.features.tasks

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.selection.selectable
import androidx.compose.ui.Alignment
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import io.github.mitzacoder.aiki.ui.components.LucideGlyph
import io.github.mitzacoder.aiki.ui.components.LucideIcon
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import io.github.mitzacoder.aiki.data.request
import io.github.mitzacoder.aiki.navigation.ProjectScreenContext
import io.github.mitzacoder.aiki.protocol.BoardReportStaleRequest
import io.github.mitzacoder.aiki.ui.theme.Jarvis
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch

@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun ReportStaleAction(context: ProjectScreenContext, taskId: String, onMarked: () -> Unit) {
    var open by remember(taskId) { mutableStateOf(false) }
    var sections by remember(taskId) { mutableStateOf(listOf("results", "next")) }
    var reason by remember(taskId) { mutableStateOf("") }
    var busy by remember(taskId) { mutableStateOf(false) }
    var problem by remember(taskId) { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    val label = "This looks out of date"
    TooltipBox(positionProvider = TooltipDefaults.rememberPlainTooltipPositionProvider(), tooltip = { PlainTooltip { Text(label) } }, state = rememberTooltipState()) {
        IconButton(onClick = { open = true; problem = null }, modifier = Modifier.size(48.dp).semantics { contentDescription = label }) {
            LucideGlyph(LucideIcon("message-square-warning", "M21 15a4 4 0 0 1-4 4H7l-4 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4Z", "M12 7v4", "M12 15h.01"), size = 18.dp, tint = Jarvis.colors.fgMuted)
        }
    }
    if (open) AlertDialog(
        onDismissRequest = { if (!busy) open = false },
        title = { Text("This looks out of date") },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("Ask the agents to update the report. The task status stays the same.")
                listOf("Both sections" to listOf("results", "next"), "Results" to listOf("results"), "Next" to listOf("next")).forEach { (label, selection) ->
                    Row(Modifier.fillMaxWidth().heightIn(min = 48.dp).selectable(selected = sections == selection, enabled = !busy, role = Role.RadioButton, onClick = { sections = selection }), verticalAlignment = Alignment.CenterVertically) {
                        RadioButton(selected = sections == selection, onClick = null)
                        Text(label, Modifier.padding(12.dp))
                    }
                }
                OutlinedTextField(value = reason, onValueChange = { if (it.length <= 160) reason = it }, enabled = !busy,
                    maxLines = 3, label = { Text("Reason (optional)") }, supportingText = { Text("${reason.length}/160") }, modifier = Modifier.fillMaxWidth())
                problem?.let { Text(it, color = Jarvis.colors.danger) }
            }
        },
        confirmButton = {
            TextButton(enabled = !busy, onClick = {
                busy = true
                problem = null
                scope.launch {
                    try {
                        context.backend.client.request(BoardReportStaleRequest(projectId = context.route.projectId, taskId = taskId,
                            sections = sections, reason = reason.trim().takeIf { it.isNotEmpty() }))
                        onMarked()
                        open = false
                    } catch (cause: CancellationException) { throw cause }
                    catch (cause: Exception) { problem = cause.message ?: "Could not mark the report" }
                    finally { busy = false }
                }
            }, modifier = Modifier.heightIn(min = 48.dp)) { Text(if (busy) "Marking…" else "Mark out of date") }
        },
        dismissButton = { TextButton(onClick = { open = false }, enabled = !busy, modifier = Modifier.heightIn(min = 48.dp)) { Text("Cancel") } },
    )
}
