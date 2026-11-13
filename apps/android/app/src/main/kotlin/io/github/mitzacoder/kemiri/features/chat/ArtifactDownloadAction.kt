package io.github.mitzacoder.kemiri.features.chat

import android.provider.DocumentsContract
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.material3.*
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.width
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import io.github.mitzacoder.kemiri.ui.components.Lucide
import io.github.mitzacoder.kemiri.ui.components.LucideGlyph
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.platform.LocalContext
import io.github.mitzacoder.kemiri.data.request
import io.github.mitzacoder.kemiri.navigation.ProjectScreenContext
import io.github.mitzacoder.kemiri.protocol.Artifact
import io.github.mitzacoder.kemiri.protocol.ArtifactsUrlRequest
import kotlinx.coroutines.*
import okhttp3.OkHttpClient

private val downloadHttp = OkHttpClient.Builder().build()

/** SAF is an explicit user save: only file contents reach the selected document, never its signed URL. */
@Composable internal fun ArtifactDownloadAction(context: ProjectScreenContext, artifact: Artifact?, viewerArtifactId: String, canSave: Boolean) {
    val resolver = LocalContext.current.contentResolver
    val scope = rememberCoroutineScope()
    var targetBackend by rememberSaveable { mutableStateOf<String?>(null) }
    var targetProject by rememberSaveable { mutableStateOf<String?>(null) }
    var targetArtifact by rememberSaveable { mutableStateOf<String?>(null) }
    var selecting by rememberSaveable { mutableStateOf(false) }
    var saving by remember { mutableStateOf(false) }
    var status by remember { mutableStateOf<String?>(null) }
    val launcher = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("*/*")) { uri ->
        selecting = false
        val backend = targetBackend
        val project = targetProject
        val id = targetArtifact
        targetBackend = null; targetProject = null; targetArtifact = null
        if(uri != null) {
            saving = true
            scope.launch {
                var completed = false
                try {
                    check(artifactSaveTargetMatches(backend, project, id, context.backend.config.key, context.route.projectId, viewerArtifactId, canSave))
                    checkNotNull(project)
                    checkNotNull(id)
                    // Mint only after destination confirmation: expiry during the picker cannot break the save.
                    val count = saveArtifactWithRemint(downloadHttp, mint = {
                        context.backend.client.request(ArtifactsUrlRequest(projectId = project, artifactId = id, download = true)).url
                    }) {
                        checkNotNull(resolver.openOutputStream(uri,"wt")) { "Destination unavailable" }
                    }
                    completed = true
                    status = "Saved $count bytes."
                } catch(e: CancellationException) { throw e }
                catch(_: Exception) { status = "Save failed. Choose Save a copy to try again." }
                finally {
                    if(!completed) withContext(NonCancellable + Dispatchers.IO) {
                        // This document was just created by our picker; do not leave a corrupt partial file.
                        runCatching { DocumentsContract.deleteDocument(resolver,uri) }
                    }
                    saving = false
                }
            }
        }
    }
    OutlinedButton(enabled = canSave && artifact != null && !saving && !selecting,onClick = {
        val item = artifact ?: return@OutlinedButton
        targetBackend = context.backend.config.key; targetProject = item.projectId; targetArtifact = item.id
        status = null; selecting = true
        launcher.launch(artifactDownloadName(item.name))
    }) { LucideGlyph(Lucide.ArrowDown); Spacer(Modifier.width(6.dp)); Text(if(saving) "Saving…" else "Save a copy…") }
    status?.let { Text(it,style = MaterialTheme.typography.bodySmall) }
}
