package io.github.mitzacoder.kemiri.chat

import io.github.mitzacoder.kemiri.features.chat.*
import io.github.mitzacoder.kemiri.protocol.EntryRecord
import kotlinx.serialization.json.*
import org.junit.Assert.*
import org.junit.Test

/** Mirrors packages/protocol/test/cache-misses.test.ts and apps/web/test/cache.test.ts for CacheMisses.kt. */
class CacheMissesTest {
    private val minute = 60_000L
    private val inputPrice = 3e-6
    private val writePrice = 3.75e-6
    private val readPrice = 0.3e-6

    private fun reply(at: Long, input: Int, cacheRead: Int, cacheWrite: Int, cacheWrite1h: Int = 0, model: String = "claude-sonnet-5", provider: String = "anthropic", text: String? = null) = buildJsonObject {
        put("role", "assistant"); put("provider", provider); put("model", model); put("timestamp", at)
        putJsonArray("content") { if (text != null) addJsonObject { put("type", "text"); put("text", text) } }
        putJsonObject("usage") {
            put("input", input); put("cacheRead", cacheRead); put("cacheWrite", cacheWrite); put("cacheWrite1h", cacheWrite1h); put("output", if (text == null) 100 else 50)
            putJsonObject("cost") {
                put("input", input * inputPrice); put("cacheRead", cacheRead * readPrice); put("cacheWrite", cacheWrite * writePrice); put("output", 0)
                put("total", if (text == null) 0.0 else input * inputPrice + cacheRead * readPrice + cacheWrite * writePrice)
            }
        }
    }

    @Test fun countsNothingOnTheFirstRequestOrOnHits() {
        val tracker = CacheMissTracker()
        assertNull(tracker.observe(reply(0, 10, 0, 50_000)))
        assertNull(tracker.observe(reply(minute, 10, 50_000, 2_000)))
    }

    @Test fun measuresAMissAgainstTheSmallerPromptAndPricesItAtThePaidRateMinusTheReadRate() {
        val tracker = CacheMissTracker()
        tracker.observe(reply(0, 10, 40_000, 10_000))
        val miss = tracker.observe(reply(12 * minute, 10, 0, 52_000))!!
        assertEquals(50_010.0, miss.missedTokens, 0.0)
        assertEquals("idle", miss.reason)
        assertEquals(12 * minute, miss.idleMs)
        val paid = (10 * inputPrice + 52_000 * writePrice) / 52_010
        assertEquals(50_010 * (paid - readPrice), miss.missedCost, 1e-8)
        assertTrue(isNotableCacheMiss(miss))
    }

    @Test fun namesAModelSwitchBeforeAnIdleGapAndCallsTheRestUnexplained() {
        val tracker = CacheMissTracker()
        tracker.observe(reply(0, 10, 30_000, 0))
        assertEquals("model_switch", tracker.observe(reply(20 * minute, 10, 0, 30_000, model = "claude-opus-5-5"))?.reason)
        assertEquals("unexplained", tracker.observe(reply(20 * minute + 5_000, 10, 2_000, 28_500, model = "claude-opus-5-5"))?.reason)
    }

    @Test fun namesChangedInstructionsWhenASystemEntryCameSinceThePreviousRequest() {
        val tracker = CacheMissTracker()
        tracker.observeEntry("pi.assistant", listOf(reply(0, 10, 30_000, 0)))
        tracker.observeEntry("pi.system", emptyList())
        assertEquals("instructions_changed", tracker.observeEntry("pi.assistant", listOf(reply(20 * minute, 10, 0, 30_500))).single().reason)
        assertEquals("unexplained", tracker.observeEntry("pi.assistant", listOf(reply(20 * minute + 1_000, 10, 0, 30_600))).single().reason)
    }

    @Test fun ignoresMissesAtTheNoiseFloor() {
        val tracker = CacheMissTracker()
        tracker.observe(reply(0, 10, 30_000, 0))
        assertNull(tracker.observe(reply(1_000, 10, 28_986, 1_100)))
    }

    @Test fun startsOverAfterACompactionOrAResetEntry() {
        val tracker = CacheMissTracker()
        tracker.observeEntry("pi.assistant", listOf(reply(0, 10, 80_000, 0)))
        assertEquals(emptyList<CacheMiss>(), tracker.observeEntry("pi.compaction", listOf(buildJsonObject { put("role", "user"); put("content", "summary") })))
        assertEquals(emptyList<CacheMiss>(), tracker.observeEntry("pi.assistant", listOf(reply(1_000, 10, 0, 8_000))))
        tracker.observeEntry("pi.reset", null)
        assertEquals(emptyList<CacheMiss>(), tracker.observeEntry("pi.assistant", listOf(reply(2_000, 9_000, 0, 0))))
    }

    @Test fun saysNothingForAProviderThatNeverReportsCacheUse() {
        val tracker = CacheMissTracker()
        tracker.observe(reply(0, 30_000, 0, 0))
        assertNull(tracker.observe(reply(1_000, 31_000, 0, 0)))
    }

    @Test fun countsARequestThatUsedNoCacheOnceAnEarlierOneDid() {
        val tracker = CacheMissTracker(cacheReadPerToken = { _, _ -> readPrice })
        tracker.observe(reply(0, 10, 0, 30_000))
        val miss = tracker.observe(reply(1_000, 31_000, 0, 0))!!
        assertEquals(30_010.0, miss.missedTokens, 0.0)
        assertEquals("unexplained", miss.reason)
        assertEquals(30_010 * (inputPrice - readPrice), miss.missedCost, 1e-8)
    }

    @Test fun keepsThePreviousRequestAcrossAFailedOneWithNoUsage() {
        val tracker = CacheMissTracker()
        tracker.observe(reply(0, 10, 30_000, 0))
        assertNull(tracker.observe(reply(1_000, 0, 0, 0)))
        assertEquals(30_010.0, tracker.observe(reply(2_000, 10, 0, 30_000))!!.missedTokens, 0.0)
    }

    @Test fun skipsAnythingThatIsNotAnAssistantMessageWithUsage() {
        val tracker = CacheMissTracker()
        assertNull(tracker.observe(buildJsonObject { put("role", "user"); put("content", "hi") }))
        assertNull(tracker.observe(JsonNull))
        assertNull(tracker.observe(buildJsonObject { put("role", "assistant"); putJsonArray("content") {} }))
    }

    private fun hour(at: Long, input: Int, cacheRead: Int, cacheWrite: Int) = reply(at, input, cacheRead, cacheWrite, cacheWrite1h = cacheWrite)

    @Test fun doesNotCallAGapShorterThanAnHourIdleAfterAOneHourWrite() {
        val tracker = CacheMissTracker()
        tracker.observe(hour(0, 10, 0, 50_000))
        assertNull(tracker.observe(hour(20 * minute, 10, 50_000, 200)))
        val miss = tracker.observe(hour(40 * minute, 10, 0, 50_300))!!
        assertEquals("unexplained", miss.reason)
        assertEquals(20 * minute, miss.idleMs)
        assertEquals(LONG_PROMPT_CACHE_TTL_MS, miss.cacheTtlMs)
        assertEquals("idle", tracker.observe(hour(110 * minute, 10, 0, 50_400))?.reason)
    }

    @Test fun keepsThePreviousLifetimeOverARequestThatWroteNothingAndDropsItAfterAShortWrite() {
        val tracker = CacheMissTracker()
        tracker.observe(hour(0, 10, 0, 50_000))
        tracker.observe(reply(minute, 10, 50_000, 0))
        assertEquals(LONG_PROMPT_CACHE_TTL_MS, tracker.previous?.cacheTtlMs)
        assertEquals("unexplained", tracker.observe(reply(15 * minute, 10, 0, 50_100))?.reason)
        val miss = tracker.observe(reply(25 * minute, 10, 0, 50_200))!!
        assertEquals("idle", miss.reason)
        assertEquals(PROMPT_CACHE_TTL_MS, miss.cacheTtlMs)
    }

    @Test fun goesOnFromASeededPreviousRequest() {
        val tracker = CacheMissTracker()
        tracker.seed(PreviousRequest(50_010.0, "anthropic/claude-sonnet-5", 0, true, LONG_PROMPT_CACHE_TTL_MS))
        assertEquals("unexplained", tracker.observe(reply(30 * minute, 10, 0, 50_100))?.reason)
        val first = CacheMissTracker()
        first.observe(reply(0, 10, 0, 50_000))
        assertEquals(PreviousRequest(50_010.0, "anthropic/claude-sonnet-5", 0, true, PROMPT_CACHE_TTL_MS), first.previous)
        val next = CacheMissTracker()
        next.seed(first.previous!!)
        assertEquals("idle", next.observe(reply(10 * minute, 10, 0, 50_100))?.reason)
        val told = CacheMissTracker()
        told.observe(reply(0, 10, 0, 50_000))
        told.instructionsChanged()
        assertEquals("instructions_changed", told.observe(reply(minute, 10, 0, 50_100))?.reason)
    }

    // --- apps/web/test/cache.test.ts ---------------------------------------------------------------------------------

    private fun user(id: Long, at: Long) = EntryRecord(id, 1, "pi.user", listOf(buildJsonObject { put("role", "user"); put("content", "Go on."); put("timestamp", at) }))
    private fun answer(id: Long, at: Long, input: Int, cacheRead: Int, cacheWrite: Int) = EntryRecord(id, 1, "pi.assistant", listOf(reply(at, input, cacheRead, cacheWrite, text = "Done.")))

    @Test fun aTurnAfterALongIdleGapCarriesItsMissAndAHitOrASmallMissNone() {
        val rows = transcript(listOf(
            user(1, 0), answer(2, 1_000, 10, 0, 80_000),
            user(3, 2 * minute), answer(4, 2 * minute, 10, 80_000, 300),
            user(5, 3 * minute), answer(6, 3 * minute, 10, 75_000, 5_400),
            user(7, 20 * minute), answer(8, 20 * minute, 10, 0, 80_500),
        ), null)
        val turns = rows.mapNotNull { it.turn }
        assertEquals(listOf(0, 0, 0, 1), turns.map { it.cacheMisses.size })
        val miss = turns[3].cacheMisses.single()
        assertEquals("idle", miss.reason)
        assertEquals(80_410.0, miss.missedTokens, 0.0)
        assertEquals(TurnUsage(input = 10.0, output = 50.0, cacheRead = 80_000.0, cacheWrite = 300.0, cost = 10 * inputPrice + 80_000 * readPrice + 300 * writePrice).copy(cost = 0.0), turns[1].usage?.copy(cost = 0.0))
        assertEquals("claude-sonnet-5", turns[1].model)
        assertEquals("Done.", turns[1].text)
    }

    @Test fun aCompactionStartsOverSoTheFirstReplyAfterItHasNothingToMiss() {
        val rows = transcript(listOf(
            answer(1, 0, 10, 0, 80_000),
            EntryRecord(2, 1, "pi.compaction", listOf(buildJsonObject { put("role", "user"); put("content", "Summary."); put("timestamp", 1) })),
            answer(3, 1_000, 10, 0, 9_000),
        ), null)
        assertTrue(rows.mapNotNull { it.turn }.all { it.cacheMisses.isEmpty() })
    }

    private fun miss(reason: String, idleMs: Long = 30_000, cacheTtlMs: Long = 5 * minute) = CacheMiss(84_213.0, 0.4212, idleMs, cacheTtlMs, reason)

    @Test fun linesNameTheCause() {
        assertEquals("Cache miss after 12m idle: 84.2k tokens re-billed (~$0.42)", cacheMissLine(miss("idle", 12 * minute)))
        assertEquals("Cache miss after switching models: 84.2k tokens re-billed (~$0.42)", cacheMissLine(miss("model_switch")))
        assertTrue(cacheMissLine(miss("instructions_changed")).contains("after the instructions changed"))
        assertEquals("Cache miss: 84.2k tokens re-billed", cacheMissLine(miss("unexplained").copy(missedCost = 0.004)))
        assertTrue(cacheMissDetail(miss("unexplained")).contains("shouldn't happen"))
        assertTrue(cacheMissDetail(miss("idle", 12 * minute)).contains("idle for 12m"))
    }

    @Test fun detailsSayHowLongTheCacheLasted() {
        assertTrue(cacheMissDetail(miss("idle", 12 * minute)).contains("The cache lasts about 5 minutes;"))
        assertTrue(cacheMissDetail(miss("idle", 75 * minute, 60 * minute)).contains("The cache lasts about an hour; the conversation was idle for 1h 15m."))
        assertTrue(cacheMissDetail(miss("unexplained", 20 * minute, 60 * minute)).contains("It came 20m after the previous request, while the cache should still have had it (it lasts about an hour)"))
        assertTrue(cacheMissDetail(miss("idle")).startsWith("84,213 tokens the provider had cached were billed again at the full price, about $0.42 more"))
    }

    @Test fun idleTimesReadInMinutesThenHours() {
        assertEquals("1m", idleTime(20_000))
        assertEquals("12m", idleTime(12 * minute))
        assertEquals("1h", idleTime(60 * minute))
        assertEquals("1h 35m", idleTime(95 * minute))
    }

    @Test fun theFooterSpellsOutTheCache() {
        val title = turnUsageTitle(TurnUsage(input = 1_200.0, output = 300.0, cacheRead = 84_000.0, cacheWrite = 2_000.0, cost = 0.1))
        assertTrue(title.contains("84,000 read from the cache"))
        assertTrue(title.contains("2,000 written to the cache"))
        assertTrue(title.contains("96% of the prompt came from the cache"))
        assertEquals("84K", compactNumber(84_000.0))
        assertEquals("1.2K", compactNumber(1_200.0))
        assertEquals("300", compactNumber(300.0))
        assertEquals("$0.0042", turnCost(0.0042))
        assertEquals("$0.42", turnCost(0.4212))
        assertEquals("1m 20s", shortDuration(80_000))
        assertEquals("312k", formatTokenCount(312_400.0))
    }
}
