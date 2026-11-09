package com.mihaisaru.harness.features.chat

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.blur
import androidx.compose.ui.draw.BlurredEdgeTreatment
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.mihaisaru.harness.ui.components.AssistantOrb
import com.mihaisaru.harness.ui.theme.Jarvis

/**
 * The rows that rise in (web `animate-rise`): those new at the end since [before], the keys the chat last showed. None
 * on the first load ([before] null), none for history loaded above, and not a streamed row that turns into its stored
 * entry (a new key replacing one that went).
 */
fun arrivedRows(before: List<String>?, after: List<String>): Set<String> {
    if (before == null) return emptySet()
    val old = before.toSet()
    val now = after.toSet()
    val arrived = after.drop(after.indexOfLast { it in old } + 1)
    return arrived.drop(before.count { it !in now }).toSet()
}

/** The row keys the chat last showed, written once a composition commits. */
class ShownRows { var keys: List<String>? = null }

private val riseEasing = CubicBezierEasing(0.2f, 0.8f, 0.2f, 1f)

/** Fades a row in from 6dp below over 280ms, as the web's `animate-rise`; nothing when [enabled] is false. */
@Composable internal fun Modifier.riseIn(enabled: Boolean): Modifier {
    if (!enabled) return this
    val progress = remember { Animatable(0f) }
    LaunchedEffect(Unit) { progress.animateTo(1f, tween(280, easing = riseEasing)) }
    return graphicsLayer { alpha = progress.value; translationY = (1f - progress.value) * 6.dp.toPx() }
}

/** The transcript is empty (web `EmptyState.svelte`): the mark in its aura, the chat's name and what to do next. */
@Composable internal fun ChatEmptyState(title: String, subtitle: String, modifier: Modifier = Modifier) {
    val colors = Jarvis.colors
    Column(modifier.padding(vertical = 40.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
        Box(Modifier.padding(bottom = 24.dp), contentAlignment = Alignment.Center) {
            val aura = Brush.sweepGradient(listOf(colors.accent1.copy(alpha = .35f), colors.accent3.copy(alpha = .30f), colors.accent4.copy(alpha = .25f), colors.accent1.copy(alpha = .35f)))
            Box(Modifier.size(144.dp).blur(64.dp, BlurredEdgeTreatment.Unbounded).background(aura, CircleShape))
            AssistantOrb(size = 64.dp)
        }
        Text(title, style = MaterialTheme.typography.headlineMedium.copy(brush = colors.grad(), fontWeight = FontWeight.SemiBold, letterSpacing = (-0.5).sp), textAlign = TextAlign.Center)
        Text(subtitle, Modifier.padding(top = 8.dp).widthIn(max = 384.dp), style = MaterialTheme.typography.bodyMedium, color = colors.fgMuted, textAlign = TextAlign.Center)
    }
}
