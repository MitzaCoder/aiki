package io.github.mitzacoder.aiki.features.tasks

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.unit.dp
import io.github.mitzacoder.aiki.protocol.BoardTimelineEntry
import io.github.mitzacoder.aiki.ui.theme.Jarvis

@Composable
internal fun TaskTimeline(entries: List<BoardTimelineEntry>) {
    var expanded by rememberSaveable { mutableStateOf(false) }
    var hidden by rememberSaveable { mutableStateOf(listOf<String>()) }
    TaskSection(TaskSectionKind.Timeline, count = entries.size.toString(), expanded = expanded, onToggle = { expanded = !expanded }) {
        if (expanded) {
            FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                TIMELINE_KINDS.forEach { (kind, label) ->
                    FilterChip(selected = kind !in hidden, onClick = { hidden = if (kind in hidden) hidden - kind else hidden + kind },
                        label = { Text("$label (${entries.count { it.kind == kind }})", style = TaskType.xs) })
                }
            }
            val visible = visibleTimeline(entries, hidden.toSet())
            if (visible.isEmpty()) Text("No timeline entries.", style = TaskType.xs, color = Jarvis.colors.fgSubtle)
            visible.forEach { entry ->
                FoldedCard {
                    Text(entry.label, style = TaskType.xsSemibold, color = Jarvis.colors.fg)
                    entry.detail?.let { ReportMarkdown(it) }
                    Text(listOfNotNull(entry.at, entry.ref).joinToString(" · "), style = TaskType.meta, color = Jarvis.colors.fgSubtle)
                }
            }
        }
    }
}
