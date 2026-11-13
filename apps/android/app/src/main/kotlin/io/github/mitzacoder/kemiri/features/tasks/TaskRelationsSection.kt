package io.github.mitzacoder.kemiri.features.tasks

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.unit.dp
import io.github.mitzacoder.kemiri.protocol.*
import io.github.mitzacoder.kemiri.ui.theme.Jarvis
import io.github.mitzacoder.kemiri.ui.components.TaskStatusBadge

@Composable
internal fun TaskRelations(task: BoardTask, tasks: List<BoardTask>, archived: List<BoardTaskBrief>, onOpen: (String) -> Unit, onShowLinked: () -> Unit) {
    val groups = linkGroups(task, tasks, archived)
    if (groups.isEmpty()) return
    TaskSection(TaskSectionKind.Related, count = groups.sumOf { it.items.size }.toString(), metadata = {
        TextButton(onClick = onShowLinked) { Text("Show with linked", style = TaskType.xs) }
    }) {
        groups.forEach { group ->
            Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text(group.label, style = TaskType.xsSemibold, color = Jarvis.colors.fgMuted)
                if (group.kind == "subtasks") subtaskProgressText(task)?.let { text ->
                    Text(text, style = TaskType.meta, color = Jarvis.colors.fgSubtle)
                    LinearProgressIndicator(progress = { subtaskFraction(task) ?: 0f }, modifier = Modifier.fillMaxWidth(), color = Jarvis.colors.accent2, trackColor = Jarvis.colors.surface2)
                }
                group.items.forEach { target ->
                    Row(Modifier.fillMaxWidth().alpha(if (target.closed) .55f else 1f)
                        .clickable(onClickLabel = "Open ${target.id}") { onOpen(target.id) }
                        .heightIn(min = 44.dp).padding(horizontal = 6.dp, vertical = 4.dp),
                        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text(target.id, style = TaskType.metaMono, color = Jarvis.colors.fgSubtle)
                        Text(target.title, Modifier.weight(1f), style = TaskType.xs, color = Jarvis.colors.fg)
                        if (target.archived) Text("Archived", style = TaskType.meta, color = Jarvis.colors.fgSubtle)
                        else target.status?.let { TaskStatusBadge(it) }
                    }
                }
            }
        }
    }
}
