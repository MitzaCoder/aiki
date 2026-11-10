package io.github.mitzacoder.aiki.features.notifications

import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import io.github.mitzacoder.aiki.HarnessApplication

/**
 * FCM's way in. Backends send data-only messages whose `payload` is the same JSON a browser gets through Web Push; the
 * app draws it. A new token is saved, and every backend gets it on the next sync.
 */
class HarnessMessagingService : FirebaseMessagingService() {
    /** FCM 25.1+ registers by Firebase installation and reports the token here. */
    override fun onRegistered(token: String) {
        (application as HarnessApplication).notifications.tokenChanged(token)
    }

    /** The older token flow, which [FirebasePush.token] still uses. */
    @Suppress("OVERRIDE_DEPRECATION")
    override fun onNewToken(token: String) {
        (application as HarnessApplication).notifications.tokenChanged(token)
    }

    override fun onMessageReceived(message: RemoteMessage) {
        val payload = parseNotificationPayload(message.data["payload"]) ?: return
        // The backend held it while the app was open and dropped it on interaction; what arrives is drawn.
        showPushNotification(this, payload)
    }
}
