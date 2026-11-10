package io.github.mitzacoder.aiki.features.notifications

import io.github.mitzacoder.aiki.data.ConnectionState
import io.github.mitzacoder.aiki.data.HarnessClient
import io.github.mitzacoder.aiki.data.request
import io.github.mitzacoder.aiki.features.notifications.relay.RelayNotifications
import io.github.mitzacoder.aiki.protocol.*

/** Existing direct registration RPCs, isolated so transport-choice regressions can assert exact requests. */
interface NotificationRegistrationRpc {
    /** Registers today's FCM token without contacting the relay or account. */
    suspend fun register(request: NotificationsRegisterFcmRequest): NotificationDevice
    /** Returns the public selected device, never credentials or route secrets. */
    suspend fun device(deviceId: String): NotificationDevice?
    /** Removes today's direct device when notifications are off. */
    suspend fun unregister(deviceId: String)
}

/** Reuses the application's existing socket for today's registration protocol. */
class HarnessNotificationRegistrationRpc(private val client: HarnessClient) : NotificationRegistrationRpc {
    override suspend fun register(request: NotificationsRegisterFcmRequest): NotificationDevice = client.request(request).device
    override suspend fun device(deviceId: String): NotificationDevice? =
        client.request(NotificationsDeviceRequest(deviceId = deviceId)).device
    override suspend fun unregister(deviceId: String) {
        client.request(NotificationsUnregisterRequest(deviceId = deviceId))
    }
}

/** Off is exactly the existing FCM registration branch. Relay selection is exclusive and cannot fall back on failure. */
suspend fun syncNotificationRegistration(settings: NotificationSettings, connection: ConnectionState,
    deviceId: String, backendKey: String, label: String, rpc: NotificationRegistrationRpc,
    relay: () -> RelayNotifications?): NotificationDevice? {
    if (settings.relayRecoveryRequired) return null
    val relayTransport = if (settings.relayEnabled) relay() else null
    if (relayTransport?.syncBackend(backendKey, connection, label) == true) {
        val relayDeviceId = relayTransport.deviceId(backendKey) ?: return null
        return rpc.device(relayDeviceId)
    }
    val token = settings.fcmToken
    if (settings.enabled && token != null && connection.supports("fcm-push")) {
        return rpc.register(NotificationsRegisterFcmRequest(deviceId = deviceId, label = label, backendKey = backendKey,
            token = token, preferences = settings.preferencesFor(backendKey)))
    }
    val existing = rpc.device(deviceId)
    return if (!settings.enabled && existing != null) {
        rpc.unregister(deviceId)
        null
    } else existing
}
