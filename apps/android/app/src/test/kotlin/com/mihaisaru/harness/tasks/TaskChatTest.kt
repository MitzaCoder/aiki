package com.mihaisaru.harness.tasks

import com.mihaisaru.harness.features.tasks.*
import org.junit.Assert.*
import org.junit.Test

/** Mirrors apps/web/test/task-chat.test.ts for the Kotlin ports in features/tasks/TaskChat.kt. */
class TaskChatTest {
    @Test fun findsEachTaskOnceInOrderAndNotPartsOfOtherWords() {
        assertEquals(listOf("T3", "T12"), taskIdsIn("T3 then T12, T3 again; AT4, T5x, a/T6 and #T7"))
        assertEquals(listOf("T3", "T9"), checkInTaskIds("worker w1\ntask T3: 42m in progress\n\nworker w2\ntask T3: 3m\ntask T9: no time recorded"))
    }

    @Test fun splitsALineAroundTheTasksTheBoardKnows() {
        assertEquals(
            listOf(TextPiece.Plain("You edited "), TextPiece.Task("T1"), TextPiece.Plain(" (and T2)")),
            splitTaskMentions("You edited T1 (and T2)") { it == "T1" },
        )
        assertEquals(listOf(TextPiece.Plain("nothing here")), splitTaskMentions("nothing here") { true })
    }

    @Test fun aMentionAtTheVeryEndOfArrivingTextWaits() {
        assertEquals(listOf(TextPiece.Plain("see T1")), splitTaskMentions("see T1", streaming = true) { true })
        assertEquals(listOf(TextPiece.Plain("see "), TextPiece.Task("T1"), TextPiece.Plain(" now")), splitTaskMentions("see T1 now", streaming = true) { true })
        assertEquals(listOf(TextPiece.Plain("see "), TextPiece.Task("T1")), splitTaskMentions("see T1") { true })
    }

    private val options = listOf(
        TaskOption("T1", "Fix the login", "in_progress"),
        TaskOption("T2", "Docs", "todo"),
        TaskOption("T3", "Triage", "review"),
        TaskOption("T4", "Old login screenshots", "done"),
        TaskOption("T5", "Blocked thing", "blocked"),
    )

    @Test fun offersOpenTasksFirst() {
        assertEquals(listOf("T3", "T5", "T1", "T2"), pickerChoices(options, "").map { it.id })
    }

    @Test fun aSearchMatchesIdOrTitleAndMayFindFinishedTasks() {
        assertEquals(listOf("T1", "T4"), pickerChoices(options, "login").map { it.id })
        assertEquals(listOf("T2"), pickerChoices(options, "t2").map { it.id })
        assertEquals(emptyList<TaskOption>(), pickerChoices(options, "zzz"))
    }

    @Test fun archivedTasksAreNotOffered() {
        assertEquals(listOf(TaskOption("T1", "Task T1", "todo")), taskOptions(listOf(task("T1"), task("T2", status = "done", archived = true))))
    }

    @Test fun hashStartsASearchOnlyAtTheStartOfAWordUpToTheCaret() {
        assertEquals(HashTrigger(0, ""), hashTrigger("#", 1))
        assertEquals(HashTrigger(8, "fix"), hashTrigger("look at #fix", 12))
        assertEquals(HashTrigger(8, "fix"), hashTrigger("look at #fix more", 12))
        assertNull(hashTrigger("issue#12", 8))
        assertNull(hashTrigger("look at #fix more", 17))
        assertEquals(HashTrigger(2, ""), hashTrigger("a #b c", 3))
    }

    @Test fun pickingRemovesTheWordAndOneSpace() {
        assertEquals(TextWithCaret("", 0), withoutTrigger("#fix", HashTrigger(0, "fix")))
        assertEquals(TextWithCaret("look at now", 8), withoutTrigger("look at #fix now", HashTrigger(8, "fix")))
        assertEquals(TextWithCaret("look at ", 8), withoutTrigger("look at #", HashTrigger(8, "")))
    }
}
