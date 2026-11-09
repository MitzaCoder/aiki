package com.mihaisaru.harness.features.chat

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.mihaisaru.harness.data.ConnectionStatus
import com.mihaisaru.harness.data.request
import com.mihaisaru.harness.navigation.ProjectScreenContext
import com.mihaisaru.harness.protocol.*
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.isActive

/** The one chat card playing its video in place; starting another stops it, as the web's play does. */
internal object InlineVideos {
    val playing = MutableStateFlow<Any?>(null)
    /** The video expanded while it played, by [videoKey]: the viewer plays on instead of opening paused. */
    private var expandedPlaying: String? = null

    fun expanded(key: String, playing: Boolean) { expandedPlaying = key.takeIf { playing } }
    fun playsOn(key: String): Boolean = (expandedPlaying == key).also { expandedPlaying = null }
}

/**
 * A video in a chat card (web `ArtifactVideo` with `compact`): its poster until tapped, then the compact player with
 * an expand button that opens [expand] (the viewer), which plays on when the video was playing. The place and speed are the viewer's ([VideoMemoryStore]). The
 * player lives only while the card is composed, so a card scrolled off the list releases it and shows the poster again.
 */
@Composable
internal fun InlineArtifactVideo(context: ProjectScreenContext, artifact: Artifact, heading: String, modifier: Modifier, expand: () -> Unit) {
    val token = remember { Any() }
    val current by InlineVideos.playing.collectAsState()
    val playing = current === token
    DisposableEffect(token) { onDispose { InlineVideos.playing.compareAndSet(token, null) } }
    val shape = RoundedCornerShape(12.dp)
    if (!playing) {
        WatchedThumb(context, artifact, modifier.fillMaxWidth().aspectRatio(16f / 9f).clip(shape)
            .clickable(role = Role.Button, onClickLabel = "Play $heading") { InlineVideos.playing.value = token })
        return
    }
    val client = context.backend.client
    val connection by client.state.collectAsStateWithLifecycle()
    var url by remember(artifact.id) { mutableStateOf<String?>(null) }
    var renewals by remember(artifact.id) { mutableIntStateOf(0) }
    var failed by remember(artifact.id) { mutableStateOf(false) }
    LaunchedEffect(client, artifact.id, connection.status == ConnectionStatus.Ready, renewals) {
        if (connection.status != ConnectionStatus.Ready) return@LaunchedEffect
        try {
            while (isActive) {
                val signed = client.request(ArtifactsUrlRequest(projectId = artifact.projectId, artifactId = artifact.id))
                url = signed.url; failed = false
                delay(artifactRefreshDelay(signed.expiresAt, System.currentTimeMillis()))
            }
        } catch (e: CancellationException) { throw e }
        catch (_: Exception) { failed = true }
    }
    val ready = url
    Box(modifier.fillMaxWidth()) {
        if (ready == null) {
            Box(Modifier.fillMaxWidth().aspectRatio(16f / 9f).clip(shape), contentAlignment = Alignment.Center) {
                ArtifactThumb(context, artifact, Modifier.fillMaxSize(), play = false)
                if (failed) TextButton(onClick = { renewals++ }) { Text("Could not load the video · Retry") }
                else CircularProgressIndicator(Modifier.size(28.dp), color = Color.White, strokeWidth = 2.dp)
            }
        } else Column {
            val key = videoKey(artifact.projectId, artifact.id)
            ArtifactMedia(ready, { renewals++ }, memoryKey = key, compact = true, autoplay = true,
                onExpand = { playing -> InlineVideos.expanded(key, playing); InlineVideos.playing.compareAndSet(token, null); expand() })
        }
    }
}
