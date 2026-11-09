package com.mihaisaru.harness.tasks

import com.mihaisaru.harness.features.tasks.*
import com.mihaisaru.harness.protocol.*
import org.junit.Assert.*
import org.junit.Test

/**
 * Mirrors the web's `test/board.test.ts` (the task editor, blockers), `test/threads.test.ts` (the question pin) and
 * `test/relative-time.test.ts` for the Kotlin ports in features/tasks (TaskEditorDraft, TaskFacts).
 */
class TaskSheetRulesTest {
    private val base = task("T3").copy(
        description = "Retry on a bad frame", acceptance = "Parser recovers", refs = listOf("EX-1234", "#1234"),
        blockedBy = listOf("T1"), writeScopes = listOf("src/parser", "test"),
    )

    @Test fun roundTripsATaskThroughItsDraft() {
        val draft = base.editorDraft()
        assertEquals("src/parser\ntest", draft.writeScopes)
        assertEquals("EX-1234\n#1234", draft.refs)
        assertEquals(
            BoardTaskInput(
                title = "Task T3", description = "Retry on a bad frame", acceptance = "Parser recovers", refs = listOf("EX-1234", "#1234"),
                status = "todo", blockedBy = listOf("T1"), blockedReason = null, writeScopes = listOf("src/parser", "test"),
            ),
            draft.toInput(),
        )
        assertFalse(draftIsDirty(draft, base))
        assertTrue(draftIsDirty(draft.copy(title = "Other"), base))
        assertFalse(draftIsDirty(TaskEditorDraft(), null))
        assertEquals(listOf("Tickets and links"), changedFields(draft.copy(refs = "EX-1234"), base))
    }

    @Test fun sendsRefsOnlyWhenTheUserChangedThem() {
        val draft = base.editorDraft()
        assertNull(draft.toInput(baseRefs = base.refs).refs)
        assertEquals(listOf("EX-1234"), draft.copy(refs = "EX-1234").toInput(baseRefs = base.refs).refs)
        assertEquals(emptyList<String>(), draft.copy(refs = "").toInput(baseRefs = base.refs).refs)
        // A new task has nothing to keep.
        assertEquals(listOf("#1"), TaskEditorDraft(title = "x", refs = "#1").toInput().refs)
    }

    @Test fun trimsDropsBlanksAndRepeatsAndSendsAnEmptyAcceptanceAsNull() {
        assertEquals(listOf("a/b", "c", "d"), parseList(" a/b ,c\n\n a/b\n d "))
        val input = TaskEditorDraft(title = "  Hello ", acceptance = "  ", blockedReason = " ").toInput()
        assertEquals("Hello", input.title)
        assertNull(input.acceptance)
        assertNull(input.blockedReason)
    }

    @Test fun namesTheFieldsANewerVersionChanged() {
        val draft = base.editorDraft()
        val newer = base.copy(status = "blocked", title = "Renamed", revision = 2)
        assertEquals(listOf("Title", "Status"), changedFields(draft, newer))
        assertEquals(emptyList<String>(), changedFields(draft, base))
        assertEquals("(none)", fieldValueText(base.copy(refs = emptyList()), "Tickets and links"))
        assertEquals("Blocked", fieldValueText(newer, "Status"))
    }

    @Test fun refusesAnEmptyTitleATaskWaitingForItselfAndACycle() {
        val tasks = listOf(task("T1"), task("T2").copy(blockedBy = listOf("T1")), task("T3").copy(blockedBy = listOf("T2")))
        assertEquals("A task needs a title.", draftProblem(TaskEditorDraft(), null, tasks))
        assertEquals("A task cannot wait for itself.", draftProblem(TaskEditorDraft(title = "x", blockedBy = listOf("T1")), "T1", tasks))
        assertEquals("T3 already waits for T1.", draftProblem(TaskEditorDraft(title = "x", blockedBy = listOf("T3")), "T1", tasks))
        assertNull(draftProblem(TaskEditorDraft(title = "x", blockedBy = listOf("T1")), "T3", tasks))
    }

    @Test fun offersAsBlockersOnlyTasksThatWouldNotMakeACycle() {
        val tasks = listOf(task("T1"), task("T2").copy(blockedBy = listOf("T1")), task("T3").copy(blockedBy = listOf("T2")), task("T4"))
        assertEquals(listOf("T4"), blockerChoices(tasks, "T1").map { it.id })
        assertEquals(listOf("T1", "T2", "T4"), blockerChoices(tasks, "T3").map { it.id })
        assertEquals(4, blockerChoices(tasks, null).size)
    }

    @Test fun saysWhetherEachBlockerIsFinishedAndCallsAMissingOneUnknown() {
        val tasks = listOf(task("T1", status = "done"), task("T2"), task("T3").copy(blockedBy = listOf("T1", "T2", "T9")))
        val blockers = blockersOf(tasks[2], tasks)
        assertEquals(listOf("T1" to true, "T2" to false, "T9" to true), blockers.map { it.id to it.settled })
        assertEquals("unknown", blockers[2].status)
    }

    @Test fun pinsOneQuestionAndGivesEveryOtherAskerATurn() {
        fun q(id: String, threadId: String? = null) = question(id, null).copy(threadId = threadId)
        val open = listOf(q("Q1", "main"), q("Q2", "main"), q("Q3", "jira-run"), q("Q4", "docs"))
        assertEquals(QuestionPin(open[0], listOf(open[2], open[3]), 1), questionPin(open, null))
        assertEquals(QuestionPin(open[2], listOf(open[0], open[3]), 1), questionPin(open, "Q3"))
        // A question answered elsewhere drops out; the pin falls back to the oldest.
        assertEquals("Q1", questionPin(open, "Q9").current?.id)
        assertEquals(QuestionPin(q("Q1"), listOf(q("Q2")), 0), questionPin(listOf(q("Q1"), q("Q2")), null))
        assertEquals(QuestionPin(null, emptyList(), 0), questionPin(emptyList(), null))
    }

    @Test fun keepsMainsQuestionsApartFromABackgroundThreads() {
        assertTrue(inThread(null, null))
        assertTrue(inThread("main", null))
        assertFalse(inThread("jira-run", null))
        assertTrue(inThread("jira-run", "jira-run"))
        assertFalse(inThread(null, "jira-run"))
    }

    @Test fun namesTheThreadThatAskedAndTheTaskAQuestionIsAbout() {
        val threads = listOf(thread("jira-run", "Jira run"))
        assertNull(questionAskedBy(question("Q1", null).copy(threadId = "main"), threads))
        assertEquals("Jira run", questionAskedBy(question("Q1", null).copy(threadId = "jira-run"), threads))
        val board = mapOf("T4" to task("T4"))
        assertEquals("T4 · Task T4", questionTaskLabel(question("Q1", "T4"), board::get))
        assertEquals("T9", questionTaskLabel(question("Q1", "T9"), board::get))
        assertNull(questionTaskLabel(question("Q1", null), board::get))
    }

    @Test fun namesWhoHoldsATask() {
        val threads = listOf(thread("jira-run", "Jira run"))
        assertEquals(TaskOwner(claimed = false, label = "Unclaimed", threadId = null, main = false), taskOwner(task("T1"), threads))
        assertEquals(TaskOwner(claimed = true, label = "Jira run", threadId = "jira-run", main = false), taskOwner(task("T1").copy(ownerThreadId = "jira-run"), threads))
        assertTrue(taskOwner(task("T1").copy(ownerThreadId = "main"), threads).main)
    }

    @Test fun saysTimeInOneUnitWithoutASuffix() {
        val start = "2026-11-05T12:00:00.000Z"
        fun at(iso: String) = java.time.Instant.parse(iso).toEpochMilli()
        assertEquals("now", compactRelativeTime(start, at("2026-11-05T12:00:30.000Z")))
        assertEquals("24m", compactRelativeTime(start, at("2026-11-05T12:24:00.000Z")))
        assertEquals("3h", compactRelativeTime(start, at("2026-11-05T15:10:00.000Z")))
        assertEquals("2d", compactRelativeTime(start, at("2026-11-07T12:00:00.000Z")))
        assertEquals("", compactRelativeTime("not a date", at(start)))
        assertEquals("just now", relativeTime(start, at("2026-11-05T12:00:30.000Z")))
        assertEquals("24 min ago", relativeTime(start, at("2026-11-05T12:24:00.000Z")))
        assertEquals("3 h ago", relativeTime(start, at("2026-11-05T15:10:00.000Z")))
        assertEquals("at an unknown time", relativeTime("not a date", at(start)))
    }

    @Test fun aRowSaysTimeInProgressWhileWorkingElseWhenItMoved() {
        val now = java.time.Instant.parse("2026-11-05T13:00:00Z").toEpochMilli()
        val working = TaskRow(task("T1", status = "in_progress", inProgressMinutes = 80), emptyList(), TaskSectionId.Working)
        assertEquals("1h 20m", rowTime(working, now))
        assertEquals("1h 20m in progress", rowTimeWords(working, now))
        val todo = TaskRow(task("T2"), emptyList(), TaskSectionId.Todo)
        assertEquals("3h", rowTime(todo, now))
        assertEquals("Updated 3 h ago", rowTimeWords(todo, now))
        val closed = TaskRow(task("T3", status = "dropped", settledAt = "2026-11-05T12:00:00Z"), emptyList(), TaskSectionId.Closed)
        assertEquals("1h", rowTime(closed, now))
        assertEquals("Dropped 1 h ago", rowTimeWords(closed, now))
    }

    @Test fun showsTimeInProgressOnlyForATaskThatSpentSome() {
        assertNull(inProgressLine(task("T1")))
        assertNull(inProgressLine(task("T1", inProgressMinutes = 0)))
        assertEquals("0m in progress", inProgressLine(task("T1", status = "in_progress", inProgressMinutes = 0)))
        assertEquals("45m in progress", inProgressLine(task("T1", status = "done", inProgressMinutes = 45)))
    }
}

private fun thread(id: String, title: String) = ThreadSummary(
    id = id, title = title, status = "running", main = false, startedBy = "main", scheduleId = null, conversationId = 7, model = null,
    thinkingLevel = null, onFinish = "report", runningWorkers = 0, ownedTasks = emptyList(), openQuestions = 0, current = null, summary = null,
    failure = null, createdAt = "2026-11-05T10:00:00Z", updatedAt = "2026-11-05T10:00:00Z", finishedAt = null, archived = false,
)
