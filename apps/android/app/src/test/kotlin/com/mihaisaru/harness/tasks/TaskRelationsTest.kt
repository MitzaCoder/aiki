package com.mihaisaru.harness.tasks

import com.mihaisaru.harness.features.tasks.*
import com.mihaisaru.harness.data.wireJson
import com.mihaisaru.harness.protocol.*
import kotlinx.serialization.json.*
import org.junit.Assert.*
import org.junit.Test

class TaskRelationsTest {
    @Test fun parsesNewAndOldMessagePrefixes() {
        assertEquals(TaskReference("T12", "hello", "F3"), parseTaskReference("[task T12, feedback F3] hello"))
        assertEquals(TaskReference("T12", "hello"), parseTaskReference("[task T12] hello"))
        assertEquals(TaskReference(null, "[task ] hello"), parseTaskReference("[task ] hello"))
        assertNull(parseTaskReference("[task T12, feedback ] hi").feedbackId)
        assertNull(parseTaskReference("[task T12, feedback F 3] hi").feedbackId)
        assertEquals("T12", parseTaskReference("[task T12, unknown stuff] hi").taskId)
    }
    @Test fun groupsAllKindsAndNamesArchivedTargets() {
        val parent = task("T1").copy(parent = "T8", subtasks = listOf("T2"), foundWhile = "T3", ledTo = listOf("T4"), blockedBy = listOf("T5"), blocks = listOf("T6"), related = listOf("T7", "T9", "T10"))
        val groups = linkGroups(parent, listOf(task("T2", "done"), task("T7", "dropped")), listOf(BoardTaskBrief("T9", "Archived title", "done", true)))
        assertEquals(listOf("parent", "subtasks", "foundWhile", "ledTo", "blockedBy", "blocks", "related"), groups.map { it.kind })
        assertTrue(groups[1].items.single().closed)
        assertTrue(groups.last().items[0].closed)
        assertEquals("Archived title", groups.last().items[1].title)
        assertTrue(groups.last().items[1].closed)
        assertNull(groups.last().items[2].status)
        assertTrue(linkGroups(task("T1"), emptyList()).isEmpty())
    }
    @Test fun followsDescendantsButNotEveryLinkOfARelatedTaskAndSurvivesCycles() {
        val tasks = listOf(task("T1").copy(subtasks = listOf("T2"), related = listOf("T6")),
            task("T2").copy(parent = "T1", ledTo = listOf("T3")), task("T3").copy(subtasks = listOf("T4")),
            task("T4").copy(ledTo = listOf("T1")), task("T5"), task("T6").copy(related = listOf("T7")), task("T7"))
        assertEquals(setOf("T1", "T2", "T3", "T4", "T6"), linkedIds("T1", tasks))
        assertEquals(listOf("T1", "T3", "T4", "T6"), applyTaskFilter(tasks, true, "T1").map { it.id })
        assertEquals(listOf("T2"), applyTaskFilter(tasks, true, "T2").filter { it.id == "T2" }.map { it.id })
        assertEquals(setOf("T99"), linkedIds("T99", tasks))
    }
    @Test fun progressAndBadgeUseCountsNotArrayLength() {
        assertNull(subtaskProgressText(task("T1")))
        assertNull(subtaskFraction(task("T1").copy(subtaskCount = BoardSubtaskCount(0, 0))))
        val parent = task("T1").copy(subtaskCount = BoardSubtaskCount(3, 1), feedback = BoardFeedbackCounts(2, 1, 4, 5))
        assertEquals("1/3 done", subtaskProgressText(parent))
        assertEquals("1/3", subtaskBadgeText(parent))
        assertEquals("1 subtask", subtaskBadgeText(task("T1").copy(subtasks = listOf("T2"), subtaskCount = BoardSubtaskCount(0, 0))))
        assertNull(subtaskBadgeText(task("T1")))
        assertEquals(1f / 3, subtaskFraction(parent)!!, .001f)
        assertEquals(3L, openFeedbackCount(parent))
        assertEquals(0L, openFeedbackCount(task("T1")))
    }
    @Test fun feedbackIsOpenFirstAndTimelineFiltersKinds() {
        fun feedback(id: String, state: String, at: String) = BoardFeedback(id, id, threadId = "main", at = at, state = state, note = null, updatedAt = at, changes = emptyList())
        val entries = listOf(feedback("F1", "dismissed", "1"), feedback("F2", "handling", "3"), feedback("F3", "open", "2"), feedback("F4", "addressed", "4"))
        assertEquals(listOf("F3", "F2", "F4", "F1"), sortedFeedback(entries).map { it.id })
        val timeline = listOf(BoardTimelineEntry("1", "feedback", "Feedback"), BoardTimelineEntry("2", "status", "Working"))
        assertEquals(listOf("status"), visibleTimeline(timeline, setOf("feedback")).map { it.kind })
        assertEquals(timeline, visibleTimeline(timeline, emptySet()))
    }
    @Test fun olderBoardsDecodeWithoutAnyNewFields() {
        val json = wireJson.encodeToJsonElement(BoardTask.serializer(), task("T1")).jsonObject
        val old = JsonObject(json.filterKeys { it !in setOf("parent", "foundWhile", "related", "subtasks", "ledTo", "blocks", "subtaskCount", "feedback", "timelineRevision") })
        val decoded = wireJson.decodeFromJsonElement(BoardTask.serializer(), old)
        assertNull(decoded.feedback)
        assertNull(decoded.parent)
        assertNull(decoded.timelineRevision)
        assertTrue(linkGroups(decoded, emptyList()).isEmpty())
    }
}
