package com.mihaisaru.harness

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log
import kotlinx.coroutines.launch
import com.mihaisaru.harness.features.notifications.parseNotificationPayload
import com.mihaisaru.harness.features.notifications.showPushNotification

/**
 * What `HarnessMessagingService` would get from FCM, from adb instead (debug builds only):
 *
 *     adb shell am broadcast -a com.mihaisaru.harness.DEBUG_PUSH -p com.mihaisaru.harness --es payload '<NotificationPayload JSON>'
 *     adb shell am broadcast -a com.mihaisaru.harness.DEBUG_PUSH -p com.mihaisaru.harness --es token fake-token   # also turns push on
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
