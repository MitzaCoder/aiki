package io.github.mitzacoder.kemiri.features.settings

import io.github.mitzacoder.kemiri.data.BackendConfig
import io.github.mitzacoder.kemiri.data.normalizeBackendOrigin
import java.util.Base64

/**
 * "Connect another device": a link that carries the chosen backends in its fragment, so no server sees them and the
 * other device (the web app's `/connect` or this app's link handler) shows them for confirmation. The encoder half of
 * the web's `lib/connect.ts`; [io.github.mitzacoder.kemiri.data.decodeConnect] is the decoder.
 *
 * The payload is `v1.<base64url>`, one `name<TAB>origin` line per backend. Only HTTPS origins travel: a link leaves the
 * device, so a development backend on loopback stays here.
 */

/** Where the link opens: the published web app, whose `/connect` this app also handles. */
const val CONNECT_APP_ORIGIN = io.github.mitzacoder.kemiri.BuildConfig.APP_ORIGIN
const val MAX_CONNECT_BACKENDS = 12
const val MAX_CONNECT_NAME_LENGTH = 48

private val CONTROL_CHARACTERS = Regex("[\\u0000-\\u001f\\u007f]")

/** A backend's address as a link carries it, or null when it is not a plain HTTPS origin. */
private fun connectOrigin(url: String): String? = runCatching { normalizeBackendOrigin(url, allowLoopbackHttp = false) }.getOrNull()

/** Whether a backend could go in a connect link (HTTPS, an origin only). */
fun isConnectUrl(url: String): Boolean = connectOrigin(url) != null

/** A name as a link carries it: without control characters, trimmed, short, never empty. */
fun shareableName(name: String): String =
    name.replace(CONTROL_CHARACTERS, "").trim().take(MAX_CONNECT_NAME_LENGTH).trim().ifEmpty { "backend" }

/** The encoded fragment, `v1.…`, without the `#`. Throws when a backend is not one a device would accept. */
fun encodeConnectList(backends: List<BackendConfig>): String {
    require(backends.isNotEmpty()) { "Choose at least one backend to pass on." }
    require(backends.size <= MAX_CONNECT_BACKENDS) { "A connect link carries at most $MAX_CONNECT_BACKENDS backends." }
    val lines = backends.map { backend ->
        val name = backend.name.trim()
        require(name.length in 1..MAX_CONNECT_NAME_LENGTH && !CONTROL_CHARACTERS.containsMatchIn(name)) { "\"$name\" is not a usable backend name." }
        val url = connectOrigin(backend.url) ?: throw IllegalArgumentException("\"${backend.url}\" is not an HTTPS origin, so it cannot go in a connect link.")
        "$name\t$url"
    }
    return "v1." + Base64.getUrlEncoder().withoutPadding().encodeToString(lines.joinToString("\n").toByteArray(Charsets.UTF_8))
}

/** The full link to open on the other device. */
fun connectHref(origin: String, backends: List<BackendConfig>): String = "${origin.trimEnd('/')}/connect#${encodeConnectList(backends)}"

/** A QR code's modules for [text], row by row (true = dark), with zxing's own error correction and no quiet zone. */
fun qrModules(text: String): List<BooleanArray> {
    val matrix = com.google.zxing.qrcode.encoder.Encoder.encode(text, com.google.zxing.qrcode.decoder.ErrorCorrectionLevel.M).matrix
    return List(matrix.height) { y -> BooleanArray(matrix.width) { x -> matrix.get(x, y).toInt() == 1 } }
}
