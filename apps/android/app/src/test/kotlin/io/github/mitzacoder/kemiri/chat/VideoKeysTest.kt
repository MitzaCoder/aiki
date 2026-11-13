package io.github.mitzacoder.kemiri.chat

import android.view.KeyEvent
import io.github.mitzacoder.kemiri.features.chat.*
import org.junit.Assert.*
import org.junit.Test

class VideoKeysTest {
    @Test fun playAndSeekKeysAreHandledQuietly() {
        assertEquals(VideoKey.TogglePlay, keyAction(KeyEvent.KEYCODE_SPACE))
        assertEquals(VideoKey.TogglePlay, keyAction(KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE))
        assertEquals(VideoKey.Play, keyAction(KeyEvent.KEYCODE_MEDIA_PLAY))
        assertEquals(VideoKey.Pause, keyAction(KeyEvent.KEYCODE_MEDIA_PAUSE))
        assertEquals(VideoKey.SeekBack, keyAction(KeyEvent.KEYCODE_DPAD_LEFT))
        assertEquals(VideoKey.SeekForward, keyAction(KeyEvent.KEYCODE_DPAD_RIGHT))
        assertEquals(VideoKey.SeekForward, keyAction(KeyEvent.KEYCODE_MEDIA_FAST_FORWARD))
    }

    @Test fun otherKeysAreLeftToTheView() {
        assertNull(keyAction(KeyEvent.KEYCODE_BACK))
        assertNull(keyAction(KeyEvent.KEYCODE_TAB))
        assertNull(keyAction(KeyEvent.KEYCODE_DPAD_UP))
        assertEquals(1500, CONTROLS_IDLE_MS)
    }

    @Test fun eachKeyHasACue() {
        assertEquals(CueKind.Pause, keyCue(VideoKey.TogglePlay, playing = true))
        assertEquals(CueKind.Play, keyCue(VideoKey.TogglePlay, playing = false))
        assertEquals(CueKind.Play, keyCue(VideoKey.Play, playing = true))
        assertEquals(CueKind.Pause, keyCue(VideoKey.Pause, playing = false))
        assertEquals(CueKind.SeekBack, keyCue(VideoKey.SeekBack, playing = true))
        assertEquals(CueKind.SeekForward, keyCue(VideoKey.SeekForward, playing = false))
        assertEquals(550, CUE_MS)
    }

    @Test fun seeksPressedAgainAddUpAndATurnStartsOver() {
        assertEquals(10, accumulateSeek(null, 10))
        assertEquals(20, accumulateSeek(10, 10))
        assertEquals(30, accumulateSeek(20, 10))
        assertEquals(-20, accumulateSeek(-10, -10))
        assertEquals(-10, accumulateSeek(30, -10))
        assertEquals("+30s", formatSeekCue(30))
        assertEquals("−10s", formatSeekCue(-10))
    }
}
