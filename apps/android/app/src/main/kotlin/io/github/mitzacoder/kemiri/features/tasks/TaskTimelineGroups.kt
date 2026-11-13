package io.github.mitzacoder.kemiri.features.tasks

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.unit.dp
import io.github.mitzacoder.kemiri.protocol.BoardTimelineGroup
import io.github.mitzacoder.kemiri.ui.components.LucideGlyph
import io.github.mitzacoder.kemiri.ui.components.LucideIcon
import io.github.mitzacoder.kemiri.ui.theme.Jarvis

@Composable
internal fun TimelineGroup(group: BoardTimelineGroup, expanded: Boolean, onToggle: () -> Unit) {
    val colors = Jarvis.colors
    val tone = when (timelineGroupTone(group)) {
        "danger" -> colors.danger
        "warning" -> colors.warning
        "success" -> colors.success
        else -> colors.fgMuted
    }
    val kind = timelineGroupKind(group.kind)
    val range = timelineRange(group.range.start, group.range.end)
    val count = "${group.factCount} ${if (group.factCount == 1L) "fact" else "facts"}"
    Surface(onClick = onToggle, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp).semantics {
        contentDescription = "$range, $kind, $count, ${group.label}"
        stateDescription = if (expanded) "Expanded" else "Collapsed"
    }, color = colors.surface) {
        Row(Modifier.padding(vertical = 10.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            LucideGlyph(when {
                timelineGroupTone(group) == "danger" -> TaskIcons.TriangleAlert
                timelineGroupTone(group) == "warning" -> TaskIcons.CircleHelp
                group.kind == "decisions" -> TaskSectionKind.Decisions.icon
                group.kind == "delivery" -> LucideIcon("flag", "M4 22V3", "M4 3c4-4 12 4 16 0v12c-4 4-12-4-16 0")
                else -> TaskSectionKind.Report.icon
            }, size = 18.dp, tint = tone)
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                Text("$range · $kind", style = TaskType.meta, color = colors.fgSubtle)
                Text(group.label, style = TaskType.xsSemibold, color = tone)
                Text(count, style = TaskType.meta, color = colors.fgSubtle)
            }
            Text(if (expanded) "⌄" else "›", style = TaskType.xs, color = colors.fgMuted)
        }
    }
    HorizontalDivider(color = colors.border.copy(alpha = .55f))
}
