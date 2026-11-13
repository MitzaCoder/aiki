package io.github.mitzacoder.kemiri.tasks

import io.github.mitzacoder.kemiri.features.tasks.taskRefSummary
import io.github.mitzacoder.kemiri.protocol.*
import org.junit.Assert.*
import org.junit.Test

class TaskRefSummaryTest {
    private fun pull(state: String, checks: String?) = RefStatusPull(ref = "#1", url = "https://example.com/ref", title = "Synthetic ref", checkedAt = "2026-01-01T00:00:00Z", state = state, checks = checks)

    @Test fun prioritizesOnlyActionableChecks() {
        val summary = taskRefSummary(listOf(pull("open", "failing"), pull("draft", "pending"), null))
        assertEquals("2 PRs · 1 unknown", summary.counts)
        assertEquals("1 PR failing checks · 1 PR running checks", summary.status)
        assertTrue(summary.attention)
    }
    @Test fun mergedAndClosedChecksAreHistorical() {
        val summary = taskRefSummary(listOf(pull("merged", "failing"), pull("closed", "pending")))
        assertEquals("2 closed", summary.status)
        assertFalse(summary.attention)
    }
    @Test fun unknownIsNeverClosed() {
        val summary = taskRefSummary(listOf(null, null))
        assertEquals("2 refs", summary.counts)
        assertEquals("2 status unknown", summary.status)
        assertFalse(summary.attention)
    }
    @Test fun countsIssuesAndTicketCategories() {
        val issue = RefStatusIssue(ref = "#2", url = "https://example.com/issue", title = "Synthetic issue", checkedAt = "2026-01-01T00:00:00Z", state = "open")
        val ticket = RefStatusJira(ref = "EX-1", url = "https://example.com/ticket", title = "Synthetic ticket", checkedAt = "2026-01-01T00:00:00Z", status = "Verified", category = "done")
        val summary = taskRefSummary(listOf(issue, ticket))
        assertEquals("1 issue · 1 ticket", summary.counts)
        assertEquals("1 open · 1 closed", summary.status)
    }
}
