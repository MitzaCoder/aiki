package io.github.mitzacoder.aiki.features.notifications.relay

import com.google.firebase.auth.FirebaseAuth

/** Release has no emulator settings, synthetic credentials or fake token source. */
internal object RelayAuthPlatform {
    fun reportFailure(error: Exception) = Unit
    fun configure(auth: FirebaseAuth) = Unit
    fun googleToken(): String? = null
    fun fakePushToken(): String? = null
}
