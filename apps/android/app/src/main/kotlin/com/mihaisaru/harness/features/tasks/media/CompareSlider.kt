package com.mihaisaru.harness.features.tasks.media

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.focusable
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.clipRect
import androidx.compose.ui.input.key.*
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.*
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil3.compose.AsyncImage
import com.mihaisaru.harness.features.chat.artifactTitle
import com.mihaisaru.harness.navigation.ProjectScreenContext
import com.mihaisaru.harness.protocol.Artifact
import com.mihaisaru.harness.ui.components.LucideGlyph
import com.mihaisaru.harness.ui.theme.Jarvis
import kotlin.math.roundToInt
import kotlinx.coroutines.launch

/**
 * Two images of the same thing, one over the other, with a divider to drag (web `CompareSlider`): the before on the left
 * of it, the after on the right. A finger drags only from the handle's strip, so a swipe anywhere else still changes
 * slide. The handle is a slider for TalkBack (and ←/→, Shift for bigger steps, Home and End on a keyboard). On opening
 * the divider sweeps from the right edge to the middle, unless motion is reduced. It fills its parent.
 */
@Composable
internal fun CompareSlider(
    context: ProjectScreenContext,
    before: Artifact,
    after: Artifact,
    reducedMotion: Boolean,
    modifier: Modifier = Modifier,
    full: Boolean = false,
    onOpen: (() -> Unit)? = null,
) {
    val android = LocalContext.current
    val colors = Jarvis.colors
    val density = LocalDensity.current
    val beforeUrl = rememberMediaUrl(context, before, enabled = true)
    val afterUrl = rememberMediaUrl(context, after, enabled = true)
    var beforeReady by remember { mutableStateOf(false) }
    var afterReady by remember { mutableStateOf(false) }
    val position = remember { Animatable(if (reducedMotion) 50f else 100f) }
    var dragging by remember { mutableStateOf(false) }
    var width by remember { mutableFloatStateOf(0f) }
    LaunchedEffect(Unit) { if (!reducedMotion) position.animateTo(50f, tween(650, easing = CubicBezierEasing(0.22f, 0.8f, 0.2f, 1f))) }
    val percent = clampPercent(position.value)
    suspend fun moveTo(value: Float) = position.snapTo(clampPercent(value))
    val scope = rememberCoroutineScope()

    Box(
        modifier.fillMaxSize().clipToBounds()
            .background(colors.surface2)
            .then(if (onOpen != null) Modifier.pointerInput(onOpen) { detectTapGestures { onOpen() } }.semantics { onClick("Open full screen") { onOpen(); true } } else Modifier)
            .onSizeChanged { width = it.width.toFloat() }
            .semantics(mergeDescendants = false) { contentDescription = "Before and after: ${artifactTitle(before)} and ${artifactTitle(after)}" },
    ) {
        beforeUrl.value?.let { url ->
            AsyncImage(
                model = remember(url) { mediaRequest(android, url, before, full = full) }, contentDescription = "Before: ${artifactTitle(before)}", contentScale = ContentScale.Fit,
                modifier = Modifier.fillMaxSize(),
                onSuccess = { beforeReady = true; beforeUrl.loaded() }, onError = { beforeReady = false; beforeUrl.failed() },
            )
        }
        afterUrl.value?.let { url ->
            AsyncImage(
                model = remember(url) { mediaRequest(android, url, after, full = full) }, contentDescription = "After: ${artifactTitle(after)}", contentScale = ContentScale.Fit,
                modifier = Modifier.fillMaxSize().drawWithContent {
                    clipRect(left = size.width * percent / 100f) { this@drawWithContent.drawContent() }
                },
                onSuccess = { afterReady = true; afterUrl.loaded() }, onError = { afterReady = false; afterUrl.failed() },
            )
        }
        if (!(beforeReady && afterReady)) Box(Modifier.fillMaxSize().semantics { contentDescription = "Loading the images" }, contentAlignment = Alignment.Center) {
            androidx.compose.material3.CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp, color = Color.White.copy(alpha = .7f))
        }

        ComparePill("Before", Modifier.align(Alignment.TopStart).padding(8.dp).alpha(if (percent < 16f) 0f else 1f))
        // The carousel's expand button sits in the top right corner; the label stays clear of it.
        ComparePill("After", Modifier.align(Alignment.TopEnd).padding(top = 8.dp, end = if (full) 8.dp else 52.dp).alpha(if (percent > 84f) 0f else 1f))

        // The divider: a white line with a hairline of shadow, then the handle's strip over it.
        Box(Modifier.fillMaxHeight().offset { IntOffset((width * percent / 100f - 1.dp.toPx()).roundToInt(), 0) }.width(2.dp).background(Color.White))
        val strip = 52.dp
        Box(
            Modifier.fillMaxHeight().width(strip)
                .offset { IntOffset((width * percent / 100f - strip.toPx() / 2f).roundToInt(), 0) }
                .pointerInput(width) {
                    detectDragGestures(
                        onDragStart = { dragging = true },
                        onDragEnd = { dragging = false },
                        onDragCancel = { dragging = false },
                    ) { change, drag ->
                        change.consume()
                        if (width > 0f) scope.launch { moveTo(position.value + drag.x / width * 100f) }
                    }
                }
                .focusable()
                .onKeyEvent { event ->
                    if (event.type != KeyEventType.KeyDown || event.isCtrlPressed || event.isMetaPressed || event.isAltPressed) return@onKeyEvent false
                    val name = when (event.key) {
                        Key.DirectionLeft -> "ArrowLeft"; Key.DirectionRight -> "ArrowRight"; Key.DirectionUp -> "ArrowUp"; Key.DirectionDown -> "ArrowDown"
                        Key.PageUp -> "PageUp"; Key.PageDown -> "PageDown"; Key.MoveHome -> "Home"; Key.MoveEnd -> "End"; else -> return@onKeyEvent false
                    }
                    val next = dividerAfterKey(percent, name, event.isShiftPressed) ?: return@onKeyEvent false
                    scope.launch { moveTo(next) }
                    true
                }
                .semantics {
                    contentDescription = "Compare before and after"
                    progressBarRangeInfo = ProgressBarRangeInfo(percent, 0f..100f)
                    stateDescription = "${percent.roundToInt()}% before, ${100 - percent.roundToInt()}% after"
                    setProgress { target -> scope.launch { moveTo(target) }; true }
                },
            contentAlignment = Alignment.Center,
        ) {
            Box(
                Modifier.size(40.dp).scale(if (dragging) 1.12f else 1f).background(Color.White, CircleShape).border(1.dp, Color.Black.copy(alpha = .2f), CircleShape),
                contentAlignment = Alignment.Center,
            ) { LucideGlyph(MediaIcons.ChevronsLeftRight, size = 16.dp, tint = Color(0xFF1A1A1A)) }
        }
    }
}

@Composable
private fun ComparePill(text: String, modifier: Modifier) {
    Text(
        text, modifier.background(Color.Black.copy(alpha = .55f), RoundedCornerShape(50)).padding(horizontal = 8.dp, vertical = 2.dp),
        color = Color.White, fontSize = 11.sp, fontWeight = FontWeight.SemiBold, lineHeight = 16.sp,
    )
}
