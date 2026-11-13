package io.github.mitzacoder.kemiri.status

import io.github.mitzacoder.kemiri.features.status.selfUpdateInProgress
import io.github.mitzacoder.kemiri.protocol.ServerStatus
import io.github.mitzacoder.kemiri.protocol.ServerUpdateRequest
import io.github.mitzacoder.kemiri.data.wireJson
import kotlinx.serialization.encodeToString
import org.junit.Assert.*
import org.junit.Test

class SelfUpdateTest {
    @Test fun activeAndTerminalPhases() {
        listOf("preparing", "waiting", "restarting", "checking").forEach { assertTrue(selfUpdateInProgress(it)) }
        listOf(null, "idle", "cancelled", "failed", "rolled_back", "succeeded").forEach { assertFalse(selfUpdateInProgress(it)) }
    }
    @Test fun requestsCarryTheConfirmedVersionNotAUrl() {
        val encoded = wireJson.encodeToString(ServerUpdateRequest(id = "test", action = "force", version = "v0.1.0-pilot.3"))
        assertTrue(encoded.contains("server.update"))
        assertTrue(encoded.contains("v0.1.0-pilot.3"))
        assertFalse(encoded.contains("releaseBase"))
    }
}
