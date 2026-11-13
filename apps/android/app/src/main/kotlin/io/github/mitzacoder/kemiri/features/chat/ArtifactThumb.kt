package io.github.mitzacoder.kemiri.features.chat

import android.graphics.Bitmap
import android.media.MediaMetadataRetriever
import android.util.LruCache
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.compositeOver
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.min
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import coil3.compose.AsyncImage
import coil3.request.CachePolicy
import coil3.request.ImageRequest
import io.github.mitzacoder.kemiri.data.ConnectionStatus
import io.github.mitzacoder.kemiri.data.request
import io.github.mitzacoder.kemiri.navigation.ProjectScreenContext
import io.github.mitzacoder.kemiri.protocol.Artifact
import io.github.mitzacoder.kemiri.protocol.ArtifactsUrlRequest
import io.github.mitzacoder.kemiri.ui.components.Lucide
import io.github.mitzacoder.kemiri.ui.components.LucideGlyph
import io.github.mitzacoder.kemiri.ui.components.LucideIcon
import io.github.mitzacoder.kemiri.ui.theme.Jarvis
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.sync.Semaphore
import kotlinx.coroutines.sync.withPermit
import kotlinx.coroutines.withContext

/** The web's artifact icons (`ArtifactKindIcon.svelte`) and the viewer's actions, where `Lucide` has none. */
internal object ArtifactGlyphs {
    val Video = LucideIcon("video", "m16 13 5.223 3.482a.5.5 0 0 0 .777-.416V7.87a.5.5 0 0 0-.752-.432L16 10.5", "M4 6h10a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2Z")
    val File = LucideIcon("file", "M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z", "M14 2v5a1 1 0 0 0 1 1h5")
    val Play = LucideIcon("play", "M5 5a2 2 0 0 1 3.008-1.728l11.997 6.998a2 2 0 0 1 .003 3.458l-12 7A2 2 0 0 1 5 20z")
    val Trash = LucideIcon("trash-2", "M10 11v6", "M14 11v6", "M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6", "M3 6h18", "M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2")
}

internal fun artifactKindIcon(kind: String): LucideIcon = when (kind) {
    "video" -> ArtifactGlyphs.Video
    "image" -> Lucide.Image
    "audio" -> Lucide.Music
    "text" -> Lucide.FileText
    else -> ArtifactGlyphs.File
}

/** A kind's colour, as the web's thumbnails tint their backgrounds and icons. */
@Composable internal fun artifactKindColor(kind: String): Color = when (kind) {
    "video" -> Jarvis.colors.accent2
    "image" -> Jarvis.colors.accent3
    "audio" -> Jarvis.colors.accent4
    else -> Jarvis.colors.fgMuted
}

/**
 * Videos' first frames, decoded once per process: pixels only, keyed by the artifact, never by its signed URL. At most
 * two decode at a time, so a screen full of thumbnails does not open a dozen media connections at once.
 */
internal object VideoPosters {
    private data class Key(val backend: String, val project: String, val id: String)
    private val frames = object : LruCache<Key, Bitmap>(24 * 1024 * 1024) {
        override fun sizeOf(key: Key, value: Bitmap) = value.allocationByteCount
    }
    private val decoders = Semaphore(2)

    fun cached(backend: String, project: String, id: String): Bitmap? = frames.get(Key(backend, project, id))

    /** The frame at 0.1 s (the web's `#t=0.1`), scaled to fit 640×360; null when the video cannot be read. */
    suspend fun load(backend: String, project: String, id: String, url: String): Bitmap? = decoders.withPermit {
        withContext(Dispatchers.IO) {
            val key = Key(backend, project, id)
            frames.get(key) ?: runCatching {
                val retriever = MediaMetadataRetriever()
                try {
                    retriever.setDataSource(url, emptyMap())
                    retriever.getScaledFrameAtTime(100_000, MediaMetadataRetriever.OPTION_CLOSEST_SYNC, 640, 360)
                } finally { retriever.release() }
            }.getOrNull()?.also { frames.put(key, it) }
        }
    }
}

/**
 * A small picture of an artifact (web `ArtifactThumb.svelte`): the image itself, a video's first frame with a play mark,
 * or the kind's icon on a background tinted by its kind; a video's or audio's length in the corner. It asks for its URL
 * only while composed, so a lazy list mints them for the rows on screen. The caller sizes and clips it.
 */
@Composable
internal fun ArtifactThumb(
    context: ProjectScreenContext,
    artifact: Artifact,
    modifier: Modifier = Modifier,
    duration: Boolean = true,
    play: Boolean = true,
) {
    val client = context.backend.client
    val backend = context.backend.config.key
    val contentId = artifactVersionAddress(artifact)
    val video = artifact.kind == "video"
    val pictured = video || artifact.kind == "image"
    val connection by client.state.collectAsStateWithLifecycle()
    val online = connection.status == ConnectionStatus.Ready
    var poster by remember(backend, artifact.projectId, contentId) { mutableStateOf(if (video) VideoPosters.cached(backend, artifact.projectId, contentId) else null) }
    var url by remember(backend, artifact.projectId, contentId) { mutableStateOf<String?>(null) }
    var failures by remember(backend, artifact.projectId, contentId) { mutableIntStateOf(0) }
    var renewals by remember(backend, artifact.projectId, contentId) { mutableIntStateOf(0) }
    var ready by remember(backend, artifact.projectId, contentId) { mutableStateOf(false) }
    LaunchedEffect(client, artifact.projectId, contentId, online, renewals) {
        if (!pictured || !online || poster != null) return@LaunchedEffect
        try {
            while (isActive) {
                val signed = client.request(ArtifactsUrlRequest(projectId = artifact.projectId, artifactId = contentId))
                if (video) {
                    poster = VideoPosters.load(backend, artifact.projectId, contentId, signed.url)
                    // A frame that would not decode asks for a fresh URL a bounded number of times, then keeps the icon.
                    if (poster != null || failures >= MEDIA_RETRY_LIMIT) return@LaunchedEffect
                    failures++
                    continue
                }
                url = signed.url
                delay(artifactRefreshDelay(signed.expiresAt, System.currentTimeMillis()))
            }
        } catch (e: CancellationException) { throw e }
        catch (_: Exception) { /* The kind's icon stays; a reconnect or a new composition tries again. */ }
    }
    val android = LocalContext.current
    val request = remember(android, url) {
        url?.let { ImageRequest.Builder(android).data(it).diskCachePolicy(CachePolicy.DISABLED).memoryCachePolicy(CachePolicy.DISABLED).build() }
    }
    val tint = artifactKindColor(artifact.kind)
    val base = tint.copy(alpha = .08f).compositeOver(Jarvis.colors.surface2)
    val length = if (duration) formatMediaDuration(artifact.durationSeconds) else ""
    BoxWithConstraints(
        modifier.background(base).background(Brush.radialGradient(listOf(tint.copy(alpha = .22f), Color.Transparent))),
        contentAlignment = Alignment.Center,
    ) {
        val pictureShown = (video && poster != null) || (!video && ready)
        if (!pictureShown) LucideGlyph(artifactKindIcon(artifact.kind), Modifier.alpha(.8f), size = min(28.dp, maxWidth * .38f).coerceAtLeast(14.dp), tint = tint)
        if (request != null && artifact.kind == "image") AsyncImage(
            model = request, contentDescription = null, contentScale = ContentScale.Crop,
            modifier = Modifier.fillMaxSize().alpha(if (ready) 1f else 0f),
            onSuccess = { ready = true; failures = 0 },
            onError = {
                ready = false
                if (failures < MEDIA_RETRY_LIMIT) { failures++; renewals++ }
            },
        )
        poster?.let { frame ->
            val bitmap = remember(frame) { frame.asImageBitmap() }
            Image(bitmap, contentDescription = null, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize())
        }
        if (video && play) {
            val size: Dp = min(36.dp, maxWidth * .42f)
            Box(Modifier.size(size).background(Color.Black.copy(alpha = .45f), CircleShape), contentAlignment = Alignment.Center) {
                LucideGlyph(ArtifactGlyphs.Play, Modifier.offset(x = size * .03f), size = size * .5f, tint = Color.White, filled = true)
            }
        }
        if (length.isNotEmpty()) Text(
            length,
            Modifier.align(Alignment.BottomEnd).padding(4.dp).background(Color.Black.copy(alpha = .6f), RoundedCornerShape(4.dp)).padding(horizontal = 4.dp),
            color = Color.White, fontFamily = FontFamily.Monospace, fontSize = 10.sp, lineHeight = 16.sp,
        )
    }
}
