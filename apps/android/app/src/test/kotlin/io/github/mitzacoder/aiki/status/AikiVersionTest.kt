package io.github.mitzacoder.aiki.status

import io.github.mitzacoder.aiki.features.status.aikiVersionLabel
import io.github.mitzacoder.aiki.features.status.backendVersion
import io.github.mitzacoder.aiki.features.status.versionLabel
import io.github.mitzacoder.aiki.protocol.*
import org.junit.Assert.*
import org.junit.Test

class AikiVersionTest {
    private val source = ServerStatus(release = null, deploy = null, busy = ServerStatusBusy(0, 0), startedAt = "2026-01-01T00:00:00Z")
    private val updates = ReleaseUpdateState(enabled = true, installedVersion = "v0.1.0-pilot.2", channel = "pilot", available = null, dismissedVersion = null)
    private val installed = source.copy(updates = updates)

    @Test fun installedReleaseWinsOverHello() {
        assertEquals("Aiki v0.1.0-pilot.2", aikiVersionLabel("0.1.0-pilot.1", installed))
        assertEquals("v0.1.0-pilot.2", versionLabel("0.1.0-pilot.2"))
        assertEquals("v0.1.0-pilot.2", versionLabel("v0.1.0-pilot.2"))
    }
    @Test fun checkoutUsesTagOrShortCommitThenDev() {
        val release = ReleaseInfo("v0.1.0-pilot.2", "abcdef123456", "Synthetic release", source.startedAt)
        assertEquals("v0.1.0-pilot.2", backendVersion("old", source.copy(release = release)))
        assertEquals("abcdef1", backendVersion("old", source.copy(release = release.copy(name = "checkout"))))
        assertEquals("Aiki dev", aikiVersionLabel("0.1.0-pilot.2", source))
    }
    @Test fun legacyHelloAndMissingBackendDoNotInventAnInstalledVersion() {
        assertEquals("Aiki v0.1.0-pilot.1", aikiVersionLabel("0.1.0-pilot.1", null))
        assertEquals("Aiki", aikiVersionLabel(null, null))
        assertNull(backendVersion(null, null))
        assertEquals("abcdef1", versionLabel("abcdef1"))
        assertEquals("dev", versionLabel("dev"))
    }
    @Test fun updateAnnouncementRespectsDismissalChecksAndSchema() {
        val available = ReleaseUpdateStateAvailable("v0.1.0-pilot.3", "https://example.test/releases/v0.1.0-pilot.3")
        val state = updates.copy(available = available)
        fun label(value: ReleaseUpdateState) = aikiVersionLabel("old", source.copy(updates = value))
        assertEquals("Aiki v0.1.0-pilot.2 → v0.1.0-pilot.3 available", label(state))
        assertEquals("Aiki v0.1.0-pilot.2", label(state.copy(enabled = false)))
        assertEquals("Aiki v0.1.0-pilot.2", label(state.copy(dismissedVersion = available.version)))
        assertEquals("Aiki v0.1.0-pilot.2", label(state.copy(available = null)))
        assertTrue(label(state.copy(dismissedVersion = "v0.1.0-pilot.1")).contains("→ v0.1.0-pilot.3 available"))
        assertFalse(label(state.copy(schemaVersion = 2L)).contains("available"))
    }
}
