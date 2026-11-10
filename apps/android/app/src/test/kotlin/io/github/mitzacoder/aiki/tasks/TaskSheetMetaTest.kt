package io.github.mitzacoder.aiki.tasks

import io.github.mitzacoder.aiki.features.tasks.*
import io.github.mitzacoder.aiki.protocol.BoardFeedbackCounts
import io.github.mitzacoder.aiki.protocol.BoardSubtaskCount
import io.github.mitzacoder.aiki.protocol.BoardTaskWaiting
import org.junit.Assert.*
import org.junit.Test

class TaskSheetMetaTest {
    @Test fun statusIsNotRepeatedAndEmptyCountersTakeNoSpace() {
        listOf("todo", "in_progress", "review", "blocked", "waiting", "done", "dropped").forEach {
            assertTrue(taskSheetMeta(task("T1", status = it)).isEmpty())
        }
    }

    @Test fun subtaskProgressSurvivesWithoutRelatedLinksIncludingZeroDone() {
        val unfinished = task("T1").copy(subtaskCount = BoardSubtaskCount(total = 3, done = 0))
        assertEquals(listOf("Subtasks 0 / 3 done"), taskSheetMeta(unfinished))
        assertEquals(listOf("Subtasks 3 / 3 done"), taskSheetMeta(unfinished.copy(subtaskCount = BoardSubtaskCount(total = 3, done = 3))))
        assertTrue(taskSheetMeta(unfinished.copy(subtaskCount = BoardSubtaskCount(0, 0))).isEmpty())
    }

    @Test fun completeWaitingNoteSinceAndOptionalReturnDateStayInHeader() {
        val waiting = BoardTaskWaiting(note = "PR approval", since = "2026-11-16T11:00:00Z", until = "2026-11-17T08:00:00Z", by = "user")
        val now = java.time.Instant.parse("2026-11-16T12:00:00Z").toEpochMilli()
        listOf(waiting, waiting.copy(until = null)).forEach {
            val task = task("T1", status = "waiting").copy(waiting = it)
            assertEquals(listOf(waitingSummary(task, now)), taskSheetMeta(task, now))
            assertTrue(taskSheetMeta(task, now).single().contains("Waiting for PR approval · since"))
        }
        assertTrue(taskSheetMeta(task("T1", status = "done").copy(waiting = waiting), now).isEmpty())
    }

    @Test fun workersKeepTotalAndRunningCountsDistinct() {
        assertEquals("3 · 2 running", taskWorkerCount(3, 2))
        assertEquals("3", taskWorkerCount(3, 0))
        val task = task("T1").copy(workerIds = listOf("w1", "w2", "w3"))
        val workers = taskSheetSections(task, 0, 0, 0, 0, true, 0, 0, runningWorkers = 2).first { it.kind == TaskSectionKind.Workers }
        assertEquals("3 · 2 running", workers.count)
    }

    @Test fun questionsAndStoredUnsettledFeedbackHaveTheirOwnBadgesBeforeLoading() {
        val task = task("T1").copy(feedback = BoardFeedbackCounts(open = 2, handling = 1, addressed = 4, dismissed = 5))
        val sections = taskSheetSections(task, 2, 0, 0, 0, true, openFeedbackCount(task).toInt(), 0)
        assertEquals("2 open", sections.first { it.kind == TaskSectionKind.Questions }.count)
        assertEquals("3 open", sections.first { it.kind == TaskSectionKind.Feedback }.count)
    }
}
