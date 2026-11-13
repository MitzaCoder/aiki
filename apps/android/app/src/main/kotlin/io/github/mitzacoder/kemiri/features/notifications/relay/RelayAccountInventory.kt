package io.github.mitzacoder.kemiri.features.notifications.relay

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.github.mitzacoder.kemiri.HarnessApplication
import io.github.mitzacoder.kemiri.features.notifications.relayLastAttemptText
import io.github.mitzacoder.kemiri.features.settings.*
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle

/** Locally sourced backend names never leave this phone in relay management requests. */
@Composable
internal fun RelayAccountInventory(view: RelaySettingsView, session: RelaySettingsSession) {
    val app = LocalContext.current.applicationContext as HarnessApplication
    val backends by app.repository.sessions.collectAsStateWithLifecycle()
    val notifications by app.notifications.states.collectAsStateWithLifecycle()
    Text("On", style = MaterialTheme.typography.titleLarge)
    view.identity?.let { Text("Signed in as ${it.email} with ${it.method}.") }
    Text("This phone", style = MaterialTheme.typography.titleMedium)
    view.phone?.failure?.let { Text(relayProblemText(it, view.phone.retryAfterSeconds)) }
    SettingsGroup(title = "Backends") {
        if (backends.isEmpty()) GroupNote("No backends yet.")
        backends.forEach { backend ->
            val connection by backend.client.state.collectAsStateWithLifecycle()
            val phone = view.phone
            val registration = phone?.routes?.values?.firstOrNull { it.backendKey == backend.config.key }
            val words = when {
                !connection.supports("fcm-relay-v1") -> "This backend does not support it"
                connection.hello?.auth?.sessionId.isNullOrBlank() -> "Waiting for you to sign in to the backend"
                phone?.accountDisabled == true || phone?.accountDeleted == true ||
                    phone?.accountStatus?.relayEnabled == false -> "Paused"
                phone?.backendDeletions?.any { it.backendKey == backend.config.key } == true -> "Cleanup pending"
                registration?.phase == RelayRoute.Phase.Active -> "Working"
                phone?.failure != null -> "Needs a refresh"
                else -> "Setting up"
            }
            var details by remember { mutableStateOf(false) }
            GroupRow {
                Text(backend.config.name, style = MaterialTheme.typography.titleSmall)
                Text(words)
                TextButton(onClick = { details = !details }) { Text(if (details) "Hide details" else "Details") }
                if (details) {
                    Text(registration?.leaseExpiresAt?.let { "Expires ${relayDate(it)}" } ?: "No expiry yet.")
                    Text(notifications[backend.config.key]?.device?.let(::relayLastAttemptText) ?: "No notification attempt yet.")
                }
            }
        }
    }
    SettingsGroup(title = "Today's use") {
        val quotas = view.phone?.accountStatus?.quotas.orEmpty()
        if (quotas.isEmpty()) GroupNote("No usage snapshot available. Limits still apply.")
        var moreLimits by remember { mutableStateOf(false) }
        relayVisibleQuotas(quotas, moreLimits).forEach { quota ->
            GroupRow {
                Text("${relayQuotaLabel(quota.budget)}: ${quota.remaining} left")
                Text(relayQuotaResetText(quota.resetAt), style = MaterialTheme.typography.bodySmall)
            }
        }
        if (quotas.isNotEmpty()) TextButton(onClick = { moreLimits = !moreLimits }) {
            Text(if (moreLimits) "Fewer limits" else "More limits")
        }
    }
    RelayPhones(view, session)
    RelayAccountActions(view, session)
}

/** Inventory is available even when this phone cannot enroll because the phone limit was reached. */
@Composable
internal fun RelayPhones(view: RelaySettingsView, session: RelaySettingsSession) {
    SettingsGroup(title = "Account's phones") {
        if (view.phones.isEmpty()) GroupNote("No phone list yet.")
        view.phones.forEachIndexed { index, phone ->
            GroupRow {
                Text(if (phone.installationId == view.phone?.installationId) "This phone" else "Phone ${index + 1}")
                Text("Added ${relayDate(phone.createdAt)}")
                TextButton(onClick = { session.removePhone(phone.installationId) }, enabled = !view.busy) { Text("Remove") }
            }
        }
    }
}

/** These actions have deliberately different scopes and do not sign out of any backend. */
@Composable
internal fun RelayAccountActions(view: RelaySettingsView, session: RelaySettingsSession) {
    SettingsGroup(title = "Relay account") {
        GroupRow {
            Text("Turn off keeps the account. Sign out affects only this phone. Delete affects every phone.")
            OutlinedButton(onClick = session::turnOff, enabled = !view.busy) { Text("Turn off") }
            OutlinedButton(onClick = session::signOut, enabled = !view.busy) { Text("Sign out") }
            TextButton(onClick = session::requestDeletion, enabled = !view.busy) { Text("Delete relay account") }
        }
    }
}

private fun relayDate(timestamp: Long): String = runCatching {
    DateTimeFormatter.ofLocalizedDateTime(FormatStyle.SHORT).format(Instant.ofEpochMilli(timestamp).atZone(ZoneId.systemDefault()))
}.getOrDefault("Unknown time")
