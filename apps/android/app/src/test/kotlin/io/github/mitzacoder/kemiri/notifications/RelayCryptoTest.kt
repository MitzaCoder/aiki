package io.github.mitzacoder.kemiri.notifications

import io.github.mitzacoder.kemiri.features.notifications.parseNotificationPayload
import io.github.mitzacoder.kemiri.features.notifications.relay.*
import java.io.File
import java.math.BigInteger
import java.security.AlgorithmParameters
import java.security.KeyFactory
import java.security.spec.ECGenParameterSpec
import java.security.spec.ECParameterSpec
import java.security.spec.ECPrivateKeySpec
import javax.crypto.Cipher
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec
import kotlinx.serialization.json.*
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.junit.runners.Parameterized

private object RelayVectors {
    // Read the one repository fixture directly, never a copied Gradle resource.
    val file = generateSequence(File(requireNotNull(System.getProperty("user.dir"))).absoluteFile) { it.parentFile }
        .map { File(it, "packages/protocol/test-vectors/push-relay-v1.json") }
        .first { it.isFile }
    val root = Json.parseToJsonElement(file.readText()).jsonObject
    val context = context(root.getValue("context").jsonObject)
    val key = RelayCrypto.unbase64(root.getValue("keys").jsonObject.s("notification"))
    val base = RelayCrypto.readPlaintext(root.getValue("encryptions").jsonArray.first().jsonObject.getValue("input"))

    fun context(value: JsonObject) = RelayContext(
        value.s("backendId"), value.s("sessionId"), value.s("routeId"), value.s("keyId"),
    )

    fun cases(name: String): List<Array<Any>> = root.getValue(name).jsonArray.map {
        arrayOf(it.jsonObject.s("name"), it.jsonObject)
    }
}

private fun JsonObject.s(key: String) = getValue(key).jsonPrimitive.content

private fun expectCode(code: String, run: () -> Unit) {
    try {
        run()
        fail("Accepted invalid input: $code")
    } catch (error: RelayException) {
        assertEquals(code, error.code)
    }
}

/** Nonce injection is test-only and never shipped in the library API. */
private fun vectorEncrypt(
    key: ByteArray,
    context: RelayContext,
    plaintext: RelayPlaintext,
    messageId: String,
    nonce: String,
    padded: ByteArray = RelayCrypto.preparePlaintext(plaintext).second,
): String {
    val cipher = Cipher.getInstance("AES/GCM/NoPadding").run {
        init(Cipher.ENCRYPT_MODE, SecretKeySpec(key, "AES"), GCMParameterSpec(128, RelayCrypto.unbase64(nonce, 12)))
        updateAAD(RelayCrypto.aad(context.routeId, context.keyId, messageId))
        doFinal(padded)
    }
    val envelope = RelayEnvelope(
        r = context.routeId, k = context.keyId, m = messageId, n = nonce, c = RelayCrypto.base64(cipher),
    )
    return RelayCrypto.serializeEnvelope(envelope)
}

@RunWith(Parameterized::class)
class RelayEncryptionVectorsTest(private val name: String, private val value: JsonObject) {
    companion object {
        @JvmStatic @Parameterized.Parameters(name = "{0}")
        fun cases() = RelayVectors.cases("encryptions")
    }

    @Test fun reproducesAndDecryptsSharedEnvelope() {
        val input = RelayCrypto.readPlaintext(value.getValue("input"))
        val prepared = RelayCrypto.preparePlaintext(input)
        assertEquals(value.getValue("plaintext"), RelayCrypto.plaintextJson(prepared.first))
        assertEquals(value.s("plaintextJson"), RelayCrypto.plaintextJson(prepared.first).toString())
        assertEquals(value.s("padded"), RelayCrypto.base64(prepared.second))
        val context = RelayVectors.context(value.getValue("context").jsonObject)
        // Exact byte equality proves the TS reader also decrypts Kotlin-produced ciphertext.
        val envelope = vectorEncrypt(RelayVectors.key, context, input, value.s("messageId"), value.s("nonce"))
        assertEquals(value.s("envelope"), envelope)
        val decrypted = RelayCrypto.decrypt(RelayVectors.key, context, value.s("envelope"))
        assertEquals(value.getValue("plaintext"), RelayCrypto.plaintextJson(decrypted))
        assertEquals(prepared.first, RelayCrypto.parsePlaintext(RelayCrypto.unbase64(value.s("padded"))))
        assertEquals(value.s("fcmData"), buildJsonObject { put("aiki", value.s("envelope")) }.toString())
        assertEquals(RelayCrypto.parseEnvelope(envelope), RelayCrypto.parseFcmData(value.s("fcmData")))
        assertEquals(value.s("sendBody"), RelayCrypto.sendBody(envelope))
    }
}

@RunWith(Parameterized::class)
class RelayOpaquePayloadVectorsTest(private val name: String, private val value: JsonObject) {
    companion object {
        @JvmStatic @Parameterized.Parameters(name = "{0}")
        fun cases() = RelayVectors.cases("receives")
    }

    @Test fun acceptsOpaqueAuthenticatedPayload() {
        val padded = RelayCrypto.unbase64(value.s("padded"))
        val envelope = vectorEncrypt(
            RelayVectors.key, RelayVectors.context, RelayVectors.base,
            value.s("messageId"), value.s("nonce"), padded,
        )
        assertEquals(value.s("envelope"), envelope)
        val expected = Json.parseToJsonElement(value.s("plaintextJson"))
        assertEquals(expected, RelayCrypto.plaintextJson(RelayCrypto.parsePlaintext(padded)))
        val decrypted = RelayCrypto.decrypt(RelayVectors.key, RelayVectors.context, envelope)
        assertEquals(expected, RelayCrypto.plaintextJson(decrypted))
    }
}

@RunWith(Parameterized::class)
class RelayNegativeVectorsTest(private val name: String, private val value: JsonObject) {
    companion object {
        @JvmStatic @Parameterized.Parameters(name = "{0}")
        fun cases() = RelayVectors.cases("negatives")
    }

    @Test fun rejectsWithExpectedCode() {
        expectCode(value.s("error")) {
            when (value.s("op")) {
                "decrypt" -> rejectDecryption()
                "fcm" -> RelayCrypto.parseFcmData(value.s("fcmData"))
                "point" -> RelayCrypto.importPublicKey(value.s("point"))
                "confirm" -> rejectConfirmation()
                "bearer" -> RelayCrypto.parseBearer(value.s("bearer"), value.s("purpose"))
                "sequence" -> RelayCrypto.sequence(value.s("sequence"))
                "prepare" -> RelayCrypto.preparePlaintext(RelayCrypto.readPlaintext(value.getValue("input")))
                else -> error("Unknown operation")
            }
        }
    }

    private fun rejectDecryption() {
        val key = value["key"]?.jsonPrimitive?.content?.let(RelayCrypto::unbase64) ?: RelayVectors.key
        val context = value["context"]?.jsonObject?.let(RelayVectors::context) ?: RelayVectors.context
        RelayCrypto.decrypt(key, context, value.s("envelope"))
    }

    private fun rejectConfirmation() {
        val key = RelayVectors.root.getValue("keys").jsonObject.s(value.s("purpose"))
        RelayCrypto.verifyConfirmation(RelayCrypto.unbase64(key), value.s("transcript"), value.s("confirmation"))
    }
}

@RunWith(Parameterized::class)
class RelayReplayVectorsTest(private val name: String, private val value: JsonObject) {
    companion object {
        @JvmStatic @Parameterized.Parameters(name = "{0}")
        fun cases() = RelayVectors.cases("replay")
    }

    @Test fun persistsWindowAtEachStep() {
        var window = RelayReplayWindow()
        for (raw in value.getValue("steps").jsonArray) {
            val step = raw.jsonObject
            assertEquals(step.getValue("accept").jsonPrimitive.boolean, window.accept(step.s("sequence")))
            assertEquals(step.getValue("state"), window.state())
            window = RelayReplayWindow(Json.parseToJsonElement(window.state().toString()).jsonObject)
        }
    }
}

@RunWith(Parameterized::class)
class RelayExpiryVectorsTest(private val name: String, private val value: JsonObject) {
    companion object {
        @JvmStatic @Parameterized.Parameters(name = "{0}")
        fun cases() = RelayVectors.cases("expiry")
    }

    @Test fun enforcesBackendTimeAndSkew() {
        val run = {
            RelayCrypto.checkExpiry(
                RelayVectors.base, value.getValue("now").jsonPrimitive.long,
                value["trusted"]?.jsonPrimitive?.boolean ?: true,
            )
        }
        if (value.getValue("error") == JsonNull) run() else expectCode(value.s("error"), run)
    }
}

class RelayCryptoTest {
    @Test fun existingAppParserIgnoresFieldsButRejectsUnknownKinds() {
        val encryptions = RelayVectors.root.getValue("encryptions").jsonArray.map { it.jsonObject }
        val withFutureField = encryptions.first { it.s("name") == "future-field" }
        val withFutureKind = encryptions.first { it.s("name") == "future-kind" }
        fun decodedPayload(value: JsonObject) = RelayCrypto.decrypt(
            RelayVectors.key, RelayVectors.context, value.s("envelope"),
        ).payload.toString()
        assertNotNull(parseNotificationPayload(decodedPayload(withFutureField)))
        assertNull(parseNotificationPayload(decodedPayload(withFutureKind)))
    }

    @Test fun fixedAgreementDerivationAndConfirmation() {
        val value = RelayVectors.root
        val context = RelayVectors.context
        val params = AlgorithmParameters.getInstance("EC").apply {
            init(ECGenParameterSpec("secp256r1"))
        }.getParameterSpec(ECParameterSpec::class.java)
        fun privateKey(scalar: String) = KeyFactory.getInstance("EC").generatePrivate(
            ECPrivateKeySpec(BigInteger(1, RelayCrypto.unbase64(scalar)), params),
        )
        val shared = RelayCrypto.sharedSecret(privateKey(value.s("phonePrivateScalar")), value.s("backendPublicKey"))
        assertEquals(value.s("ecdhOutput"), RelayCrypto.base64(shared))
        val backendShared = RelayCrypto.sharedSecret(
            privateKey(value.s("backendPrivateScalar")), value.s("phonePublicKey"),
        )
        assertArrayEquals(shared, backendShared)
        val phonePublic = RelayCrypto.importPublicKey(value.s("phonePublicKey"))
        assertEquals(value.s("phonePublicKey"), RelayCrypto.exportPublicKey(phonePublic))
        val keys = RelayCrypto.deriveKeys(shared, value.s("salt"), context)
        for (purpose in RelayCrypto.purposes) {
            assertEquals(value.getValue("keys").jsonObject.s(purpose), RelayCrypto.base64(keys.getValue(purpose)))
            assertEquals(value.getValue("info").jsonObject.s(purpose), RelayCrypto.keyInfo(context, purpose))
        }
        val transcript = RelayCrypto.transcript(
            context, value.s("salt"), value.s("phonePublicKey"), value.s("backendPublicKey"),
        )
        assertEquals(value.s("transcript"), transcript)
        for (direction in listOf("phone", "backend")) {
            val confirmation = RelayCrypto.confirmation(keys.getValue("$direction-confirm"), transcript)
            assertEquals(value.getValue("confirmations").jsonObject.s(direction), confirmation)
            RelayCrypto.verifyConfirmation(keys.getValue("$direction-confirm"), transcript, confirmation)
        }
    }

    @Test fun capabilities() {
        for (raw in RelayVectors.root.getValue("capabilities").jsonArray) {
            val value = raw.jsonObject
            val purpose = value.s("purpose")
            val bearer = RelayCrypto.bearer(purpose, RelayVectors.context.routeId, value.s("secret"))
            assertEquals(value.s("bearer"), bearer)
            assertEquals(RelayVectors.context.routeId to value.s("secret"), RelayCrypto.parseBearer(bearer, purpose))
            assertEquals(value.s("hash"), RelayCrypto.base64(RelayCrypto.credentialHash(bearer, purpose)))
        }
    }

    @Test fun randomAgreementAndFreshProductionNonces() {
        val nonces = mutableSetOf<String>()
        val messages = mutableSetOf<String>()
        repeat(8) {
            val phone = RelayCrypto.generateKeyPair()
            val backend = RelayCrypto.generateKeyPair()
            val shared = RelayCrypto.sharedSecret(phone.private, RelayCrypto.exportPublicKey(backend.public))
            assertArrayEquals(shared, RelayCrypto.sharedSecret(backend.private, RelayCrypto.exportPublicKey(phone.public)))
            val key = RelayCrypto.deriveKeys(shared, RelayVectors.root.s("salt"), RelayVectors.context)
                .getValue("notification")
            repeat(2) {
                val envelope = RelayCrypto.encrypt(key, RelayVectors.context, RelayVectors.base)
                val parsed = RelayCrypto.parseEnvelope(envelope)
                assertTrue(nonces.add(parsed.n))
                assertTrue(messages.add(parsed.m))
                assertEquals(RelayVectors.base, RelayCrypto.decrypt(key, RelayVectors.context, envelope))
            }
        }
    }

    @Test fun persistBeforeDisplayAndCrossKeyEventDedupe() {
        val base = RelayVectors.base
        val key = RelayVectors.context.keyId
        var saved = ""
        val persist: (String) -> Unit = { saved = it }
        val admission = RelayAdmission()
        val before = admission.serialize()
        try {
            admission.admit(key, base, base.createdAt, { throw IllegalStateException("disk full") })
            fail("Expected disk failure")
        } catch (_: IllegalStateException) {
            // No display after failed persistence.
        }
        assertEquals(before, admission.serialize())
        admission.admit(key, base, base.createdAt, persist)
        val restarted = RelayAdmission(saved)
        assertEquals(saved, restarted.serialize())
        expectCode("replay") { restarted.admit(key, base, base.createdAt, persist) }
        val successor = RelayCrypto.base64(ByteArray(16) { 77 })
        expectCode("event_duplicate") {
            restarted.admit(successor, base.copy(sequence = "1"), base.createdAt, persist)
        }
        val differentEvent = base.copy(sequence = "1", eventId = RelayCrypto.base64(ByteArray(16) { 88 }))
        restarted.admit(successor, differentEvent, base.createdAt, persist)
        val now = base.createdAt + RelayCrypto.RETENTION_MS
        val fresh = base.copy(sequence = "2", createdAt = now, expiresAt = now + RelayCrypto.LIFETIME_MS)
        val beforeBoundary = fresh.copy(createdAt = now - 1, expiresAt = now + RelayCrypto.LIFETIME_MS - 1)
        expectCode("event_duplicate") { restarted.admit(successor, beforeBoundary, now - 1, persist) }
        restarted.admit(successor, fresh, now, persist)
        assertEquals(saved, RelayAdmission(saved).serialize())
    }

    @Test fun sizeLimitsAndFcmKeySet() {
        for (cap in listOf(2048, 3584, 4096, 8192)) {
            RelayCrypto.checkSize("a".repeat(cap), cap)
            expectCode("oversize") { RelayCrypto.checkSize("a".repeat(cap + 1), cap) }
            expectCode("oversize") { RelayCrypto.checkSize("é".repeat(cap), cap) }
        }
        val envelope = RelayVectors.root.getValue("encryptions").jsonArray.first().jsonObject.s("envelope")
        val extra = buildJsonObject {
            put("aiki", envelope)
            put("other", "x")
        }
        expectCode("invalid") { RelayCrypto.parseFcmData(extra.toString()) }
        expectCode("oversize") { RelayCrypto.parseFcmData(" ".repeat(3585)) }
        assertTrue(RelayCrypto.constantTimeEqual(RelayVectors.key, RelayVectors.key.copyOf()))
        assertFalse(RelayCrypto.constantTimeEqual(RelayVectors.key, RelayVectors.key.copyOfRange(1, 32)))
    }

    @Test fun canonicalAndLifetimeValidation() {
        for (text in listOf("AA=", "AA+", "AB", " A", "", "_", "a".repeat(4097))) {
            expectCode("invalid") { RelayCrypto.unbase64(text) }
        }
        val base = RelayVectors.base
        val invalid = listOf(
            base.copy(expiresAt = base.createdAt - 1),
            base.copy(expiresAt = base.createdAt + RelayCrypto.LIFETIME_MS + 1),
            base.copy(backendId = "\ud800"),
        )
        for (plaintext in invalid) expectCode("invalid") { RelayCrypto.preparePlaintext(plaintext) }
        expectCode("identity") {
            RelayCrypto.encrypt(RelayVectors.key, RelayVectors.context.copy(sessionId = "other"), base)
        }
    }
}
