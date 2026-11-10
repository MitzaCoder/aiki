package io.github.mitzacoder.aiki

import io.github.mitzacoder.aiki.data.*
import java.io.IOException
import java.util.Base64
import javax.crypto.KeyGenerator
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.first
import kotlinx.serialization.json.*
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import okhttp3.*
import org.junit.Assert.*
import org.junit.Test

class DeviceAuthRecoveryTest {
    private class Store : DeviceAuthStorage {
        var saved = SavedDeviceAuth("backend", sessionId = "session", sessionToken = "retained", rotateAfter = "2030-01-31T00:00:00Z")
        val writes = mutableListOf<SavedDeviceAuth>()
        var failRead = false
        override suspend fun read(origin: String): SavedDeviceAuth {
            if (failRead) throw IOException("Device sign-in storage unavailable")
            return saved
        }
        override suspend fun write(origin: String, auth: SavedDeviceAuth) { saved = auth; writes.add(auth) }
    }
    private fun MockWebServer.reply(body: String, status: Int = 200) = enqueue(MockResponse.Builder().code(status).body(body).build())
    private fun MockWebServer.discovery() = reply("""{"backendId":"backend","mode":"required","authVersion":1}""")
    private fun MockWebServer.refresh() = reply("""{"backendId":"backend","sessionId":"session","accessToken":"access-memory","accessExpiresAt":"2030-01-01T00:15:00Z","rotateAfter":"2030-01-31T00:00:00Z"}""")
    private fun MockWebServer.socket(expire: Boolean = false, onHello: () -> Unit = {}) = enqueue(MockResponse.Builder().webSocketUpgrade(object : WebSocketListener() {
        override fun onMessage(webSocket: WebSocket, text: String) {
            onHello()
            val id = wireJson.parseToJsonElement(text).jsonObject.string("id")
            webSocket.send("""{"type":"hello","id":"$id","protocolVersion":1,"server":{"name":"test","version":"1"},"backendId":"backend","auth":{"mode":"required","sessionId":"session","accessExpiresAt":"2030-01-01T00:15:00Z"},"features":["device-auth-v1"]}""")
            if (expire) webSocket.close(4401, "auth_expired")
        }
        override fun onClosing(webSocket: WebSocket, code: Int, reason: String) { webSocket.close(code, reason) }
    }).build())
    private fun client(server: MockWebServer, store: Store): HarnessClient {
        val origin = server.url("/").toString().trimEnd('/')
        return HarnessClient(BackendConfig("Test", origin), deviceAuth = DeviceAuth(origin, store, label = "Test phone"))
    }
    private suspend fun awaitRecovery(client: HarnessClient) = withTimeout(12_000) {
        client.state.first { it.status == ConnectionStatus.Closed || it.generation >= 2 }
    }

    @Test fun accessExpiryRefreshesRetainedCredentialAndReconnects() = runBlocking {
        MockWebServer().use { server ->
            server.start(); val store = Store()
            server.discovery(); server.refresh(); server.socket(expire = true)
            server.discovery(); server.refresh(); server.socket()
            val client = client(server, store)
            try {
                client.connect()
                assertEquals(ConnectionStatus.Ready, awaitRecovery(client).status)
                assertEquals("retained", store.saved.sessionToken)
                assertTrue(store.writes.all { it.sessionToken == "retained" })
                assertEquals(6, server.requestCount)
                val paths = (1..6).map { server.takeRequest().url.encodedPath }
                assertEquals(listOf("/auth/status", "/auth/session/refresh", "/ws", "/auth/status", "/auth/session/refresh", "/ws"), paths)
            } finally { client.close() }
        }
    }

    @Test fun transientRefreshAfterExpiryKeepsCredentialAndRetriesWithBackoff() = runBlocking {
        MockWebServer().use { server ->
            server.start(); val store = Store()
            server.discovery(); server.refresh(); server.socket(expire = true)
            server.discovery(); server.reply("{}", 503)
            server.discovery(); server.refresh(); server.socket()
            val client = client(server, store)
            try {
                client.connect()
                assertEquals(ConnectionStatus.Ready, awaitRecovery(client).status)
                assertEquals("retained", store.saved.sessionToken)
                assertTrue(store.writes.all { it.sessionToken == "retained" })
                assertEquals(8, server.requestCount)
            } finally { client.close() }
        }
    }

    @Test fun definiteRetainedRejectionAfterExpiryDeletesCredential() = runBlocking {
        for ((status, code) in listOf(401 to "auth_expired", 401 to "auth_invalid", 403 to "auth_revoked")) {
            MockWebServer().use { server ->
                server.start(); val store = Store()
                server.discovery(); server.refresh(); server.socket(expire = true)
                server.discovery(); server.reply("""{"error":{"code":"$code"}}""", status)
                val client = client(server, store)
                try {
                    client.connect()
                    withTimeout(12_000) { client.state.first { it.status == ConnectionStatus.Closed } }
                    assertEquals(5, server.requestCount)
                    assertNull(store.saved.sessionToken)
                    assertEquals(if (code == "auth_revoked") "This device was signed out" else "Session expired", client.state.value.error)
                } finally { client.close() }
            }
        }
    }

    @Test fun bare401AndHost403DoNotRejectRetainedCredential() = runBlocking {
        for ((status, body) in listOf(401 to "{}", 403 to """{"error":{"code":"forbidden_host"}}""")) {
            MockWebServer().use { server ->
                server.start(); val store = Store()
                server.discovery(); server.reply(body, status)
                server.discovery(); server.refresh(); server.socket()
                val client = client(server, store)
                try {
                    client.connect()
                    val state = withTimeout(12_000) { client.state.first { it.status == ConnectionStatus.Ready || it.status == ConnectionStatus.Closed } }
                    assertEquals(ConnectionStatus.Ready, state.status)
                    assertEquals("retained", store.saved.sessionToken)
                    assertTrue(store.writes.all { it.sessionToken == "retained" })
                } finally { client.close() }
            }
        }
    }

    @Test fun storageReadFailurePreservesRecordAndRetriesWithoutCallingServer() = runBlocking {
        MockWebServer().use { server ->
            server.start(); val store = Store().apply { failRead = true }
            val original = store.saved
            server.discovery(); server.refresh(); server.socket()
            val client = client(server, store)
            try {
                client.connect()
                val state = withTimeout(5000) { client.state.first { it.status == ConnectionStatus.Reconnecting && it.error != null } }
                assertEquals("Device sign-in storage unavailable", state.error)
                assertSame(original, store.saved)
                assertTrue(store.writes.isEmpty())
                assertEquals(0, server.requestCount)
                store.failRead = false
                withTimeout(12_000) { client.state.first { it.status == ConnectionStatus.Ready } }
                assertEquals("retained", store.saved.sessionToken)
            } finally { client.close() }
        }
    }

    @Test fun repeatedAccessRejectionRefreshesOncePerSocketWithIncreasingBackoff() = runBlocking {
        MockWebServer().use { server ->
            server.start(); val store = Store()
            val hellos = java.util.concurrent.CopyOnWriteArrayList<Long>()
            repeat(4) { index ->
                server.discovery(); server.refresh(); server.socket(expire = index < 3) { hellos.add(System.nanoTime()) }
            }
            val client = client(server, store)
            try {
                client.connect()
                val state = withTimeout(12_000) { client.state.first { it.status == ConnectionStatus.Closed || it.generation == 4 } }
                assertEquals(4, state.generation)
                assertEquals(12, server.requestCount)
                assertEquals("retained", store.saved.sessionToken)
                // Min jittered delays: 200, 400, 800 ms. Allow scheduler/clock rounding only.
                for ((index, minimumMs) in listOf(180L, 380L, 780L).withIndex()) {
                    assertTrue("repeated close reset backoff", (hellos[index + 1] - hellos[index]) / 1_000_000 >= minimumMs)
                }
            } finally { client.close() }
        }
    }

    @Test fun discovery401IsNotEvidenceThatRetainedCredentialWasRejected() = runBlocking {
        MockWebServer().use { server ->
            server.start(); val store = Store()
            server.reply("""{"error":{"code":"auth_invalid"}}""", 401)
            server.discovery(); server.refresh(); server.socket()
            val client = client(server, store)
            try {
                client.connect()
                val state = withTimeout(12_000) { client.state.first { it.status == ConnectionStatus.Ready || it.status == ConnectionStatus.Closed } }
                assertEquals(ConnectionStatus.Ready, state.status)
                assertEquals("retained", store.saved.sessionToken)
                assertTrue(store.writes.all { it.sessionToken == "retained" })
            } finally { client.close() }
        }
    }

    @Test fun unreadableEncryptedRecordThrowsInsteadOfSynthesizingSignedOutRecord() {
        val key = KeyGenerator.getInstance("AES").apply { init(256) }.generateKey()
        val cipher = AesGcmDeviceCipher { key }
        val origin = "https://backend.example.test"
        val encoded = Base64.getEncoder().encodeToString(cipher.encrypt(wireJson.encodeToString(SavedDeviceAuth.serializer(), SavedDeviceAuth(sessionToken = "retained")).toByteArray(), origin))
        val unavailable = object : DeviceSecretCipher {
            override fun encrypt(plaintext: ByteArray, origin: String): ByteArray = throw IOException("unavailable")
            override fun decrypt(ciphertext: ByteArray, origin: String): ByteArray = throw IOException("unavailable")
        }
        assertThrows(Exception::class.java) { decodeDeviceAuth(encoded, origin, unavailable) }
        assertEquals("retained", decodeDeviceAuth(encoded, origin, cipher).sessionToken)
    }
}
