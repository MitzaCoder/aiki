package io.github.mitzacoder.aiki.features.chat

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import io.github.mitzacoder.aiki.features.tasks.TaskOption
import io.github.mitzacoder.aiki.ui.components.TaskStatusBadge
import io.github.mitzacoder.aiki.ui.theme.Jarvis

/**
 * The tasks the composer can attach to a message, as big rows a thumb can hit: open ones first (what needs the user, then
 * what runs), finished ones when a search asks for them. It sits right above the composer. The web's `TaskPicker`.
 */
@Composable internal fun TaskPicker(choices: List<TaskOption>, searching: Boolean, onPick: (TaskOption) -> Unit, modifier: Modifier = Modifier) {
    val shape = RoundedCornerShape(16.dp)
    Surface(modifier.fillMaxWidth().shadow(8.dp, shape).semantics { contentDescription = "Tasks" }, shape = shape, color = Jarvis.colors.bg, border = androidx.compose.foundation.BorderStroke(1.dp, Jarvis.colors.border)) {
        if (choices.isEmpty()) Text(if (searching) "No task matches." else "No open tasks.", Modifier.padding(horizontal = 16.dp, vertical = 14.dp), style = MaterialTheme.typography.bodyMedium, color = Jarvis.colors.fgSubtle)
        else LazyColumn(Modifier.heightIn(max = 288.dp).padding(4.dp)) {
            items(choices, key = { it.id }) { option ->
                Row(Modifier.fillMaxWidth().heightIn(min = 48.dp).clip(RoundedCornerShape(12.dp)).clickable(role = Role.Button, onClickLabel = "Attach ${option.id}") { onPick(option) }.padding(horizontal = 12.dp, vertical = 6.dp),
                    verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    Text(option.id, Modifier.widthIn(min = 36.dp), style = MaterialTheme.typography.labelMedium, fontFamily = FontFamily.Monospace, fontWeight = FontWeight.SemiBold, color = Jarvis.colors.accent2)
                    Text(option.title, Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    TaskStatusBadge(option.status)
                }
            }
        }
    }
}

/** The composer's task button: opens the picker; tinted while a task is attached or the picker is open. */
@Composable internal fun TaskPickerButton(active: Boolean, onClick: () -> Unit) {
    androidx.compose.material3.IconButton(onClick = onClick, modifier = Modifier.sizeIn(minWidth = 48.dp, minHeight = 48.dp)) {
        androidx.compose.foundation.layout.Box(Modifier.size(36.dp).clip(RoundedCornerShape(50)).background(if (active) Jarvis.colors.surface2 else androidx.compose.ui.graphics.Color.Transparent), contentAlignment = Alignment.Center) {
            io.github.mitzacoder.aiki.ui.components.LucideGlyph(ChatIcons.ClipboardList, size = 18.dp, contentDescription = "Message about a task", tint = if (active) Jarvis.colors.accent2 else Jarvis.colors.fgSubtle)
        }
    }
}
