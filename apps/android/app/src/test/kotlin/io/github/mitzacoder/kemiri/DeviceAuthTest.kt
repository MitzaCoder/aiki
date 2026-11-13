package io.github.mitzacoder.kemiri

import io.github.mitzacoder.kemiri.data.*
import java.util.Base64
import javax.crypto.KeyGenerator
import kotlinx.coroutines.*
import kotlinx.serialization.json.*
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import org.junit.Assert.*
import org.junit.Test

class DeviceAuthTest {
    private fun cipher() = KeyGenerator.getInstance("AES").apply { init(256) }.generateKey().let { key -> AesGcmDeviceCipher { key } }
    private fun json(text: String) = wireJson.parseToJsonElement(text).jsonObject
    private class MemoryAuthStore(var saved: SavedDeviceAuth? = null) : DeviceAuthStorage {
        val writes = mutableListOf<SavedDeviceAuth>()
        override suspend fun read(origin: String) = saved
        override suspend fun write(origin: String, auth: SavedDeviceAuth) { saved = auth; writes.add(auth) }
    }
    private fun MockWebServer.reply(body: String, status: Int = 200) = enqueue(MockResponse.Builder().code(status).body(body).build())

    @Test fun aesGcmRoundTripsAndUsesFreshNonces() {
        val cipher = cipher()
        val plaintext = "retained-secret".toByteArray()
        val first = cipher.encrypt(plaintext, "https://backend.example.test")
        val second = cipher.encrypt(plaintext, "https://backend.example.test")
        assertFalse(first.contentEquals(second))
        assertArrayEquals(plaintext, cipher.decrypt(first, "https://backend.example.test"))
        assertFalse(first.toString(Charsets.UTF_8).contains("retained-secret"))
    }
    @Test fun encryptedRecordsAreBoundToOriginAndRejectTampering() {
        val cipher = cipher()
        val encrypted = cipher.encrypt("secret".toByteArray(), "https://a.example.test")
        assertThrows(Exception::class.java) { cipher.decrypt(encrypted, "https://b.example.test") }
        encrypted[encrypted.lastIndex] = (encrypted.last().toInt() xor 1).toByte()
        assertThrows(Exception::class.java) { cipher.decrypt(encrypted, "https://a.example.test") }
    }
    @Test fun missingKeyAndCorruptRecordFailWithoutSynthesizingReplacementRecords() {
        val encrypted = cipher().encrypt(wireJson.encodeToString(SavedDeviceAuth.serializer(), SavedDeviceAuth(sessionToken = "secret")).toByteArray(), "https://backend.example.test")
        assertThrows(DeviceAuthStorageException::class.java) { decodeDeviceAuth(Base64.getEncoder().encodeToString(encrypted), "https://backend.example.test", cipher()) }
        assertThrows(DeviceAuthStorageException::class.java) { decodeDeviceAuth("invalid", "https://backend.example.test", cipher()) }
    }
    @Test fun encryptedRecordRetainsRotationAndClaimButNeverAccessTokens() {
        val record = SavedDeviceAuth("backend", sessionId = "session", sessionToken = "old", successorToken = "new", pending = PendingDeviceClaim("claim", "proof", "migration"))
        val serialized = wireJson.encodeToString(SavedDeviceAuth.serializer(), record)
        assertFalse(serialized.contains("accessToken"))
        val cipher = cipher()
        val recovered = decodeDeviceAuth(Base64.getEncoder().encodeToString(cipher.encrypt(serialized.toByteArray(), "https://backend.example.test")), "https://backend.example.test", cipher)
        assertEquals("new", recovered.successorToken)
        assertEquals("proof", recovered.pending!!.secret)
    }
    @Test fun comparisonMatchesSharedTypeScriptFixture() {
        assertEquals("VE2X-TWTS", deviceComparisonCode("backend-example", "grant-example", "claim-example", "aiki_c1." + "A".repeat(43)))
        assertNotEquals("VE2X-TWTS", deviceComparisonCode("backend-example", "grant-example", "claim-other", "aiki_c1." + "A".repeat(43)))
    }
    @Test fun pairingUsesByteExactCompactJsonArrayAndUnpaddedBase64Url() {
        val link = DevicePairingLink("backend-example", "https://backend.example.com", "grant-example", "aiki_p1." + "A".repeat(43))
        val expected = "#pair=v2." + Base64.getUrlEncoder().withoutPadding().encodeToString("[\"backend-example\",\"https://backend.example.com\",\"grant-example\",\"aiki_p1.${"A".repeat(43)}\"]".toByteArray())
        assertEquals(expected, encodeDevicePairingFragment(link))
        val decoded = decodeDevicePairingLink("https://app.example.test/pair$expected")
        assertEquals(link.secret, decoded.secret)
        assertEquals(link.origin, decoded.origin)
    }
    @Test fun pairingRejectsNoncanonicalOriginsAndEncoding() {
        for (origin in listOf("http://backend.example.com", "https://backend.example.com/", "https://user@backend.example.com", "https://backend.example.com:443", "http://10.0.2.2")) {
            assertThrows(Exception::class.java) { encodeDevicePairingFragment(DevicePairingLink("backend", origin, "grant", "aiki_p1." + "A".repeat(43))) }
        }
        val encoded = encodeDevicePairingFragment(DevicePairingLink("b", "https://b.example.test", "g", "aiki_p1." + "A".repeat(43)))
        assertThrows(Exception::class.java) { decodeDevicePairingLink(encoded + "=") }
        assertThrows(Exception::class.java) { decodeDevicePairingLink("#v1.address-only") }
    }
    @Test fun headlessBootstrapHasNoGrantSecretInTheLink() {
        val payload = Base64.getUrlEncoder().withoutPadding().encodeToString("[\"backend\",\"https://backend.example.test\",\"request\"]".toByteArray())
        val parsed = decodeDevicePairingLink("https://app.example.test/pair#bootstrap=v1.$payload")
        assertTrue(parsed.bootstrap)
        assertEquals("request", parsed.grantId)
        assertEquals("", parsed.secret)
    }
    @Test fun timingRenewsOneMinuteEarlyAndRotationIsNotPerReconnect() {
        val now = java.time.Instant.parse("2026-01-01T00:00:00Z").toEpochMilli()
        assertEquals(840_000, authRenewDelay("2026-01-01T00:15:00Z", now))
        assertEquals(1000, authRenewDelay("2025-12-31T23:59:00Z", now))
        assertFalse(authRotationDue("2026-01-31T00:00:00Z", now))
        assertTrue(authRotationDue("2025-12-31T00:00:00Z", now))
    }
    @Test fun pinBlocksDowngradeButExplicitOptionalKeepsLegacyUse() {
        assertTrue(allowAnonymousAuth(false, null, false))
        assertFalse(allowAnonymousAuth(true, null, false))
        assertFalse(allowAnonymousAuth(true, "required", false))
        assertTrue(allowAnonymousAuth(true, "optional", false))
        assertFalse(allowAnonymousAuth(true, "optional", true))
    }
    @Test fun discovery404IsLegacyOnlyBeforeFirstAdvertisement() = runBlocking {
        MockWebServer().use { server ->
            server.start()
            val origin = server.url("/").toString().trimEnd('/')
            server.reply("{}", 404)
            assertNull(DeviceAuth(origin, MemoryAuthStore(), label = "Test phone").prepare())
            server.reply("{}", 404)
            try { DeviceAuth(origin, MemoryAuthStore(SavedDeviceAuth("backend")), label = "Test phone").prepare(); fail() }
            catch (error: ClientException) { assertEquals("auth_downgrade", error.code) }
        }
    }
    @Test fun redirectsNeverForwardRetainedBearer() = runBlocking {
        MockWebServer().use { server ->
            server.start()
            server.enqueue(MockResponse.Builder().code(302).addHeader("Location", "https://other.example.test/auth/session/refresh").body("{}").build())
            try { DeviceAuthHttp().call(server.url("/").toString().trimEnd('/'), "/auth/session/refresh", buildJsonObject {}, "retained"); fail() }
            catch (error: DeviceAuthHttpException) { assertEquals(302, error.status) }
            assertEquals(1, server.requestCount)
        }
    }
    @Test fun rotationSuccessorIsDurableBeforeSendingAndResumedAfterRestart() = runBlocking {
        MockWebServer().use { server ->
            server.start()
            val origin = server.url("/").toString().trimEnd('/')
            val store = MemoryAuthStore(SavedDeviceAuth("backend", sessionId = "session", sessionToken = "old", successorToken = "staged", rotateAfter = "2020-01-01T00:00:00Z"))
            server.reply("""{"backendId":"backend","mode":"required","authVersion":1}""")
            server.reply("""{"sessionId":"session","rotateAfter":"2030-01-01T00:00:00Z"}""")
            server.reply("""{"backendId":"backend","sessionId":"session","accessToken":"access","accessExpiresAt":"2030-01-01T00:15:00Z","rotateAfter":"2030-01-01T00:00:00Z"}""")
            assertEquals("access", DeviceAuth(origin, store, label = "Test phone").prepare())
            server.takeRequest()
            val rotation = server.takeRequest()
            assertEquals("Bearer old", rotation.headers["Authorization"])
            assertEquals("staged", json(rotation.body!!.utf8()).string("successorToken"))
            assertEquals("Bearer staged", server.takeRequest().headers["Authorization"])
            assertNull(store.saved!!.successorToken)
            assertTrue(store.writes.any { it.successorToken == "staged" })
        }
    }
    @Test fun committedRotationRecoversAfterOldTokenRetryWindowExpires() = runBlocking {
        MockWebServer().use { server ->
            server.start()
            val origin = server.url("/").toString().trimEnd('/')
            val store = MemoryAuthStore(SavedDeviceAuth("backend", sessionId = "session", sessionToken = "old", successorToken = "staged", rotateAfter = "2020-01-01T00:00:00Z"))
            server.reply("""{"backendId":"backend","mode":"required","authVersion":1}""")
            server.reply("""{"error":{"code":"auth_invalid"}}""", 401)
            server.reply("""{"backendId":"backend","sessionId":"session","accessToken":"access","accessExpiresAt":"2030-01-01T00:15:00Z","rotateAfter":"2030-01-31T00:00:00Z"}""")
            assertEquals("access", DeviceAuth(origin, store, label = "Test phone").prepare())
            server.takeRequest(); server.takeRequest()
            assertEquals("Bearer staged", server.takeRequest().headers["Authorization"])
            assertEquals("staged", store.saved!!.sessionToken)
            assertNull(store.saved!!.successorToken)
        }
    }

    @Test fun backendIdentityChangeNeverSendsRetainedToken() = runBlocking {
        MockWebServer().use { server ->
            server.start()
            val store = MemoryAuthStore(SavedDeviceAuth("original", sessionToken = "retained"))
            server.reply("""{"backendId":"different","mode":"required","authVersion":1}""")
            try { DeviceAuth(server.url("/").toString().trimEnd('/'), store, label = "Test phone").prepare(); fail() }
            catch (error: ClientException) { assertEquals("auth_origin_changed", error.code) }
            assertEquals(1, server.requestCount)
        }
    }
    @Test fun migrationProofIsPersistedAndReusedAcrossRestarts() = runBlocking {
        MockWebServer().use { server ->
            server.start()
            val origin = server.url("/").toString().trimEnd('/')
            val proof = PendingDeviceClaim("existing-claim", "aiki_c1." + "A".repeat(43), "migration")
            val store = MemoryAuthStore(SavedDeviceAuth("backend", pending = proof))
            server.reply("""{"backendId":"backend","mode":"optional","authVersion":1}""")
            server.reply("""{"claimId":"existing-claim","state":"pending","credentials":null}""")
            val controller = DeviceAuth(origin, store, label = "Test phone")
            assertNull(controller.prepare())
            val polling = launch { controller.migrate { fail("Must require owner approval") } }
            withTimeout(5000) { while (server.requestCount < 2) delay(10) }
            polling.cancelAndJoin()
            server.takeRequest()
            val request = server.takeRequest()
            assertEquals("/auth/migration/claims", request.url.encodedPath)
            assertEquals(proof.id, json(request.body!!.utf8()).string("claimId"))
            assertEquals(proof.secret, store.saved!!.pending!!.secret)
            assertEquals("Waiting for approval", controller.state.value.notice)
        }
    }
}
