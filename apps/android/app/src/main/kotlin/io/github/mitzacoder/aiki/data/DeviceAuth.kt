package io.github.mitzacoder.aiki.data

import java.time.Instant
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.json.*
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.MediaType.Companion.toMediaType

class DeviceAuthHttpException(val status: Int, val authCode: String, val retryAfterMs: Long) : Exception(when {
    status == 429 -> "Too many attempts. Wait before trying again."
    authCode.contains("denied") -> "Pairing was denied. Create a new link."
    status == 409 -> "This link was already used. Create a new link."
    authCode.contains("expired") -> "This link or session expired. Pair again."
    status == 403 -> "This device was signed out."
    status == 401 -> "Session expired. Pair this backend."
    else -> "Pairing request failed ($status)."
})

/** No redirect, logging interceptor, URL query credential or response body ever escapes this boundary. */
class DeviceAuthHttp(http: OkHttpClient = OkHttpClient()) {
    private val http = http.newBuilder().followRedirects(false).followSslRedirects(false).callTimeout(30, TimeUnit.SECONDS).build()
    suspend fun call(origin: String, path: String, body: JsonObject? = null, bearer: String? = null): JsonObject = withContext(Dispatchers.IO) {
        require(normalizeBackendOrigin(origin) == origin)
        require(path.startsWith("/auth/"))
        val request = Request.Builder().url(origin + path).apply {
            header("Cache-Control", "no-store")
            if (bearer != null) header("Authorization", "Bearer $bearer")
            if (body != null) post(body.toString().toRequestBody("application/json".toMediaType()))
        }.build()
        http.newCall(request).execute().use { response ->
            // Bound hostile responses, and never include them in exception messages.
            val source = response.body.source()
            source.request(8193)
            if (source.buffer.size > 8192) throw ClientException("auth_invalid_response", "Invalid authentication response")
            val raw = source.readUtf8()
            val json = runCatching { require(raw.length <= 8192); wireJson.parseToJsonElement(raw).jsonObject }.getOrNull()
            if (!response.isSuccessful) throw DeviceAuthHttpException(response.code, json?.get("error")?.jsonObject?.get("code")?.jsonPrimitive?.contentOrNull.orEmpty(),
                (response.header("Retry-After")?.toLongOrNull()?.coerceIn(1, 3600) ?: 1) * 1000)
            json ?: throw ClientException("auth_invalid_response", "Invalid authentication response")
        }
    }
}

internal fun JsonObject.string(name: String): String = getValue(name).jsonPrimitive.content
internal fun JsonObject.optionalString(name: String): String? = get(name)?.jsonPrimitive?.contentOrNull
internal fun authBody(vararg fields: Pair<String, String>) = buildJsonObject { fields.forEach { (key, value) -> put(key, value) } }
internal fun authRenewDelay(expiresAt: String, now: Long): Long = (Instant.parse(expiresAt).toEpochMilli() - now - 60_000).coerceAtLeast(1000)
internal fun authRotationDue(rotateAfter: String?, now: Long): Boolean = rotateAfter != null && Instant.parse(rotateAfter).toEpochMilli() <= now
internal fun allowAnonymousAuth(advertised: Boolean, mode: String?, hasSession: Boolean): Boolean = !hasSession && (!advertised || mode == "optional" || mode == "off")

data class DeviceAuthState(val backendId: String? = null, val mode: String? = null, val sessionId: String? = null, val notice: String? = null, val comparisonCode: String? = null)

/** One controller per approved origin. Access tokens are memory-only and never part of a public state flow. */
class DeviceAuth(val origin: String, private val store: DeviceAuthStorage, val http: DeviceAuthHttp = DeviceAuthHttp(), private val label: String = android.os.Build.MODEL ?: "Android device") {
    private val mutex = Mutex()
    private val mutableState = MutableStateFlow(DeviceAuthState())
    val state = mutableState.asStateFlow()
    private var access: String? = null
    private var accessExpiry: String? = null
    private var mode: String? = null
    private var stopped = false

    suspend fun prepare(): String? = mutex.withLock {
        val saved = store.read(origin)
        if (stopped) throw ClientException("auth_required", state.value.notice ?: "Pair this backend")
        val status = try { http.call(origin, "/auth/status") } catch (error: DeviceAuthHttpException) {
            if (error.status == 404 && saved == null) return@withLock null
            if (error.status == 404) throw ClientException("auth_downgrade", "Authentication support disappeared. Pair this backend; anonymous fallback is blocked.")
            throw error
        }
        if (saved == null) store.write(origin, SavedDeviceAuth(backendId = status.optionalString("backendId")))
        checkAuthVersion(status["authVersion"]?.jsonPrimitive?.intOrNull) { "Update needed for this backend's authentication." }
        val backendId = status.string("backendId")
        if (saved?.backendId != null && saved.backendId != backendId) throw ClientException("auth_origin_changed", "The backend at this address changed. Pair it again.")
        mode = status.string("mode")
        store.write(origin, saved ?: SavedDeviceAuth(backendId = backendId))
        mutableState.value = state.value.copy(backendId = backendId, mode = mode, sessionId = saved?.sessionId)
        if (saved?.sessionToken != null) return@withLock refreshLocked(saved)
        saved?.pending?.takeIf { it.kind != "migration" }?.let { pending ->
            redeemLocked(DevicePairingLink(backendId, origin, pending.grantId, if (pending.kind == "pair") pending.redeemSecret.orEmpty() else "", pending.kind == "bootstrap"), pending.redeemSecret.orEmpty(),
                onWaiting = { code -> mutableState.value = state.value.copy(notice = "Waiting for approval", comparisonCode = code) })
            return@withLock access
        }
        if (!allowAnonymousAuth(saved?.advertised ?: true, mode, hasSession = false) || saved?.signedOut != null) {
            mutableState.value = state.value.copy(notice = saved?.signedOut ?: "Pair this backend")
            throw ClientException("auth_required", state.value.notice!!)
        }
        null
    }

    /** Called after anonymous hello too, so feature advertisement is durably pinned. */
    suspend fun advertised(backendId: String?, authMode: String?) {
        val saved = store.read(origin)
        if (saved?.backendId != null && backendId != null && saved.backendId != backendId) throw ClientException("auth_origin_changed", "Backend identity changed")
        if (saved == null) store.write(origin, SavedDeviceAuth(backendId = backendId))
        mutableState.value = state.value.copy(backendId = backendId ?: saved?.backendId, mode = authMode ?: mode)
    }

    private suspend fun refreshLocked(initial: SavedDeviceAuth): String {
        var saved = initial
        var token = saved.sessionToken ?: throw ClientException("auth_required", "Pair this backend")
        var recoveredRefresh: JsonObject? = null
        if (saved.successorToken != null || authRotationDue(saved.rotateAfter, System.currentTimeMillis())) {
            val successor = saved.successorToken ?: deviceAuthSecret("aiki_s1.${saved.sessionId}.")
            // Stage before sending: lost rotate replies and process death resume the identical successor.
            saved = SavedDeviceAuth(saved.backendId, sessionId = saved.sessionId, sessionToken = token, successorToken = successor, rotateAfter = saved.rotateAfter, pending = saved.pending)
            store.write(origin, saved)
            val rotated = try { http.call(origin, "/auth/session/rotate", authBody("successorToken" to successor), token) }
            catch (error: DeviceAuthHttpException) {
                if (error.status != 401 || initial.successorToken == null) throw error
                // The process may have died after server commit, outside the old-token retry window.
                // Only the durably staged successor can prove that rotation already succeeded.
                http.call(origin, "/auth/session/refresh", buildJsonObject {}, successor).also {
                    if (it.string("backendId") != saved.backendId || it.string("sessionId") != saved.sessionId) throw ClientException("auth_origin_changed", "Backend identity changed")
                    recoveredRefresh = it
                }
            }
            saved = SavedDeviceAuth(saved.backendId, sessionId = saved.sessionId, sessionToken = successor, rotateAfter = rotated.string("rotateAfter"), pending = saved.pending)
            store.write(origin, saved)
            token = successor
        }
        val response = recoveredRefresh ?: http.call(origin, "/auth/session/refresh", buildJsonObject {}, token)
        require(response.string("backendId") == saved.backendId && response.string("sessionId") == saved.sessionId) { "Backend identity changed." }
        store.write(origin, SavedDeviceAuth(saved.backendId, sessionId = saved.sessionId, sessionToken = token, rotateAfter = response.string("rotateAfter"), pending = saved.pending))
        access = response.string("accessToken")
        accessExpiry = response.string("accessExpiresAt")
        mutableState.value = state.value.copy(sessionId = saved.sessionId, notice = null, comparisonCode = null)
        return access!!
    }
    suspend fun refresh(): String = mutex.withLock { refreshLocked(store.read(origin) ?: throw ClientException("auth_required", "Pair this backend")) }
    fun renewalDelay(): Long = accessExpiry?.let { authRenewDelay(it, System.currentTimeMillis()) } ?: 60_000

    fun blocked(message: String) { mutableState.value = state.value.copy(notice = message) }

    suspend fun signedOut(message: String) = mutex.withLock {
        stopped = true; access = null; accessExpiry = null
        val saved = store.read(origin)
        store.write(origin, SavedDeviceAuth(backendId = saved?.backendId, signedOut = message))
        mutableState.value = state.value.copy(sessionId = null, notice = message, comparisonCode = null)
    }

    /** Optional migration remains anonymous and usable until an owner explicitly approves this exact claim. */
    suspend fun migrate(onApproved: () -> Unit) {
        if (state.value.mode != "optional") return
        val saved = mutex.withLock {
            val prior = store.read(origin) ?: return
            if (prior.migrationStopped != null) { mutableState.value = state.value.copy(notice = prior.migrationStopped); return }
            if (prior.sessionToken != null || prior.signedOut != null || (prior.pending != null && prior.pending.kind != "migration")) return
            SavedDeviceAuth(prior.backendId, pending = prior.pending ?: newDeviceClaim("migration")).also { store.write(origin, it) }
        }
        val claim = requireNotNull(saved.pending)
        mutableState.value = state.value.copy(notice = "Waiting for approval", comparisonCode = deviceComparisonCode(saved.backendId!!, "migration", claim.id, claim.secret))
        var wait = 1000L
        var registered = false
        while (currentCoroutineContext().isActive) {
            if (store.read(origin)?.pending?.id != claim.id) return
            try {
                val response = if (!registered) http.call(origin, "/auth/migration/claims", claimBody(claim, label)).also { registered = true }
                    else http.call(origin, "/auth/claims/poll", claimProof(claim))
                if (mutex.withLock {
                    if (store.read(origin)?.pending?.id != claim.id) return
                    acceptClaim(response, claim)
                }) { onApproved(); return }
                if (response.string("state") in setOf("expired", "denied", "acknowledged")) {
                    store.write(origin, SavedDeviceAuth(saved.backendId, migrationStopped = "Approval expired or was denied. Pair this backend."))
                    mutableState.value = state.value.copy(notice = "Approval expired or was denied. Pair this backend.", comparisonCode = null)
                    return
                }
                wait = (wait * 2).coerceAtMost(30_000)
            } catch (error: CancellationException) { throw error }
            catch (error: DeviceAuthHttpException) {
                if (error.status == 403) { mutableState.value = state.value.copy(notice = "Pair this backend", comparisonCode = null); return }
                wait = maxOf(wait * 2, error.retryAfterMs).coerceAtMost(3_600_000)
            } catch (_: Exception) { wait = (wait * 2).coerceAtMost(30_000) }
            delay(wait)
        }
    }

    suspend fun redeem(link: DevicePairingLink, code: String, onWaiting: (String) -> Unit, onStaged: suspend () -> Unit = {}) = mutex.withLock {
        redeemLocked(link, code, onWaiting, onStaged)
    }

    private suspend fun redeemLocked(link: DevicePairingLink, code: String, onWaiting: (String) -> Unit, onStaged: suspend () -> Unit = {}) {
        require(link.origin == origin)
        val saved = store.read(origin)
        require(saved?.backendId == null || saved.backendId == link.backendId) { "Backend identity changed." }
        val prior = saved?.pending
        val claim = prior?.takeIf { it.grantId == link.grantId && it.kind == if (link.bootstrap) "bootstrap" else "pair" }
            ?: newDeviceClaim(if (link.bootstrap) "bootstrap" else "pair", link.grantId, if (link.bootstrap) code else link.secret)
        // Persist the proof before the first exchange, including enough to recover a lost redemption response.
        store.write(origin, SavedDeviceAuth(link.backendId, sessionId = saved?.sessionId, sessionToken = saved?.sessionToken, rotateAfter = saved?.rotateAfter, pending = claim))
        onStaged()
        val body = buildJsonObject {
            claimBody(claim, label).forEach { (key, value) -> put(key, value) }
            if (link.bootstrap) { put("requestId", link.grantId); put("code", claim.redeemSecret!!) }
            else { put("grantId", link.grantId); put("secret", claim.redeemSecret!!) }
        }
        var response = http.call(origin, if (link.bootstrap) "/auth/bootstrap/redeem" else "/auth/pairings/redeem", body)
        onWaiting(deviceComparisonCode(link.backendId, link.grantId, claim.id, claim.secret))
        var wait = 1000L
        while (currentCoroutineContext().isActive) {
            if (acceptClaim(response, claim)) return
            when (response.string("state")) {
                "denied" -> throw ClientException("auth_denied", "Pairing was denied. Create a new link.")
                "expired", "acknowledged" -> throw ClientException("auth_expired", "This pairing expired. Create a new link.")
            }
            delay(wait)
            try { response = http.call(origin, "/auth/claims/poll", claimProof(claim)); wait = 1000 }
            catch (error: DeviceAuthHttpException) { if (error.status != 429) throw error; wait = maxOf(1000, error.retryAfterMs) }
        }
    }

    private suspend fun acceptClaim(response: JsonObject, claim: PendingDeviceClaim): Boolean {
        require(response.string("claimId") == claim.id)
        val credentials = response["credentials"] as? JsonObject ?: return false
        val saved = store.read(origin) ?: error("Claim was lost")
        require(credentials.string("backendId") == saved.backendId && saved.pending?.id == claim.id)
        val token = credentials.string("sessionToken")
        require(token.startsWith("aiki_s1.${credentials.string("sessionId")}."))
        // Keep the proof until acknowledgement succeeds. Never ack credentials that aren't durable.
        store.write(origin, SavedDeviceAuth(saved.backendId, sessionId = credentials.string("sessionId"), sessionToken = token, rotateAfter = credentials.string("rotateAfter"), pending = claim))
        access = credentials.string("accessToken"); accessExpiry = credentials.string("accessExpiresAt"); stopped = false
        mutableState.value = state.value.copy(backendId = saved.backendId, sessionId = credentials.string("sessionId"), notice = null, comparisonCode = null)
        try {
            http.call(origin, "/auth/claims/ack", claimProof(claim))
            store.write(origin, SavedDeviceAuth(saved.backendId, sessionId = credentials.string("sessionId"), sessionToken = token, rotateAfter = credentials.string("rotateAfter")))
        } catch (error: CancellationException) { throw error }
        catch (_: Exception) { /* Credentials are durable; the next connection retries the acknowledgement. */ }
        return true
    }
    suspend fun acknowledgeStored() {
        val saved = store.read(origin) ?: return
        if (saved.sessionToken == null) return
        val claim = saved.pending ?: return
        http.call(origin, "/auth/claims/ack", claimProof(claim))
        store.write(origin, SavedDeviceAuth(saved.backendId, sessionId = saved.sessionId, sessionToken = saved.sessionToken, successorToken = saved.successorToken, rotateAfter = saved.rotateAfter))
    }
}

private fun checkAuthVersion(version: Int?, message: () -> String) {
    if (version != 1) throw ClientException("auth_update_required", message())
}

private fun claimProof(claim: PendingDeviceClaim) = authBody("claimId" to claim.id, "claimSecret" to claim.secret)
private fun claimBody(claim: PendingDeviceClaim, label: String) = authBody("claimId" to claim.id, "claimSecret" to claim.secret, "label" to label.take(120), "platform" to "android")
