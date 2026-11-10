package io.github.mitzacoder.aiki.settings

import io.github.mitzacoder.aiki.features.settings.*
import io.github.mitzacoder.aiki.navigation.Destination
import io.github.mitzacoder.aiki.protocol.ScheduleRun
import org.junit.Assert.*
import org.junit.Test

class SchedulePresentationTest {
    @Test fun threadAlwaysDescribesItsOwnWorkspaceRegardlessOfWorkerSetting() {
        assertEquals("Background thread · own workspace", scheduleExecutionLabel("thread", "shared"))
        assertEquals("Background thread · own workspace", scheduleExecutionLabel("thread", "workspace"))
        assertEquals("Worker · shared checkout", scheduleExecutionLabel(null, "shared"))
        assertEquals("Worker · isolated workspace", scheduleExecutionLabel("worker", "workspace"))
    }
    @Test fun savedWorkerIsolationSurvivesThreadPresentationAndRoundTrip() {
        listOf("shared", "workspace").forEach { isolation ->
            val saved = io.github.mitzacoder.aiki.protocol.Schedule(
                title = "Nightly", brief = "Review", spec = scheduleSpec("interval", "60", "", emptySet(), ""),
                model = null, thinkingLevel = null, isolation = isolation, onReport = "record", enabled = false,
                kind = "thread", id = "schedule", createdBy = "user", createdAt = "now", updatedAt = "now", nextRunAt = null, runs = emptyList())
            val input = saved.toInput()
            assertEquals("thread", input.kind)
            assertEquals(isolation, input.isolation)
            assertFalse(input.enabled)
            assertEquals("Background thread · own workspace", scheduleExecutionLabel(input.kind, input.isolation))
            val backToWorker = input.copy(kind = "worker")
            assertEquals(isolation, backToWorker.isolation)
            assertEquals(scheduleExecutionLabel("worker", isolation), scheduleExecutionLabel(backToWorker.kind, backToWorker.isolation))
        }
    }
    @Test fun reportAndHistoryLabelsExplainTheActualOperation() {
        assertEquals("Main reviews the summary", scheduleReportLabel("thread", "review"))
        assertEquals("Coordinator reviews the report", scheduleReportLabel("worker", "review"))
        assertEquals("Record only", scheduleReportLabel("thread", "record"))
        assertEquals("Record only", scheduleReportLabel(null, "record"))
        assertEquals(listOf("Started", "Skipped", "Failed"), listOf("started", "skipped", "failed").map(::scheduleOutcomeLabel))
        assertEquals(listOf("Scheduled", "Catch-up", "Run by hand"), listOf("schedule", "catch-up", "manual").map(::scheduleTriggerLabel))
        assertEquals("future-value", scheduleOutcomeLabel("future-value"))
        assertEquals("future-value", scheduleTriggerLabel("future-value"))
    }
    @Test fun failedOrSkippedRunDoesNotOfferASuccessDestination() {
        val route = Destination.Chat("backend", "project")
        listOf("failed", "skipped").forEach { outcome ->
            assertNull(scheduleRunDestination(route, ScheduleRun("now", "manual", outcome, "worker", "thread", "Not admitted")))
        }
    }
    @Test fun realRunTargetsPreserveOwnerAndClearPreviousWorker() {
        val current = Destination.Chat("backend", "project", "old-thread", "old-worker")
        fun run(thread: String?, worker: String?) = ScheduleRun("2026-11-05T09:00:00Z", "manual", "started", worker, thread, null)
        assertEquals(Destination.Chat("backend", "project", "new-thread"), scheduleRunDestination(current, run("new-thread", null)))
        assertEquals(Destination.Chat("backend", "project", "new-thread", "worker"), scheduleRunDestination(current, run("new-thread", "worker")))
        assertEquals(Destination.Chat("backend", "project", null, "worker"), scheduleRunDestination(current, run(null, "worker")))
        assertNull(scheduleRunDestination(current, run(null, null)))
    }
}
