package io.github.mitzacoder.aiki.features.notifications.relay

import io.github.mitzacoder.aiki.features.notifications.NotificationSettings
import io.github.mitzacoder.aiki.protocol.NotificationPayload

/**
 * Lazy opt-in boundary for receive, token callbacks and foreground maintenance. With relay off, factories are never
 * evaluated: no account call, relay network or relay DataStore file. The direct FCM token sync remains its caller's job.
 */
class RelayNotifications(
    private val settings: suspend () -> NotificationSettings,
    storage: () -> RelayStorage,
    api: () -> RelayApi,
    backend: () -> RelayBackendRegistration,
    time: RelayTime,
    present: (NotificationPayload) -> Unit,
    storageLost: suspend () -> Unit = {},
) {
    private val store by lazy(storage)
    private val client by lazy(api)
    val enrollment by lazy { RelayEnrollmentMachine(store, client, time) }
    val routes by lazy { RelayRoutes(store, client, backend(), time) }
    private val router = RelayMessageRouter({ settings().relayEnabled }, { store }, time,
        { enrollment.challenge(it) }, present, storageLost)

    /** Shares the existing parser/presenter with direct FCM, including the complete no-relay path. */
    suspend fun receive(message: Map<String, String>) = router.receive(message)

    /** A relay-selected backend cannot be overwritten by today's direct-token registration sync. */
    suspend fun selected(backendKey: String): Boolean {
        if (!settings().relayEnabled) return false
        return backendKey in store.read().selectedBackends
    }

    /** Both FCM callback forms converge here; the persisted operation deduplicates identical tokens. */
    suspend fun tokenChanged(token: String) {
        if (!settings().relayEnabled) return
        enrollment.tokenChanged(token)
    }

    /** Rechecks the token at launch and resumes interrupted maintenance without any background renewal promise. */
    suspend fun foreground() {
        val current = settings()
        if (!current.relayEnabled) return
        val token = current.fcmToken
        if (token != null) enrollment.tokenChanged(token) else enrollment.resume()
        routes.maintain()
    }
}
