package io.github.mitzacoder.kemiri.features.terminal

import android.content.Context
import android.content.Intent
import android.util.TypedValue
import android.view.MotionEvent
import android.view.inputmethod.InputMethodManager
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.core.content.edit
import androidx.core.net.toUri
import com.termux.terminal.TerminalSession
import com.termux.view.TerminalView
import com.termux.view.TerminalViewClient

private const val FONT_KEY = "font-sp"
const val MIN_TERMINAL_FONT_SP = 8
const val MAX_TERMINAL_FONT_SP = 24

/** The font size a screen starts at: smaller on a phone so a line is a useful width. */
fun defaultTerminalFontSp(widthDp: Int): Int = if (widthDp < 600) 12 else 14

fun terminalFontPx(context: Context, sp: Int): Int =
    TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_SP, sp.toFloat(), context.resources.displayMetrics).toInt()

/**
 * What the key bar, the view client and the screen share for the active terminal: the sticky Ctrl and Alt, the view the
 * keys act on, whether something is selected and the font size.
 */
class TerminalInput(private val context: Context, widthDp: Int) {
    private val preferences = context.getSharedPreferences(TERMINAL_TABS_PREFERENCES, Context.MODE_PRIVATE)

    var modifiers by mutableStateOf(Modifiers())
        private set
    /** Text is being selected in the active view (long press): the Copy button works. */
    var selecting by mutableStateOf(false)
    var fontSp by mutableIntStateOf(preferences.getInt(FONT_KEY, defaultTerminalFontSp(widthDp)).coerceIn(MIN_TERMINAL_FONT_SP, MAX_TERMINAL_FONT_SP))
        private set

    /** The session and view the key bar types into. */
    var active: TerminalScreenSession? = null
    var activeView: TerminalView? = null

    fun toggle(modifier: KeyModifier) {
        modifiers = when (modifier) { KeyModifier.Ctrl -> modifiers.copy(ctrl = !modifiers.ctrl); KeyModifier.Alt -> modifiers.copy(alt = !modifiers.alt) }
    }

    /** One key of the bar. A modifier toggles; the others type, with a waiting modifier applied. */
    fun press(key: KeyBarKey) {
        key.modifier?.let { toggle(it); return }
        val session = active ?: return
        val bytes = key.arrow?.let { arrowBytes(it, session.emulator.emulator?.isCursorKeysApplicationMode ?: false) } ?: key.bytes.orEmpty()
        session.type(if (key.arrow == null && key.bytes?.length == 1) applyModifiers(bytes, modifiers) else bytes)
        modifiers = Modifiers()
    }

    fun paste() { clipboardText(context)?.let { active?.paste(it) } }

    /** Copy what is selected and end the selection; false when nothing is. */
    fun copy(): Boolean {
        val view = activeView ?: return false
        val text = view.getSelectedTextOrNull()?.takeIf { it.isNotEmpty() } ?: return false
        copyToClipboard(context, text)
        view.stopTextSelectionMode()
        return true
    }

    /** Pinch: a step up or down in font size once the pinch is big enough. */
    fun scale(scale: Float): Float {
        if (scale in 0.9f..1.1f) return scale
        fontSp = (fontSp + if (scale > 1f) 1 else -1).coerceIn(MIN_TERMINAL_FONT_SP, MAX_TERMINAL_FONT_SP)
        preferences.edit { putInt(FONT_KEY, fontSp) }
        return 1f
    }

    /** Read (and spend) the bar's sticky Ctrl, for the view's next key. */
    fun takeCtrl(): Boolean = modifiers.ctrl.also { if (it) modifiers = modifiers.copy(ctrl = false) }
    fun takeAlt(): Boolean = modifiers.alt.also { if (it) modifiers = modifiers.copy(alt = false) }

    /** The view's callbacks: Termux's `TerminalViewClient`, wired to this input. One per view. */
    fun viewClient(): ViewClient = ViewClient()

    inner class ViewClient : TerminalViewClient {
        /** The view this client serves; set when the view is made (the view needs its client first). */
        var view: TerminalView? = null
        override fun onScale(scale: Float) = scale(scale)
        override fun onSingleTapUp(e: MotionEvent) { onTapWhileMouseTracking(e) }
        /** A tap on a link opens it; any other tap brings up the keyboard (and, under mouse reporting, still clicks). */
        override fun onTapWhileMouseTracking(e: MotionEvent): Boolean {
            val target = view ?: return false
            urlAt(target, e)?.let { openUrl(it); return true }
            (target.context.getSystemService(Context.INPUT_METHOD_SERVICE) as InputMethodManager).showSoftInput(target, 0)
            return false
        }
        override fun shouldBackButtonBeMappedToEscape() = false
        // Characters, not key codes: no composing text, no suggestions, the same on every keyboard.
        override fun shouldEnforceCharBasedInput() = true
        override fun shouldUseCtrlSpaceWorkaround() = false
        override fun isTerminalViewSelected() = true
        override fun copyModeChanged(copyMode: Boolean) { if (view === activeView) selecting = copyMode }
        override fun onKeyDown(keyCode: Int, e: android.view.KeyEvent, session: TerminalSession) = false
        override fun onKeyUp(keyCode: Int, e: android.view.KeyEvent) = false
        override fun onLongPress(event: MotionEvent) = false
        override fun readControlKey() = takeCtrl()
        override fun readAltKey() = takeAlt()
        override fun readShiftKey() = false
        override fun readFnKey() = false
        override fun onCodePoint(codePoint: Int, ctrlDown: Boolean, session: TerminalSession) = false
        override fun onEmulatorSet() {}
        override fun logError(tag: String, message: String) {}
        override fun logWarn(tag: String, message: String) {}
        override fun logInfo(tag: String, message: String) {}
        override fun logDebug(tag: String, message: String) {}
        override fun logVerbose(tag: String, message: String) {}
        override fun logStackTraceWithMessage(tag: String, message: String, e: Exception) {}
        override fun logStackTrace(tag: String, e: Exception) {}
    }

    fun openUrl(url: String) {
        try {
            context.startActivity(Intent(Intent.ACTION_VIEW, url.toUri()).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        } catch (_: Exception) { /* no app takes it */ }
    }
}

private val URL = Regex("""https?://[^\s<>"'`]+""")
private val URL_TRAILING = charArrayOf('.', ',', ';', ':', ')', ']', '}', '!', '?')

/** The `http(s)` URL under a tap, in that one row of the screen (a URL that wraps is not joined), or null. */
fun urlAt(view: TerminalView, event: MotionEvent): String? {
    val (column, row) = view.getColumnAndRow(event, false).let { it[0] to it[1] }
    return urlInRow(view.getRowText(row), column)
}

/** The URL in [row] that covers [column] (a cell, one per character for the text a terminal prints), or null. */
fun urlInRow(row: String, column: Int): String? {
    for (match in URL.findAll(row)) {
        val url = match.value.trimEnd(*URL_TRAILING)
        if (column in match.range.first until match.range.first + url.length) return url
    }
    return null
}
