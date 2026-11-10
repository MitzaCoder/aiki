package io.github.mitzacoder.aiki.ui.components

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.ui.Alignment
import androidx.compose.ui.draw.BlurredEdgeTreatment
import androidx.compose.ui.draw.blur
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.BlendMode
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.CompositingStrategy
import androidx.compose.ui.graphics.drawscope.rotate
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import io.github.mitzacoder.aiki.ui.theme.Jarvis
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.contentDescription
import io.github.mitzacoder.aiki.ui.theme.fade


/**
 * Jarvis' mark: a softly spinning gradient orb that speeds up while working
 * (one turn in 9 s idle, 1.6 s active) and glows while working.
 * Adapted from the native Jarvis reference; uses the current theme, including neutral.
 * Motion is opt-in: static by default for accessibility and test idling.
 */
@Composable
fun AssistantOrb(
    modifier: Modifier = Modifier,
    size: Dp = 28.dp,
    active: Boolean = false,
    animationsEnabled: Boolean = false,
    contentDescription: String? = null,
) {
    val colors = Jarvis.colors
    val orbColors = listOf(colors.accent1, colors.accent2, colors.accent3, colors.accent4, colors.accent1)
    val degreesPerSecond = if (active) 360f / 1.6f else 360f / 9f
    val glow = if (active) 1f else 0f
    var angle by remember { mutableFloatStateOf(0f) }
    LaunchedEffect(animationsEnabled, active) {
        if (!animationsEnabled) { angle = 0f; return@LaunchedEffect }
        var last = 0L
        while (true) {
            withFrameNanos { now ->
                if (last != 0L) angle = (angle + degreesPerSecond * (now - last) / 1e9f) % 360f
                last = now
            }
        }
    }

    Box(modifier.size(size).semantics {
        if (contentDescription != null) this.contentDescription = contentDescription
    }, contentAlignment = Alignment.Center) {
        // box-shadow: 0 0 18px -2px fuchsia at 70%, spilling past the orb while working.
        Canvas(Modifier.matchParentSize()) {
            if (glow <= 0f) return@Canvas
            val r = this.size.minDimension / 2
            val reach = r - 2.dp.toPx() + 18.dp.toPx()
            drawCircle(
                brush = Brush.radialGradient(
                    0f to colors.accent3.fade(70f * glow),
                    ((r - 6.dp.toPx()) / reach).coerceAtLeast(0f) to colors.accent3.fade(70f * glow),
                    1f to Color.Transparent,
                    center = center,
                    radius = reach,
                ),
                radius = reach,
            )
        }
        // The glint blends with the orb only, not with what is behind it.
        Box(Modifier.matchParentSize().graphicsLayer(compositingStrategy = CompositingStrategy.Offscreen)) {
            // The spinning conic, blurred 1px as on the web. conic-gradient starts at 12 o'clock, a sweep at 3.
            Canvas(Modifier.matchParentSize().blur(1.dp, BlurredEdgeTreatment.Unbounded)) {
                val r = this.size.minDimension / 2
                rotate(angle - 90f) { drawCircle(Brush.sweepGradient(orbColors, center), radius = r) }
            }
            // The glint: inset 18%, a white highlight up and to the left, soft-light.
            Canvas(Modifier.matchParentSize()) {
                val inner = this.size.minDimension / 2 * 0.64f
                val corner = Offset(center.x - inner, center.y - inner)
                drawCircle(
                    brush = Brush.radialGradient(
                        0f to Color.White.copy(alpha = 0.85f),
                        0.6f to Color.Transparent,
                        center = corner + Offset(inner * 2 * 0.35f, inner * 2 * 0.3f),
                        radius = inner * 2 * 1.02f,
                    ),
                    radius = inner,
                    blendMode = BlendMode.Softlight,
                )
            }
        }
    }
}
