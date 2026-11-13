package io.github.mitzacoder.kemiri.data

import io.github.mitzacoder.kemiri.protocol.*
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * A terminal attached through the client: one zellij session on the backend, its output as bytes, its input as bytes.
 * The port of `packages/client/src/terminal.ts` (`TerminalSession`).
 *
 * The handle outlives the socket. When the connection drops it goes to [TerminalStatus.Reconnecting], and once the client
 * is ready again it attaches the same session by name; zellij repaints it, and the consumer is told to reset its screen
 * before the first new output. A session that ended (the shell exited, the session was killed) is [TerminalStatus.Ended]
 * and is not reopened by itself.
 *
 * The consumer calls [processed] with the bytes it has rendered; that is what the server paces on.
 */
enum class TerminalStatus {
    /** The first attach is under way. */
    Attaching,
    Attached,
    /** The connection dropped (or the server restarted); the same session is attached again when it is back. */
    Reconnecting,
    /** The session ended: the shell exited, it was detached from inside, or it was killed. */
    Ended,
    /** It cannot be attached (no zellij, a limit, a bad folder); [TerminalState.error] says why. */
    Failed,
    /** Closed by this client; the session keeps running on the backend. */
    Detached,
}

data class TerminalState(
    val status: TerminalStatus = TerminalStatus.Attaching,
    /** The session's name once it is known (a new session is named by the backend). */
    val session: String? = null,
    /** Whether the last attach created the session (false: it was already there). */
    val created: Boolean? = null,
    val error: String? = null,
    val errorCode: String? = null,
    /** Why it ended, when [status] is [TerminalStatus.Ended]: `exited`, `killed` or `error`. */
    val endedReason: String? = null,
    val exitCode: Long? = null,
)

/** Where a terminal's output goes. Called on the client's reader thread, in order. */
interface TerminalConsumer {
    fun output(bytes: ByteArray)
    /** Clear the screen: the next output repaints it. */
    fun reset()
}

/** Errors that will not get better by trying again when the socket comes back. */
internal val TERMINAL_FINAL_CODES = setOf("terminal_unavailable", "terminal_limit", "invalid_path", "unknown_request", "bad_request")
private const val ACK_BATCH_BYTES = 16 * 1024
private const val ACK_DELAY_MS = 25L

class TerminalHandle(
    private val client: HarnessClient,
    private val scope: CoroutineScope,
    private val output: TerminalConsumer,
    session: String?,
    private val prefix: String?,
    private val cwd: String?,
    cols: Int,
    rows: Int,
) : TerminalSink {
    private val lock = Any()
    private val mutableState = MutableStateFlow(TerminalState(TerminalStatus.Attaching, session))
    val state: StateFlow<TerminalState> = mutableState.asStateFlow()
    private var terminalId: Long? = null
    private var session: String? = session
    private var cols = cols
    private var rows = rows
    private var attached = false
    private var attaching = false
    /** The socket closed while an open was in flight: the answer, if it still arrives, names a terminal that is gone. */
    private var lostDuringAttach = false
    private var stopped = false
    /** The next output repaints the whole screen: tell the consumer before it. Set when a session is attached again. */
    private var resetBeforeOutput = false
    private var unacked = 0L
    private var ackTimer: Job? = null
    private var watching: Job? = null

    /** Begin attaching, and keep the session attached across reconnects. */
    fun start() {
        watching = scope.launch {
            client.state.collect { connection ->
                if (connection.status == ConnectionStatus.Ready) attach() else connectionLost()
            }
        }
    }

    /** Type into the terminal. False when it is not attached (what was typed is not kept). */
    fun write(data: ByteArray, offset: Int = 0, count: Int = data.size - offset): Boolean {
        val id = synchronized(lock) { if (attached) terminalId else null } ?: return false
        var position = offset
        val end = offset + count
        while (position < end) {
            val length = minOf(TERMINAL_MAX_INPUT_BYTES, end - position)
            if (!client.sendBinary(encodeTerminalFrame(TERMINAL_FRAME_INPUT, id, data, position, length))) return false
            position += length
        }
        return true
    }

    /** Tell the backend the terminal's size changed. Remembered for the next attach. */
    fun resize(cols: Int, rows: Int) {
        val id = synchronized(lock) {
            if (cols == this.cols && rows == this.rows) return
            this.cols = cols
            this.rows = rows
            if (attached) terminalId else null
        } ?: return
        scope.launch { runCatching { client.request(TerminalResizeRequest(terminalId = id, cols = cols.toLong(), rows = rows.toLong())) } }
    }

    /** The consumer has rendered [bytes] of output. */
    fun processed(bytes: Int) {
        val flushNow = synchronized(lock) {
            unacked += bytes
            if (unacked >= ACK_BATCH_BYTES) true
            else {
                if (ackTimer == null) ackTimer = scope.launch { delay(ACK_DELAY_MS); flushAck() }
                false
            }
        }
        if (flushNow) flushAck()
    }

    /** Stop this client's attachment. The session keeps running on the backend and can be attached again. */
    fun detach() {
        val id: Long?
        synchronized(lock) {
            if (stopped) return
            stopped = true
            id = terminalId
            terminalId = null
            attached = false
            clearAck()
        }
        watching?.cancel()
        client.releaseTerminal(this)
        mutableState.value = mutableState.value.copy(status = TerminalStatus.Detached)
        if (id != null) scope.launch { runCatching { client.request(TerminalCloseRequest(terminalId = id)) } }
    }

    // --- called by the client --------------------------------------------------------------------------------------

    override fun onOutput(bytes: ByteArray) {
        val reset = synchronized(lock) {
            if (stopped) return
            resetBeforeOutput.also { resetBeforeOutput = false }
        }
        if (reset) output.reset()
        output.output(bytes)
    }

    override fun onResync() { if (!synchronized(lock) { stopped }) output.reset() }

    override fun onClosed(event: TerminalClosedEvent) {
        synchronized(lock) {
            if (stopped) return
            attached = false
            terminalId = null
            clearAck()
            stopped = true
        }
        watching?.cancel()
        client.releaseTerminal(this)
        mutableState.value = TerminalState(
            TerminalStatus.Ended, session = session, endedReason = event.reason, exitCode = event.exitCode, error = event.message,
        )
    }

    override fun onConnectionLost() = connectionLost()

    // --- internals -------------------------------------------------------------------------------------------------

    private suspend fun attach() {
        val request: TerminalOpenRequest
        val reattach: Boolean
        synchronized(lock) {
            if (attaching || attached || stopped) return
            attaching = true
            lostDuringAttach = false
            reattach = session != null && mutableState.value.status == TerminalStatus.Reconnecting
            request = TerminalOpenRequest(
                session = session,
                prefix = if (session == null) prefix else null,
                cwd = cwd,
                cols = cols.toLong(),
                rows = rows.toLong(),
            )
            // Set before the answer: the first frames can arrive on the reader thread right behind it.
            if (reattach) resetBeforeOutput = true
        }
        try {
            val response = client.openTerminal(this, request)
            val detachedMeanwhile = synchronized(lock) {
                if (stopped) true
                else if (lostDuringAttach) throw ClientException("disconnected", "Connection lost while attaching")
                else {
                    terminalId = response.terminalId
                    session = response.session
                    attached = true
                    unacked = 0
                    false
                }
            }
            if (detachedMeanwhile) {
                // Detached while the open was in flight: let the backend drop it again.
                client.releaseTerminal(this)
                runCatching { client.request(TerminalCloseRequest(terminalId = response.terminalId)) }
                return
            }
            mutableState.value = TerminalState(TerminalStatus.Attached, session = response.session, created = response.created)
            val (wantedCols, wantedRows) = synchronized(lock) { cols to rows }
            // The size may have changed while it was away.
            if (response.cols != wantedCols.toLong() || response.rows != wantedRows.toLong()) {
                runCatching { client.request(TerminalResizeRequest(terminalId = response.terminalId, cols = wantedCols.toLong(), rows = wantedRows.toLong())) }
            }
        } catch (error: CancellationException) {
            throw error
        } catch (error: Exception) {
            val code = (error as? ClientException)?.code
            if (code != null && code in TERMINAL_FINAL_CODES) {
                val gone = synchronized(lock) { (stopped).also { stopped = true } }
                if (!gone) {
                    watching?.cancel()
                    client.releaseTerminal(this)
                    mutableState.value = TerminalState(TerminalStatus.Failed, session = session, error = error.message, errorCode = code)
                }
            }
            // Anything else is a dropped connection or a timeout: the next ready connection tries again.
        } finally {
            synchronized(lock) { attaching = false }
        }
    }

    private fun connectionLost() {
        synchronized(lock) {
            if (stopped || (!attached && !attaching)) return
            if (attaching) lostDuringAttach = true
            attached = false
            terminalId = null
            clearAck()
            unacked = 0
            // What zellij draws after the next attach replaces the screen, whether or not this handle noticed in time.
            if (session != null) resetBeforeOutput = true
        }
        mutableState.value = mutableState.value.copy(status = TerminalStatus.Reconnecting)
    }

    private fun flushAck() {
        val frame: ByteArray
        synchronized(lock) {
            clearAck()
            val id = terminalId
            if (unacked <= 0 || id == null) return
            frame = encodeTerminalAck(id, unacked)
            unacked = 0
        }
        client.sendBinary(frame)
    }

    private fun clearAck() {
        ackTimer?.cancel()
        ackTimer = null
    }
}
