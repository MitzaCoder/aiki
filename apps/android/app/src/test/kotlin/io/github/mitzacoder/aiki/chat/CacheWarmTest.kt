package io.github.mitzacoder.aiki.chat

import io.github.mitzacoder.aiki.features.chat.*
import io.github.mitzacoder.aiki.protocol.CacheWarmStretch
import org.junit.Assert.*
import org.junit.Test

class CacheWarmTest {
    private val stretch = CacheWarmStretch(id = "s", anchorEntryId = 2, startedAt = 100.0, lastAt = 200.0, attempts = 1, refreshes = 1, cachedTokens = 100.0, cost = .04)
    @Test fun deduplicatesLiveAndPagedVersions() {
        val grouped = cacheWarmByAnchor(listOf(stretch, stretch.copy(lastAt = 300.0, attempts = 3, refreshes = 3)), setOf(2))
        assertEquals(1, grouped[2]?.size); assertEquals(3L, grouped[2]?.first()?.refreshes)
    }
    @Test fun noAttemptOrUnloadedAnchorHasNoLine() {
        assertTrue(cacheWarmByAnchor(listOf(stretch.copy(attempts = 0)), setOf(2)).isEmpty())
        assertTrue(cacheWarmByAnchor(listOf(stretch), setOf(3)).isEmpty())
        assertEquals(1, cacheWarmByAnchor(listOf(stretch), setOf(2,3)).size)
    }
    @Test fun stretchesAtSameAnchorStaySeparateAndOrdered() {
        val grouped = cacheWarmByAnchor(listOf(stretch.copy(id = "later", startedAt = 150.0), stretch), setOf(2))
        assertEquals(listOf("s", "later"), grouped[2]?.map { it.id })
    }
    @Test fun coldAttemptHasHonestLabelAndStopDetail() {
        val cold = stretch.copy(refreshes = 0, stopped = "Cache refresh stopped: no cache read")
        assertTrue(cacheWarmLabel(cold).startsWith("Cache refresh stopped")); assertTrue(cacheWarmDetail(cold).contains(cold.stopped!!))
        assertEquals("Cache kept warm · 3 refreshes · ~$0.04", cacheWarmLabel(stretch.copy(refreshes = 3)))
    }
}
