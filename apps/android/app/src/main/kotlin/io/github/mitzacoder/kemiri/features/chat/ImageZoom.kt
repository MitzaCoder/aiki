package io.github.mitzacoder.kemiri.features.chat

import kotlin.math.abs

/**
 * The image viewer's zoom and the Markdown check for text artifacts: ports of the web's `lib/artifacts.ts` (the
 * lightbox section and `isMarkdownArtifact`), tested with its cases in `ArtifactMediaTest.kt`.
 */

/** How far the image is zoomed ([scale] 1 = fitted) and moved from the centre, in screen pixels. */
data class Zoom(val scale: Float, val x: Float, val y: Float)

const val ZOOM_MIN = 1f
const val ZOOM_MAX = 8f
/** What a double tap zooms to. */
const val ZOOM_STEP = 2.5f
val ZOOM_FIT = Zoom(1f, 0f, 0f)

data class ZoomSize(val width: Float, val height: Float)

/** The image's size fitted into the viewport at scale 1, never larger than its own pixels. */
fun fittedSize(natural: ZoomSize, viewport: ZoomSize): ZoomSize {
    if (natural.width <= 0 || natural.height <= 0) return ZoomSize(0f, 0f)
    val ratio = minOf(viewport.width / natural.width, viewport.height / natural.height, 1f)
    return ZoomSize(natural.width * ratio, natural.height * ratio)
}

/** The offset kept within the edges: a zoomed image can be panned until its edge meets the viewport's, no further. */
fun clampZoom(zoom: Zoom, fitted: ZoomSize, viewport: ZoomSize): Zoom {
    val scale = zoom.scale.coerceIn(ZOOM_MIN, ZOOM_MAX)
    val limitX = maxOf(0f, (fitted.width * scale - viewport.width) / 2)
    val limitY = maxOf(0f, (fitted.height * scale - viewport.height) / 2)
    return Zoom(scale, zoom.x.coerceIn(-limitX, limitX) + 0f, zoom.y.coerceIn(-limitY, limitY) + 0f)
}

/** Zoom to [scale] keeping the image point under [pointX], [pointY] (from the viewport's centre) where it is. */
fun zoomAround(zoom: Zoom, scale: Float, pointX: Float, pointY: Float, fitted: ZoomSize, viewport: ZoomSize): Zoom {
    val next = scale.coerceIn(ZOOM_MIN, ZOOM_MAX)
    val ratio = next / zoom.scale
    return clampZoom(Zoom(next, pointX - (pointX - zoom.x) * ratio, pointY - (pointY - zoom.y) * ratio), fitted, viewport)
}

/** A double tap: zoom in at that point, or back to fit when already zoomed. */
fun toggleZoom(zoom: Zoom, pointX: Float, pointY: Float, fitted: ZoomSize, viewport: ZoomSize): Zoom =
    if (zoom.scale > ZOOM_MIN + 0.01f) ZOOM_FIT else zoomAround(zoom, ZOOM_STEP, pointX, pointY, fitted, viewport)

/** A swipe that should close the viewer: mostly down, far enough ([dy] in dp-like pixels), at fit. */
fun isDismissSwipe(zoom: Zoom, dx: Float, dy: Float, distance: Float = 90f): Boolean =
    zoom.scale <= ZOOM_MIN + 0.01f && dy > distance && abs(dy) > abs(dx) * 1.5f

/** Whether a text artifact is Markdown, by its type or its name. */
fun isMarkdownArtifact(name: String, mimeType: String): Boolean {
    val type = mimeType.split(';').firstOrNull()?.trim()?.lowercase().orEmpty()
    if (type == "text/markdown" || type == "text/x-markdown") return true
    return Regex("\\.(md|markdown|mdx)$", RegexOption.IGNORE_CASE).containsMatchIn(name)
}

/** Whether a text artifact is an HTML page, by its type or its name (web `isHtmlArtifact`). */
fun isHtmlArtifact(name: String, mimeType: String): Boolean {
    val type = mimeType.split(';').firstOrNull()?.trim()?.lowercase().orEmpty()
    if (type == "text/html" || type == "application/xhtml+xml") return true
    return Regex("\\.(html|htm|xhtml)$", RegexOption.IGNORE_CASE).containsMatchIn(name)
}
