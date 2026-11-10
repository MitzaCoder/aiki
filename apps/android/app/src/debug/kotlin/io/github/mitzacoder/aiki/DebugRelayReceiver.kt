package io.github.mitzacoder.aiki

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch

/** Shell-only debug delivery of a captured challenge/envelope through exactly the FCM receive boundary. */
class DebugRelayReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val raw = intent.getStringExtra("aiki") ?: return
        val app = context.applicationContext as HarnessApplication
        val pending = goAsync()
        CoroutineScope(Dispatchers.IO).launch {
            try { app.relayNotifications.receive(mapOf("aiki" to raw)) }
            finally { pending.finish() }
        }
    }
}
