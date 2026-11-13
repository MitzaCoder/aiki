package io.github.mitzacoder.kemiri.features.notifications.relay

import java.net.URI

/** The only account entry point is the notification settings opt-in flow. */
enum class RelaySignInPage { Off, Consent, Email, CheckEmail, PasteLink, SigningIn, CheckingPhone, On }

/** Fixed sign-in failures; never show SDK exception messages or a one-time URL. */
enum class RelaySignInProblem(val message: String) {
    Cancelled("Sign-in cancelled. Notifications through the relay are still off."),
    NoGoogleAccount("No Google account is available. Add one on this phone or continue with email."),
    NoGoogleServices("Google services are unavailable. Try email sign-in. Phone notifications still need Google services."),
    Misconfigured("Google sign-in is not set up for this build. Try email or contact the operator."),
    LinkInvalid("This is not a sign-in link for this app. Copy the whole link from your email."),
    LinkExpired("This link expired or was already used. Request a new link."),
    EmailUnavailable("Email sign-in is temporarily unavailable. Try again later or continue with Google."),
    AccountDisabled("The operator disabled this relay account. Contact the operator for help or deletion."),
    AccountDeleted("This relay account was deleted. Your backend sign-ins are unchanged."),
    SignInRequired("Sign in again to use relay notifications. Your backend sign-ins are unchanged."),
    ProviderConflict("Use the sign-in method you used for this account before."),
    Network("Sign-in could not connect. Check your connection and try again."),
    RecentSignInRequired("Sign in again before deleting the relay account."),
    Unavailable("Relay notifications are not available in this build."),
}

/** Immutable view state; secrets and email links must never be saved with the screen state. */
data class RelaySignInState(
    val page: RelaySignInPage = RelaySignInPage.Off,
    val problem: RelaySignInProblem? = null,
    val resendAt: Long = 0,
) {
    /** User intent, not app startup, begins consent. */
    fun begin(available: Boolean): RelaySignInState = if (available) copy(page = RelaySignInPage.Consent, problem = null)
        else copy(problem = RelaySignInProblem.Unavailable)
    /** All abandoned steps leave the switch off and retain no pending UI operation. */
    fun cancel(): RelaySignInState = RelaySignInState()
    /** Only a confirmed phone check can turn the relay switch on. */
    fun phoneChecked(confirmed: Boolean): RelaySignInState = copy(
        page = if (confirmed) RelaySignInPage.On else RelaySignInPage.CheckingPhone,
    )
    /** The SDK outcome never switches notifications on by itself. */
    fun signedIn(): RelaySignInState = copy(page = RelaySignInPage.CheckingPhone, problem = null)
    /** A sent email starts a local monotonic 60-second cooldown. */
    fun emailSent(now: Long): RelaySignInState = copy(page = RelaySignInPage.CheckEmail, resendAt = now + 60_000, problem = null)
    /** Seconds remaining, rounded up. An elapsed clock rollback fails closed. */
    fun resendSeconds(now: Long): Long = ((resendAt - now).coerceIn(0, 60_000) + 999) / 1000
}

/** Accepts only this build's exact HTTPS Hosting App Link endpoint, never arbitrary continuations. */
fun validRelayEmailLink(link: String, domain: String): Boolean = try {
    val uri = URI(link)
    domain.isNotBlank() && link.length <= 8192 && uri.scheme == "https" && uri.host == domain &&
        uri.rawAuthority == domain && uri.port == -1 && uri.rawUserInfo == null && uri.rawFragment == null &&
        uri.rawPath == "/__/auth/links" && !uri.rawQuery.isNullOrEmpty()
} catch (_: Exception) { false }

/** Never show an upstream budget name as settings text. Unknown budgets have a fixed generic label. */
fun relayQuotaLabel(budget: String): String = when (budget) {
    "accountDay" -> "Your account today"
    "accountMinute" -> "Your account this minute"
    "accountChallengeHour" -> "Phone checks this hour"
    "accountChallengeDay" -> "Phone checks today"
    "enrollmentDay" -> "Phone setups today"
    "ipDay" -> "This network today"
    "ipMinute" -> "This network this minute"
    "managementMinute" -> "Settings changes this minute"
    "managementDay" -> "Settings changes today"
    "ipChallengeHour" -> "Phone checks from this network this hour"
    "ipChallengeDay" -> "Phone checks from this network today"
    "newAccountIpDay" -> "New accounts from this network today"
    "relaySendDay" -> "Whole service today"
    "relayChallengeDay" -> "Whole service phone checks today"
    "newAccountDay" -> "New accounts on this service today"
    else -> "Service limit"
}

/** Plain words for each management failure, deliberately independent of remote text. */
fun relayProblemText(code: RelayErrorCode, retryAfterSeconds: Long? = null): String = when (code) {
    RelayErrorCode.PhoneLimit -> "This account has too many phones. Remove an old phone, then try again."
    RelayErrorCode.RelayDisabled, RelayErrorCode.EnrollmentDisabled -> "Push paused by the relay operator. The app still works."
    RelayErrorCode.AccountDisabled -> RelaySignInProblem.AccountDisabled.message
    RelayErrorCode.AccountDeleted -> RelaySignInProblem.AccountDeleted.message
    RelayErrorCode.RecentLoginRequired -> RelaySignInProblem.RecentSignInRequired.message
    RelayErrorCode.RequestRate, RelayErrorCode.EnrollmentRate, RelayErrorCode.ChallengeRate,
    RelayErrorCode.RouteRate, RelayErrorCode.AccountRate, RelayErrorCode.IpRate,
    RelayErrorCode.FcmRateLimited -> "Push rate limited. " + (retryAfterSeconds?.let { "Try again in $it seconds." }
        ?: "Try again later.")
    RelayErrorCode.Unavailable -> RelaySignInProblem.Unavailable.message
    RelayErrorCode.TokenInvalid -> "Phone registration needs a refresh. Try checking this phone again."
    RelayErrorCode.ChallengeExpired, RelayErrorCode.ChallengeInvalid -> "The phone check expired. Try checking this phone again."
    RelayErrorCode.RouteExpired, RelayErrorCode.RouteInactive -> "Push registration expired. Refresh this phone."
    RelayErrorCode.NotSignedIn, RelayErrorCode.Unauthorized -> "Sign in again to use relay notifications."
    RelayErrorCode.StorageUnavailable -> "This phone lost its notification keys. Turn relay notifications on again."
    RelayErrorCode.RouteLimit -> "This phone has too many backends for relay notifications. Remove one, then try again."
    else -> "Push delayed. Try again later. The app still works."
}
