package io.github.mitzacoder.kemiri.navigation

import java.net.URI

/** A connect URL only opens a preview. Settings still validates the entire fragment and asks to add. */
fun connectPayloadFromUri(value: String): String? = runCatching {
    val uri = URI(value)
    require(uri.rawUserInfo == null && uri.rawQuery == null)
    when (uri.scheme?.lowercase()) {
        "https" -> require(uri.host.equals(io.github.mitzacoder.kemiri.features.notifications.APP_LINK_HOST, ignoreCase = true) && uri.rawPath == "/connect")
        "harness", "aiki", "kemiri" -> require(uri.host == "connect" && uri.rawPath.orEmpty() in setOf("", "/"))
        else -> return null
    }
    // Preserve the raw fragment: percent escapes must not turn damaged base64url into valid input.
    uri.rawFragment.orEmpty()
}.getOrNull()
