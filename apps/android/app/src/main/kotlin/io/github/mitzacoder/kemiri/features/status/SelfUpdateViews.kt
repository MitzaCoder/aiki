package io.github.mitzacoder.kemiri.features.status

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.github.mitzacoder.kemiri.data.BackendSession
import io.github.mitzacoder.kemiri.data.request
import io.github.mitzacoder.kemiri.protocol.ServerUpdateRequest
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch

fun selfUpdateInProgress(phase: String?): Boolean = phase in listOf("preparing", "waiting", "restarting", "checking")

/** Updates the selected backend, never the APK. Server persists progress across reconnects. */
@Composable
fun SelfUpdateControls(backend: BackendSession, compact: Boolean = false) {
    val status by backend.serverStatus.status.collectAsStateWithLifecycle()
    val update = status?.selfUpdate
    val available = status?.updates?.available
    val scope = rememberCoroutineScope()
    val uri = LocalUriHandler.current
    var confirmation by remember { mutableStateOf<String?>(null) }
    var confirmedVersion by remember { mutableStateOf("") }
    var confirmedFromVersion by remember { mutableStateOf("") }
    var confirmedNotesUrl by remember { mutableStateOf("") }
    var saving by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    fun ask(action: String) {
        confirmedVersion = if (action == "start") available?.version.orEmpty() else update?.toVersion.orEmpty()
        confirmedFromVersion = status?.updates?.installedVersion ?: update?.fromVersion.orEmpty()
        confirmedNotesUrl = if (action == "start") available?.notesUrl.orEmpty() else update?.notesUrl.orEmpty()
        confirmation = action
    }
    fun request(action: String, version: String) {
        confirmation = null
        saving = true
        scope.launch {
            try {
                backend.client.request(ServerUpdateRequest(action = action, version = version))
                backend.serverStatus.refresh()
                error = null
            } catch (e: CancellationException) { throw e }
            catch (e: Exception) { error = e.message ?: "Could not request update. Reconnect and try again." }
            finally { saving = false }
        }
    }
    Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        if (selfUpdateInProgress(update?.phase)) {
            Text(update?.message.orEmpty(), style = MaterialTheme.typography.bodySmall)
            if (update?.phase == "waiting") {
                TextButton(onClick = { request("cancel", update.toVersion) }, enabled = !saving) { Text("Cancel") }
                if (update.restartAllowed == true) TextButton(onClick = { ask("force") }, enabled = !saving) { Text("Restart anyway") }
            }
        } else {
            if (update?.phase in listOf("succeeded", "rolled_back", "failed", "cancelled")) Text(update?.message.orEmpty(), style = MaterialTheme.typography.bodySmall)
            if (available != null && update?.enabled == true) Button(onClick = { ask("start") }, enabled = !saving) { Text("Update now") }
            else if (!compact) update?.disabledReason?.let { Text(it, style = MaterialTheme.typography.bodySmall) }
        }
        error?.let { Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall) }
    }
    confirmation?.let { action ->
        AlertDialog(
            onDismissRequest = { confirmation = null },
            title = { Text(if (action == "force") "Interrupt running commands?" else "Update Kemiri?") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    Text("${backend.config.name}: $confirmedFromVersion → $confirmedVersion")
                    Text(if (action == "force") "Running commands will be interrupted and may not be safe to retry. Restart anyway?" else "The release will be verified, then Kemiri holds new tool calls and waits only for running commands before restarting. Clients reconnect automatically.")
                    Text("If the new release is not healthy within 30 seconds, Kemiri restores the old code. This does not undo data migrations. Back up important data first.")
                    TextButton(onClick = { uri.openUri(confirmedNotesUrl) }) { Text("Release notes") }
                }
            },
            confirmButton = { TextButton(onClick = { request(action, confirmedVersion) }, enabled = !saving) { Text(if (action == "force") "Confirm restart" else "Confirm update") } },
            dismissButton = { TextButton(onClick = { confirmation = null }) { Text("Cancel") } },
        )
    }
}
