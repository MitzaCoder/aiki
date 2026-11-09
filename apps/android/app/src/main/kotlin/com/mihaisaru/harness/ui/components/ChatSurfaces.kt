package com.mihaisaru.harness.ui.components

import androidx.compose.foundation.background
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import com.mihaisaru.harness.ui.theme.Jarvis

/** Quiet, static aurora; no offscreen blur passes or perpetual animation. */
@Composable
fun ChatBackdrop(modifier: Modifier = Modifier, content: @Composable BoxScope.() -> Unit) {
    val colors = Jarvis.colors
    Box(modifier.background(colors.bg).drawBehind {
        if (!colors.neutral && size.minDimension > 0f) {
            val radius = size.maxDimension * .72f
            drawRect(Brush.radialGradient(listOf(colors.accent2.copy(alpha = .07f), Color.Transparent),
                center = Offset(size.width, 0f), radius = radius))
            drawRect(Brush.radialGradient(listOf(colors.accent3.copy(alpha = .045f), Color.Transparent),
                center = Offset(0f, size.height * .75f), radius = radius))
        }
    }, content = content)
}

/**
 * Glass-like native fallback, NOT a backdrop blur: opaque enough to keep text legible,
 * with a translucent surface gradient, fine highlight and soft elevation. No Haze
 * dependency/source registration is required. Neutral never inherits violet bgElev.
 * Caller owns IME/navigation insets and outer spacing; content gets 12 dp padding.
 */
@Composable
fun GlassComposerSurface(modifier: Modifier = Modifier, content: @Composable ColumnScope.() -> Unit) {
    val colors = Jarvis.colors
    val shape = RoundedCornerShape(24.dp)
    Column(modifier
        .shadow(8.dp, shape, ambientColor = if (colors.neutral) Color.Black else colors.shadow,
            spotColor = if (colors.neutral) Color.Black else colors.shadow)
        .clip(shape)
        .background(colors.bg.copy(alpha = .96f))
        .background(Brush.verticalGradient(listOf(colors.surface2.copy(alpha = .45f), colors.surface.copy(alpha = .25f))))
        .border(1.dp, colors.borderStrong.copy(alpha = .7f), shape)
        .padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp), content = content)
}

/** A compact visual control with a full 48 dp accessible target. */
@Composable
fun JarvisIconButton(
    icon: LucideIcon,
    contentDescription: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    emphasized: Boolean = false,
    /** A switch rather than an action: null is a plain button; true and false say "on" and "off" to a screen reader and in the ring. */
    pressed: Boolean? = null,
) {
    val colors = Jarvis.colors
    IconButton(onClick = onClick, modifier = modifier.sizeIn(minWidth = 48.dp, minHeight = 48.dp)
        .then(if (pressed == null) Modifier else Modifier.semantics { stateDescription = if (pressed) "On" else "Off" }), enabled = enabled) {
        Box(Modifier.size(36.dp).clip(CircleShape)
            .then(if (emphasized) Modifier.background(colors.grad()) else Modifier.background(colors.surface))
            .then(if (pressed == true) Modifier.border(1.5.dp, colors.fgMuted, CircleShape) else Modifier),
            contentAlignment = androidx.compose.ui.Alignment.Center) {
            Box(Modifier.size(32.dp).background(colors.surface, CircleShape), contentAlignment = androidx.compose.ui.Alignment.Center) {
                LucideGlyph(icon, size = 18.dp, contentDescription = contentDescription,
                    tint = if (!enabled) colors.fgSubtle else colors.fg)
            }
        }
    }
}

@Composable
fun UserMessageSurface(modifier: Modifier = Modifier, content: @Composable ColumnScope.() -> Unit) {
    val colors = Jarvis.colors
    val shape = RoundedCornerShape(18.dp, 18.dp, 5.dp, 18.dp)
    Column(modifier.clip(shape).background(colors.userBubble()).border(1.dp, colors.userBorder, shape)
        .padding(16.dp), content = content)
}
