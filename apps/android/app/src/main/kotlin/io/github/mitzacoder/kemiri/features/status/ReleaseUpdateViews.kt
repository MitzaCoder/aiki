package io.github.mitzacoder.kemiri.features.status

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
import io.github.mitzacoder.kemiri.data.BackendSession
import io.github.mitzacoder.kemiri.data.request
import io.github.mitzacoder.kemiri.protocol.ReleaseUpdateState
import io.github.mitzacoder.kemiri.protocol.ReleaseUpdatesSetRequest
import io.github.mitzacoder.kemiri.features.settings.SettingsGroup
import io.github.mitzacoder.kemiri.features.settings.GroupNote
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch

const val RELEASE_UPDATES_FEATURE = "release-updates"
const val UPDATE_INSTRUCTIONS = "Stop Kemiri, then kemiri update, then start it."

fun visibleReleaseUpdate(state: ReleaseUpdateState?): Boolean =
    state?.schemaVersion == 1L && state.enabled && state.available != null && state.available.version != state.dismissedVersion

@Composable
private fun ReleaseNotesButton(url: String) {
    val uri = LocalUriHandler.current
    TextButton(onClick = { uri.openUri(url) }, modifier = Modifier.heightIn(min = 48.dp)) { Text("Release notes") }
}

@Composable
fun ReleaseUpdateAbout(backend: BackendSession) {
    val connection by backend.client.state.collectAsStateWithLifecycle()
    val status by backend.serverStatus.status.collectAsStateWithLifecycle()
    val updates = status?.updates?.takeIf { connection.supports(RELEASE_UPDATES_FEATURE) && it.schemaVersion == 1L }
    val scope = rememberCoroutineScope()
    var saving by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    SettingsGroup(title = backend.config.name) {
        GroupNote("Kemiri ${backendVersion(connection.hello?.server?.version, status) ?: "—"}")
        if (updates == null) {
            GroupNote("Update checks are not available on this backend.")
            return@SettingsGroup
        }
        GroupNote(updates.installedVersion?.let { "Installed $it · ${updates.channel} channel" } ?: "Source checkout · checks off by default")
        Row(Modifier.fillMaxWidth().padding(horizontal = 12.dp).heightIn(min = 48.dp)) {
            Text("Check for Kemiri updates", Modifier.weight(1f).padding(vertical = 12.dp))
            Switch(modifier = Modifier.semantics { contentDescription = "Check for Kemiri updates" }, checked = updates.enabled, enabled = !saving, onCheckedChange = { enabled ->
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
                GroupNote("Kemiri ${release.version} is available.")
                ReleaseNotesButton(release.notesUrl)
                if (status?.selfUpdate?.enabled != true) SelectionContainer { GroupNote(UPDATE_INSTRUCTIONS) }
                if (updates.dismissedVersion != release.version) TextButton(onClick = {
                    saving = true
                    scope.launch {
                        try { backend.client.request(ReleaseUpdatesSetRequest(dismissVersion = release.version)); backend.serverStatus.refresh(); error = null }
                        catch (e: CancellationException) { throw e }
                        catch (_: Exception) { error = "Could not dismiss. Try again when connected." }
                        finally { saving = false }
                    }
                }, enabled = !saving, modifier = Modifier.heightIn(min = 48.dp)) { Text("Dismiss update notice") }
                else GroupNote("Update notice dismissed.")
            } else GroupNote("No newer release found yet.")
        }
        SelfUpdateControls(backend)
        error?.let { GroupNote(it) }
    }
}
