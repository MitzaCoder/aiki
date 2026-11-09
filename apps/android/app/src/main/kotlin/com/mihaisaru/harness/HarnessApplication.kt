package com.mihaisaru.harness

import android.app.Application
import android.os.Build
import com.mihaisaru.harness.data.DeviceStore
import com.mihaisaru.harness.data.HarnessRepository
import com.mihaisaru.harness.features.notifications.FirebasePush
import com.mihaisaru.harness.features.notifications.NotificationCenter
import com.mihaisaru.harness.features.notifications.ensureNotificationChannels

class HarnessApplication : Application() {
    val repository by lazy { HarnessRepository(DeviceStore(this)) }
    /** Started by the activity (or a token change), not by every push: a push alone must not open every backend's socket. */
    val notifications by lazy { NotificationCenter(repository, FirebasePush, "${Build.MODEL} · Android app").also { started = it } }
    @Volatile private var started: NotificationCenter? = null
    val notificationsIfStarted: NotificationCenter? get() = started

    override fun onCreate() {
        super.onCreate()
        FirebasePush.initialize(this)
        // Starts reading the chats' saved drafts, so the first chat opened restores its draft at once.
        com.mihaisaru.harness.data.DraftCache.of(this)
        ensureNotificationChannels(this)
    }
}
