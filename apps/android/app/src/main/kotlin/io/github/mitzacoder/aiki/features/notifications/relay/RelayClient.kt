package io.github.mitzacoder.aiki.features.notifications.relay

import java.io.IOException
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.*
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.MediaType.Companion.toMediaType

/** Minimal quota inventory; additional relay status fields are deliberately ignored for forward compatibility. */
@Serializable
data class RelayAccountStatus(val state: String, val phones: Int, val routes: Int,
    val phoneLimit: Int? = null, val routeLimit: Int? = null, val quotas: List<RelayQuota> = emptyList(),
    val deletionPending: Boolean = false, val relayEnabled: Boolean? = null, val enrollmentEnabled: Boolean? = null)

/** Advisory quota snapshot. Budget names and scopes may grow without breaking older clients. */
@Serializable
data class RelayQuota(val scope: String, val budget: String, val remaining: Long, val resetAt: Long)

/** Deletion completion is explicit; a pending response carries Retry-After on RelayResult.Success. */
@Serializable
data class RelayAccountDeletion(val state: RelayDeletionState, val deletionPending: Boolean = false)

/** Only the two documented successful account-deletion states are accepted. */
@Serializable
enum class RelayDeletionState {
    @kotlinx.serialization.SerialName("deleted") Deleted,
    @kotlinx.serialization.SerialName("deleting") Deleting,
}

/** Challenge metadata contains no nonce: possession arrives exclusively through the FCM receive path. */
@Serializable
data class RelayChallengeReceipt(val challengeId: String, val deadline: Long)

/** Confirmation receipt is idempotent under the original operation ID. */
@Serializable
data class RelayInstallationReceipt(val installationId: String, val generation: Long)

/** Inventory never exposes tokens or account identities. */
@Serializable
data class RelayInstallation(val installationId: String, val state: String, val createdAt: Long,
    val lastManagementAt: Long? = null)

/** Route management response contains no capability or backend identity. */
@Serializable
data class RelayRouteReceipt(val routeId: String, val state: String, val leaseExpiresAt: Long,
    val absoluteExpiresAt: Long)

/** Management port permits deterministic state-machine tests without any Firebase dependency. */
interface RelayApi {
    /** Reads safe account capacity without enrolling an installation. */
    suspend fun accountStatus(): RelayResult<RelayAccountStatus>
    /** Recent-auth deletion retries use one durable operation, including asynchronous cascade polling. */
    suspend fun deleteAccount(operationId: String): RelayResult<RelayAccountDeletion>
    /** Starts or retries one installation-wide possession operation. */
    suspend fun begin(installationId: String, operationId: String, token: String,
        replacing: Boolean = false): RelayResult<RelayChallengeReceipt>
    /** Confirms only the nonce delivered to the pending installation. */
    suspend fun confirm(installationId: String, operationId: String, challengeId: String, nonce: String,
        replacing: Boolean = false): RelayResult<RelayInstallationReceipt>
    /** Lists opaque phone inventory, never raw tokens. */
    suspend fun installations(): RelayResult<List<RelayInstallation>>
    /** Removes one owned installation and its routes. */
    suspend fun deleteInstallation(installationId: String): RelayResult<Unit>
    /** Creates a pending route from already-durable secrets. */
    suspend fun create(installationId: String, route: RelayRoute): RelayResult<RelayRouteReceipt>
    /** Activates a locally agreed key and atomically disables its predecessor. */
    suspend fun activate(installationId: String, routeId: String): RelayResult<RelayRouteReceipt>
    /** Extends only an owned route lease, never its absolute expiry. */
    suspend fun renew(installationId: String, routeId: String): RelayResult<RelayRouteReceipt>
    /** Deletes an owned route using phone account authority. */
    suspend fun deleteRoute(installationId: String, routeId: String): RelayResult<Unit>
    /** Uses delete-only authority without consulting the account port. */
    suspend fun revoke(deletion: RelayDeletion): RelayResult<Unit>
}

/** Octet-stream JSON only; pinned origin, no redirects/cookies, bounded bodies, finite timeouts and sanitized errors. */
class RelayClient(
    private val endpoint: RelayEndpoint,
    private val account: RelayAccount,
    transport: OkHttpClient = OkHttpClient(),
) : RelayApi {
    private val http = transport.newBuilder().followRedirects(false).followSslRedirects(false)
        .cookieJar(okhttp3.CookieJar.NO_COOKIES).callTimeout(20, TimeUnit.SECONDS)
        .connectTimeout(10, TimeUnit.SECONDS).readTimeout(10, TimeUnit.SECONDS)
        .writeTimeout(10, TimeUnit.SECONDS).build()
    private val json = Json { ignoreUnknownKeys = true }
    private val media = "application/octet-stream".toMediaType()

    private suspend fun <T> request(path: String, body: JsonObject, bearer: String? = null,
        decode: (JsonElement) -> T): RelayResult<T> = withContext(Dispatchers.IO) {
        val base = endpoint.url ?: return@withContext RelayResult.Failure(RelayErrorCode.Unavailable)
        try {
            val credential = bearer ?: account.idToken()
                ?: return@withContext RelayResult.Failure(RelayErrorCode.NotSignedIn)
            val bytes = body.toString().toByteArray(Charsets.UTF_8)
            if (bytes.size > RelayCrypto.MANAGEMENT_BODY_CAP) {
                return@withContext RelayResult.Failure(RelayErrorCode.InvalidRequest)
            }
            val target = base.newBuilder().addPathSegments(path).build()
            val request = Request.Builder().url(target).header("Authorization", "Bearer $credential")
                .header("Cache-Control", "no-store").post(bytes.toRequestBody(media)).build()
            http.newCall(request).execute().use { response ->
                val retry = response.header("Retry-After")?.toLongOrNull()?.takeIf { it >= 0 }
                val source = response.body.source()
                source.request(MAX_RESPONSE + 1)
                val bytesRead = source.readByteArray(minOf(source.buffer.size, MAX_RESPONSE + 1))
                if (bytesRead.size > MAX_RESPONSE) {
                    return@withContext RelayResult.Failure(RelayErrorCode.InvalidResponse, retry)
                }
                val raw = if (response.code == 204) JsonNull else
                    json.parseToJsonElement(bytesRead.decodeToString(throwOnInvalidSequence = true))
                if (response.code !in 200..299) {
                    val code = (raw as? JsonObject)?.get("error")?.jsonPrimitive?.contentOrNull
                    return@withContext RelayResult.Failure(RelayErrorCode.fromWire(code), retry)
                }
                RelayResult.Success(decode(raw), retry)
            }
        } catch (error: CancellationException) { throw error }
        catch (_: IOException) { RelayResult.Failure(RelayErrorCode.Network) }
        catch (_: Exception) { RelayResult.Failure(RelayErrorCode.InvalidResponse) }
    }

    private fun installation(installationId: String) = buildJsonObject { put("installationId", installationId) }
    private fun route(installationId: String, routeId: String) = buildJsonObject {
        put("installationId", installationId)
        put("routeId", routeId)
    }

    override suspend fun accountStatus(): RelayResult<RelayAccountStatus> = request("accounts/status", buildJsonObject {}) {
        json.decodeFromJsonElement(RelayAccountStatus.serializer(), it)
    }

    override suspend fun deleteAccount(operationId: String): RelayResult<RelayAccountDeletion> =
        request("accounts/delete", buildJsonObject { put("operationId", operationId) }) {
            json.decodeFromJsonElement(RelayAccountDeletion.serializer(), it)
        }

    override suspend fun begin(installationId: String, operationId: String, token: String,
        replacing: Boolean): RelayResult<RelayChallengeReceipt> = request(
        if (replacing) "installations/token/begin" else "installations/begin", buildJsonObject {
            put("installationId", installationId)
            put("operationId", operationId)
            put("token", token)
        },
    ) { json.decodeFromJsonElement(RelayChallengeReceipt.serializer(), it) }

    override suspend fun confirm(installationId: String, operationId: String, challengeId: String, nonce: String,
        replacing: Boolean): RelayResult<RelayInstallationReceipt> = request(
        if (replacing) "installations/token/confirm" else "installations/confirm", buildJsonObject {
            put("installationId", installationId)
            put("operationId", operationId)
            put("challengeId", challengeId)
            put("nonce", nonce)
        },
    ) { json.decodeFromJsonElement(RelayInstallationReceipt.serializer(), it) }

    override suspend fun installations(): RelayResult<List<RelayInstallation>> = request("installations/list", buildJsonObject {}) {
        json.decodeFromJsonElement(kotlinx.serialization.builtins.ListSerializer(RelayInstallation.serializer()),
            it.jsonObject.getValue("installations"))
    }

    override suspend fun deleteInstallation(installationId: String): RelayResult<Unit> =
        request("installations/delete", installation(installationId)) { }

    override suspend fun create(installationId: String, route: RelayRoute): RelayResult<RelayRouteReceipt> =
        request("routes/create", buildJsonObject {
            put("installationId", installationId)
            put("routeId", route.routeId)
            put("operationId", route.operationId)
            put("sendHash", hash(requireNotNull(route.sendBearer), "send"))
            put("deleteHash", hash(requireNotNull(route.deleteBearer), "delete"))
            route.predecessor?.let { put("predecessorId", it) }
        }) { json.decodeFromJsonElement(RelayRouteReceipt.serializer(), it) }

    override suspend fun activate(installationId: String, routeId: String): RelayResult<RelayRouteReceipt> =
        request("routes/activate", route(installationId, routeId)) {
            json.decodeFromJsonElement(RelayRouteReceipt.serializer(), it)
        }

    override suspend fun renew(installationId: String, routeId: String): RelayResult<RelayRouteReceipt> =
        request("routes/renew", route(installationId, routeId)) {
            json.decodeFromJsonElement(RelayRouteReceipt.serializer(), it)
        }

    override suspend fun deleteRoute(installationId: String, routeId: String): RelayResult<Unit> =
        request("routes/delete", route(installationId, routeId)) { }

    override suspend fun revoke(deletion: RelayDeletion): RelayResult<Unit> =
        request("delete", buildJsonObject { put("routeId", deletion.routeId) }, deletion.bearer) { }

    private fun hash(bearer: String, purpose: String): String = RelayCrypto.credentialHash(bearer, purpose)
        .joinToString("") { "%02x".format(it.toInt() and 255) }

    companion object {
        const val MAX_RESPONSE = 65_536L
    }
}
