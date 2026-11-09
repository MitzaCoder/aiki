package com.mihaisaru.harness.tasks

import com.mihaisaru.harness.features.tasks.*
import com.mihaisaru.harness.protocol.BoardFeedbackCounts
import com.mihaisaru.harness.protocol.BoardSubtaskCount
import org.junit.Assert.*
import org.junit.Test

class TaskSummaryTest {
    @Test fun olderAndEmptyTasksOnlyShowStatus() {
        assertEquals(listOf(TaskSummaryKind.Status), taskSummaryCells(task("T1"), 0, 0).map { it.kind })
    }

    @Test fun zeroDoneStillShowsButZeroTotalDoesNot() {
        val unfinished = task("T1").copy(subtaskCount = BoardSubtaskCount(total = 3, done = 0))
        assertEquals("0 / 3", taskSummaryCells(unfinished, 0, 0)[1].value)
        assertEquals(1, taskSummaryCells(unfinished.copy(subtaskCount = BoardSubtaskCount(0, 0)), 0, 0).size)
    }

    @Test fun needsYouCountsQuestionsAndUnsettledFeedback() {
        val feedback = task("T1").copy(feedback = BoardFeedbackCounts(open = 2, handling = 1, addressed = 4, dismissed = 5))
        assertEquals("5 open requests", taskSummaryCells(feedback, 2, 0)[1].value)
        assertEquals("1 open request", taskSummaryCells(task("T1"), 1, 0)[1].value)
        assertEquals(1, taskSummaryCells(feedback.copy(feedback = BoardFeedbackCounts(0, 0, 4, 5)), 0, 0).size)
    }

    @Test fun runningWorkersOnlyShowWhenNonzero() {
        assertEquals("2 running", taskSummaryCells(task("T1"), 0, 2)[1].value)
        assertEquals(1, taskSummaryCells(task("T1"), 0, 0).size)
    }

    @Test fun cellsKeepTheWebReadingOrder() {
        val rich = task("T1").copy(subtaskCount = BoardSubtaskCount(total = 2, done = 1))
        assertEquals(listOf(TaskSummaryKind.Status, TaskSummaryKind.Subtasks, TaskSummaryKind.Requests, TaskSummaryKind.Workers),
            taskSummaryCells(rich, 1, 1).map { it.kind })
    }
}
