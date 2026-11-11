package io.github.mitzacoder.aiki.tasks

import io.github.mitzacoder.aiki.features.tasks.*
import io.github.mitzacoder.aiki.data.DeviceSettings
import io.github.mitzacoder.aiki.data.wireJson
import io.github.mitzacoder.aiki.protocol.BoardTimelineEntry
import java.time.Instant
import java.time.ZoneId
import org.junit.Assert.*
import org.junit.Test

class TaskTimelineTest {
    private val entries = listOf(
        BoardTimelineEntry("2026-11-02T14:00:00Z", "status", "todo → in_progress"),
        BoardTimelineEntry("2026-11-03T14:00:00Z", "worker", "Worker lens reported"),
        BoardTimelineEntry("2026-11-03T14:00:00Z", "milestone", "Preview ready"),
    )
    @Test fun ordersBothWaysWithoutMutatingAndKeepsEqualTimeDirection() {
        assertEquals(entries.reversed(), orderedTimeline(entries, true))
        assertEquals(listOf(entries[0], entries[2], entries[1]), orderedTimeline(entries.reversed(), false))
        assertEquals(emptyList<BoardTimelineEntry>(), orderedTimeline(emptyList(), true))
    }
    @Test fun oldPreferencesDefaultToNewestAndToggleChoiceRoundTrips() {
        val defaults = wireJson.decodeFromString(DeviceSettings.serializer(), "{}")
        assertTrue(defaults.timelineNewestFirst)
        val stored = wireJson.encodeToString(DeviceSettings.serializer(), defaults.copy(timelineNewestFirst = false))
        assertFalse(wireJson.decodeFromString(DeviceSettings.serializer(), stored).timelineNewestFirst)
    }
    @Test fun timelineOrderAndProjectGraphViewRoundTripIndependently() {
        val settings = DeviceSettings(
            timelineNewestFirst = false,
            projectTasksView = mapOf("https://backend.example.test" to mapOf("demo" to "graph")),
        )
        val stored = wireJson.encodeToString(DeviceSettings.serializer(), settings)
        val restored = wireJson.decodeFromString(DeviceSettings.serializer(), stored)
        assertFalse(restored.timelineNewestFirst)
        assertEquals("graph", restored.projectTasksView["https://backend.example.test"]?.get("demo"))
        assertEquals(restored.projectTasksView, restored.copy(timelineNewestFirst = true).projectTasksView)
        assertFalse(restored.copy(projectTasksView = emptyMap()).timelineNewestFirst)
    }
    @Test fun groupsCalendarDaysAcrossMidnightAndDaylightSaving() {
        val zone = ZoneId.of("America/New_York")
        val now = Instant.parse("2026-11-03T05:05:00Z").toEpochMilli()
        assertEquals("Today", timelineDay("2026-11-03T05:00:00Z", now, zone))
        assertEquals("Yesterday", timelineDay("2026-11-03T04:59:00Z", now, zone))
        assertNotEquals("Yesterday", timelineDay("2026-11-01T04:00:00Z", now, zone))
    }
    @Test fun summariesStatusAndFailureToneKeepMeaning() {
        assertEquals(listOf("todo", "in progress"), timelineStatus(entries[0].label))
        assertNull(timelineStatus("Imported history"))
        assertEquals("Checked the map. Next: contrast.", timelineDetail("Checked the map.\n\nNext: contrast."))
        assertEquals("success", timelineTone(entries[1]))
        assertEquals("danger", timelineTone(entries[1].copy(label = "Worker lens failed")))
    }
}
