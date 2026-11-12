package io.github.mitzacoder.aiki.features.status

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.github.mitzacoder.aiki.data.BackendSession
import io.github.mitzacoder.aiki.data.request
import io.github.mitzacoder.aiki.protocol.ReleaseUpdateState
import io.github.mitzacoder.aiki.protocol.ReleaseUpdatesSetRequest
import io.github.mitzacoder.aiki.features.settings.SettingsGroup
import io.github.mitzacoder.aiki.features.settings.GroupNote
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch

const val RELEASE_UPDATES_FEATURE = "release-updates"
const val UPDATE_INSTRUCTIONS = "Stop Aiki, then aiki update, then start it."

fun visibleReleaseUpdate(state: ReleaseUpdateState?): Boolean =
    state?.schemaVersion == 1L && state.enabled && state.available != null && state.available.version != state.dismissedVersion

/** The same backend-wide preference and dismissal on every project and device. */
@Composable
fun ReleaseUpdateBanner(backend: BackendSession) {
    val connection by backend.client.state.collectAsStateWithLifecycle()
    val status by backend.serverStatus.status.collectAsStateWithLifecycle()
    if (!connection.supports(RELEASE_UPDATES_FEATURE)) return
    val updates = status?.updates
    if (!visibleReleaseUpdate(updates)) return
    val release = updates?.available ?: return
    val scope = rememberCoroutineScope()
    var error by remember { mutableStateOf<String?>(null) }
    ToneBanner(null) {
        Text("Aiki ${release.version} is available.", style = MaterialTheme.typography.bodySmall)
        SelectionContainer { Text(UPDATE_INSTRUCTIONS, style = MaterialTheme.typography.bodySmall) }
        Row {
            ReleaseNotesButton(release.notesUrl)
            TextButton(onClick = {
                scope.launch {
                    try { backend.client.request(ReleaseUpdatesSetRequest(dismissVersion = release.version)); backend.serverStatus.refresh() }
                    catch (e: CancellationException) { throw e }
                    catch (_: Exception) { error = "Could not dismiss. Try again when connected." }
                }
            }, modifier = Modifier.heightIn(min = 48.dp)) { Text("Dismiss update notice") }
        }
        error?.let { Text(it, style = MaterialTheme.typography.bodySmall) }
    }
}

@Composable
private fun ReleaseNotesButton(url: String) {
    val uri = LocalUriHandler.current
    TextButton(onClick = { uri.openUri(url) }, modifier = Modifier.heightIn(min = 48.dp)) { Text("Release notes") }
}

@Composable
fun ReleaseUpdateAbout(backend: BackendSession) {
    val connection by backend.client.state.collectAsStateWithLifecycle()
    val status by backend.serverStatus.status.collectAsStateWithLifecycle()
    if (!connection.supports(RELEASE_UPDATES_FEATURE)) return
    val updates = status?.updates?.takeIf { it.schemaVersion == 1L } ?: return
    val scope = rememberCoroutineScope()
    var saving by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    SettingsGroup(title = backend.config.name) {
        GroupNote(updates.installedVersion?.let { "Installed $it · ${updates.channel} channel" } ?: "Source checkout · checks off by default")
        Row(Modifier.fillMaxWidth().padding(horizontal = 12.dp).heightIn(min = 48.dp)) {
            Text("Check for Aiki updates", Modifier.weight(1f).padding(vertical = 12.dp))
            Switch(modifier = Modifier.semantics { contentDescription = "Check for Aiki updates" }, checked = updates.enabled, enabled = !saving, onCheckedChange = { enabled ->
                saving = true
                scope.launch {
                    try { backend.client.request(ReleaseUpdatesSetRequest(enabled = enabled)); backend.serverStatus.refresh(); error = null }
                    catch (e: CancellationException) { throw e }
                    catch (_: Exception) { error = "Could not save update checks. Try again when connected." }
                    finally { saving = false }
                }
            })
        }
        GroupNote("Checks public GitHub releases about once a day. Does not install or restart anything.")
        if (updates.enabled) {
            val release = updates.available
            if (release != null) {
                GroupNote("Aiki ${release.version} is available.")
                ReleaseNotesButton(release.notesUrl)
                SelectionContainer { GroupNote(UPDATE_INSTRUCTIONS) }
            } else GroupNote("No newer release found yet.")
        }
        error?.let { GroupNote(it) }
    }
}
