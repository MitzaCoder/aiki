package io.github.mitzacoder.kemiri.features.usage

import io.github.mitzacoder.kemiri.features.status.toFixed
import io.github.mitzacoder.kemiri.protocol.*
import kotlin.math.abs
import kotlin.math.roundToLong

/**
 * How the Usage screen talks about the prompt cache statistics a backend answers with `cache.stats`: plain words for the
 * miss reasons, the wakes and the conversations, the money and the what-ifs. A port of the web's `lib/cache-stats.ts`
 * (tests mirror `apps/web/test/cache-stats.test.ts`) plus the protocol's `describePromptChange`.
 */

val CACHE_STATS_RANGES = listOf(7L, 30L, 90L)

/** How long the provider keeps a prompt without the one-hour cache (protocol `PROMPT_CACHE_TTL_MS`). */
const val PROMPT_CACHE_TTL_MS = 5 * 60_000L
private val CACHE_MINUTES = PROMPT_CACHE_TTL_MS / 60_000

private fun grouped(value: Long): String = java.text.NumberFormat.getIntegerInstance(java.util.Locale.US).format(value)

/** Dollars as they read in a sentence: "$0.42", "$12.30", "$284"; "$0" for nothing, "<$0.01" for crumbs. */
fun money(value: Double): String = when {
    value == 0.0 -> "$0"
    abs(value) < 0.01 -> "<$0.01"
    abs(value) >= 100 -> "$" + grouped(value.roundToLong())
    else -> "$" + toFixed(value, 2)
}

/** Tokens as the context panel counts them: "840", "84.2k", "273k" (web `formatTokenCount`). */
fun formatTokenCount(value: Long): String {
    if (value < 1000) return value.toString()
    val thousands = value / 1000.0
    return if (thousands >= 100) "${thousands.roundToLong()}k" else "${trimmed(thousands)}k"
}

private fun trimmed(value: Double): String = toFixed(value, 1).removeSuffix(".0")

fun tokens(value: Long): String = if (value >= 1_000_000) "${trimmed(value / 1_000_000.0)}M" else formatTokenCount(value)

/** A share as a whole percent, "<1%" for a sliver. */
fun percent(part: Double, whole: Double): String {
    if (whole <= 0 || part <= 0) return "0%"
    val value = 100 * part / whole
    return if (value < 1) "<1%" else "${value.roundToLong()}%"
}

/** An idle gap as it reads: 12m, 1h 20m, 3h. */
fun idleTime(ms: Long): String {
    val minutes = (ms / 60_000.0).roundToLong().coerceAtLeast(1)
    if (minutes < 60) return "${minutes}m"
    val rest = minutes % 60
    return if (rest == 0L) "${minutes / 60}h" else "${minutes / 60}h ${rest}m"
}

data class CacheReason(val label: String, val detail: String)

val CACHE_REASONS = mapOf(
    "idle" to CacheReason("Waited too long",
        "Nothing was sent for longer than the cache lasts ($CACHE_MINUTES minutes, or an hour with the longer cache), so the provider dropped its copy of the conversation."),
    "instructions_changed" to CacheReason("Instructions changed", "An AGENTS.md, a skill or the tools changed mid-conversation, so the copy no longer matched."),
    "model_switch" to CacheReason("Model switched", "Each model keeps its own copy, so a new model starts without one."),
    "unexplained" to CacheReason("No visible reason",
        "No wait, switch or change of instructions explains it. What changed in the request says more, when it was recorded."),
)

fun reasonLabel(reason: String): String = CACHE_REASONS[reason]?.label ?: reason

private val WAKES = mapOf(
    "user" to "Your messages",
    "check_in" to "Worker check-ins",
    "worker_report" to "Worker reports",
    "thread_finished" to "Threads finishing",
    "thread_message" to "Messages between threads",
    "board" to "Board changes",
    "brief" to "New workers and threads",
    "schedule" to "Schedules",
    "coordinator" to "Messages to workers",
    "continue" to "Work going on",
    "retry" to "Retries",
    "unknown" to "Unknown",
)

fun wakeLabel(wake: String?): String = if (wake == null) "Unknown" else WAKES[wake] ?: wake

/** What woke the agent, inside a sentence: "a worker check-in". */
fun wakePhrase(wake: String?): String = when (wake) {
    "user" -> "your message"
    "check_in" -> "a worker check-in"
    "worker_report" -> "a worker's report"
    "thread_finished" -> "a thread finishing"
    "thread_message" -> "a message from another thread"
    "board" -> "a board change"
    "brief" -> "its first brief"
    "schedule" -> "a schedule"
    "coordinator" -> "a message from its coordinator"
    "continue" -> "its own tool calls"
    "retry" -> "a retry"
    else -> "something unknown"
}

/** Which conversation: "Main", "Worker qa-4316 · in nightly · T15", "Thread nightly-sync". */
fun conversationLabel(kind: String, threadId: String?, workerId: String?, taskId: String?): String {
    val first = when {
        kind == "thread" && threadId != null -> "Thread $threadId"
        kind == "worker" && workerId != null -> "Worker $workerId"
        else -> when (kind) { "main" -> "Main"; "thread" -> "Thread"; "worker" -> "Worker"; else -> "Other" }
    }
    val parts = mutableListOf(first)
    if (kind == "worker" && threadId != null && threadId != "main") parts += "in $threadId"
    if (taskId != null) parts += taskId
    return parts.joinToString(" · ")
}

fun conversationLabel(miss: CacheMissDetail) = conversationLabel(miss.kind, miss.threadId, miss.workerId, miss.taskId)
fun conversationLabel(row: CacheConversation) = conversationLabel(row.kind, row.threadId, row.workerId, row.taskId)

fun kindGroupLabel(kind: String): String = when (kind) { "main" -> "Main"; "thread" -> "Threads"; "worker" -> "Workers"; else -> "Other" }

/** The miss's headline: "Waited too long (12m)". */
fun missHeadline(miss: CacheMissDetail): String {
    val label = reasonLabel(miss.reason)
    return if (miss.reason == "idle" && miss.idleMs != null) "$label (${idleTime(miss.idleMs)})" else label
}

/** One `describePromptChange` code in words (protocol `cache-stats.ts`). */
fun describePromptChange(code: String): String {
    val colon = code.indexOf(':')
    val kind = if (colon < 0) code else code.substring(0, colon)
    val rest = if (colon < 0) "" else code.substring(colon + 1)
    return when (kind) {
        "restart" -> "The conversation started over (a summary or a reset)"
        "base" -> "The opening instructions changed"
        "section" -> "Instructions “$rest” changed"
        "section+" -> "Instructions “$rest” were added"
        "section-" -> "Instructions “$rest” were removed"
        "tool" -> "Tool $rest changed"
        "tool+" -> "Tool $rest was added"
        "tool-" -> "Tool $rest was removed"
        "tools-order" -> "The tools came in a different order"
        "update" -> if (rest.isEmpty()) "Instructions were updated mid-conversation" else "Instructions “$rest” were updated mid-conversation"
        "history" -> {
            val parts = rest.split('/')
            "Earlier message ${parts.getOrNull(0) ?: "?"} of ${parts.getOrNull(1) ?: "?"} differs"
        }
        "wire" -> "The request sent to the provider differs at $rest"
        else -> code
    }
}

/** What changed in the request, one line each; plain words for a row that has none to show. */
fun changeLines(changes: List<String>?): List<String> = when {
    changes == null -> listOf("Not recorded: this request was read back from the transcript.")
    changes.isEmpty() -> listOf("Nothing in the request changed: the provider dropped its copy early.")
    else -> changes.map(::describePromptChange)
}

data class CacheSummary(val spent: String, val cached: String, val rebilled: String)

/** The three totals under the heading. */
fun summaryLines(stats: CacheStats): CacheSummary {
    val totals = stats.totals
    val prompt = (totals.inputTokens + totals.cacheReadTokens + totals.cacheWriteTokens).toDouble()
    return CacheSummary(
        spent = "${money(totals.cost)} on ${grouped(totals.requests)} request${if (totals.requests == 1L) "" else "s"}",
        cached = "${percent(totals.cacheReadTokens.toDouble(), prompt)} of the prompt read from the cache",
        rebilled = if (totals.misses == 0L) "Nothing billed again"
        else "${money(totals.missedCost)} billed again in ${totals.misses} miss${if (totals.misses == 1L) "" else "es"} (${percent(totals.missedCost, totals.cost)} of the cost)",
    )
}

/**
 * The one-hour cache what-if as a sentence, or null when no request could have used it. Requests that had it already are
 * left out of the what-if and only mentioned, so it never proposes what is on.
 */
fun longCacheLine(stats: CacheStats): String? {
    val long = stats.longCache
    val already = long.alreadyLong ?: 0
    val on = "The one-hour cache was on for $already Claude request${if (already == 1L) "" else "s"}"
    if (long.requests == 0L) return if (already > 0) "$on." else null
    if (long.missesAvoided == 0L && long.extraWriteCost == 0.0) {
        return if (already > 0) "$on; for the rest it would have changed nothing." else "A one-hour cache would have changed nothing here."
    }
    val verdict = if (long.net >= 0) "It would have saved ${money(long.net)} overall." else "It would have cost ${money(-long.net)} more overall."
    val avoided = if (long.missesAvoided == 0L) "would have avoided no miss"
    else "would have avoided ${long.missesAvoided} miss${if (long.missesAvoided == 1L) "" else "es"}, saving ${money(long.saved)}"
    val which = if (already > 0) "for the other ${long.requests} Claude request${if (long.requests == 1L) "" else "s"}" else "(Claude models only)"
    val lead = if (already > 0) "$on. " else ""
    return "${lead}Keeping the cache for an hour instead of $CACHE_MINUTES minutes $which $avoided; writing it costs more, ${money(long.extraWriteCost)} extra. $verdict"
}

/** Wakes the harness itself causes; your messages, briefs and messages to workers are the work itself. */
private val AVOIDABLE_WAKES = setOf("check_in", "worker_report", "board", "thread_finished", "thread_message", "retry")

/** The avoidable wakes worth a sentence: more than one, costing something, dearest first. */
fun wakeAdvice(stats: CacheStats, days: Long): List<String> = stats.byWake
    .filter { it.wake in AVOIDABLE_WAKES && it.wakes > 1 && it.turnCost >= 0.01 }
    .take(3)
    .map { wake ->
        val each = wake.turnCost / wake.wakes
        val cache = if (wake.misses > 0) ", ${money(wake.missedCost / wake.wakes)} of it the cache billed again" else ""
        "${WAKES[wake.wake]}: ${wake.wakes} in $days days, about ${money(each)} each$cache. Half as many would save about ${money(wake.turnCost / 2)}."
    }

data class DayBar(val day: String, val cost: Double, val missedCost: Double, val height: Double, val missedHeight: Double)

/** The bars of the daily chart, scaled to the dearest day. */
fun dayBars(stats: CacheStats): List<DayBar> {
    val highest = (stats.days.maxOfOrNull { it.cost } ?: 0.0).coerceAtLeast(0.0)
    return stats.days.map { day ->
        DayBar(day.day, day.cost, day.missedCost,
            if (highest > 0) day.cost / highest else 0.0,
            if (highest > 0) minOf(day.cost, day.missedCost) / highest else 0.0)
    }
}
