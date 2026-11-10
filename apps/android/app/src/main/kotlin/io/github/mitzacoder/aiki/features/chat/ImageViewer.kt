package io.github.mitzacoder.aiki.features.chat

import androidx.compose.animation.core.Animatable
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.calculateCentroid
import androidx.compose.foundation.gestures.calculatePan
import androidx.compose.foundation.gestures.calculateZoom
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.input.pointer.positionChanged
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import coil3.compose.AsyncImage
import coil3.request.ImageRequest
import io.github.mitzacoder.aiki.ui.components.LucideGlyph
import io.github.mitzacoder.aiki.ui.components.LucideIcon
import io.github.mitzacoder.aiki.ui.components.Lucide
import kotlinx.coroutines.launch
import kotlin.math.abs
import kotlin.math.roundToInt

// Subset of Lucide (@lucide/svelte 1.64.0), ISC license; see LUCIDE-LICENSE.txt.
private object ViewerIcons {
    val ZoomIn = LucideIcon("zoom-in", "M3 11a8 8 0 1 0 16 0a8 8 0 1 0 -16 0", "M21 21L16.65 16.65", "M11 8L11 14", "M8 11L14 11")
    val ZoomOut = LucideIcon("zoom-out", "M3 11a8 8 0 1 0 16 0a8 8 0 1 0 -16 0", "M21 21L16.65 16.65", "M8 11L14 11")
    val Maximize = LucideIcon("maximize", "M8 3H5a2 2 0 0 0-2 2v3", "M21 8V5a2 2 0 0 0-2-2h-3", "M3 16v3a2 2 0 0 0 2 2h3", "M16 21h3a2 2 0 0 0 2-2v-3")
}

/**
 * An image over the whole screen (web `ImageLightbox`): fitted, zoomed with a pinch, a double tap or the buttons, and
 * panned by dragging. At fit, a swipe down or the close button (or back) closes it.
 */
@Composable
internal fun ImageViewer(request: ImageRequest, title: String, onClose: () -> Unit) {
    Dialog(onDismissRequest = onClose, properties = DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false)) {
        val scope = rememberCoroutineScope()
        val density = LocalDensity.current
        val dismissDistance = with(density) { 90.dp.toPx() }
        var natural by remember { mutableStateOf(ZoomSize(0f, 0f)) }
        var box by remember { mutableStateOf(ZoomSize(0f, 0f)) }
        var zoom by remember { mutableStateOf(ZOOM_FIT) }
        val pull = remember { Animatable(0f) }
        val fitted = fittedSize(natural, box)
        fun step(factor: Float) { zoom = zoomAround(zoom, zoom.scale * factor, 0f, 0f, fitted, box) }
        val fade = (1f - abs(pull.value) / (dismissDistance * 4)).coerceIn(.35f, 1f)
        Box(Modifier.fillMaxSize().background(Color.Black.copy(alpha = fade))) {
            Box(Modifier.fillMaxSize()
                .onSizeChanged { size -> box = ZoomSize(size.width.toFloat(), size.height.toFloat()); zoom = clampZoom(zoom, fittedSize(natural, box), box) }
                .pointerInput(Unit) {
                    detectTapGestures(onDoubleTap = { at -> zoom = toggleZoom(zoom, at.x - size.width / 2f, at.y - size.height / 2f, fittedSize(natural, box), box) })
                }
                .pointerInput(Unit) {
                    awaitEachGesture {
                        awaitFirstDown(requireUnconsumed = false)
                        var dragged = Offset.Zero
                        var pulling = false
                        while (true) {
                            val event = awaitPointerEvent()
                            if (event.changes.none { it.pressed }) break
                            val pan = event.calculatePan()
                            val pinch = event.calculateZoom()
                            dragged += pan
                            val moving = event.changes.size > 1 || abs(dragged.x) > viewConfiguration.touchSlop || abs(dragged.y) > viewConfiguration.touchSlop
                            if (!moving) continue
                            val fit = fittedSize(natural, box)
                            when {
                                event.changes.size > 1 -> {
                                    val centre = event.calculateCentroid()
                                    val zoomed = zoomAround(zoom, zoom.scale * pinch, centre.x - size.width / 2f, centre.y - size.height / 2f, fit, box)
                                    zoom = clampZoom(zoomed.copy(x = zoomed.x + pan.x, y = zoomed.y + pan.y), fit, box)
                                }
                                zoom.scale > ZOOM_MIN + 0.01f -> zoom = clampZoom(zoom.copy(x = zoom.x + pan.x, y = zoom.y + pan.y), fit, box)
                                else -> { pulling = true; scope.launch { pull.snapTo(maxOf(0f, dragged.y)) } }
                            }
                            event.changes.forEach { if (it.positionChanged()) it.consume() }
                        }
                        if (pulling && isDismissSwipe(zoom, dragged.x, dragged.y, dismissDistance)) onClose()
                        else if (pulling) scope.launch { pull.animateTo(0f) }
                    }
                },
                contentAlignment = Alignment.Center) {
                AsyncImage(model = request, contentDescription = title, contentScale = ContentScale.Inside,
                    onSuccess = { state -> state.painter.intrinsicSize.let { natural = ZoomSize(it.width, it.height) }; zoom = clampZoom(zoom, fittedSize(natural, box), box) },
                    modifier = Modifier.fillMaxSize().graphicsLayer {
                        scaleX = zoom.scale; scaleY = zoom.scale
                        translationX = zoom.x; translationY = zoom.y + pull.value
                    })
            }
            Surface(Modifier.fillMaxWidth().align(Alignment.TopCenter), color = Color.Black.copy(alpha = .55f), contentColor = Color.White) {
                Row(Modifier.statusBarsPadding().padding(horizontal = 8.dp).heightIn(min = 56.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text(title, Modifier.weight(1f).padding(horizontal = 8.dp), maxLines = 1, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.titleSmall)
                    Text("${(zoom.scale * 100).roundToInt()}%", style = MaterialTheme.typography.labelMedium, color = Color.White.copy(alpha = .7f))
                    ViewerButton(ViewerIcons.ZoomOut, "Zoom out", zoom.scale > ZOOM_MIN) { step(1 / 1.5f) }
                    ViewerButton(ViewerIcons.ZoomIn, "Zoom in", zoom.scale < ZOOM_MAX) { step(1.5f) }
                    ViewerButton(ViewerIcons.Maximize, "Fit", zoom.scale > ZOOM_MIN) { zoom = ZOOM_FIT }
                    ViewerButton(Lucide.X, "Close", true, onClose)
                }
            }
        }
    }
}

@Composable
private fun ViewerButton(icon: LucideIcon, label: String, enabled: Boolean, onClick: () -> Unit) {
    IconButton(onClick = onClick, enabled = enabled) {
        LucideGlyph(icon, size = 20.dp, tint = Color.White.copy(alpha = if (enabled) 1f else .35f), contentDescription = label)
    }
}
