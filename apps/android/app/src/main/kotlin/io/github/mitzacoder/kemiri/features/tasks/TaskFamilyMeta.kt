// Icons: Lucide (ISC); see LUCIDE-LICENSE.txt.
package io.github.mitzacoder.kemiri.features.tasks

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import io.github.mitzacoder.kemiri.protocol.BoardTaskBrief
import io.github.mitzacoder.kemiri.ui.components.Lucide
import io.github.mitzacoder.kemiri.ui.components.LucideGlyph
import io.github.mitzacoder.kemiri.ui.components.LucideIcon
import io.github.mitzacoder.kemiri.ui.theme.Jarvis
import io.github.mitzacoder.kemiri.ui.theme.Text as TextStyles

@Composable
internal fun TaskFamilyMeta(family: TaskFamily, nested: Boolean, archived: List<BoardTaskBrief>, summary: String, onToggle: () -> Unit) {
    val task = family.row.task
    val links = LocalTaskLinks.current
    val colors = Jarvis.colors
    val groups = linkGroups(task, emptyList(), archived)
    val parent = groups.firstOrNull { it.kind == "parent" }?.items?.firstOrNull()?.takeUnless { nested }
    val hints = groups.filter { it.kind in setOf("foundWhile", "blockedBy", "related") }
    val progress = task.subtaskCount?.takeIf { it.total > 0 }
    val feedback = openFeedbackCount(task)
    if (summary.isEmpty() && parent == null && hints.isEmpty() && progress == null && !family.canToggle && feedback == 0L) return
    FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(2.dp), itemVerticalAlignment = Alignment.CenterVertically) {
        if (summary.isNotEmpty()) Text(
            summary, style = if (task.status == "waiting") TaskType.xs else TextStyles.taskSm, color = colors.fgMuted,
            maxLines = if (task.status == "waiting") Int.MAX_VALUE else 1, overflow = TextOverflow.Ellipsis,
        )
        parent?.let { target ->
            val label = relationDescription("Subtask of", target, links?.title(target.id))
            FamilyRelationLink(label, links?.let { { it.open(target.id) } }) {
                Text("↳ ${target.id}", style = TaskType.meta, color = colors.fgSubtle)
            }
        }
        hints.forEach { group ->
            val icon = when (group.kind) {
                "foundWhile" -> FamilyIcons.FoundWhile
                "blockedBy" -> FamilyIcons.BlockedBy
                else -> FamilyIcons.Related
            }
            val labels = group.items.map { relationDescription(group.label, it, links?.title(it.id)) }
            var menuOpen by remember(task.id, group.kind) { mutableStateOf(false) }
            Box {
                FamilyRelationLink(labels.joinToString("; "), links?.let { {
                    if (group.items.size == 1) it.open(group.items.single().id) else menuOpen = true
                } }) {
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(3.dp)) {
                        LucideGlyph(icon, size = 12.dp, tint = colors.fgSubtle)
                        if (group.items.size > 1) Text("${group.items.size}", style = TaskType.meta, color = colors.fgSubtle)
                    }
                }
                DropdownMenu(expanded = menuOpen, onDismissRequest = { menuOpen = false }) {
                    group.items.forEachIndexed { index, target ->
                        DropdownMenuItem(text = { Text(labels[index]) }, onClick = { menuOpen = false; links?.open(target.id) })
                    }
                }
            }
        }
        if (progress != null || family.canToggle) {
            val label = progress?.let { "${it.done} of ${it.total} subtasks done" } ?: "Subtasks of ${task.id}"
            // Foundation clickable expands touch bounds to the platform's 48dp minimum without a layout column.
            Row(
                Modifier.background(colors.fgSubtle.copy(alpha = .08f), RoundedCornerShape(4.dp))
                    .then(if (family.canToggle) Modifier.clickable(role = Role.Button, onClickLabel = "${if (family.expanded) "Collapse" else "Expand"} subtasks of ${task.id}", onClick = onToggle) else Modifier)
                    .semantics(mergeDescendants = true) {
                        contentDescription = label
                        if (family.canToggle) stateDescription = if (family.expanded) "Expanded" else "Collapsed, ${family.foldedCount} folded subtasks"
                    }.padding(horizontal = 4.dp, vertical = 1.dp),
                verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp),
            ) {
                Canvas(Modifier.size(13.dp)) {
                    val inset = 1.dp.toPx()
                    val stroke = Stroke(1.5.dp.toPx())
                    val arcSize = Size(size.width - 2 * inset, size.height - 2 * inset)
                    drawArc(colors.fgSubtle.copy(alpha = .2f), -90f, 360f, false, Offset(inset, inset), arcSize, style = stroke)
                    drawArc(colors.fgSubtle, -90f, 360f * (subtaskFraction(task) ?: 0f), false, Offset(inset, inset), arcSize, style = stroke)
                }
                Text(progress?.let { "${it.done}/${it.total}" } ?: "Subtasks", style = TaskType.meta, color = colors.fgSubtle)
                if (family.canToggle) LucideGlyph(Lucide.ChevronRight, Modifier.rotate(if (family.expanded) 90f else 0f), size = 12.dp, tint = colors.fgSubtle)
            }
        }
        if (feedback > 0) Text("$feedback feedback", style = TaskType.meta, color = colors.fgSubtle)
    }
}

internal fun relationDescription(label: String, target: TaskLinkTarget, title: String? = null): String =
    "$label ${target.id}" + (title ?: target.title).takeIf { it.isNotEmpty() }?.let { ": $it" }.orEmpty() + if (target.archived) " (archived)" else ""

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun FamilyRelationLink(label: String, onOpen: (() -> Unit)?, content: @Composable () -> Unit) {
    TooltipBox(
        positionProvider = TooltipDefaults.rememberTooltipPositionProvider(TooltipAnchorPosition.Above),
        tooltip = { PlainTooltip { Text(label) } }, state = rememberTooltipState(),
    ) {
        Box(
            // clickable supplies the invisible minimum touch bounds; the glyph keeps its natural inline size.
            Modifier.then(if (onOpen == null) Modifier else Modifier.clickable(role = Role.Button, onClickLabel = label, onClick = onOpen))
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
