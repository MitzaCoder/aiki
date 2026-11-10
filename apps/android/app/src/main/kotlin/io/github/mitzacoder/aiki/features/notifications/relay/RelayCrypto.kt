package io.github.mitzacoder.aiki.features.notifications.relay

import java.math.BigInteger
import java.security.AlgorithmParameters
import java.security.KeyFactory
import java.security.KeyPair
import java.security.KeyPairGenerator
import java.security.MessageDigest
import java.security.PrivateKey
import java.security.PublicKey
import java.security.SecureRandom
import java.security.interfaces.ECPublicKey
import java.security.spec.ECGenParameterSpec
import java.security.spec.ECParameterSpec
import java.security.spec.ECPoint
import java.security.spec.ECPublicKeySpec
import java.util.Base64
import javax.crypto.Cipher
import javax.crypto.KeyAgreement
import javax.crypto.Mac
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec
import kotlinx.serialization.json.*

/** A fixed, content-free validation or authentication failure. */
class RelayException(val code: String) : IllegalArgumentException("push_relay_$code")

internal fun reject(code: String): Nothing = throw RelayException(code)

data class RelayContext(val backendId: String, val sessionId: String, val routeId: String, val keyId: String)

data class RelayPlaintext(
    val backendId: String,
    val sessionId: String,
    val sequence: String,
    val createdAt: Long,
    val expiresAt: Long,
    val eventId: String,
    val payload: JsonObject,
)

data class RelayEnvelope(val v: Int = 1, val r: String, val k: String, val m: String, val n: String, val c: String)

/** Platform-only JVM implementation shared by relay lifecycle, receive routing and the normative vector tests. */
object RelayCrypto {
    const val VERSION = 1
    const val PLAINTEXT_CAP = 2048
    const val FCM_DATA_CAP = 3584
    const val SEND_BODY_CAP = 4096
    const val MANAGEMENT_BODY_CAP = 8192
    const val FCM_TOKEN_CAP = 4096
    const val LIFETIME_MS = 43_200_000L
    const val SKEW_MS = 300_000L
    const val RETENTION_MS = 46_800_000L
    const val WINDOW_SIZE = 4096

    private val random = SecureRandom()
    private val prime = BigInteger("ffffffff00000001000000000000000000000000ffffffffffffffffffffffff", 16)
    private val curveB = BigInteger("5ac635d8aa3a93e7b3ebbd55769886bc651d06b0cc53b0f63bce3c3e27d2604b", 16)
    private val parameters = AlgorithmParameters.getInstance("EC").apply {
        init(ECGenParameterSpec("secp256r1"))
    }.getParameterSpec(ECParameterSpec::class.java)
    private val routing = listOf("projectId", "workerId", "scheduleId", "threadId", "artifactId", "taskId")
    private val requiredPayload = listOf(
        "kind", "title", "body", "backendKey", "projectId", "workerId", "scheduleId", "tag", "at",
    )
    val purposes = listOf("notification", "phone-confirm", "backend-confirm")

    /** Encode UTF-8 without Unicode normalization. */
    fun utf8(text: String): ByteArray = text.toByteArray(Charsets.UTF_8)

    /** Encode canonical unpadded base64url. */
    fun base64(bytes: ByteArray): String = Base64.getUrlEncoder().withoutPadding().encodeToString(bytes)

    /** Reject noncanonical base64url and, when supplied, any other decoded length. */
    fun unbase64(text: String, length: Int? = null): ByteArray {
        if (text.length > 4096 || !Regex("^[A-Za-z0-9_-]+$").matches(text)) reject("invalid")
        val bytes = try {
            Base64.getUrlDecoder().decode(text)
        } catch (_: IllegalArgumentException) {
            reject("invalid")
        }
        if ((length != null && bytes.size != length) || base64(bytes) != text) reject("invalid")
        return bytes
    }

    /** Reject text exceeding a UTF-8 byte cap before further parsing. */
    fun checkSize(text: String, cap: Int) {
        if (text.length > cap || utf8(text).size > cap) reject("oversize")
    }

    internal fun text(raw: JsonElement?, cap: Int, nonempty: Boolean = true): String {
        val primitive = raw as? JsonPrimitive ?: reject("invalid")
        if (!primitive.isString) reject("invalid")
        val text = primitive.content
        val roundTrip = utf8(text).decodeToString(throwOnInvalidSequence = true)
        if ((nonempty && text.isEmpty()) || roundTrip != text) reject("invalid")
        checkSize(text, cap)
        return text
    }

    internal fun obj(raw: JsonElement?): JsonObject = raw as? JsonObject ?: reject("invalid")

    internal fun parse(text: String): JsonElement = try {
        Json.parseToJsonElement(text)
    } catch (_: Exception) {
        reject("invalid")
    }

    internal fun keys(value: JsonObject, required: List<String>, optional: List<String> = emptyList()) {
        if (!value.keys.containsAll(required) || value.keys.any { it !in required && it !in optional }) {
            reject("invalid")
        }
    }

    /** Validate a canonical 128-bit route, key, message or event ID. */
    fun id(text: String): String {
        unbase64(text, 16)
        return text
    }

    /** Generate a fresh CSPRNG-backed 128-bit ID. */
    fun newId(): String = base64(ByteArray(16).also(random::nextBytes))

    /** Generate an independent CSPRNG-backed 256-bit secret or salt. */
    fun newSecret(): String = base64(ByteArray(32).also(random::nextBytes))

    private fun prefix(purpose: String) = when (purpose) {
        "send" -> "aiki_push1"
        "delete" -> "aiki_push_delete1"
        else -> reject("invalid")
    }

    /** Build one purpose-scoped capability after validating its ID and secret. */
    fun bearer(purpose: String, routeId: String, secret: String = newSecret()): String {
        id(routeId)
        unbase64(secret, 32)
        return "${prefix(purpose)}.$routeId.$secret"
    }

    /** Reject malformed capabilities and capabilities for the opposite purpose. */
    fun parseBearer(bearer: String, purpose: String): Pair<String, String> {
        checkSize(bearer, 128)
        val parts = bearer.split('.')
        if (parts.size != 3 || parts[0] != prefix(purpose)) reject("invalid")
        id(parts[1])
        unbase64(parts[2], 32)
        return parts[1] to parts[2]
    }

    /** Hash the validated full capability with the frozen credential domain separator. */
    fun credentialHash(bearer: String, purpose: String): ByteArray {
        parseBearer(bearer, purpose)
        val credential = array("aiki-push-v1", "credential", bearer)
        return MessageDigest.getInstance("SHA-256").digest(utf8(credential))
    }

    /** Compare digest bytes using the platform's timing-resistant equality implementation. */
    fun constantTimeEqual(a: ByteArray, b: ByteArray): Boolean = MessageDigest.isEqual(a, b)

    /** Reject wrong length/prefix, infinity, out-of-field coordinates and off-curve points. */
    fun validatePublicPoint(point: ByteArray) {
        if (point.size != 65 || point[0] != 4.toByte()) reject("invalid")
        val x = BigInteger(1, point.copyOfRange(1, 33))
        val y = BigInteger(1, point.copyOfRange(33, 65))
        val equation = y * y - x * x * x + x * BigInteger.valueOf(3) - curveB
        if (x >= prime || y >= prime || equation.mod(prime) != BigInteger.ZERO) reject("invalid")
    }

    /** Import only a validated uncompressed P-256 public point. */
    fun importPublicKey(encoded: String): PublicKey {
        val bytes = unbase64(encoded, 65)
        validatePublicPoint(bytes)
        val point = ECPoint(
            BigInteger(1, bytes.copyOfRange(1, 33)),
            BigInteger(1, bytes.copyOfRange(33, 65)),
        )
        return KeyFactory.getInstance("EC").generatePublic(ECPublicKeySpec(point, parameters))
    }

    private fun coordinate(number: BigInteger): ByteArray {
        val bytes = number.toByteArray().takeLast(32).toByteArray()
        return ByteArray(32 - bytes.size) + bytes
    }

    /** Export a validated P-256 public key in the frozen 65-byte uncompressed format. */
    fun exportPublicKey(key: PublicKey): String {
        val ec = key as? ECPublicKey ?: reject("invalid")
        val sameCurve = ec.params.curve == parameters.curve &&
            ec.params.generator == parameters.generator && ec.params.order == parameters.order
        if (!sameCurve) reject("invalid")
        val point = byteArrayOf(4) + coordinate(ec.w.affineX) + coordinate(ec.w.affineY)
        validatePublicPoint(point)
        return base64(point)
    }

    /** Generate a fresh per-route secp256r1 key pair using the platform CSPRNG. */
    fun generateKeyPair(): KeyPair = KeyPairGenerator.getInstance("EC").apply {
        initialize(ECGenParameterSpec("secp256r1"), random)
    }.generateKeyPair()

    /** Derive the 32-byte ECDH output only after validating the peer's public point. */
    fun sharedSecret(privateKey: PrivateKey, peer: String): ByteArray = KeyAgreement.getInstance("ECDH").run {
        init(privateKey)
        doPhase(importPublicKey(peer), true)
        generateSecret()
    }

    private fun context(context: RelayContext) {
        text(JsonPrimitive(context.backendId), 128)
        text(JsonPrimitive(context.sessionId), 128)
        id(context.routeId)
        id(context.keyId)
    }

    /** Serialize protocol transcript strings as an exact compact UTF-8-compatible JSON array. */
    fun array(vararg strings: String): String = JsonArray(strings.map(::JsonPrimitive)).toString()

    /** Produce the frozen identity- and purpose-bound HKDF info. */
    fun keyInfo(context: RelayContext, purpose: String): String {
        context(context)
        if (purpose !in purposes) reject("invalid")
        return array("aiki-push-v1", purpose, context.backendId, context.sessionId, context.routeId, context.keyId)
    }

    private fun hmac(key: ByteArray, bytes: ByteArray): ByteArray = Mac.getInstance("HmacSHA256").run {
        init(SecretKeySpec(key, "HmacSHA256"))
        doFinal(bytes)
    }

    /** Derive independent 32-byte notification, phone-confirm and backend-confirm keys. */
    fun deriveKeys(shared: ByteArray, salt: String, context: RelayContext): Map<String, ByteArray> {
        if (shared.size != 32) reject("invalid")
        val prk = hmac(unbase64(salt, 32), shared)
        return purposes.associateWith { purpose ->
            hmac(prk, utf8(keyInfo(context, purpose)) + byteArrayOf(1))
        }
    }

    /** Bind both validated public keys, the salt and the expected route/session identities. */
    fun transcript(context: RelayContext, salt: String, phonePublicKey: String, backendPublicKey: String): String {
        context(context)
        unbase64(salt, 32)
        importPublicKey(phonePublicKey)
        importPublicKey(backendPublicKey)
        return array(
            "aiki-push-v1", context.backendId, context.sessionId, context.routeId, context.keyId,
            salt, phonePublicKey, backendPublicKey,
        )
    }

    /** Compute the transcript HMAC with the selected direction's independently derived key. */
    fun confirmation(key: ByteArray, transcript: String): String {
        if (key.size != 32) reject("invalid")
        return base64(hmac(key, utf8(transcript)))
    }

    /** Verify the selected direction's HMAC without content-bearing errors. */
    fun verifyConfirmation(key: ByteArray, transcript: String, confirmation: String) {
        val expected = unbase64(confirmation(key, transcript), 32)
        if (!constantTimeEqual(expected, unbase64(confirmation, 32))) reject("confirmation")
    }

    /** Accept only canonical decimal unsigned 64-bit strings, including both edge values. */
    fun sequence(sequence: String): BigInteger {
        if (!Regex("^(0|[1-9][0-9]{0,19})$").matches(sequence)) reject("invalid")
        return BigInteger(sequence).also {
            if (it > BigInteger("18446744073709551615")) reject("invalid")
        }
    }

    internal fun timestamp(raw: JsonElement?): Long {
        val primitive = raw as? JsonPrimitive ?: reject("invalid")
        val number = if (!primitive.isString) primitive.longOrNull else null
        if (number == null || number < 0 || number > 9007199254740991L) reject("invalid")
        return number
    }

    private fun senderPayload(raw: JsonObject, bound: Boolean): JsonObject {
        if (!raw.keys.containsAll(requiredPayload)) reject("invalid")
        text(raw["kind"], Int.MAX_VALUE)
        val known = requiredPayload + routing
        return buildJsonObject {
            put("kind", raw.getValue("kind"))
            put("title", text(raw["title"], if (bound) 256 else Int.MAX_VALUE, false))
            put("body", text(raw["body"], Int.MAX_VALUE, false))
            put("backendKey", text(raw["backendKey"], if (bound) 128 else Int.MAX_VALUE, false))
            for (name in routing) {
                if (name !in raw) continue
                val route = raw[name]
                put(name, if (route == JsonNull) JsonNull else JsonPrimitive(text(route, if (bound) 128 else Int.MAX_VALUE)))
            }
            put("tag", text(raw["tag"], if (bound) 128 else Int.MAX_VALUE, false))
            put("at", text(raw["at"], if (bound) 64 else Int.MAX_VALUE, false))
            for ((name, value) in raw) {
                if (name !in known) put(name, value)
            }
        }
    }

    /** Serialize wrapper fields in the frozen order without changing the payload object. */
    fun plaintextJson(plaintext: RelayPlaintext): JsonObject = buildJsonObject {
        put("backendId", plaintext.backendId)
        put("sessionId", plaintext.sessionId)
        put("sequence", plaintext.sequence)
        put("createdAt", plaintext.createdAt)
        put("expiresAt", plaintext.expiresAt)
        put("eventId", plaintext.eventId)
        put("payload", plaintext.payload)
    }

    /** Validate the strict wrapper; leave all authenticated payload fields and kinds to the app parser. */
    fun readPlaintext(raw: JsonElement): RelayPlaintext {
        val value = obj(raw)
        keys(value, listOf("backendId", "sessionId", "sequence", "createdAt", "expiresAt", "eventId", "payload"))
        val plaintext = RelayPlaintext(
            backendId = text(value["backendId"], 128),
            sessionId = text(value["sessionId"], 128),
            sequence = text(value["sequence"], Int.MAX_VALUE),
            createdAt = timestamp(value["createdAt"]),
            expiresAt = timestamp(value["expiresAt"]),
            eventId = id(text(value["eventId"], 4096)),
            payload = obj(value["payload"]),
        )
        sequence(plaintext.sequence)
        val lifetime = plaintext.expiresAt - plaintext.createdAt
        if (lifetime < 0 || lifetime > LIFETIME_MS) reject("invalid")
        return plaintext
    }

    private fun replaceBody(plaintext: RelayPlaintext, body: String): RelayPlaintext {
        val payload = plaintext.payload.toMutableMap().apply { put("body", JsonPrimitive(body)) }
        return plaintext.copy(payload = JsonObject(payload))
    }

    private fun truncateBody(plaintext: RelayPlaintext): RelayPlaintext {
        val points = plaintext.payload.getValue("body").jsonPrimitive.content.codePoints().toArray()
        var low = 0
        var high = points.size
        while (low < high) {
            val mid = (low + high + 1) / 2
            val candidate = replaceBody(plaintext, String(points, 0, mid))
            if (utf8(plaintextJson(candidate).toString()).size <= PLAINTEXT_CAP) low = mid else high = mid - 1
        }
        return replaceBody(plaintext, String(points, 0, low))
    }

    private fun safeRoute(raw: JsonElement?): String? = (raw as? JsonPrimitive)
        ?.takeIf { it.isString }
        ?.content
        ?.takeIf { it.isNotEmpty() && utf8(it).size <= 128 }

    private fun fallback(plaintext: RelayPlaintext): RelayPlaintext {
        val original = plaintext.payload
        val at = original.getValue("at").jsonPrimitive.content
        val payload = buildJsonObject {
            put("kind", original.getValue("kind"))
            put("title", "Open the app")
            put("body", "")
            put("backendKey", safeRoute(original["backendKey"]) ?: "")
            put("projectId", safeRoute(original["projectId"])?.let(::JsonPrimitive) ?: JsonNull)
            put("workerId", JsonNull)
            put("scheduleId", JsonNull)
            put("tag", "aiki-push")
            put("at", if (utf8(at).size <= 64) at else "")
        }
        val result = plaintext.copy(payload = payload)
        if (utf8(plaintextJson(result).toString()).size <= PLAINTEXT_CAP) return result
        val withoutProject = payload.toMutableMap().apply { put("projectId", JsonNull) }
        return result.copy(payload = JsonObject(withoutProject))
    }

    /** Bound known sender fields, preserve fitting extensions, truncate the preview and space-pad within the cap. */
    fun preparePlaintext(input: RelayPlaintext): Pair<RelayPlaintext, ByteArray> {
        var plaintext = readPlaintext(plaintextJson(input)).copy(payload = senderPayload(input.payload, false))
        var needsFallback = try {
            senderPayload(plaintext.payload, true)
            false
        } catch (error: RelayException) {
            if (error.code != "oversize") throw error
            true
        }
        if (!needsFallback) {
            plaintext = truncateBody(plaintext)
            needsFallback = utf8(plaintextJson(plaintext).toString()).size > PLAINTEXT_CAP
        }
        if (needsFallback) plaintext = fallback(plaintext)
        val bytes = utf8(plaintextJson(plaintext).toString())
        if (bytes.size > PLAINTEXT_CAP) reject("oversize")
        val padded = ByteArray((bytes.size + 255) / 256 * 256) { 32 }
        bytes.copyInto(padded)
        return plaintext to padded
    }

    private fun plaintextPrefix(plaintext: RelayPlaintext): String {
        val wrapper = JsonObject(plaintextJson(plaintext).filterKeys { it != "payload" })
        return wrapper.toString().dropLast(1) + ",\"payload\":"
    }

    private fun validateJsonScalars(value: JsonElement) {
        // Json.parseToJsonElement accepts unquoted primitive tokens and leading-zero numbers.
        // Preserve arbitrary valid numeric spellings, but reject tokens outside the JSON grammar.
        when (value) {
            is JsonObject -> value.values.forEach(::validateJsonScalars)
            is JsonArray -> value.forEach(::validateJsonScalars)
            is JsonPrimitive -> {
                val number = Regex("-?(0|[1-9][0-9]*)(\\.[0-9]+)?([eE][+-]?[0-9]+)?")
                val literal = value.content in listOf("null", "true", "false")
                if (!value.isString && !literal && !number.matches(value.content)) reject("invalid")
            }
        }
    }

    /** Strip only minimal space padding; require canonical wrapper bytes, not canonical payload JSON. */
    fun parsePlaintext(bytes: ByteArray): RelayPlaintext {
        if (bytes.size > PLAINTEXT_CAP) reject("oversize")
        if (bytes.isEmpty() || bytes.size % 256 != 0) reject("invalid")
        var end = bytes.size
        while (end > 0 && bytes[end - 1] == 32.toByte()) end--
        val text = try {
            bytes.copyOfRange(0, end).decodeToString(throwOnInvalidSequence = true)
        } catch (_: Exception) {
            reject("invalid")
        }
        val plaintext = readPlaintext(parse(text))
        val prefix = plaintextPrefix(plaintext)
        if (!text.startsWith(prefix) || !text.endsWith("}") || (end + 255) / 256 * 256 != bytes.size) {
            reject("invalid")
        }
        val payloadText = text.substring(prefix.length, text.length - 1)
        if (!payloadText.startsWith("{") || !payloadText.endsWith("}")) reject("invalid")
        // An independent parse rejects duplicate wrapper fields following the first payload object.
        val payload = obj(parse(payloadText))
        validateJsonScalars(payload)
        return plaintext.copy(payload = payload)
    }

    /** Bind all three outer IDs to the AES-GCM authentication tag. */
    fun aad(routeId: String, keyId: String, messageId: String): ByteArray =
        utf8(array("aiki-push-v1", id(routeId), id(keyId), id(messageId)))

    /** Serialize the exact compact versioned envelope key order. */
    fun serializeEnvelope(envelope: RelayEnvelope): String = buildJsonObject {
        put("v", envelope.v)
        put("r", envelope.r)
        put("k", envelope.k)
        put("m", envelope.m)
        put("n", envelope.n)
        put("c", envelope.c)
    }.toString()

    /** Validate all envelope keys, lengths, encodings and byte caps before invoking AES. */
    fun parseEnvelope(text: String): RelayEnvelope {
        checkSize(text, FCM_DATA_CAP)
        val value = obj(parse(text))
        keys(value, listOf("v", "r", "k", "m", "n", "c"))
        val version = value["v"] as? JsonPrimitive
        if (version == null || version.isString || version.doubleOrNull != 1.0) reject("version")
        val envelope = RelayEnvelope(
            r = id(text(value["r"], 4096)),
            k = id(text(value["k"], 4096)),
            m = id(text(value["m"], 4096)),
            n = text(value["n"], 4096),
            c = text(value["c"], 4096),
        )
        unbase64(envelope.n, 12)
        val cipher = unbase64(envelope.c)
        if (cipher.size > 2064) reject("oversize")
        if (cipher.size < 272 || (cipher.size - 16) % 256 != 0) reject("invalid")
        if (serializeEnvelope(envelope) != text) reject("invalid")
        checkSize(buildJsonObject { put("aiki", text) }.toString(), FCM_DATA_CAP)
        return envelope
    }

    /** Accept only the single canonical FCM data key containing a valid serialized envelope. */
    fun parseFcmData(text: String): RelayEnvelope {
        checkSize(text, FCM_DATA_CAP)
        val value = obj(parse(text))
        keys(value, listOf("aiki"))
        val envelope = text(value["aiki"], FCM_DATA_CAP)
        if (buildJsonObject { put("aiki", envelope) }.toString() != text) reject("invalid")
        return parseEnvelope(envelope)
    }

    /** Build a byte-capped send body whose outer route/message IDs match the envelope. */
    fun sendBody(envelope: String): String {
        val parsed = parseEnvelope(envelope)
        return buildJsonObject {
            put("routeId", parsed.r)
            put("messageId", parsed.m)
            put("envelope", envelope)
        }.toString().also { checkSize(it, SEND_BODY_CAP) }
    }

    /** Encrypt once with a fresh CSPRNG nonce/message ID; persist and retry the exact result, never re-encrypt. */
    fun encrypt(key: ByteArray, context: RelayContext, input: RelayPlaintext): String {
        context(context)
        if (input.backendId != context.backendId || input.sessionId != context.sessionId) reject("identity")
        if (key.size != 32) reject("invalid")
        val padded = preparePlaintext(input).second
        val messageId = newId()
        val nonce = ByteArray(12).also(random::nextBytes)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding").run {
            init(Cipher.ENCRYPT_MODE, SecretKeySpec(key, "AES"), GCMParameterSpec(128, nonce))
            updateAAD(aad(context.routeId, context.keyId, messageId))
            doFinal(padded)
        }
        val envelope = RelayEnvelope(
            r = context.routeId, k = context.keyId, m = messageId, n = base64(nonce), c = base64(cipher),
        )
        return serializeEnvelope(envelope).also(::sendBody)
    }

    /** Authenticate before parsing plaintext; enforce local context and return the opaque payload object. */
    fun decrypt(key: ByteArray, context: RelayContext, text: String): RelayPlaintext {
        context(context)
        val envelope = parseEnvelope(text)
        if (envelope.r != context.routeId || envelope.k != context.keyId) reject("route")
        if (key.size != 32) reject("invalid")
        val clear = try {
            Cipher.getInstance("AES/GCM/NoPadding").run {
                init(Cipher.DECRYPT_MODE, SecretKeySpec(key, "AES"), GCMParameterSpec(128, unbase64(envelope.n, 12)))
                updateAAD(aad(envelope.r, envelope.k, envelope.m))
                doFinal(unbase64(envelope.c))
            }
        } catch (_: Exception) {
            reject("authentication")
        }
        val plaintext = parsePlaintext(clear)
        if (plaintext.backendId != context.backendId || plaintext.sessionId != context.sessionId) reject("identity")
        return plaintext
    }

    /** Use trusted monotonic-anchored backend time; reject uncertainty and enforce five-minute skew boundaries. */
    fun checkExpiry(plaintext: RelayPlaintext, backendNow: Long, clockTrusted: Boolean = true) {
        if (!clockTrusted) reject("clock")
        timestamp(JsonPrimitive(backendNow))
        if (plaintext.createdAt > backendNow + SKEW_MS) reject("clock")
        if (backendNow > plaintext.expiresAt + SKEW_MS) reject("expired")
    }
}
