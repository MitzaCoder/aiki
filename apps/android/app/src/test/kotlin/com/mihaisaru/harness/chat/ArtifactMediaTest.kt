package com.mihaisaru.harness.chat

import com.mihaisaru.harness.features.chat.*
import org.junit.Assert.*
import org.junit.Test

/** Mirrors apps/web/test/video-player.test.ts and the lightbox and Markdown cases of apps/web/test/artifacts.test.ts. */
class ArtifactMediaTest {
    // --- video-player.test.ts --------------------------------------------------------------------------------------

    @Test fun theClockFloorsAndShowsHoursWhenTheVideoRunsThatLong() {
        assertEquals("0:00", formatClock(0.0))
        assertEquals("0:07", formatClock(7.9))
        assertEquals("12:30", formatClock(750.0))
        assertEquals("1:02:03", formatClock(3723.0))
        assertEquals("0:01:05", formatClock(65.0, 3700.0))
        assertEquals("0:00", formatClock(Double.NaN))
        assertEquals("0:00", formatClock(-3.0))
    }

    @Test fun speedsStepThroughTheOfferedOnesAndReadAsTheButtonShowsThem() {
        assertEquals(1.25, stepRate(1.0, 1), 0.0)
        assertEquals(3.0, stepRate(2.0, 1), 0.0)
        assertEquals(3.0, stepRate(3.0, 1), 0.0)
        assertEquals(1.25, stepRate(1.5, -1), 0.0)
        assertEquals(1.0, stepRate(1.0, -1), 0.0)
        assertEquals(2.0, stepRate(1.75, 1), 0.0)
        assertEquals(1.5, stepRate(1.75, -1), 0.0)
        assertEquals("1×", formatRate(1.0))
        assertEquals("1.25×", formatRate(1.25))
    }

    @Test fun clampTimeKeepsATimeInsideTheVideo() {
        assertEquals(0.0, clampTime(-4.0, 100.0), 0.0)
        assertEquals(100.0, clampTime(120.0, 100.0), 0.0)
        assertEquals(120.0, clampTime(120.0, Double.NaN), 0.0)
    }

    @Test fun twoQuickTapsOnTheSameHalfAreADoubleTap() {
        assertEquals(TapZone.Left, tapZone(10f, 0f, 390f))
        assertEquals(TapZone.Right, tapZone(300f, 0f, 390f))
        assertFalse(isDoubleTap(null, VideoTap(0, TapZone.Left)))
        assertTrue(isDoubleTap(VideoTap(0, TapZone.Left), VideoTap(DOUBLE_TAP_MS - 1, TapZone.Left)))
        assertFalse(isDoubleTap(VideoTap(0, TapZone.Left), VideoTap(DOUBLE_TAP_MS + 1, TapZone.Left)))
        assertFalse(isDoubleTap(VideoTap(0, TapZone.Left), VideoTap(100, TapZone.Right)))
    }

    private val key = videoKey("p1", "a1")

    @Test fun videoMemoryParsesWhatItStoredAndDropsTheRest() {
        assertEquals(VideoMemory(), parseVideoMemory(null))
        assertEquals(VideoMemory(), parseVideoMemory("{not json"))
        assertEquals(VideoMemory(), parseVideoMemory("""{"rate":7,"positions":{"a":{"time":"x","at":1}}}"""))
        assertEquals(VideoMemory(1.5, mapOf(key to VideoPosition(42.0, 9))), parseVideoMemory("""{"rate":1.5,"positions":{"$key":{"time":42,"at":9}}}"""))
        val memory = VideoMemory(2.0, mapOf(key to VideoPosition(50.0, 3)))
        assertEquals("round-trips through storage", memory, parseVideoMemory(encodeVideoMemory(memory)))
    }

    @Test fun remembersAPlaceWorthResumingAndForgetsOneNearTheStartOrTheEnd() {
        val remembered = rememberPosition(VideoMemory(), key, 60.0, 300.0, 1)
        assertEquals(VideoPosition(60.0, 1), remembered.positions[key])
        assertNull(rememberPosition(remembered, key, 2.0, 300.0, 2).positions[key])
        assertNull(rememberPosition(remembered, key, 298.0, 300.0, 2).positions[key])
    }

    @Test fun keepsOnlyTheMostRecentPlaces() {
        var memory = VideoMemory()
        for (index in 0..VIDEO_POSITIONS_LIMIT) memory = rememberPosition(memory, "p/$index", 30.0, 300.0, index.toLong())
        assertEquals(VIDEO_POSITIONS_LIMIT, memory.positions.size)
        assertNull(memory.positions["p/0"])
        assertNotNull(memory.positions["p/$VIDEO_POSITIONS_LIMIT"])
    }

    @Test fun resumeTimeSkipsTheStartAndTheEnd() {
        assertNull(resumeTime(null, 300.0))
        assertNull(resumeTime(3.0, 300.0))
        assertEquals(120.0, resumeTime(120.0, 300.0))
        assertNull(resumeTime(297.0, 300.0))
        assertEquals(120.0, resumeTime(120.0, Double.NaN))
    }

    @Test fun parseClockReadsClockTimesAndHrefsRoundTrip() {
        assertEquals(135, parseClock("2:15"))
        assertEquals(3723, parseClock("1:02:03"))
        assertNull(parseClock("0:61"))
        assertNull(parseClock("1:60:00"))
        assertNull(parseClock("215"))
        assertEquals(135.0, noteTimeFromHref(noteTimeHref(135)))
        assertNull(noteTimeFromHref("#top"))
        assertNull(noteTimeFromHref(null))
    }

    @Test fun linksTimesInTextLeavingCodeLinksUrlsAndNonTimesAlone() {
        assertEquals("The dialog opens at [2:15](#t=135) and closes at [1:02:03](#t=3723).", linkNoteTimes("The dialog opens at 2:15 and closes at 1:02:03."))
        assertEquals("- [0:05](#t=5) login\n- [0:42](#t=42): error", linkNoteTimes("- 0:05 login\n- 0:42: error"))
        assertEquals("`at 2:15` and\n```\n3:00\n```", linkNoteTimes("`at 2:15` and\n```\n3:00\n```"))
        assertEquals("[see 2:15](https://x.test/a) and https://x.test:8080/b?t=1:00", linkNoteTimes("[see 2:15](https://x.test/a) and https://x.test:8080/b?t=1:00"))
        assertEquals("ratio 16:9, version 1.2:30, 12:345, a2:15, 2:15.5", linkNoteTimes("ratio 16:9, version 1.2:30, 12:345, a2:15, 2:15.5"))
        assertEquals("at [0:30](#t=30) and 9:00", linkNoteTimes("at 0:30 and 9:00", 120.0))
    }

    @Test fun noteTimesInPlainTextSkipAddresses() {
        assertEquals(listOf(NoteTime(6, 10, 65)), noteTimes("Go to 1:05, not https://x.test:8080/b?t=1:00"))
    }

    // --- artifacts.test.ts: the lightbox's zoom and Markdown -------------------------------------------------------

    private val viewport = ZoomSize(800f, 600f)
    private val fitted = fittedSize(ZoomSize(1600f, 900f), viewport)

    @Test fun fitsWithoutEnlargingASmallImage() {
        assertEquals(ZoomSize(800f, 450f), fitted)
        assertEquals(ZoomSize(200f, 100f), fittedSize(ZoomSize(200f, 100f), viewport))
        assertEquals(ZoomSize(0f, 0f), fittedSize(ZoomSize(0f, 0f), viewport))
    }

    @Test fun keepsThePointUnderTheFingerInPlaceAndClampsTheEdges() {
        assertEquals(Zoom(2f, -200f, 0f), zoomAround(ZOOM_FIT, 2f, 200f, 0f, fitted, viewport))
        assertEquals(ZOOM_MAX, clampZoom(Zoom(20f, 0f, 0f), fitted, viewport).scale)
        assertEquals(ZOOM_FIT, clampZoom(Zoom(0.2f, 50f, 50f), fitted, viewport))
        assertEquals(Zoom(2f, -400f, 150f), clampZoom(Zoom(2f, -999f, 999f), fitted, viewport))
    }

    @Test fun aDoubleTapZoomsInAndAgainGoesBackToFit() {
        val zoomed = toggleZoom(ZOOM_FIT, 0f, 0f, fitted, viewport)
        assertTrue(zoomed.scale > 1f)
        assertEquals(ZOOM_FIT, toggleZoom(zoomed, 0f, 0f, fitted, viewport))
    }

    @Test fun aSwipeDownAtFitDismissesNotWhenZoomedOrSideways() {
        assertTrue(isDismissSwipe(ZOOM_FIT, 10f, 120f))
        assertFalse(isDismissSwipe(ZOOM_FIT, 120f, 120f))
        assertFalse(isDismissSwipe(Zoom(2f, 0f, 0f), 0f, 200f))
        assertFalse(isDismissSwipe(ZOOM_FIT, 0f, 40f))
    }

    @Test fun knowsMarkdownByItsTypeOrItsName() {
        assertTrue(isMarkdownArtifact("report.md", "text/markdown"))
        assertTrue(isMarkdownArtifact("notes", "text/markdown; charset=utf-8"))
        assertTrue(isMarkdownArtifact("README.MARKDOWN", "application/octet-stream"))
        assertFalse(isMarkdownArtifact("server.log", "text/plain"))
        assertFalse(isMarkdownArtifact("data.json", "application/json"))
    }

    // --- the chat card's inline player -------------------------------------------------------------------------------

    @Test fun theViewerPlaysOnOnlyForTheVideoExpandedWhilePlayingAndOnlyOnce() {
        InlineVideos.expanded("p/a1", playing = true)
        assertFalse(InlineVideos.playsOn("p/a2"))
        InlineVideos.expanded("p/a1", playing = true)
        assertTrue(InlineVideos.playsOn("p/a1"))
        assertFalse(InlineVideos.playsOn("p/a1"))
        InlineVideos.expanded("p/a1", playing = false)
        assertFalse(InlineVideos.playsOn("p/a1"))
    }
}
