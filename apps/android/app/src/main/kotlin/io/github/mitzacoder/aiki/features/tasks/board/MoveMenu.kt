package io.github.mitzacoder.aiki.features.tasks.board

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import io.github.mitzacoder.aiki.protocol.BoardTask
import io.github.mitzacoder.aiki.ui.components.Lucide
import io.github.mitzacoder.aiki.ui.components.LucideGlyph
import io.github.mitzacoder.aiki.ui.components.LucideIcon
import io.github.mitzacoder.aiki.ui.components.TaskStatusDot
import io.github.mitzacoder.aiki.ui.theme.Jarvis
import io.github.mitzacoder.aiki.ui.theme.textStyle

/** In To do: where the card is among the shown cards and how many there are, for the priority moves. */
data class TodoPosition(val index: Int, val count: Int)

/**
 * A card's "Move to…" menu (web `TaskMoveMenu.svelte`): every status the user may move the task to (never Ready for
 * review, which the agents fill), and in To do its place in the priority order. The way to move a card on a phone,
 * and by TalkBack anywhere.
 */
@Composable
fun MoveMenu(task: BoardTask, position: TodoPosition?, onMove: (String) -> Unit, onReorder: (Int) -> Unit) {
    var open by remember { mutableStateOf(false) }
    val colors = Jarvis.colors
    val caption = textStyle(0.6875f, 1f / 0.6875f, weight = 600)
    fun pick(action: () -> Unit) { open = false; action() }
    Box {
        IconButton(onClick = { open = true }, modifier = Modifier.size(36.dp)) {
            LucideGlyph(BoardGlyphs.Move, size = 15.dp, tint = if (open) colors.fg else colors.fgSubtle, contentDescription = "Move ${task.id}: ${task.title}")
        }
        DropdownMenu(open, onDismissRequest = { open = false }, modifier = Modifier.widthIn(min = 240.dp)) {
            Text("Move ${task.id} to…", Modifier.padding(horizontal = 16.dp, vertical = 6.dp), style = caption, color = colors.fgSubtle)
            moveChoices(task.status).forEach { choice ->
                DropdownMenuItem(
                    text = {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Text(choice.label, Modifier.weight(1f), style = textStyle(0.8125f, 1.4f, weight = 500), color = colors.fg)
                            Text(choice.hint, style = textStyle(0.6875f, 1f / 0.6875f), color = colors.fgSubtle)
                        }
                    },
                    leadingIcon = { TaskStatusDot(choice.target) },
                    onClick = { pick { onMove(choice.target) } },
                )
            }
            if (position != null && position.count > 1) {
                HorizontalDivider(Modifier.padding(vertical = 4.dp), color = colors.border)
                Text("Priority", Modifier.padding(horizontal = 16.dp, vertical = 4.dp), style = caption, color = colors.fgSubtle)
                PriorityItem("To the top", BoardGlyphs.ArrowUpToLine, position.index > 0) { pick { onReorder(0) } }
                PriorityItem("Up one", Lucide.ArrowUp, position.index > 0) { pick { onReorder(position.index - 1) } }
                PriorityItem("Down one", Lucide.ArrowDown, position.index < position.count - 1) { pick { onReorder(position.index + 1) } }
            }
            Text(
                "The coordinator hears about every move. Only the agents put a task up for review.",
                Modifier.widthIn(max = 260.dp).padding(horizontal = 16.dp, vertical = 6.dp),
                style = textStyle(0.6875f, 1f / 0.6875f),
                color = colors.fgSubtle,
            )
        }
    }
}

@Composable
private fun PriorityItem(label: String, icon: LucideIcon, enabled: Boolean, onClick: () -> Unit) {
    DropdownMenuItem(
        text = { Text(label, style = textStyle(0.8125f, 1.4f)) },
        leadingIcon = { LucideGlyph(icon, size = 14.dp, tint = Jarvis.colors.fgSubtle) },
        enabled = enabled,
        onClick = onClick,
    )
}
