package io.github.mitzacoder.aiki.panels

import io.github.mitzacoder.aiki.features.panels.*
import io.github.mitzacoder.aiki.protocol.*
import org.junit.Assert.*
import org.junit.Test

/** The Background, Workers and Artifacts tabs' words; mirrors the web's `threads.test.ts`, `workers.test.ts` and `artifacts.test.ts`. */
class PanelWordingTest {
    private val now = java.time.Instant.parse("2026-11-05T12:00:00Z").toEpochMilli()

    private fun thread(status: String = "running", startedBy: String? = "main", scheduleId: String? = null, finishedAt: String? = null) = ThreadSummary(
        id = "th-1", title = "Metrics", status = status, main = false, startedBy = startedBy, scheduleId = scheduleId, conversationId = 2, model = null,
        thinkingLevel = null, onFinish = "report", runningWorkers = 0, ownedTasks = emptyList(), openQuestions = 0, current = null, summary = null,
        failure = null, createdAt = "2026-11-05T10:00:00Z", updatedAt = "2026-11-05T11:51:00Z", finishedAt = finishedAt, archived = false,
    )

    private fun worker(id: String, status: String, updatedAt: String = "2026-11-05T11:00:00Z", isolation: String = "shared", workspacePath: String? = null) = WorkerSummary(
        id = id, title = id, status = status, model = ModelRef(provider = "faux", modelId = "faux-1"), thinkingLevel = null, isolation = isolation,
        workspacePath = workspacePath, conversationId = 3, spawnedByCallId = null, createdAt = updatedAt, updatedAt = updatedAt, lastReport = null, failure = null,
    )

    private fun artifact(kind: String) = Artifact(
        id = kind, projectId = "p", name = "$kind.bin", title = null, note = null, kind = kind, mimeType = "application/octet-stream", size = 1,
        durationSeconds = null, threadId = "main", workerId = null, taskId = null, sourcePath = "/x", createdAt = "2026-11-05T11:00:00Z",
    )

    @Test fun threadFactsInWords() {
        assertNull(runningWorkersText(0))
        assertEquals("1 worker running", runningWorkersText(1))
        assertEquals("2 workers running", runningWorkersText(2))
        assertNull(ownedTasksText(emptyList()))
        assertEquals("Owns T3, T7", ownedTasksText(listOf("T3", "T7")))
        assertEquals("Owns T1, T2, T3 +2", ownedTasksText(listOf("T1", "T2", "T3", "T4", "T5")))
        assertNull(openQuestionsText(0))
        assertEquals("1 question for you", openQuestionsText(1))
        assertEquals("3 questions for you", openQuestionsText(3))
    }

    @Test fun saysWhoStartedAThreadAndWhenItLastMoved() {
        val names = { id: String -> if (id == "s1") "Nightly triage" else null }
        assertEquals("Started by main", threadStartedByText(thread(), names))
        assertEquals("Started by you", threadStartedByText(thread(startedBy = "user"), names))
        assertEquals("Scheduled · Nightly triage", threadStartedByText(thread(startedBy = "schedule", scheduleId = "s1"), names))
        assertEquals("Started by a schedule", threadStartedByText(thread(startedBy = "schedule", scheduleId = "gone"), names))
        assertEquals("Active 9 min ago", threadTimeText(thread(), now).first)
        assertEquals("Updated 9 min ago", threadTimeText(thread(status = "idle"), now).first)
        assertEquals("Ended 1 h ago", threadTimeText(thread(status = "done", finishedAt = "2026-11-05T11:00:00Z"), now).first)
        assertTrue(threadActive(thread()))
        assertTrue(threadActive(thread(status = "idle")))
        assertFalse(threadActive(thread(status = "done")))
    }

    @Test fun placesAndSortsWorkers() {
        assertEquals("shared checkout", workerPlace(worker("a", "idle")))
        assertEquals("/w/a", workerPlace(worker("a", "idle", isolation = "workspace", workspacePath = "/w/a")))
        assertEquals("workspace removed", workerPlace(worker("a", "idle", isolation = "workspace")))
        val sorted = sortWorkers(listOf(worker("old", "done", "2026-11-01T00:00:00Z"), worker("live", "running"), worker("new", "done", "2026-11-04T00:00:00Z")))
        assertEquals(listOf("live", "new", "old"), sorted.map { it.id })
    }

    @Test fun listsTheWorkersNoTaskHas() {
        val loose = io.github.mitzacoder.aiki.features.tasks.workersWithoutTask(
            listOf(worker("owned", "running"), worker("tagged", "running").copy(taskId = "T1"), worker("loose", "running"), worker("old", "done")),
            listOf("owned"),
        )
        assertEquals(listOf("loose", "old"), loose.map { it.id })
    }

    @Test fun splitsTheLooseWorkersIntoTheOnesInPlayAndTheFinishedOnes() {
        val all = listOf("running", "idle", "failed", "stopped", "done").map { worker(it, it) }
        val (active, finished) = io.github.mitzacoder.aiki.features.tasks.splitLooseWorkers(all)
        assertEquals(listOf("running", "idle"), active.map { it.id })
        assertEquals(listOf("failed", "stopped", "done"), finished.map { it.id })
        assertEquals(false, io.github.mitzacoder.aiki.features.tasks.isFinishedWorker("idle"))
        assertEquals(true to true, io.github.mitzacoder.aiki.features.tasks.splitLooseWorkers(emptyList()).let { it.first.isEmpty() to it.second.isEmpty() })
    }

    @Test fun countsArtifactKindsInTheWebsOrder() {
        val kinds = panelArtifactKinds(listOf(artifact("text"), artifact("video"), artifact("image"), artifact("video")))
        assertEquals(listOf("video" to 2, "image" to 1, "text" to 1), kinds)
        assertEquals("Videos", panelArtifactKindLabel("video", true))
        assertEquals("Image", panelArtifactKindLabel("image"))
        assertEquals("Audio", panelArtifactKindLabel("audio", true))
        assertEquals("Files", panelArtifactKindLabel("file", true))
    }
}
