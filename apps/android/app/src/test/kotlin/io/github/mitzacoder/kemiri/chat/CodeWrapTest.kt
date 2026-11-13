package io.github.mitzacoder.kemiri.chat

import io.github.mitzacoder.kemiri.features.chat.*
import org.junit.Assert.*
import org.junit.Test
import io.github.mitzacoder.kemiri.data.DeviceSettings
import io.github.mitzacoder.kemiri.data.wireJson

class CodeWrapTest {
    @Test fun aBlocksDefaultHoldsUntilTheReaderChooses() {
        assertTrue(effectiveWrap(null, true))
        assertFalse(effectiveWrap(null, false))
        assertFalse(effectiveWrap(CODE_SCROLL, true))
        assertTrue(effectiveWrap(CODE_WRAP, false))
        assertFalse(effectiveWrap("junk", false))
    }

    @Test fun toggleFlipsWhatTheBlockDoesNow() {
        var chosen: String? = null
        CodeWrapChoice(null) { chosen = it }.toggle(defaultWrap = true)
        assertEquals(CODE_SCROLL, chosen)
        CodeWrapChoice(null) { chosen = it }.toggle(defaultWrap = false)
        assertEquals(CODE_WRAP, chosen)
        CodeWrapChoice(CODE_WRAP) { chosen = it }.toggle(defaultWrap = false)
        assertEquals(CODE_SCROLL, chosen)
    }

    @Test fun fadeIsOnTheEdgeWithMoreBehindIt() {
        assertEquals(ScrollFade(start = false, end = true), scrollFade(0, 500))
        assertEquals(ScrollFade(start = true, end = true), scrollFade(200, 500))
        assertEquals(ScrollFade(start = true, end = false), scrollFade(500, 500))
        assertEquals(ScrollFade(start = false, end = false), scrollFade(0, 0))
    }

    @Test fun onlyLinesThatContinueALineGetAnArrow() {
        val text = "aaaa bbbb\ncccc"
        // Laid out as: "aaaa " / "bbbb" / "cccc": the middle row continues, the last starts after a newline.
        assertEquals(listOf(1), softWrappedLines(text, listOf(0, 5, 10)))
        assertEquals(emptyList<Int>(), softWrappedLines("one\ntwo", listOf(0, 4)))
    }

    @Test fun theChoiceIsPartOfTheDeviceSettingsAndOldSettingsStillRead() {
        assertNull(DeviceSettings().codeWrap)
        val saved = wireJson.encodeToString(DeviceSettings.serializer(), DeviceSettings(codeWrap = CODE_WRAP))
        assertEquals(CODE_WRAP, wireJson.decodeFromString(DeviceSettings.serializer(), saved).codeWrap)
        val old = wireJson.encodeToString(DeviceSettings.serializer(), DeviceSettings()).replace(Regex(",?\"codeWrap\":[^,}]*"), "")
        assertNull(wireJson.decodeFromString(DeviceSettings.serializer(), old).codeWrap)
    }
}
