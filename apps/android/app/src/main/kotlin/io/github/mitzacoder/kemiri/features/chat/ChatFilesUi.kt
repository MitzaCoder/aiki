package io.github.mitzacoder.kemiri.features.chat

import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import io.github.mitzacoder.kemiri.data.HarnessClient
import io.github.mitzacoder.kemiri.ui.theme.Jarvis
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

internal val LocalFileDownload = staticCompositionLocalOf<((ChatFile) -> Unit)?> { null }

@Composable
internal fun rememberFileDownload(client: HarnessClient, onError: (String) -> Unit): (ChatFile) -> Unit {
    val android = LocalContext.current
    val scope = rememberCoroutineScope()
    var pending by remember { mutableStateOf<ChatFile?>(null) }
    val picker = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("application/octet-stream")) { uri ->
        val file = pending; pending = null
        if (uri != null && file != null) scope.launch {
            try { withContext(Dispatchers.IO) {
                client.attachmentRequest(file.url).use { response -> android.contentResolver.openOutputStream(uri)?.use { output -> response.body.byteStream().use { it.copyTo(output) } } ?: error("Cannot save ${file.name}") }
            } } catch (e: Exception) { onError(e.message ?: "Download failed") }
        }
    }
    return { file -> pending = file; picker.launch(file.name) }
}

/** Same labels in history and composer. Every remove/download action has at least a 48dp target. */
@Composable
internal fun FileChips(files: List<ChatFile>, onRemove: ((String) -> Unit)? = null) {
    val download = LocalFileDownload.current
    Column(Modifier.fillMaxWidth().heightIn(max = 220.dp).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        files.forEach { file ->
            Surface(shape = MaterialTheme.shapes.medium, color = Jarvis.colors.surface2, border = androidx.compose.foundation.BorderStroke(1.dp, Jarvis.colors.border)) {
                Row(Modifier.fillMaxWidth(), verticalAlignment = androidx.compose.ui.Alignment.CenterVertically) {
                    val icon = when { file.mimeType.contains("zip") -> "ZIP"; file.mimeType.contains("pdf") -> "PDF"; file.mimeType.startsWith("text/") -> "TXT"; else -> "FILE" }
                    io.github.mitzacoder.kemiri.ui.components.LucideGlyph(if (icon == "ZIP") io.github.mitzacoder.kemiri.ui.components.Lucide.Archive else io.github.mitzacoder.kemiri.ui.components.Lucide.FileText, size = 18.dp, modifier = Modifier.padding(start = 12.dp, end = 8.dp))
                    if (onRemove != null) {
                        Column(Modifier.weight(1f).padding(vertical = 8.dp)) {
                            Text(file.name, maxLines = 1, overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis)
                            Text("${fileSizeLabel(file.size)} · ${file.mimeType}", style = MaterialTheme.typography.labelSmall, color = Jarvis.colors.fgSubtle)
                        }
                        TextButton(onClick = { onRemove(file.id) }, modifier = Modifier.sizeIn(minWidth = 48.dp, minHeight = 48.dp).semantics { contentDescription = "Remove ${file.name}" }) { Text("×") }
                    } else TextButton(onClick = { download?.invoke(file) }, modifier = Modifier.weight(1f).sizeIn(minHeight = 48.dp).semantics { contentDescription = "Download ${file.name}, ${fileSizeLabel(file.size)}" }) {
                        Column(Modifier.fillMaxWidth()) {
                            Text(file.name, maxLines = 1, overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis)
                            Text("${fileSizeLabel(file.size)} · ${file.mimeType}", style = MaterialTheme.typography.labelSmall)
                        }
                    }
                }
            }
        }
    }
}
