package io.github.mitzacoder.aiki.data

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import java.security.KeyStore
import java.util.Base64
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
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
}

/** Injectable at the cryptographic boundary; JVM tests exercise actual AES-GCM with a generated software key. */
interface DeviceSecretCipher {
    fun encrypt(plaintext: ByteArray, origin: String): ByteArray
    fun decrypt(ciphertext: ByteArray, origin: String): ByteArray
}

class AesGcmDeviceCipher(private val key: () -> SecretKey) : DeviceSecretCipher {
    override fun encrypt(plaintext: ByteArray, origin: String): ByteArray {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, key())
        cipher.updateAAD(origin.toByteArray(Charsets.UTF_8))
        return byteArrayOf(1) + cipher.iv + cipher.doFinal(plaintext)
    }
    override fun decrypt(ciphertext: ByteArray, origin: String): ByteArray {
        require(ciphertext.size >= 30 && ciphertext[0] == 1.toByte())
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, ciphertext.copyOfRange(1, 13)))
        cipher.updateAAD(origin.toByteArray(Charsets.UTF_8))
        return cipher.doFinal(ciphertext.copyOfRange(13, ciphertext.size))
    }
}

private const val DEVICE_AUTH_KEY_ALIAS = "aiki-device-auth-aes-v1"
private fun deviceAuthKey(): SecretKey {
    val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
    try {
        (store.getKey(DEVICE_AUTH_KEY_ALIAS, null) as? SecretKey)?.let { key ->
            Cipher.getInstance("AES/GCM/NoPadding").init(Cipher.ENCRYPT_MODE, key)
            return key
        }
    } catch (_: android.security.keystore.KeyPermanentlyInvalidatedException) { store.deleteEntry(DEVICE_AUTH_KEY_ALIAS) }
    catch (_: java.security.UnrecoverableKeyException) { store.deleteEntry(DEVICE_AUTH_KEY_ALIAS) }
    return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").apply {
        init(KeyGenParameterSpec.Builder(DEVICE_AUTH_KEY_ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setKeySize(256).build())
    }.generateKey()
}

/** Separate from address/preferences storage; excluded explicitly from cloud backup and device transfer. */
private val Context.deviceAuthData by preferencesDataStore(name = "aiki-device-auth")
class DeviceAuthStore(context: Context, private val cipher: DeviceSecretCipher = AesGcmDeviceCipher(::deviceAuthKey)) : DeviceAuthStorage {
    private val data = context.applicationContext.deviceAuthData
    override suspend fun read(origin: String): SavedDeviceAuth? {
        val encoded = data.data.first()[stringPreferencesKey(origin)] ?: return null
        return decodeDeviceAuth(encoded, origin, cipher)
    }
    override suspend fun write(origin: String, auth: SavedDeviceAuth) {
        val encoded = Base64.getEncoder().encodeToString(cipher.encrypt(wireJson.encodeToString(SavedDeviceAuth.serializer(), auth).toByteArray(Charsets.UTF_8), origin))
        data.edit { it[stringPreferencesKey(origin)] = encoded }
    }
}

/** Losing a key must not erase the downgrade pin. The presence of a record means auth was advertised. */
internal fun decodeDeviceAuth(encoded: String, origin: String, cipher: DeviceSecretCipher): SavedDeviceAuth = try {
    wireJson.decodeFromString(SavedDeviceAuth.serializer(), cipher.decrypt(Base64.getDecoder().decode(encoded), origin).toString(Charsets.UTF_8))
} catch (_: Exception) { SavedDeviceAuth(signedOut = "Pair this backend") }
