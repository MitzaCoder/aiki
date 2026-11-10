package io.github.mitzacoder.aiki.tasks

import io.github.mitzacoder.aiki.data.*
import io.github.mitzacoder.aiki.features.tasks.*
import java.time.Instant
import java.time.ZoneId
import org.junit.Assert.*
import org.junit.Test

class WaitingDatesTest {
    @Test fun defaultAndValidation() {
        assertEquals("08:00", DeviceSettings().workDayStart)
        listOf("", "24:00", "9:00", "08:60").forEach { assertEquals("08:00", normalizeWorkDayStart(it)) }
        assertEquals("17:45", normalizeWorkDayStart("17:45"))
    }
    @Test fun quickPicksAcrossZonesAndDst() {
        val cases = listOf(
            Triple("America/New_York", "2026-03-07T17:00:00Z", listOf("2026-03-08T12:00:00Z", "2026-03-10T12:00:00Z", "2026-03-14T12:00:00Z")),
            Triple("America/New_York", "2026-10-31T16:00:00Z", listOf("2026-11-01T13:00:00Z", "2026-11-03T13:00:00Z", "2026-11-07T13:00:00Z")),
            Triple("Asia/Kathmandu", "2026-03-07T17:00:00Z", listOf("2026-03-08T02:15:00Z", "2026-03-10T02:15:00Z", "2026-03-14T02:15:00Z")),
        )
        cases.forEach { (name, clock, expected) ->
            val zone = ZoneId.of(name)
            val now = Instant.parse(clock)
            listOf(1L, 3L, 7L).forEachIndexed { index, days ->
                assertEquals(expected[index], resolveWaitingDate(waitingDateIn(days, now.atZone(zone).toLocalDate()), "08:00", now, zone))
            }
        }
    }
    @Test fun pastDatesCustomTimeAndDstGapOverlap() {
        val zone = ZoneId.of("America/New_York")
        val now = Instant.parse("2026-03-07T17:00:00Z")
        assertEquals("2026-03-08T12:00:00Z", resolveWaitingDate("2026-03-07", "08:00", now, zone))
        assertEquals("2026-03-08T13:30:00Z", resolveWaitingDate("2026-03-08", "09:30", now, zone))
        assertEquals("2026-03-08T07:30:00Z", resolveWaitingDate("2026-03-08", "02:30", now, zone))
        assertEquals("2026-11-01T05:30:00Z", resolveWaitingDate("2026-11-01", "01:30", now, zone))
        assertEquals("2026-03-07", localWaitingDate("2026-03-08T02:00:00Z", zone))
        assertTrue(formatWaitingTime("2026-03-08T12:00:00Z", zone).contains("08:00"))
        assertNull(resolveWaitingDate(""))
    }
}
