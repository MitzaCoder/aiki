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
    private val accountStopped: suspend () -> Unit = {},
) {
    private val store by lazy(storage)
    private val client by lazy { RelayAccountAwareApi(api(), store) }
    private val clock = time
    private val mutableRevision = kotlinx.coroutines.flow.MutableStateFlow(0L)
    val revision: kotlinx.coroutines.flow.StateFlow<Long> get() = mutableRevision
    val enrollment by lazy { RelayEnrollmentMachine(store, client, time) { mutableRevision.value++ } }
    val accounts by lazy { RelayAccounts(store, client) }
    val routes by lazy { RelayRoutes(store, client, backend(), time) }
    @Volatile private var checkingPhone = false
    private val router = RelayMessageRouter({ settings().relayEnabled || checkingPhone }, { store }, time,
        { enrollment.challenge(it) }, present, storageLost)

    /** Explicit, cancellable setup accepts challenges while keeping the persisted relay switch off. */
    suspend fun checkPhone(token: String) {
        checkingPhone = true
        enrollment.enable(token)
    }

    /** Cancelling setup discards receive authority before the screen leaves. */
    suspend fun cancelPhoneCheck() {
        if (!checkingPhone) return
        checkingPhone = false
        routes.turnOff()
    }

    /** Confirmed setup can now be represented by the persistent switch. */
    fun finishPhoneCheck() { checkingPhone = false }

    /** Settings-only snapshot; callers must first obtain explicit opt-in. */
    suspend fun snapshot(): RelayState = store.read()

    /** Account inventory is never fetched by the default-off row. */
    suspend fun phones(): RelayResult<List<RelayInstallation>> = client.installations()

    /** Removing a remote phone never touches backend sign-in. */
    suspend fun removePhone(id: String): RelayResult<Unit> = client.deleteInstallation(id)

    /** Best-effort removal of this installation precedes local Auth sign-out. */
    suspend fun removeThisPhone(): RelayResult<Unit> {
        val id = store.read().installationId
        routes.signOut()
        return if (id != null) client.deleteInstallation(id) else RelayResult.Success(Unit)
    }

    /** Shares the existing parser/presenter with direct FCM, including the complete no-relay path. */
    suspend fun receive(message: Map<String, String>) {
        if (settings().relayRecoveryRequired) return
        router.receive(message)
    }

    /** A relay-selected backend cannot be overwritten by today's direct-token registration sync. */
    suspend fun selected(backendKey: String): Boolean {
        if (!settings().relayEnabled) return false
        return backendKey in store.read().selectedBackends
    }

    /** Selects exactly one transport per eligible signed-in backend session; unsupported backends remain direct. */
    suspend fun syncBackend(backendKey: String, connection: io.github.mitzacoder.aiki.data.ConnectionState,
        label: String): Boolean {
        val current = settings()
        if (!current.relayEnabled) return false
        if (!relayBackendEligible(connection)) return selected(backendKey)
        val state = store.read()
        if (!state.signedIn || state.activeToken == null || state.accountDisabled || state.accountDeletionPending ||
            state.accountDeleted) return true
        val backendId = requireNotNull(connection.hello?.backendId)
        val sessionId = requireNotNull(connection.hello?.auth?.sessionId)
        for (old in state.routes.values.filter { it.backendKey == backendKey &&
            (it.backendId != backendId || it.sessionId != sessionId) }) routes.remove(old.routeId)
        val expired = state.routes.values.filter { it.backendKey == backendKey && it.absoluteExpiresAt > 0 &&
            it.absoluteExpiresAt <= clock.wall() }
        for (old in expired) routes.remove(old.routeId)
        val beforeMaintenance = store.read().routes.values.firstOrNull { it.backendKey == backendKey &&
            it.phase == RelayRoute.Phase.Active }
        if (beforeMaintenance != null && beforeMaintenance.absoluteExpiresAt - clock.wall() < RelayRoutes.RENEW_MS) {
            routes.create(backendId, sessionId, backendKey, beforeMaintenance.routeId, label, current.preferencesFor(backendKey))
        }
        routes.maintain(backendKey)
        val existing = store.read().routes.values.filter { it.backendKey == backendKey &&
            it.backendId == backendId && it.sessionId == sessionId && it.phase != RelayRoute.Phase.Retiring }
        val active = existing.singleOrNull { it.phase == RelayRoute.Phase.Active }
        if (existing.isEmpty() || (active != null && active.absoluteExpiresAt - clock.wall() < RelayRoutes.RENEW_MS)) {
            routes.create(backendId, sessionId, backendKey, active?.routeId, label, current.preferencesFor(backendKey))
        }
        return true
    }

    /** Backend removal/session sign-out needs only local storage; caller may schedule remote cleanup separately. */
    suspend fun removeBackend(backendKey: String) {
        if (!settings().relayEnabled) return
        routes.removeBackend(backendKey)
    }

    /** The server-returned relay device ID belongs to the selected session, not the legacy app-global device ID. */
    suspend fun deviceId(backendKey: String): String? {
        if (!settings().relayEnabled) return null
        return store.read().routes.values.firstOrNull { it.backendKey == backendKey &&
            it.phase in setOf(RelayRoute.Phase.Active, RelayRoute.Phase.Confirmed) }?.backendDeviceId
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
        accounts.status()
        val account = store.read()
        if (!account.signedIn || account.accountDeleted || account.accountDisabled || account.accountDeletionPending) {
            accountStopped()
            return
        }
        val token = current.fcmToken
        if (token != null) enrollment.tokenChanged(token) else enrollment.resume()
        routes.maintain()
    }
}
