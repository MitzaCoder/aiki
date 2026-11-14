package io.github.mitzacoder.kemiri.tasks

import io.github.mitzacoder.kemiri.features.tasks.*
import io.github.mitzacoder.kemiri.protocol.*
import java.time.ZoneId
import org.junit.Assert.*
import org.junit.Test

class TaskTimelineGroupsTest {
    @org.junit.Before fun use24HourClock() { io.github.mitzacoder.kemiri.data.DeviceTimeFormat.current = io.github.mitzacoder.kemiri.data.TimeFormat.Hour24 }
    @org.junit.After fun restoreClockChoice() { io.github.mitzacoder.kemiri.data.DeviceTimeFormat.current = io.github.mitzacoder.kemiri.data.TimeFormat.Automatic }

    private val start = "2026-11-03T14:00:00Z"
    private val end = "2026-11-03T16:36:00Z"
    private val fact = BoardTimelineFact(at = start, endAt = end, kind = "worker", label = "Worker fern reported", id = "opaque-run", revision = 2, group = "work", outcome = "reported", factCount = 2, source = "worker", ref = "fern", detail = "Checks passed")
    private val group = BoardTimelineGroup("opaque-group", "work", start, BoardTimelineGroupRange(start, end), 2, 2, "1 worker reported", listOf(fact))

    @Test fun sortsByStartingHourNotEvolvingEndAndNeverRebuckets() {
        val later = group.copy(id = "later", hour = "2026-11-03T15:00:00Z", range = BoardTimelineGroupRange("2026-11-03T15:00:00Z", "2026-11-03T15:05:00Z"))
        assertEquals(listOf(later, group), orderedTimelineGroups(listOf(group, later), true))
        assertEquals(listOf(group, later), orderedTimelineGroups(listOf(later, group), false))
        assertEquals("opaque-group", orderedTimelineGroups(listOf(group.copy(label = "Changed label", revision = 3)), true).single().id)
    }
    @Test fun formatsLocalRangesAcrossMidnightAndDaylightSaving() {
        assertEquals("09:00–11:36", timelineRange(start, end, ZoneId.of("America/New_York")))
        assertEquals("23:58–00:04", timelineRange("2026-11-03T23:58:00Z", "2026-11-04T00:04:00Z", ZoneId.of("UTC")))
        assertEquals("01:30–01:45", timelineRange("2026-11-01T05:30:00Z", "2026-11-01T06:45:00Z", ZoneId.of("America/New_York")))
    }
    @Test fun namesAllThreeKinds() {
        assertEquals(listOf("Work", "Decisions and feedback", "Delivery"), listOf("work", "decisions", "delivery").map(::timelineGroupKind))
    }
    @Test fun failuresThenOpenQuestionsDominateRoutineDelivery() {
        val failure = fact.copy(outcome = "rolled_back")
        val question = fact.copy(kind = "question", outcome = "open")
        assertEquals("danger", timelineGroupTone(group.copy(kind = "delivery", entries = listOf(question, failure, fact))))
        assertEquals("warning", timelineGroupTone(group.copy(entries = listOf(question, fact))))
        assertEquals("success", timelineGroupTone(group.copy(kind = "delivery")))
    }
    @Test fun evolvingRowsShowStartAndOutcomeWithoutLosingEvidence() {
        assertEquals("fern · started → reported", fact.timelineEntry().label)
        assertEquals("Checks passed", fact.timelineEntry().detail)
        assertEquals(start, fact.timelineEntry().at)
        assertEquals("Q1 · asked → answered", fact.copy(kind = "question", source = null, ref = "Q1", outcome = "answered").timelineEntry().label)
        assertEquals("F1 · received → addressed", fact.copy(kind = "feedback", source = null, ref = "F1", outcome = "addressed").timelineEntry().label)
        assertEquals(fact.label, fact.copy(factCount = 1).timelineEntry().label)
    }
    @Test fun emptyGroupsRemainDistinctFromAbsentGroupsOnWire() {
        val json = io.github.mitzacoder.kemiri.data.wireJson
        val flat = json.decodeFromString(BoardTaskTimelineResponse.serializer(), """{"type":"board.task.timeline","id":"r","projectId":"p","taskId":"T1","entries":[],"feedback":[]}""")
        assertNull(flat.groups)
        val empty = json.decodeFromString(BoardTaskTimelineResponse.serializer(), """{"type":"board.task.timeline","id":"r","projectId":"p","taskId":"T1","entries":[],"feedback":[],"groups":[],"timelineRevision":7}""")
        assertEquals(emptyList<BoardTimelineGroup>(), empty.groups)
        assertEquals(7L, empty.timelineRevision)
    }
}
