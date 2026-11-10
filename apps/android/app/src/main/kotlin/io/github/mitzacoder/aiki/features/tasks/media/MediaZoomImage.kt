package io.github.mitzacoder.aiki.features.tasks.media

import androidx.compose.animation.core.Animatable
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.calculateCentroid
import androidx.compose.foundation.gestures.calculatePan
import androidx.compose.foundation.gestures.calculateZoom
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.*
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.TransformOrigin
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.input.pointer.positionChanged
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.layout.positionOnScreen
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import coil3.compose.AsyncImage
import io.github.mitzacoder.aiki.features.chat.*
import io.github.mitzacoder.aiki.navigation.ProjectScreenContext
import io.github.mitzacoder.aiki.protocol.Artifact
import kotlinx.coroutines.launch
import kotlin.math.abs

/** What the viewer knows about the page in view, for the flights and the zoom buttons. Written by that page only. */
@Stable
internal class ViewerPage {
    var pane by mutableStateOf(Rect(0f, 0f, 0f, 0f))
    var naturalWidth by mutableFloatStateOf(0f)
    var naturalHeight by mutableFloatStateOf(0f)

    /** The picture's rectangle on screen when fitted into the pane, or the pane itself while its size is not known. */
    fun picture(fallback: Pair<Float, Float>?): Rect {
        val natural = if (naturalWidth > 0f) naturalWidth to naturalHeight else fallback
        return if (natural == null) pane else containedRect(natural.first, natural.second, pane)
    }
}

/** How a page is flown: where it is between the slide (0) and its own place (1), and what 0 looks like. */
@Stable
internal class FlightState(val progress: Animatable<Float, androidx.compose.animation.core.AnimationVector1D> = Animatable(1f)) {
    var start by mutableStateOf(Flight(0f, 0f, 1f, 1f))
    var shown by mutableStateOf(false)
}

/**
 * An image page of the viewer (web `MediaZoomImage` and `ZoomPane`): fitted, zoomed with a pinch or a double tap and
 * panned by dragging. At fit, a swipe sideways is the pager's, a swipe down pulls the picture and closes the viewer; once
 * zoomed, a drag pans instead. The page in view also carries the viewer's flight.
 */
@Composable
internal fun MediaZoomImage(
    context: ProjectScreenContext,
    artifact: Artifact,
    label: String,
    active: Boolean,
    zoom: Zoom,
    onZoom: (Zoom) -> Unit,
    pull: Animatable<Float, androidx.compose.animation.core.AnimationVector1D>,
    dismissDistance: Float,
    onDismiss: () -> Unit,
    page: ViewerPage,
    flight: FlightState,
    slideRects: SlideRects,
    modifier: Modifier = Modifier,
) {
    val android = LocalContext.current
    val scope = rememberCoroutineScope()
    val source = rememberMediaUrl(context, artifact, enabled = true)
    var box by remember { mutableStateOf(ZoomSize(0f, 0f)) }
    var paneRect by remember { mutableStateOf<Rect?>(null) }
    var natural by remember { mutableStateOf(ZoomSize(0f, 0f)) }
    var ready by remember { mutableStateOf(false) }
    val currentZoom by rememberUpdatedState(zoom)
    val currentNatural by rememberUpdatedState(natural)
    val currentBox by rememberUpdatedState(box)
    val report by rememberUpdatedState(onZoom)
    val dismiss by rememberUpdatedState(onDismiss)
    fun fitted(): ZoomSize {
        val size = if (currentNatural.width > 0f) currentNatural else slideRects.natural(artifact.id)?.let { ZoomSize(it.first, it.second) } ?: ZoomSize(0f, 0f)
        val r = containedRect(size.width, size.height, Rect(0f, 0f, currentBox.width, currentBox.height))
        return if (size.width <= 0f) ZoomSize(currentBox.width, currentBox.height) else ZoomSize(r.width, r.height)
    }

    // The page in view tells the viewer where its pane is and how big its picture is.
    LaunchedEffect(active, paneRect, natural) {
        if (!active) return@LaunchedEffect
        paneRect?.let { page.pane = it }
        if (natural.width > 0f) { page.naturalWidth = natural.width; page.naturalHeight = natural.height }
    }
    Box(
        modifier.fillMaxSize()
            .onSizeChanged { size -> box = ZoomSize(size.width.toFloat(), size.height.toFloat()) }
            .onGloballyPositioned { coordinates ->
                if (coordinates.isAttached) {
                    val at = coordinates.positionOnScreen()
                    paneRect = Rect(at.x, at.y, coordinates.size.width.toFloat(), coordinates.size.height.toFloat())
                }
            }
            .pointerInput(Unit) {
                detectTapGestures(onDoubleTap = { at ->
                    report(toggleZoom(currentZoom, at.x - size.width / 2f, at.y - size.height / 2f, fitted(), currentBox))
                })
            }
            .pointerInput(Unit) {
                awaitEachGesture {
                    awaitFirstDown(requireUnconsumed = false)
                    var dragged = Offset.Zero
                    var mode = 0 // 0 undecided, 1 pull down, 2 pan, 3 pinch, 4 left to the pager
                    while (true) {
                        val event = awaitPointerEvent()
                        if (event.changes.none { it.pressed }) break
                        val pan = event.calculatePan()
                        val pinch = event.calculateZoom()
                        dragged += pan
                        if (event.changes.count { it.pressed } > 1) mode = 3
                        if (mode == 0 && (abs(dragged.x) > viewConfiguration.touchSlop || abs(dragged.y) > viewConfiguration.touchSlop)) {
                            mode = when {
                                currentZoom.scale > ZOOM_MIN + 0.01f -> 2
                                dragged.y > 0f && abs(dragged.y) > abs(dragged.x) -> 1
                                else -> 4
                            }
                        }
                        val fit = fitted()
                        when (mode) {
                            3 -> {
                                val centre = event.calculateCentroid()
                                val zoomed = zoomAround(currentZoom, currentZoom.scale * pinch, centre.x - size.width / 2f, centre.y - size.height / 2f, fit, currentBox)
                                report(clampZoom(zoomed.copy(x = zoomed.x + pan.x, y = zoomed.y + pan.y), fit, currentBox))
                            }
                            2 -> report(clampZoom(currentZoom.copy(x = currentZoom.x + pan.x, y = currentZoom.y + pan.y), fit, currentBox))
                            1 -> scope.launch { pull.snapTo(maxOf(0f, dragged.y)) }
                        }
                        if (mode in 1..3) event.changes.forEach { if (it.positionChanged()) it.consume() }
                    }
                    if (mode == 1) {
                        if (isDismissSwipe(currentZoom, dragged.x, dragged.y, dismissDistance)) dismiss()
                        else scope.launch { pull.animateTo(0f) }
                    }
                }
            }
            .graphicsLayer {
                // The flight: the page grows from the slide's rectangle (origin top left); the pull carries it on.
                if (active) {
                    val f = flight.progress.value
                    val start = flight.start
                    alpha = if (flight.shown) 1f else 0f
                    transformOrigin = TransformOrigin(0f, 0f)
                    scaleX = start.scaleX + (1f - start.scaleX) * f
                    scaleY = start.scaleY + (1f - start.scaleY) * f
                    translationX = start.x * (1f - f)
                    translationY = start.y * (1f - f) + pull.value * f
                }
            },
        contentAlignment = Alignment.Center,
    ) {
        source.value?.let { url ->
            AsyncImage(
                model = remember(url) { mediaRequest(android, url, artifact, full = true) },
                contentDescription = label,
                contentScale = ContentScale.Fit,
                modifier = Modifier.fillMaxSize().graphicsLayer { scaleX = zoom.scale; scaleY = zoom.scale; translationX = zoom.x; translationY = zoom.y },
                onSuccess = { state ->
                    val size = state.painter.intrinsicSize
                    natural = ZoomSize(size.width, size.height)
                    ready = true
                    source.loaded()
                    report(clampZoom(currentZoom, fitted(), currentBox))
                },
                onError = { ready = false; source.failed() },
            )
        }
        if (!ready && source.value == null) Text("Loading…", color = Color.White.copy(alpha = .6f), modifier = Modifier.semantics { contentDescription = "Loading the image" })
    }
}
