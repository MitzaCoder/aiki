package io.github.mitzacoder.aiki.features.notifications.relay

import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.json.*

/** Persists each operation before sending; duplicate token callbacks share one installation-wide challenge. */
class RelayEnrollmentMachine(
    private val storage: RelayStorage,
    private val api: RelayApi,
    private val time: RelayTime,
    private val confirmed: suspend () -> Unit = {},
) {
    private val mutex = Mutex()

    /** Explicit opt-in only. The account port is invoked by the client, never by installation or backend pairing. */
    suspend fun enable(token: String) = mutex.withLock {
        storage.enable()
        stageToken(token)
        resumeLocked()
    }

    /** Called at launch and by both FCM token callbacks; missed replacement is retried at the next launch. */
    suspend fun tokenChanged(token: String) = mutex.withLock {
        val state = storage.read()
        if (!state.signedIn || state.installationId == null || state.accountDisabled || state.accountDeleted ||
            state.accountDeletionPending) return@withLock
        stageToken(token)
        resumeLocked()
    }

    private suspend fun stageToken(token: String) {
        RelayCrypto.checkSize(token, RelayCrypto.FCM_TOKEN_CAP)
        require(token.isNotBlank())
        storage.update { state ->
            if (state.enrollment?.token == token || (state.enrollment == null && state.activeToken == token)) state
            else state.copy(enrollment = pending(token, state.activeToken != null), failure = null, retryAfterSeconds = null)
        }
    }

    private fun pending(token: String, replacing: Boolean): RelayEnrollment = RelayEnrollment(
        operationId = RelayCrypto.newId(), token = token, replacing = replacing, deadline = time.wall() + CHALLENGE_MS,
    )

    /** A lost challenge requires a new operation; retrying begin alone deliberately does not resend it (D52). */
    suspend fun restartChallenge() = mutex.withLock {
        storage.update { state -> state.copy(enrollment = state.enrollment?.let { pending(it.token, it.replacing) }) }
        resumeLocked()
    }

    /** Resumes begin/confirm after process death; waiting is passive until deadline, then uses a fresh operation ID. */
    suspend fun resume() = mutex.withLock { resumeLocked() }

    private suspend fun resumeLocked() {
        var state = storage.read()
        if (!state.signedIn || state.accountDisabled || state.accountDeleted || state.accountDeletionPending) return
        val installation = state.installationId ?: return
        var operation = state.enrollment ?: return
        if (operation.deadline < time.wall() && operation.phase != RelayEnrollment.Phase.Confirm) {
            state = storage.update { it.copy(enrollment = pending(operation.token, operation.replacing)) }
            operation = state.enrollment!!
        }
        when (operation.phase) {
            RelayEnrollment.Phase.Waiting -> return
            RelayEnrollment.Phase.Begin -> when (val result = api.begin(installation, operation.operationId,
                operation.token, operation.replacing)) {
                is RelayResult.Failure -> failed(result)
                is RelayResult.Success -> {
                    RelayCrypto.id(result.value.challengeId)
                    storage.update { it.copy(enrollment = operation.copy(phase = RelayEnrollment.Phase.Waiting,
                        challengeId = result.value.challengeId, deadline = result.value.deadline), failure = null,
                        retryAfterSeconds = null) }
                }
            }
            RelayEnrollment.Phase.Confirm -> when (val result = api.confirm(installation, operation.operationId,
                requireNotNull(operation.challengeId), requireNotNull(operation.nonce), operation.replacing)) {
                is RelayResult.Failure -> {
                    failed(result)
                    if (result.code == RelayErrorCode.ChallengeExpired || result.code == RelayErrorCode.ChallengeInvalid) {
                        storage.update { it.copy(enrollment = pending(operation.token, operation.replacing)) }
                    }
                }
                is RelayResult.Success -> {
                    check(result.value.installationId == installation) { "Invalid relay confirmation" }
                    storage.update { if (!it.signedIn) it else it.copy(activeToken = operation.token,
                        tokenGeneration = result.value.generation, enrollment = null,
                        failure = null, retryAfterSeconds = null) }
                    confirmed()
                }
            }
        }
    }

    /** Accepts only a canonical challenge for the persisted pending installation, operation and bounded deadline. */
    suspend fun challenge(raw: String): Boolean = mutex.withLock {
        val state = storage.read()
        if (!state.signedIn || state.accountDisabled || state.accountDeleted || state.accountDeletionPending) return@withLock false
        val operation = state.enrollment ?: return@withLock false
        val challenge = try {
            RelayCrypto.checkSize(raw, RelayCrypto.FCM_DATA_CAP)
            val value = RelayCrypto.obj(RelayCrypto.parse(raw))
            RelayCrypto.keys(value, listOf("v", "type", "installationId", "operationId", "challengeId", "nonce", "deadline"))
            if (value["v"] != JsonPrimitive(1) || value["type"] != JsonPrimitive("challenge")) return@withLock false
            if (RelayCrypto.text(value["installationId"], 22) != state.installationId ||
                RelayCrypto.text(value["operationId"], 22) != operation.operationId) return@withLock false
            val deadline = RelayCrypto.timestamp(value["deadline"])
            // A received begin receipt is the authoritative deadline. Small phone/relay wall-clock differences
            // must not reject that same receipt just because delivery was faster than the clock difference.
            if (deadline < time.wall() || (operation.phase == RelayEnrollment.Phase.Begin &&
                deadline > time.wall() + CHALLENGE_MS + 10_000) ||
                (operation.phase != RelayEnrollment.Phase.Begin && deadline != operation.deadline)) return@withLock false
            val id = RelayCrypto.id(RelayCrypto.text(value["challengeId"], 22))
            if (operation.challengeId != null && id != operation.challengeId) return@withLock false
            val nonce = RelayCrypto.text(value["nonce"], 43)
            RelayCrypto.unbase64(nonce, 32)
            operation.copy(phase = RelayEnrollment.Phase.Confirm, challengeId = id, nonce = nonce, deadline = deadline)
        } catch (_: RelayException) { return@withLock false }
        storage.update { it.copy(enrollment = challenge) }
        resumeLocked()
        true
    }

    private suspend fun failed(failure: RelayResult.Failure) {
        storage.update { it.copy(failure = failure.code, retryAfterSeconds = failure.retryAfterSeconds) }
    }

    companion object {
        const val CHALLENGE_MS = 300_000L
    }
}
