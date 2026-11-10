package io.github.mitzacoder.aiki.features.notifications.relay

import com.google.firebase.auth.FirebaseAuth
import io.github.mitzacoder.aiki.BuildConfig
import java.util.Base64

/** Emulator-only controls; not compiled into a release APK. Refuses synthetic credentials without the emulator. */
internal object RelayAuthPlatform {
    private fun checkDemo() {
        check(BuildConfig.FIREBASE_PROJECT_ID == "demo-aiki-relay")
        val host = BuildConfig.RELAY_AUTH_EMULATOR.substringBeforeLast(':')
        check(host in setOf("10.0.2.2", "127.0.0.1", "localhost"))
        check(BuildConfig.RELAY_AUTH_EMULATOR.substringAfterLast(':').toIntOrNull() in 1024..65535)
    }

    fun reportFailure(error: Exception) {
        val code = (error as? com.google.firebase.auth.FirebaseAuthException)?.errorCode.orEmpty()
        val reason = listOf("cleartext", "timeout", "api key", "resolve", "permission", "network", "connection")
            .filter { error.message.orEmpty().contains(it, ignoreCase = true) }.joinToString(",")
        android.util.Log.w("RelayAuthDemo", "${error.javaClass.simpleName}:$code:$reason")
    }

    fun configure(auth: FirebaseAuth) {
        if (BuildConfig.RELAY_AUTH_EMULATOR.isEmpty()) {
            check(!BuildConfig.RELAY_FAKE_GOOGLE && !BuildConfig.RELAY_FAKE_FCM)
            return
        }
        checkDemo()
        auth.firebaseAuthSettings.setAppVerificationDisabledForTesting(true)
        auth.useEmulator(BuildConfig.RELAY_AUTH_EMULATOR.substringBeforeLast(':'),
            BuildConfig.RELAY_AUTH_EMULATOR.substringAfterLast(':').toInt())
    }

    fun googleToken(): String? {
        if (!BuildConfig.RELAY_FAKE_GOOGLE) return null
        checkDemo()
        val now = System.currentTimeMillis() / 1000
        fun encode(raw: String) = Base64.getUrlEncoder().withoutPadding().encodeToString(raw.toByteArray())
        return encode("""{"alg":"none","typ":"JWT"}""") + "." + encode(
            """{"sub":"demo-google-user","email":"google@example.test","email_verified":true,"iss":"https://accounts.google.com","aud":"demo-web-client","iat":$now,"exp":${now + 3600}}""",
        ) + "."
    }

    fun fakePushToken(): String? {
        if (!BuildConfig.RELAY_FAKE_FCM) return null
        checkDemo()
        return "demo-fcm-phone-token"
    }
}
