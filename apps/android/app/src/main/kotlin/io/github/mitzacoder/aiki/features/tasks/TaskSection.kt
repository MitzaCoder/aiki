// Additional icons are from Lucide, ISC license; see LUCIDE-LICENSE.txt.
package io.github.mitzacoder.aiki.features.tasks

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.unit.dp
import io.github.mitzacoder.aiki.ui.components.Lucide
import io.github.mitzacoder.aiki.ui.components.LucideGlyph
import io.github.mitzacoder.aiki.ui.components.LucideIcon
import io.github.mitzacoder.aiki.ui.theme.Jarvis
import io.github.mitzacoder.aiki.ui.theme.textStyle

internal enum class TaskSectionKind(val title: String, val icon: LucideIcon) {
    Report("Report", LucideIcon("activity", "M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2")),
    Questions("Questions", TaskIcons.CircleHelp),
    Feedback("Feedback", LucideIcon("message-square", "M21 15a4 4 0 0 1-4 4H7l-4 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4Z")),
    Related("Related", LucideIcon("git-branch", "M6 3v12", "M15 6a3 3 0 1 0 6 0a3 3 0 1 0-6 0", "M6 15a3 3 0 1 0 0 6a3 3 0 0 0 0-6", "M18 9a9 9 0 0 1-9 9")),
    Workers("Workers", Lucide.Users),
    Decisions("Decisions", LucideIcon("scale", "M12 3v17", "M5 20h14", "M4 7h16", "M6 7l-4 7h8Z", "M18 7l-4 7h8Z")),
    Timeline("Timeline", LucideIcon("list-tree", "M8 3v12a3 3 0 0 0 3 3h2", "M8 8h5", "M16 8h5", "M16 18h5")),
    Files("Files", Lucide.Image),
    History("History", Lucide.Clock),
    Brief("Brief", Lucide.FileText),
}

/** Dashboard surface and heading shared by all task sections; data and actions remain with their original owners. */
@Composable
internal fun TaskSection(
    kind: TaskSectionKind,
    modifier: Modifier = Modifier,
    count: String? = null,
    expanded: Boolean? = null,
    onToggle: (() -> Unit)? = null,
    metadata: (@Composable () -> Unit)? = null,
    content: @Composable ColumnScope.() -> Unit,
) {
    val colors = Jarvis.colors
    Surface(
        modifier.fillMaxWidth(), shape = RoundedCornerShape(14.dp), color = colors.surface, contentColor = colors.fg,
        border = BorderStroke(1.dp, if (kind == TaskSectionKind.Report) colors.accent2.copy(alpha = .3f) else colors.border),
        shadowElevation = 1.dp,
    ) {
        Column {
            val toggle = if (onToggle == null) Modifier else Modifier
                .clickable(role = Role.Button, onClickLabel = if (expanded == true) "Fold ${kind.title}" else "Open ${kind.title}", onClick = onToggle)
                .semantics { stateDescription = if (expanded == true) "Open" else "Folded" }
            Row(
                Modifier.fillMaxWidth().background(colors.accent2.copy(alpha = .055f)).then(toggle)
                    .heightIn(min = 52.dp).padding(horizontal = 14.dp, vertical = 10.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                LucideGlyph(kind.icon, size = 18.dp, tint = colors.accent2)
                // Natural heading width first. Free-form metadata gets only the remaining space (T31).
                Text(kind.title, Modifier.semantics { heading() }, style = textStyle(1f, 1.4f, weight = 700), color = colors.fg)
                count?.let {
                    Text(it, Modifier.background(colors.accent2.copy(alpha = .12f), RoundedCornerShape(50)).padding(horizontal = 7.dp, vertical = 2.dp),
                        style = TaskType.meta, color = colors.accent2)
                }
                if (metadata != null) Box(Modifier.weight(1f, fill = false), contentAlignment = Alignment.CenterEnd) { metadata() }
                else Spacer(Modifier.weight(1f))
                if (onToggle != null) LucideGlyph(Lucide.ChevronRight, Modifier.rotate(if (expanded == true) 90f else 0f), size = 16.dp, tint = colors.fgSubtle)
            }
            if (expanded != false) {
                androidx.compose.material3.HorizontalDivider(color = colors.border)
                Column(Modifier.fillMaxWidth().padding(14.dp), verticalArrangement = Arrangement.spacedBy(12.dp), content = content)
            }
        }
    }
}
