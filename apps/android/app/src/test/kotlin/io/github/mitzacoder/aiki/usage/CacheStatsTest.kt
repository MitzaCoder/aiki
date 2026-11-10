package io.github.mitzacoder.aiki.usage

import io.github.mitzacoder.aiki.features.usage.*
import io.github.mitzacoder.aiki.protocol.*
import org.junit.Assert.*
import org.junit.Test

/** Mirrors apps/web/test/cache-stats.test.ts: the Usage screen's prompt cache wording. */
class CacheStatsTest {
    private val totals = CacheTotals(requests = 5396, inputTokens = 20_000_000, cacheReadTokens = 620_000_000, cacheWriteTokens = 8_500_000,
        outputTokens = 2_000_000, cost = 284.4, misses = 91, missedTokens = 14_900_000, missedCost = 69.41)
    private val longCache = LongCacheWhatIf(requests = 1238, missesAvoided = 61, saved = 55.57, extraWriteCost = 10.77, net = 44.8, stillMissed = 2)

    private fun stats(totals: CacheTotals = this.totals, longCache: LongCacheWhatIf = this.longCache) = CacheStats(
        from = "2026-11-01T00:00:00.000Z", to = "2026-11-06T00:00:00.000Z", keptDays = 90, liveSince = null, totals = totals,
        byReason = emptyList(), byProject = emptyList(), byKind = emptyList(), byModel = emptyList(),
        byWake = listOf(
            CacheWake(wake = "check_in", wakes = 98, turnCost = 35.52, misses = 36, missedCost = 29.96),
            CacheWake(wake = "user", wakes = 71, turnCost = 43.52, misses = 18, missedCost = 12.77),
            CacheWake(wake = "worker_report", wakes = 166, turnCost = 28.77, misses = 7, missedCost = 6.83),
        ),
        days = listOf(
            CacheDay(day = "2026-11-05", requests = 3, cost = 2.0, misses = 1, missedCost = 0.5),
            CacheDay(day = "2026-11-06", requests = 1, cost = 4.0, misses = 0, missedCost = 0.0),
        ),
        conversations = emptyList(), misses = emptyList(), longCache = longCache,
    )

    private val miss = CacheMissDetail(at = "2026-11-06T12:27:00.000Z", projectId = "p", projectName = "Project", conversationId = 1, kind = "worker",
        threadId = "nightly", workerId = "qa-4316", taskId = "T15", provider = "anthropic", model = "claude-opus-5-5", idleMs = 10 * 60_000,
        missedTokens = 273_000, missedCost = 1.31, reason = "idle", wake = "check_in", changes = emptyList(), source = "live")

    private val none = LongCacheWhatIf(requests = 0, missesAvoided = 0, saved = 0.0, extraWriteCost = 0.0, net = 0.0, stillMissed = 0)

    @Test fun readsMoneyTokensAndSharesTheWayASentenceDoes() {
        assertEquals("$0", money(0.0))
        assertEquals("<$0.01", money(0.004))
        assertEquals("$1.31", money(1.314))
        assertEquals("$284", money(284.4))
        assertEquals("14.9M", tokens(14_900_000))
        assertEquals("273k", tokens(273_000))
        assertEquals("<1%", percent(1.0, 300.0))
        assertEquals("0%", percent(0.0, 0.0))
    }

    @Test fun sumsUpSpendReuseAndWhatWasBilledAgain() {
        assertEquals(CacheSummary("$284 on 5,396 requests", "96% of the prompt read from the cache", "$69.41 billed again in 91 misses (24% of the cost)"), summaryLines(stats()))
        assertEquals("Nothing billed again", summaryLines(stats(totals.copy(misses = 0))).rebilled)
    }

    @Test fun namesTheConversationAndTheMiss() {
        assertEquals("Worker qa-4316 · in nightly · T15", conversationLabel(miss))
        assertEquals("Main", conversationLabel("main", "main", null, null))
        assertEquals("Waited too long (10m)", missHeadline(miss))
        assertEquals("No visible reason", missHeadline(miss.copy(reason = "unexplained")))
        assertEquals("a worker check-in", wakePhrase("check_in"))
    }

    @Test fun saysWhatChangedOrWhyItCannot() {
        assertEquals(listOf("Not recorded: this request was read back from the transcript."), changeLines(null))
        assertEquals(listOf("Nothing in the request changed: the provider dropped its copy early."), changeLines(emptyList()))
        assertEquals(listOf("Instructions “context” changed", "Tool write was added"), changeLines(listOf("section:context", "tool+:write")))
    }

    @Test fun putsTheWhatIfsInSentences() {
        assertEquals(
            "Keeping the cache for an hour instead of 5 minutes (Claude models only) would have avoided 61 misses, saving $55.57; writing it costs more, $10.77 extra. It would have saved $44.80 overall.",
            longCacheLine(stats()),
        )
        assertNull(longCacheLine(stats(longCache = none)))
        // What is on already is said, not proposed; the what-if covers the rest.
        assertEquals("The one-hour cache was on for 640 Claude requests.", longCacheLine(stats(longCache = none.copy(alreadyLong = 640))))
        assertEquals(
            "The one-hour cache was on for 640 Claude requests. Keeping the cache for an hour instead of 5 minutes for the other 577 Claude requests would have avoided 4 misses, saving $3.95; writing it costs more, $2.55 extra. It would have saved $1.40 overall.",
            longCacheLine(stats(longCache = LongCacheWhatIf(requests = 577, missesAvoided = 4, saved = 3.95, extraWriteCost = 2.55, net = 1.4, stillMissed = 0, alreadyLong = 640))),
        )
        // Only wakes the harness causes are advice material, dearest first; the user's own messages are the work.
        assertEquals(
            listOf(
                "Worker check-ins: 98 in 30 days, about $0.36 each, $0.31 of it the cache billed again. Half as many would save about $17.76.",
                "Worker reports: 166 in 30 days, about $0.17 each, $0.04 of it the cache billed again. Half as many would save about $14.38.",
            ),
            wakeAdvice(stats(), 30),
        )
    }

    @Test fun scalesTheDailyBarsToTheDearestDay() {
        assertEquals(
            listOf(DayBar("2026-11-05", 2.0, 0.5, 0.5, 0.125), DayBar("2026-11-06", 4.0, 0.0, 1.0, 0.0)),
            dayBars(stats()),
        )
    }

    @Test fun idleGapsAndPromptChangesReadInWords() {
        assertEquals("1m", idleTime(20_000))
        assertEquals("12m", idleTime(12 * 60_000))
        assertEquals("1h", idleTime(60 * 60_000))
        assertEquals("1h 35m", idleTime(95 * 60_000))
        assertEquals("Earlier message 3 of 9 differs", describePromptChange("history:3/9"))
        assertEquals("Instructions were updated mid-conversation", describePromptChange("update"))
        assertEquals("mystery:code", describePromptChange("mystery:code"))
    }
}
