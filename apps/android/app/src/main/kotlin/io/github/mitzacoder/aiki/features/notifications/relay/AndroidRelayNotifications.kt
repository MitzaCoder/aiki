package io.github.mitzacoder.aiki.features.notifications.relay

import android.content.Context
import android.os.SystemClock
import android.provider.Settings
import io.github.mitzacoder.aiki.BuildConfig
import io.github.mitzacoder.aiki.data.DeviceStore
import io.github.mitzacoder.aiki.features.notifications.showPushNotification

/** Android-only composition; no Keystore, relay file, account or network is touched until explicit opt-in. */
fun androidRelayNotifications(context: Context, storageLost: suspend () -> Unit): RelayNotifications {
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
        // Real Firebase Auth and signed-in backend RPC adapters arrive in the next tasks. No Firebase Auth dependency.
        api = { RelayClient(RelayEndpoint(BuildConfig.PUSH_RELAY_URL, BuildConfig.DEBUG), RelayAccount { null }) },
        backend = { object : RelayBackendRegistration {
            override suspend fun register(route: RelayRoute): RelayBackendAgreement = error("Relay backend adapter unavailable")
            override suspend fun confirm(route: RelayRoute, phoneConfirmation: String) = error("Relay backend adapter unavailable")
            override suspend fun activated(route: RelayRoute) = error("Relay backend adapter unavailable")
        } },
        time = time,
        present = { showPushNotification(app, it) },
        storageLost = storageLost,
    )
}
