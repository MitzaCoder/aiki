package io.github.mitzacoder.kemiri.tasks

import io.github.mitzacoder.kemiri.features.tasks.*
import io.github.mitzacoder.kemiri.features.tasks.board.*
import io.github.mitzacoder.kemiri.protocol.*
import io.github.mitzacoder.kemiri.data.wireJson
import java.time.LocalDate
import org.junit.Assert.*
import org.junit.Test
import kotlinx.serialization.encodeToString
import kotlinx.serialization.decodeFromString

class TaskWaitingTest {
    private fun waiting() = task("T1", status = "waiting").copy(waiting = BoardTaskWaiting(note = "Ana approval", since = "2026-11-07T00:00:00Z", until = "2026-11-14T00:00:00Z", by = "user"))
    @Test fun groupsWaitingAfterReviewAndCollapsesIt() {
        val sections = taskSections(listOf(waiting(), task("T2", status = "review")), emptyList())
        assertEquals(listOf(TaskSectionId.Review, TaskSectionId.Waiting), sections.map { it.id })
        assertTrue(sections[1].collapsedByDefault)
        assertEquals(TaskSectionId.Waiting, taskSectionOf("waiting", 1))
    }
    @Test fun waitingColumnFollowsReviewAndDoesNotAllowBareDrops() {
        val columns = kanbanColumns(listOf(waiting()), emptyList())
        assertEquals(KanbanColumnId.Waiting, columns[columns.indexOfFirst { it.id == KanbanColumnId.Review } + 1].id)
        assertEquals("T1", columns.first { it.id == KanbanColumnId.Waiting }.cards.single().task.id)
        assertNull(dropTarget(KanbanColumnId.Waiting))
    }
    @Test fun statusMenuCoversAllStatusesWithHints() {
        assertEquals(listOf("todo", "in_progress", "blocked", "review", "waiting", "done", "dropped"), taskStatusChoices.map { it.status })
        assertTrue(taskStatusChoices.all { it.hint.isNotBlank() })
    }
    @Test fun datesAndSummary() {
        assertEquals("2027-01-02", waitingDateIn(3, LocalDate.of(2026,12,30)))
        val summary = waitingSummary(waiting(), java.time.Instant.parse("2026-11-10T00:00:00Z").toEpochMilli())
        assertTrue(summary.startsWith("Waiting for Ana approval · since 3d · back on "))
        assertTrue(summary.contains(Regex("\\d{2}:\\d{2}")))
    }
    @Test fun summaryDoesNotRepeatWaitingPrefix() {
        for (note in listOf("Waiting for rebase", "waiting for rebase", "WAITING FOR rebase", "  Waiting for rebase")) {
            val task = waiting().copy(waiting = waiting().waiting!!.copy(note = note))
            val summary = waitingSummary(task)
            assertTrue(summary.startsWith("$note · since"))
            assertEquals(summary, taskSheetMeta(task).single())
        }
    }
    @Test fun decoderAcceptsUnfamiliarStatusesAndUnknownOptionalFields() {
        val raw = wireJson.encodeToString(task("T1")).dropLast(1) + ",\"futureField\":true}"
        val decoded = wireJson.decodeFromString<BoardTask>(raw.replace("\"status\":\"todo\"", "\"status\":\"future_status\""))
        assertEquals("future_status", decoded.status)
        assertEquals(TaskSectionId.Todo, taskSectionOf(decoded.status, 0))
        assertEquals(KanbanColumnId.Todo, columnOfStatus(decoded.status))
    }
    @Test fun oldTaskWithoutWaitingRecordStillDecodes() {
        assertNull(wireJson.decodeFromString<BoardTask>(wireJson.encodeToString(task("T1"))).waiting)
        assertEquals(waiting(), wireJson.decodeFromString<BoardTask>(wireJson.encodeToString(waiting())))
    }
}
