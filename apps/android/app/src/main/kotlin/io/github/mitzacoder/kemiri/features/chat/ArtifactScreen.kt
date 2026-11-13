package io.github.mitzacoder.kemiri.features.chat

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import io.github.mitzacoder.kemiri.ui.theme.Jarvis
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import coil3.compose.AsyncImage
import io.github.mitzacoder.kemiri.data.*
import io.github.mitzacoder.kemiri.ui.components.LucideGlyph
import io.github.mitzacoder.kemiri.navigation.ProjectScreenContext
import io.github.mitzacoder.kemiri.protocol.*
import kotlinx.coroutines.*
import okhttp3.OkHttpClient
import okhttp3.Request
import java.time.Instant

/** Signed URLs exist only in this composition. No disk/image cache, logging or saved-state tokens. */
@Composable
fun ArtifactScreen(context: ProjectScreenContext, artifactId: String, modifier: Modifier = Modifier) {
    var latestArtifact by remember(context.route,artifactId) { mutableStateOf<Artifact?>(null) }
    var selectedVersion by rememberSaveable(context.route,artifactId) { mutableStateOf<Long?>(null) }
    val artifact = latestArtifact?.let { selectedArtifactVersion(it, selectedVersion) }
    val versions = latestArtifact?.let(::artifactVersions).orEmpty()
    var signed by remember(context.route,artifactId) { mutableStateOf<ArtifactsUrlResponse?>(null) }
    var error by remember(context.route,artifactId) { mutableStateOf<String?>(null) }
    var text by remember(context.route,artifactId) { mutableStateOf<String?>(null) }
    var textTruncated by remember(context.route,artifactId) { mutableStateOf(false) }
    var refresh by remember(context.route,artifactId) { mutableIntStateOf(0) }
    var imageRevision by remember(context.route,artifactId) { mutableIntStateOf(0) }
    var imageAttempts by remember(context.route,artifactId) { mutableIntStateOf(0) }
    var imageError by remember(context.route,artifactId) { mutableStateOf<String?>(null) }
    var deleted by remember(context.route,artifactId) { mutableStateOf(false) }
    var deletion by remember(context.route,artifactId) { mutableStateOf(ArtifactDeleteState.Idle) }
    var actionStatus by remember(context.route,artifactId) { mutableStateOf<String?>(null) }
    var viewing by remember(context.route,artifactId) { mutableStateOf(false) }
    var videoDuration by remember(context.route,artifactId) { mutableStateOf<Double?>(null) }
    val seeks = remember(context.route,artifactId) { kotlinx.coroutines.flow.MutableSharedFlow<Int>(extraBufferCapacity = 1) }
    val scope = rememberCoroutineScope()
    val clipboard = androidx.compose.ui.platform.LocalClipboard.current
    fun copy(value: String) { scope.launch {
        clipboard.setClipEntry(androidx.compose.ui.platform.ClipEntry(android.content.ClipData.newPlainText("Artifact", value)))
        actionStatus = "Copied."
    } }
    fun discard() {
        ChatArtifactMetadata.remove(context.backend.config.key,context.route.projectId,artifactId)
        deleted = true; deletion = ArtifactDeleteState.Gone; signed = null; latestArtifact = null; text = null
        imageError = null; error = null; actionStatus = null
    }
    val connection by context.backend.client.state.collectAsStateWithLifecycle()
    val projects by context.backend.projects.collectAsStateWithLifecycle()
    val blockArtifactRequests = projects.find { it.id == context.route.projectId }?.let { it.blockArtifactRequests == true } ?: true
    LaunchedEffect(context.backend.client,artifactId) {
        context.backend.client.events.collect { event ->
            if(event is ArtifactsChangedEvent && event.projectId == context.route.projectId && event.artifact.id == artifactId) {
                if(event.deleted) { discard() } else if(!deleted) { ChatArtifactMetadata.keep(context.backend.config.key,event.artifact); latestArtifact = event.artifact; refresh++ }
            }
        }
    }
    LaunchedEffect(context.route,artifactId,connection,refresh,deleted,selectedVersion) {
        if(deleted || connection.status != ConnectionStatus.Ready) return@LaunchedEffect
        try {
            val cached = ChatArtifactMetadata.find(context.backend.config.key,context.route.projectId,artifactId)
            val recent = try {
                context.backend.client.request(ArtifactsListRequest(projectId = context.route.projectId,artifactId = artifactId)).artifacts
            } catch(e: CancellationException) { throw e }
            catch(_: Exception) { emptyList() }
            if (deleted) return@LaunchedEffect
            latestArtifact = recent.find { it.id == artifactId } ?: cached ?: artifactForViewing(context.route.projectId,artifactId,recent)
            if(latestArtifact!!.size >= 0) ChatArtifactMetadata.keep(context.backend.config.key,latestArtifact!!)
            val viewed = selectedArtifactVersion(latestArtifact!!, selectedVersion)
            signed = null
            text = null
            imageAttempts = 0
            imageError = null
            while(isActive) {
                val renewed = context.backend.client.request(ArtifactsUrlRequest(projectId = context.route.projectId,artifactId = viewed.id))
                if (deleted) return@LaunchedEffect
                signed = renewed
                imageRevision++
                error = null
                delay(artifactRefreshDelay(signed!!.expiresAt,System.currentTimeMillis()))
            }
        } catch(e: CancellationException) { throw e }
        catch(e: ClientException) {
            if(e.code == "unknown_artifact") { discard() }
            else error = "Could not load artifact. Reconnect or retry."
        }
        catch(_: Exception) { error = "Could not load artifact. Reconnect or retry." }
    }
    val lifecycle = androidx.lifecycle.compose.LocalLifecycleOwner.current.lifecycle
    DisposableEffect(lifecycle,artifactId) {
        val observer = androidx.lifecycle.LifecycleEventObserver { _, event ->
            if(event == androidx.lifecycle.Lifecycle.Event.ON_START) refresh++
        }
        lifecycle.addObserver(observer)
        onDispose { lifecycle.removeObserver(observer) }
    }
    LaunchedEffect(signed?.url,artifact?.kind) {
        text = null
        textTruncated = false
        val url = signed?.url ?: return@LaunchedEffect
        if(artifact?.kind == "text") {
            // An HTML page keeps only what a page may show whole; other text keeps the larger limit.
            val html = artifact?.let { isHtmlArtifact(it.name, it.mimeType) } == true
            try {
                val preview = withContext(Dispatchers.IO) {
                    artifactHttp.newCall(Request.Builder().url(url).build()).execute().use { response ->
                        check(response.isSuccessful)
                        artifactPreview(response.body.byteStream().readAtMost(ARTIFACT_TEXT_LIMIT + 1), html, artifact?.size ?: -1)
                    }
                }
                if (!deleted) { text = preview.text; textTruncated = preview.truncated }
            } catch(e: CancellationException) { textTruncated = false; throw e }
            catch(_: Exception) { textTruncated = false; error = "Text preview unavailable (limit 1 MiB)." }
        }
    }
    if (deletion == ArtifactDeleteState.Confirming || deletion == ArtifactDeleteState.Sending) {
        AlertDialog(onDismissRequest = { deletion = deletion.cancel() },
            title = { Text("Delete artifact?") },
            text = { Text("Delete ${artifact?.name ?: "this file"} from the backend? This cannot be undone. Copies you already saved are not removed.") },
            dismissButton = { TextButton(enabled = deletion != ArtifactDeleteState.Sending, onClick = { deletion = deletion.cancel() }) { Text("Keep it") } },
            confirmButton = { TextButton(enabled = deletion.canSubmit(connection.status == ConnectionStatus.Ready), onClick = {
                if (!deletion.canSubmit(connection.status == ConnectionStatus.Ready)) return@TextButton
                deletion = ArtifactDeleteState.Sending
                scope.launch {
                    try {
                        context.backend.client.request(ArtifactsDeleteRequest(projectId = context.route.projectId, artifactId = artifactId))
                        discard()
                    } catch (e: CancellationException) { throw e }
                    catch (e: Exception) {
                        if (e is ClientException && e.code == "unknown_artifact") discard()
                        else if (!deleted) {
                            deletion = ArtifactDeleteState.Idle
                            actionStatus = "Deletion was not confirmed. Refresh to check before trying again. It will not be retried automatically."
                        }
                    }
                }
            }) { Text(if(deletion == ArtifactDeleteState.Sending) "Deleting…" else "Delete", color = MaterialTheme.colorScheme.error) } })
    }
    // HTML is a document viewport, not media inside a scrolling details sheet. The caller supplies system insets.
    if (!deleted && artifact?.let { artifactUsesFullHeight(it.kind, it.name, it.mimeType) } == true) {
        var showDetails by remember(artifactId) { mutableStateOf(false) }
        if (showDetails) AlertDialog(
            onDismissRequest = { showDetails = false },
            title = { Text("Artifact details") },
            text = {
                Column(Modifier.heightIn(max = 420.dp).verticalScroll(rememberScrollState()),
                    verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    artifact?.let { ArtifactDetails(it, ::copy) }
                    actionStatus?.let { Text(it, style = MaterialTheme.typography.bodySmall) }
                }
            },
            confirmButton = { ArtifactDownloadAction(context, artifact, artifact?.id ?: artifactId, canSave = deletion != ArtifactDeleteState.Sending) },
            dismissButton = {
                Row {
                    TextButton(onClick = { showDetails = false; deletion = ArtifactDeleteState.Confirming },
                        colors = ButtonDefaults.textButtonColors(contentColor = MaterialTheme.colorScheme.error)) { Text("Delete") }
                    TextButton(onClick = { showDetails = false }) { Text("Close") }
                }
            },
        )
        Column(modifier.fillMaxSize()) {
            if (!deleted && versions.size > 1 && artifact != null) {
                val index = versions.indexOfFirst { it.id == artifact.id }
                Row(Modifier.fillMaxWidth().padding(horizontal = 12.dp), verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.Center) {
                    IconButton(enabled = index > 0, onClick = { selectedVersion = versions[index - 1].version; signed = null; text = null }) {
                        Text("←", modifier = Modifier.semantics { contentDescription = "Previous version" })
                    }
                    Text("v${artifact.version ?: 1} of ${latestArtifact?.versionCount ?: versions.size} · ${io.github.mitzacoder.kemiri.features.tasks.relativeTime(artifact.createdAt)}",
                        style = MaterialTheme.typography.bodySmall)
                    IconButton(enabled = index < versions.lastIndex, onClick = { selectedVersion = versions[index + 1].version; signed = null; text = null }) {
                        Text("→", modifier = Modifier.semantics { contentDescription = "Next version" })
                    }
                }
                HorizontalDivider(color = Jarvis.colors.border)
            }
            if (connection.status != ConnectionStatus.Ready) Text("Offline · reconnect to refresh or delete this artifact.",
                Modifier.padding(horizontal = 12.dp), style = MaterialTheme.typography.bodySmall)
            error?.let {
                Text(it, Modifier.padding(horizontal = 12.dp), color = MaterialTheme.colorScheme.error)
                TextButton(onClick = { refresh++ }) { Text("Retry") }
            }
            text?.let { loaded ->
                ArtifactTextPreview(artifact?.name ?: "Text", loaded, html = true, truncated = textTruncated,
                    size = artifact?.size ?: -1, blockRequests = blockArtifactRequests, fillHeight = true, modifier = Modifier.weight(1f),
                    copy = { copy(loaded) },
                    actions = {
                        IconButton(onClick = { showDetails = true }) {
                            LucideGlyph(io.github.mitzacoder.kemiri.ui.components.Lucide.Info, size = 18.dp,
                                contentDescription = "Artifact details")
                        }
                    })
            } ?: Box(Modifier.weight(1f).fillMaxWidth(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
        }
        return
    }
    // Other media keep the scrolling details sheet and its fixed download footer.
    Column(modifier.fillMaxSize()) {
            if (!deleted && versions.size > 1 && artifact != null) {
                val index = versions.indexOfFirst { it.id == artifact.id }
                Row(Modifier.fillMaxWidth().padding(horizontal = 12.dp), verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.Center) {
                    IconButton(enabled = index > 0, onClick = { selectedVersion = versions[index - 1].version; signed = null; text = null }) {
                        Text("←", modifier = Modifier.semantics { contentDescription = "Previous version" })
                    }
                    Text("v${artifact.version ?: 1} of ${latestArtifact?.versionCount ?: versions.size} · ${io.github.mitzacoder.kemiri.features.tasks.relativeTime(artifact.createdAt)}",
                        style = MaterialTheme.typography.bodySmall)
                    IconButton(enabled = index < versions.lastIndex, onClick = { selectedVersion = versions[index + 1].version; signed = null; text = null }) {
                        Text("→", modifier = Modifier.semantics { contentDescription = "Next version" })
                    }
                }
                HorizontalDivider(color = Jarvis.colors.border)
            }
        Column(Modifier.weight(1f).fillMaxWidth().verticalScroll(rememberScrollState()).padding(16.dp),verticalArrangement = Arrangement.spacedBy(12.dp)) {
            if (deleted) {
                Text("Artifact unavailable", style = MaterialTheme.typography.titleLarge)
                Text("This artifact was deleted or is no longer available. Saved copies are unchanged.")
                return@Column
            }
            if (connection.status != ConnectionStatus.Ready) Text("Offline · reconnect to refresh or delete this artifact.", style = MaterialTheme.typography.bodySmall)
            error?.let { Text(it,color = MaterialTheme.colorScheme.error); TextButton(onClick = { imageAttempts = 0; imageError = null; refresh++ }) { Text("Retry") } }
            imageError?.let {
                Text(it,color = MaterialTheme.colorScheme.error)
                TextButton(onClick = { imageAttempts = 0; imageError = null; refresh++ }) { Text("Retry image") }
            }
            val url = signed?.url
            if(url != null) when(artifact?.kind) {
                "image" -> {
                    val android = LocalContext.current
                    val request = remember(url,imageRevision) { coil3.request.ImageRequest.Builder(android).data(url).diskCachePolicy(coil3.request.CachePolicy.DISABLED).memoryCachePolicy(coil3.request.CachePolicy.DISABLED).build() }
                    if (viewing) ImageViewer(request, artifact?.let(::artifactTitle) ?: "Image") { viewing = false }
                    AsyncImage(model = request,contentDescription = "${artifact?.name}, opens full screen",modifier = Modifier.fillMaxWidth().heightIn(min = 180.dp, max = 480.dp)
                            .clip(RoundedCornerShape(16.dp)).clickable(onClickLabel = "Open full screen") { viewing = true },
                        onSuccess = { imageError = null; imageAttempts = 0 },
                        onError = {
                            imageError = "Image preview could not load."
                            if(imageCanRenew(imageAttempts)) { imageAttempts++; refresh++ }
                        })
                }
                "video" -> key(artifact?.id) {
                    val memoryKey = videoKey(context.route.projectId, artifact?.id ?: artifactId)
                    val playsOn = remember { InlineVideos.playsOn(memoryKey) }
                    ArtifactMedia(url, { refresh++ }, memoryKey = memoryKey, seeks = seeks, onDuration = { videoDuration = it }, autoplay = playsOn)
                }
                "audio" -> key(artifact?.id) { ArtifactMedia(url, { refresh++ }) }
                "text" -> text?.let { loaded ->
                    val markdown = artifact?.let { item -> isMarkdownArtifact(item.name, item.mimeType) } == true
                    val html = artifact?.let { item -> isHtmlArtifact(item.name, item.mimeType) } == true
                    ArtifactTextPreview(artifact?.name ?: "Text", loaded, markdown = markdown, html = html, truncated = textTruncated,
                        size = artifact?.size ?: -1, blockRequests = blockArtifactRequests, copy = { copy(loaded) })
                } ?: Text("Loading text…")
                else -> artifact?.let { ArtifactFileRow(it) }
            } else if(error == null) CircularProgressIndicator()
            if(artifact?.size == -1L) Text("Metadata is outside the recent list. You can still save this artifact by its ID.",style = MaterialTheme.typography.bodySmall)
            artifact?.let { item ->
                // A video's note links its times ("at 1:05") to the player.
                val linkers = LocalTextLinkers.current
                val noteStyles = noteTimeLinkStyles()
                val noteLinker = remember(videoDuration, noteStyles) { NoteTimeLinker(videoDuration, noteStyles) { seeks.tryEmit(it) } }
                if (item.kind == "video") CompositionLocalProvider(LocalTextLinkers provides listOf(noteLinker) + linkers) { ArtifactDetails(item, ::copy) }
                else ArtifactDetails(item, ::copy)
            }
            actionStatus?.let { Text(it, style = MaterialTheme.typography.bodySmall) }
        }
        if (!deleted) {
            HorizontalDivider(color = Jarvis.colors.border)
            Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
                TextButton(onClick = { deletion = ArtifactDeleteState.Confirming }, enabled = artifact != null && deletion != ArtifactDeleteState.Sending,
                    colors = ButtonDefaults.textButtonColors(contentColor = MaterialTheme.colorScheme.error), modifier = Modifier.semantics { contentDescription = "Delete artifact" }) {
                    LucideGlyph(ArtifactGlyphs.Trash, size = 16.dp); Spacer(Modifier.width(6.dp)); Text("Delete")
                }
                Spacer(Modifier.weight(1f))
                Column(horizontalAlignment = Alignment.End) { ArtifactDownloadAction(context, artifact, artifact?.id ?: artifactId, canSave = deletion != ArtifactDeleteState.Sending) }
            }
        }
    }
}
private val artifactHttp = OkHttpClient.Builder().build()
internal fun artifactRefreshDelay(expiresAt: String, now: Long): Long {
    val expires = runCatching { Instant.parse(expiresAt).toEpochMilli() }.getOrDefault(now + 60000)
    return (expires - now - 5000).coerceIn(1000,3600000)
}
