package io.github.mitzacoder.aiki.features.notifications.relay

/** Erases receive authority atomically while keeping secret-free backend cleanup and plaintext-downgrade pins. */
internal fun erasedRelayAccount(state: RelayState, deleted: Boolean): RelayState = RelayState(
    signedIn = !deleted && state.signedIn,
    counters = state.counters,
    selectedBackends = state.selectedBackends,
    deletions = if (deleted) emptyList() else (state.deletions + state.routes.values.mapNotNull { route ->
        route.deleteBearer?.let { RelayDeletion(route.routeId, it) }
    }).distinctBy { it.routeId },
    backendDeletions = (state.backendDeletions + state.routes.values.map {
        RelayBackendDeletion(it.backendKey, it.backendId, it.sessionId, it.routeId)
    }).distinctBy { it.routeId },
    accountDeleted = deleted,
    accountDeletionOperationId = state.accountDeletionOperationId,
    accountDeletionPending = !deleted,
    failure = if (deleted) RelayErrorCode.AccountDeleted else null,
)

/** Observes account revocation on every relay endpoint, not only explicit inventory or deletion requests. */
class RelayAccountAwareApi(private val delegate: RelayApi, private val storage: RelayStorage) : RelayApi {
    private suspend fun <T> observed(management: Boolean = false, call: suspend () -> RelayResult<T>): RelayResult<T> {
        val state = storage.read()
        if (!management) {
            if (state.accountDeleted || state.accountDeletionPending) return RelayResult.Failure(RelayErrorCode.AccountDeleted)
            if (state.accountDisabled) return RelayResult.Failure(RelayErrorCode.AccountDisabled)
        }
        val result = call()
        if (result is RelayResult.Failure) {
            when (result.code) {
                RelayErrorCode.AccountDeleted -> storage.update { erasedRelayAccount(it, true) }
                RelayErrorCode.AccountDisabled -> storage.update { it.copy(accountDisabled = true,
                    failure = result.code, retryAfterSeconds = result.retryAfterSeconds) }
                else -> Unit
            }
        }
        return result
    }

    override suspend fun accountStatus(): RelayResult<RelayAccountStatus> {
        val result = observed(true) { delegate.accountStatus() }
        if (result is RelayResult.Success) storage.update { state ->
            val next = when (result.value.state) {
                "deleted" -> erasedRelayAccount(state, true)
                "deleting" -> erasedRelayAccount(state, false)
                else -> state
            }
            next.copy(accountStatus = result.value, accountDisabled = result.value.state == "disabled",
                failure = if (result.value.state == "disabled") RelayErrorCode.AccountDisabled else next.failure)
        }
        return result
    }
    override suspend fun deleteAccount(operationId: String): RelayResult<RelayAccountDeletion> =
        observed(true) { delegate.deleteAccount(operationId) }
    override suspend fun begin(installationId: String, operationId: String, token: String, replacing: Boolean) =
        observed { delegate.begin(installationId, operationId, token, replacing) }
    override suspend fun confirm(installationId: String, operationId: String, challengeId: String, nonce: String,
        replacing: Boolean) = observed { delegate.confirm(installationId, operationId, challengeId, nonce, replacing) }
    override suspend fun installations() = observed(true) { delegate.installations() }
    override suspend fun deleteInstallation(installationId: String) = observed(true) { delegate.deleteInstallation(installationId) }
    override suspend fun create(installationId: String, route: RelayRoute) = observed { delegate.create(installationId, route) }
    override suspend fun activate(installationId: String, routeId: String) = observed { delegate.activate(installationId, routeId) }
    override suspend fun renew(installationId: String, routeId: String) = observed { delegate.renew(installationId, routeId) }
    override suspend fun deleteRoute(installationId: String, routeId: String) = observed(true) { delegate.deleteRoute(installationId, routeId) }
    override suspend fun revoke(deletion: RelayDeletion) = observed(true) { delegate.revoke(deletion) }
}

/** Durable account-deletion operation and typed inventory for the later account screen; never launches sign-in UI. */
class RelayAccounts(private val storage: RelayStorage, private val api: RelayApi) {
    /** Returns safe quota/status snapshots and observes disabled/deleted account state. */
    suspend fun status(): RelayResult<RelayAccountStatus> = api.accountStatus()

    /** Local keys disappear before HTTP. Retries reuse the operation; D53 treats subsequent account_deleted as complete. */
    suspend fun delete(): RelayResult<RelayAccountDeletion> {
        val previous = storage.read()
        if (previous.accountDeleted) return RelayResult.Success(RelayAccountDeletion(RelayDeletionState.Deleted))
        val state = storage.update {
            erasedRelayAccount(it.copy(accountDeletionOperationId = it.accountDeletionOperationId ?: RelayCrypto.newId()), false)
        }
        val result = api.deleteAccount(requireNotNull(state.accountDeletionOperationId))
        val complete = result is RelayResult.Success && result.value.state == RelayDeletionState.Deleted ||
            result is RelayResult.Failure && result.code == RelayErrorCode.AccountDeleted
        storage.update {
            if (complete) erasedRelayAccount(it, true)
            else it.copy(accountDeletionPending = true, failure = (result as? RelayResult.Failure)?.code,
                retryAfterSeconds = when (result) {
                    is RelayResult.Failure -> result.retryAfterSeconds
                    is RelayResult.Success -> result.retryAfterSeconds
                })
        }
        return if (complete) RelayResult.Success(RelayAccountDeletion(RelayDeletionState.Deleted)) else result
    }
}
