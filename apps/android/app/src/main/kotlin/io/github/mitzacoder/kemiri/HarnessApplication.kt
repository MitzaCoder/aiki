package io.github.mitzacoder.kemiri

import android.app.Application
import android.os.Build
import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue
import io.github.mitzacoder.kemiri.data.DeviceStore
import io.github.mitzacoder.kemiri.data.HarnessRepository
import io.github.mitzacoder.kemiri.features.notifications.FirebasePush
import io.github.mitzacoder.kemiri.features.notifications.NotificationCenter
import io.github.mitzacoder.kemiri.features.notifications.ensureNotificationChannels

class HarnessApplication : Application() {
    val repository by lazy { HarnessRepository(DeviceStore(this), io.github.mitzacoder.kemiri.data.DeviceAuthStore(this)) }
    /** Started by the activity (or a token change), not by every push: a push alone must not open every backend's socket. */
    val notifications by lazy {
        NotificationCenter(repository, FirebasePush, "${Build.MODEL} · Android app", relay = { relayNotifications })
            .also { started = it }
    }
    /** A wrapper only; Firebase Auth itself is never created until notification opt-in. */
    val relayAccount by lazy { io.github.mitzacoder.kemiri.features.notifications.relay.FirebaseRelayAccount(this) }
    /** One-time email URL in memory only, never saved in the activity bundle or logs. */
    var relayEmailLink by androidx.compose.runtime.mutableStateOf<String?>(null)
    /** Lazy receive plumbing; opening it does not open backend sockets or relay storage while relay is off. */
    val relayNotifications by lazy {
        io.github.mitzacoder.kemiri.features.notifications.relay.androidRelayNotifications(this, { relayAccount },
            { key -> repository.session(key)?.client?.let {
                io.github.mitzacoder.kemiri.features.notifications.relay.HarnessRelayBackendRpc(it)
            } }) {
            repository.setNotifications { it.copy(relayEnabled = false, relayRecoveryRequired = true) }
        }
    }
    @Volatile private var started: NotificationCenter? = null
    val notificationsIfStarted: NotificationCenter? get() = started

    override fun onCreate() {
        super.onCreate()
        FirebasePush.initialize(this)
        // Starts reading the chats' saved drafts, so the first chat opened restores its draft at once.
        io.github.mitzacoder.kemiri.data.DraftCache.of(this)
        ensureNotificationChannels(this)
    }
}
