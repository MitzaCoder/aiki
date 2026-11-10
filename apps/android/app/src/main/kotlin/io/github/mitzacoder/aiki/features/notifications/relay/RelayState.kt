package io.github.mitzacoder.aiki.features.notifications.relay

import kotlinx.serialization.Serializable

/** Persisted enrollment phase; confirmation carries the received nonce across process death. */
@Serializable
data class RelayEnrollment(
    val operationId: String,
    val token: String,
    val replacing: Boolean,
    val phase: Phase = Phase.Begin,
    val deadline: Long,
    val challengeId: String? = null,
    val nonce: String? = null,
) {
    @Serializable
    /** Durable enrollment checkpoints; Confirm retains the received nonce for an idempotent retry. */
    enum class Phase { Begin, Waiting, Confirm }
    override fun toString(): String = "RelayEnrollment($phase)"
}

/** Authenticated backend time advances only with elapsed realtime in the same boot. */
@Serializable
data class RelayClock(val backendAt: Long, val elapsedAt: Long, val boot: String, val uncertaintyMs: Long = 0) {
    /** Null after reboot, backwards monotonic time or excessive RTT uncertainty. Wall time never drives expiry. */
    fun now(elapsed: Long, bootId: String): Long? = if (bootId == boot && elapsed >= elapsedAt &&
        uncertaintyMs in 0..10_000) backendAt + elapsed - elapsedAt else null
}

/** One local backend-session route. Secret-bearing records deliberately have content-free string representations. */
@Serializable
data class RelayRoute(
    val routeId: String,
    val keyId: String,
    val operationId: String,
    val backendId: String,
    val sessionId: String,
    val backendKey: String,
    val sendBearer: String? = null,
    val deleteBearer: String? = null,
    val privateKey: String? = null,
    val phonePublicKey: String,
    val salt: String,
    val notificationKey: String? = null,
    val phoneConfirmation: String? = null,
    val backendPublicKey: String? = null,
    val leaseExpiresAt: Long = 0,
    val absoluteExpiresAt: Long = 0,
    val phase: Phase = Phase.Staged,
    val predecessor: String? = null,
    val retireAt: Long? = null,
    val retiringElapsed: Long? = null,
    val retiringBoot: String? = null,
    val clock: RelayClock? = null,
    val label: String = "Android app",
    val registrationPreferences: io.github.mitzacoder.aiki.protocol.NotificationPreferences? = null,
    val backendDeviceId: String? = null,
    val syncedTokenGeneration: Long = 0,
) {
    @Serializable
    /** Confirming means agreed keys; Confirmed means relay-activated but backend confirmation may need retry. */
    enum class Phase { Staged, Created, Confirming, Confirmed, Active, Retiring }
    /** Identity is local and stable; never resolve it from envelope fields. */
    fun context(): RelayContext = RelayContext(backendId, sessionId, routeId, keyId)
    /** Shared admission key across predecessor/successor routes. */
    fun admissionId(): String = RelayCrypto.array(backendId, sessionId)
    override fun toString(): String = "RelayRoute($phase)"
}

/** Delete-only capabilities are retained separately from receive authority and survive local off/sign-out. */
@Serializable
data class RelayDeletion(val routeId: String, val bearer: String) {
    override fun toString(): String = "RelayDeletion"
}

/** Secret-free backend unregister retry, independent of the relay delete-only queue. */
@Serializable
data class RelayBackendDeletion(val backendKey: String, val backendId: String, val sessionId: String, val routeId: String) {
    override fun toString(): String = "RelayBackendDeletion"
}

/** Complete encrypted relay record; a missing installation means explicit opt-in is required. */
@Serializable
data class RelayState(
    val installationId: String? = null,
    val activeToken: String? = null,
    val tokenGeneration: Long = 0,
    val enrollment: RelayEnrollment? = null,
    val routes: Map<String, RelayRoute> = emptyMap(),
    val selectedBackends: Map<String, String> = emptyMap(),
    val admissions: Map<String, String> = emptyMap(),
    val deletions: List<RelayDeletion> = emptyList(),
    val backendDeletions: List<RelayBackendDeletion> = emptyList(),
    val counters: Map<String, Long> = emptyMap(),
    val failure: RelayErrorCode? = null,
    val retryAfterSeconds: Long? = null,
    val signedIn: Boolean = false,
) {
    /** Removes retired decrypt keys and their windows together, while preserving cross-key event dedupe. */
    fun retire(now: Long): RelayState {
        val expired = routes.values.filter { it.retireAt?.let { deadline -> now >= deadline } == true }
        val kept = routes - expired.map { it.routeId }.toSet()
        val nextAdmissions = admissions.mapValues { (_, serialized) ->
            val raw = RelayCrypto.obj(RelayCrypto.parse(serialized))
            val windows = RelayCrypto.obj(raw["windows"]) - expired.map { it.keyId }.toSet()
            kotlinx.serialization.json.JsonObject(raw + ("windows" to kotlinx.serialization.json.JsonObject(windows))).toString()
        }
        return copy(routes = kept, admissions = nextAdmissions)
    }
    /** Monotonic retirement also fails closed after reboot and wall-clock rollback. */
    fun retire(time: RelayTime): RelayState {
        val expired = routes.values.filter { route ->
            route.phase == RelayRoute.Phase.Retiring && (route.retiringBoot != time.boot() ||
                route.retiringElapsed == null || time.elapsed() < route.retiringElapsed ||
                time.elapsed() - route.retiringElapsed >= RelayCrypto.RETENTION_MS)
        }
        return copy(routes = routes.mapValues { (_, route) ->
            if (route in expired) route.copy(retireAt = 0) else route
        }).retire(time.wall())
    }
    override fun toString(): String = "RelayState"
}

/** Serialized clock inputs, injected in JVM tests and anchored to Android elapsedRealtime in the app. */
interface RelayTime {
    /** Relay challenge/lease management time, never used for notification expiry. */
    fun wall(): Long
    /** Elapsed realtime including sleep. */
    fun elapsed(): Long
    /** Boot identity makes every restored pre-reboot backend clock untrusted. */
    fun boot(): String
}
