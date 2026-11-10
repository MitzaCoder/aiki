package io.github.mitzacoder.aiki.features.tasks

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import io.github.mitzacoder.aiki.ui.components.TaskStatusDot
import io.github.mitzacoder.aiki.ui.theme.Jarvis

/**
 * A task the sheet names, as in its "Waits for" line (web `TaskSheet.svelte`'s blocker links): its status dot from the
 * board, its ID and, when [withTitle], its title. Tasks named in chat lines are the chat's `TaskPill` (web
 * `chat/TaskChip.svelte`). Opens the task's sheet when [LocalTaskLinks] knows it; a task the board does not hold
 * (archived, or before the board loads) reads as a plain ID.
 */
@Composable
fun TaskChip(taskId: String, modifier: Modifier = Modifier, withTitle: Boolean = true, onOpen: (() -> Unit)? = null) {
    val links = LocalTaskLinks.current
    val colors = Jarvis.colors
    val title = links?.title(taskId)
    val status = links?.status(taskId)
    val open = onOpen ?: links?.takeIf { it.knows(taskId) }?.let { { it.open(taskId) } }
    val label = if (withTitle && !title.isNullOrEmpty()) "$taskId · $title" else taskId
    val content: @Composable () -> Unit = {
        Row(Modifier.padding(horizontal = 6.dp, vertical = 2.dp), horizontalArrangement = Arrangement.spacedBy(5.dp), verticalAlignment = Alignment.CenterVertically) {
            status?.let { TaskStatusDot(it) }
            Text(label, style = TaskType.xs, color = colors.fgMuted, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
    }
    val shape = RoundedCornerShape(6.dp)
    val border = BorderStroke(1.dp, colors.border)
    val described = modifier.semantics { contentDescription = if (open != null) "Open $label" else label }
    if (open != null) Surface(onClick = open, modifier = described.heightIn(min = 32.dp), shape = shape, color = colors.surface.copy(alpha = 0f), border = border) {
        Box(contentAlignment = Alignment.CenterStart) { content() }
    }
    else Surface(described, shape = shape, color = colors.surface.copy(alpha = 0f), border = border, content = content)
}
