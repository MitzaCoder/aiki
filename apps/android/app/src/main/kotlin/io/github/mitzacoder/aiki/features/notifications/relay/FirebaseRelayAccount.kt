package io.github.mitzacoder.aiki.features.notifications.relay

import android.content.Context
import androidx.credentials.ClearCredentialStateRequest
import androidx.credentials.CredentialManager
import androidx.credentials.GetCredentialRequest
import androidx.credentials.exceptions.GetCredentialCancellationException
import androidx.credentials.exceptions.GetCredentialException
import androidx.credentials.exceptions.GetCredentialProviderConfigurationException
import androidx.credentials.exceptions.NoCredentialException
import com.google.android.gms.common.ConnectionResult
import com.google.android.gms.common.GoogleApiAvailabilityLight
import com.google.android.gms.tasks.Task
import com.google.android.libraries.identity.googleid.GetSignInWithGoogleOption
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential
import com.google.firebase.FirebaseApp
import com.google.firebase.FirebaseOptions
import com.google.firebase.FirebaseTooManyRequestsException
import com.google.firebase.auth.ActionCodeSettings
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.auth.FirebaseAuthException
import com.google.firebase.auth.GoogleAuthProvider
import io.github.mitzacoder.aiki.BuildConfig
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.suspendCancellableCoroutine

/** Safe local identity for settings only. Never include it in a backend registration. */
data class RelayIdentity(val email: String, val method: String)

/** A fixed safe failure, without SDK details, tokens or email links in its message or cause. */
class RelaySignInException(val problem: RelaySignInProblem) : Exception(problem.message)

/**
 * Firebase Auth adapter. Constructing this wrapper does not create Auth: only explicit opt-in methods evaluate auth.
 * ID token reads never launch UI. The named app isolates the relay identity from direct FCM registration.
 */
class FirebaseRelayAccount(
    context: Context,
    createAuth: (Context) -> FirebaseAuth = { createRelayFirebaseAuth(it) },
) : RelayAccount {
    private val appContext = context.applicationContext
    private val auth by lazy { createAuth(appContext) }
    private val preferences by lazy {
        appContext.getSharedPreferences("${BuildConfig.PREFERENCES_PREFIX}-relay-email", Context.MODE_PRIVATE)
    }
    private var optedIn = false

    /** Configuration checks do not instantiate Firebase or Credential Manager. */
    val unavailableReason: String? get() = when {
        RelayEndpoint(BuildConfig.PUSH_RELAY_URL, BuildConfig.DEBUG).unavailableReason != null ->
            RelayEndpoint(BuildConfig.PUSH_RELAY_URL, BuildConfig.DEBUG).unavailableReason
        BuildConfig.FIREBASE_APP_ID.isEmpty() -> "Relay notifications are not available in this build. Firebase is not configured."
        BuildConfig.RELAY_GOOGLE_CLIENT_ID.isBlank() || BuildConfig.RELAY_EMAIL_LINK_DOMAIN.isBlank() ->
            "Relay notifications are not available in this build. Sign-in is not configured."
        else -> null
    }

    /** Must be called only after the user chooses to turn relay notifications on or resumes an enabled account. */
    fun optIn() { optedIn = true }

    /** Read only after opt-in, never while rendering the default-off row. */
    fun identity(): RelayIdentity? {
        if (!optedIn) return null
        val user = auth.currentUser ?: return null
        return RelayIdentity(user.email.orEmpty(), if (user.providerData.any { it.providerId == "google.com" }) "Google" else "email link")
    }

    override suspend fun idToken(): String? {
        if (!optedIn) return null
        return safe { auth.currentUser?.getIdToken(false)?.relayAwait()?.token }
    }

    /** Credential Manager uses the Web client ID, never an OAuth secret or an Android client ID. */
    suspend fun google(activity: Context, reauthenticate: Boolean = false) = safe {
        checkOptIn()
        val token = RelayAuthPlatform.googleToken() ?: run {
            if (GoogleApiAvailabilityLight.getInstance().isGooglePlayServicesAvailable(appContext) != ConnectionResult.SUCCESS) {
                throw RelaySignInException(RelaySignInProblem.NoGoogleServices)
            }
            val option = GetSignInWithGoogleOption.Builder(BuildConfig.RELAY_GOOGLE_CLIENT_ID).build()
            val response = CredentialManager.create(activity).getCredential(activity,
                GetCredentialRequest.Builder().addCredentialOption(option).build())
            val credential = response.credential
            if (credential.type != GoogleIdTokenCredential.TYPE_GOOGLE_ID_TOKEN_CREDENTIAL) {
                throw RelaySignInException(RelaySignInProblem.Misconfigured)
            }
            GoogleIdTokenCredential.createFrom(credential.data).idToken
        }
        val credential = GoogleAuthProvider.getCredential(token, null)
        if (reauthenticate) requireNotNull(auth.currentUser).reauthenticate(credential).relayAwait()
        else auth.signInWithCredential(credential).relayAwait()
    }

    /** Generic success copy avoids exposing whether an address has an account. */
    suspend fun sendEmail(address: String) = safe {
        checkOptIn()
        val settings = ActionCodeSettings.newBuilder()
            .setUrl("https://${BuildConfig.RELAY_EMAIL_LINK_DOMAIN}/__/auth/links")
            .setHandleCodeInApp(true)
            .setAndroidPackageName(appContext.packageName, false, null)
            .setLinkDomain(BuildConfig.RELAY_EMAIL_LINK_DOMAIN)
            .build()
        auth.sendSignInLinkToEmail(address.trim(), settings).relayAwait()
        preferences.edit().putString("pending-email", address.trim()).apply()
    }

    /** Address stays local until completion. Cross-phone links ask the user for it again. */
    fun pendingEmail(): String = if (optedIn) preferences.getString("pending-email", "").orEmpty() else ""

    /** Both the App Link and paste path use this validator before passing anything to Firebase. */
    suspend fun emailLink(address: String, link: String, reauthenticate: Boolean = false) = safe {
        checkOptIn()
        if (!validRelayEmailLink(link, BuildConfig.RELAY_EMAIL_LINK_DOMAIN) || !auth.isSignInWithEmailLink(link)) {
            throw RelaySignInException(RelaySignInProblem.LinkInvalid)
        }
        if (reauthenticate) {
            val credential = com.google.firebase.auth.EmailAuthProvider.getCredentialWithLink(address.trim(), link)
            requireNotNull(auth.currentUser).reauthenticate(credential).relayAwait()
        } else auth.signInWithEmailLink(address.trim(), link).relayAwait()
        preferences.edit().remove("pending-email").apply()
    }

    /** Force a token refresh and check server auth time; refresh alone is not re-authentication. */
    suspend fun recentlyAuthenticated(now: Long = System.currentTimeMillis()): Boolean = safe {
        if (!optedIn) return@safe false
        val token = auth.currentUser?.getIdToken(true)?.relayAwait() ?: return@safe false
        val authenticatedAt = token.authTimestamp * 1000
        authenticatedAt <= now && now - authenticatedAt < 300_000
    }

    /** Caller must erase this phone's relay keys and queue remote cleanup before invoking this method. */
    suspend fun signOut() {
        if (!optedIn) return
        auth.signOut()
        preferences.edit().clear().apply()
        try { CredentialManager.create(appContext).clearCredentialState(ClearCredentialStateRequest()) }
        catch (error: CancellationException) { throw error }
        catch (_: Exception) { /* Local Auth is already signed out. No backend session is touched. */ }
        optedIn = false
    }

    private fun checkOptIn() {
        if (!optedIn || unavailableReason != null) throw RelaySignInException(RelaySignInProblem.Unavailable)
    }

    private suspend fun <T> safe(block: suspend () -> T): T = try { block() }
    catch (error: CancellationException) { throw error }
    catch (error: RelaySignInException) { throw error }
    catch (_: GetCredentialCancellationException) { throw RelaySignInException(RelaySignInProblem.Cancelled) }
    catch (_: NoCredentialException) { throw RelaySignInException(RelaySignInProblem.NoGoogleAccount) }
    catch (_: GetCredentialProviderConfigurationException) { throw RelaySignInException(RelaySignInProblem.NoGoogleServices) }
    catch (_: GetCredentialException) { throw RelaySignInException(RelaySignInProblem.Misconfigured) }
    catch (_: FirebaseTooManyRequestsException) { throw RelaySignInException(RelaySignInProblem.EmailUnavailable) }
    catch (error: FirebaseAuthException) {
        throw RelaySignInException(when (error.errorCode) {
            "ERROR_EXPIRED_ACTION_CODE", "ERROR_INVALID_ACTION_CODE" -> RelaySignInProblem.LinkExpired
            "ERROR_USER_DISABLED" -> RelaySignInProblem.AccountDisabled
            "ERROR_USER_NOT_FOUND", "ERROR_USER_TOKEN_EXPIRED", "ERROR_INVALID_USER_TOKEN" -> RelaySignInProblem.AccountDeleted
            "ERROR_ACCOUNT_EXISTS_WITH_DIFFERENT_CREDENTIAL", "ERROR_CREDENTIAL_ALREADY_IN_USE" -> RelaySignInProblem.ProviderConflict
            "ERROR_REQUIRES_RECENT_LOGIN" -> RelaySignInProblem.RecentSignInRequired
            "ERROR_TOO_MANY_REQUESTS", "ERROR_QUOTA_EXCEEDED" -> RelaySignInProblem.EmailUnavailable
            "ERROR_INVALID_API_KEY", "ERROR_OPERATION_NOT_ALLOWED", "ERROR_INVALID_CREDENTIAL" -> RelaySignInProblem.Misconfigured
            else -> RelaySignInProblem.Network
        })
    }
    catch (_: Exception) { throw RelaySignInException(RelaySignInProblem.Network) }
}

private fun createRelayFirebaseAuth(context: Context): FirebaseAuth {
    val app = FirebaseApp.getApps(context).firstOrNull { it.name == "relay-account" }
        ?: FirebaseApp.initializeApp(context, FirebaseOptions.Builder()
            .setApplicationId(BuildConfig.FIREBASE_APP_ID)
            .setApiKey(BuildConfig.FIREBASE_API_KEY)
            .setProjectId(BuildConfig.FIREBASE_PROJECT_ID)
            .setGcmSenderId(BuildConfig.FIREBASE_SENDER_ID)
            .build(), "relay-account")
    val auth = FirebaseAuth.getInstance(app)
    RelayAuthPlatform.configure(auth)
    return auth
}

/** Cancellable await without logging Auth exceptions or retaining credentials in coroutine diagnostics. */
internal suspend fun <T> Task<T>.relayAwait(): T = suspendCancellableCoroutine { continuation ->
    addOnCompleteListener { task ->
        if (continuation.isActive) {
            if (task.isSuccessful) continuation.resume(task.result)
            else continuation.resumeWithException(task.exception ?: IllegalStateException("Sign-in failed"))
        }
    }
}
