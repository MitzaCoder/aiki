package io.github.mitzacoder.aiki.features.notifications

import android.content.Context
import android.util.Log
import com.google.android.gms.common.ConnectionResult
import com.google.android.gms.common.GoogleApiAvailabilityLight
import com.google.android.gms.tasks.Task
import com.google.firebase.FirebaseApp
import com.google.firebase.FirebaseOptions
import com.google.firebase.messaging.FirebaseMessaging
import io.github.mitzacoder.aiki.BuildConfig
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException
import kotlinx.coroutines.suspendCancellableCoroutine

/** Where push tokens come from; FCM in the app, a fake in tests. */
interface PushTokens {
    /** Why this device cannot get a token, or null when it can. */
    val unavailableReason: String?
    /** The Firebase project the app's tokens belong to; a backend must send through the same one. */
    val projectId: String?
    suspend fun token(): String
    suspend fun delete()
}

/**
 * Firebase, initialised by hand from the BuildConfig values the build read out of a google-services.json outside the
 * repo. A build without that file has empty values and push stays off; nothing else changes.
 */
object FirebasePush : PushTokens {
    private var reason: String? = "This build has no Firebase configuration (google-services.json), so it cannot receive push."
    override val unavailableReason get() = reason
    override val projectId: String? = BuildConfig.FIREBASE_PROJECT_ID.ifEmpty { null }

    fun initialize(context: Context) {
        if (io.github.mitzacoder.aiki.features.notifications.relay.RelayAuthPlatform.fakePushToken() != null) {
            reason = null
            return // The demo must not instantiate Messaging or contact the FCM service.
        }
        if (BuildConfig.FIREBASE_APP_ID.isEmpty()) return
        try {
            if (FirebaseApp.getApps(context).isEmpty()) {
                FirebaseApp.initializeApp(context, FirebaseOptions.Builder()
                    .setApplicationId(BuildConfig.FIREBASE_APP_ID)
                    .setApiKey(BuildConfig.FIREBASE_API_KEY)
                    .setProjectId(BuildConfig.FIREBASE_PROJECT_ID)
                    .setGcmSenderId(BuildConfig.FIREBASE_SENDER_ID)
                    .build())
            }
            reason = if (GoogleApiAvailabilityLight.getInstance().isGooglePlayServicesAvailable(context) == ConnectionResult.SUCCESS) null
                else "Google Play services are missing or out of date on this device, so it cannot receive push."
        } catch (error: Exception) {
            Log.w("HarnessPush", "Firebase could not start", error)
            reason = "Firebase could not start: ${error.message}"
        }
    }

    // getToken/deleteToken are deprecated since FCM 25.1 in favour of register()/onRegistered, but still return the
    // same kind of registration token synchronously; onRegistered is handled too, so either flow reaches the backends.
    @Suppress("DEPRECATION")
    override suspend fun token(): String {
        io.github.mitzacoder.aiki.features.notifications.relay.RelayAuthPlatform.fakePushToken()?.let { return it }
        reason?.let { throw IllegalStateException(it) }
        val messaging = FirebaseMessaging.getInstance()
        messaging.isAutoInitEnabled = true
        return messaging.token.await()
    }

    @Suppress("DEPRECATION")
    override suspend fun delete() {
        if (io.github.mitzacoder.aiki.features.notifications.relay.RelayAuthPlatform.fakePushToken() != null) return
        if (reason != null) return
        val messaging = FirebaseMessaging.getInstance()
        messaging.isAutoInitEnabled = false
        messaging.deleteToken().await()
    }
}

private suspend fun <T> Task<T>.await(): T = suspendCancellableCoroutine { continuation ->
    addOnCompleteListener { task ->
        val error = task.exception
        if (error != null) continuation.resumeWithException(error)
        else if (task.isCanceled) continuation.cancel()
        else continuation.resume(task.result)
    }
}
