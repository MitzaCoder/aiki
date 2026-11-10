package io.github.mitzacoder.aiki.features.notifications.relay

import io.github.mitzacoder.aiki.features.notifications.parseNotificationPayload
import io.github.mitzacoder.aiki.protocol.NotificationPayload
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.json.*

/**
 * Pure receive boundary shared by FCM and debug delivery. Off never evaluates relay storage or challenge ports.
 * AEAD, local identity, trusted clock and durable replay admission must succeed before the existing presenter runs.
 */
class RelayMessageRouter(
    private val enabled: suspend () -> Boolean,
    private val storage: () -> RelayStorage,
    private val time: RelayTime,
    private val challenge: suspend (String) -> Boolean,
    private val present: (NotificationPayload) -> Unit,
    private val storageLost: suspend () -> Unit = {},
) {
    private val mutex = Mutex()

    /** Unknown or attacker-controlled messages are silently dropped and counted with fixed local reasons only. */
    suspend fun receive(message: Map<String, String>) = mutex.withLock {
        if (!enabled()) {
            val payload = parseNotificationPayload(message["payload"]) ?: return@withLock
            present(payload)
            return@withLock
        }
        try {
            val store = storage()
            val state = store.read()
            if (state.failure == RelayErrorCode.StorageUnavailable) {
                storageLost()
                return@withLock
            }
            val encrypted = message["aiki"]
            if (encrypted == null) {
                val payload = parseNotificationPayload(message["payload"]) ?: return@withLock
                if (payload.backendKey in state.selectedBackends) {
                    count(store, "plaintext_downgrade")
                    return@withLock
                }
                present(payload)
                return@withLock
            }
            RelayCrypto.checkSize(encrypted, RelayCrypto.FCM_DATA_CAP)
            val raw = RelayCrypto.obj(RelayCrypto.parse(encrypted))
            if (raw["type"] == JsonPrimitive("challenge")) {
                if (!challenge(encrypted)) count(store, "challenge")
                return@withLock
            }
            val envelope = RelayCrypto.parseEnvelope(encrypted)
            var payloadJson: JsonObject? = null
            store.update { previous ->
                val local = previous.retire(time)
                if (!local.signedIn || local.accountDeleted || local.accountDeletionPending) reject("signed_out")
                if (local.accountDisabled) reject("account_disabled")
                val route = local.routes[envelope.r] ?: reject("unknown_route")
                if (route.phase !in setOf(RelayRoute.Phase.Active, RelayRoute.Phase.Retiring,
                    RelayRoute.Phase.Confirmed)) reject("inactive_route")
                if (route.keyId != envelope.k) reject("route")
                val key = route.notificationKey ?: reject("inactive_route")
                val plaintext = RelayCrypto.decrypt(RelayCrypto.unbase64(key, 32), route.context(), encrypted)
                val backendNow = route.clock?.now(time.elapsed(), time.boot()) ?: reject("clock")
                val uncertainty = route.clock.uncertaintyMs
                if (plaintext.createdAt > backendNow + RelayCrypto.SKEW_MS - uncertainty) reject("clock")
                if (backendNow + uncertainty > plaintext.expiresAt + RelayCrypto.SKEW_MS) reject("expired")
                val admission = RelayAdmission(local.admissions[route.admissionId()])
                var admitted: String? = null
                admission.admit(route.keyId, plaintext, backendNow, { admitted = it })
                // This staged serialization is written atomically by update; no display occurs in this callback.
                payloadJson = JsonObject(plaintext.payload + ("backendKey" to JsonPrimitive(route.backendKey)))
                local.copy(admissions = local.admissions + (route.admissionId() to requireNotNull(admitted)),
                    counters = local.counters + ("accepted" to (local.counters.getOrDefault("accepted", 0) + 1)))
            }
            val payload = parseNotificationPayload(payloadJson?.toString())
            if (payload == null) count(store, "payload") else present(payload)
        } catch (error: CancellationException) { throw error }
        catch (error: RelayException) { safeCount(error.code) }
        catch (_: Exception) { safeCount("storage") }
    }

    private suspend fun count(store: RelayStorage, reason: String) {
        store.update { previous ->
            val local = previous.retire(time)
            local.copy(counters = local.counters + (reason to (local.counters.getOrDefault(reason, 0) + 1)))
        }
    }
    private suspend fun safeCount(reason: String) {
        try { count(storage(), reason) }
        catch (error: CancellationException) { throw error }
        catch (_: Exception) { /* Storage failure also fails closed; never show remote text as an error. */ }
    }
}
