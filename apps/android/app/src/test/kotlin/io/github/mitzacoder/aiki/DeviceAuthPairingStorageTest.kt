package io.github.mitzacoder.aiki

import android.security.keystore.KeyPermanentlyInvalidatedException
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.emptyPreferences
import androidx.datastore.preferences.core.stringPreferencesKey
import io.github.mitzacoder.aiki.data.*
import java.io.IOException
import java.security.UnrecoverableKeyException
import javax.crypto.KeyGenerator
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.json.*
import mockwebserver3.Dispatcher
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import mockwebserver3.RecordedRequest
import org.junit.Assert.*
import org.junit.Test

class DeviceAuthPairingStorageTest {
    private class PreferencesStore : DataStore<Preferences> {
        override val data = MutableStateFlow(emptyPreferences())
        private val mutex = Mutex()
        override suspend fun updateData(transform: suspend (Preferences) -> Preferences): Preferences = mutex.withLock {
            transform(data.value).also { data.value = it }
        }
    }
    private class Fixture {
        val preferences = PreferencesStore()
        private var key = newKey()
        var failure: Exception? = null
        var resets = 0
        var recoveryFailure: Exception? = null
        val cipher = AesGcmDeviceCipher { failure?.let { throw it }; key }
        val store = DeviceAuthStore(preferences, cipher) {
            recoveryFailure?.let { throw it }
            if (failure != null) { resets++; key = newKey(); failure = null }
        }
        private fun newKey() = KeyGenerator.getInstance("AES").apply { init(256) }.generateKey()
        suspend fun seed(origin: String) = store.write(origin, SavedDeviceAuth("backend", sessionId = "old", sessionToken = "old-retained"))
    }
    private fun MockWebServer.enrollment() {
        dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse {
                val body = request.body?.utf8()?.let { wireJson.parseToJsonElement(it).jsonObject }
                return when (request.url.encodedPath) {
                    "/auth/pairings/redeem" -> MockResponse.Builder().body("""{"claimId":"${body!!.string("claimId")}","state":"approved","credentials":{"backendId":"backend","sessionId":"new","sessionToken":"aiki_s1.new.retained","accessToken":"new-access","accessExpiresAt":"2030-01-01T00:15:00Z","rotateAfter":"2030-01-31T00:00:00Z"}}""").build()
                    "/auth/claims/ack" -> MockResponse.Builder().body("""{"ok":true}""").build()
                    else -> MockResponse.Builder().code(500).body("{}").build()
                }
            }
        }
        start()
    }
    private suspend fun pair(server: MockWebServer, fixture: Fixture) {
        val origin = server.url("/").toString().trimEnd('/')
        DeviceAuth(origin, fixture.store, label = "Test phone").redeem(DevicePairingLink("backend", origin, "grant", "pair-secret"), "", {})
    }

    @Test fun onlyExplicitPairingRecoversPermanentKeyAndOtherOriginsRemainRecoverable() = runBlocking {
        for (failure in listOf(UnrecoverableKeyException(), KeyPermanentlyInvalidatedException())) {
            MockWebServer().use { first -> MockWebServer().use { second ->
                first.enrollment(); second.enrollment()
                val origin = first.url("/").toString().trimEnd('/')
                val otherOrigin = second.url("/").toString().trimEnd('/')
                val f = Fixture(); f.seed(origin); f.seed(otherOrigin)
                val before = f.preferences.data.value
                f.failure = failure
                try { DeviceAuth(origin, f.store, label = "Test phone").prepare(); fail("Automatic prepare must preserve unreadable storage") }
                catch (_: DeviceAuthStorageException) { }
                assertEquals(0, f.resets)
                assertEquals(before, f.preferences.data.value)
                assertEquals(0, first.requestCount)
                pair(first, f)
                assertEquals(1, f.resets)
                assertEquals("aiki_s1.new.retained", f.store.read(origin)!!.sessionToken)
                assertNull(f.store.read(origin)!!.pending)
                assertEquals(2, first.requestCount)
                // The shared key was lost for both origins. Preserve other ciphertext and its auth pin;
                // it must remain explicitly recoverable even though Keystore now returns the replacement key.
                val otherCiphertext = before[stringPreferencesKey(otherOrigin)]!!
                assertTrue(f.preferences.data.value[stringPreferencesKey(otherOrigin)]!!.endsWith(otherCiphertext))
                try { f.store.read(otherOrigin); fail("The other origin still needs explicit pairing") }
                catch (_: DeviceAuthStorageException) { }
                pair(second, f)
                assertEquals("aiki_s1.new.retained", f.store.read(otherOrigin)!!.sessionToken)
                assertEquals(1, f.resets)
                assertEquals("aiki_s1.new.retained", f.store.read(origin)!!.sessionToken)
            } }
        }
    }

    @Test fun explicitPairingCannotResetTemporaryKeyOrStorageFailure() = runBlocking {
        MockWebServer().use { server ->
            server.enrollment(); val f = Fixture()
            val origin = server.url("/").toString().trimEnd('/')
            f.seed(origin); val before = f.preferences.data.value
            f.failure = IOException("Temporarily unavailable")
            try { pair(server, f); fail("Transient storage failure must not reset the key") }
            catch (_: DeviceAuthStorageException) { }
            assertEquals(0, f.resets)
            assertEquals(before, f.preferences.data.value)
            assertEquals(0, server.requestCount)
            f.failure = null
            assertEquals("old-retained", f.store.read(origin)!!.sessionToken)
        }
    }

    @Test fun interruptedExplicitRecoveryKeepsMarkersAndRetriesOnlyOnExplicitPairing() = runBlocking {
        MockWebServer().use { server ->
            server.enrollment(); val f = Fixture()
            val origin = server.url("/").toString().trimEnd('/')
            f.seed(origin)
            f.failure = UnrecoverableKeyException()
            f.recoveryFailure = IOException("Temporary failure while recovering")
            try { pair(server, f); fail("Recovery should surface the temporary failure") }
            catch (_: DeviceAuthStorageException) { }
            val marked = f.preferences.data.value
            try { f.store.write("https://new.example.test", SavedDeviceAuth("backend")); fail("Automatic write must not recreate the key") }
            catch (_: DeviceAuthStorageException) { }
            assertEquals(marked, f.preferences.data.value)
            assertEquals(0, f.resets)
            assertEquals(0, server.requestCount)
            f.recoveryFailure = null
            pair(server, f)
            assertEquals(1, f.resets)
            assertEquals("aiki_s1.new.retained", f.store.read(origin)!!.sessionToken)
        }
    }

    @Test fun explicitPairingCannotResetOrdinaryCiphertextCorruption() = runBlocking {
        MockWebServer().use { server ->
            server.enrollment(); val f = Fixture()
            val origin = server.url("/").toString().trimEnd('/')
            f.seed(origin)
            val corrupted = f.preferences.data.value.toMutablePreferences().apply { this[stringPreferencesKey(origin)] = "not-base64" }.toPreferences()
            f.preferences.data.value = corrupted
            try { pair(server, f); fail("Corruption is not proof of permanent key invalidation") }
            catch (_: DeviceAuthStorageException) { }
            assertEquals(0, f.resets)
            assertEquals(corrupted, f.preferences.data.value)
            assertEquals(0, server.requestCount)
        }
    }
}
