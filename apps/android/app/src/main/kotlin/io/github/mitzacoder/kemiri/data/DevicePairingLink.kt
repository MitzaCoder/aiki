package io.github.mitzacoder.kemiri.data

import java.net.URI
import java.nio.ByteBuffer
import java.nio.charset.CodingErrorAction
import java.security.MessageDigest
import java.security.SecureRandom
import java.util.Base64
import kotlinx.serialization.json.*

/** Secrets are intentionally not data-class properties printed by toString. */
class DevicePairingLink(val backendId: String, val origin: String, val grantId: String, val secret: String, val bootstrap: Boolean = false)

private fun pairingOrigin(origin: String): String {
    require(normalizeBackendOrigin(origin) == origin) { "Use a canonical backend origin." }
    val uri = URI(origin)
    require(uri.scheme == "https" || uri.host in setOf("localhost", "127.0.0.1", "[::1]")) { "Use HTTPS outside loopback." }
    return origin
}

fun encodeDevicePairingFragment(link: DevicePairingLink): String {
    pairingOrigin(link.origin)
    require(link.backendId.isNotEmpty() && link.grantId.isNotEmpty())
    require(Regex("aiki_p1\\.[A-Za-z0-9_-]{43}").matches(link.secret))
    val json = JsonArray(listOf(link.backendId, link.origin, link.grantId, link.secret).map(::JsonPrimitive)).toString()
    return "#pair=v2." + Base64.getUrlEncoder().withoutPadding().encodeToString(json.toByteArray(Charsets.UTF_8))
}

fun decodeDevicePairingLink(input: String): DevicePairingLink {
    val fragment = if (input.startsWith("#") || input.startsWith("pair=") || input.startsWith("bootstrap=")) input.removePrefix("#")
        else URI(input.trim()).rawFragment ?: error("Paste a pairing link, not an address-import link.")
    val bootstrap = fragment.startsWith("bootstrap=v1.")
    val prefix = if (bootstrap) "bootstrap=v1." else "pair=v2."
    require(fragment.startsWith(prefix)) { "Unsupported pairing link." }
    val encoded = fragment.removePrefix(prefix)
    require(encoded.length in 1..4096 && encoded.matches(Regex("[A-Za-z0-9_-]+"))) { "Damaged pairing link." }
    val bytes = Base64.getUrlDecoder().decode(encoded)
    val json = Charsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT).onUnmappableCharacter(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(bytes)).toString()
    val array = wireJson.parseToJsonElement(json).jsonArray
    require(array.size == if (bootstrap) 3 else 4)
    require(array.all { it is JsonPrimitive && it.isString })
    val fields = array.map { it.jsonPrimitive.content }
    pairingOrigin(fields[1])
    require(fields[0].isNotEmpty() && fields[2].isNotEmpty())
    require(Base64.getUrlEncoder().withoutPadding().encodeToString(JsonArray(fields.map(::JsonPrimitive)).toString().toByteArray(Charsets.UTF_8)) == encoded) { "Noncanonical pairing link." }
    return DevicePairingLink(fields[0], fields[1], fields[2], if (bootstrap) "" else fields[3], bootstrap).also {
        if (!bootstrap) require(encodeDevicePairingFragment(it).removePrefix("#") == fragment)
    }
}

fun deviceComparisonCode(backendId: String, grantId: String, claimId: String, claimSecret: String): String {
    val digest = MessageDigest.getInstance("SHA-256").digest("aiki-device-claim-v1\n$backendId\n$grantId\n$claimId\n$claimSecret".toByteArray(Charsets.UTF_8))
    val alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"
    var buffer = 0L
    digest.take(5).forEach { buffer = (buffer shl 8) or (it.toLong() and 255) }
    val code = (7 downTo 0).map { alphabet[((buffer ushr (it * 5)) and 31).toInt()] }.joinToString("")
    return code.take(4) + "-" + code.drop(4)
}

internal fun deviceAuthSecret(prefix: String): String = prefix + Base64.getUrlEncoder().withoutPadding().encodeToString(ByteArray(32).also { SecureRandom().nextBytes(it) })
internal fun newDeviceClaim(kind: String, grantId: String = "migration", redeemSecret: String? = null) = PendingDeviceClaim(
    id = java.util.UUID.randomUUID().toString(), secret = deviceAuthSecret("aiki_c1."), kind = kind, grantId = grantId, redeemSecret = redeemSecret,
)
