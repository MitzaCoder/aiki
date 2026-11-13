package io.github.mitzacoder.kemiri

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log
import kotlinx.coroutines.launch
import io.github.mitzacoder.kemiri.features.notifications.parseNotificationPayload
import io.github.mitzacoder.kemiri.features.notifications.showPushNotification

/**
 * What `HarnessMessagingService` would get from FCM, from adb instead (debug builds only):
 *
 *     adb shell am broadcast -a io.github.mitzacoder.aiki.DEBUG_PUSH -p io.github.mitzacoder.aiki --es payload '<NotificationPayload JSON>'
 *     adb shell am broadcast -a io.github.mitzacoder.aiki.DEBUG_PUSH -p io.github.mitzacoder.aiki --es token fake-token   # also turns push on
 */
class DebugPushReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val app = context.applicationContext as HarnessApplication
        intent.getStringExtra("token")?.let { token ->
            val pending = goAsync()
            val center = app.notifications
            kotlinx.coroutines.CoroutineScope(kotlinx.coroutines.Dispatchers.IO).launch {
                try { center.update { it.copy(enabled = true, fcmToken = token) } } finally { pending.finish() }
            }
        }
        intent.getStringExtra("payload")?.let { raw ->
            val payload = parseNotificationPayload(raw)
            if (payload == null) Log.w("HarnessPush", "debug push: not a payload")
            else Log.i("HarnessPush", "debug push ${payload.kind}: shown=${showPushNotification(context, payload)}")
        }
    }
}
