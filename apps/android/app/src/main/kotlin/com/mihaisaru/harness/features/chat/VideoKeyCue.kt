package com.mihaisaru.harness.features.chat

import android.provider.Settings
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import com.mihaisaru.harness.ui.components.LucideGlyph
import com.mihaisaru.harness.ui.components.LucideIcon
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/** One showing of the centred cue; a new [id] restarts the animation (a seek pressed again adds to [seconds]). */
data class VideoCue(val id: Int, val kind: CueKind, val seconds: Int? = null)

private object CueGlyphs {
    val Play = LucideIcon("play", "M5 5a2 2 0 0 1 3.008-1.728l11.997 6.998a2 2 0 0 1 .003 3.458l-12 7A2 2 0 0 1 5 20z")
    val Pause = LucideIcon("pause", "M15 3h3a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1h-3a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z", "M6 3h3a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z")
    val RotateCcw = LucideIcon("rotate-ccw", "M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8", "M3 3v5h5")
    val RotateCw = LucideIcon("rotate-cw", "M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8", "M21 3v5h-5")
}

/** What a screen reader says for [cue]. */
internal fun cueLabel(cue: VideoCue): String = when (cue.kind) {
    CueKind.Play -> "Playing"
    CueKind.Pause -> "Paused"
    CueKind.SeekBack, CueKind.SeekForward -> cue.seconds?.let { (if (it < 0) "Back " else "Forward ") + "${kotlin.math.abs(it)} seconds" } ?: "Seek"
}

/**
 * The quick centred flash for what a key or double tap just did (web `.cue`): a translucent dark disc that pops in,
 * holds and fades out in [CUE_MS]; a seek sits to the side of the middle, on the vertical middle, so it never covers
 * the captions at the bottom left. With the system's animations off (animator scale 0) it only fades, with no scale.
 * Calls [onDone] when it is over.
 */
@Composable
internal fun BoxScope.VideoKeyCue(cue: VideoCue, onDone: (Int) -> Unit) {
    val context = LocalContext.current
    val reduced = remember(cue.id) { Settings.Global.getFloat(context.contentResolver, Settings.Global.ANIMATOR_DURATION_SCALE, 1f) == 0f }
    val alpha = remember { Animatable(0f) }
    val scale = remember { Animatable(.8f) }
    LaunchedEffect(cue.id) {
        if (reduced) {
            scale.snapTo(1f); alpha.snapTo(0f); alpha.animateTo(1f, tween(110))
            delay(CUE_MS * 6L / 10)
            alpha.animateTo(0f, tween(110))
        } else {
            alpha.snapTo(0f); scale.snapTo(.8f)
            coroutineScope { launch { scale.animateTo(1f, tween(140)) }; alpha.animateTo(1f, tween(140)) }
            delay(210)
            coroutineScope { launch { scale.animateTo(1.15f, tween(200)) }; alpha.animateTo(0f, tween(200)) }
        }
        onDone(cue.id)
    }
    val align = when (cue.kind) {
        CueKind.SeekBack -> Alignment.CenterStart
        CueKind.SeekForward -> Alignment.CenterEnd
        else -> Alignment.Center
    }
    val icon = when (cue.kind) {
        CueKind.Play -> CueGlyphs.Play
        CueKind.Pause -> CueGlyphs.Pause
        CueKind.SeekBack -> CueGlyphs.RotateCcw
        CueKind.SeekForward -> CueGlyphs.RotateCw
    }
    val seek = cue.seconds != null
    Column(
        Modifier.align(align).padding(horizontal = if (seek) 40.dp else 0.dp)
            .alpha(alpha.value).scale(scale.value)
            .background(Color.Black.copy(alpha = .5f), CircleShape)
            .then(if (seek) Modifier.defaultMinSize(minWidth = 64.dp).padding(horizontal = 18.dp, vertical = 14.dp) else Modifier.size(64.dp))
            .semantics { liveRegion = LiveRegionMode.Polite; contentDescription = cueLabel(cue) },
        horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center,
    ) {
        LucideGlyph(icon, size = if (seek) 20.dp else 28.dp, tint = Color.White, filled = !seek)
        cue.seconds?.let { Text(formatSeekCue(it), color = Color.White, style = MaterialTheme.typography.labelMedium) }
    }
}
