package io.github.mitzacoder.aiki.data

import io.github.mitzacoder.aiki.protocol.TerminalClosedEvent

/*
 * The terminal's binary frames (`packages/protocol/src/terminal.ts`): `kind u8 | terminalId u32 (big-endian) | payload`.
 * Pure, so the framing is pinned in `TerminalFramesTest` against the same bytes the server's tests use.
 */

const val TERMINAL_FRAME_OUTPUT = 1
const val TERMINAL_FRAME_INPUT = 2
const val TERMINAL_FRAME_ACK = 3
const val TERMINAL_HEADER_BYTES = 5

/** Most bytes one input frame may carry; a larger paste is sent as several frames. */
const val TERMINAL_MAX_INPUT_BYTES = 64 * 1024
const val TERMINAL_MAX_COLS = 500
const val TERMINAL_MAX_ROWS = 200

class TerminalFrame(val kind: Int, val terminalId: Long, val payload: ByteArray)

/** Build a binary frame from [length] bytes of [payload] starting at [offset]. */
fun encodeTerminalFrame(kind: Int, terminalId: Long, payload: ByteArray, offset: Int = 0, length: Int = payload.size - offset): ByteArray {
    val frame = ByteArray(TERMINAL_HEADER_BYTES + length)
    frame[0] = kind.toByte()
    for (index in 0 until 4) frame[1 + index] = (terminalId ushr (24 - 8 * index)).toByte()
    System.arraycopy(payload, offset, frame, TERMINAL_HEADER_BYTES, length)
    return frame
}

/** The ack frame for [bytes] processed output bytes (a `u32`, capped). */
fun encodeTerminalAck(terminalId: Long, bytes: Long): ByteArray {
    val count = bytes.coerceIn(0L, 0xFFFF_FFFFL)
    val payload = ByteArray(4) { index -> (count ushr (24 - 8 * index)).toByte() }
    return encodeTerminalFrame(TERMINAL_FRAME_ACK, terminalId, payload)
}

/** Read a binary frame; null when it is too short or its kind is unknown. */
fun decodeTerminalFrame(data: ByteArray): TerminalFrame? {
    if (data.size < TERMINAL_HEADER_BYTES) return null
    val kind = data[0].toInt() and 0xFF
    if (kind != TERMINAL_FRAME_OUTPUT && kind != TERMINAL_FRAME_INPUT && kind != TERMINAL_FRAME_ACK) return null
    var terminalId = 0L
    for (index in 1..4) terminalId = (terminalId shl 8) or (data[index].toLong() and 0xFF)
    return TerminalFrame(kind, terminalId, data.copyOfRange(TERMINAL_HEADER_BYTES, data.size))
}

/**
 * What the client calls when something happens to an attached terminal. Called on the client's reader thread, in the
 * order things arrived; an implementation hands the work to its own thread.
 */
interface TerminalSink {
    /** Bytes the PTY wrote. */
    fun onOutput(bytes: ByteArray)
    /** The server dropped output: the next output repaints the screen. */
    fun onResync()
    /** The attach client ended without being asked (the shell exited, the session ended or was killed). */
    fun onClosed(event: TerminalClosedEvent)
    /** The socket closed; the server detached the terminal. */
    fun onConnectionLost()
}
