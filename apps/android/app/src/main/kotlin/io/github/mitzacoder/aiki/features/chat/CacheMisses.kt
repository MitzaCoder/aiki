package io.github.mitzacoder.aiki.features.chat

import kotlinx.serialization.json.*
import java.util.Locale
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt
import kotlin.math.roundToLong

/*
 * Prompt cache misses: when a request re-sent the conversation at the full input price instead of reading it from the
 * provider's cache. Ported from `packages/protocol/src/cache-misses.ts` (the server counts them with the same rules)
 * and the transcript's wording from `apps/web/src/lib/chat/cache.ts`, with their tests (CacheMissesTest); change them
 * together.
 */

/** How long a provider keeps a prompt cached after its last use: Anthropic's default, and pi-ai's "short" retention. */
const val PROMPT_CACHE_TTL_MS = 5 * 60 * 1000L
/** How long Anthropic keeps a prompt written to its one-hour cache: pi-ai's "long" retention. */
const val LONG_PROMPT_CACHE_TTL_MS = 60 * 60 * 1000L
/** Misses up to this many tokens are noise from where the provider places its cache breakpoints. */
const val CACHE_MISS_NOISE_FLOOR_TOKENS = 1024.0
/** A miss worth a line in the transcript: at least this many tokens, or this many dollars. */
const val NOTABLE_CACHE_MISS_TOKENS = 20_000.0
const val NOTABLE_CACHE_MISS_COST = 0.1

/** `model_switch`, `instructions_changed`, `idle` or `unexplained`. */
data class CacheMiss(val missedTokens: Double, val missedCost: Double, val idleMs: Long, val cacheTtlMs: Long, val reason: String)

fun isNotableCacheMiss(miss: CacheMiss): Boolean = miss.missedTokens >= NOTABLE_CACHE_MISS_TOKENS || miss.missedCost >= NOTABLE_CACHE_MISS_COST

/** What a tracker keeps of the previous request. */
data class PreviousRequest(val promptTokens: Double, val modelKey: String, val timestamp: Long, val reportedCache: Boolean, val cacheTtlMs: Long? = null)

private data class CacheUsage(val input: Double, val cacheRead: Double, val cacheWrite: Double, val cacheWrite1h: Double, val costInput: Double, val costCacheRead: Double, val costCacheWrite: Double)
private data class UsageMessage(val provider: String, val model: String, val timestamp: Long, val usage: CacheUsage)

private fun JsonObject.number(key: String): Double = (get(key) as? JsonPrimitive)?.takeUnless { it.isString }?.doubleOrNull?.takeIf { it.isFinite() } ?: 0.0
private fun JsonObject.text(key: String): String = (get(key) as? JsonPrimitive)?.takeIf { it.isString }?.content.orEmpty()

private fun usageMessage(value: JsonElement?): UsageMessage? {
    val message = value as? JsonObject ?: return null
    if (message.text("role") != "assistant") return null
    val usage = message["usage"] as? JsonObject ?: return null
    val cost = usage["cost"] as? JsonObject ?: JsonObject(emptyMap())
    return UsageMessage(message.text("provider"), message.text("model"), message.number("timestamp").toLong(),
        CacheUsage(usage.number("input"), usage.number("cacheRead"), usage.number("cacheWrite"), usage.number("cacheWrite1h"),
            cost.number("input"), cost.number("cacheRead"), cost.number("cacheWrite")))
}

/**
 * Follows one conversation's requests in order. Feed it every entry ([observeEntry]) or every assistant message
 * ([observe]) oldest first; each returns the miss the request paid for, if any.
 */
class CacheMissTracker(private val ttlMs: Long = PROMPT_CACHE_TTL_MS, private val cacheReadPerToken: ((String, String) -> Double?)? = null) {
    private val readRates = mutableMapOf<String, Double>()
    var previous: PreviousRequest? = null
        private set
    private var instructionsChanged = false
    private var lastCacheTouch: Long? = null
    fun touch(at: Long) { lastCacheTouch = max(lastCacheTouch ?: 0L, at) }

    fun seed(previous: PreviousRequest) { this.previous = previous; instructionsChanged = false }
    fun instructionsChanged() { instructionsChanged = true }
    fun reset() { previous = null; lastCacheTouch = null; instructionsChanged = false }

    fun observeEntry(kind: String, model: List<JsonElement>?): List<CacheMiss> = when (kind) {
        "pi.compaction", "pi.reset" -> { reset(); emptyList() }
        "pi.system" -> { instructionsChanged(); emptyList() }
        "pi.assistant" -> model.orEmpty().mapNotNull(::observe)
        else -> emptyList()
    }

    fun observe(value: JsonElement?): CacheMiss? {
        val message = usageMessage(value) ?: return null
        val usage = message.usage
        val modelKey = "${message.provider}/${message.model}"
        if (usage.cacheRead > 0) readRates[modelKey] = usage.costCacheRead / usage.cacheRead
        val miss = detect(message, modelKey)
        val promptTokens = usage.input + usage.cacheRead + usage.cacheWrite
        // A request with no prompt usage (a failed one) leaves the previous request in place.
        if (promptTokens > 0) {
            previous = PreviousRequest(promptTokens, modelKey, message.timestamp,
                (previous?.reportedCache ?: false) || usage.cacheRead + usage.cacheWrite > 0, lifetime(usage))
            instructionsChanged = false
        }
        return miss
    }

    private fun lifetime(usage: CacheUsage): Long = when {
        usage.cacheWrite1h > 0 -> LONG_PROMPT_CACHE_TTL_MS
        usage.cacheWrite > 0 -> ttlMs
        else -> previous?.cacheTtlMs ?: ttlMs
    }

    private fun detect(message: UsageMessage, modelKey: String): CacheMiss? {
        val previous = previous ?: return null
        val usage = message.usage
        val promptTokens = usage.input + usage.cacheRead + usage.cacheWrite
        if (promptTokens <= 0) return null
        if (usage.cacheRead + usage.cacheWrite == 0.0 && !previous.reportedCache) return null
        val missedTokens = min(previous.promptTokens, promptTokens) - usage.cacheRead
        if (missedTokens <= CACHE_MISS_NOISE_FLOOR_TOKENS) return null
        val paidTokens = usage.input + usage.cacheWrite
        val paidPerToken = if (paidTokens > 0) (usage.costInput + usage.costCacheWrite) / paidTokens else 0.0
        val readPerToken = if (usage.cacheRead > 0) usage.costCacheRead / usage.cacheRead
            else readRates[modelKey] ?: cacheReadPerToken?.invoke(message.provider, message.model) ?: 0.0
        val idleMs = max(0L, message.timestamp - max(previous.timestamp, lastCacheTouch ?: 0L))
        val cacheTtlMs = previous.cacheTtlMs ?: ttlMs
        val reason = when {
            modelKey != previous.modelKey -> "model_switch"
            instructionsChanged -> "instructions_changed"
            idleMs >= cacheTtlMs -> "idle"
            else -> "unexplained"
        }
        return CacheMiss(missedTokens, missedTokens * max(0.0, paidPerToken - readPerToken), idleMs, cacheTtlMs, reason)
    }
}

// --- wording (apps/web/src/lib/chat/cache.ts) ------------------------------------------------------------------------

private fun aboutCost(cost: Double): String = if (cost >= 0.01) " (~$${String.format(Locale.US, "%.2f", cost)})" else ""

/** An idle gap as it reads: 12m, 1h 20m, 3h. */
fun idleTime(ms: Long): String {
    val minutes = max(1L, (ms / 60_000.0).roundToLong())
    if (minutes < 60) return "${minutes}m"
    val hours = minutes / 60
    val rest = minutes % 60
    return if (rest == 0L) "${hours}h" else "${hours}h ${rest}m"
}

/** How long a cache lasts, in a sentence: "5 minutes", "an hour". */
fun cacheLifetime(ms: Long): String {
    val minutes = (ms / 60_000.0).roundToLong()
    if (minutes == 60L) return "an hour"
    return if (minutes % 60 == 0L) "${minutes / 60} hours" else "$minutes minute${if (minutes == 1L) "" else "s"}"
}

/** Token counts the way the web's `formatTokenCount` writes them: 950, 84.2k, 312k. */
fun formatTokenCount(tokens: Double): String {
    if (tokens < 1000) return tokens.roundToLong().toString()
    val thousands = tokens / 1000
    return (if (thousands >= 100) thousands.roundToLong().toString() else String.format(Locale.US, "%.1f", thousands).removeSuffix(".0")) + "k"
}

private fun grouped(value: Double): String = String.format(Locale.US, "%,d", value.roundToLong())

/** The line under a reply: "Cache miss after 12m idle: 84k tokens re-billed (~$0.42)". */
fun cacheMissLine(miss: CacheMiss): String {
    val cause = when (miss.reason) {
        "model_switch" -> " after switching models"
        "instructions_changed" -> " after the instructions changed"
        "idle" -> " after ${idleTime(miss.idleMs)} idle"
        else -> ""
    }
    return "Cache miss$cause: ${formatTokenCount(miss.missedTokens)} tokens re-billed${aboutCost(miss.missedCost)}"
}

/** What the line opens to: what happened, in full numbers, and why. */
fun cacheMissDetail(miss: CacheMiss): String {
    val cost = if (miss.missedCost >= 0.01) ", about $${String.format(Locale.US, "%.2f", miss.missedCost)} more than reading them from it" else ""
    val what = "${grouped(miss.missedTokens)} tokens the provider had cached were billed again at the full price$cost."
    val why = when {
        miss.reason == "model_switch" -> "Each model has its own cache, so a different model starts without one."
        miss.reason == "instructions_changed" -> "The instructions at the start of the prompt changed (an edited AGENTS.md, a new skill)."
        miss.reason == "idle" -> "The cache lasts about ${cacheLifetime(miss.cacheTtlMs)}; the conversation was idle for ${idleTime(miss.idleMs)}."
        miss.idleMs >= 60_000 -> "It came ${idleTime(miss.idleMs)} after the previous request, while the cache should still have had it (it lasts about ${cacheLifetime(miss.cacheTtlMs)}), and no model switch or change of instructions explains it: the start of the prompt changed between two requests, which shouldn't happen, or the provider dropped its copy early."
        else -> "No idle gap, model switch or change of instructions explains it: the start of the prompt changed between two requests, which shouldn't happen."
    }
    return "$what $why"
}

/** What a turn's requests sent and got back, summed; [input] is the part of the prompt the cache did not cover. */
data class TurnUsage(val input: Double = 0.0, val output: Double = 0.0, val cacheRead: Double = 0.0, val cacheWrite: Double = 0.0, val cost: Double = 0.0)

/** Every count of a reply in full, for the opened footer. */
fun turnUsageTitle(usage: TurnUsage): String {
    val lines = buildList {
        add("${grouped(usage.input)} new input tokens")
        if (usage.cacheRead > 0) add("${grouped(usage.cacheRead)} read from the cache")
        if (usage.cacheWrite > 0) add("${grouped(usage.cacheWrite)} written to the cache")
        add("${grouped(usage.output)} output tokens")
        val prompt = usage.input + usage.cacheRead + usage.cacheWrite
        if (usage.cacheRead > 0 && prompt > 0) add("${(usage.cacheRead / prompt * 100).roundToInt()}% of the prompt came from the cache")
    }
    return lines.joinToString("\n")
}

/** A short count: 950, 1.2K, 84K, 1.5M (the web's compact `Intl.NumberFormat`). */
fun compactNumber(value: Double): String {
    fun trimmed(number: Double) = String.format(Locale.US, "%.1f", number).removeSuffix(".0")
    return when {
        value >= 1_000_000_000 -> "${trimmed(value / 1_000_000_000)}B"
        value >= 1_000_000 -> "${trimmed(value / 1_000_000)}M"
        value >= 1_000 -> "${trimmed(value / 1_000)}K"
        else -> trimmed(value)
    }
}

/** A short duration: 8s, 1m 20s. */
fun shortDuration(ms: Long): String {
    val seconds = max(0L, (ms / 1000.0).roundToLong())
    if (seconds < 60) return "${seconds}s"
    val minutes = seconds / 60
    val rest = seconds % 60
    return if (rest == 0L) "${minutes}m" else "${minutes}m ${rest}s"
}

/** A reply's cost: four places below a cent, else two. */
fun turnCost(cost: Double): String = "$" + String.format(Locale.US, if (cost < 0.01) "%.4f" else "%.2f", cost)
