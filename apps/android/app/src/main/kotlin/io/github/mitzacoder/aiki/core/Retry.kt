package io.github.mitzacoder.aiki.core

import kotlin.math.pow
import kotlin.math.roundToLong

/** Matches packages/client: 250ms, factor 2, cap 8s, +/-20% jitter. */
fun reconnectDelay(attempt: Int, random: Double = Math.random()): Long {
    val base = minOf(8000.0, 250.0 * 2.0.pow(attempt.coerceAtLeast(0).coerceAtMost(30)))
    return (base * (0.8 + random.coerceIn(0.0, 1.0) * 0.4)).roundToLong()
}
fun isPermanentWatchError(code: String?) = code in setOf(
    "unknown_project", "unknown_worker", "unknown_thread", "bad_request",
    "unsupported_protocol", "unknown_model", "unknown_provider"
)
