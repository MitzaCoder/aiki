// Additional Lucide icons: ISC license; see LUCIDE-LICENSE.txt.
package io.github.mitzacoder.kemiri.features.tasks

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import io.github.mitzacoder.kemiri.features.status.exactTime
import io.github.mitzacoder.kemiri.features.status.relativeTime
import io.github.mitzacoder.kemiri.protocol.BoardTimelineEntry
import io.github.mitzacoder.kemiri.protocol.BoardTimelineGroup
import io.github.mitzacoder.kemiri.protocol.BoardWriter
import io.github.mitzacoder.kemiri.ui.components.JarvisIconButton
import io.github.mitzacoder.kemiri.ui.components.Lucide
import io.github.mitzacoder.kemiri.ui.components.LucideGlyph
import io.github.mitzacoder.kemiri.ui.components.LucideIcon
import io.github.mitzacoder.kemiri.ui.theme.Jarvis

@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun TaskTimeline(entries: List<BoardTimelineEntry>, newestFirst: Boolean, onToggleOrder: () -> Unit, writerName: (BoardWriter) -> String, now: Long, groups: List<BoardTimelineGroup>? = null, onKindsChanged: (List<String>?) -> Unit = {}) {
    var expanded by rememberSaveable { mutableStateOf(false) }
    var hidden by rememberSaveable { mutableStateOf(listOf<String>()) }
    var openedGroups by rememberSaveable { mutableStateOf(listOf<String>()) }
    var kindCounts by rememberSaveable { mutableStateOf<Map<String, Int>>(emptyMap()) }
    LaunchedEffect(entries, groups, hidden) {
        if (hidden.isEmpty()) kindCounts = (groups?.flatMap { it.entries }?.map { it.kind } ?: entries.map { it.kind }).groupingBy { it }.eachCount()
    }
    val direction = if (newestFirst) "Newest first" else "Oldest first"
    TaskSection(TaskSectionKind.Timeline, count = (groups?.sumOf { it.factCount } ?: entries.size).toString(), expanded = expanded, onToggle = { expanded = !expanded }, metadata = {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
            TooltipBox(positionProvider = TooltipDefaults.rememberPlainTooltipPositionProvider(), tooltip = { PlainTooltip { Text(direction) } }, state = rememberTooltipState()) {
                JarvisIconButton(LucideIcon(if (newestFirst) "newest-first" else "oldest-first", if (newestFirst) "M4 3v18m-3-3 3 3 3-3" else "M4 21V3m-3 3 3-3 3 3", "M10 5h11", "M10 12h7", "M10 19h3"),
                    "$direction; show ${if (newestFirst) "oldest" else "newest"} first", onToggleOrder)
            }
        }
    }) {
        if (expanded) {
            val colors = Jarvis.colors
            Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                TIMELINE_KINDS.filter { (kind, _) -> if (groups != null) kind in kindCounts else entries.any { it.kind == kind } }.forEach { (kind, label) ->
                    FilterChip(selected = kind !in hidden, onClick = {
                        hidden = if (kind in hidden) hidden - kind else hidden + kind
                        if (groups != null) onKindsChanged(if (hidden.isEmpty()) null else TIMELINE_KINDS.map { it.first }.filterNot { it in hidden })
                    }, label = { Text("$label (${if (groups != null) kindCounts[kind] ?: 0 else entries.count { it.kind == kind }})", style = TaskType.meta) })
                }
            }
            val visible = remember(entries, hidden, newestFirst) { orderedTimeline(visibleTimeline(entries, hidden.toSet()), newestFirst) }
            val scroll = rememberLazyListState()
            LaunchedEffect(newestFirst, hidden) {
                if (groups == null && visible.isNotEmpty()) scroll.scrollToItem(if (newestFirst) 0 else visible.lastIndex)
            }
            if (groups != null) {
                val ordered = orderedTimelineGroups(groups.filter { group -> group.entries.any { it.kind !in hidden } }, newestFirst)
                LaunchedEffect(newestFirst, hidden) {
                    if (ordered.isNotEmpty()) scroll.scrollToItem(if (newestFirst) 0 else ordered.lastIndex)
                }
                if (ordered.isEmpty()) Text("No timeline entries.", style = TaskType.xs, color = colors.fgSubtle)
                else LazyColumn(Modifier.fillMaxWidth().heightIn(max = minOf(400.dp, (LocalConfiguration.current.screenHeightDp * .36f).dp)), state = scroll) {
                    itemsIndexed(ordered, key = { _, group -> group.id }) { index, group ->
                        Column {
                            val day = timelineDay(group.hour, now)
                            if (index == 0 || timelineDay(ordered[index - 1].hour, now) != day) {
                                Text(day, Modifier.fillMaxWidth().padding(vertical = 8.dp), style = TaskType.meta, color = colors.fgMuted)
                                HorizontalDivider(color = colors.border)
                            }
                            val open = group.id in openedGroups
                            TimelineGroup(group, open, { openedGroups = if (open) openedGroups - group.id else openedGroups + group.id })
                            if (open) {
                                val facts = group.entries.filterNot { it.kind in hidden }.sortedBy { it.at }.let { if (newestFirst) it.reversed() else it }
                                facts.forEach { fact -> key(fact.id) {
                                    TimelineEvent(fact.timelineEntry(), writerName, now, timelineRange(fact.at, fact.endAt))
                                } }
                            }
                        }
                    }
                }
            }
            else if (visible.isEmpty()) Text("No timeline entries.", style = TaskType.xs, color = colors.fgSubtle)
            else LazyColumn(Modifier.fillMaxWidth().heightIn(max = minOf(400.dp, (LocalConfiguration.current.screenHeightDp * .36f).dp)), state = scroll) {
                itemsIndexed(visible) { index, entry ->
                    val day = timelineDay(entry.at, now)
                    Column {
                        if (index == 0 || timelineDay(visible[index - 1].at, now) != day) {
                            Text(day, Modifier.fillMaxWidth().padding(vertical = 8.dp), style = TaskType.meta, color = colors.fgMuted)
                            HorizontalDivider(color = colors.border)
                        }
                        TimelineEvent(entry, writerName, now)
                    }
                }
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun TimelineEvent(entry: BoardTimelineEntry, writerName: (BoardWriter) -> String, now: Long, range: String? = null) {
    val colors = Jarvis.colors
    val tone = when (timelineTone(entry)) {
        "danger" -> colors.danger
        "warning" -> colors.warning
        "success" -> colors.success
        "activity" -> colors.fgMuted
        else -> colors.accent2
    }
    val icon = when (entry.kind) {
        "status" -> TaskSectionKind.Report.icon
        "worker" -> when (timelineTone(entry)) {
            "danger" -> TaskIcons.TriangleAlert
            "success" -> LucideIcon("circle-check", "M22 11.08V12a10 10 0 1 1-5.93-9.14", "m9 11 3 3L22 4")
            else -> LucideIcon("play", "m9 5 12 7-12 7Z")
        }
        "milestone" -> LucideIcon("flag", "M4 22V3", "M4 3c4-4 12 4 16 0v12c-4 4-12-4-16 0")
        "question" -> TaskIcons.CircleHelp
        "decision" -> TaskSectionKind.Decisions.icon
        "link" -> TaskSectionKind.Related.icon
        "feedback" -> TaskSectionKind.Feedback.icon
        else -> Lucide.FileText
    }
    Row(Modifier.fillMaxWidth().padding(vertical = 10.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        Box(Modifier.size(28.dp).background(tone.copy(alpha = .09f), RoundedCornerShape(8.dp)), contentAlignment = Alignment.Center) { LucideGlyph(icon, size = 15.dp, tint = tone) }
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(entry.by?.let(writerName) ?: "Recorded event", Modifier.weight(1f), style = TaskType.meta, color = colors.fgSubtle, maxLines = 1, overflow = TextOverflow.Ellipsis)
                TooltipBox(positionProvider = TooltipDefaults.rememberPlainTooltipPositionProvider(), tooltip = { PlainTooltip { Text(exactTime(entry.at)) } }, state = rememberTooltipState()) {
                    Text(range ?: relativeTime(entry.at, now), style = TaskType.meta, color = colors.fgSubtle)
                }
            }
            val status = if (entry.kind == "status") timelineStatus(entry.label) else null
            if (status != null) FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                status.forEachIndexed { index, label ->
                    if (index > 0) Text("→", style = TaskType.meta, color = colors.fgMuted)
                    Surface(shape = RoundedCornerShape(6.dp), color = colors.surface2, border = androidx.compose.foundation.BorderStroke(1.dp, colors.border)) {
                        Text(label, Modifier.padding(horizontal = 6.dp, vertical = 2.dp), style = TaskType.meta, color = colors.fg)
                    }
                }
            } else Text(entry.label, style = TaskType.xsSemibold, color = colors.fg, maxLines = if (range == null) 1 else Int.MAX_VALUE, overflow = TextOverflow.Ellipsis)
            entry.detail?.let { detail ->
                var detailsOpen by rememberSaveable(entry.at, entry.label) { mutableStateOf(false) }
                Text("${if (detailsOpen) "⌄" else "›"} ${timelineDetail(detail)}", Modifier.fillMaxWidth().semantics { stateDescription = if (detailsOpen) "Expanded" else "Collapsed" }.clickable(onClickLabel = if (detailsOpen) "Hide event details" else "Show event details") { detailsOpen = !detailsOpen },
                    style = TaskType.xs, color = colors.fgMuted, maxLines = 1, overflow = TextOverflow.Ellipsis)
                if (detailsOpen) ReportMarkdown(detail)
            }
        }
    }
    HorizontalDivider(color = colors.border.copy(alpha = .55f))
}
