package io.github.mitzacoder.aiki.features.notifications.relay

import java.security.KeyFactory
import java.security.spec.PKCS8EncodedKeySpec
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

/** Authenticated backend response; identities are fixed by the local signed-in connection, never caller labels. */
class RelayBackendAgreement(val publicKey: String, val confirmation: String, val clock: RelayClock) {
    override fun toString(): String = "RelayBackendAgreement"
}

/**
 * Signed-in backend adapter. Implementations must gate on device-auth-v1/fcm-relay-v1 and authenticated session,
 * validate route backend/session identity against that connection, and make all three methods idempotent by route ID.
 * Registration receives no Firebase account token or FCM token. The real generated RPC adapter is a follow-up task.
 */
interface RelayBackendRegistration {
    suspend fun register(route: RelayRoute): RelayBackendAgreement
    suspend fun confirm(route: RelayRoute, phoneConfirmation: String)
    suspend fun activated(route: RelayRoute)
}

/** Crash-resumable route staging, key agreement, activation, renewal, rotation and durable delete-only cleanup. */
class RelayRoutes(
    private val storage: RelayStorage,
    private val api: RelayApi,
    private val backend: RelayBackendRegistration,
    private val time: RelayTime,
) {
    private val mutex = Mutex()

    /** Stages secrets and private key before any request. One pending successor is allowed per backend session. */
    suspend fun create(backendId: String, sessionId: String, backendKey: String, predecessor: String? = null): String =
        mutex.withLock {
            val state = storage.read()
            check(state.signedIn && state.activeToken != null) { "Relay installation is not enrolled" }
            state.routes.values.firstOrNull { it.backendId == backendId && it.sessionId == sessionId &&
                it.phase !in setOf(RelayRoute.Phase.Active, RelayRoute.Phase.Retiring) }?.let { return@withLock it.routeId }
            val active = state.routes.values.singleOrNull { it.backendId == backendId && it.sessionId == sessionId &&
                it.phase == RelayRoute.Phase.Active }
            check(active?.routeId == predecessor) { "Relay rotation requires the active predecessor" }
            val pair = RelayCrypto.generateKeyPair()
            val id = RelayCrypto.newId()
            val route = RelayRoute(routeId = id, keyId = RelayCrypto.newId(), operationId = RelayCrypto.newId(),
                backendId = backendId, sessionId = sessionId, backendKey = backendKey,
                sendBearer = RelayCrypto.bearer("send", id), deleteBearer = RelayCrypto.bearer("delete", id),
                privateKey = RelayCrypto.base64(pair.private.encoded), phonePublicKey = RelayCrypto.exportPublicKey(pair.public),
                salt = RelayCrypto.newSecret(), predecessor = predecessor)
            storage.update { it.copy(routes = it.routes + (id to route),
                selectedBackends = it.selectedBackends + (backendKey to sessionId)) }
            resumeRoute(id)
            id
        }

    /** Foreground/launch maintenance resumes staged work, renews under seven days, and retries queued revocations. */
    suspend fun maintain() = mutex.withLock {
        cleanup()
        val state = storage.read()
        if (!state.signedIn || state.activeToken == null) return@withLock
        for (id in state.routes.keys) resumeRoute(id)
        for (route in storage.read().routes.values.filter { it.phase == RelayRoute.Phase.Active }) {
            if (route.leaseExpiresAt - time.wall() < RENEW_MS) {
                when (val result = api.renew(requireNotNull(state.installationId), route.routeId)) {
                    is RelayResult.Failure -> failure(result)
                    is RelayResult.Success -> save(route.copy(leaseExpiresAt = result.value.leaseExpiresAt,
                        absoluteExpiresAt = result.value.absoluteExpiresAt))
                }
            }
        }
        storage.update { it.retire(time) }
    }

    private suspend fun resumeRoute(id: String) {
        var state = storage.read()
        if (!state.signedIn) return
        val installation = state.installationId ?: return
        var route = state.routes[id] ?: return
        if (route.phase == RelayRoute.Phase.Retiring) return
        if (route.phase == RelayRoute.Phase.Staged) {
            when (val result = api.create(installation, route)) {
                is RelayResult.Failure -> { failure(result); return }
                is RelayResult.Success -> {
                    check(result.value.routeId == id) { "Invalid relay route" }
                    route = route.copy(phase = RelayRoute.Phase.Created, leaseExpiresAt = result.value.leaseExpiresAt,
                        absoluteExpiresAt = result.value.absoluteExpiresAt)
                    save(route)
                }
            }
        }
        if (route.phase == RelayRoute.Phase.Created) {
            val agreement = backend.register(route)
            val privateKey = KeyFactory.getInstance("EC").generatePrivate(
                PKCS8EncodedKeySpec(RelayCrypto.unbase64(requireNotNull(route.privateKey))))
            val keys = RelayCrypto.deriveKeys(RelayCrypto.sharedSecret(privateKey, agreement.publicKey), route.salt, route.context())
            val transcript = RelayCrypto.transcript(route.context(), route.salt, route.phonePublicKey, agreement.publicKey)
            RelayCrypto.verifyConfirmation(keys.getValue("backend-confirm"), transcript, agreement.confirmation)
            route = route.copy(phase = RelayRoute.Phase.Confirming, backendPublicKey = agreement.publicKey,
                notificationKey = RelayCrypto.base64(keys.getValue("notification")), clock = agreement.clock,
                phoneConfirmation = RelayCrypto.confirmation(keys.getValue("phone-confirm"), transcript))
            save(route)
        }
        if (route.phase == RelayRoute.Phase.Confirming) {
            backend.confirm(route, requireNotNull(route.phoneConfirmation))
            // The backend has durably taken the capabilities; the phone keeps delete-only authority for offline revoke.
            route = route.copy(phase = RelayRoute.Phase.Confirmed, privateKey = null, sendBearer = null,
                phoneConfirmation = null)
            save(route)
        }
        if (route.phase == RelayRoute.Phase.Confirmed) {
            when (val result = api.activate(installation, id)) {
                is RelayResult.Failure -> { failure(result); return }
                is RelayResult.Success -> {
                    check(result.value.routeId == id) { "Invalid relay route" }
                    route = route.copy(phase = RelayRoute.Phase.Active, leaseExpiresAt = result.value.leaseExpiresAt,
                        absoluteExpiresAt = result.value.absoluteExpiresAt)
                    val activated = route
                    storage.update { previous ->
                        if (!previous.signedIn || id !in previous.routes) return@update previous
                        val predecessor = activated.predecessor?.let { previous.routes[it] }
                        val routes = previous.routes.toMutableMap()
                        routes[id] = activated
                        if (predecessor != null) routes[predecessor.routeId] = predecessor.copy(
                            phase = RelayRoute.Phase.Retiring, retireAt = time.wall() + RelayCrypto.RETENTION_MS,
                            retiringElapsed = time.elapsed(), retiringBoot = time.boot())
                        previous.copy(routes = routes, deletions = (previous.deletions + listOfNotNull(
                            predecessor?.deleteBearer?.let { RelayDeletion(predecessor.routeId, it) })).distinctBy { it.routeId })
                    }
                }
            }
        }
        if (route.phase == RelayRoute.Phase.Active) backend.activated(route)
    }

    /** Local receive authority is removed durably before remote deletion; no network is required to turn off. */
    suspend fun remove(routeId: String) {
        storage.update { state ->
            val route = state.routes[routeId]
            state.copy(routes = state.routes - routeId, deletions = (state.deletions + listOfNotNull(
                route?.deleteBearer?.let { RelayDeletion(routeId, it) })).distinctBy { it.routeId })
        }
    }

    /** Sign-out clears every decrypt key and enrollment immediately but keeps only delete-only cleanup work. */
    suspend fun signOut() {
        storage.update { state -> RelayState(deletions = (state.deletions + state.routes.values.mapNotNull { route ->
            route.deleteBearer?.let { RelayDeletion(route.routeId, it) }
        }).distinctBy { it.routeId }, counters = state.counters, selectedBackends = state.selectedBackends) }
    }

    /** Explicit cleanup may run after sign-out using only delete capabilities, never account credentials. */
    suspend fun cleanup() {
        for (deletion in storage.read().deletions) {
            when (val result = api.revoke(deletion)) {
                is RelayResult.Success -> storage.update { it.copy(deletions = it.deletions.filterNot { d -> d.routeId == deletion.routeId }) }
                is RelayResult.Failure -> failure(result)
            }
        }
    }

    private suspend fun save(route: RelayRoute) {
        storage.update { state ->
            // Never resurrect a route removed while a network response was outstanding.
            if (!state.signedIn || route.routeId !in state.routes) state else state.copy(routes = state.routes + (route.routeId to route))
        }
    }
    private suspend fun failure(result: RelayResult.Failure) {
        storage.update { it.copy(failure = result.code, retryAfterSeconds = result.retryAfterSeconds) }
    }

    companion object {
        const val RENEW_MS = 7 * 24 * 60 * 60 * 1000L
    }
}
