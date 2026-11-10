package io.github.mitzacoder.aiki.features.tasks

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import io.github.mitzacoder.aiki.features.refs.RefChips
import io.github.mitzacoder.aiki.ui.components.LucideGlyph
import io.github.mitzacoder.aiki.ui.components.TaskStatusDot
import io.github.mitzacoder.aiki.ui.theme.Jarvis
import io.github.mitzacoder.aiki.ui.theme.Text as TextStyles

/**
 * One task in the Tasks list (web `TasksPanel.svelte` `taskRow`): its status dot (a ⚠ or ? under Needs you), the title
 * on up to two lines, the report line that matters for where it stands, its refs, and on the right the time over the ID.
 * Only rows that need the user get a wash: the warning's colour for a warning, the accent for a question. The whole row
 * opens the task's sheet; the ref chips open their own cards.
 */
@Composable
internal fun TaskListRow(row: TaskRow, now: Long, reducedMotion: Boolean, linksEnabled: Boolean = false, onOpen: () -> Unit) {
    val colors = Jarvis.colors
    val task = row.task
    val needsYou = row.section == TaskSectionId.NeedsYou
    val warned = row.waiting.any(::isWarning)
    val gist = rowGist(row)
    val wash = when {
        needsYou && warned -> colors.warning.copy(alpha = .09f)
        needsYou -> colors.accent2.copy(alpha = .08f)
        else -> null
    }
    Row(
        Modifier.fillMaxWidth()
            .then(if (wash != null) Modifier.background(wash) else Modifier)
            .clickable(role = Role.Button, onClickLabel = "Open ${task.id}", onClick = onOpen)
            .semantics(mergeDescendants = true) { contentDescription = "${task.id}: ${task.title}. ${rowTimeWords(row, now)}" }
            .padding(start = 12.dp, end = 10.dp, top = 10.dp, bottom = 10.dp),
        horizontalArrangement = Arrangement.spacedBy(10.dp),
        verticalAlignment = Alignment.Top,
    ) {
        Box(Modifier.size(width = 14.dp, height = 20.dp), contentAlignment = Alignment.Center) {
            when {
                needsYou && warned -> LucideGlyph(TaskIcons.TriangleAlert, size = 14.dp, tint = colors.warning)
                needsYou -> LucideGlyph(TaskIcons.CircleHelp, size = 14.dp, tint = colors.accent2)
                else -> TaskStatusDot(task.status, pulse = task.status == "in_progress" && !reducedMotion)
            }
        }
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(task.title, style = TaskType.rowTitle, color = if (row.section == TaskSectionId.Closed) colors.fgMuted else colors.fg, maxLines = 2, overflow = TextOverflow.Ellipsis)
            if (task.status == "waiting") Text(waitingSummary(task, now), style = TaskType.xs, color = colors.fgSubtle)
            else if (gist.isNotEmpty()) Text(gist, style = TextStyles.taskSm, color = colors.fgMuted, maxLines = 1, overflow = TextOverflow.Ellipsis)
            if (linksEnabled) TaskRelationChips(task)
            if (needsYou || task.refs.isNotEmpty()) {
                FlowRow(
                    Modifier.padding(top = 2.dp),
                    horizontalArrangement = Arrangement.spacedBy(6.dp),
                    verticalArrangement = Arrangement.spacedBy(4.dp),
                    itemVerticalAlignment = Alignment.CenterVertically,
                ) {
                    if (needsYou) {
                        val tone = colors.taskStatus(taskStatusTone(task.status))
                        Row(horizontalArrangement = Arrangement.spacedBy(4.dp), verticalAlignment = Alignment.CenterVertically) {
                            TaskStatusDot(task.status)
                            Text(taskStatusWords(task.status), style = TaskType.meta.copy(fontWeight = androidx.compose.ui.text.font.FontWeight.Medium), color = tone)
                        }
                        if (row.waiting.size > 1) Text("+${row.waiting.size - 1} more", style = TaskType.meta, color = colors.fgSubtle)
                    }
                    RefChips(task.refs, max = 2)
                }
            }
        }
        Column(Modifier.padding(top = 2.dp), horizontalAlignment = Alignment.End, verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(rowTime(row, now), style = TaskType.meta, color = colors.fgSubtle, maxLines = 1)
            Text(task.id, style = TaskType.metaMono, color = colors.fgSubtle.copy(alpha = .8f))
        }
    }
}

/** A row's shape while the board loads. */
@Composable
internal fun TaskRowSkeleton(titleWidth: Float, gistWidth: Float) {
    val shade = Jarvis.colors.surface2
    val round = androidx.compose.foundation.shape.RoundedCornerShape(4.dp)
    Row(Modifier.fillMaxWidth().padding(start = 12.dp, end = 10.dp, top = 10.dp, bottom = 10.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        Box(Modifier.size(width = 14.dp, height = 20.dp), contentAlignment = Alignment.Center) { Box(Modifier.size(8.dp).background(shade, androidx.compose.foundation.shape.CircleShape)) }
        Column(Modifier.weight(1f).padding(top = 4.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Box(Modifier.fillMaxWidth(titleWidth).height(14.dp).background(shade, round))
            Box(Modifier.fillMaxWidth(gistWidth).height(12.dp).background(shade, round))
        }
        Column(Modifier.padding(top = 4.dp), horizontalAlignment = Alignment.End, verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Box(Modifier.size(width = 36.dp, height = 10.dp).background(shade, round))
            Box(Modifier.size(width = 20.dp, height = 10.dp).background(shade, round))
        }
    }
}
