package io.github.mitzacoder.aiki.notifications

import io.github.mitzacoder.aiki.data.*
import io.github.mitzacoder.aiki.features.notifications.*
import io.github.mitzacoder.aiki.features.notifications.relay.*
import io.github.mitzacoder.aiki.protocol.*
import kotlinx.coroutines.test.runTest
import org.junit.Assert.*
import org.junit.Test

class RelayBackendAdapterTest {
    private class Rpc(val time: RelayFakeTime, val store: RelayMemoryStore, val api: RelayFakeApi) : RelayBackendRpc {
        override var connection = connection()
        val registrations = mutableListOf<NotificationsRegisterRelayRequest>()
        val synchronizations = mutableListOf<NotificationsSyncRelayRequest>()
        val answers = mutableMapOf<String, NotificationsRegisterRelayResponse>()
        val pairs = mutableMapOf<String, java.security.KeyPair>()
        var confirms = 0
        var failAt: String? = null
        var wrongIdentity = false
        var wrongHmac = false
        var unknownRequest = false
        override suspend fun register(request: NotificationsRegisterRelayRequest): NotificationsRegisterRelayResponse {
            registrations.add(request)
            assertEquals(request.sendBearer, store.state.routes[request.routeId]!!.sendBearer)
            if (unknownRequest) throw ClientException("unknown_request", "Unknown request")
            val answer = answers.getOrPut(request.operationId) {
                val pair = RelayCrypto.generateKeyPair().also { pairs[request.routeId] = it }
                val context = RelayContext("backend", "session", request.routeId, request.keyId)
                val publicKey = RelayCrypto.exportPublicKey(pair.public)
                val keys = RelayCrypto.deriveKeys(RelayCrypto.sharedSecret(pair.private, request.phonePublicKey), request.salt, context)
                val proof = RelayCrypto.confirmation(keys.getValue("backend-confirm"),
                    RelayCrypto.transcript(context, request.salt, request.phonePublicKey, publicKey))
                NotificationsRegisterRelayResponse(id = request.id, backendPublicKey = publicKey,
                    confirmation = if (wrongHmac) RelayCrypto.newSecret() else proof,
                    backendId = if (wrongIdentity) "foreign" else "backend", sessionId = "session",
                    deviceId = "relay-device", serverTime = time.now - 86400000)
            }
            if (failAt == "register") throw ClientException("disconnected", "synthetic lost registration response")
            return answer
        }
        override suspend fun confirm(request: NotificationsConfirmRelayRequest): NotificationsConfirmRelayResponse {
            confirms++
            assertTrue("Relay activation must precede backend confirmation", api.activates > 0)
            val route = store.state.routes.values.single { it.operationId == request.operationId }
            assertNotNull(route.notificationKey)
            assertEquals(RelayRoute.Phase.Confirmed, route.phase)
            val pair = pairs.getValue(route.routeId)
            val keys = RelayCrypto.deriveKeys(RelayCrypto.sharedSecret(pair.private, route.phonePublicKey), route.salt, route.context())
            RelayCrypto.verifyConfirmation(keys.getValue("phone-confirm"), RelayCrypto.transcript(route.context(), route.salt,
                route.phonePublicKey, RelayCrypto.exportPublicKey(pair.public)), request.confirmation)
            if (failAt == "confirm") throw ClientException("disconnected", "synthetic lost confirmation response")
            return NotificationsConfirmRelayResponse(id = request.id, device = device())
        }
        override suspend fun sync(request: NotificationsSyncRelayRequest): NotificationsSyncRelayResponse {
            synchronizations.add(request)
            time.monotonic += 20
            if (failAt == "sync") throw ClientException("disconnected", "synthetic lost sync response")
            return NotificationsSyncRelayResponse(id = request.id, relay = NotificationRelayStatus(true, "active",
                time.now + 86400000, time.now + 2 * 86400000, "done", null), serverTime = time.now)
        }
    }

    @Test fun realGeneratedRequestsHandshakeOrderAndFreshClockAnchor() = runTest {
        val time = RelayFakeTime()
        val store = enrolled()
        val api = RelayFakeApi(time)
        val rpc = Rpc(time, store, api)
        val preferences = NotificationSettings().preferencesFor("local")
        val adapter = adapter(rpc, time)
        val id = RelayRoutes(store, api, adapter, time).create("backend", "session", "local", label = "Android app",
            preferences = preferences)
        val route = store.state.routes.getValue(id)
        assertEquals(RelayRoute.Phase.Active, route.phase)
        assertEquals("relay-device", route.backendDeviceId)
        assertNull(route.privateKey)
        assertNull(route.sendBearer)
        assertEquals(1, rpc.confirms)
        assertEquals(preferences, rpc.registrations.single().preferences)
        assertTrue("Old registration receipt time was not used", route.clock!!.backendAt >= time.now)
        assertEquals(10L, route.clock.uncertaintyMs)
        assertFalse(rpc.registrations.single().toString().contains("aiki_push1"))
        assertFalse(rpc.registrations.single().toString().contains(route.salt))
    }

    @Test fun everyLostResponseResumesSameOperationAndStagedSecrets() = runTest {
        for (step in listOf("register", "sync", "activate", "confirm")) {
            val time = RelayFakeTime()
            val store = enrolled()
            var activationLost = step == "activate"
            val api = object : RelayFakeApi(time) {
                override suspend fun activate(installationId: String, routeId: String): RelayResult<RelayRouteReceipt> {
                    val success = super.activate(installationId, routeId)
                    return if (activationLost) RelayResult.Failure(RelayErrorCode.Network) else success
                }
            }
            val rpc = Rpc(time, store, api).apply { failAt = step }
            val adapter = adapter(rpc, time)
            runCatching { RelayRoutes(store, api, adapter, time).create("backend", "session", "local",
                preferences = NotificationSettings().preferencesFor("local")) }
            val pending = store.state.routes.values.single()
            assertNotNull(pending.privateKey)
            assertNotNull(pending.sendBearer)
            rpc.failAt = null
            activationLost = false
            RelayRoutes(store, api, adapter, time).maintain()
            assertEquals(RelayRoute.Phase.Active, store.state.routes.values.single().phase)
            assertEquals(1, rpc.registrations.map { it.operationId }.distinct().size)
            assertEquals(1, rpc.registrations.map { it.sendBearer }.distinct().size)
            assertEquals(1, rpc.registrations.map { it.phonePublicKey }.distinct().size)
            assertEquals(pending.operationId, rpc.registrations.first().operationId)
        }
    }

    @Test fun wrongHmacIdentityAndOldServerAbortWithoutActivationOrPlaintextFallback() = runTest {
        for (failure in listOf("hmac", "identity", "unknown_request")) {
            val time = RelayFakeTime()
            val store = enrolled()
            val api = RelayFakeApi(time)
            val rpc = Rpc(time, store, api).apply {
                wrongHmac = failure == "hmac"
                wrongIdentity = failure == "identity"
                unknownRequest = failure == "unknown_request"
            }
            assertTrue(runCatching { RelayRoutes(store, api, adapter(rpc, time), time).create("backend", "session", "local",
                preferences = NotificationSettings().preferencesFor("local")) }.isFailure)
            assertEquals(0, api.activates)
            assertEquals(0, rpc.confirms)
            assertTrue(store.state.routes.isEmpty())
            assertEquals(1, store.state.deletions.size)
            assertEquals(1, store.state.backendDeletions.size)
            assertTrue("No silent direct fallback after attempted relay selection", "local" in store.state.selectedBackends)
        }
    }

    @Test fun featureMissingAnonymousAndOffNeverSendBackendRelayRpc() = runTest {
        val time = RelayFakeTime()
        val store = enrolled()
        val api = RelayFakeApi(time)
        for (kind in listOf("relay-missing", "auth-missing", "anonymous", "off")) {
            val rpc = Rpc(time, store, api)
            rpc.connection = when (kind) {
                "relay-missing" -> connection(features = listOf("device-auth-v1"))
                "auth-missing" -> connection(features = listOf("fcm-relay-v1"))
                "anonymous" -> connection(session = null)
                else -> connection()
            }
            val adapter = RelayBackendAdapter({ kind != "off" }, { rpc }, { NotificationSettings().preferencesFor(it) }, time)
            val id = RelayCrypto.newId()
            val route = RelayRoute(id, RelayCrypto.newId(), RelayCrypto.newId(), "backend", "session", "local",
                phonePublicKey = "public", salt = RelayCrypto.newSecret())
            assertTrue(runCatching { adapter.register(route) }.isFailure)
            assertTrue(rpc.registrations.isEmpty())
            assertTrue(rpc.synchronizations.isEmpty())
        }
    }

    @Test fun syncReportsRenewalPreferencesRepairAndDurableUnregister() = runTest {
        val time = RelayFakeTime()
        val store = enrolled()
        val api = RelayFakeApi(time)
        val rpc = Rpc(time, store, api)
        val adapter = adapter(rpc, time)
        val routes = RelayRoutes(store, api, adapter, time)
        val id = routes.create("backend", "session", "local", preferences = NotificationSettings().preferencesFor("local"))
        store.update { state -> state.copy(tokenGeneration = 2, routes = state.routes + (id to state.routes.getValue(id)
            .copy(leaseExpiresAt = time.now + RelayRoutes.RENEW_MS - 1))) }
        routes.maintain()
        val sync = rpc.synchronizations.last()
        assertEquals(1, api.renews)
        assertEquals(time.now + 30 * 86400000L, sync.leaseExpiresAt)
        assertEquals(true, sync.resume)
        assertNotNull(sync.preferences)
        routes.remove(id)
        assertTrue(store.state.routes.isEmpty())
        assertEquals(1, store.state.backendDeletions.size)
        routes.cleanupBackend()
        assertEquals(true, rpc.synchronizations.last().unregister)
        assertTrue(store.state.backendDeletions.isEmpty())
    }

    @Test fun transportChoiceOffDirectOnRelayAndUnsupportedDirect() = runTest {
        val time = RelayFakeTime()
        val store = enrolled()
        val api = RelayFakeApi(time)
        val rpc = Rpc(time, store, api)
        var settings = NotificationSettings(enabled = true, fcmToken = "synthetic-fcm")
        val relay = RelayNotifications({ settings }, { store }, { api }, { adapter(rpc, time) }, time, {})
        val direct = mutableListOf<NotificationsRegisterFcmRequest>()
        val reads = mutableListOf<String>()
        val registration = object : NotificationRegistrationRpc {
            override suspend fun register(request: NotificationsRegisterFcmRequest): NotificationDevice {
                direct.add(request)
                return device()
            }
            override suspend fun device(deviceId: String): NotificationDevice? { reads.add(deviceId); return device() }
            override suspend fun unregister(deviceId: String) { error("unexpected unregister") }
        }
        suspend fun sync(connection: ConnectionState) {
            syncNotificationRegistration(settings, connection, "legacy-device", "local", "Android app", registration) {
                check(settings.relayEnabled) { "Off must never even evaluate the relay factory" }
                relay
            }
        }
        sync(connection())
        assertEquals(1, direct.size)
        assertEquals("synthetic-fcm", direct.single().token)
        assertEquals("legacy-device", direct.single().deviceId)
        assertEquals(settings.preferencesFor("local"), direct.single().preferences)
        assertEquals(0, api.creates)
        assertTrue(rpc.registrations.isEmpty())
        settings = settings.copy(relayEnabled = true)
        sync(connection(features = listOf("device-auth-v1", "fcm-push")))
        assertEquals(2, direct.size)
        sync(connection())
        assertEquals(2, direct.size)
        assertEquals("relay-device", reads.last())
        assertEquals(1, api.creates)
        assertEquals(1, rpc.confirms)
        // A disappearing feature on an already-selected route cannot silently downgrade it.
        sync(connection(features = listOf("device-auth-v1", "fcm-push")))
        assertEquals(2, direct.size)
    }

    private fun adapter(rpc: Rpc, time: RelayFakeTime) = RelayBackendAdapter({ true }, { rpc },
        { NotificationSettings().preferencesFor(it) }, time)
    private fun enrolled() = RelayMemoryStore(RelayState(installationId = RelayCrypto.newId(), signedIn = true,
        activeToken = "synthetic-token", tokenGeneration = 1))

    companion object {
        private fun connection(features: List<String> = listOf("fcm-relay-v1", "device-auth-v1", "fcm-push"), session: String? = "session") =
            ConnectionState(status = ConnectionStatus.Ready, hello = HelloResponse(id = "hello", backendId = "backend",
                auth = io.github.mitzacoder.aiki.protocol.DeviceAuthState(mode = "optional", sessionId = session, accessExpiresAt = null),
                server = HelloResponseServer(name = "synthetic", version = "1"), features = features))
        private fun device() = NotificationDevice(deviceId = "relay-device", label = "Android app", backendKey = "local",
            preferences = NotificationSettings().preferencesFor("local"), createdAt = "2030-01-01T00:00:00Z",
            lastDelivery = null, transport = "fcm-relay")
    }
}
