package io.github.mitzacoder.kemiri.notifications

import androidx.datastore.preferences.core.PreferenceDataStoreFactory
import io.github.mitzacoder.kemiri.data.AesGcmDeviceCipher
import io.github.mitzacoder.kemiri.features.notifications.relay.*
import java.nio.file.Files
import javax.crypto.KeyGenerator
import kotlinx.coroutines.*
import kotlinx.coroutines.test.runTest
import org.junit.Assert.*
import org.junit.Test

class RelayStoreTest {
    @Test fun encryptedRoundTripAndStagedSecretsSurviveRestart() = runTest {
        val file = Files.createTempDirectory("relay-store").resolve("relay.preferences_pb").toFile()
        val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
        val data = PreferenceDataStoreFactory.create(scope = scope, produceFile = { file })
        val key = KeyGenerator.getInstance("AES").apply { init(256) }.generateKey()
        val cipher = AesGcmDeviceCipher { key }
        try {
            val store = RelayStore(data, cipher)
            val initial = store.enable()
            RelayCrypto.id(initial.installationId!!)
            val id = RelayCrypto.newId()
            val route = route(id)
            store.update { it.copy(routes = mapOf(id to route), enrollment = RelayEnrollment(
                RelayCrypto.newId(), "synthetic-fcm-token", false, deadline = 1000)) }
            val restarted = RelayStore(data, cipher).read()
            assertEquals(route.privateKey, restarted.routes[id]!!.privateKey)
            assertEquals(route.sendBearer, restarted.routes[id]!!.sendBearer)
            assertEquals(initial.installationId, restarted.installationId)
            assertFalse(file.readBytes().toString(Charsets.ISO_8859_1).contains("synthetic"))
            assertFalse(restarted.toString().contains("synthetic"))
            assertFalse(route.toString().contains("synthetic"))
            assertFalse(restarted.enrollment.toString().contains("synthetic"))
        } finally { scope.cancel(); file.parentFile.deleteRecursively() }
    }

    @Test fun missingKeyDiscardsAuthorityAndRequiresExplicitEnable() = runTest {
        val file = Files.createTempDirectory("relay-loss").resolve("relay.preferences_pb").toFile()
        val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
        val data = PreferenceDataStoreFactory.create(scope = scope, produceFile = { file })
        var available = true
        val key = KeyGenerator.getInstance("AES").apply { init(256) }.generateKey()
        val cipher = AesGcmDeviceCipher({ key }, { check(available); key })
        var resets = 0
        val store = RelayStore(data, cipher) { resets++; available = true }
        try {
            val old = store.enable().installationId
            available = false
            assertEquals(RelayErrorCode.StorageUnavailable, store.read().failure)
            assertNull(store.read().installationId)
            assertEquals(0, resets)
            assertTrue(runCatching { store.update { it } }.isFailure)
            assertNotEquals(old, store.enable().installationId)
            assertEquals(1, resets)
        } finally { scope.cancel(); file.parentFile.deleteRecursively() }
    }

    @Test fun retirementPrunesKeyAndWindowTogetherAtThirteenHours() {
        val route = route(RelayCrypto.newId()).copy(phase = RelayRoute.Phase.Retiring, retireAt = RelayCrypto.RETENTION_MS)
        val plain = RelayPlaintext("backend", "session", "1", 0, 1000, RelayCrypto.newId(),
            kotlinx.serialization.json.buildJsonObject {})
        val admission = RelayAdmission()
        admission.admit(route.keyId, plain, 0, {})
        val state = RelayState(routes = mapOf(route.routeId to route),
            admissions = mapOf(route.admissionId() to admission.serialize()))
        assertEquals(1, state.retire(RelayCrypto.RETENTION_MS - 1).routes.size)
        val retired = state.retire(RelayCrypto.RETENTION_MS)
        assertTrue(retired.routes.isEmpty())
        assertFalse(retired.admissions.values.single().contains(route.keyId))
        assertTrue(retired.admissions.values.single().contains(plain.eventId))
    }

    @Test fun clockRejectsRebootBackwardsAndExcessiveUncertainty() {
        val clock = RelayClock(10000, 100, "boot")
        assertEquals(10001L, clock.now(101, "boot"))
        assertNull(clock.now(99, "boot"))
        assertNull(clock.now(101, "other"))
        assertEquals(10001L + RelayCrypto.RETENTION_MS, clock.now(101 + RelayCrypto.RETENTION_MS, "boot"))
        assertNull(clock.copy(uncertaintyMs = 10001).now(101, "boot"))
    }

    private fun route(id: String) = RelayRoute(id, RelayCrypto.newId(), RelayCrypto.newId(), "backend", "session",
        "local", RelayCrypto.bearer("send", id), RelayCrypto.bearer("delete", id), "synthetic-private",
        "synthetic-public", RelayCrypto.newSecret())
}
