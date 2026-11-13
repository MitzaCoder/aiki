package io.github.mitzacoder.kemiri.features.notifications.relay

import io.github.mitzacoder.kemiri.data.ConnectionState
import io.github.mitzacoder.kemiri.data.ConnectionStatus
import io.github.mitzacoder.kemiri.data.HarnessClient
import io.github.mitzacoder.kemiri.data.ClientException
import io.github.mitzacoder.kemiri.data.request
import io.github.mitzacoder.kemiri.protocol.*

/** Narrow generated-RPC port permits real protocol-shape tests without another socket or Firebase account. */
interface RelayBackendRpc {
    val connection: ConnectionState
    suspend fun register(request: NotificationsRegisterRelayRequest): NotificationsRegisterRelayResponse
    suspend fun confirm(request: NotificationsConfirmRelayRequest): NotificationsConfirmRelayResponse
    suspend fun sync(request: NotificationsSyncRelayRequest): NotificationsSyncRelayResponse
}

/** Reuses the application's existing signed-in backend socket. Never creates a second connection. */
class HarnessRelayBackendRpc(private val client: HarnessClient) : RelayBackendRpc {
    override val connection: ConnectionState get() = client.state.value
    override suspend fun register(request: NotificationsRegisterRelayRequest) = client.request(request)
    override suspend fun confirm(request: NotificationsConfirmRelayRequest) = client.request(request)
    override suspend fun sync(request: NotificationsSyncRelayRequest) = client.request(request)
}

/** True only for a ready connection advertising both features and an actual authenticated caller session. */
fun relayBackendEligible(connection: ConnectionState): Boolean =
    connection.status == ConnectionStatus.Ready && connection.supports("fcm-relay-v1") &&
        connection.supports("device-auth-v1") && !connection.hello?.backendId.isNullOrBlank() &&
        !connection.hello?.auth?.sessionId.isNullOrBlank()

/** Exact generated backend requests, checked local identities, fresh midpoint clock anchors and bounded RTT trust. */
class RelayBackendAdapter(
    private val enabled: suspend () -> Boolean,
    private val clients: (String) -> RelayBackendRpc?,
    private val preferences: suspend (String) -> NotificationPreferences,
    private val time: RelayTime,
) : RelayBackendRegistration {
    private suspend fun client(backendKey: String, backendId: String, sessionId: String,
        cleanup: Boolean = false): RelayBackendRpc {
        val rpc = clients(backendKey)
        if ((!cleanup && !enabled()) || rpc == null || !relayBackendEligible(rpc.connection)) {
            throw ClientException("unsupported_feature", "Relay backend unavailable")
        }
        if (rpc.connection.hello?.backendId != backendId || rpc.connection.hello?.auth?.sessionId != sessionId) {
            reject("identity")
        }
        return rpc
    }

    override suspend fun register(route: RelayRoute): RelayBackendAgreement {
        val rpc = client(route.backendKey, route.backendId, route.sessionId)
        val answer = rpc.register(NotificationsRegisterRelayRequest(
            operationId = route.operationId, routeId = route.routeId, keyId = route.keyId,
            sendBearer = requireNotNull(route.sendBearer), deleteBearer = requireNotNull(route.deleteBearer),
            leaseExpiresAt = route.leaseExpiresAt, absoluteExpiresAt = route.absoluteExpiresAt,
            phonePublicKey = route.phonePublicKey, salt = route.salt, label = route.label, backendKey = route.backendKey,
            preferences = requireNotNull(route.registrationPreferences), predecessorRouteId = route.predecessor,
        ))
        if (answer.backendId != route.backendId || answer.sessionId != route.sessionId) reject("identity")
        // Registration receipts keep their ORIGINAL serverTime. Always sync for a fresh anchor, including retries.
        val clock = sync(route, false)
        return RelayBackendAgreement(answer.backendPublicKey, answer.confirmation, clock, answer.deviceId)
    }

    override suspend fun confirm(route: RelayRoute, phoneConfirmation: String) {
        client(route.backendKey, route.backendId, route.sessionId).confirm(
            NotificationsConfirmRelayRequest(operationId = route.operationId, confirmation = phoneConfirmation))
    }

    override suspend fun sync(route: RelayRoute, resume: Boolean): RelayClock {
        val rpc = client(route.backendKey, route.backendId, route.sessionId)
        val start = time.elapsed()
        val answer = rpc.sync(NotificationsSyncRelayRequest(routeId = route.routeId,
            leaseExpiresAt = route.leaseExpiresAt, preferences = preferences(route.backendKey),
            resume = true.takeIf { resume }))
        val end = time.elapsed()
        val roundTrip = end - start
        if (roundTrip < 0 || roundTrip > 20_000) reject("clock")
        return RelayClock(answer.serverTime + roundTrip / 2, end, time.boot(), (roundTrip + 1) / 2)
    }

    override suspend fun unregister(deletion: RelayBackendDeletion) {
        client(deletion.backendKey, deletion.backendId, deletion.sessionId, cleanup = true).sync(
            NotificationsSyncRelayRequest(routeId = deletion.routeId, unregister = true))
    }
}
