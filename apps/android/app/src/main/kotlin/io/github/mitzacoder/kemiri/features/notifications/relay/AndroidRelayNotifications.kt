package io.github.mitzacoder.kemiri.features.notifications.relay

import android.content.Context
import android.os.SystemClock
import android.provider.Settings
import io.github.mitzacoder.kemiri.BuildConfig
import io.github.mitzacoder.kemiri.data.DeviceStore
import io.github.mitzacoder.kemiri.features.notifications.showPushNotification

/** Android-only composition; no Keystore, relay file, account or network is touched until explicit opt-in. */
fun androidRelayNotifications(context: Context, account: () -> FirebaseRelayAccount, clients: (String) -> RelayBackendRpc?,
    storageLost: suspend () -> Unit): RelayNotifications {
    val app = context.applicationContext
    val uncertainBoot = RelayCrypto.newId()
    val time = object : RelayTime {
        override fun wall(): Long = System.currentTimeMillis()
        override fun elapsed(): Long = SystemClock.elapsedRealtime()
        override fun boot(): String = Settings.Global.getInt(app.contentResolver, Settings.Global.BOOT_COUNT, -1)
            .takeIf { it >= 0 }?.toString() ?: uncertainBoot
    }
    return RelayNotifications(
        settings = { DeviceStore(app).load().notifications },
        storage = { RelayStore(app) },
        api = { RelayClient(RelayEndpoint(BuildConfig.PUSH_RELAY_URL, BuildConfig.DEBUG), RelayAccount {
            account().apply { optIn() }.idToken()
        }) },
        backend = { RelayBackendAdapter(
            enabled = { DeviceStore(app).load().notifications.relayEnabled },
            clients = clients,
            preferences = { key -> DeviceStore(app).load().notifications.preferencesFor(key) },
            time = time,
        ) },
        time = time,
        present = { showPushNotification(app, it) },
        storageLost = storageLost,
        accountStopped = storageLost,
    )
}
