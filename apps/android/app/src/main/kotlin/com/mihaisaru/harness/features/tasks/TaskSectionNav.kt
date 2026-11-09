package com.mihaisaru.harness.features.tasks

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import com.mihaisaru.harness.protocol.BoardTask
import com.mihaisaru.harness.ui.components.LucideGlyph
import com.mihaisaru.harness.ui.theme.Jarvis

internal val TASK_SHEET_REPORT_SECTIONS = listOf(ReportSection.Next, ReportSection.Now, ReportSection.Results)

internal data class TaskSectionLink(val kind: TaskSectionKind, val count: String? = null)

/** The body and navigation share this list, so absent sections never leave dead chips or empty list items. */
internal fun taskSheetSections(
    task: BoardTask, questions: Int, files: Int, related: Int, decisions: Int,
    linksEnabled: Boolean, feedback: Int, timeline: Int,
): List<TaskSectionLink> = buildList {
    if (questions > 0) add(TaskSectionLink(TaskSectionKind.Questions, "$questions open"))
    add(TaskSectionLink(TaskSectionKind.Report, if (hasReport(task.report)) "Current update" else null))
    if (linksEnabled) add(TaskSectionLink(TaskSectionKind.Feedback, "$feedback open"))
    if (files > 0) add(TaskSectionLink(TaskSectionKind.Files, files.toString()))
    if (linksEnabled && related > 0) add(TaskSectionLink(TaskSectionKind.Related, related.toString()))
    if (task.workerIds.isNotEmpty()) add(TaskSectionLink(TaskSectionKind.Workers, task.workerIds.size.toString()))
    if (decisions > 0) add(TaskSectionLink(TaskSectionKind.Decisions, decisions.toString()))
    // Android keeps its existing empty timeline and feedback placeholders.
    if (linksEnabled) add(TaskSectionLink(TaskSectionKind.Timeline, timeline.toString()))
    if (task.snapshots > 0) add(TaskSectionLink(TaskSectionKind.History, task.snapshots.toString()))
    if (task.description.isNotBlank() || !task.acceptance.isNullOrBlank()) add(TaskSectionLink(TaskSectionKind.Brief, "Reference"))
}

/** Explicit navigation stays selected after its animation; only a user's body drag releases it. */
internal data class TaskSectionSelection(val pinned: TaskSectionKind? = null) {
    fun select(kind: TaskSectionKind) = TaskSectionSelection(kind)
    fun userScroll() = TaskSectionSelection()
    fun current(spy: TaskSectionKind?) = pinned ?: spy
}

/** Lazy item zero is the summary. At the end the last visible section wins, even if it is short. */
internal fun taskSectionIndex(firstVisible: Int, lastVisible: Int, atEnd: Boolean, sectionCount: Int): Int {
    if (sectionCount == 0) return -1
    return ((if (atEnd) lastVisible else firstVisible) - 1).coerceIn(0, sectionCount - 1)
}

@Composable
internal fun TaskSectionNav(sections: List<TaskSectionLink>, current: TaskSectionKind?, reducedMotion: Boolean, onSelect: (TaskSectionKind) -> Unit) {
    val chips = rememberLazyListState()
    LaunchedEffect(current, sections) {
        val index = sections.indexOfFirst { it.kind == current }
        if (index >= 0) {
            val visible = chips.layoutInfo.visibleItemsInfo
            val chip = visible.firstOrNull { it.index == index }
            if (chip == null || chip.offset < chips.layoutInfo.viewportStartOffset || chip.offset + chip.size > chips.layoutInfo.viewportEndOffset) {
                if (reducedMotion) chips.scrollToItem(index) else chips.animateScrollToItem(index)
            }
        }
    }
    LazyRow(
        state = chips,
        modifier = Modifier.fillMaxWidth().background(Jarvis.colors.bg).semantics { contentDescription = "Task sections" },
        contentPadding = PaddingValues(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        items(sections, key = { it.kind.name }) { section ->
            FilterChip(
                selected = section.kind == current, onClick = { onSelect(section.kind) },
                leadingIcon = { LucideGlyph(section.kind.icon, size = 16.dp) },
                label = {
                    Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        Text(section.kind.title, style = TaskType.xsSemibold)
                        section.count?.let {
                            Text(it, Modifier.background(Jarvis.colors.accent2.copy(alpha = .12f), androidx.compose.foundation.shape.RoundedCornerShape(50)).padding(horizontal = 5.dp), style = TaskType.meta, color = Jarvis.colors.accent2)
                        }
                    }
                },
            )
        }
    }
}
