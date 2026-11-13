package io.github.mitzacoder.kemiri.features.chat

import android.annotation.SuppressLint
import android.content.Context
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.view.MotionEvent
import android.view.View
import android.view.ViewGroup
import android.view.ViewConfiguration
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.LinkAnnotation
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextLinkStyles
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.edit
import androidx.media3.common.MediaItem
import androidx.media3.common.PlaybackParameters
import androidx.media3.common.Player
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.ui.PlayerView
import io.github.mitzacoder.kemiri.ui.theme.Jarvis
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.isActive

/** Where each video stopped and the speed chosen last, kept on the device (the web keeps them per browser). */
object VideoMemoryStore {
    private const val PREFERENCES = "video-player"
    /** The web's localStorage key; bumped when the stored shape changes. */
    const val KEY = io.github.mitzacoder.kemiri.BuildConfig.PREFERENCES_PREFIX + ".video.v1"
    private val state = MutableStateFlow<VideoMemory?>(null)

    fun memory(context: Context): StateFlow<VideoMemory?> {
        if (state.value == null) state.value = parseVideoMemory(context.prefs().getString(KEY, null))
        return state.asStateFlow()
    }

    fun update(context: Context, change: (VideoMemory) -> VideoMemory) {
        val next = change(memory(context).value ?: VideoMemory())
        state.value = next
        runCatching { context.prefs().edit { putString(KEY, encodeVideoMemory(next)) } }
    }

    private fun Context.prefs() = applicationContext.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE)
}

/** Times in a video's note as links that seek it (web `linkNoteTimes`), for the note's Markdown. */
internal class NoteTimeLinker(private val duration: Double?, private val styles: TextLinkStyles, private val seek: (Int) -> Unit) : TextLinker {
    override fun find(text: String): List<TextLinkSpan> = noteTimes(text, duration).map { time ->
        TextLinkSpan(time.start, time.end, LinkAnnotation.Clickable("t=${time.seconds}", styles) { seek(time.seconds) })
    }
}

@Composable
internal fun noteTimeLinkStyles(): TextLinkStyles = TextLinkStyles(SpanStyle(color = Jarvis.colors.accent2, fontWeight = FontWeight.SemiBold))

internal fun preferSoftwareVideoDecoder(hardware: String): Boolean = hardware.contains("ranchu", true) || hardware.contains("goldfish", true)

/**
 * A video or audio artifact in Media3's player. A video keeps its place and the chosen speed on the device ("Resumed at
 * … · Start over"), offers 1–3× speeds, skips ±10 s on a double tap on either half (more quick taps add up; a single
 * tap shows or hides the controls), and seeks when a time in its note is tapped ([seeks]). [compact] is the chat's
 * player (web `compact`): no taller than 352dp, play, the time bar and [onExpand]'s full-screen button only; it plays
 * at once with [autoplay] and keeps its place before [onExpand] (told whether it was playing), so the viewer picks up there.
 * The task carousel's slide passes [frameModifier] (the player fills the slide), pauses it by turning [active] off, and
 * follows whether it plays through [onPlayingChange].
 */
@androidx.annotation.OptIn(androidx.media3.common.util.UnstableApi::class)
@Composable
internal fun ArtifactMedia(
    url: String,
    refresh: () -> Unit,
    memoryKey: String? = null,
    seeks: Flow<Int>? = null,
    onDuration: (Double) -> Unit = {},
    compact: Boolean = false,
    autoplay: Boolean = false,
    onExpand: ((playing: Boolean) -> Unit)? = null,
    active: Boolean = true,
    onPlayingChange: ((Boolean) -> Unit)? = null,
    frameModifier: Modifier? = null,
) {
    val android = LocalContext.current
    val player = remember {
        val renderers = androidx.media3.exoplayer.DefaultRenderersFactory(android).setEnableDecoderFallback(true)
        if (preferSoftwareVideoDecoder(Build.HARDWARE)) {
            // Goldfish host H.264 can fail after buffer/surface changes under headless SwiftShader.
            // Physical devices retain the platform ordering; this uses the already installed software codec.
            renderers.setMediaCodecSelector { mime, secure, tunnel ->
                androidx.media3.exoplayer.mediacodec.MediaCodecSelector.DEFAULT.getDecoderInfos(mime, secure, tunnel).sortedBy { !it.softwareOnly }
            }
        }
        ExoPlayer.Builder(android, renderers)
            .setSeekBackIncrementMs(SKIP_SECONDS * 1000L).setSeekForwardIncrementMs(SKIP_SECONDS * 1000L)
            .build().also { it.playWhenReady = autoplay }
    }
    val memory by VideoMemoryStore.memory(android).collectAsState()
    var duration by remember { mutableLongStateOf(0) }
    var aspect by remember { mutableFloatStateOf(16f / 9f) }
    var sourceRevision by remember { mutableIntStateOf(0) }
    var mediaFailure by remember { mutableStateOf<String?>(null) }
    var rate by remember { mutableDoubleStateOf(if (memoryKey != null) memory?.rate ?: 1.0 else 1.0) }
    var resumedAt by remember { mutableStateOf<Double?>(null) }
    var resumeChecked by remember { mutableStateOf(memoryKey == null) }
    var cue by remember { mutableStateOf<VideoCue?>(null) }
    var cueCount by remember { mutableIntStateOf(0) }
    var speedMenu by remember { mutableStateOf(false) }
    val onRefresh by rememberUpdatedState(refresh)
    val expand by rememberUpdatedState(onExpand)
    val reportDuration by rememberUpdatedState(onDuration)
    val reportPlaying by rememberUpdatedState(onPlayingChange)
    var retryAfter by remember { mutableLongStateOf(0) }
    fun keepPlace(position: Long = player.currentPosition) {
        val key = memoryKey ?: return
        if (!resumeChecked || duration <= 0) return
        VideoMemoryStore.update(android) { rememberPosition(it, key, position / 1000.0, duration / 1000.0, System.currentTimeMillis()) }
    }
    DisposableEffect(player) {
        player.setPlaybackSpeed(rate.toFloat())
        val listener = object : Player.Listener {
            override fun onPlaybackStateChanged(state: Int) {
                if (state == Player.STATE_READY || state == Player.STATE_ENDED) {
                    duration = player.duration.coerceAtLeast(0)
                    if (duration > 0) reportDuration(duration / 1000.0)
                    Log.d("HarnessMedia", "ready source=$sourceRevision durationMs=$duration positionMs=${player.currentPosition}")
                }
                if (state == Player.STATE_READY && !resumeChecked && memoryKey != null) {
                    resumeChecked = true
                    resumeTime(memory?.positions?.get(memoryKey)?.time, duration / 1000.0)?.let { time ->
                        player.seekTo((time * 1000).toLong())
                        resumedAt = time
                    }
                }
                if (state == Player.STATE_ENDED) keepPlace(duration)
            }
            override fun onIsPlayingChanged(isPlaying: Boolean) { if (!isPlaying) keepPlace(); reportPlaying?.invoke(isPlaying) }
            override fun onPlaybackParametersChanged(parameters: PlaybackParameters) {
                rate = parameters.speed.toDouble()
                if (memoryKey != null && PLAYBACK_RATES.any { kotlin.math.abs(it - rate) < 1e-6 }) VideoMemoryStore.update(android) { it.copy(rate = rate) }
            }
            override fun onVideoSizeChanged(videoSize: androidx.media3.common.VideoSize) {
                if (videoSize.width > 0 && videoSize.height > 0) aspect = (videoSize.width * videoSize.pixelWidthHeightRatio / videoSize.height).coerceIn(.5f, 2.4f)
            }
            override fun onRenderedFirstFrame() {
                Log.d("HarnessMedia", "frame source=$sourceRevision durationMs=${player.duration} positionMs=${player.currentPosition}")
            }
            override fun onPositionDiscontinuity(oldPosition: Player.PositionInfo, newPosition: Player.PositionInfo, reason: Int) {
                Log.d("HarnessMedia", "position source=$sourceRevision positionMs=${newPosition.positionMs}")
            }
            override fun onPlayerError(error: androidx.media3.common.PlaybackException) {
                // Expired range URLs may fail mid-seek; renew with a bounded retry rate.
                mediaFailure = "Media playback failed (${error.errorCodeName})."
                if(error.errorCode in 2000..2999 && System.currentTimeMillis() > retryAfter) { retryAfter = System.currentTimeMillis() + 15000; onRefresh() }
            }
        }
        player.addListener(listener)
        onDispose { keepPlace(); player.removeListener(listener); player.release() }
    }
    LaunchedEffect(url) {
        sourceRevision++; mediaFailure = null
        val position = player.currentPosition
        val playing = player.playWhenReady
        player.setMediaItem(MediaItem.fromUri(url),position)
        player.prepare(); player.playWhenReady = playing
    }
    // The place is kept every few seconds while it plays, so a crash or a killed app still resumes near it.
    LaunchedEffect(player, memoryKey) {
        while (isActive && memoryKey != null) { delay(5000); if (player.isPlaying) keepPlace() }
    }
    LaunchedEffect(seeks, player) {
        seeks?.collect { seconds -> player.seekTo(seconds * 1000L); player.play(); resumedAt = null }
    }
    // A carousel slide that stops being the active one stops playing.
    LaunchedEffect(player, active) { if (!active) player.pause() }
    val lifecycle = androidx.lifecycle.compose.LocalLifecycleOwner.current.lifecycle
    DisposableEffect(player,lifecycle) {
        val observer = androidx.lifecycle.LifecycleEventObserver { _,event -> if(event == androidx.lifecycle.Lifecycle.Event.ON_STOP) player.pause() }
        lifecycle.addObserver(observer)
        onDispose { lifecycle.removeObserver(observer) }
    }
    // A video keeps its own shape (web: the player sizes to the video); audio is the controls alone.
    val frame = when {
        frameModifier != null -> frameModifier
        memoryKey == null -> Modifier.fillMaxWidth().height(140.dp)
        // The web's compact frame: min(55dvh, 22rem), so a portrait video does not fill the chat.
        compact -> Modifier.fillMaxWidth().wrapContentWidth().heightIn(max = 352.dp).aspectRatio(aspect)
        else -> Modifier.fillMaxWidth().aspectRatio(aspect)
    }
    val controlsSurface = MaterialTheme.colorScheme.surface.toArgb()
    val controlsOnSurface = MaterialTheme.colorScheme.onSurface.toArgb()
    Box(frame.clip(RoundedCornerShape(if (compact) 12.dp else 16.dp)).background(Color.Black)) {
        AndroidView(factory = { context ->
            QuietPlayerView(context).apply {
                this.player = player
                useController = true
                // Pausing or ending must not pin the controls (the web hides them 1.5 s after any reveal).
                controllerAutoShow = false
                controllerShowTimeoutMs = CONTROLS_IDLE_MS
                // Keys only reach a view that has focus; the stock one has none until Tab finds it.
                isFocusable = true; isFocusableInTouchMode = true; descendantFocusability = ViewGroup.FOCUS_BEFORE_DESCENDANTS
                setShowPreviousButton(false); setShowNextButton(false)
                if (compact) {
                    setShowRewindButton(false); setShowFastForwardButton(false)
                    findViewById<View>(androidx.media3.ui.R.id.exo_settings)?.visibility = View.GONE
                }
                styleVideoControls(this, controlsSurface, controlsOnSurface)
                onKeyCue = { kind ->
                    val by = when (kind) { CueKind.SeekBack -> -SKIP_SECONDS; CueKind.SeekForward -> SKIP_SECONDS; else -> null }
                    cue = VideoCue(++cueCount, kind, by?.let { accumulateSeek(cue?.seconds, it) })
                }
                player.addListener(object : Player.Listener {
                    // The end shows the controls (with replay) for the idle time, then they go like any other reveal.
                    override fun onPlaybackStateChanged(state: Int) { if (state == Player.STATE_ENDED) showController() }
                })
                if (onExpand != null) setFullscreenButtonClickListener { val playing = player.isPlaying; keepPlace(); player.pause(); expand?.invoke(playing) }
                listenForTaps(this) { zone, double ->
                    requestFocus()
                    if (!double) { if (isControllerFullyVisible) hideController() else showController(); return@listenForTaps }
                    val by = if (zone == TapZone.Left) -SKIP_SECONDS else SKIP_SECONDS
                    val total = (player.duration.takeIf { it > 0 }?.toDouble() ?: Double.NaN) / 1000.0
                    player.seekTo((clampTime(player.currentPosition / 1000.0 + by, total) * 1000).toLong())
                    onKeyCue?.invoke(if (zone == TapZone.Left) CueKind.SeekBack else CueKind.SeekForward)
                }
            }
        }, modifier = Modifier.fillMaxSize(), update = {
                styleVideoControls(it, controlsSurface, controlsOnSurface)
                // The viewer's playing slide takes keyboard focus, so Space and the arrows work without a tap first.
                if (active && frameModifier != null && !it.hasFocus()) it.post { if (it.isAttachedToWindow) it.requestFocus() }
            },
            onRelease = { it.player = null })
        cue?.let { shown -> VideoKeyCue(shown, onDone = { id -> if (cue?.id == id) cue = null }) }
    }
    if (memoryKey != null && (!compact || resumedAt != null)) Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        resumedAt?.let { time ->
            Text("Resumed at ${formatClock(time, duration / 1000.0)}", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Text(" · ", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            TextButton(onClick = { player.seekTo(0); resumedAt = null }, contentPadding = PaddingValues(horizontal = 4.dp)) { Text("Start over") }
        }
        Spacer(Modifier.weight(1f))
        if (!compact) Box {
            TextButton(onClick = { speedMenu = true }, modifier = Modifier.semantics { contentDescription = "Playback speed ${formatRate(rate)}" }) { Text("Speed ${formatRate(rate)}") }
            DropdownMenu(speedMenu, { speedMenu = false }) {
                PLAYBACK_RATES.forEach { option ->
                    DropdownMenuItem(text = { Text(formatRate(option) + if (kotlin.math.abs(option - rate) < 1e-6) "  ✓" else "") },
                        onClick = { speedMenu = false; player.setPlaybackSpeed(option.toFloat()) })
                }
            }
        }
    }
    // Only a failure is worth a line; the player shows its own loading and length (the web shows neither in words).
    mediaFailure?.let { failure ->
        Text(failure, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error,
            modifier = Modifier.semantics { contentDescription = "$failure · source $sourceRevision" })
    }
}

/**
 * Taps on the player: a quick second tap on the same half (and each quick one after it) is a double tap at once; a lone
 * tap counts once no second one came within [DOUBLE_TAP_MS]. Taps on the controls' buttons never reach here.
 */
@SuppressLint("ClickableViewAccessibility")
private fun listenForTaps(view: PlayerView, onTap: (TapZone, Boolean) -> Unit) {
    val slop = ViewConfiguration.get(view.context).scaledTouchSlop
    val handler = Handler(Looper.getMainLooper())
    var downX = 0f; var downY = 0f; var downAt = 0L
    var previous: VideoTap? = null
    var pendingSingle: Runnable? = null
    view.setOnTouchListener { touched, event ->
        when (event.actionMasked) {
            MotionEvent.ACTION_DOWN -> { downX = event.x; downY = event.y; downAt = event.eventTime }
            MotionEvent.ACTION_UP -> {
                val still = kotlin.math.abs(event.x - downX) < slop && kotlin.math.abs(event.y - downY) < slop && event.eventTime - downAt < 500
                if (still) {
                    val tap = VideoTap(event.eventTime, tapZone(event.x, 0f, touched.width.toFloat()))
                    pendingSingle?.let(handler::removeCallbacks); pendingSingle = null
                    if (isDoubleTap(previous, tap)) onTap(tap.zone, true)
                    else Runnable { pendingSingle = null; onTap(tap.zone, false) }.also { pendingSingle = it; handler.postDelayed(it, DOUBLE_TAP_MS) }
                    previous = tap
                    // No performClick(): PlayerView's own click would toggle the controls a second time (accessibility clicks still reach it).
                }
            }
        }
        true
    }
}
