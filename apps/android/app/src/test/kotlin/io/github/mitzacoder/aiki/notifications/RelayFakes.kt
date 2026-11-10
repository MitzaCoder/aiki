package io.github.mitzacoder.aiki.notifications

import io.github.mitzacoder.aiki.features.notifications.relay.*
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.json.*

internal class RelayMemoryStore(var state: RelayState = RelayState()) : RelayStorage {
    private val lock = Mutex()
    var failWrite = false
    var writes = 0
    override suspend fun read(): RelayState = state
    override suspend fun update(transform: (RelayState) -> RelayState): RelayState = lock.withLock {
        val next = transform(state)
        check(!failWrite) { "synthetic disk failure" }
        state = next
        writes++
        state
    }
    override suspend fun enable(): RelayState = update { it.copy(installationId = it.installationId ?: RelayCrypto.newId(), signedIn = true) }
}

internal class RelayFakeTime(var now: Long = 100_000, var monotonic: Long = 100, var bootId: String = "boot") : RelayTime {
    override fun wall(): Long = now
    override fun elapsed(): Long = monotonic
    override fun boot(): String = bootId
}

internal open class RelayFakeApi(private val time: RelayFakeTime) : RelayApi {
    var begins = 0
    var confirms = 0
    var creates = 0
    var activates = 0
    var renews = 0
    var revokes = 0
    var replacing = false
    var failure: RelayResult.Failure? = null
    var lostCreate = false
    var operationIds = mutableListOf<String>()
    var challengeId = RelayCrypto.newId()
    var staged: RelayRoute? = null
    override suspend fun accountStatus(): RelayResult<RelayAccountStatus> = RelayResult.Success(RelayAccountStatus("active", 1, 0, 3, 24))
    override suspend fun deleteAccount(operationId: String): RelayResult<RelayAccountDeletion> =
        failure ?: RelayResult.Success(RelayAccountDeletion(RelayDeletionState.Deleted))
    override suspend fun begin(installationId: String, operationId: String, token: String,
        replacing: Boolean): RelayResult<RelayChallengeReceipt> {
        begins++
        this.replacing = replacing
        operationIds.add(operationId)
        return failure ?: RelayResult.Success(RelayChallengeReceipt(challengeId, time.now + RelayEnrollmentMachine.CHALLENGE_MS))
    }
    override suspend fun confirm(installationId: String, operationId: String, challengeId: String, nonce: String,
        replacing: Boolean): RelayResult<RelayInstallationReceipt> {
        confirms++
        return failure ?: RelayResult.Success(RelayInstallationReceipt(installationId, 1))
    }
    override suspend fun installations(): RelayResult<List<RelayInstallation>> = RelayResult.Success(emptyList())
    override suspend fun deleteInstallation(installationId: String): RelayResult<Unit> = RelayResult.Success(Unit)
    override suspend fun create(installationId: String, route: RelayRoute): RelayResult<RelayRouteReceipt> {
        creates++
        staged = route
        return if (lostCreate) RelayResult.Failure(RelayErrorCode.Network) else failure ?: RelayResult.Success(receipt(route.routeId))
    }
    override suspend fun activate(installationId: String, routeId: String): RelayResult<RelayRouteReceipt> {
        activates++
        return failure ?: RelayResult.Success(receipt(routeId).copy(state = "active"))
    }
    override suspend fun renew(installationId: String, routeId: String): RelayResult<RelayRouteReceipt> {
        renews++
        return failure ?: RelayResult.Success(receipt(routeId).copy(state = "active"))
    }
    override suspend fun deleteRoute(installationId: String, routeId: String): RelayResult<Unit> = RelayResult.Success(Unit)
    override suspend fun revoke(deletion: RelayDeletion): RelayResult<Unit> {
        revokes++
        return failure ?: RelayResult.Success(Unit)
    }
    private fun receipt(id: String) = RelayRouteReceipt(id, "pending", time.now + 30 * 86400000L, time.now + 90 * 86400000L)
}

internal fun challenge(state: RelayState, id: String, time: RelayFakeTime): String = buildJsonObject {
    val operation = state.enrollment!!
    put("v", 1)
    put("type", "challenge")
    put("installationId", state.installationId)
    put("operationId", operation.operationId)
    put("challengeId", id)
    put("nonce", RelayCrypto.newSecret())
    put("deadline", operation.deadline)
}.toString()
