package io.github.mitzacoder.aiki.features.notifications.relay

/** Fixed relay codes only. Unknown server text is never retained or displayed. */
@kotlinx.serialization.Serializable
enum class RelayErrorCode(val wire: String) {
    InvalidRequest("invalid_request"), Unauthorized("unauthorized"), AdmissionDenied("admission_denied"),
    AccountDisabled("account_disabled"), AccountDeleted("account_deleted"), NotFound("not_found"),
    MethodNotAllowed("method_not_allowed"), BodyTooLarge("body_too_large"),
    UnsupportedEncoding("unsupported_encoding"), UnsupportedContentType("unsupported_content_type"),
    OperationConflict("operation_conflict"), InstallationInactive("installation_inactive"),
    InstallationExists("installation_exists"), PhoneLimit("phone_limit"), RouteLimit("route_limit"),
    ChallengeInvalid("challenge_invalid"), ChallengeExpired("challenge_expired"), RouteInactive("route_inactive"),
    MessageConflict("message_conflict"), RouteExpired("route_expired"), TokenInvalid("token_invalid"),
    MessageExpired("message_expired"), FcmRateLimited("fcm_rate_limited"), FcmUnavailable("fcm_unavailable"),
    RelayUnavailable("relay_unavailable"), RouteRate("route_rate"), AccountRate("account_rate"),
    IpRate("ip_rate"), RelayCapacity("relay_capacity"), ChallengeRate("challenge_rate"),
    EnrollmentCapacity("enrollment_capacity"), RelayDisabled("relay_disabled"),
    RecentLoginRequired("recent_auth_required"), RequestRate("request_rate"), EnrollmentRate("enrollment_rate"),
    EnrollmentDisabled("enrollment_disabled"), ClientAddressUnavailable("client_address_unavailable"), NotSignedIn("local_not_signed_in"),
    StorageUnavailable("local_storage_unavailable"), Unavailable("local_unavailable"),
    Network("local_network"), InvalidResponse("local_invalid_response"), Unknown("unknown");

    companion object {
        /** Only known constants cross the trust boundary. */
        fun fromWire(raw: String?): RelayErrorCode = entries.firstOrNull { it.wire == raw } ?: Unknown
    }
}

/** Typed transport outcome with bounded Retry-After seconds; no response bodies or credentials in errors. */
sealed interface RelayResult<out T> {
    /** Carries a typed decoded receipt without including it in diagnostics. */
    class Success<T>(val value: T, val retryAfterSeconds: Long? = null) : RelayResult<T> {
        override fun toString(): String = "RelaySuccess"
    }
    /** Contains only a fixed code and optional Retry-After seconds, never upstream error text. */
    data class Failure(val code: RelayErrorCode, val retryAfterSeconds: Long? = null) : RelayResult<Nothing>
}

/** Account tokens stay phone-side. Firebase Auth plugs into this port in the next task. */
fun interface RelayAccount {
    /** Returns a current ID token, or null without launching any sign-in UI. */
    suspend fun idToken(): String?
}
