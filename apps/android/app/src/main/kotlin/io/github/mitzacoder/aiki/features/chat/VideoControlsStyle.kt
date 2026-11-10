package io.github.mitzacoder.aiki.features.chat

import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.view.KeyEvent
import android.view.View
import android.view.ViewGroup
import android.widget.ImageView
import android.widget.TextView
import androidx.annotation.OptIn
import androidx.core.graphics.ColorUtils
import androidx.media3.common.Player
import androidx.media3.ui.DefaultTimeBar
import androidx.media3.ui.PlayerView

/** The bar's tint of the theme surface (web `.controls`: 45%, no blur). */
const val CONTROLS_TINT_ALPHA = 0.45f

/**
 * A [PlayerView] whose controls stay out of the way: hardware keys (Space, media keys, D-pad left/right) act on the
 * player directly and never reveal the controller (the stock view shows it on every key); a showing controller is
 * hidden at once. Taps show it ([showController]) and it hides after [CONTROLS_IDLE_MS].
 */
@OptIn(androidx.media3.common.util.UnstableApi::class)
internal class QuietPlayerView(context: android.content.Context) : PlayerView(context) {
    /** Told what each handled key did, for the centred cue ([keyCue]). */
    var onKeyCue: ((CueKind) -> Unit)? = null

    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        val key = keyAction(event.keyCode)
        val player = player
        if (key == null || player == null || !useController) return super.dispatchKeyEvent(event)
        if (event.action == KeyEvent.ACTION_DOWN) {
            if (isControllerFullyVisible) hideController()
            val acts = event.repeatCount == 0 || key == VideoKey.SeekBack || key == VideoKey.SeekForward
            if (acts) onKeyCue?.invoke(keyCue(key, player.isPlaying))
            if (acts) when (key) {
                VideoKey.TogglePlay -> if (event.repeatCount == 0) {
                    if (player.playbackState == Player.STATE_ENDED) player.seekTo(0)
                    if (player.isPlaying) player.pause() else player.play()
                }
                VideoKey.Play -> player.play()
                VideoKey.Pause -> player.pause()
                VideoKey.SeekBack -> player.seekBack()
                VideoKey.SeekForward -> player.seekForward()
            }
        }
        return true
    }
}

/**
 * Makes the stock controller see-through: no dark scrim, the bottom bar a [CONTROLS_TINT_ALPHA] tint of the theme
 * [surface], icons and text in [onSurface] (text carries a surface-coloured shadow; icons sit on the tint, the skip
 * buttons on a tinted disc (play/pause is its own disc)). Safe to call again when the theme changes.
 */
@OptIn(androidx.media3.common.util.UnstableApi::class)
internal fun styleVideoControls(view: PlayerView, surface: Int, onSurface: Int) {
    val tint = ColorUtils.setAlphaComponent(surface, (CONTROLS_TINT_ALPHA * 255).toInt())
    val density = view.resources.displayMetrics.density
    view.findViewById<View>(androidx.media3.ui.R.id.exo_controls_background)?.setBackgroundColor(Color.TRANSPARENT)
    view.findViewById<View>(androidx.media3.ui.R.id.exo_bottom_bar)?.setBackgroundColor(tint)
    fun walk(v: View) {
        when (v) {
            is DefaultTimeBar -> {
                v.setPlayedColor(onSurface); v.setScrubberColor(onSurface)
                v.setBufferedColor(ColorUtils.setAlphaComponent(onSurface, 100))
                v.setUnplayedColor(ColorUtils.setAlphaComponent(onSurface, 55))
            }
            is TextView -> { v.setTextColor(onSurface); v.setShadowLayer(3 * density, 0f, 0f, surface) }
            is ImageView -> v.setColorFilter(onSurface)
        }
        if (v is ViewGroup) for (i in 0 until v.childCount) walk(v.getChildAt(i))
    }
    view.findViewById<View>(androidx.media3.ui.R.id.exo_controller)?.let(::walk)
    (view.findViewById<View>(androidx.media3.ui.R.id.exo_center_controls) as? ViewGroup)?.let { center ->
        for (i in 0 until center.childCount) if (center.getChildAt(i).id != androidx.media3.ui.R.id.exo_play_pause) center.getChildAt(i).background = GradientDrawable().apply { shape = GradientDrawable.OVAL; setColor(tint) }
    }
}
