package io.github.mitzacoder.kemiri.features.notifications.relay

import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull

/** Validates the APK-pinned endpoint without consulting messages, backends or account configuration. */
class RelayEndpoint(configured: String, debug: Boolean) {
    val url: HttpUrl? = configured.toHttpUrlOrNull()?.takeIf {
        it.username.isEmpty() && it.password.isEmpty() && it.query == null && it.fragment == null &&
            (it.isHttps || (debug && it.scheme == "http" &&
                it.host in setOf("localhost", "127.0.0.1", "::1", "10.0.2.2")))
    }?.let { if (it.encodedPath.endsWith("/")) it else it.newBuilder().addPathSegment("").build() }
    val unavailableReason: String? = when {
        configured.isBlank() -> "This build has no push relay configured."
        url == null -> "This build has an unsupported push relay endpoint."
        else -> null
    }
    override fun toString(): String = "RelayEndpoint"
}
