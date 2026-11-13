package io.github.mitzacoder.kemiri.features.notifications.relay

import com.google.firebase.auth.FirebaseAuth

/** Release has no emulator settings, synthetic credentials or fake token source. */
internal object RelayAuthPlatform {
    val fakeGoogleCredentialEnabled: Boolean get() = false

    fun reportFailure(error: Exception) = Unit
    fun configure(auth: FirebaseAuth) = Unit
    fun googleToken(): String? = null
    fun fakePushToken(): String? = null
}
