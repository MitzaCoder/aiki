package io.github.mitzacoder.kemiri.features.settings

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.github.mitzacoder.kemiri.data.*
import io.github.mitzacoder.kemiri.features.status.*
import io.github.mitzacoder.kemiri.protocol.ProjectsStorageResponse
import io.github.mitzacoder.kemiri.protocol.StorageItem
import io.github.mitzacoder.kemiri.ui.components.LucideGlyph
import io.github.mitzacoder.kemiri.ui.theme.Jarvis
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch

/**
 * Project → Storage: what the project's worker and thread workspaces take on disk, largest first, with "Clean
 * up finished" and a remove button per finished one, both confirmed first. Running ones cannot be removed; the project's
 * own checkout is never touched. Shown only with the `storage` feature (web `StorageSection.svelte`).
 */
@Composable
internal fun StorageSection(backend: BackendSession, projectId: String) {
    val client = backend.client
    val connection by client.state.collectAsStateWithLifecycle()
    val ready = connection.status == ConnectionStatus.Ready
    val scope = rememberCoroutineScope()
    var storage by remember(projectId) { mutableStateOf<ProjectsStorageResponse?>(null) }
    var loading by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var notice by remember { mutableStateOf<CleanupNotice?>(null) }
    /** What the confirmation removes: null for every finished workspace, else one. */
    var confirm by remember { mutableStateOf<Pair<Boolean, StorageItem?>?>(null) }
    var cleaning by remember { mutableStateOf(false) }
    var cleanError by remember { mutableStateOf<String?>(null) }
    fun load() {
        if (!ready) return
        scope.launch {
            loading = true
            try { storage = client.readProjectStorage(projectId); error = null }
            catch (e: CancellationException) { throw e }
            catch (e: Exception) { error = e.message }
            finally { loading = false }
        }
    }
    LaunchedEffect(projectId, ready) { if (ready) load() }
    val items = storage?.items.orEmpty()
    val summary = cleanupSummary(items)
    SettingsSectionPage("Storage", "Finished workspaces and disk use.", SettingsIcon.HardDrive) {
        error?.let { ToneBanner(BannerTone.Error) { Text(it, style = MaterialTheme.typography.bodySmall) } }
        notice?.let { ToneBanner(if (it.warning) BannerTone.Warning else null) { Text(it.text, style = MaterialTheme.typography.bodySmall) } }
        SettingsGroup(title = "Disk use") {
            SettingsRow(
                storage?.let { storageSize(it.totalBytes) } ?: if (loading) "Measuring…" else "Not measured",
                hint = storage?.let { "in ${if (items.size == 1) "1 workspace" else "${items.size} workspaces"} · measured ${relativeTime(it.measuredAt, rememberNow())}" },
                control = RowControl.Auto,
                learn = { Text("Worker workspaces and background-thread checkouts live in the backend's data folder and can grow large. Finished ones are safe to remove; the project's own checkout is never touched.") },
            ) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                    OutlinedButton(onClick = { cleanError = null; confirm = true to null }, enabled = ready && summary.count > 0 && !cleaning, modifier = Modifier.heightIn(min = 44.dp)) {
                        LucideGlyph(StatusGlyphs.Trash, size = 16.dp); Spacer(Modifier.width(6.dp)); Text("Clean up finished")
                    }
                    IconButton(onClick = ::load, enabled = ready && !loading) {
                        if (loading) CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp)
                        else LucideGlyph(StatusGlyphs.RefreshCw, size = 18.dp, contentDescription = "Measure again")
                    }
                }
            }
        }
        SettingsGroup(title = "Workspaces") {
            if (storage != null && items.isEmpty()) GroupNote("No worker or thread workspaces on disk.")
            if (storage == null) GroupNote(if (loading) "Measuring…" else "Waiting for the backend…")
            items.forEach { item ->
                GroupRow {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                                SettingsBadge(storageKindLabel(item.kind))
                                Text(item.label, Modifier.weight(1f, fill = false), style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Medium, maxLines = 1, overflow = TextOverflow.Ellipsis)
                            }
                            Text(item.path, style = MaterialTheme.typography.labelSmall, fontFamily = FontFamily.Monospace, color = Jarvis.colors.fgMuted, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        }
                        Column(horizontalAlignment = Alignment.End, verticalArrangement = Arrangement.spacedBy(2.dp)) {
                            Text(storageSize(item.bytes), style = MaterialTheme.typography.bodySmall)
                            StatusChip(storageStateLabel(item), if (item.removable) ChipTone.Muted else ChipTone.Info, dot = false)
                        }
                        IconButton(onClick = { cleanError = null; confirm = false to item }, enabled = ready && item.removable && !cleaning) {
                            LucideGlyph(StatusGlyphs.Trash, size = 18.dp, contentDescription = if (item.removable) "Remove ${item.label}" else "${item.label} is still running; it cannot be removed")
                        }
                    }
                }
            }
        }
    }
    confirm?.let { (all, item) ->
        AlertDialog(
            onDismissRequest = { if (!cleaning) confirm = null },
            title = { Text(if (item != null) "Remove this workspace?" else "Clean up finished workspaces?") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(if (item != null) "${storageKindLabel(item.kind)} \"${item.label}\", ${storageSize(item.bytes)}. Its folder is deleted; its transcript and reports stay."
                    else "${summary.text}. Their folders are deleted; transcripts and reports stay.")
                    cleanError?.let { Text(it, color = Jarvis.colors.danger, style = MaterialTheme.typography.bodySmall) }
                    if (cleaning) LinearProgressIndicator(Modifier.fillMaxWidth())
                }
            },
            confirmButton = {
                Button(enabled = !cleaning, colors = ButtonDefaults.buttonColors(containerColor = Jarvis.colors.danger), onClick = {
                    scope.launch {
                        cleaning = true; cleanError = null
                        try {
                            val result = client.cleanProjectStorage(projectId, if (all) null else listOfNotNull(item?.id))
                            storage = storage?.let { withoutRemoved(it, result.removed) }
                            notice = cleanupNotice(result)
                            confirm = null
                            // Freed space shows on the machine line and lifts the chat's disk warning.
                            backend.serverStatus.refresh()
                        } catch (e: CancellationException) { throw e }
                        catch (e: Exception) { cleanError = e.message }
                        finally { cleaning = false }
                    }
                }) { Text(if (item != null) "Remove" else "Clean up") }
            },
            dismissButton = { TextButton(enabled = !cleaning, onClick = { confirm = null }) { Text("Cancel") } },
        )
    }
}
