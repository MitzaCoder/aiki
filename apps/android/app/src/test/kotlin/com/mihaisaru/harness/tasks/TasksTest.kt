package com.mihaisaru.harness.tasks

import com.mihaisaru.harness.features.tasks.*
import com.mihaisaru.harness.protocol.*
import com.mihaisaru.harness.ui.theme.TaskStatusTone
import org.junit.Assert.*
import org.junit.Test

/** Mirrors apps/web/test/tasks.test.ts (and packages/client's board helpers) for the Kotlin ports in features/tasks. */
class TasksTest {
    @Test fun refsShowAKeyOrNumberAsWrittenAndALinkByWhatItPointsAt() {
        assertEquals("EX-1234", refLabel("EX-1234"))
        assertEquals("#1234", refLabel(" #1234 "))
        assertEquals("#1234", refLabel("https://github.com/acme/core/pull/1234"))
        assertEquals("#1234", refLabel("https://github.com/acme/core/pull/1234/files"))
        assertEquals("#12", refLabel("https://gitlab.com/a/b/-/merge_requests/12"))
        assertEquals("EX-1234", refLabel("https://acme.atlassian.net/browse/EX-1234"))
        assertEquals("example.com", refLabel("https://www.example.com/docs/page"))
    }

    @Test fun aPullRequestOfAnotherRepositoryNamesIt() {
        val one = ProjectLinks(jiraSite = null, jiraProjects = emptyList(), githubRepos = listOf("acme/core"))
        val two = one.copy(githubRepos = listOf("acme/core", "acme/web"))
        assertEquals("#1", refLabel("https://github.com/acme/core/pull/1", one))
        assertEquals("core#1", refLabel("https://github.com/acme/core/pull/1", two))
        assertEquals("web#2", refLabel("https://github.com/acme/web/issues/2", one))
    }

    @Test fun onlyHttpAndHttpsAddressesAreLinks() {
        assertEquals("https://example.com/a", refUrl("https://example.com/a").toString())
        assertNull(refUrl("EX-1234"))
        assertNull(refUrl("javascript:alert(1)"))
    }

    @Test fun saysAStatusPlainlyWithOneTonePerStatus() {
        assertEquals("Ready for review", taskStatusWords("review"))
        assertEquals("Working", taskStatusWords("in_progress"))
        assertEquals(TaskStatusTone.Working, taskStatusTone("in_progress"))
        assertEquals(TaskStatusTone.Review, taskStatusTone("review"))
        assertEquals(TaskStatusTone.Blocked, taskStatusTone("blocked"))
        assertEquals(TaskStatusTone.Todo, taskStatusTone("todo"))
        assertEquals(TaskStatusTone.Done, taskStatusTone("done"))
        assertEquals(TaskStatusTone.Dropped, taskStatusTone("dropped"))
    }

    @Test fun countsWhatWaitsForTheUser() {
        assertEquals("1 question waiting for you", itemsWaitingLabel(listOf(question("Q1", null))))
        assertEquals("1 warning waiting for you", itemsWaitingLabel(listOf(question("Q1", null, kind = "warning"))))
        assertEquals(
            "1 question and 2 warnings waiting for you",
            itemsWaitingLabel(listOf(question("Q1", null), question("Q2", null, kind = "warning"), question("Q3", null, kind = "warning"))),
        )
    }

    @Test fun namesWhoWrote() {
        assertEquals("nobody yet", writerLabel(null))
        assertEquals("you", writerLabel(BoardWriter("user", null, null)))
        assertEquals("the coordinator", writerLabel(BoardWriter("coordinator", "main", null)))
        assertEquals("Parser fix", writerLabel(BoardWriter("worker", "main", "w1")) { "Parser fix" })
        assertEquals("a worker", writerLabel(BoardWriter("worker", "main", "w1")))
        assertEquals("status-bar-rewrite", shortWriterLabel(BoardWriter("worker", "main", "status-bar-rewrite")))
        assertEquals("a worker", shortWriterLabel(BoardWriter("worker", "main", null)))
        assertEquals("the coordinator", shortWriterLabel(BoardWriter("coordinator", "main", null)))
        assertEquals("nobody yet", shortWriterLabel(null))
    }

    @Test fun takesAReportsFirstLineAsPlainText() {
        assertEquals("Merged the fix in abc123", firstLine("\n- **Merged** the [fix](http://x) in `abc123`\n- more"))
        assertEquals("", firstLine(""))
        assertEquals("a".repeat(19) + "…", firstLine("a".repeat(200), 20))
    }

    private val questions = listOf(
        question("Q1", "T2"),
        question("Q2", "T3", kind = "warning"),
        question("Q3", "T3"),
        question("Q4", "T5", status = "answered"),
        question("Q5", null),
        question("Q6", "T99"),
    )

    @Test fun listsATasksOpenQuestionsWithWarningsFirst() {
        assertEquals(listOf("Q2", "Q3"), waitingOn(questions, "T3").map { it.id })
        assertEquals(emptyList<BoardQuestion>(), waitingOn(questions, "T5"))
        val board = Board(tasks = listOf(task("T2"), task("T3")), questions = questions, decisions = emptyList(), updatedAt = null)
        assertEquals(listOf("Q5", "Q6"), looseWaiting(board).map { it.id })
    }

    @Test fun putsATaskWhereItsNeedIsGreatest() {
        assertEquals(TaskSectionId.NeedsYou, taskSectionOf("in_progress", 1))
        assertEquals(TaskSectionId.Review, taskSectionOf("review", 0))
        assertEquals(TaskSectionId.NeedsYou, taskSectionOf("review", 2))
        assertEquals(TaskSectionId.Closed, taskSectionOf("done", 1))
        assertEquals(TaskSectionId.Blocked, taskSectionOf("blocked", 0))
        assertEquals(TaskSectionId.Todo, taskSectionOf("todo", 0))
    }

    @Test fun groupsTasksByWhatTheyNeedInOrderLeavingEmptyGroupsOut() {
        val tasks = listOf(
            task("T1", status = "done", settledAt = "2026-11-05T09:00:00Z"),
            task("T2", status = "in_progress"),
            task("T3", status = "review"),
            task("T4", status = "blocked"),
            task("T5", status = "in_progress"),
            task("T6", status = "dropped", settledAt = "2026-11-05T11:00:00Z"),
            task("T7", status = "todo", archived = true),
        )
        val sections = taskSections(tasks, questions)
        assertEquals(listOf(TaskSectionId.NeedsYou, TaskSectionId.Blocked, TaskSectionId.Working, TaskSectionId.Closed), sections.map { it.id })
        assertEquals(listOf("T3", "T2"), sections[0].rows.map { it.task.id })
        assertEquals(listOf("T5"), sections[2].rows.map { it.task.id })
        assertEquals(listOf("T6", "T1"), sections[3].rows.map { it.task.id })
        assertTrue(sections[3].collapsedByDefault)
        assertTrue(taskSections(tasks, questions, includeArchived = true).any { it.id == TaskSectionId.Todo })
    }

    @Test fun ordersTaskIdsNaturally() {
        assertEquals(listOf("T2", "T10"), taskSections(listOf(task("T10", order = 1.0), task("T2", order = 1.0)), emptyList())[0].rows.map { it.task.id })
    }

    @Test fun showsTheLineThatMattersForWhereATaskStands() {
        val report = BoardTaskReport(now = "Running the tests", results = "- Merged abc123", next = "Review", revision = 1, updatedAt = null, updatedBy = null)
        fun row(status: String, waiting: List<BoardQuestion> = emptyList()): TaskRow {
            val entry = task("T1", status = status, report = report, description = "Fix the parser", blockedReason = "Needs the key")
            return TaskRow(entry, waiting, taskSectionOf(entry.status, waiting.size))
        }
        assertEquals("Running the tests", rowGist(row("in_progress")))
        assertEquals("Merged abc123", rowGist(row("review")))
        assertEquals("Needs the key", rowGist(row("blocked")))
        assertEquals("Fix the parser", rowGist(row("todo")))
        assertEquals("Question Q1", rowGist(row("in_progress", listOf(question("Q1", "T1")))))
    }

    @Test fun keepsTheCommonLinesAndMarksTheRest() {
        assertEquals(
            listOf(DiffLine(DiffLine.Kind.Same, "a"), DiffLine(DiffLine.Kind.Removed, "b"), DiffLine(DiffLine.Kind.Same, "c"), DiffLine(DiffLine.Kind.Added, "d")),
            diffLines("a\nb\nc", "a\nc\nd"),
        )
        assertEquals(listOf(DiffLine(DiffLine.Kind.Same, "a")), diffLines("a\n\n", "a"))
        assertEquals(listOf(DiffLine(DiffLine.Kind.Added, "x")), diffLines("", "x"))
        assertEquals(
            listOf(UnchangedLines(3), DiffLine(DiffLine.Kind.Removed, "d"), DiffLine(DiffLine.Kind.Added, "e")),
            foldUnchanged(diffLines("a\nb\nc\nd", "a\nb\nc\ne")),
        )
    }

    @Test fun reportsTheTitleTheStatusAndOnlyTheSectionsThatMoved() {
        val before = TaskState("Fix", "in_progress", now = "Testing", results = "- a", next = "")
        val after = TaskState("Fix parser", "review", now = "", results = "- a", next = "Review it")
        val changes = taskChanges(before, after)
        assertEquals(Change("Fix", "Fix parser"), changes.title)
        assertEquals(Change("in_progress", "review"), changes.status)
        assertEquals(listOf(ReportSection.Now, ReportSection.Next), changes.sections.map { it.section })
        assertEquals(listOf(DiffLine(DiffLine.Kind.Removed, "Testing")), changes.sections[0].lines)
        val first = taskChanges(null, TaskState("Fix", "todo", now = "", results = "- a", next = ""))
        assertNull(first.title)
        assertNull(first.status)
        assertEquals(listOf(SectionChange(ReportSection.Results, listOf(DiffLine(DiffLine.Kind.Added, "- a")))), first.sections)
        assertTrue(first.any)
    }

    @Test fun readsTheServersTaskPrefixAndBoardNotes() {
        assertEquals(TaskReference("T12", "Look again"), parseTaskReference("[task T12] Look again"))
        assertEquals(TaskReference(null, "[task T12 Look"), parseTaskReference("[task T12 Look"))
        assertEquals(TaskReference(null, "[task a b] x"), parseTaskReference("[task a b] x"))
        assertEquals(TaskReference("T12", "Look again", "F3"), parseTaskReference("[task T12, feedback F3] Look again"))
        assertEquals(TaskReference(null, "hello"), parseTaskReference("hello"))
        assertEquals("[task T3] Why", withTaskReference("T3", "Why"))
        assertTrue(isBoardMessage("  [board] The user changed the board:"))
        assertTrue(isBoardMessage("[board]"))
        assertFalse(isBoardMessage("[board]x"))
        assertFalse(isBoardMessage("about the [board]"))
    }

    @Test fun saysMinutesAsAPersonReadsThem() {
        assertEquals("45m", formatMinutes(45.0))
        assertEquals("2h", formatMinutes(120.0))
        assertEquals("1h 30m", formatMinutes(90.0))
        assertEquals("0m", formatMinutes(-3.0))
        assertEquals("In progress 1h 20m", inProgressText(task("T1", inProgressMinutes = 80)))
        assertNull(inProgressText(task("T1")))
    }
}

internal fun task(
    id: String,
    status: String = "todo",
    order: Double = id.drop(1).toDouble(),
    settledAt: String? = null,
    archived: Boolean = false,
    report: BoardTaskReport = BoardTaskReport(now = "", results = "", next = "", revision = 0, updatedAt = null, updatedBy = null),
    description: String = "",
    blockedReason: String? = null,
    inProgressMinutes: Long? = null,
) = BoardTask(
    id = id, revision = 1, title = "Task $id", description = description, acceptance = null, refs = emptyList(), inProgressMinutes = inProgressMinutes,
    status = status, blockedBy = emptyList(), blockedReason = blockedReason, writeScopes = emptyList(), workerIds = emptyList(), scheduleId = null,
    report = report, snapshots = 0, order = order, createdBy = "coordinator", updatedBy = "coordinator",
    createdAt = "2026-11-05T10:00:00Z", updatedAt = "2026-11-05T10:00:00Z", settledAt = settledAt, archived = archived,
)

internal fun question(id: String, taskId: String?, kind: String? = null, status: String = "open") = BoardQuestion(
    id = id, revision = 1, kind = kind, text = "Question $id", options = emptyList(), taskId = taskId, status = status,
    answer = if (status == "answered") "yes" else null, askedAt = "now", answeredAt = null,
)
