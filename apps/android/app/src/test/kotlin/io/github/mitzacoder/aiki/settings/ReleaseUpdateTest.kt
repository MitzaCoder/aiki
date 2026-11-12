package io.github.mitzacoder.aiki.settings

import io.github.mitzacoder.aiki.features.status.UPDATE_INSTRUCTIONS
import io.github.mitzacoder.aiki.features.status.visibleReleaseUpdate
import io.github.mitzacoder.aiki.protocol.ReleaseUpdateState
import io.github.mitzacoder.aiki.protocol.ReleaseUpdateStateAvailable
import io.github.mitzacoder.aiki.protocol.ServerStatus
import io.github.mitzacoder.aiki.data.wireJson
import kotlinx.serialization.decodeFromString
import org.junit.Assert.*
import org.junit.Test

class ReleaseUpdateTest {
    private val available = ReleaseUpdateStateAvailable("v0.1.0-pilot.2", "https://github.com/MitzaCoder/aiki/releases/tag/v0.1.0-pilot.2")
    private val state = ReleaseUpdateState(enabled = true, installedVersion = "v0.1.0-pilot.1", channel = "pilot", available = available, dismissedVersion = null)

    @Test fun bannerIsQuietWhenMissingDisabledOrDismissed() {
        assertFalse(visibleReleaseUpdate(null))
        assertFalse(visibleReleaseUpdate(state.copy(enabled = false)))
        assertFalse(visibleReleaseUpdate(state.copy(available = null)))
        assertFalse(visibleReleaseUpdate(state.copy(dismissedVersion = available.version)))
        assertFalse(visibleReleaseUpdate(state.copy(schemaVersion = 2L)))
        assertTrue(visibleReleaseUpdate(state))
        assertTrue(visibleReleaseUpdate(state.copy(dismissedVersion = "v0.1.0-pilot.1")))
    }
    @Test fun oldServersHaveNoNoticeAndUnknownFieldsAreIgnored() {
        val old = wireJson.decodeFromString<ServerStatus>("""{"release":null,"deploy":null,"busy":{"conversations":0,"workers":0},"startedAt":"2026-01-01T00:00:00Z","future":true}""")
        assertNull(old.updates)
    }
    @Test fun instructionsRequireManualStopAndRestart() {
        assertEquals("Stop Aiki, then aiki update, then start it.", UPDATE_INSTRUCTIONS)
    }
}
