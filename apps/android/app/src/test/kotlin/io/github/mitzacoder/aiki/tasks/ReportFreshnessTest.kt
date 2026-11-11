package io.github.mitzacoder.aiki.tasks

import io.github.mitzacoder.aiki.features.tasks.*
import io.github.mitzacoder.aiki.protocol.*
import org.junit.Assert.*
import org.junit.Test
import java.time.Instant

class ReportFreshnessTest {
    private val now = Instant.parse("2026-01-01T12:00:00Z").toEpochMilli()
    private val section = BoardReportSection(writtenAt = "2026-01-01T10:00:00Z", writtenBy = null, version = 1,
        coveredEventSeq = 1, approximate = false, stale = true, eventsSince = 6, reasons = listOf("Q121 answered"))
    private val report = BoardTaskReport(now = "Working", results = "", next = "Await answer", revision = 1,
        updatedAt = null, updatedBy = null, freshness = BoardTaskReportFreshness(results = section, next = section))

    @Test fun oneTapRequestLeavesSectionsReasonAndStatusOut() {
        val request = reportStaleRequest("project-example", "T1")
        val json = kotlinx.serialization.json.Json { encodeDefaults = false }
            .encodeToString(BoardReportStaleRequest.serializer(), request)
        assertEquals("project-example", request.projectId)
        assertEquals("T1", request.taskId)
        assertNull(request.sections)
        assertNull(request.reason)
        assertFalse(json.contains("sections"))
        assertFalse(json.contains("reason"))
        assertFalse(json.contains("status"))
        assertEquals("This looks out of date. Ask the agent to update", REPORT_STALE_LABEL)
        assertEquals("Asked the agent to update", REPORT_STALE_CONFIRMATION)
        assertEquals(4000L, REPORT_STALE_CONFIRMATION_MS)
    }

    @Test fun featureAndMetadataAreBothRequired() {
        assertTrue(reportFreshnessVisible(true, report))
        assertFalse(reportFreshnessVisible(false, report))
        assertFalse(reportFreshnessVisible(true, report.copy(freshness = null)))
    }
    @Test fun agesTickAndApproximateDatesAreHonest() {
        assertEquals("written 2 h ago · 6 events since", reportSectionAge(section, now))
        assertEquals("written about 3 h ago · 6 events since", reportSectionAge(section.copy(approximate = true), now + 3600000))
    }
    @Test fun missingDateAndZeroEventsMakeNoClaim() {
        assertEquals("", reportSectionAge(section.copy(writtenAt = null, eventsSince = 0), now))
        assertEquals("written 2 h ago · 1 event since", reportSectionAge(section.copy(eventsSince = 1), now))
    }
    @Test fun populatedLegacySectionsWithoutWrittenAtOmitOnlyTheAge() {
        val legacy = report.copy(results = "Card view implemented", next = "Review the proof")
        assertTrue(legacy.results.isNotBlank() && legacy.next.isNotBlank())
        val undated = section.copy(writtenAt = null)
        assertEquals("6 events since", reportSectionAge(undated, now))
        assertEquals("needs update · Q121 answered", reportSectionStaleness(undated))
        assertEquals("", reportSectionAge(undated.copy(eventsSince = 0), now))
    }
    @Test fun reasonsOnlyAppearForStaleSections() {
        assertEquals("needs update · Q121 answered", reportSectionStaleness(section))
        assertEquals("needs update · Q121 answered; marked out of date", reportSectionStaleness(section.copy(reasons = listOf("Q121 answered", "marked out of date"))))
        assertNull(reportSectionStaleness(section.copy(stale = false)))
    }
    @Test fun finishedEmptyResultsAreExplicit() {
        assertTrue(emptyFinishedResults("review", ""))
        assertTrue(emptyFinishedResults("done", " "))
        assertFalse(emptyFinishedResults("in_progress", ""))
        assertFalse(emptyFinishedResults("done", "Evidence"))
    }
}
