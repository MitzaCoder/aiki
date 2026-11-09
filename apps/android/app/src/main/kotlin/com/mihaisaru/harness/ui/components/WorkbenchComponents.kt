package com.mihaisaru.harness.ui.components

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.animation.core.*
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.ui.draw.drawBehind
import com.mihaisaru.harness.features.tasks.taskStatusTone
import com.mihaisaru.harness.features.tasks.taskStatusWords
import com.mihaisaru.harness.ui.theme.Jarvis
import com.mihaisaru.harness.ui.theme.TaskStatusTone
import com.mihaisaru.harness.ui.theme.textStyle

enum class StatusTone { Neutral, Active, Success, Warning, Danger, Subtle }
/** A status as a badge shows it; [icon] null draws the words alone, as the web's worker and thread badges do. */
data class WorkbenchStatus(val label: String, val tone: StatusTone, val icon: LucideIcon?)

/**
 * A status' words, tone and icon. Workers read as the web's `workerStatusLabel` (lower case: "running", "idle") and
 * threads as `threadStatusLabel` ("Working", "Waiting", "Finished"); both show only a spinner while running.
 */
fun workbenchStatus(status: String, domain: String = "task"): WorkbenchStatus = when (domain) {
    "worker" -> when (status) {
        "running" -> WorkbenchStatus("running", StatusTone.Active, Lucide.LoaderCircle)
        "failed" -> WorkbenchStatus("failed", StatusTone.Danger, null)
        "stopped" -> WorkbenchStatus("stopped", StatusTone.Warning, null)
        "done" -> WorkbenchStatus("done", StatusTone.Subtle, null)
        else -> WorkbenchStatus(status.replace('_', ' '), StatusTone.Neutral, null)
    }
    "thread" -> when (status) {
        "running" -> WorkbenchStatus("Working", StatusTone.Active, Lucide.LoaderCircle)
        "idle" -> WorkbenchStatus("Waiting", StatusTone.Neutral, null)
        "failed" -> WorkbenchStatus("Failed", StatusTone.Danger, null)
        "stopped" -> WorkbenchStatus("Stopped", StatusTone.Subtle, null)
        "done" -> WorkbenchStatus("Finished", StatusTone.Success, null)
        else -> WorkbenchStatus(status.replace('_', ' ').replaceFirstChar { it.uppercase() }, StatusTone.Neutral, null)
    }
    else -> when (status) {
        "in_progress" -> WorkbenchStatus("In progress", StatusTone.Active, Lucide.Clock)
        "running" -> WorkbenchStatus("Running", StatusTone.Active, Lucide.LoaderCircle)
        "idle" -> WorkbenchStatus("Idle", StatusTone.Neutral, Lucide.Clock)
        "todo" -> WorkbenchStatus("To do", StatusTone.Neutral, Lucide.Square)
        "blocked" -> WorkbenchStatus("Blocked", StatusTone.Danger, Lucide.CircleAlert)
        "review" -> WorkbenchStatus("Review", StatusTone.Warning, Lucide.Search)
        "open" -> WorkbenchStatus("Needs you", StatusTone.Warning, Lucide.CircleAlert)
        "done" -> WorkbenchStatus("Done", StatusTone.Neutral, Lucide.Check)
        "answered" -> WorkbenchStatus("Answered", StatusTone.Success, Lucide.Check)
        "failed" -> WorkbenchStatus("Failed", StatusTone.Danger, Lucide.CircleAlert)
        else -> WorkbenchStatus(status.replace('_', ' ').replaceFirstChar { it.uppercase() }, StatusTone.Neutral, Lucide.Square)
    }
}

/** A worker's, thread's or old board's status as an outlined pill in the theme's tones (web `WorkerStatusBadge`, `ThreadStatusBadge`). */
@Composable fun StatusBadge(status: String, modifier: Modifier = Modifier, domain: String = "task") {
    val value = workbenchStatus(status, domain)
    val colors = Jarvis.colors
    val color = when (value.tone) {
        StatusTone.Active -> colors.accent2
        StatusTone.Success -> colors.success
        StatusTone.Warning -> colors.warning
        StatusTone.Danger -> colors.danger
        StatusTone.Neutral -> colors.fgMuted
        StatusTone.Subtle -> colors.fgSubtle
    }
    val coloured = value.tone == StatusTone.Active || value.tone == StatusTone.Success || value.tone == StatusTone.Warning || value.tone == StatusTone.Danger
    val fill = when {
        coloured -> color.copy(alpha = if (domain == "worker" && value.tone == StatusTone.Active) .15f else .10f)
        domain == "thread" && status == "idle" -> colors.surface2
        else -> androidx.compose.ui.graphics.Color.Transparent
    }
    val border = when {
        domain == "worker" && value.tone == StatusTone.Active -> androidx.compose.ui.graphics.Color.Transparent
        coloured -> color.copy(alpha = .40f)
        else -> colors.border
    }
    Surface(modifier, shape = RoundedCornerShape(50), color = fill, contentColor = color, border = BorderStroke(1.dp, border)) {
        Row(Modifier.padding(horizontal = 8.dp).heightIn(min = 20.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            if (status == "running" && value.icon != null) {
                val transition = rememberInfiniteTransition(label = "working status")
                val rotation by transition.animateFloat(0f, 360f, infiniteRepeatable(tween(1400, easing = LinearEasing)), label = "working indicator")
                LucideGlyph(value.icon, modifier = Modifier.rotate(rotation), size = 12.dp)
            } else value.icon?.let { LucideGlyph(it, size = 12.dp) }
            Text(value.label, style = textStyle(0.75f, 1f / 0.75f, weight = 500), maxLines = 1)
        }
    }
}

@Composable fun IconAction(label: String, icon: LucideIcon, enabled: Boolean = true, onClick: () -> Unit) {
    IconButton(onClick = onClick, enabled = enabled) { LucideGlyph(icon, size = 18.dp, contentDescription = label) }
}

@Composable fun WorkbenchEmpty(title: String, description: String, icon: LucideIcon = Lucide.Info, modifier: Modifier = Modifier) {
    Column(modifier.fillMaxWidth().padding(vertical = 28.dp, horizontal = 16.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Surface(shape = MaterialTheme.shapes.large, color = MaterialTheme.colorScheme.surfaceContainerHigh) { Box(Modifier.padding(14.dp)) { LucideGlyph(icon, size = 24.dp, tint = MaterialTheme.colorScheme.onSurfaceVariant) } }
        Text(title, style = MaterialTheme.typography.titleSmall)
        Text(description, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, textAlign = androidx.compose.ui.text.style.TextAlign.Center)
    }
}

/**
 * A task status' small round marker (web `.task-status-dot`): its tone's colour, a ring for to do so it never reads as
 * working in a theme without colour. [pulse] lets a working task's dot breathe; motion is opt-in, like the orb's.
 */
@Composable fun TaskStatusDot(tone: TaskStatusTone, modifier: Modifier = Modifier, pulse: Boolean = false) {
    val color = Jarvis.colors.taskStatus(tone)
    val halo = if (pulse) {
        val transition = rememberInfiniteTransition(label = "task status pulse")
        transition.animateFloat(0f, 1f, infiniteRepeatable(tween(2400, easing = FastOutSlowInEasing), RepeatMode.Reverse), label = "task status halo").value
    } else 0f
    val dot = modifier.size(7.dp).drawBehind {
        if (halo > 0f) drawCircle(color.copy(alpha = .45f * (1f - halo)), radius = size.minDimension / 2 + 3.5.dp.toPx() * halo)
    }
    if (tone == TaskStatusTone.Todo) Box(dot.border(1.5.dp, color, CircleShape))
    else Box(dot.background(color, CircleShape))
}

@Composable fun TaskStatusDot(status: String, modifier: Modifier = Modifier, pulse: Boolean = false) =
    TaskStatusDot(taskStatusTone(status), modifier, pulse)

/** A task's status as a pill (web `.task-status-badge`): a dot and its words in the tone's colour, a wash of it behind. */
@Composable fun TaskStatusBadge(status: String, modifier: Modifier = Modifier) {
    val tone = taskStatusTone(status)
    val color = Jarvis.colors.taskStatus(tone)
    Surface(modifier, shape = RoundedCornerShape(50), color = color.copy(alpha = .12f), contentColor = color, border = BorderStroke(1.dp, color.copy(alpha = .40f))) {
        Row(Modifier.padding(horizontal = 8.dp).heightIn(min = 20.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            TaskStatusDot(tone)
            Text(taskStatusWords(status), style = textStyle(0.6875f, 1.25f / 0.6875f, weight = 500), maxLines = 1)
        }
    }
}
