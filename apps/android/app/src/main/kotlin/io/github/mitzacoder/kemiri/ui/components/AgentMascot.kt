package io.github.mitzacoder.kemiri.ui.components

import android.database.ContentObserver
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.TransformOrigin
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import io.github.mitzacoder.kemiri.R
import kotlinx.coroutines.isActive

enum class AgentMotion { Idle, Working, Waiting, Done }
data class MascotPose(val y: Float = 0f, val scaleX: Float = 1f, val scaleY: Float = 1f, val leaf: Float = 0f, val blink: Float = 1f, val gazeX: Float = 0f, val gazeY: Float = 0f)
private val mascotEase = CubicBezierEasing(.42f, 0f, .58f, 1f)
private fun keyframed(at: Float, vararg frames: Pair<Float, Float>): Float {
    val next = frames.indexOfFirst { it.first >= at }
    if(next <= 0) return frames[0].second
    val (a,x) = frames[next - 1]; val (b,y) = frames[next]
    return x + (y - x) * mascotEase.transform(((at - a) / (b - a)).coerceIn(0f,1f))
}
/** The same source-coordinate pivots, durations and small-size keyframes as mascot-motion.css. */
fun mascotPose(state: AgentMotion, elapsedMs: Long): MascotPose {
    val t = elapsedMs.coerceAtLeast(0)
    return when(state) {
        AgentMotion.Idle -> MascotPose()
        AgentMotion.Working -> {
            val f = (t % 3000) / 3000f
            val breath = keyframed(f,0f to 0f,.5f to 1f,1f to 0f)
            MascotPose(y = -7f * breath,scaleX = 1f - .015f * breath,scaleY = 1f + .02f * breath,
                leaf = keyframed(f,0f to 0f,.3f to -3f,.6f to 3f,1f to 0f),
                blink = keyframed((t % 6000) / 6000f,0f to 1f,.91f to 1f,.925f to .08f,.94f to 1f,1f to 1f))
        }
        AgentMotion.Done -> {
            val f = (t / 1300f).coerceAtMost(1f)
            MascotPose(y = keyframed(f,0f to 0f,.15f to 0f,.34f to -30f,.49f to -19.5f,.65f to 0f,.82f to -4f,1f to 0f),
                scaleX = keyframed(f,0f to 1f,.15f to 1.035f,.34f to .985f,.49f to 1f,.65f to 1.035f,.82f to .995f,1f to 1f),
                scaleY = keyframed(f,0f to 1f,.15f to .96f,.34f to 1.02f,.49f to 1f,.65f to .975f,.82f to 1.005f,1f to 1f),
                leaf = keyframed(f,0f to 0f,.15f to 0f,.33f to -8f,.44f to 6f,.56f to -4f,.7f to 2f,.86f to 0f,1f to 0f))
        }
        AgentMotion.Waiting -> {
            val f = (t % 3500) / 3500f
            MascotPose(gazeX = keyframed(f,0f to 0f,.03f to 0f,.09f to -14f,.23f to -14f,.30f to 0f,.44f to 0f,.51f to 14f,.65f to 14f,.72f to 0f,1f to 0f),
                gazeY = keyframed(f,0f to 0f,.23f to 0f,.30f to -13f,.44f to -13f,.51f to 0f,1f to 0f),
                blink = keyframed(f,0f to 1f,.85f to 1f,.885f to .08f,.92f to 1f,1f to 1f),
                leaf = keyframed(f,0f to 0f,.77f to 0f,.81f to -3f,.85f to 2f,.89f to 0f,1f to 0f))
        }
    }
}

/** Observe changes too: enabling Remove animations while chat is open must stop the mascot immediately. */
@Composable fun rememberAgentReducedMotion(): Boolean {
    val resolver = LocalContext.current.contentResolver
    fun disabled() = Settings.Global.getFloat(resolver,Settings.Global.ANIMATOR_DURATION_SCALE,1f) == 0f
    var reduced by remember(resolver) { mutableStateOf(disabled()) }
    DisposableEffect(resolver) {
        val observer = object : ContentObserver(Handler(Looper.getMainLooper())) { override fun onChange(selfChange: Boolean) { reduced = disabled() } }
        resolver.registerContentObserver(Settings.Global.getUriFor(Settings.Global.ANIMATOR_DURATION_SCALE),false,observer)
        onDispose { resolver.unregisterContentObserver(observer) }
    }
    return reduced
}

/** Generated vector layers, animated in Compose. Idle and reduced-motion instances never run a frame loop. */
@Composable fun AgentMascot(state: AgentMotion, modifier: Modifier = Modifier, size: Dp = 26.dp, label: String? = null) {
    val reduced = rememberAgentReducedMotion()
    var elapsed by remember { mutableLongStateOf(0L) }
    LaunchedEffect(state,reduced) {
        elapsed = 0L
        if(reduced || state == AgentMotion.Idle) return@LaunchedEffect
        var start = 0L
        while(isActive) {
            withFrameNanos { now -> if(start == 0L) start = now; elapsed = (now - start) / 1_000_000 }
            if(state == AgentMotion.Done && elapsed >= 1300L) { elapsed = 1300L; break }
        }
    }
    val pose = if(reduced) MascotPose() else mascotPose(state,elapsed)
    fun origin(x: Float,y: Float) = TransformOrigin((x - 122f) / 780f,(y - 115f) / 780f)
    Box(modifier.size(size).semantics { if(label != null) contentDescription = label }) {
        Box(Modifier.fillMaxSize().graphicsLayer {
            transformOrigin = origin(512f,850f); translationY = pose.y / 780f * size.toPx(); scaleX = pose.scaleX; scaleY = pose.scaleY
        }) {
            Image(painterResource(R.drawable.ic_mascot_leaf),null,Modifier.fillMaxSize().graphicsLayer { transformOrigin = origin(523f,380f); rotationZ = pose.leaf })
            Image(painterResource(R.drawable.ic_mascot_body),null,Modifier.fillMaxSize())
            Box(Modifier.fillMaxSize().graphicsLayer { translationX = pose.gazeX / 780f * size.toPx(); translationY = pose.gazeY / 780f * size.toPx() }) {
                Image(painterResource(R.drawable.ic_mascot_eye_left),null,Modifier.fillMaxSize().graphicsLayer { transformOrigin = origin(422f,592f); scaleY = pose.blink })
                Image(painterResource(R.drawable.ic_mascot_eye_right),null,Modifier.fillMaxSize().graphicsLayer { transformOrigin = origin(602f,592f); scaleY = pose.blink })
            }
            Image(painterResource(R.drawable.ic_mascot_mouth),null,Modifier.fillMaxSize())
        }
    }
}
