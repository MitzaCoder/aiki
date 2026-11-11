package io.github.mitzacoder.aiki.tasks

import io.github.mitzacoder.aiki.features.tasks.*
import org.junit.Assert.*
import org.junit.Test

class TaskSectionNavTest {
    @Test fun sparseTaskHasOnlyReportWithoutLinks() {
        val sections = taskSheetSections(task("T1"), 0, 0, 0, 0, false, 0, 0)
        assertEquals(listOf(TaskSectionKind.Report), sections.map { it.kind })
        assertNull(sections.single().count)
    }

    @Test fun richTaskUsesTheSameSingleColumnOrderAsWeb() {
        val rich = task("T1").copy(workerIds = listOf("w1"), snapshots = 2, description = "Brief")
        val sections = taskSheetSections(rich, 1, 3, 2, 1, true, 2, 12)
        assertEquals(listOf(TaskSectionKind.Questions, TaskSectionKind.Report, TaskSectionKind.Timeline, TaskSectionKind.Feedback,
            TaskSectionKind.Files, TaskSectionKind.Related, TaskSectionKind.Workers, TaskSectionKind.Decisions,
            TaskSectionKind.History, TaskSectionKind.Brief), sections.map { it.kind })
        assertEquals(listOf("1 open", null, "12", "2 open", "3", "2", "1", "1", "2", "Reference"), sections.map { it.count })
    }

    @Test fun linksFeatureKeepsExistingEmptyFeedbackAndTimelineButNoEmptyRelated() {
        assertEquals(listOf(TaskSectionKind.Report, TaskSectionKind.Timeline, TaskSectionKind.Feedback),
            taskSheetSections(task("T1"), 0, 0, 0, 0, true, 0, 0).map { it.kind })
        assertFalse(taskSheetSections(task("T1"), 0, 0, 3, 0, false, 0, 0).any { it.kind == TaskSectionKind.Related })
    }

    @Test fun selectionStaysPinnedThroughAnimationAndLaterSpyUpdates() {
        val selection = TaskSectionSelection().select(TaskSectionKind.Brief)
        assertEquals(TaskSectionKind.Brief, selection.current(TaskSectionKind.Workers))
        assertEquals(TaskSectionKind.Brief, selection.current(TaskSectionKind.History))
    }

    @Test fun bodyDragReleasesSelectionForItsDragAndFling() {
        val selection = TaskSectionSelection().select(TaskSectionKind.History).userScroll()
        assertNull(selection.pinned)
        assertEquals(TaskSectionKind.Workers, selection.current(TaskSectionKind.Workers))
        assertEquals(TaskSectionKind.Brief, selection.current(TaskSectionKind.Brief))
    }

    @Test fun anotherClickReplacesPinEvenWithoutAnyScrollDistance() {
        val selection = TaskSectionSelection().select(TaskSectionKind.Brief).select(TaskSectionKind.Decisions)
        assertEquals(TaskSectionKind.Decisions, selection.current(TaskSectionKind.Brief))
    }

    @Test fun spyUsesSectionItemsStartingAtZero() {
        assertEquals(-1, taskSectionIndex(0, 0, false, 0))
        assertEquals(0, taskSectionIndex(0, 2, false, 5))
        assertEquals(1, taskSectionIndex(1, 3, false, 5))
        assertEquals(2, taskSectionIndex(2, 4, false, 5))
    }

    @Test fun spyAtEndChoosesLastVisibleShortSectionNotFirstVisible() {
        assertEquals(4, taskSectionIndex(2, 5, true, 5))
        assertEquals(3, taskSectionIndex(2, 3, true, 5))
        assertEquals(4, taskSectionIndex(2, 99, true, 5))
    }

    @Test fun reportStartsWithNextAndRetainsAllFields() {
        assertEquals(listOf(ReportSection.Next, ReportSection.Now, ReportSection.Results), TASK_SHEET_REPORT_SECTIONS)
    }
}
