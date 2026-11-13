package io.github.mitzacoder.kemiri.features.notifications.relay

import io.github.mitzacoder.kemiri.protocol.NotificationPreferences
import io.github.mitzacoder.kemiri.data.ClientException
import java.security.KeyFactory
import java.security.spec.PKCS8EncodedKeySpec
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

/** Authenticated backend response; a fresh sync clock replaces the registration receipt's possibly old timestamp. */
class RelayBackendAgreement(val publicKey: String, val confirmation: String, val clock: RelayClock,
    val deviceId: String? = null) {
    override fun toString(): String = "RelayBackendAgreement"
}

/** Signed-in generated-RPC adapter; all operations are idempotent by durable operation/route identity. */
interface RelayBackendRegistration {
    /** Registration receives no Firebase account credential or FCM token. */
    suspend fun register(route: RelayRoute): RelayBackendAgreement
    /** Must run only after relay activation and durable local key storage. */
    suspend fun confirm(route: RelayRoute, phoneConfirmation: String)
    /** Fresh time, lease/preferences and optional explicit repair after a token replacement. */
    suspend fun sync(route: RelayRoute, resume: Boolean = false): RelayClock
    /** Best-effort remote unregister; local cleanup never depends on its success. */
    suspend fun unregister(deletion: RelayBackendDeletion)
}

/** Crash-resumable staging → registration → agreed keys → relay activation → backend confirmation. */
class RelayRoutes(
    private val storage: RelayStorage,
    private val api: RelayApi,
    private val backend: RelayBackendRegistration,
    private val time: RelayTime,
) {
    private val mutex = Mutex()

    /** Stages secrets before any request. A backend session has at most one pending successor. */
    suspend fun create(backendId: String, sessionId: String, backendKey: String, predecessor: String? = null,
        label: String = "Android app", preferences: NotificationPreferences? = null): String = mutex.withLock {
        val state = storage.read()
        check(state.signedIn && state.activeToken != null && !state.accountDisabled &&
            !state.accountDeleted && !state.accountDeletionPending) { "Relay installation is not enrolled" }
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
            salt = RelayCrypto.newSecret(), predecessor = predecessor, label = label, registrationPreferences = preferences)
        storage.update {
            check(it.signedIn && it.installationId == state.installationId) { "Relay installation signed out" }
            it.copy(routes = it.routes + (id to route), selectedBackends = it.selectedBackends + (backendKey to sessionId))
        }
        resumeRoute(id)
        id
    }

    /** Launch/foreground maintenance resumes interrupted work, renews under seven days and retries cleanup. */
    suspend fun maintain(backendKey: String? = null) = mutex.withLock {
        cleanup()
        val state = storage.read()
        if (!state.signedIn || state.activeToken == null || state.accountDisabled ||
            state.accountDeleted || state.accountDeletionPending) return@withLock
        for (route in state.routes.values.filter { backendKey == null || it.backendKey == backendKey }) {
            try { resumeRoute(route.routeId) }
            catch (error: CancellationException) { throw error }
            catch (error: RelayException) {
                if (error.code in setOf("identity", "confirmation", "invalid")) remove(route.routeId)
                else throw error
            }
        }
        for (original in storage.read().routes.values.filter { it.phase == RelayRoute.Phase.Active &&
            (backendKey == null || it.backendKey == backendKey) }) {
            var route = original
            if (route.leaseExpiresAt - time.wall() < RENEW_MS) {
                when (val result = api.renew(requireNotNull(state.installationId), route.routeId)) {
                    is RelayResult.Failure -> failure(result)
                    is RelayResult.Success -> {
                        route = route.copy(leaseExpiresAt = result.value.leaseExpiresAt,
                            absoluteExpiresAt = result.value.absoluteExpiresAt)
                        save(route)
                    }
                }
            }
            val clock = backend.sync(route, state.tokenGeneration > route.syncedTokenGeneration)
            save(route.copy(clock = clock, syncedTokenGeneration = state.tokenGeneration))
        }
        storage.update { it.retire(time) }
    }

    private suspend fun resumeRoute(id: String) {
        val state = storage.read()
        if (!state.signedIn) return
        val installation = state.installationId ?: return
        var route = state.routes[id] ?: return
        if (route.phase in setOf(RelayRoute.Phase.Retiring, RelayRoute.Phase.Active)) return
        if (route.phase == RelayRoute.Phase.Staged) {
            when (val result = api.create(installation, route)) {
                is RelayResult.Failure -> {
                    failure(result)
                    return
                }
                is RelayResult.Success -> {
                    check(result.value.routeId == id) { "Invalid relay route" }
                    route = route.copy(phase = RelayRoute.Phase.Created, leaseExpiresAt = result.value.leaseExpiresAt,
                        absoluteExpiresAt = result.value.absoluteExpiresAt)
                    save(route)
                }
            }
        }
        if (route.phase == RelayRoute.Phase.Created) {
            try {
                val agreement = backend.register(route)
                val privateKey = KeyFactory.getInstance("EC").generatePrivate(
                    PKCS8EncodedKeySpec(RelayCrypto.unbase64(requireNotNull(route.privateKey))))
                val keys = RelayCrypto.deriveKeys(RelayCrypto.sharedSecret(privateKey, agreement.publicKey), route.salt, route.context())
                val transcript = RelayCrypto.transcript(route.context(), route.salt, route.phonePublicKey, agreement.publicKey)
                RelayCrypto.verifyConfirmation(keys.getValue("backend-confirm"), transcript, agreement.confirmation)
                route = route.copy(phase = RelayRoute.Phase.Confirming, backendPublicKey = agreement.publicKey,
                    notificationKey = RelayCrypto.base64(keys.getValue("notification")), clock = agreement.clock,
                    backendDeviceId = agreement.deviceId,
                    phoneConfirmation = RelayCrypto.confirmation(keys.getValue("phone-confirm"), transcript))
                save(route)
            } catch (error: RelayException) {
                remove(id)
                throw error
            } catch (error: ClientException) {
                if (error.code in setOf("unknown_request", "bad_request", "auth_required", "auth_revoked")) remove(id)
                throw error
            }
        }
        if (!stillSelected(id)) return
        if (route.phase == RelayRoute.Phase.Confirming) {
            when (val result = api.activate(installation, id)) {
                is RelayResult.Failure -> {
                    failure(result)
                    return
                }
                is RelayResult.Success -> {
                    check(result.value.routeId == id) { "Invalid relay route" }
                    route = route.copy(phase = RelayRoute.Phase.Confirmed, leaseExpiresAt = result.value.leaseExpiresAt,
                        absoluteExpiresAt = result.value.absoluteExpiresAt)
                    activatedAtRelay(route)
                }
            }
        }
        if (!stillSelected(id)) return
        if (route.phase == RelayRoute.Phase.Confirmed) {
            try { backend.confirm(route, requireNotNull(route.phoneConfirmation)) }
            catch (error: ClientException) {
                if (error.code in setOf("unknown_request", "bad_request", "auth_required", "auth_revoked")) remove(id)
                throw error
            }
            val activated = route.copy(phase = RelayRoute.Phase.Active, privateKey = null, sendBearer = null,
                phoneConfirmation = null, syncedTokenGeneration = state.tokenGeneration)
            save(activated)
        }
    }

    private suspend fun activatedAtRelay(route: RelayRoute) {
        storage.update { previous ->
            if (!previous.signedIn || route.routeId !in previous.routes) return@update previous
            val predecessor = route.predecessor?.let { previous.routes[it] }
            val routes = previous.routes.toMutableMap()
            routes[route.routeId] = route
            if (predecessor != null && predecessor.phase != RelayRoute.Phase.Retiring) {
                routes[predecessor.routeId] = predecessor.copy(phase = RelayRoute.Phase.Retiring,
                    retireAt = time.wall() + RelayCrypto.RETENTION_MS, retiringElapsed = time.elapsed(), retiringBoot = time.boot())
            }
            previous.copy(routes = routes, deletions = (previous.deletions + listOfNotNull(
                predecessor?.deleteBearer?.let { RelayDeletion(predecessor.routeId, it) })).distinctBy { it.routeId })
        }
    }

    private suspend fun stillSelected(id: String): Boolean = storage.read().let { it.signedIn && id in it.routes }

    /** Local receive removal is immediate and never waits behind an in-flight network operation. */
    suspend fun remove(routeId: String) {
        storage.update { state ->
            val route = state.routes[routeId]
            state.copy(routes = state.routes - routeId, deletions = (state.deletions + listOfNotNull(
                route?.deleteBearer?.let { RelayDeletion(routeId, it) })).distinctBy { it.routeId },
                backendDeletions = (state.backendDeletions + listOfNotNull(route?.let {
                    RelayBackendDeletion(it.backendKey, it.backendId, it.sessionId, it.routeId)
                })).distinctBy { it.routeId })
        }
    }

    /** Removes one backend's local routes, leaving durable unregister/delete-only queues. */
    suspend fun removeBackend(backendKey: String) {
        storage.update { state -> removed(state, state.routes.values.filter { it.backendKey == backendKey }) }
    }

    private fun removed(state: RelayState, routes: Collection<RelayRoute>): RelayState = state.copy(
        routes = state.routes - routes.map { it.routeId }.toSet(),
        deletions = (state.deletions + routes.mapNotNull { route ->
            route.deleteBearer?.let { RelayDeletion(route.routeId, it) }
        }).distinctBy { it.routeId },
        backendDeletions = (state.backendDeletions + routes.map {
            RelayBackendDeletion(it.backendKey, it.backendId, it.sessionId, it.routeId)
        }).distinctBy { it.routeId },
    )

    /** Explicit push opt-out keeps the same enrolled installation so repeated toggles cannot consume phone slots. */
    suspend fun turnOff() {
        storage.update { state ->
            removed(state, state.routes.values).copy(enrollment = null, signedIn = false)
        }
    }

    /** Sign-out discards decrypt/enrollment authority and keeps only cleanup work and downgrade pins. */
    suspend fun signOut() {
        storage.update { state ->
            val removed = removed(state, state.routes.values)
            RelayState(deletions = removed.deletions, backendDeletions = removed.backendDeletions,
                counters = state.counters, selectedBackends = state.selectedBackends)
        }
    }

    /** Remote cleanup is independent of local revocation and survives unavailable accounts/backends. */
    suspend fun cleanupBackend() {
        for (deletion in storage.read().backendDeletions) {
            try {
                backend.unregister(deletion)
                storage.update { it.copy(backendDeletions = it.backendDeletions.filterNot { d -> d.routeId == deletion.routeId }) }
            } catch (error: CancellationException) { throw error }
            catch (_: Exception) { /* Retry on next signed-in connection; relay delete does not depend on this. */ }
        }
    }

    /** Retried only on explicit opt-in maintenance; no relay HTTP while the setting is off. */
    suspend fun cleanup() {
        cleanupBackend()
        for (deletion in storage.read().deletions) {
            when (val result = api.revoke(deletion)) {
                is RelayResult.Success -> storage.update { it.copy(deletions = it.deletions.filterNot { d -> d.routeId == deletion.routeId }) }
                is RelayResult.Failure -> failure(result)
            }
        }
    }

    private suspend fun save(route: RelayRoute) {
        storage.update { state ->
            if (!state.signedIn || route.routeId !in state.routes) state
            else state.copy(routes = state.routes + (route.routeId to route))
        }
    }
    private suspend fun failure(result: RelayResult.Failure) {
        storage.update { it.copy(failure = result.code, retryAfterSeconds = result.retryAfterSeconds) }
    }

    companion object {
        const val RENEW_MS = 7 * 24 * 60 * 60 * 1000L
    }
}
