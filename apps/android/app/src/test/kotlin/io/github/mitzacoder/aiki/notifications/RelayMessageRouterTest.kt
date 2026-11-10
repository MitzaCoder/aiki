package io.github.mitzacoder.aiki.notifications

import io.github.mitzacoder.aiki.data.wireJson
import io.github.mitzacoder.aiki.features.notifications.*
import io.github.mitzacoder.aiki.features.notifications.relay.*
import io.github.mitzacoder.aiki.protocol.NotificationPayload
import java.io.File
import java.nio.file.Files
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.*
import org.junit.Assert.*
import org.junit.Test

class RelayMessageRouterTest {
    private class Fixture {
        val time = RelayFakeTime()
        val key = RelayCrypto.unbase64(RelayCrypto.newSecret())
        val route = RelayRoute(RelayCrypto.newId(), RelayCrypto.newId(), RelayCrypto.newId(), "backend", "session",
            "local-backend", phonePublicKey = "public", salt = RelayCrypto.newSecret(),
            notificationKey = RelayCrypto.base64(key), phase = RelayRoute.Phase.Active,
            clock = RelayClock(time.now, time.monotonic, time.bootId))
        val store = RelayMemoryStore(RelayState(installationId = RelayCrypto.newId(), signedIn = true,
            routes = mapOf(route.routeId to route), selectedBackends = mapOf(route.backendKey to route.sessionId)))
        val shown = mutableListOf<NotificationPayload>()
        val router = RelayMessageRouter({ true }, { store }, time, { false }, {
            assertTrue("Admission must be durable before display", store.state.admissions.isNotEmpty())
            shown.add(it)
        })
        fun plain(sequence: String = "1", event: String = RelayCrypto.newId()) = RelayPlaintext("backend", "session", sequence,
            time.now, time.now + 1000, event, payload())
        fun envelope(plain: RelayPlaintext = plain()) = RelayCrypto.encrypt(key, route.context(), plain)
        suspend fun receive(raw: String) = router.receive(mapOf("aiki" to raw))
    }

    @Test fun randomKeyDecryptsAndOverridesRoutingFromLocalMapping() = runTest {
        val f = Fixture()
        f.receive(f.envelope())
        assertEquals(1, f.shown.size)
        assertEquals("local-backend", f.shown.single().backendKey)
        assertEquals("title", f.shown.single().title)
        assertEquals(1L, f.store.state.counters["accepted"])
    }

    @Test fun sharedVectorsPassThroughTheRealRouterAndParser() = runTest {
        val vectors = generateSequence(File(requireNotNull(System.getProperty("user.dir"))).absoluteFile) { it.parentFile }
            .map { File(it, "packages/protocol/test-vectors/push-relay-v1.json") }.first { it.isFile }
        val root = Json.parseToJsonElement(vectors.readText()).jsonObject
        val key = root.getValue("keys").jsonObject.getValue("notification").jsonPrimitive.content
        for (raw in root.getValue("encryptions").jsonArray) {
            val vector = raw.jsonObject
            val context = vector.getValue("context").jsonObject
            fun field(name: String) = context.getValue(name).jsonPrimitive.content
            val plain = RelayCrypto.readPlaintext(vector.getValue("plaintext"))
            val time = RelayFakeTime(now = plain.createdAt)
            val route = RelayRoute(field("routeId"), field("keyId"), RelayCrypto.newId(), field("backendId"),
                field("sessionId"), "local", phonePublicKey = "public", salt = RelayCrypto.newSecret(),
                notificationKey = key, phase = RelayRoute.Phase.Active, clock = RelayClock(time.now, time.monotonic, time.bootId))
            val store = RelayMemoryStore(RelayState(signedIn = true, routes = mapOf(route.routeId to route)))
            val shown = mutableListOf<NotificationPayload>()
            val router = RelayMessageRouter({ true }, { store }, time, { false }, { shown.add(it) })
            router.receive(mapOf("aiki" to vector.getValue("envelope").jsonPrimitive.content))
            assertEquals(1L, store.state.counters["accepted"])
            val expected = parseNotificationPayload(JsonObject(plain.payload + ("backendKey" to JsonPrimitive("local"))).toString())
            assertEquals(if (expected == null) 0 else 1, shown.size)
            if (expected != null) assertEquals(expected.copy(backendKey = "local"), shown.single())
        }
    }

    @Test fun tamperWrongRouteWrongSessionVersionAndUnknownRouteNeverDisplay() = runTest {
        for (kind in listOf("tamper", "wrong-route", "session", "version", "unknown-route", "key")) {
            val f = Fixture()
            var envelope = f.envelope()
            val raw = Json.parseToJsonElement(envelope).jsonObject
            envelope = when (kind) {
                "tamper" -> JsonObject(raw + ("c" to JsonPrimitive(RelayCrypto.base64(ByteArray(528))))).toString()
                "wrong-route", "unknown-route" -> JsonObject(raw + ("r" to JsonPrimitive(RelayCrypto.newId()))).toString()
                "key" -> JsonObject(raw + ("k" to JsonPrimitive(RelayCrypto.newId()))).toString()
                "version" -> JsonObject(raw + ("v" to JsonPrimitive(2))).toString()
                "session" -> {
                    val wrong = f.route.context().copy(sessionId = "foreign")
                    RelayCrypto.encrypt(f.key, wrong, f.plain().copy(sessionId = "foreign"))
                }
                else -> error("unreachable")
            }
            f.receive(envelope)
            assertTrue(kind, f.shown.isEmpty())
            assertEquals(kind, 1L, f.store.state.counters.values.sum())
        }
    }

    @Test fun replayAndCrossKeyDuplicateNeverDisplayButReorderingInsideWindowDoes() = runTest {
        val f = Fixture()
        val event = RelayCrypto.newId()
        val first = f.envelope(f.plain("5", event))
        f.receive(first)
        f.receive(first)
        f.receive(f.envelope(f.plain("4")))
        val successorKey = RelayCrypto.unbase64(RelayCrypto.newSecret())
        val successor = f.route.copy(routeId = RelayCrypto.newId(), keyId = RelayCrypto.newId(),
            notificationKey = RelayCrypto.base64(successorKey))
        f.store.state = f.store.state.copy(routes = f.store.state.routes + (successor.routeId to successor))
        f.receive(RelayCrypto.encrypt(successorKey, successor.context(), f.plain("1", event)))
        assertEquals(2, f.shown.size)
        assertEquals(1L, f.store.state.counters["replay"])
        assertEquals(1L, f.store.state.counters["event_duplicate"])
        // A process restart restores the same admission window.
        RelayMessageRouter({ true }, { f.store }, f.time, { false }, { error("replay displayed") })
            .receive(mapOf("aiki" to first))
        assertEquals(2L, f.store.state.counters["replay"])
    }

    @Test fun expiredClockUntrustedAndDeletedOrSignedOutRoutesNeverDisplay() = runTest {
        for (kind in listOf("expired", "clock", "reboot", "deleted", "signed-out", "retired")) {
            val f = Fixture()
            val envelope = f.envelope()
            when (kind) {
                "expired" -> f.time.monotonic += 302000
                "clock" -> f.store.state = f.store.state.copy(routes = mapOf(f.route.routeId to f.route.copy(clock = null)))
                "reboot" -> f.time.bootId = "new-boot"
                "deleted" -> f.store.state = f.store.state.copy(routes = emptyMap())
                "signed-out" -> f.store.state = f.store.state.copy(signedIn = false)
                "retired" -> f.store.state = f.store.state.copy(routes = mapOf(f.route.routeId to f.route.copy(
                    phase = RelayRoute.Phase.Retiring, retireAt = 0)))
            }
            f.receive(envelope)
            assertTrue(kind, f.shown.isEmpty())
            assertEquals(kind, 1L, f.store.state.counters.values.sum())
        }
    }

    @Test fun diskFailureNeverDisplaysAndDoesNotConsumeAdmission() = runTest {
        val f = Fixture()
        val envelope = f.envelope()
        f.store.failWrite = true
        f.receive(envelope)
        assertTrue(f.shown.isEmpty())
        assertTrue(f.store.state.admissions.isEmpty())
        f.store.failWrite = false
        f.receive(envelope)
        assertEquals(1, f.shown.size)
    }

    @Test fun plaintextDowngradeIsBlockedOnlyForLocallySelectedBackend() = runTest {
        val f = Fixture()
        val shown = mutableListOf<NotificationPayload>()
        val router = RelayMessageRouter({ true }, { f.store }, f.time, { false }, { shown.add(it) })
        router.receive(mapOf("payload" to payload("local-backend").toString()))
        assertTrue(shown.isEmpty())
        assertEquals(1L, f.store.state.counters["plaintext_downgrade"])
        val direct = payload("direct-backend").toString()
        router.receive(mapOf("payload" to direct))
        assertEquals(parseNotificationPayload(direct), shown.single())
        f.store.state = f.store.state.copy(routes = emptyMap())
        router.receive(mapOf("payload" to payload("local-backend").toString()))
        assertEquals(1, shown.size)
    }

    @Test fun offAndUpgradedSettingsNeverOpenRelayFileAccountClientOrBackend() = runTest {
        val directory = Files.createTempDirectory("relay-off").toFile()
        val file = File(directory, "relay.preferences_pb")
        val old = wireJson.decodeFromString(NotificationSettings.serializer(), """{"enabled":true,"fcmToken":"old-token"}""")
        assertFalse(old.relayEnabled)
        val shown = mutableListOf<NotificationPayload>()
        val relay = RelayNotifications({ old }, {
            file.writeText("must never exist")
            error("relay store used while off")
        }, { error("account/client used while off") }, { error("backend used while off") }, RelayFakeTime(), { shown.add(it) })
        try {
            relay.tokenChanged("new-token")
            relay.foreground()
            assertFalse(relay.selected("direct-backend"))
            relay.receive(mapOf("aiki" to "untrusted"))
            val direct = payload("direct-backend").toString()
            relay.receive(mapOf("payload" to direct))
            assertEquals(listOf(parseNotificationPayload(direct)), shown)
            assertFalse(file.exists())
            assertEquals("old-token", old.fcmToken)
        } finally { directory.deleteRecursively() }
    }

    @Test fun recoveryRequiredNeverFallsBackOnSubsequentPlaintextPushes() = runTest {
        val relay = RelayNotifications({ NotificationSettings(relayRecoveryRequired = true) },
            { error("no relay file after key loss") }, { error("no client") }, { error("no backend") }, RelayFakeTime(),
            { error("no plaintext downgrade after key loss") })
        relay.receive(mapOf("payload" to payload().toString()))
        relay.tokenChanged("new-token")
        relay.foreground()
    }

    @Test fun invalidatedStoreDoesNotDowngradeCurrentMessage() = runTest {
        var lost = 0
        val store = RelayMemoryStore(RelayState(failure = RelayErrorCode.StorageUnavailable))
        val router = RelayMessageRouter({ true }, { store }, RelayFakeTime(), { error("challenge") },
            { error("must not downgrade") }, { lost++ })
        router.receive(mapOf("payload" to payload().toString()))
        assertEquals(1, lost)
    }

    companion object {
        private fun payload(backendKey: String = "untrusted-backend") = buildJsonObject {
            put("kind", "reply")
            put("title", "title")
            put("body", "body")
            put("backendKey", backendKey)
            put("projectId", "project")
            put("workerId", JsonNull)
            put("scheduleId", JsonNull)
            put("tag", "tag")
            put("at", "2030-01-01T00:00:00Z")
            put("futureExtension", buildJsonObject { put("accepted", true) })
        }
    }
}
