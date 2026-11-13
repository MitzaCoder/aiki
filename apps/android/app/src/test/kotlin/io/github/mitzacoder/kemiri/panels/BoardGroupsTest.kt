package io.github.mitzacoder.kemiri.panels

import io.github.mitzacoder.kemiri.features.panels.*
import io.github.mitzacoder.kemiri.protocol.*
import org.junit.Assert.*
import org.junit.Test

/** The old-backend Board's groups and moves; mirrors the web's `board.test.ts` (`groupTasks`, `reorderedIds`). */
class BoardGroupsTest {
    private fun task(id: String, status: String, order: Double, archived: Boolean = false) = BoardTask(
        id = id, revision = 1, title = id, description = "", acceptance = null, status = status, blockedBy = emptyList(), blockedReason = null,
        writeScopes = emptyList(), workerIds = emptyList(), scheduleId = null, order = order, createdBy = "user", updatedBy = "user", createdAt = "c", updatedAt = "u",
        settledAt = null, archived = archived,
    )

    @Test fun groupsByStatusInTheBoardsOrderAndFoldsSettledOnes() {
        val tasks = listOf(task("T1", "todo", 2.0), task("T2", "in_progress", 1.0), task("T3", "todo", 1.0), task("T4", "done", 0.0), task("T5", "done", 3.0, archived = true))
        val groups = groupBoardTasks(tasks, includeArchived = false)
        assertEquals(listOf("in_progress", "todo", "done"), groups.map { it.status })
        assertEquals(listOf("In progress", "Todo", "Done"), groups.map { it.label })
        assertEquals(listOf("T3", "T1"), groups[1].tasks.map { it.id })
        assertEquals(listOf(false, false, true), groups.map { it.collapsedByDefault })
        assertEquals(listOf("T4"), groups[2].tasks.map { it.id })
        assertEquals(listOf("T4", "T5"), groupBoardTasks(tasks, includeArchived = true)[2].tasks.map { it.id })
    }

    @Test fun movesATaskWithinItsGroupAndKeepsTheOthersInPlace() {
        val tasks = listOf(task("A", "todo", 1.0), task("B", "review", 2.0), task("C", "todo", 3.0), task("D", "todo", 4.0))
        assertEquals(listOf("C", "B", "A", "D"), boardReorderedIds(tasks, "A", 1))
        assertEquals(listOf("A", "B", "D", "C"), boardReorderedIds(tasks, "D", -1))
        assertNull(boardReorderedIds(tasks, "A", -1))
        assertNull(boardReorderedIds(tasks, "B", 1))
        assertNull(boardReorderedIds(tasks, "missing", 1))
    }
}
