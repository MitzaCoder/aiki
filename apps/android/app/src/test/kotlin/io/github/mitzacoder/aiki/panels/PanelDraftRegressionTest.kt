package io.github.mitzacoder.aiki.panels

import io.github.mitzacoder.aiki.features.panels.*
import io.github.mitzacoder.aiki.protocol.*
import org.junit.Assert.*
import org.junit.Test

class PanelDraftRegressionTest {
    private fun task(id: String = "T2", blockers: List<String> = listOf("T1")) = BoardTask(
        id = id, revision = 7, title = "Title", description = "Description", acceptance = "Original acceptance", refs = emptyList(),
        status = "todo", blockedBy = blockers, blockedReason = "Reason", writeScopes = listOf("src/**"), workerIds = emptyList(),
        scheduleId = null, ownerThreadId = null, report = BoardTaskReport(now = "", results = "", next = "", revision = 1, updatedAt = null, updatedBy = null), snapshots = 0, order = 2.0,
        createdBy = "user", updatedBy = "user", createdAt = "created", updatedAt = "updated", settledAt = null, archived = false,
    )

    @Test fun retainedArchivedPrerequisiteDoesNotBlockAnUnrelatedEdit() {
        val original = task()
        val draft = TaskDraft(original.id, original.revision, original.input()).copy(input = original.input().copy(title = "Renamed"))
        // T1 is absent from the default archive-filtered snapshot, not absent from the board.
        assertNull(validateTask(draft, listOf(original)))
        assertNotNull(validateTask(draft.copy(input = draft.input.copy(blockedBy = listOf("T1", "unknown"))), listOf(original)))
        assertNotNull(validateTask(TaskDraft(null, null, original.input()), listOf(original)))
        assertNotNull(validateTask(draft.copy(input = draft.input.copy(blockedBy = listOf("T2"))), listOf(original)))
        val latest = original.copy(revision = 8, blockedBy = listOf("T3"))
        assertNull(validateTask(draft.useTheirs(latest), listOf(latest)))
        assertNull(validateTask(draft.keepMine(latest), listOf(latest)))
        assertNotNull(validateTask(draft.copy(input = draft.input.copy(blockedBy = listOf("T3"))), listOf(original)))
    }

    @Test fun conflictPreviewIncludesEveryDifferingEditableField() {
        val original = task()
        val draft = TaskDraft(original.id, original.revision, original.input())
        val newer = original.copy(revision = 8, title = "Their title", description = "Their description", acceptance = null,
            status = "blocked", blockedBy = listOf("T3"), blockedReason = null, writeScopes = listOf("other/**"))
        assertEquals(listOf("Title", "Description", "Acceptance", "Status", "Blocked by", "Blocked reason", "Write scopes"),
            taskConflictFields(draft, newer).map { it.first })
        assertEquals(listOf("Their title", "Their description", "(none)", "blocked", "T3", "(none)", "other/**"),
            taskConflictFields(draft, newer).map { it.second })
        assertTrue(taskConflictFields(draft, original.copy(revision = 9, workerIds = listOf("worker"))).isEmpty())
    }

    @Test fun taskEditorRoundTripRetainsNewDraftRawFieldsAndConflictRevision() {
        val scope = boardDraftKey("https://one.example", "p", "task", "new")
        val newDraft = TaskDraft(null, null, task().input().copy(title = "Unsent", blockedBy = emptyList()))
        val newEditor = TaskEditorState(newDraft, blockers = "T1, ", scopes = "src/**, ", error = "Offline")
        val newSession = BoardEditorState(newDraft)
        assertEquals(newSession, restoreBoardDraft(scope, saveBoardDraft(scope, newSession, BoardEditorState.serializer()), BoardEditorState.serializer()))
        assertEquals(newEditor, restoreBoardDraft(scope, saveBoardDraft(scope, newEditor, TaskEditorState.serializer()), TaskEditorState.serializer()))
        assertEquals(BoardEditorState(), restoreBoardDraft(scope, saveBoardDraft(scope, BoardEditorState(), BoardEditorState.serializer()), BoardEditorState.serializer()))
        val original = task()
        val conflicted = TaskEditorState(TaskDraft(original.id, original.revision, original.input()),
            conflict = original.copy(revision = 20, acceptance = "New acceptance"), error = "Changed elsewhere")
        val restored = restoreBoardDraft(scope, saveBoardDraft(scope, conflicted, TaskEditorState.serializer()), TaskEditorState.serializer())!!
        assertEquals(conflicted, restored)
        assertNull(validateTask(restored.draft, listOf(original)))
        assertEquals(20L, restored.draft.keepMine(restored.conflict!!).revision)
    }

    @Test fun questionRoundTripPreservesAnswerBaseRevisionAndLatestConflict() {
        val latest = BoardQuestion(id = "Q1", revision = 4, text = "Question", options = listOf("a", "b"), taskId = null, threadId = null, status = "open", answer = null, askedAt = "now", answeredAt = null)
        val state = QuestionEditorState(revision = 2, answer = "Free text\nnot an option", conflict = latest)
        val key = boardDraftKey("https://one.example", "p", "question", "Q1")
        assertEquals(state, restoreBoardDraft(key, saveBoardDraft(key, state, QuestionEditorState.serializer()), QuestionEditorState.serializer()))
    }

    @Test fun savedDraftCannotLeakAcrossBackendsProjectsOrRows() {
        val key = boardDraftKey("https://one.example", "p", "task", "T2")
        val state = TaskEditorState(TaskDraft(task().id, 7, task().input()))
        val saved = saveBoardDraft(key, state, TaskEditorState.serializer())
        for (other in listOf(boardDraftKey("https://two.example", "p", "task", "T2"),
            boardDraftKey("https://one.example", "other", "task", "T2"), boardDraftKey("https://one.example", "p", "task", "T3"))) {
            assertNull(restoreBoardDraft(other, saved, TaskEditorState.serializer()))
        }
        assertNull(restoreBoardDraft(key, "not json", TaskEditorState.serializer()))
        assertNotEquals(boardDraftKey("a:b", "c", "task", "d"), boardDraftKey("a", "b:c", "task", "d"))
    }
}
