package io.github.mitzacoder.kemiri

import io.github.mitzacoder.kemiri.data.*
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.first
import kotlinx.serialization.json.*
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import okhttp3.*
import org.junit.Assert.*
import org.junit.Test

class DeviceAuthLifecycleTest {
    private class Store(var saved: SavedDeviceAuth? = null) : DeviceAuthStorage {
        val writes = mutableListOf<SavedDeviceAuth>()
        override suspend fun read(origin: String) = saved
        override suspend fun write(origin: String, auth: SavedDeviceAuth) { saved = auth; writes.add(auth) }
    }
    private fun MockWebServer.reply(body: String) = enqueue(MockResponse.Builder().body(body).build())
    private fun credentials(claim: String) = """{"claimId":"$claim","state":"approved","comparisonCode":"ABCD-EFGH","credentials":{"backendId":"backend","sessionId":"session","sessionToken":"aiki_s1.session.retained","accessToken":"access-memory","accessExpiresAt":"2030-01-01T00:15:00Z","rotateAfter":"2030-01-31T00:00:00Z"}}"""
    @Test fun interruptedPairingResumesPersistedProofAndAcknowledgesAfterDurableSession() = runBlocking {
        MockWebServer().use { server ->
            server.start()
            val origin = server.url("/").toString().trimEnd('/')
            val claim = PendingDeviceClaim("saved-claim", "aiki_c1." + "A".repeat(43), "pair", "grant", "aiki_p1." + "A".repeat(43))
            val store = Store(SavedDeviceAuth("backend", pending = claim))
            server.reply("""{"backendId":"backend","mode":"required","authVersion":1}""")
            server.reply(credentials(claim.id))
            server.reply("""{"ok":true}""")
            val auth = DeviceAuth(origin, store, label = "Test phone")
            assertEquals("access-memory", auth.prepare())
            server.takeRequest()
            val redeem = server.takeRequest()
            assertEquals("/auth/pairings/redeem", redeem.url.encodedPath)
            val body = wireJson.parseToJsonElement(redeem.body!!.utf8()).jsonObject
            assertEquals(claim.id, body.string("claimId"))
            assertEquals(claim.secret, body.string("claimSecret"))
            assertEquals("/auth/claims/ack", server.takeRequest().url.encodedPath)
            assertTrue(store.writes.any { it.sessionToken == "aiki_s1.session.retained" && it.pending?.id == claim.id })
            assertEquals("aiki_s1.session.retained", store.saved!!.sessionToken)
            assertNull(store.saved!!.pending)
            assertFalse(wireJson.encodeToString(SavedDeviceAuth.serializer(), store.saved!!).contains("access-memory"))
        }
    }
    @Test fun deniedMigrationDoesNotDisableOptionalAnonymousUse() = runBlocking {
        MockWebServer().use { server ->
            server.start()
            val origin = server.url("/").toString().trimEnd('/')
            val store = Store(SavedDeviceAuth("backend", pending = PendingDeviceClaim("claim", "proof", "migration")))
            val status = """{"backendId":"backend","mode":"optional","authVersion":1}"""
            server.reply(status)
            server.reply("""{"claimId":"claim","state":"denied","credentials":null}""")
            val auth = DeviceAuth(origin, store, label = "Test phone")
            assertNull(auth.prepare())
            auth.migrate { fail("Denied claims cannot authenticate") }
            assertNull(store.saved!!.signedOut)
            assertNotNull(store.saved!!.migrationStopped)
            server.reply(status)
            val restarted = DeviceAuth(origin, store, label = "Test phone")
            assertNull(restarted.prepare())
            restarted.migrate { fail() }
            assertEquals(3, server.requestCount)
        }
    }

    @Test fun stageOneStoppedMigrationRecoversOnceAndPersistsItsReplacementAcrossLaunches() = runBlocking {
        MockWebServer().use { server ->
            server.start()
            val origin = server.url("/").toString().trimEnd('/')
            val store = Store(SavedDeviceAuth("backend", migrationStopped = "Approval expired or was denied. Pair this backend."))
            val status = """{"backendId":"backend","mode":"optional","authVersion":1}"""
            repeat(2) {
                server.reply(status)
                val auth = DeviceAuth(origin, store, label = "Test phone")
                assertNull(auth.prepare())
                server.takeRequest()
                val job = launch { auth.migrate { fail() } }
                val request = withContext(Dispatchers.IO) { server.takeRequest(5, java.util.concurrent.TimeUnit.SECONDS)!! }
                assertEquals("/auth/migration/claims", request.url.encodedPath)
                val body = wireJson.parseToJsonElement(request.body!!.utf8()).jsonObject
                val proof = store.saved!!.pending!!
                assertEquals(proof.id, body.string("claimId"))
                assertEquals(proof.secret, body.string("claimSecret"))
                assertNull(store.saved!!.migrationStopped)
                assertEquals("Waiting for approval", auth.state.value.notice)
                assertNotNull(auth.state.value.comparisonCode)
                server.reply("""{"claimId":"${proof.id}","state":"pending","credentials":null}""")
                job.cancelAndJoin()
            }
            assertEquals(1, store.writes.mapNotNull { it.pending?.id }.distinct().size)
        }
    }

    @Test fun expiredMigrationReregistersTheSameClaimAndOnlyDenialStopsIt() = runBlocking {
        MockWebServer().use { server ->
            server.start()
            val origin = server.url("/").toString().trimEnd('/')
            val claim = PendingDeviceClaim("same-claim", "aiki_c1." + "A".repeat(43), "migration")
            val store = Store(SavedDeviceAuth("backend", pending = claim))
            server.reply("""{"backendId":"backend","mode":"optional","authVersion":1}""")
            server.reply("""{"claimId":"same-claim","state":"expired","credentials":null}""")
            server.reply("""{"claimId":"same-claim","state":"denied","credentials":null}""")
            val auth = DeviceAuth(origin, store, label = "Test phone")
            auth.prepare()
            withTimeout(8000) { auth.migrate { fail() } }
            server.takeRequest()
            repeat(2) {
                val request = server.takeRequest()
                assertEquals("/auth/migration/claims", request.url.encodedPath)
                val body = wireJson.parseToJsonElement(request.body!!.utf8()).jsonObject
                assertEquals(claim.id, body.string("claimId"))
                assertEquals(claim.secret, body.string("claimSecret"))
            }
            assertEquals(claim.id, store.saved!!.pending!!.id)
            assertEquals("Approval was denied. Pair this backend.", store.saved!!.migrationStopped)
        }
    }

    @Test fun migrationNetworkFailureRetriesTheSameClaim() = runBlocking {
        MockWebServer().use { server ->
            server.start()
            val origin = server.url("/").toString().trimEnd('/')
            val claim = PendingDeviceClaim("same-claim", "aiki_c1." + "A".repeat(43), "migration")
            val store = Store(SavedDeviceAuth("backend", pending = claim))
            server.reply("""{"backendId":"backend","mode":"optional","authVersion":1}""")
            server.enqueue(MockResponse.Builder().code(503).body("{}").build())
            server.reply("""{"claimId":"same-claim","state":"denied","credentials":null}""")
            val auth = DeviceAuth(origin, store, label = "Test phone")
            auth.prepare()
            withTimeout(8000) { auth.migrate { fail() } }
            server.takeRequest()
            val bodies = (1..2).map { server.takeRequest().body!!.utf8() }
            assertEquals(bodies[0], bodies[1])
            assertEquals(claim.id, store.saved!!.pending!!.id)
        }
    }

    @Test fun offlineApprovedMigrationCollectsAfterRequiredModeCutover() = runBlocking {
        MockWebServer().use { server ->
            server.start()
            val origin = server.url("/").toString().trimEnd('/')
            val claim = PendingDeviceClaim("offline-claim", "proof", "migration")
            val store = Store(SavedDeviceAuth("backend", pending = claim))
            server.reply("""{"backendId":"backend","mode":"required","authVersion":1}""")
            server.reply(credentials(claim.id))
            server.reply("""{"ok":true}""")
            val auth = DeviceAuth(origin, store, label = "Test phone")
            assertEquals("access-memory", auth.prepare())
            server.takeRequest()
            assertEquals("/auth/claims/poll", server.takeRequest().url.encodedPath)
            assertEquals("/auth/claims/ack", server.takeRequest().url.encodedPath)
            assertEquals("session", store.saved!!.sessionId)
            assertNull(store.saved!!.pending)
        }
    }

    @Test fun requiredBackendWithoutSessionNeverUpgradesOrReconnects() = runBlocking {
        MockWebServer().use { server ->
            server.start()
            val origin = server.url("/").toString().trimEnd('/')
            val store = Store()
            server.reply("""{"backendId":"backend","mode":"required","authVersion":1}""")
            val client = HarnessClient(BackendConfig("Test", origin), deviceAuth = DeviceAuth(origin, store, label = "Test phone"))
            try {
                client.connect()
                withTimeout(5000) { client.state.first { it.status == ConnectionStatus.Closed } }
                delay(1100)
                assertEquals(1, server.requestCount)
                assertNull(store.saved!!.signedOut)
                assertTrue(store.saved!!.advertised)
                assertNull(server.takeRequest().headers["Authorization"])
            } finally { client.close() }
        }
    }
    @Test fun revocationEventClearsCredentialAndStopsReconnectLoop() = runBlocking {
        MockWebServer().use { server ->
            server.start()
            val origin = server.url("/").toString().trimEnd('/')
            val store = Store(SavedDeviceAuth("backend", sessionId = "session", sessionToken = "retained", rotateAfter = "2030-01-31T00:00:00Z"))
            server.reply("""{"backendId":"backend","mode":"required","authVersion":1}""")
            server.reply("""{"backendId":"backend","sessionId":"session","accessToken":"access-memory","accessExpiresAt":"2030-01-01T00:15:00Z","rotateAfter":"2030-01-31T00:00:00Z"}""")
            server.enqueue(MockResponse.Builder().webSocketUpgrade(object : WebSocketListener() {
                override fun onMessage(webSocket: WebSocket, text: String) {
                    val request = wireJson.parseToJsonElement(text).jsonObject
                    assertEquals("access-memory", request.getValue("auth").jsonObject.string("accessToken"))
                    val id = request.string("id")
                    webSocket.send("""{"type":"hello","id":"$id","protocolVersion":1,"server":{"name":"test","version":"1"},"backendId":"backend","auth":{"mode":"required","sessionId":"session","accessExpiresAt":"2030-01-01T00:15:00Z"},"features":["device-auth-v1"]}""")
                    webSocket.send("""{"type":"auth.sessionRevoked","sessionId":"session"}""")
                }
                override fun onClosing(webSocket: WebSocket, code: Int, reason: String) { webSocket.close(code, reason) }
            }).build())
            val client = HarnessClient(BackendConfig("Test", origin), deviceAuth = DeviceAuth(origin, store, label = "Test phone"))
            try {
                client.connect()
                withTimeout(5000) { client.state.first { it.status == ConnectionStatus.Closed } }
                delay(1100)
                assertEquals(3, server.requestCount)
                assertNull(store.saved!!.sessionToken)
                assertEquals("This device was signed out", store.saved!!.signedOut)
            } finally { client.close() }
        }
    }
    @Test fun socketRedirectCannotSendHelloAccessTokenToAnotherOrigin() = runBlocking {
        MockWebServer().use { target -> MockWebServer().use { server ->
            target.start(); server.start()
            val origin = server.url("/").toString().trimEnd('/')
            val store = Store(SavedDeviceAuth("backend", sessionId = "session", sessionToken = "retained", rotateAfter = "2030-01-31T00:00:00Z"))
            server.reply("""{"backendId":"backend","mode":"required","authVersion":1}""")
            server.reply("""{"backendId":"backend","sessionId":"session","accessToken":"access-memory","accessExpiresAt":"2030-01-01T00:15:00Z","rotateAfter":"2030-01-31T00:00:00Z"}""")
            server.enqueue(MockResponse.Builder().code(302).addHeader("Location", target.url("/ws")).build())
            val client = HarnessClient(BackendConfig("Test", origin), deviceAuth = DeviceAuth(origin, store, label = "Test phone"))
            try {
                client.connect()
                withTimeout(5000) { client.state.first { it.status == ConnectionStatus.Reconnecting } }
                assertEquals(0, target.requestCount)
            } finally { client.close() }
        } }
    }
}
