package io.github.mitzacoder.aiki.notifications

import io.github.mitzacoder.aiki.features.notifications.relay.*
import java.security.KeyPair
import kotlinx.coroutines.test.runTest
import org.junit.Assert.*
import org.junit.Test

class RelayRoutesTest {
    private class Backend(private val time: RelayFakeTime, private val store: RelayMemoryStore) : RelayBackendRegistration {
        val pairs = mutableMapOf<String, KeyPair>()
        var failRegister = false
        var failConfirm = false
        var failActivated = false
        var activated = 0
        override suspend fun register(route: RelayRoute): RelayBackendAgreement {
            assertNotNull(store.state.routes[route.routeId]!!.privateKey)
            assertNotNull(store.state.routes[route.routeId]!!.sendBearer)
            val pair = pairs.getOrPut(route.routeId) { RelayCrypto.generateKeyPair() }
            val publicKey = RelayCrypto.exportPublicKey(pair.public)
            val keys = RelayCrypto.deriveKeys(RelayCrypto.sharedSecret(pair.private, route.phonePublicKey), route.salt, route.context())
            val proof = RelayCrypto.confirmation(keys.getValue("backend-confirm"),
                RelayCrypto.transcript(route.context(), route.salt, route.phonePublicKey, publicKey))
            check(!failRegister) { "synthetic register response lost" }
            return RelayBackendAgreement(publicKey, proof, RelayClock(time.now, time.monotonic, time.bootId))
        }
        override suspend fun confirm(route: RelayRoute, phoneConfirmation: String) {
            assertNotNull(store.state.routes[route.routeId]!!.notificationKey)
            assertEquals(RelayRoute.Phase.Confirming, store.state.routes[route.routeId]!!.phase)
            val keys = RelayCrypto.deriveKeys(RelayCrypto.sharedSecret(pairs.getValue(route.routeId).private,
                route.phonePublicKey), route.salt, route.context())
            RelayCrypto.verifyConfirmation(keys.getValue("phone-confirm"), RelayCrypto.transcript(route.context(), route.salt,
                route.phonePublicKey, RelayCrypto.exportPublicKey(pairs.getValue(route.routeId).public)), phoneConfirmation)
            check(!failConfirm) { "synthetic confirm response lost" }
        }
        override suspend fun activated(route: RelayRoute) {
            check(!failActivated) { "synthetic activation reply lost" }
            assertEquals(RelayRoute.Phase.Active, store.state.routes[route.routeId]!!.phase)
            activated++
        }
    }

    @Test fun stagedSecretsSurviveLostCreateAndResumeSameRoute() = runTest {
        val time = RelayFakeTime()
        val store = enrolled()
        val api = RelayFakeApi(time).apply { lostCreate = true }
        val backend = Backend(time, store)
        val id = RelayRoutes(store, api, backend, time).create("backend", "session", "local")
        val staged = store.state.routes.getValue(id)
        assertEquals(RelayRoute.Phase.Staged, staged.phase)
        api.lostCreate = false
        RelayRoutes(store, api, backend, time).maintain()
        assertEquals(2, api.creates)
        assertEquals(staged.sendBearer, api.staged!!.sendBearer)
        assertEquals(staged.privateKey, api.staged!!.privateKey)
        val active = store.state.routes.getValue(id)
        assertEquals(RelayRoute.Phase.Active, active.phase)
        assertNull(active.privateKey)
        assertNull(active.sendBearer)
        assertNotNull(active.deleteBearer)
        assertNotNull(active.notificationKey)
    }

    @Test fun everyBackendHandshakeCrashPointResumesDurably() = runTest {
        for (phase in listOf("register", "confirm", "activated")) {
            val time = RelayFakeTime()
            val store = enrolled()
            val api = RelayFakeApi(time)
            val backend = Backend(time, store).apply {
                failRegister = phase == "register"
                failConfirm = phase == "confirm"
                failActivated = phase == "activated"
            }
            assertTrue(runCatching { RelayRoutes(store, api, backend, time).create("backend", "session", "local") }.isFailure)
            assertEquals(1, store.state.routes.size)
            backend.failRegister = false
            backend.failConfirm = false
            backend.failActivated = false
            RelayRoutes(store, api, backend, time).maintain()
            assertEquals(RelayRoute.Phase.Active, store.state.routes.values.single().phase)
            assertEquals(1, api.creates)
            assertEquals(1, api.activates)
            assertEquals(1, backend.activated)
        }
    }

    @Test fun rotationKeepsOnlyDecryptAuthorityAndRenewalStartsUnderSevenDays() = runTest {
        val time = RelayFakeTime()
        val store = enrolled()
        val api = RelayFakeApi(time)
        val backend = Backend(time, store)
        val routes = RelayRoutes(store, api, backend, time)
        val first = routes.create("backend", "session", "local")
        routes.maintain()
        assertEquals(0, api.renews)
        store.update { state -> state.copy(routes = state.routes + (first to state.routes.getValue(first)
            .copy(leaseExpiresAt = time.now + RelayRoutes.RENEW_MS - 1))) }
        routes.maintain()
        assertEquals(1, api.renews)
        val second = routes.create("backend", "session", "local", first)
        assertEquals(first, store.state.routes.getValue(second).predecessor)
        assertEquals(RelayRoute.Phase.Retiring, store.state.routes.getValue(first).phase)
        assertEquals(1, store.state.deletions.size)
        // Wall-clock rollback cannot keep a retiring key alive.
        time.now = 0
        time.monotonic += RelayCrypto.RETENTION_MS
        store.update { it.retire(time) }
        assertFalse(first in store.state.routes)
        assertTrue(second in store.state.routes)
    }

    @Test fun localDeleteAndSignOutAreImmediateAndRevocationQueueSurvivesOffline() = runTest {
        val time = RelayFakeTime()
        val store = enrolled()
        val api = RelayFakeApi(time)
        val backend = Backend(time, store)
        val routes = RelayRoutes(store, api, backend, time)
        val first = routes.create("backend", "session", "local")
        routes.remove(first)
        assertTrue(store.state.routes.isEmpty())
        assertEquals("session", store.state.selectedBackends["local"])
        assertEquals(0, api.revokes)
        api.failure = RelayResult.Failure(RelayErrorCode.Network)
        routes.signOut()
        assertFalse(store.state.signedIn)
        assertNull(store.state.installationId)
        routes.cleanup()
        assertEquals(1, store.state.deletions.size)
        api.failure = null
        RelayRoutes(store, api, backend, time).cleanup()
        assertTrue(store.state.deletions.isEmpty())
    }

    private fun enrolled() = RelayMemoryStore(RelayState(installationId = RelayCrypto.newId(), signedIn = true,
        activeToken = "synthetic-token"))
}
