// Icons: Lucide (ISC); see LUCIDE-LICENSE.txt.
package io.github.mitzacoder.aiki.features.tasks

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import io.github.mitzacoder.aiki.protocol.BoardTask
import io.github.mitzacoder.aiki.protocol.BoardTaskBrief
import io.github.mitzacoder.aiki.ui.components.LucideGlyph
import io.github.mitzacoder.aiki.ui.components.LucideIcon
import io.github.mitzacoder.aiki.ui.theme.Jarvis

@Composable
internal fun TaskFamilyMeta(task: BoardTask, nested: Boolean, archived: List<BoardTaskBrief>) {
    val links = LocalTaskLinks.current
    val colors = Jarvis.colors
    val groups = linkGroups(task, emptyList(), archived)
    val parent = groups.firstOrNull { it.kind == "parent" }?.items?.firstOrNull()?.takeUnless { nested }
    val hints = groups.filter { it.kind in setOf("foundWhile", "blockedBy", "related") }
    val progress = task.subtaskCount?.takeIf { it.total > 0 }
    val feedback = openFeedbackCount(task)
    if (parent == null && hints.isEmpty() && progress == null && feedback == 0L) return
    FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(2.dp), itemVerticalAlignment = Alignment.CenterVertically) {
        parent?.let { target ->
            val label = "Subtask of ${target.id}" + (links?.title(target.id) ?: target.title).takeIf { it.isNotEmpty() }?.let { ": $it" }.orEmpty()
            FamilyRelationLink(label, links?.let { { it.open(target.id) } }) {
                Text("↳ ${target.id}", style = TaskType.meta, color = colors.fgSubtle)
            }
        }
        progress?.let { count ->
            Row(Modifier.semantics(mergeDescendants = true) { contentDescription = "${count.done} of ${count.total} subtasks done" }, verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                Canvas(Modifier.size(13.dp)) {
                    val inset = 1.dp.toPx()
                    val stroke = Stroke(1.5.dp.toPx())
                    val arcSize = Size(size.width - 2 * inset, size.height - 2 * inset)
                    drawArc(colors.fgSubtle.copy(alpha = .2f), -90f, 360f, false, Offset(inset, inset), arcSize, style = stroke)
                    drawArc(colors.fgSubtle, -90f, 360f * (subtaskFraction(task) ?: 0f), false, Offset(inset, inset), arcSize, style = stroke)
                }
                Text("${count.done}/${count.total} subtasks", style = TaskType.meta, color = colors.fgSubtle)
            }
        }
        hints.forEach { group ->
            val icon = when (group.kind) {
                "foundWhile" -> FamilyIcons.FoundWhile
                "blockedBy" -> FamilyIcons.BlockedBy
                else -> FamilyIcons.Related
            }
            group.items.forEach { target ->
                val label = "${group.label} ${target.id}" + (links?.title(target.id) ?: target.title).takeIf { it.isNotEmpty() }?.let { ": $it" }.orEmpty()
                FamilyRelationLink(label, links?.let { { it.open(target.id) } }) {
                    LucideGlyph(icon, size = 12.dp, tint = colors.fgSubtle)
                }
            }
        }
        if (feedback > 0) Text("$feedback feedback", style = TaskType.meta, color = colors.fgSubtle)
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun FamilyRelationLink(label: String, onOpen: (() -> Unit)?, content: @Composable () -> Unit) {
    TooltipBox(
        positionProvider = TooltipDefaults.rememberTooltipPositionProvider(TooltipAnchorPosition.Above),
        tooltip = { PlainTooltip { Text(label) } }, state = rememberTooltipState(),
    ) {
        Box(
            Modifier.heightIn(min = 32.dp).widthIn(min = 32.dp)
                .then(if (onOpen == null) Modifier else Modifier.clickable(role = Role.Button, onClickLabel = label, onClick = onOpen))
                .semantics(mergeDescendants = true) { contentDescription = label },
            contentAlignment = Alignment.CenterStart,
        ) { content() }
    }
}

private object FamilyIcons {
    val FoundWhile = LucideIcon("git-branch", "M6 3v12", "M15 6a3 3 0 1 0 6 0a3 3 0 1 0-6 0", "M6 15a3 3 0 1 0 0 6a3 3 0 0 0 0-6", "M18 9a9 9 0 0 1-9 9")
    val BlockedBy = LucideIcon("lock", "M5 11h14v10H5Z", "M8 11V7a4 4 0 0 1 8 0v4")
    val Related = LucideIcon("link", "M10 13a5 5 0 0 0 7 .54l3-3a5 5 0 0 0-7-7l-1.72 1.71", "M14 11a5 5 0 0 0-7-.54l-3 3a5 5 0 0 0 7 7l1.71-1.71")
}
