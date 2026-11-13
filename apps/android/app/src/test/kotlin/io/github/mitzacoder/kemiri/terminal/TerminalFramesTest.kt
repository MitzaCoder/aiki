package io.github.mitzacoder.kemiri.terminal

import io.github.mitzacoder.kemiri.data.*
import org.junit.Assert.*
import org.junit.Test

/** The binary framing of `packages/protocol/src/terminal.ts`, byte for byte. */
class TerminalFramesTest {
    @Test fun inputFrameIsKindIdBigEndianThenPayload() {
        val frame = encodeTerminalFrame(TERMINAL_FRAME_INPUT, 258, "ab".toByteArray())
        assertArrayEquals(byteArrayOf(2, 0, 0, 1, 2, 97, 98), frame)
    }

    @Test fun aSliceOfALargerBufferIsFramedWithoutTheRest() {
        val frame = encodeTerminalFrame(TERMINAL_FRAME_INPUT, 1, "abcdef".toByteArray(), offset = 2, length = 3)
        assertArrayEquals(byteArrayOf(2, 0, 0, 0, 1, 99, 100, 101), frame)
    }

    @Test fun ackCarriesTheCountAsAnUnsignedBigEndianInteger() {
        assertArrayEquals(byteArrayOf(3, 0, 0, 0, 7, 0, 1, 17, 112), encodeTerminalAck(7, 70_000))
        // Capped at what fits in a u32.
        assertArrayEquals(byteArrayOf(3, 0, 0, 0, 7, -1, -1, -1, -1), encodeTerminalAck(7, 1L shl 40))
    }

    @Test fun idsAboveTheSignedRangeSurviveTheRoundTrip() {
        val id = 0xFFFF_FFFEL
        val frame = decodeTerminalFrame(encodeTerminalFrame(TERMINAL_FRAME_OUTPUT, id, byteArrayOf(1, 2, 3)))!!
        assertEquals(TERMINAL_FRAME_OUTPUT, frame.kind)
        assertEquals(id, frame.terminalId)
        assertArrayEquals(byteArrayOf(1, 2, 3), frame.payload)
    }

    @Test fun shortFramesAndUnknownKindsAreIgnored() {
        assertNull(decodeTerminalFrame(byteArrayOf(1, 0, 0, 0)))
        assertNull(decodeTerminalFrame(byteArrayOf(9, 0, 0, 0, 1, 5)))
        assertEquals(0, decodeTerminalFrame(byteArrayOf(1, 0, 0, 0, 1))!!.payload.size)
    }

    @Test fun inputIsChunkedAtTheServersLimit() {
        assertEquals(64 * 1024, TERMINAL_MAX_INPUT_BYTES)
    }
}
