package io.github.mitzacoder.kemiri.features.tasks

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsFocusedAsState
import io.github.mitzacoder.kemiri.ui.components.Lucide
import io.github.mitzacoder.kemiri.ui.components.LucideGlyph
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import io.github.mitzacoder.kemiri.protocol.BoardTask
import io.github.mitzacoder.kemiri.protocol.BoardTaskWaiting
import io.github.mitzacoder.kemiri.ui.components.TaskStatusBadge
import io.github.mitzacoder.kemiri.ui.components.TaskStatusDot
import io.github.mitzacoder.kemiri.ui.theme.Jarvis
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneOffset
import io.github.mitzacoder.kemiri.features.tasks.board.compactRelativeTime

internal data class TaskStatusChoice(val status: String, val label: String, val hint: String)
internal val taskStatusChoices = listOf(
    TaskStatusChoice("todo", "To do", "Not started"),
    TaskStatusChoice("in_progress", "In progress", "Start or resume the work"),
    TaskStatusChoice("blocked", "Blocked", "Work cannot continue"),
    TaskStatusChoice("review", "Ready for review", "Ready for you to check"),
    TaskStatusChoice("waiting", "Waiting", "Work done; an external dependency remains"),
    TaskStatusChoice("done", "Done", "Close the task"),
    TaskStatusChoice("dropped", "Dropped", "This will not be done"),
)
internal fun waitingDateIn(days: Long, today: LocalDate = LocalDate.now()): String = today.plusDays(days).toString()
internal fun waitingSummary(task: BoardTask, now: Long = System.currentTimeMillis()): String = task.waiting?.let {
    val note = if (it.note.trimStart().startsWith("waiting for", ignoreCase = true)) it.note else "Waiting for ${it.note}"
    "$note · since ${compactRelativeTime(it.since, now)}" + (it.until?.let { date -> " · back on ${formatWaitingTime(date)}" } ?: "")
}.orEmpty()

@Composable
internal fun TaskStatusMenu(status: String, supportsWaiting: Boolean, enabled: Boolean, onPick: (String) -> Unit) {
    var expanded by remember { mutableStateOf(false) }
    if (!enabled) {
        TaskStatusBadge(status)
        return
    }
    val interactionSource = remember { MutableInteractionSource() }
    val focused by interactionSource.collectIsFocusedAsState()
    val chevronRotation by animateFloatAsState(if (expanded) 180f else 0f, label = "Status menu chevron")
    Box {
        OutlinedButton(
            onClick = { expanded = !expanded },
            interactionSource = interactionSource,
            modifier = Modifier.semantics {
                contentDescription = "Change task status: ${taskStatusWords(status)}"
                stateDescription = if (expanded) "Expanded" else "Collapsed"
            },
            shape = androidx.compose.foundation.shape.RoundedCornerShape(8.dp),
            border = BorderStroke(if (focused) 2.dp else 1.dp, if (focused) Jarvis.colors.accent2 else Jarvis.colors.borderStrong),
            colors = ButtonDefaults.outlinedButtonColors(
                containerColor = if (expanded) Jarvis.colors.surface2 else Jarvis.colors.surface,
                contentColor = Jarvis.colors.fg,
            ),
            contentPadding = PaddingValues(horizontal = 10.dp, vertical = 6.dp),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                TaskStatusDot(status)
                Text(taskStatusWords(status), style = TaskType.xs)
                LucideGlyph(Lucide.ChevronDown, modifier = Modifier.rotate(chevronRotation), size = 16.dp, tint = Jarvis.colors.fgMuted)
            }
        }
        DropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }, containerColor = Jarvis.colors.surface) {
            taskStatusChoices.filter { supportsWaiting || it.status != "waiting" }.forEach { choice ->
                DropdownMenuItem(
                    text = { Column { Text(choice.label, color = Jarvis.colors.fg); Text(choice.hint, style = TaskType.xs, color = Jarvis.colors.fgSubtle) } },
                    leadingIcon = { TaskStatusDot(choice.status) },
                    onClick = { expanded = false; onPick(choice.status) },
                )
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
internal fun TaskWaitingForm(waiting: BoardTaskWaiting?, busy: Boolean, workDayStart: String, onSave: (String, String?) -> Unit, onCancel: () -> Unit) {
    var note by remember { mutableStateOf(waiting?.note.orEmpty()) }
    var until by remember { mutableStateOf(waiting?.until?.let { localWaitingDate(it) }.orEmpty()) }
    var dateChanged by remember { mutableStateOf(false) }
    val resolved = if (!dateChanged && waiting?.until != null) waiting.until else resolveWaitingDate(until, workDayStart)
    var dateOpen by remember { mutableStateOf(false) }
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        OutlinedTextField(value = note, onValueChange = { note = it.take(2000) }, label = { Text("Waiting for… (required)") }, singleLine = true, modifier = Modifier.fillMaxWidth(), enabled = !busy)
        Text("Check again on (optional)", style = TaskType.xs, color = Jarvis.colors.fgMuted)
        FlowRow(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            listOf(1L to "Tomorrow", 3L to "In 3 days", 7L to "Next week").forEach { (days, label) ->
                TextButton(onClick = { until = waitingDateIn(days); dateChanged = true }, enabled = !busy) { Text(label) }
            }
            TextButton(onClick = { dateOpen = true }, enabled = !busy) { Text(until.ifEmpty { "Pick a date" }) }
            if (until.isNotEmpty()) TextButton(onClick = { until = ""; dateChanged = true }, enabled = !busy) { Text("No date") }
        }
        if (resolved != null) Text("Back on ${formatWaitingTime(resolved)}", style = TaskType.xs, color = Jarvis.colors.fgMuted)
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Button(onClick = { onSave(note.trim(), if (!dateChanged && waiting?.until != null) waiting.until else resolveWaitingDate(until, workDayStart)) }, enabled = !busy && note.isNotBlank()) { Text("Save") }
            TextButton(onClick = onCancel, enabled = !busy) { Text("Cancel") }
        }
    }
    if (dateOpen) {
        val state = rememberDatePickerState(initialSelectedDateMillis = until.takeIf { it.isNotEmpty() }?.let { LocalDate.parse(it).atStartOfDay().toInstant(ZoneOffset.UTC).toEpochMilli() })
        DatePickerDialog(onDismissRequest = { dateOpen = false }, confirmButton = {
            TextButton(onClick = { state.selectedDateMillis?.let { until = Instant.ofEpochMilli(it).atOffset(ZoneOffset.UTC).toLocalDate().toString(); dateChanged = true }; dateOpen = false }) { Text("Use date") }
        }, dismissButton = { TextButton(onClick = { dateOpen = false }) { Text("Cancel") } }) { DatePicker(state = state) }
    }
}
