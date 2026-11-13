package io.github.mitzacoder.kemiri.status

import io.github.mitzacoder.kemiri.features.status.kemiriVersionLabel
import io.github.mitzacoder.kemiri.features.status.backendVersion
import io.github.mitzacoder.kemiri.features.status.versionLabel
import io.github.mitzacoder.kemiri.protocol.*
import org.junit.Assert.*
import org.junit.Test

class KemiriVersionTest {
    private val source = ServerStatus(release = null, deploy = null, busy = ServerStatusBusy(0, 0), startedAt = "2026-01-01T00:00:00Z")
    private val updates = ReleaseUpdateState(enabled = true, installedVersion = "v0.1.0-pilot.2", channel = "pilot", available = null, dismissedVersion = null)
    private val installed = source.copy(updates = updates)

    @Test fun installedReleaseWinsOverHello() {
        assertEquals("Kemiri v0.1.0-pilot.2", kemiriVersionLabel("0.1.0-pilot.1", installed))
        assertEquals("v0.1.0-pilot.2", versionLabel("0.1.0-pilot.2"))
        assertEquals("v0.1.0-pilot.2", versionLabel("v0.1.0-pilot.2"))
    }
    @Test fun checkoutUsesTagOrShortCommitThenDev() {
        val release = ReleaseInfo("v0.1.0-pilot.2", "abcdef123456", "Synthetic release", source.startedAt)
        assertEquals("v0.1.0-pilot.2", backendVersion("old", source.copy(release = release)))
        assertEquals("abcdef1", backendVersion("old", source.copy(release = release.copy(name = "checkout"))))
        assertEquals("Kemiri dev", kemiriVersionLabel("0.1.0-pilot.2", source))
    }
    @Test fun legacyHelloAndMissingBackendDoNotInventAnInstalledVersion() {
        assertEquals("Kemiri v0.1.0-pilot.1", kemiriVersionLabel("0.1.0-pilot.1", null))
        assertEquals("Kemiri", kemiriVersionLabel(null, null))
        assertNull(backendVersion(null, null))
        assertEquals("abcdef1", versionLabel("abcdef1"))
        assertEquals("dev", versionLabel("dev"))
    }
    @Test fun updateAnnouncementRespectsDismissalChecksAndSchema() {
        val available = ReleaseUpdateStateAvailable("v0.1.0-pilot.3", "https://example.test/releases/v0.1.0-pilot.3")
        val state = updates.copy(available = available)
        fun label(value: ReleaseUpdateState) = kemiriVersionLabel("old", source.copy(updates = value))
        assertEquals("Kemiri v0.1.0-pilot.2 → v0.1.0-pilot.3 available", label(state))
        assertEquals("Kemiri v0.1.0-pilot.2", label(state.copy(enabled = false)))
        assertEquals("Kemiri v0.1.0-pilot.2", label(state.copy(dismissedVersion = available.version)))
        assertEquals("Kemiri v0.1.0-pilot.2", label(state.copy(available = null)))
        assertTrue(label(state.copy(dismissedVersion = "v0.1.0-pilot.1")).contains("→ v0.1.0-pilot.3 available"))
        assertFalse(label(state.copy(schemaVersion = 2L)).contains("available"))
    }
}
