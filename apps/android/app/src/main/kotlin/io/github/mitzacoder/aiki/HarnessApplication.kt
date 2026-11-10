package io.github.mitzacoder.aiki

import android.app.Application
import android.os.Build
import io.github.mitzacoder.aiki.data.DeviceStore
import io.github.mitzacoder.aiki.data.HarnessRepository
import io.github.mitzacoder.aiki.features.notifications.FirebasePush
import io.github.mitzacoder.aiki.features.notifications.NotificationCenter
import io.github.mitzacoder.aiki.features.notifications.ensureNotificationChannels

class HarnessApplication : Application() {
    val repository by lazy { HarnessRepository(DeviceStore(this), io.github.mitzacoder.aiki.data.DeviceAuthStore(this)) }
    /** Started by the activity (or a token change), not by every push: a push alone must not open every backend's socket. */
    val notifications by lazy { NotificationCenter(repository, FirebasePush, "${Build.MODEL} · Android app").also { started = it } }
    @Volatile private var started: NotificationCenter? = null
    val notificationsIfStarted: NotificationCenter? get() = started

    override fun onCreate() {
        super.onCreate()
        FirebasePush.initialize(this)
        // Starts reading the chats' saved drafts, so the first chat opened restores its draft at once.
        io.github.mitzacoder.aiki.data.DraftCache.of(this)
        ensureNotificationChannels(this)
    }
}
