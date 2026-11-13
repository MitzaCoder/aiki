package io.github.mitzacoder.aiki.features.tasks.media

import androidx.compose.foundation.layout.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import io.github.mitzacoder.aiki.features.chat.ArtifactMedia
import io.github.mitzacoder.aiki.features.chat.ArtifactThumb
import io.github.mitzacoder.aiki.features.chat.videoKey
import io.github.mitzacoder.aiki.navigation.ProjectScreenContext
import io.github.mitzacoder.aiki.protocol.Artifact
import kotlinx.coroutines.flow.Flow

/**
 * A video in a slide (web `MediaVideoSlide`): the existing player (resume place, speed, controls) once the slide is near
 * the one showing, its first frame before that. It pauses when the slide stops being the [active] one. [onPlayingChange]
 * tells whether it plays, so the viewer can carry on.
 */
@Composable
internal fun MediaVideoSlide(
    context: ProjectScreenContext,
    artifact: Artifact,
    active: Boolean,
    near: Boolean,
    onPlayingChange: (Boolean) -> Unit,
    seeks: Flow<Int>?,
    modifier: Modifier = Modifier,
    autoplay: Boolean = false,
) {
    val source = rememberMediaUrl(context, artifact, enabled = near)
    val url = source.value
    if (near && url != null) key(artifact.id) {
        Column(modifier.fillMaxSize()) {
            ArtifactMedia(
                url = url, refresh = { source.failed() }, memoryKey = videoKey(artifact.projectId, io.github.mitzacoder.aiki.features.chat.artifactVersionAddress(artifact)), seeks = seeks,
                autoplay = autoplay, active = active, onPlayingChange = onPlayingChange,
                frameModifier = Modifier.fillMaxWidth().weight(1f),
            )
        }
    } else ArtifactThumb(context, artifact, modifier.fillMaxSize(), duration = false)
}
