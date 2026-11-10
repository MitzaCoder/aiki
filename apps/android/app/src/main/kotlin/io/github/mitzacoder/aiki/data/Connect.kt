package io.github.mitzacoder.aiki.data

import java.net.URI
import java.nio.ByteBuffer
import java.nio.charset.CodingErrorAction
import java.util.Base64
import kotlinx.serialization.Serializable

@Serializable
data class BackendConfig(val name: String, val url: String) {
    /** Stable across rename; project IDs are only unique within this key. */
    val key: String get() = url
}

/** Accepts a fragment (with optional #), not an arbitrary URL. All-or-nothing. */
fun decodeConnect(fragment: String): Result<List<BackendConfig>> = runCatching {
    val payload = fragment.trim().removePrefix("#")
    require(payload.length in 1..2048) { "This link is empty or too long." }
    val parts = payload.split('.')
    require(parts.size == 2 && parts[0] == "v1") { "Unsupported connect link version." }
    require(Regex("[A-Za-z0-9_-]+").matches(parts[1])) { "Damaged connect link." }
    val bytes = Base64.getUrlDecoder().decode(parts[1])
    val text = Charsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT)
        .onUnmappableCharacter(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(bytes)).toString()
    val backends = linkedMapOf<String, BackendConfig>()
    for (line in text.split('\n')) {
        if (line.isEmpty()) continue
        val fields = line.split('\t')
        require(fields.size == 2) { "Damaged backend line." }
        val name = fields[0].trim()
        require(name.length in 1..48 && name.none { it.code < 32 || it.code == 127 }) { "Invalid backend name." }
        val url = normalizeBackendOrigin(fields[1], allowLoopbackHttp = false)
        backends.putIfAbsent(url, BackendConfig(name, url))
        require(backends.size <= 12) { "Too many backends." }
    }
    require(backends.isNotEmpty()) { "This link carries no backends." }
    backends.values.toList()
}

fun normalizeBackendOrigin(value: String, allowLoopbackHttp: Boolean = true): String {
    val trimmed = value.trim()
    require(trimmed.length in 1..512)
    val uri = URI(trimmed)
    val host = uri.host?.lowercase() ?: throw IllegalArgumentException("A backend must have a host.")
    val scheme = uri.scheme?.lowercase()
    val loopback = host in setOf("localhost", "127.0.0.1", "[::1]", "::1", "10.0.2.2")
    require(scheme == "https" || (allowLoopbackHttp && scheme == "http" && loopback)) { "Use an HTTPS origin." }
    require(uri.rawUserInfo == null && (uri.rawPath.isNullOrEmpty() || uri.rawPath == "/") && uri.rawQuery == null && uri.rawFragment == null) { "Use only an origin: no credentials, path, query or fragment." }
    require(uri.port == -1 || uri.port in 1..65535)
    val port = if (uri.port == -1 || (scheme == "https" && uri.port == 443) || (scheme == "http" && uri.port == 80)) "" else ":${uri.port}"
    return "$scheme://$host$port"
}
