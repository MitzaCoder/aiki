package io.github.mitzacoder.aiki.features.notifications

import io.github.mitzacoder.aiki.data.*
import io.github.mitzacoder.aiki.protocol.*
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.*

/**
 * Whether this app is open: the web's page visibility (the activity is started), plus the route's project, for
 * `notifications.presence`. A visible app makes each backend hold its pushes for 15 s unless the user interacts.
 */
data class AppPresence(val visible: Boolean = false, val backendKey: String? = null, val projectId: String? = null) {
    /** The project this backend's connection reports: only the backend on screen sees one. */
    fun projectOn(backendKey: String): String? = projectId.takeIf { this.backendKey == backendKey }
}

/** What one backend says about this device's notifications. */
data class BackendPushState(
    val connected: Boolean = false,
    val supportsNotifications: Boolean = false,
    val supportsFcm: Boolean = false,
    val supportsRelay: Boolean = false,
    /** Whether `notifications.config` answered on this connection. */
    val configRead: Boolean = false,
    /** The Firebase project the backend sends through; null when FCM is off there (no service-account key). */
    val fcmProjectId: String? = null,
    val device: NotificationDevice? = null,
    val error: String? = null,
)

/**
 * This device's notifications on every backend: registers the FCM token with each backend that has `fcm-push` (again on
 * every reconnect, token rotation and preference change), unregisters when the user turns push off, and reports presence
 * on every connection that has `notifications`. With the app open a backend holds a push for 15 s; [interacted] (called
 * for touches, keys, scrolls and typing) tells every connected backend to drop what it holds (feature `notification-hold`).
 */
class NotificationCenter(
    private val repository: HarnessRepository,
    private val tokens: PushTokens,
    private val label: String,
    private val scope: CoroutineScope = CoroutineScope(SupervisorJob() + Dispatchers.IO),
    private val relay: () -> io.github.mitzacoder.aiki.features.notifications.relay.RelayNotifications? = { null },
) {
    /** Throttled: the first interaction goes out at once, a burst becomes one trailing message every 5 s. */
    private val interactions = InteractionReporter(
        schedule = { delayMs, run -> val job = scope.launch { delay(delayMs); run() }; { job.cancel() } },
        send = ::sendInteraction,
    )
    private val mutablePresence = MutableStateFlow(AppPresence())
    val presence = mutablePresence.asStateFlow()
    private val mutableStates = MutableStateFlow<Map<String, BackendPushState>>(emptyMap())
    val states = mutableStates.asStateFlow()
    val pushUnavailableReason: String? get() = tokens.unavailableReason
    val appFirebaseProject: String? get() = tokens.projectId

    init {
        repository.notificationCleanup = { key ->
            if (repository.settings.value.notifications.relayEnabled) {
                relay()?.removeBackend(key)
                scope.launch { runCatching { relay()?.routes?.cleanupBackend() } }
            }
        }
        scope.launch {
            repository.loaded.first { it }
            val stored = repository.settings.value.notifications
            if (stored.migrated() != stored) repository.setNotifications { it.migrated() }
            // Firebase may have rotated the token while the app was not running; the service is told only while it is.
            if (stored.enabled && tokens.unavailableReason == null) refreshToken()
        }
        scope.launch {
            repository.sessions.collectLatest { sessions ->
                mutableStates.update { states -> states.filterKeys { key -> sessions.any { it.config.key == key } } }
                coroutineScope { sessions.forEach { session -> launch { watch(session) } } }
            }
        }
    }

    /** Whether this device mutes one project, as the header shows it. */
    fun mutedFlow(backendKey: String, projectId: String): Flow<Boolean> =
        repository.settings.map { it.notifications.isMuted(backendKey, projectId) }.distinctUntilChanged()

    /** [mutedFlow] with its current value, for the header's bell ([CenterProjectMute]). */
    fun mutedState(backendKey: String, projectId: String): StateFlow<Boolean> = mutedFlow(backendKey, projectId)
        .stateIn(scope, SharingStarted.WhileSubscribed(5_000), repository.settings.value.notifications.isMuted(backendKey, projectId))

    /** Mute or unmute one project; the header's bell calls this. */
    fun toggleMute(backendKey: String, projectId: String) {
        scope.launch { repository.setNotifications { it.withMuted(backendKey, projectId, !it.isMuted(backendKey, projectId)) } }
    }

    /** The user touched the app (a touch, a key, the wheel, typing). Cheap; safe from any thread. */
    fun interacted() = interactions.touch()

    /** Backends do not talk to each other, so each connected one that offers the hold hears it from this device. */
    private fun sendInteraction() {
        val deviceId = repository.settings.value.deviceId
        repository.sessions.value.forEach { session ->
            val connection = session.client.state.value
            if (connection.status != ConnectionStatus.Ready || !connection.supports(NOTIFICATION_HOLD_FEATURE)) return@forEach
            scope.launch {
                try { session.client.request(NotificationsInteractionRequest(deviceId = deviceId)) }
                catch (error: CancellationException) { throw error }
                catch (_: Exception) { /* The next interaction reports again. */ }
            }
        }
    }

    fun setVisible(visible: Boolean) {
        mutablePresence.update { it.copy(visible = visible) }
        if (visible) scope.launch {
            repository.loaded.first { it }
            if (repository.settings.value.notifications.relayEnabled) runCatching { relay()?.foreground() }
        }
    }
    fun setScreen(backendKey: String?, projectId: String?) = mutablePresence.update { it.copy(backendKey = backendKey, projectId = projectId) }

    /** Turn push on: make sure there is a token; each backend then registers it. Returns why it could not, if so. */
    suspend fun enable(): String? {
        repository.setNotifications { it.copy(enabled = true) }
        return refreshToken()
    }

    /** Turn push off: every backend forgets this device, now or on its next connect, and the token is deleted. */
    suspend fun disable() {
        if (repository.settings.value.notifications.relayEnabled) {
            relay()?.routes?.turnOff()
            scope.launch { runCatching { relay()?.routes?.cleanupBackend() } }
        }
        repository.setNotifications { it.copy(enabled = false, fcmToken = null, relayEnabled = false) }
        runCatching { tokens.delete() }
    }

    /** Opt-out discards receive keys first and schedules backend unregister without delaying local settings. */
    suspend fun update(transform: (NotificationSettings) -> NotificationSettings) {
        val prior = repository.settings.value.notifications
        if (prior.relayEnabled && !transform(prior).relayEnabled) {
            relay()?.routes?.turnOff()
            scope.launch { runCatching { relay()?.routes?.cleanupBackend() } }
        }
        repository.setNotifications(transform)
    }

    /** Firebase rotated the token ([com.google.firebase.messaging.FirebaseMessagingService.onNewToken]). */
    fun tokenChanged(token: String) {
        scope.launch {
            repository.loaded.first { it }
            repository.setNotifications { it.copy(fcmToken = token) }
            if (repository.settings.value.notifications.relayEnabled) runCatching { relay()?.tokenChanged(token) }
        }
    }

    /** Push a test to this device from one backend and say what FCM answered (web `testNotificationText`). */
    suspend fun sendTest(backendKey: String): String {
        val session = repository.session(backendKey) ?: return "This backend is not connected."
        return try {
            val result = session.client.request(NotificationsTestRequest(deviceId = notificationDeviceId(backendKey)))
            refresh(session)
            if (repository.settings.value.notifications.relayEnabled && clientSupportsRelay(session)) {
                return if (result.ok) "The relay accepted the test. Android may still delay it."
                else io.github.mitzacoder.aiki.features.notifications.relay.relayProblemText(
                    io.github.mitzacoder.aiki.features.notifications.relay.RelayErrorCode.fromWire(result.message))
            }
            val status = result.status?.let { " ($it${result.message?.let { message -> " $message" }.orEmpty()})" } ?: result.message?.let { " ($it)" }.orEmpty()
            when {
                result.ok -> "FCM accepted it$status."
                result.status == 404L -> "FCM no longer knows this device$status. Turn notifications off and on to register again."
                else -> "It was not sent$status."
            }
        } catch (error: CancellationException) { throw error }
        catch (error: Exception) { error.message ?: "The test could not be sent." }
    }

    private fun clientSupportsRelay(session: BackendSession): Boolean = session.client.state.value.supports("fcm-relay-v1")

    private suspend fun refreshToken(): String? = try {
        val token = tokens.token()
        if (repository.settings.value.notifications.fcmToken != token) repository.setNotifications { it.copy(fcmToken = token) }
        if (repository.settings.value.notifications.relayEnabled) relay()?.tokenChanged(token)
        null
    } catch (error: CancellationException) { throw error }
    catch (error: Exception) { error.message ?: "Firebase gave no token." }

    private fun setState(key: String, transform: (BackendPushState) -> BackendPushState) =
        mutableStates.update { it + (key to transform(it[key] ?: BackendPushState())) }

    private suspend fun watch(session: BackendSession) {
        val key = session.config.key
        // Every connection starts over: the server forgot this socket's presence and may have restarted with another key.
        session.client.state.map { (it.status == ConnectionStatus.Ready) to it.hello }.distinctUntilChanged().collectLatest { (ready, _) ->
            val connection = session.client.state.value
            setState(key) { it.copy(connected = ready, supportsNotifications = connection.supports("notifications"), supportsFcm = connection.supports("fcm-push"), supportsRelay = connection.supports("fcm-relay-v1"), configRead = it.configRead && ready) }
            if (!ready || !connection.supports("notifications")) return@collectLatest
            coroutineScope {
                launch {
                    presence.map { it.visible to it.projectOn(key) }.distinctUntilChanged().collect { (visible, projectId) ->
                        try {
                            session.client.request(NotificationsPresenceRequest(deviceId = repository.settings.value.deviceId, visible = visible, projectId = projectId))
                        } catch (error: CancellationException) { throw error }
                        catch (_: Exception) { /* The next connection reports it again. */ }
                    }
                }
                launch {
                    repository.settings.map { it.deviceId to it.notifications }.distinctUntilChanged().collectLatest { (_, settings) ->
                        val selectedRelay = if (settings.relayEnabled) relay() else null
                        if (selectedRelay == null) sync(session)
                        else selectedRelay.revision.collect { sync(session) }
                    }
                }
            }
        }
    }

    /** Read this backend's config and registration and bring the registration in line with the settings. */
    private suspend fun sync(session: BackendSession) {
        val key = session.config.key
        val client = session.client
        val deviceId = repository.settings.value.deviceId
        val settings = repository.settings.value.notifications
        try {
            val config = client.request(NotificationsConfigRequest())
            setState(key) { it.copy(configRead = true, fcmProjectId = config.fcm?.projectId) }
            val device = syncNotificationRegistration(settings, client.state.value, deviceId, key, label,
                HarnessNotificationRegistrationRpc(client), relay)
            setState(key) { it.copy(device = device, error = null) }
        } catch (error: CancellationException) { throw error }
        catch (error: Exception) { setState(key) { it.copy(error = error.message ?: "Notifications could not be read.") } }
    }

    private suspend fun notificationDeviceId(backendKey: String): String =
        (if (repository.settings.value.notifications.relayEnabled) relay()?.deviceId(backendKey) else null)
            ?: repository.settings.value.deviceId

    private suspend fun refresh(session: BackendSession) {
        try {
            val device = session.client.request(NotificationsDeviceRequest(deviceId = notificationDeviceId(session.config.key))).device
            setState(session.config.key) { it.copy(device = device) }
        } catch (error: CancellationException) { throw error }
        catch (_: Exception) { }
    }

    /** Draw a push. The backend already held it while the app was open, so nothing is filtered here. */
    fun show(context: android.content.Context, payload: NotificationPayload) = showPushNotification(context, payload)
}

/** What a backend's card says: the status words and the detail line (web `backendNotificationView`, for FCM). */
data class BackendPushView(val label: String, val detail: String, val tone: Tone) { enum class Tone { Ok, Warn, Err, Muted } }

fun backendPushView(state: BackendPushState?, settings: NotificationSettings, appProject: String?, unavailable: String?): BackendPushView = when {
    state == null || !state.connected -> BackendPushView("Not connected", "Registers as soon as this backend is reachable.", BackendPushView.Tone.Muted)
    !state.supportsNotifications -> BackendPushView("No notifications", "This backend runs a release without notifications.", BackendPushView.Tone.Muted)
    settings.relayEnabled && state.supportsRelay -> when {
        state.error != null -> BackendPushView("Needs a refresh", "Reopen the relay settings to try again.", BackendPushView.Tone.Warn)
        state.device == null -> BackendPushView("Setting up", "Waiting for this backend and phone to finish setup.", BackendPushView.Tone.Muted)
        else -> BackendPushView("Working", relayLastAttemptText(state.device), BackendPushView.Tone.Ok)
    }
    !state.supportsFcm -> BackendPushView("No Android push", "This backend runs a release that cannot push to the Android app yet.", BackendPushView.Tone.Muted)
    state.error != null -> BackendPushView("Failed", state.error, BackendPushView.Tone.Err)
    unavailable != null -> BackendPushView("Unavailable", unavailable, BackendPushView.Tone.Muted)
    !settings.enabled -> BackendPushView("Off", "Notifications are off on this device. Turn them on to be told about this backend.", BackendPushView.Tone.Muted)
    state.configRead && state.fcmProjectId == null -> BackendPushView("FCM off", "This backend has no Firebase service-account key, so it cannot push to Android. Put the key in its data directory (notifications/fcm-service-account.json) and restart it.", BackendPushView.Tone.Warn)
    state.fcmProjectId != null && appProject != null && state.fcmProjectId != appProject -> BackendPushView("Project mismatch", "This backend sends through Firebase project ${state.fcmProjectId}, but this app belongs to $appProject.", BackendPushView.Tone.Err)
    settings.fcmToken == null -> BackendPushView("Waiting for a token", "Firebase has not given this device a token yet.", BackendPushView.Tone.Warn)
    state.device == null -> BackendPushView("Not registered", "This device is not registered here yet.", BackendPushView.Tone.Warn)
    else -> BackendPushView("Registered", lastDeliveryText(state.device), BackendPushView.Tone.Ok)
}

/** Relay details never expose upstream wire codes or error text. */
fun relayLastAttemptText(device: NotificationDevice): String {
    val delivery = device.lastDelivery ?: return "No notification attempt yet."
    val at = runCatching {
        java.time.format.DateTimeFormatter.ofLocalizedDateTime(java.time.format.FormatStyle.SHORT)
            .format(java.time.Instant.parse(delivery.at).atZone(java.time.ZoneId.systemDefault()))
    }.getOrNull()
    val outcome = if (delivery.ok) "accepted" else "delayed"
    return if (at == null) "Last attempt $outcome." else "Last attempt $outcome $at."
}

/** The last push in words (web `lastDeliveryText`). */
fun lastDeliveryText(device: NotificationDevice): String {
    val delivery = device.lastDelivery ?: return "Registered; nothing pushed yet."
    val at = runCatching {
        java.time.format.DateTimeFormatter.ofLocalizedDateTime(java.time.format.FormatStyle.SHORT)
            .format(java.time.Instant.parse(delivery.at).atZone(java.time.ZoneId.systemDefault()))
    }.getOrDefault(delivery.at)
    if (delivery.ok) return if (delivery.status == null) "Last push accepted $at." else "Last push accepted $at (${delivery.status})."
    val answer = delivery.status?.let { " ($it)" }.orEmpty()
    val reason = delivery.message?.let { ": $it" }.orEmpty()
    return "Last push failed $at$answer$reason."
}
