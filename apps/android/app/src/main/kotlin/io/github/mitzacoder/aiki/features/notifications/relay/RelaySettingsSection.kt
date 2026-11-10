package io.github.mitzacoder.aiki.features.notifications.relay

import android.Manifest
import android.os.SystemClock
import androidx.activity.compose.LocalActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.github.mitzacoder.aiki.BuildConfig
import io.github.mitzacoder.aiki.HarnessApplication
import io.github.mitzacoder.aiki.data.HarnessRepository
import io.github.mitzacoder.aiki.features.notifications.canPostNotifications
import io.github.mitzacoder.aiki.features.notifications.needsNotificationPermission
import io.github.mitzacoder.aiki.features.settings.*
import kotlinx.coroutines.delay

/** Optional relay row. Nothing outside notification settings calls this sign-in UI. */
@Composable
internal fun RelaySettingsSection(repository: HarnessRepository) {
    val context = LocalContext.current
    val app = context.applicationContext as? HarnessApplication ?: return
    val activity = LocalActivity.current
    val scope = rememberCoroutineScope()
    val session = remember(app, scope) { RelaySettingsSession(app, scope) }
    val view by session.view.collectAsStateWithLifecycle()
    DisposableEffect(session) { onDispose { session.abandon() } }
    val settings by repository.settings.collectAsStateWithLifecycle()
    var afterPermission by remember { mutableStateOf<(() -> Unit)?>(null) }
    var permissionMessage by remember { mutableStateOf<String?>(null) }
    val permission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { allowed ->
        val action = afterPermission
        afterPermission = null
        if (allowed) action?.invoke()
        else permissionMessage = "Android blocks notifications. Allow them in the app's system settings, then try again."
    }
    fun withPermission(action: () -> Unit) {
        if (!needsNotificationPermission || canPostNotifications(context)) action()
        else {
            afterPermission = action
            permission.launch(Manifest.permission.POST_NOTIFICATIONS)
        }
    }
    SettingsGroup(title = "Relay notifications") {
        SettingsRow(
            "Phone notifications through the relay",
            hint = session.unavailableReason ?: "Encrypted notifications from your backends. Needs an optional relay account.",
            control = RowControl.Inline,
            learn = { RelayPrivacyText() },
            below = {
                if (settings.notifications.relayRecoveryRequired) {
                    Text("Relay notifications need a refresh. Turn them on again. Backend sign-in is unchanged.")
                }
                if (settings.notifications.relayEnabled) {
                    TextButton(onClick = session::open) { Text("Relay account and phones") }
                }
            },
        ) {
            SettingsSwitch(settings.notifications.relayEnabled, { session.open() },
                "Phone notifications through the relay", enabled = session.unavailableReason == null)
        }
    }
    if (view.visible) {
        Dialog(onDismissRequest = session::close, properties = DialogProperties(usePlatformDefaultWidth = false)) {
            Surface(modifier = Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
                Column(Modifier.safeDrawingPadding().imePadding().verticalScroll(rememberScrollState()).padding(20.dp),
                    verticalArrangement = Arrangement.spacedBy(20.dp)) {
                    TextButton(onClick = session::close) {
                        Text(if (view.signIn.page == RelaySignInPage.On) "Done" else "Not now")
                    }
                    RelaySignInContent(session, view, permissionMessage,
                        onGoogle = { withPermission { activity?.let(session::google) } },
                        onEmail = { withPermission(session::chooseEmail) })
                }
            }
        }
    }
    LaunchedEffect(view.visible, view.signIn.page) {
        while (view.visible && view.signIn.page in setOf(RelaySignInPage.CheckingPhone, RelaySignInPage.On)) {
            delay(750)
            session.pollPhone()
        }
    }
    LaunchedEffect(app.relayEmailLink, view.visible, view.signIn.page) {
        if (app.relayEmailLink != null && view.visible &&
            view.signIn.page in setOf(RelaySignInPage.CheckEmail, RelaySignInPage.Email)) session.pasteLink()
    }
}

/** Consent is shown before any sign-in, not hidden in a policy link after account creation. */
@Composable
internal fun RelayPrivacyText() {
    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Text("• The operator's Firebase project stores your email and account identity.")
        Text("• Google sign-in may share your name and photo. Aiki does not use them.")
        Text("• Your backend encrypts notification content for this phone. The relay and Google cannot read it.")
        Text("• The relay and Google see network addresses, timing and message sizes. " +
            "The operator can link your phones and activity.")
        Text("• There are limits. The operator can disable an account or pause the service.")
        Text("• You can delete the account here. Turning notifications off or signing out keeps the account. " +
            "Cleanup may be pending; sent messages and provider logs cannot be recalled.")
        Text("The rest of Aiki works without a relay account.")
        if (BuildConfig.RELAY_PRIVACY_CONTACT.isNotBlank()) Text("Privacy contact: ${BuildConfig.RELAY_PRIVACY_CONTACT}")
    }
}

@Composable
private fun RelaySignInContent(session: RelaySettingsSession, view: RelaySettingsView, permissionMessage: String?,
    onGoogle: () -> Unit, onEmail: () -> Unit) {
    var address by remember { mutableStateOf(session.pendingEmail()) }
    val context = LocalContext.current
    val app = context.applicationContext as HarnessApplication
    var pasted by remember(app.relayEmailLink) { mutableStateOf(app.relayEmailLink.orEmpty()) }
    var elapsed by remember { mutableLongStateOf(SystemClock.elapsedRealtime()) }
    LaunchedEffect(view.signIn.resendAt) {
        while (view.signIn.resendSeconds(elapsed) > 0) {
            delay(1000)
            elapsed = SystemClock.elapsedRealtime()
        }
    }
    val cooldown = view.signIn.resendSeconds(elapsed)
    val problem = view.signIn.problem?.message ?: permissionMessage
    Text(if (view.reauthenticating) "Sign in again to delete your account" else "Relay notifications",
        style = MaterialTheme.typography.headlineSmall)
    if (view.busy) LinearProgressIndicator(Modifier.fillMaxWidth())
    problem?.let { Text(it, color = MaterialTheme.colorScheme.error) }
    view.message?.let { Text(it) }
    when (view.signIn.page) {
        RelaySignInPage.Consent -> {
            RelayPrivacyText()
            Button(onClick = onGoogle, enabled = !view.busy, modifier = Modifier.fillMaxWidth()) { Text("Continue with Google") }
            OutlinedButton(onClick = onEmail, enabled = !view.busy, modifier = Modifier.fillMaxWidth()) {
                Text("Continue with email")
            }
        }
        RelaySignInPage.Email -> {
            Text("We will send a sign-in link. Aiki does not store a password.")
            OutlinedTextField(address, { address = it }, label = { Text("Email address") }, singleLine = true,
                modifier = Modifier.fillMaxWidth())
            Button(onClick = { session.sendEmail(address, SystemClock.elapsedRealtime()) },
                enabled = !view.busy && address.contains('@')) { Text("Send sign-in link") }
            TextButton(onClick = session::pasteLink) { Text("I already have a link") }
        }
        RelaySignInPage.CheckEmail -> {
            Text("Check your email on this phone", style = MaterialTheme.typography.titleLarge)
            Text("If this address can sign in, a link was sent. Open it on this phone, then return here.")
            OutlinedButton(onClick = { session.sendEmail(address, SystemClock.elapsedRealtime()) },
                enabled = !view.busy && cooldown == 0L) { Text(if (cooldown > 0) "Resend in ${cooldown}s" else "Resend link") }
            TextButton(onClick = session::pasteLink) { Text("Paste the link instead") }
        }
        RelaySignInPage.PasteLink -> {
            Text("Copy the whole sign-in link. If you started on another phone, enter the same email address.")
            OutlinedTextField(address, { address = it }, label = { Text("Email address") }, singleLine = true,
                modifier = Modifier.fillMaxWidth())
            OutlinedTextField(pasted, { pasted = it }, label = { Text("Sign-in link") }, singleLine = true,
                visualTransformation = androidx.compose.ui.text.input.PasswordVisualTransformation(),
                modifier = Modifier.fillMaxWidth())
            Button(onClick = {
                session.completeEmail(address, pasted)
                pasted = ""
            },
                enabled = !view.busy && address.contains('@') && pasted.isNotBlank()) { Text("Finish sign-in") }
        }
        RelaySignInPage.CheckingPhone, RelaySignInPage.SigningIn -> {
            Text("Setting up this phone", style = MaterialTheme.typography.titleLarge)
            Text("The relay is checking that notifications can reach this phone. Keep this screen open.")
            view.phone?.failure?.let { Text(relayProblemText(it, view.phone.retryAfterSeconds)) }
            OutlinedButton(onClick = session::retryPhone, enabled = !view.busy) { Text("Retry phone check") }
            if (view.phone?.failure == RelayErrorCode.PhoneLimit) {
                TextButton(onClick = session::refreshPhones, enabled = !view.busy) { Text("Show phones to remove") }
                RelayPhones(view, session)
            }
        }
        RelaySignInPage.On -> RelayAccountInventory(view, session)
        RelaySignInPage.Off -> {
            view.identity?.let { Text("Signed in as ${it.email} with ${it.method}.") }
            if (view.identity != null) RelayAccountActions(view, session)
        }
    }
    if (view.confirmDeletion) {
        AlertDialog(onDismissRequest = {}, title = { Text("Delete relay account on every phone?") },
            text = {
                Text("This removes your relay account and all phones' relay notifications. " +
                    "Backend projects and sign-ins stay unchanged. Sent messages and provider logs cannot be recalled.")
            },
            confirmButton = {
                TextButton(onClick = session::confirmDeletion, enabled = !view.busy) { Text("Delete relay account") }
            },
            dismissButton = { TextButton(onClick = session::close, enabled = !view.busy) { Text("Keep account") } })
    }
    if (view.deletionPending) Button(onClick = session::confirmDeletion, enabled = !view.busy) { Text("Check deletion progress") }
}
