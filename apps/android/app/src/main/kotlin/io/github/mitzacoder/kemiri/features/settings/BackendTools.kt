package io.github.mitzacoder.kemiri.features.settings

import android.Manifest
import android.app.Activity
import android.content.Intent
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import io.github.mitzacoder.kemiri.data.*
import io.github.mitzacoder.kemiri.navigation.Destination
import io.github.mitzacoder.kemiri.protocol.*
import kotlinx.coroutines.launch

/** ZXing's CaptureActivity is optional until the integration build adds zxing-android-embedded. */
@Composable
fun ConnectScanner(onResult: (String) -> Unit) {
    val context = LocalContext.current
    var message by remember { mutableStateOf<String?>(null) }
    val scan = rememberLauncherForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        if (result.resultCode == Activity.RESULT_OK) result.data?.getStringExtra("SCAN_RESULT")?.let(onResult)
        else message = "Scan cancelled. You can paste a connect link below."
    }
    fun launchScanner() {
        runCatching {
            val activity = Class.forName("com.journeyapps.barcodescanner.CaptureActivity")
            scan.launch(Intent(context, activity).putExtra("SCAN_FORMATS", "QR_CODE").putExtra("BEEP_ENABLED", false).putExtra("PROMPT_MESSAGE", "Scan a Harness connect QR code"))
        }.onFailure { message = "QR scanner unavailable in this build. Paste a connect link below." }
    }
    val permission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (granted) launchScanner() else message = "Camera permission denied. Paste a connect link instead; no camera is required."
    }
    TextButton(onClick = { permission.launch(Manifest.permission.CAMERA) }) { Text("Scan connect QR") }
    message?.let { Text(it, style = MaterialTheme.typography.bodySmall) }
}

@Composable
fun ProjectDirectoryBrowser(backend: BackendSession, navigate: (Destination) -> Unit, onError: (String?) -> Unit) {
    val scope = rememberCoroutineScope()
    var path by rememberSaveable(backend.config.key) { mutableStateOf("") }
    var listing by remember { mutableStateOf<FilesystemListResponse?>(null) }
    var hidden by rememberSaveable { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    fun browse(next: String?) {
        scope.launch {
            busy = true
            try { listing = backend.client.request(FilesystemListRequest(path = next, showHidden = hidden)); path = listing!!.path; onError(null) }
            catch (e: Exception) { onError(e.message) }
            finally { busy = false }
        }
    }
    HorizontalDivider()
    Text("Projects", style = MaterialTheme.typography.titleSmall)
    Text("Choose a directory on this backend, not on your device.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    OutlinedTextField(path, { path = it }, label = { Text("Project directory on backend") }, modifier = Modifier.fillMaxWidth())
    Row {
        TextButton(enabled = !busy, onClick = { browse(path.ifBlank { null }) }) { Text("Browse") }
        TextButton(enabled = !busy && path.isNotBlank(), onClick = {
            scope.launch {
                busy = true
                try {
                    val added = backend.client.request(ProjectsAddRequest(path = path))
                    backend.refreshProjects()
                    navigate(Destination.Chat(backend.config.key, added.project.id))
                } catch (e: Exception) { onError(e.message) }
                finally { busy = false }
            }
        }) { Text("Add project here") }
    }
    listing?.let { files ->
        Row {
            TextButton(enabled = !busy && files.parent != null, onClick = { browse(files.parent) }) { Text("Up") }
            TextButton(enabled = !busy, onClick = { browse(files.home) }) { Text("Home") }
            Switch(hidden, { hidden = it; browse(files.path) }, enabled = !busy)
            Text("Hidden", Modifier.padding(top = 12.dp))
        }
        if (files.truncated) Text("Directory list truncated. Enter a path directly to reach other folders.")
        files.projectId?.let { id -> TextButton(onClick = { navigate(Destination.Chat(backend.config.key, id)) }) { Text("Open existing project") } }
        if (files.entries.isEmpty()) Text("No subdirectories here. You can add this directory as a project.", style = MaterialTheme.typography.bodySmall)
        files.entries.forEach { entry ->
            TextButton(enabled = !busy, onClick = { browse(entry.path) }, modifier = Modifier.fillMaxWidth()) {
                Text(entry.name + if (entry.projectId != null) " · project" else if (entry.isRepo) " · repository" else "", modifier = Modifier.weight(1f))
                Text("›")
            }
        }
        TextButton(onClick = { listing = null }) { Text("Close browser") }
    }
    if (busy) LinearProgressIndicator(Modifier.fillMaxWidth())
}
