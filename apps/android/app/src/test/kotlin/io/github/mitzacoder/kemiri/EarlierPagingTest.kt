package io.github.mitzacoder.kemiri

import io.github.mitzacoder.kemiri.features.chat.shouldPrefetchEarlier
import org.junit.Assert.*
import org.junit.Test

class EarlierPagingTest {
    private fun prefetch(index: Int = 0, ready: Boolean = true, more: Boolean = true, loading: Boolean = false,
        failed: Boolean = false, follow: Boolean = false, canScroll: Boolean = true, highlight: Boolean = false) =
        shouldPrefetchEarlier(index,ready,more,loading,failed,follow,canScroll,highlight)

    @Test fun startsAFewRowsBeforeTheBoundary() {
        assertTrue(prefetch(index = 6))
        assertFalse(prefetch(index = 7))
    }
    @Test fun fillsShortViewportWithoutLeavingTailFollow() {
        assertTrue(prefetch(follow = true,canScroll = false))
        assertFalse(prefetch(follow = true,canScroll = true))
    }
    @Test fun waitsForLayoutAndDoesNotCompeteWithHighlights() {
        assertFalse(prefetch(ready = false))
        assertFalse(prefetch(highlight = true))
    }
    @Test fun stopsForLoadingExhaustionAndErrors() {
        assertFalse(prefetch(loading = true))
        assertFalse(prefetch(more = false))
        assertFalse(prefetch(failed = true))
        assertTrue(prefetch())
    }
}
