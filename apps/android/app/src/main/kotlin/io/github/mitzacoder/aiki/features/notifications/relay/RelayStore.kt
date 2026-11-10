package io.github.mitzacoder.aiki.features.notifications.relay

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import io.github.mitzacoder.aiki.data.AesGcmDeviceCipher
import io.github.mitzacoder.aiki.data.DeviceSecretCipher
import io.github.mitzacoder.aiki.data.wireJson
import java.security.KeyStore
import java.util.Base64
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.first

/** Atomic encrypted transactions. Callers display only after a successful update has returned. */
interface RelayStorage {
    suspend fun read(): RelayState
    suspend fun update(transform: (RelayState) -> RelayState): RelayState
    /** Only a deliberate user opt-in may replace a lost Keystore key. */
    suspend fun enable(): RelayState
}

private const val ALIAS = "aiki-push-relay-aes-v1"
private const val AAD = "aiki-push-relay-store-v1"
private val RECORD = stringPreferencesKey("encrypted")
private val LOST = stringPreferencesKey("requires-opt-in")
private val Context.relayData by preferencesDataStore(name = "aiki-push-relay")

private fun relayKey(create: Boolean): SecretKey {
    val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
    (store.getKey(ALIAS, null) as? SecretKey)?.let { return it }
    check(create) { "Relay storage unavailable" }
    return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").apply {
        init(KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).setKeySize(256).build())
    }.generateKey()
}

/** Lazy construction is required: callers must not instantiate or read this store while relay is off. */
class RelayStore internal constructor(
    private val data: DataStore<Preferences>,
    private val cipher: DeviceSecretCipher,
    private val resetKey: () -> Unit = {},
) : RelayStorage {
    constructor(context: Context) : this(context.applicationContext.relayData,
        AesGcmDeviceCipher({ relayKey(true) }, { relayKey(false) }),
        {
            KeyStore.getInstance("AndroidKeyStore").apply {
                load(null)
                deleteEntry(ALIAS)
            }
        },
    )

    private fun decode(encoded: String): RelayState {
        val bytes = cipher.decrypt(Base64.getDecoder().decode(encoded), AAD)
        return wireJson.decodeFromString(RelayState.serializer(), bytes.decodeToString(throwOnInvalidSequence = true)).also {
            it.installationId?.let(RelayCrypto::id)
            it.admissions.values.forEach(::RelayAdmission)
            for ((id, route) in it.routes) {
                check(id == route.routeId)
                RelayCrypto.id(id)
                RelayCrypto.id(route.keyId)
                route.notificationKey?.let { key -> RelayCrypto.unbase64(key, 32) }
            }
        }
    }

    private fun encode(state: RelayState): String = Base64.getEncoder().encodeToString(
        cipher.encrypt(wireJson.encodeToString(RelayState.serializer(), state).toByteArray(Charsets.UTF_8), AAD),
    )

    private fun lost(): RelayState = RelayState(failure = RelayErrorCode.StorageUnavailable)

    override suspend fun read(): RelayState {
        val saved = data.data.first()
        if (saved[LOST] != null) return lost()
        val encoded = saved[RECORD] ?: return RelayState()
        return try { decode(encoded) }
        catch (error: CancellationException) { throw error }
        catch (_: Exception) {
            // Only discard the same unreadable record; a concurrent successful opt-in must survive.
            data.edit {
                if (it[RECORD] == encoded) {
                    it.remove(RECORD)
                    it[LOST] = "1"
                }
            }
            lost()
        }
    }

    override suspend fun update(transform: (RelayState) -> RelayState): RelayState {
        var result = RelayState()
        data.edit { saved ->
            check(saved[LOST] == null) { "Relay storage requires opt-in" }
            val prior = saved[RECORD]?.let(::decode) ?: RelayState()
            result = transform(prior)
            saved[RECORD] = encode(result)
        }
        return result
    }

    override suspend fun enable(): RelayState {
        read() // Mark unreadable ciphertext before any key replacement.
        var result = RelayState()
        data.edit { saved ->
            if (saved[LOST] != null) resetKey()
            val prior = saved[RECORD]?.let(::decode) ?: RelayState()
            result = prior.copy(installationId = prior.installationId ?: RelayCrypto.newId(), signedIn = true,
                failure = null, retryAfterSeconds = null)
            saved[RECORD] = encode(result)
            saved.remove(LOST)
        }
        return result
    }
}
