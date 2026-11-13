package io.github.mitzacoder.kemiri.data

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import java.security.KeyStore
import java.security.UnrecoverableKeyException
import java.util.Base64
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.first
import kotlinx.serialization.Serializable

/** Access credentials deliberately have no field in this persisted record. */
@Serializable
class SavedDeviceAuth(
    val backendId: String? = null,
    val advertised: Boolean = true,
    val sessionId: String? = null,
    val sessionToken: String? = null,
    val successorToken: String? = null,
    val rotateAfter: String? = null,
    val pending: PendingDeviceClaim? = null,
    val signedOut: String? = null,
    val migrationStopped: String? = null,
)

@Serializable
class PendingDeviceClaim(
    val id: String,
    val secret: String,
    val kind: String,
    val grantId: String = "migration",
    val redeemSecret: String? = null,
)

interface DeviceAuthStorage {
    suspend fun read(origin: String): SavedDeviceAuth?
    suspend fun write(origin: String, auth: SavedDeviceAuth)
    /** Called only from a user-confirmed new pairing, never automatic prepare/poll/reconnect. */
    suspend fun recoverForExplicitPairing(origin: String, backendId: String) { }
}

/** Injectable at the cryptographic boundary; JVM tests exercise actual AES-GCM with a generated software key. */
interface DeviceSecretCipher {
    fun encrypt(plaintext: ByteArray, origin: String): ByteArray
    fun decrypt(ciphertext: ByteArray, origin: String): ByteArray
}

class AesGcmDeviceCipher(private val encryptionKey: () -> SecretKey, private val decryptionKey: () -> SecretKey) : DeviceSecretCipher {
    constructor(key: () -> SecretKey) : this(key, key)
    override fun encrypt(plaintext: ByteArray, origin: String): ByteArray {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, encryptionKey())
        cipher.updateAAD(origin.toByteArray(Charsets.UTF_8))
        return byteArrayOf(1) + cipher.iv + cipher.doFinal(plaintext)
    }
    override fun decrypt(ciphertext: ByteArray, origin: String): ByteArray {
        require(ciphertext.size >= 30 && ciphertext[0] == 1.toByte())
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, decryptionKey(), GCMParameterSpec(128, ciphertext.copyOfRange(1, 13)))
        cipher.updateAAD(origin.toByteArray(Charsets.UTF_8))
        return cipher.doFinal(ciphertext.copyOfRange(13, ciphertext.size))
    }
}

private const val DEVICE_AUTH_KEY_ALIAS = "aiki-device-auth-aes-v1"
private fun deviceAuthKey(createIfMissing: Boolean): SecretKey {
    val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
    // Never replace an unavailable/invalidated key, or create one while decrypting existing ciphertext.
    (store.getKey(DEVICE_AUTH_KEY_ALIAS, null) as? SecretKey)?.let { return it }
    check(createIfMissing) { "Device sign-in storage unavailable" }
    return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").apply {
        init(KeyGenParameterSpec.Builder(DEVICE_AUTH_KEY_ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setKeySize(256).build())
    }.generateKey()
}

private fun permanentlyInvalidatedKey(error: Throwable): Boolean = when (error) {
    is android.security.keystore.KeyPermanentlyInvalidatedException, is UnrecoverableKeyException -> true
    is DeviceAuthStorageException -> error.permanentlyInvalidatedKey
    else -> error.cause?.let(::permanentlyInvalidatedKey) ?: false
}

/** Invoked only after explicit pairing durably marks records affected by confirmed permanent key loss. */
private fun recoverDeviceAuthKey() {
    val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
    try {
        (store.getKey(DEVICE_AUTH_KEY_ALIAS, null) as? SecretKey)?.let { key ->
            Cipher.getInstance("AES/GCM/NoPadding").init(Cipher.ENCRYPT_MODE, key)
            return // A previous explicit recovery already replaced the shared key.
        }
    } catch (error: Exception) {
        if (!permanentlyInvalidatedKey(error)) throw error
    }
    store.deleteEntry(DEVICE_AUTH_KEY_ALIAS)
    deviceAuthKey(createIfMissing = true)
}

private const val INVALIDATED_KEY_RECORD = "invalidated-key:"

/** Separate from address/preferences storage; excluded explicitly from cloud backup and device transfer. */
private val Context.deviceAuthData by preferencesDataStore(name = "aiki-device-auth")
class DeviceAuthStore internal constructor(private val data: DataStore<Preferences>, private val cipher: DeviceSecretCipher,
    private val recoverPermanentlyInvalidatedKey: () -> Unit,
) : DeviceAuthStorage {
    constructor(context: Context) : this(context.applicationContext.deviceAuthData, AesGcmDeviceCipher(
        encryptionKey = { deviceAuthKey(createIfMissing = true) }, decryptionKey = { deviceAuthKey(createIfMissing = false) },
    ), ::recoverDeviceAuthKey)

    override suspend fun recoverForExplicitPairing(origin: String, backendId: String): Unit = storageOperation {
        try {
            if (read(origin) != null || data.data.first().asMap().values.none { it is String && it.startsWith(INVALIDATED_KEY_RECORD) }) return@storageOperation
        } catch (error: DeviceAuthStorageException) { if (!error.permanentlyInvalidatedKey) throw error }
        val key = stringPreferencesKey(origin)
        // The alias is shared. Mark every affected record BEFORE replacing it, so a crash or pairing on
        // another backend cannot turn permanent key loss into an indistinguishable authentication-tag error.
        data.edit { records ->
            if (records[key]?.startsWith(INVALIDATED_KEY_RECORD) == false) {
                for ((recordKey, value) in records.asMap().toMap()) {
                    if (value is String && !value.startsWith(INVALIDATED_KEY_RECORD)) {
                        @Suppress("UNCHECKED_CAST")
                        records[recordKey as Preferences.Key<String>] = INVALIDATED_KEY_RECORD + value
                    }
                }
            }
        }
        recoverPermanentlyInvalidatedKey()
        val replacement = SavedDeviceAuth(backendId = backendId)
        val encoded = Base64.getEncoder().encodeToString(cipher.encrypt(wireJson.encodeToString(SavedDeviceAuth.serializer(), replacement).toByteArray(Charsets.UTF_8), origin))
        // Only this explicitly paired origin is replaced. Ordinary write still rejects unreadable records.
        data.edit { it[key] = encoded }
    }

    override suspend fun read(origin: String): SavedDeviceAuth? = storageOperation {
        data.data.first()[stringPreferencesKey(origin)]?.let { decodeDeviceAuth(it, origin, cipher) }
    }
    override suspend fun write(origin: String, auth: SavedDeviceAuth): Unit = storageOperation {
        // A read failure must not be hidden by writing a replacement record. A new origin must not
        // implicitly recreate a key if an explicit recovery was interrupted after marking old records.
        if (read(origin) == null && data.data.first().asMap().values.any { it is String && it.startsWith(INVALIDATED_KEY_RECORD) }) {
            throw DeviceAuthStorageException(permanentlyInvalidatedKey = true)
        }
        val encoded = Base64.getEncoder().encodeToString(cipher.encrypt(wireJson.encodeToString(SavedDeviceAuth.serializer(), auth).toByteArray(Charsets.UTF_8), origin))
        data.edit { it[stringPreferencesKey(origin)] = encoded }
        Unit
    }
}

/** No synthetic signed-out record: ciphertext and downgrade pins survive temporary storage/key failures. */
internal class DeviceAuthStorageException(val permanentlyInvalidatedKey: Boolean = false) : Exception("Device sign-in storage unavailable")
private suspend fun <T> storageOperation(block: suspend () -> T): T = try { block() }
catch (error: CancellationException) { throw error }
catch (error: Exception) { throw DeviceAuthStorageException(permanentlyInvalidatedKey(error)) }

internal fun decodeDeviceAuth(encoded: String, origin: String, cipher: DeviceSecretCipher): SavedDeviceAuth = try {
    if (encoded.startsWith(INVALIDATED_KEY_RECORD)) throw DeviceAuthStorageException(permanentlyInvalidatedKey = true)
    wireJson.decodeFromString(SavedDeviceAuth.serializer(), cipher.decrypt(Base64.getDecoder().decode(encoded), origin).toString(Charsets.UTF_8))
} catch (error: CancellationException) { throw error }
catch (error: Exception) { throw DeviceAuthStorageException(permanentlyInvalidatedKey(error)) }
