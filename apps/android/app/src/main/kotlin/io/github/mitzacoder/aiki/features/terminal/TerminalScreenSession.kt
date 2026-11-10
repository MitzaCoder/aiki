package io.github.mitzacoder.aiki.features.terminal

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import androidx.core.graphics.toColorInt
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.util.Log
import io.github.mitzacoder.aiki.data.*
import com.termux.terminal.TerminalColors
import com.termux.terminal.TerminalSession
import com.termux.terminal.TerminalSessionClient
import com.termux.terminal.TextStyle
import com.termux.view.TerminalView
import java.util.concurrent.ConcurrentLinkedQueue
import java.util.concurrent.atomic.AtomicBoolean
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.StateFlow

/** The emulator's scrollback. zellij keeps the real one on the backend; this is what a finger can scroll back through. */
private const val TRANSCRIPT_ROWS = 4000
/** Size an emulator starts at, before a view has measured one. */
private const val DEFAULT_COLS = 80
private const val DEFAULT_ROWS = 24
/** The most the main thread spends on terminal output in one turn before it lets the UI draw. */
private const val DRAIN_BUDGET_MS = 8L
/** How long a session waits for a view to measure the screen before it attaches at the default size. */
private const val FIRST_SIZE_WAIT_MS = 1_500L

/**
 * One terminal tab's live parts: the remote [TerminalHandle], the vendored Termux emulator ([TerminalSession]) that
 * parses its output, and the queue that moves output from the socket's thread to the main thread in order.
 *
 * It outlives the view: the activity is recreated on rotation, and the view re-attaches to the same emulator
 * ([attach]), scrollback and all. Everything on the Termux side runs on the main thread, as its classes require.
 */
class TerminalScreenSession(
    private val context: Context,
    client: HarnessClient,
    scope: CoroutineScope,
    session: String?,
    prefix: String?,
    cwd: String?,
    private var palette: TerminalPalette,
    /** The size of the screen's terminals, when a view has measured one: the emulator starts at it, so nothing is resized after output. */
    knownSize: Pair<Int, Int>?,
) : TerminalConsumer, TerminalSession.Sink, TerminalSessionClient {
    private val main = Handler(Looper.getMainLooper())
    private val queue = ConcurrentLinkedQueue<Any>()
    private val scheduled = AtomicBoolean(false)
    private var view: TerminalView? = null
    private var closed = false
    val emulator: TerminalSession = TerminalSession(this, TRANSCRIPT_ROWS, this)
    val handle: TerminalHandle = TerminalHandle(client, scope, this, session, prefix, cwd, knownSize?.first ?: DEFAULT_COLS, knownSize?.second ?: DEFAULT_ROWS)
    private var started = false
    private var sized = false
    val state: StateFlow<TerminalState> get() = handle.state

    /** Fired on the main thread when the emulator's size changes (a view fitted it). */
    var onResized: ((Int, Int) -> Unit)? = null

    init {
        emulator.updateSize(knownSize?.first ?: DEFAULT_COLS, knownSize?.second ?: DEFAULT_ROWS)
        applyPalette(palette)
        sized = true
        // Attach at the real size: wait for the first view to measure it (a screen is on its way), but not for long.
        if (knownSize != null) start() else main.postDelayed(::start, FIRST_SIZE_WAIT_MS)
    }

    private fun start() {
        if (started || closed) return
        started = true
        handle.start()
    }

    /** Show this session in [target]; the view's size drives the emulator's, and so the backend's. */
    fun attach(target: TerminalView) {
        view = target
        target.attachSession(emulator)
        target.onScreenUpdated()
    }

    fun detachView(from: TerminalView) {
        if (view === from) view = null
    }

    /** Type bytes into the session. */
    fun type(text: String) { handle.write(text.toByteArray(Charsets.UTF_8)) }

    /** Paste as the program wants it: one input, bracketed when it asked for that. */
    fun paste(text: String) { if (text.isNotEmpty()) emulator.emulator?.paste(text) ?: type(text) }

    /** The palette of the app's theme, applied to this emulator now and to what it draws from here on. */
    fun applyPalette(next: TerminalPalette) {
        palette = next
        // The scheme a reset (and every new emulator) falls back to, then what this emulator draws with now.
        paintPalette(TerminalColors.COLOR_SCHEME.mDefaultColors, next)
        emulator.emulator?.mColors?.mCurrentColors?.let { paintPalette(it, next) }
        view?.invalidate()
    }

    /** Stop everything: detach from the backend (the session keeps running there) and drop the queue. */
    fun close() {
        closed = true
        handle.detach()
        queue.clear()
        view = null
    }

    // --- TerminalConsumer: called on the socket's thread, in order --------------------------------------------------

    override fun output(bytes: ByteArray) { enqueue(bytes) }
    override fun reset() { enqueue(RESET) }

    private fun enqueue(item: Any) {
        if (closed) return
        queue.add(item)
        if (scheduled.compareAndSet(false, true)) main.post(::drain)
    }

    private fun drain() {
        scheduled.set(false)
        val deadline = SystemClock.uptimeMillis() + DRAIN_BUDGET_MS
        while (!closed) {
            val item = queue.poll() ?: return
            if (item === RESET) emulator.reset()
            else {
                val bytes = item as ByteArray
                emulator.append(bytes, 0, bytes.size)
                handle.processed(bytes.size)
            }
            if (SystemClock.uptimeMillis() > deadline) {
                // Let the UI draw and take touches; the rest is next turn.
                if (queue.isNotEmpty() && scheduled.compareAndSet(false, true)) main.post(::drain)
                return
            }
        }
    }

    // --- TerminalSession.Sink: from the main thread ----------------------------------------------------------------

    override fun send(data: ByteArray, offset: Int, count: Int) { handle.write(data, offset, count) }

    override fun resized(columns: Int, rows: Int) {
        handle.resize(columns.coerceIn(1, TERMINAL_MAX_COLS), rows.coerceIn(1, TERMINAL_MAX_ROWS))
        if (sized) { start(); onResized?.invoke(columns, rows) }
    }

    // --- TerminalSessionClient ----------------------------------------------------------------------------------------

    override fun onTextChanged(changedSession: TerminalSession) { view?.onScreenUpdated() }
    override fun onTitleChanged(changedSession: TerminalSession) {}
    override fun onSessionFinished(finishedSession: TerminalSession) {}
    override fun onCopyTextToClipboard(session: TerminalSession, text: String) { copyToClipboard(context, text) }
    override fun onPasteTextFromClipboard(session: TerminalSession) { clipboardText(context)?.let(::paste) }
    override fun onBell(session: TerminalSession) {}
    override fun onColorsChanged(session: TerminalSession) { view?.invalidate() }
    override fun onTerminalCursorStateChange(state: Boolean) { view?.invalidate() }
    override fun getTerminalCursorStyle(): Int? = null
    override fun logError(tag: String, message: String) { Log.e(tag, message) }
    override fun logWarn(tag: String, message: String) { Log.w(tag, message) }
    override fun logInfo(tag: String, message: String) {}
    override fun logDebug(tag: String, message: String) {}
    override fun logVerbose(tag: String, message: String) {}
    override fun logStackTraceWithMessage(tag: String, message: String, e: Exception) { Log.e(tag, message, e) }
    override fun logStackTrace(tag: String, e: Exception) { Log.e(tag, "terminal", e) }

    private companion object {
        val RESET = Any()
        fun parseColor(hex: String): Int = hex.toColorInt()
        fun paintPalette(colors: IntArray, palette: TerminalPalette) {
            palette.ansi.forEachIndexed { index, hex -> colors[index] = parseColor(hex) }
            colors[TextStyle.COLOR_INDEX_FOREGROUND] = parseColor(palette.foreground)
            colors[TextStyle.COLOR_INDEX_BACKGROUND] = parseColor(palette.background)
            colors[TextStyle.COLOR_INDEX_CURSOR] = parseColor(palette.cursor)
        }
    }
}

fun copyToClipboard(context: Context, text: String) {
    if (text.isEmpty()) return
    (context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager).setPrimaryClip(ClipData.newPlainText("terminal", text))
}

fun clipboardText(context: Context): String? {
    val clipboard = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
    return clipboard.primaryClip?.takeIf { it.itemCount > 0 }?.getItemAt(0)?.coerceToText(context)?.toString()?.takeIf { it.isNotEmpty() }
}
