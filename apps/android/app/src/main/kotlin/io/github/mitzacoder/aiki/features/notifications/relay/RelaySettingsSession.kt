package io.github.mitzacoder.aiki.features.notifications.relay

import android.content.Context
import androidx.core.app.NotificationManagerCompat
import io.github.mitzacoder.aiki.HarnessApplication
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/** Screen data contains no credential, one-time URL, relay secret or raw error text. */
data class RelaySettingsView(
    val signIn: RelaySignInState = RelaySignInState(),
    val visible: Boolean = false,
    val busy: Boolean = false,
    val identity: RelayIdentity? = null,
    val phone: RelayState? = null,
    val phones: List<RelayInstallation> = emptyList(),
    val message: String? = null,
    val reauthenticating: Boolean = false,
    val confirmDeletion: Boolean = false,
    val deletionPending: Boolean = false,
) {
    override fun toString(): String = "RelaySettingsView(${signIn.page})"
}

/** Settings-scoped operations. Construction and the default-off row never evaluate Auth or relay storage. */
class RelaySettingsSession(private val app: HarnessApplication, private val scope: CoroutineScope) {
    private val mutableView = MutableStateFlow(RelaySettingsView())
    val view = mutableView.asStateFlow()
    private var operation: Job? = null
    private val account get() = app.relayAccount
    private val relay get() = app.relayNotifications
    val unavailableReason: String? get() = account.unavailableReason
    val googleSignInEnabled: Boolean get() = relayGoogleSignInEnabled(
        io.github.mitzacoder.aiki.BuildConfig.RELAY_GOOGLE_CLIENT_ID, RelayAuthPlatform.fakeGoogleCredentialEnabled)

    private fun update(transform: (RelaySettingsView) -> RelaySettingsView) { mutableView.value = transform(mutableView.value) }

    private fun perform(block: suspend () -> Unit) {
        if (view.value.busy) return
        operation = scope.launch {
            update { it.copy(busy = true, message = null, signIn = it.signIn.copy(problem = null)) }
            try { block() }
            catch (error: CancellationException) { throw error }
            catch (error: RelaySignInException) { update { it.copy(signIn = it.signIn.copy(problem = error.problem)) } }
            catch (_: Exception) { update { it.copy(message = "Could not connect. Try again. The rest of the app still works.") } }
            finally { update { it.copy(busy = false) } }
        }
    }

    /** Composition disposal must not leave challenge reception enabled after leaving settings. */
    fun abandon() {
        operation?.cancel()
        if (view.value.visible && !app.repository.settings.value.notifications.relayEnabled) relay.finishPhoneCheck()
    }

    /** The switch is the only way to enter account setup. An external email link only fills this screen. */
    fun open() {
        if (unavailableReason != null) return
        account.optIn()
        update { it.copy(visible = true, signIn = it.signIn.begin(true)) }
        perform {
            val saved = relay.snapshot()
            if (saved.accountDeletionPending) {
                update { it.copy(signIn = RelaySignInState(), deletionPending = true, identity = account.identity(),
                    message = "Account deletion pending. Retry to check that cleanup has finished.") }
            } else if (app.repository.settings.value.notifications.relayEnabled) loadAccount()
        }
    }

    /** Cancelled consent/sign-in/check never enables the persisted relay setting. */
    fun close() {
        operation?.cancel()
        update { it.copy(visible = false) }
        scope.launch {
            if (!app.repository.settings.value.notifications.relayEnabled) relay.cancelPhoneCheck()
            app.relayEmailLink = null
            mutableView.value = RelaySettingsView()
        }
    }

    /** Google re-authentication uses the existing UID, not account switching by email. */
    fun google(activity: Context) = perform {
        if (!view.value.reauthenticating && account.identity() != null) relay.removeThisPhone()
        account.google(activity, view.value.reauthenticating)
        authenticated()
    }

    /** Email is requested only inside the consent flow. */
    fun chooseEmail() {
        val resendAt = account.emailResendAt()
        val page = if (resendAt > android.os.SystemClock.elapsedRealtime()) RelaySignInPage.CheckEmail else RelaySignInPage.Email
        update { it.copy(signIn = it.signIn.copy(page = page, resendAt = resendAt, problem = null)) }
    }

    /** Generic confirmation and monotonic resend deadline do not reveal account existence. */
    fun sendEmail(address: String, elapsed: Long) {
        if (view.value.signIn.resendSeconds(elapsed) > 0) return
        perform {
            account.sendEmail(address)
            update { it.copy(signIn = it.signIn.emailSent(elapsed)) }
        }
    }

    /** The email from the initiating phone is local-only. Cross-phone completion leaves it blank. */
    fun pendingEmail(): String = account.pendingEmail()

    /** Paste recovery and App Links converge on the same exact-host validator. */
    fun pasteLink() { update { it.copy(signIn = it.signIn.copy(page = RelaySignInPage.PasteLink)) } }

    /** The one-time link is not retained after the operation. */
    fun completeEmail(address: String, link: String) = perform {
        if (!view.value.reauthenticating && account.identity() != null) relay.removeThisPhone()
        account.emailLink(address, link, view.value.reauthenticating)
        app.relayEmailLink = null
        authenticated()
    }

    private suspend fun authenticated() {
        update { it.copy(identity = account.identity()) }
        if (view.value.reauthenticating) {
            update { it.copy(reauthenticating = false, confirmDeletion = true, signIn = it.signIn.copy(page = RelaySignInPage.On)) }
            return
        }
        update { it.copy(signIn = it.signIn.signedIn()) }
        relay.checkPhone(io.github.mitzacoder.aiki.features.notifications.FirebasePush.token())
        pollPhone()
    }

    /** Phone-check retries reuse durable plumbing rather than repeating sign-in. */
    fun retryPhone() = perform {
        relay.enrollment.restartChallenge()
        pollPhone()
    }

    /** Local-only polling for challenge completion; it makes no relay request. */
    suspend fun pollPhone() {
        if (!view.value.visible) return
        if (view.value.signIn.page == RelaySignInPage.On) {
            val phone = relay.snapshot()
            update { it.copy(phone = phone) }
            return
        }
        if (view.value.signIn.page != RelaySignInPage.CheckingPhone) return
        val phone = relay.snapshot()
        update { it.copy(phone = phone) }
        if (view.value.visible && phone.activeToken != null && phone.enrollment == null && phone.failure == null) {
            app.repository.setNotifications { it.copy(enabled = true, relayEnabled = true,
                relayRecoveryRequired = false, fcmToken = phone.activeToken) }
            relay.finishPhoneCheck()
            update { it.copy(signIn = it.signIn.phoneChecked(true)) }
            // Switching pages cancels the screen's polling effect. Inventory belongs to this settings session,
            // not to that effect, and must survive the CheckingPhone → On transition.
            scope.launch {
                try { loadAccount() }
                catch (error: CancellationException) { throw error }
                catch (_: Exception) { update { it.copy(message = "Could not refresh the phone list. Try again.") } }
            }
        }
    }

    private suspend fun loadAccount() {
        account.optIn()
        relay.accounts.status()
        val inventory = relay.phones()
        val snapshot = relay.snapshot()
        if (snapshot.accountDeleted || snapshot.accountDisabled) {
            app.repository.setNotifications { it.copy(relayEnabled = false, relayRecoveryRequired = true) }
        }
        update { it.copy(signIn = it.signIn.phoneChecked(true), identity = account.identity(), phone = snapshot,
            phones = (inventory as? RelayResult.Success)?.value ?: it.phones,
            message = (inventory as? RelayResult.Failure)?.let { problem -> relayProblemText(problem.code, problem.retryAfterSeconds) }) }
    }

    /** A full account still permits inventory/removal without a successful possession challenge. */
    fun refreshPhones() = perform {
        val inventory = relay.phones()
        update { it.copy(phones = (inventory as? RelayResult.Success)?.value ?: it.phones,
            message = (inventory as? RelayResult.Failure)?.let { problem -> relayProblemText(problem.code, problem.retryAfterSeconds) }) }
    }

    /** Removing another phone is separate from signing out of this phone. */
    fun removePhone(id: String) = perform {
        when (val result = relay.removePhone(id)) {
            is RelayResult.Failure -> update { it.copy(message = relayProblemText(result.code, result.retryAfterSeconds)) }
            is RelayResult.Success -> {
                if (id == relay.snapshot().installationId) turnOffNow()
                else update { it.copy(phones = it.phones.filterNot { phone -> phone.installationId == id }) }
            }
        }
    }

    private suspend fun turnOffNow() {
        relay.routes.turnOff()
        app.repository.setNotifications { it.copy(relayEnabled = false, enabled = false, fcmToken = null) }
        NotificationManagerCompat.from(app).cancelAll()
        update { it.copy(signIn = RelaySignInState(), message = "Relay notifications are off. Your account is kept.") }
    }

    /** Turn off keeps Firebase signed in, and removes local receive authority immediately. */
    fun turnOff() = perform { turnOffNow() }

    /** Backend device sign-ins and the account's other phones are left untouched. */
    fun signOut() = perform {
        RelayAccountLifecycle(
            removePhone = { relay.removeThisPhone() },
            turnOff = { turnOffNow() },
            clearNotifications = { NotificationManagerCompat.from(app).cancelAll() },
            signOut = { account.signOut() },
        ).signOutPhone()
        update { it.copy(identity = null, phones = emptyList(), phone = null, message = "Signed out on this phone.") }
    }

    /** A deletion always requires a fresh sign-in, even when the existing token is recent. */
    fun requestDeletion() {
        update { it.copy(reauthenticating = true, signIn = it.signIn.copy(page = RelaySignInPage.Consent),
            message = "Sign in again to delete the relay account on every phone. Backend projects and sign-ins stay unchanged.") }
    }

    /** Explicit confirmation follows fresh sign-in. Pending server cleanup is not presented as completed. */
    fun confirmDeletion() = perform {
        if (!view.value.deletionPending && !account.recentlyAuthenticated()) {
            throw RelaySignInException(RelaySignInProblem.RecentSignInRequired)
        }
        app.repository.setNotifications { it.copy(relayEnabled = false, enabled = false, fcmToken = null) }
        NotificationManagerCompat.from(app).cancelAll()
        val result = relay.accounts.delete()
        when (result) {
            is RelayResult.Failure -> update { it.copy(confirmDeletion = false, deletionPending = true,
                message = relayProblemText(result.code, result.retryAfterSeconds)) }
            is RelayResult.Success -> {
                val completed = result.value.state == RelayDeletionState.Deleted
                if (completed) account.signOut()
                update { it.copy(confirmDeletion = false, deletionPending = !completed,
                    identity = if (completed) null else it.identity,
                    signIn = RelaySignInState(), phones = if (completed) emptyList() else it.phones,
                    message = if (completed) "Relay account deleted. Backend projects and sign-ins are unchanged."
                        else "Account deletion pending. Sending is blocked. Retry to check that cleanup has finished.") }
            }
        }
    }
}
