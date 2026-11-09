package com.mihaisaru.harness.panels

import com.mihaisaru.harness.features.panels.boardWorkerLabels
import com.mihaisaru.harness.protocol.*
import org.junit.Assert.*
import org.junit.Test

class BoardWorkerProvenanceTest {
    private fun task() = BoardTask(
        id = "T1", revision = 1, title = "Research task", description = "", acceptance = null, refs = emptyList(),
        status = "in_progress", blockedBy = emptyList(), blockedReason = null, writeScopes = emptyList(), workerIds = listOf("same"),
        scheduleId = null, ownerThreadId = "research", report = BoardTaskReport(now = "", results = "", next = "", revision = 1, updatedAt = null, updatedBy = null), snapshots = 0, order = 1.0,
        createdBy = "user", updatedBy = "user", createdAt = "now", updatedAt = "now", settledAt = null, archived = false,
    )
    private fun worker(thread: String, title: String, status: String) = WorkerSummary(
        id = "same", title = title, status = status, model = ModelRef("test", "faux"),
        thinkingLevel = null, isolation = "shared", workspacePath = null,
        conversationId = if (thread == "main") 1 else 2, threadId = thread,
        spawnedByCallId = null, createdAt = "now", updatedAt = "now", lastReport = null, failure = null,
    )

    @Test fun handoffCannotBorrowAnotherCoordinatorsSameNamedWorker() {
        val research = worker("research", "Research worker for T1", "running")
        val unrelated = worker("main", "Unrelated worker for T2", "failed")
        val workers = listOf(research, unrelated)
        val before = task().copy(workerIds = listOf(research.id))
        val handedOff = before.copy(ownerThreadId = "main", revision = 2)
        // The previous lookup really would select the unrelated record after handoff.
        assertEquals(unrelated, workers.find { it.id in handedOff.workerIds && it.threadId == handedOff.ownerThreadId })
        // Production presentation consumes only bare IDs; it cannot produce a route,
        // title, status or thread by joining a mutable owner to worker summaries.
        assertEquals(listOf("Worker ID · same"), boardWorkerLabels(before))
        assertEquals(boardWorkerLabels(before), boardWorkerLabels(handedOff))
        assertTrue(boardWorkerLabels(handedOff).none { unrelated.title in it || unrelated.status in it || "main" in it })
    }

    @Test fun releaseAndUniqueGlobalCandidateStillDoNotEstablishOrigin() {
        val original = worker("research", "Original worker", "done")
        val task = task().copy(workerIds = listOf(original.id))
        val released = task.copy(ownerThreadId = null, revision = 3)
        val unrelated = worker("main", "Another task's worker", "failed")
        assertEquals(unrelated, listOf(original, unrelated).find { it.id in released.workerIds && it.threadId == (released.ownerThreadId ?: "main") })
        val reassigned = released.copy(ownerThreadId = "another-thread", revision = 4)
        assertEquals(listOf("Worker ID · same"), boardWorkerLabels(released))
        assertEquals(boardWorkerLabels(released), boardWorkerLabels(reassigned))
        assertFalse(boardWorkerLabels(released).any { original.title in it || original.status in it || original.threadId!! in it })
        assertEquals(emptyList<String>(), boardWorkerLabels(task.copy(workerIds = emptyList())))
    }
}
