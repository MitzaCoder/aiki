package io.github.mitzacoder.kemiri

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch

/** Shell-only debug delivery of a captured challenge/envelope through exactly the FCM receive boundary. */
class DebugRelayReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val message = intent.getStringExtra("aiki")?.let { mapOf("aiki" to it) }
            ?: intent.getStringExtra("payload")?.let { mapOf("payload" to it) } ?: return
        val app = context.applicationContext as HarnessApplication
        val pending = goAsync()
        CoroutineScope(Dispatchers.IO).launch {
            try {
                app.relayNotifications.receive(message)
                if (message.containsKey("aiki") && app.relayAccount.identity() != null) {
                    val state = app.relayNotifications.snapshot()
                    android.util.Log.i("RelayDemo", "phase=${state.enrollment?.phase}; failure=${state.failure}; counters=${state.counters}")
                }
            }
            finally { pending.finish() }
        }
    }
}
