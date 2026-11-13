package io.github.mitzacoder.kemiri.tasks

import io.github.mitzacoder.kemiri.features.tasks.board.*
import io.github.mitzacoder.kemiri.protocol.*
import java.time.ZoneOffset
import org.junit.Assert.*
import org.junit.Test

/**
 * Mirrors apps/web/test/kanban.test.ts for the Kotlin port in features/tasks/board: columns and how each sorts, the
 * "Needs you" count, what a move may do and asks for, the save it sends, To do's order after a drop, and the remembered
 * List | Board choice.
 */
class KanbanTest {
    private fun ids(columns: List<KanbanColumn>, column: KanbanColumnId) = columns.first { it.id == column }.cards.map { it.task.id }

    @Test fun putsEachStatusInItsColumnDoneAndDroppedTogetherEveryColumnPresent() {
        assertEquals(KanbanColumnId.Working, columnOfStatus("in_progress"))
        assertEquals(KanbanColumnId.Done, columnOfStatus("dropped"))
        val columns = kanbanColumns(listOf(task("T1")), emptyList())
        assertEquals(listOf("To do", "Working", "Blocked", "Ready for review", "Waiting", "Done"), columns.map { it.label })
        assertEquals(emptyList<KanbanCard>(), columns.first { it.id == KanbanColumnId.Blocked }.cards)
    }

    @Test fun sortsToDoByPriorityWorkingByTimeInProgressReviewByTimeWaitedDoneNewestFirst() {
        val tasks = listOf(
            task("T1", order = 3.0),
            task("T2", order = 1.0),
            task("T3", status = "in_progress", inProgressMinutes = 10),
            task("T4", status = "in_progress", inProgressMinutes = 90),
            task("T5", status = "review").copy(updatedAt = "2026-11-05T12:00:00Z"),
            task("T6", status = "review").copy(updatedAt = "2026-11-05T09:00:00Z"),
            task("T7", status = "done", settledAt = "2026-11-04T09:00:00Z"),
            task("T8", status = "dropped", settledAt = "2026-11-05T09:00:00Z"),
        )
        val columns = kanbanColumns(tasks, emptyList())
        assertEquals(listOf("T2", "T1"), ids(columns, KanbanColumnId.Todo))
        assertEquals(listOf("T4", "T3"), ids(columns, KanbanColumnId.Working))
        assertEquals(listOf("T6", "T5"), ids(columns, KanbanColumnId.Review))
        assertEquals(listOf("T8", "T7"), ids(columns, KanbanColumnId.Done))
    }

    @Test fun keepsATaskThatNeedsTheUserInItsStatusColumn() {
        val columns = kanbanColumns(listOf(task("T1", status = "in_progress")), listOf(question("Q1", "T1")))
        val card = columns.first { it.id == KanbanColumnId.Working }.cards.single()
        assertEquals(listOf("Q1"), card.waiting.map { it.id })
    }

    @Test fun showsOnlyTheNewestClosedTasksArchivedOnesOnlyWhenAskedAndFiltersToWhatNeedsTheUser() {
        val closed = (1..5).map { task("T$it", status = "done", settledAt = "2026-11-0${it}T09:00:00Z") }
        val archived = task("T9", status = "done", settledAt = "2026-10-01T09:00:00Z", archived = true)
        val done = kanbanColumns(closed + archived, emptyList(), doneShown = 3).first { it.id == KanbanColumnId.Done }
        assertEquals(listOf("T5", "T4", "T3"), done.cards.map { it.task.id })
        assertEquals(2, done.hidden)
        assertTrue("T9" in ids(kanbanColumns(closed + archived, emptyList(), includeArchived = true, doneShown = 10), KanbanColumnId.Done))

        val filtered = kanbanColumns(listOf(task("T1"), task("T2")), listOf(question("Q1", "T2")), onlyNeedsYou = true)
        assertEquals(listOf("T2"), ids(filtered, KanbanColumnId.Todo))
    }

    @Test fun countsWhatNeedsTheUserOpenTasksWithAQuestionOrWarningAndLooseQuestions() {
        val tasks = listOf(task("T1"), task("T2", status = "done"), task("T3"))
        val questions = listOf(
            question("Q1", "T1"),
            question("Q2", "T1", kind = "warning"),
            question("Q3", "T2"),
            question("Q4", null),
            question("Q5", "T3", status = "answered"),
        )
        assertEquals(2, needsYouCount(tasks, questions))
    }

    @Test fun neverOffersReviewWhichIsTheAgentsCallNorWhereTheTaskAlreadyIs() {
        assertEquals(listOf("in_progress", "blocked", "done", "dropped"), moveChoices("todo").map { it.target })
        assertEquals(listOf("todo", "in_progress", "blocked", "done", "dropped"), moveChoices("review").map { it.target })
        assertNull(dropTarget(KanbanColumnId.Review))
        assertEquals("done", dropTarget(KanbanColumnId.Done))
        assertEquals("dropped", dropTarget(KanbanColumnId.Done, dropped = true))
        assertEquals("in_progress", dropTarget(KanbanColumnId.Working))
    }

    @Test fun asksForAReasonBackFromReviewAndWhatATaskWaitsOnWhenItIsBlocked() {
        assertEquals(MoveQuestion.Reason, moveQuestion("review", "in_progress"))
        assertEquals(MoveQuestion.None, moveQuestion("todo", "in_progress"))
        assertEquals(MoveQuestion.BlockedReason, moveQuestion("in_progress", "blocked"))
        assertEquals(MoveQuestion.None, moveQuestion("review", "done"))
    }

    @Test fun changesOnlyTheStatusKeepsTheRefsOutAndKeepsABlockedReasonOnlyWhileBlocked() {
        val blocked = task("T1", status = "blocked", blockedReason = "CI is down").copy(blockedBy = listOf("T2"), refs = listOf("#12"))
        assertEquals(
            BoardTaskInput(title = "Task T1", description = "", acceptance = null, refs = null, status = "in_progress", blockedBy = listOf("T2"), blockedReason = null, writeScopes = emptyList()),
            moveInput(blocked, "in_progress"),
        )
        assertEquals("Waiting for the API key", moveInput(task("T3"), "blocked", "  Waiting for the API key ").blockedReason)
        assertEquals("CI is down", moveInput(blocked, "blocked", "").blockedReason)
    }

    @Test fun putsADroppedCardAtItsPlaceInToDo() {
        assertEquals(listOf("T1", "T9", "T2", "T3"), todoOrderWith(listOf("T1", "T2", "T3"), "T9", 1))
        assertEquals(listOf("T2", "T3", "T1"), todoOrderWith(listOf("T1", "T2", "T3"), "T1", 2))
        assertEquals(listOf("T1", "T2", "T3"), todoOrderWith(listOf("T1", "T2"), "T3", 99))
        assertEquals(listOf("T3", "T1", "T2"), todoOrderWith(listOf("T1", "T2"), "T3", -1))
    }

    @Test fun saysWhatHappenedInPlainWords() {
        assertEquals("T3 moved to Working. The coordinator will start it.", moveNotice("T3", "in_progress"))
        assertEquals("T3 was dropped.", moveNotice("T3", "dropped"))
        assertEquals("Back to working: Tests fail on Safari", reasonMessage("  Tests fail on Safari "))
    }

    @Test fun defaultsToTheListAndKeepsTheBoardOnceChosen() {
        assertEquals(TasksViewMode.List, tasksViewMode(null))
        assertEquals(TasksViewMode.Board, tasksViewMode(TasksViewMode.Board.stored))
        assertEquals(TasksViewMode.List, tasksViewMode("nonsense"))
    }

    // Android-only helpers the cards use (web TaskCard, lib/board.ts, lib/relative-time.ts).

    @Test fun cardsNameWhatTheyWaitForWhoWorksOnThemAndWhenTheyMoved() {
        val tasks = listOf(task("T1").copy(blockedBy = listOf("T2", "T3", "T9")), task("T2", status = "done"), task("T3"))
        assertEquals(listOf("T3"), waitsFor(tasks[0], tasks).map { it.id })
        assertEquals(emptyList<Blocker>(), waitsFor(tasks[0].copy(status = "done"), tasks))
        val now = java.time.Instant.parse("2026-11-05T12:00:00Z").toEpochMilli()
        val working = KanbanCard(task("T1", status = "in_progress", inProgressMinutes = 80), emptyList(), KanbanColumnId.Working)
        assertEquals(CardTime("1h 20m", "1h 20m in progress"), cardTime(working, now))
        val review = KanbanCard(task("T2", status = "review"), emptyList(), KanbanColumnId.Review)
        assertEquals(CardTime("2h", "Ready for review 2 h ago"), cardTime(review, now))
        assertEquals("now", compactRelativeTime("2026-11-05T11:59:30Z", now))
        assertEquals("Oct 1", compactRelativeTime("2026-10-01T09:00:00Z", now, ZoneOffset.UTC))
        assertEquals("", compactRelativeTime("never", now))
    }
}
