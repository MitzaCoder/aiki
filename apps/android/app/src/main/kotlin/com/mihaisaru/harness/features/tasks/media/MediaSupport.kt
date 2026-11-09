package com.mihaisaru.harness.features.tasks.media

import android.content.Context
import androidx.compose.runtime.*
import androidx.compose.ui.layout.LayoutCoordinates
import androidx.compose.ui.layout.positionOnScreen
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import coil3.memory.MemoryCache
import coil3.request.CachePolicy
import coil3.request.ImageRequest
import com.mihaisaru.harness.data.ConnectionStatus
import com.mihaisaru.harness.data.request
import com.mihaisaru.harness.features.chat.MEDIA_RETRY_LIMIT
import com.mihaisaru.harness.features.chat.artifactRefreshDelay
import com.mihaisaru.harness.navigation.ProjectScreenContext
import com.mihaisaru.harness.protocol.Artifact
import com.mihaisaru.harness.protocol.ArtifactsUrlRequest
import com.mihaisaru.harness.ui.components.LucideIcon
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive

/** Lucide icons the carousel needs that `Lucide` does not have (@lucide/svelte, ISC license; see LUCIDE-LICENSE.txt). */
internal object MediaIcons {
    val Tag = LucideIcon("tag", "M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z", "M7.5 7.5h.01")
    val ArrowLeftRight = LucideIcon("arrow-left-right", "M8 3 4 7l4 4", "M4 7h16", "m16 21 4-4-4-4", "M20 17H4")
    val Expand = LucideIcon("maximize-2", "M15 3h6v6", "m21 3-7 7", "m3 21 7-7", "M9 21H3v-6")
    val ChevronsLeftRight = LucideIcon("chevrons-left-right", "m9 7-5 5 5 5", "m15 7 5 5-5 5")
    val ZoomIn = LucideIcon("zoom-in", "M3 11a8 8 0 1 0 16 0a8 8 0 1 0 -16 0", "M21 21L16.65 16.65", "M11 8L11 14", "M8 11L14 11")
    val ZoomOut = LucideIcon("zoom-out", "M3 11a8 8 0 1 0 16 0a8 8 0 1 0 -16 0", "M21 21L16.65 16.65", "M8 11L14 11")
    val Fit = LucideIcon("maximize", "M8 3H5a2 2 0 0 0-2 2v8", "M21 8V5a2 2 0 0 0-2-2h-3", "M3 16v3a2 2 0 0 0 2 2h3", "M16 21h3a2 2 0 0 0 2-2v-3")
}

/**
 * A signed URL for an artifact's bytes, minted only while [enabled] (a slide far from the active one asks for nothing)
 * and renewed before it expires. [MediaUrl.failed] asks for a fresh one a bounded number of times; [MediaUrl.loaded]
 * resets that count. The URL lives in this composition only, never in saved state.
 */
@Stable
internal class MediaUrl(val value: String?, private val onFailed: () -> Unit, private val onLoaded: () -> Unit) {
    fun failed() = onFailed()
    fun loaded() = onLoaded()
}

@Composable
internal fun rememberMediaUrl(context: ProjectScreenContext, artifact: Artifact, enabled: Boolean): MediaUrl {
    val client = context.backend.client
    val backend = context.backend.config.key
    val connection by client.state.collectAsStateWithLifecycle()
    val online = connection.status == ConnectionStatus.Ready
    var url by remember(backend, artifact.projectId, artifact.id) { mutableStateOf<String?>(null) }
    var renewals by remember(backend, artifact.projectId, artifact.id) { mutableIntStateOf(0) }
    var failures by remember(backend, artifact.projectId, artifact.id) { mutableIntStateOf(0) }
    LaunchedEffect(client, artifact.projectId, artifact.id, enabled, online, renewals) {
        if (!enabled) { url = null; return@LaunchedEffect }
        if (!online) return@LaunchedEffect
        try {
            while (isActive) {
                val signed = client.request(ArtifactsUrlRequest(projectId = artifact.projectId, artifactId = artifact.id))
                url = signed.url
                delay(artifactRefreshDelay(signed.expiresAt, System.currentTimeMillis()))
            }
        } catch (e: CancellationException) { throw e }
        catch (_: Exception) { /* The tile stays; a reconnect or a new composition tries again. */ }
    }
    return remember(url) { MediaUrl(url, { if (failures < MEDIA_RETRY_LIMIT) { failures++; renewals++ } }, { failures = 0 }) }
}

/** The memory-cache key of an artifact's picture as the slide shows it; the viewer shows it as a placeholder. */
internal fun slideCacheKey(artifact: Artifact) = "media-slide:${artifact.projectId}:${artifact.id}"

/**
 * A picture request for a signed URL. Never on disk (the URL is a capability); in memory under a key that does not
 * hold the URL, so a renewed URL does not reload what is already shown, and the viewer can show the slide's picture
 * while the full one loads.
 */
internal fun mediaRequest(android: Context, url: String, artifact: Artifact, full: Boolean): ImageRequest =
    ImageRequest.Builder(android).data(url)
        .diskCachePolicy(CachePolicy.DISABLED)
        .memoryCachePolicy(CachePolicy.ENABLED)
        .memoryCacheKey(if (full) "media-full:${artifact.projectId}:${artifact.id}" else slideCacheKey(artifact))
        .apply { if (full) placeholderMemoryCacheKey(MemoryCache.Key(slideCacheKey(artifact))) }
        .build()

/** Where a slide's picture is on screen, and how big the picture is, for the viewer's flight in and out. */
internal class SlideRects {
    class Entry(var box: Rect, var naturalWidth: Float, var naturalHeight: Float)

    private val entries = HashMap<String, Entry>()

    fun place(id: String, coordinates: LayoutCoordinates) {
        if (!coordinates.isAttached) return
        val at = coordinates.positionOnScreen()
        val box = Rect(at.x, at.y, coordinates.size.width.toFloat(), coordinates.size.height.toFloat())
        val entry = entries[id]
        if (entry == null) entries[id] = Entry(box, 0f, 0f) else entry.box = box
    }

    fun size(id: String, width: Float, height: Float) {
        val entry = entries[id] ?: return
        entry.naturalWidth = width
        entry.naturalHeight = height
    }

    fun forget(id: String) { entries.remove(id) }

    fun natural(id: String): Pair<Float, Float>? = entries[id]?.takeIf { it.naturalWidth > 0f }?.let { it.naturalWidth to it.naturalHeight }

    /** The picture's rectangle on screen, or null when the slide is not composed or not in view. */
    fun picture(id: String, screenWidth: Float, screenHeight: Float): Rect? {
        val entry = entries[id] ?: return null
        val box = entry.box
        if (box.left + box.width < 0f || box.left > screenWidth || box.top + box.height < 0f || box.top > screenHeight) return null
        return if (entry.naturalWidth > 0f) containedRect(entry.naturalWidth, entry.naturalHeight, box) else box
    }
}
