package io.github.mitzacoder.kemiri.features.usage

import io.github.mitzacoder.kemiri.protocol.UsageWindow
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import kotlin.math.*

enum class PaceKind { Unknown, Behind, OnPace, Ahead, Exhausted }
enum class PaceTone { Muted, Good, Calm, Warn, Danger }
data class WindowPace(val kind: PaceKind = PaceKind.Unknown, val usedPercent: Double?, val startsAt: Double?, val resetsAt: Double?, val elapsedShare: Double?, val ratio: Double? = null, val percentPerMs: Double? = null, val projectedAtReset: Double? = null, val exhaustsAt: Double? = null, val early: Boolean)
fun parseTime(at: String?): Double? = at?.let { runCatching { Instant.parse(it).toEpochMilli().toDouble() }.getOrNull() }
fun windowPace(window: UsageWindow, now: Double): WindowPace {
    val reset = parseTime(window.resetsAt)
    val length = window.windowMinutes?.takeIf { it > 0 }?.times(60000.0)
    val start = if (reset != null && length != null) reset - length else null
    val elapsed = if (start != null && length != null) ((now - start) / length).coerceIn(0.0, 1.0) else null
    val p = WindowPace(usedPercent = window.usedPercent, startsAt = start, resetsAt = reset, elapsedShare = elapsed, early = elapsed != null && elapsed < .1)
    val used = window.usedPercent ?: return p
    if (used >= 100) return p.copy(kind = PaceKind.Exhausted)
    if (elapsed == null || start == null || reset == null || elapsed <= 0) return p
    val ratio = used / 100 / elapsed
    val passed = min(now, reset) - start
    val rate = if (passed > 0) used / passed else null
    val exhaustion = if (rate != null && rate > 0 && now < reset) (now + (100 - used) / rate).takeIf { it < reset } else null
    return p.copy(kind = if (ratio > 1.15) PaceKind.Ahead else if (ratio < .85) PaceKind.Behind else PaceKind.OnPace, ratio = ratio, percentPerMs = rate, projectedAtReset = ratio * 100, exhaustsAt = exhaustion)
}
fun projectedUsedPercent(p: WindowPace, now: Double, at: Double): Double? = if (p.usedPercent == null || p.percentPerMs == null) null else min(100.0, p.usedPercent + p.percentPerMs * max(0.0, at - now))
fun paceTone(p: WindowPace) = when(p.kind) {
    PaceKind.Unknown -> PaceTone.Muted
    PaceKind.Exhausted -> PaceTone.Danger
    PaceKind.Behind -> PaceTone.Good
    PaceKind.OnPace -> PaceTone.Calm
    PaceKind.Ahead -> if (!p.early && p.exhaustsAt != null && p.resetsAt != null) PaceTone.Danger else PaceTone.Warn
}
fun pressure(p: WindowPace): Double = when {
    p.usedPercent == null -> Double.NEGATIVE_INFINITY
    p.kind == PaceKind.Exhausted -> 1000 + p.usedPercent
    p.projectedAtReset != null && !p.early -> max(p.usedPercent, p.projectedAtReset)
    else -> p.usedPercent
}
fun percentLabel(value: Double?): String = when { value == null -> "—"; value > 0 && value < 1 -> "<1%"; else -> "${floor(value + .5).toLong()}%" }
fun formatDuration(ms: Double): String {
    val minutes = floor(max(0.0, ms) / 60000).toLong()
    if (minutes < 1) return "<1m"
    if (minutes < 60) return "${minutes}m"
    val hours = minutes / 60
    if (hours < 24) return "${hours}h" + if (minutes % 60 == 0L) "" else " ${minutes % 60}m"
    return "${hours / 24}d" + if (hours % 24 == 0L) "" else " ${hours % 24}h"
}
fun clockTime(at: Double): String = DateTimeFormatter.ofPattern("d MMM HH:mm").withZone(ZoneId.systemDefault()).format(Instant.ofEpochMilli(at.toLong()))
fun paceTitle(p: WindowPace) = when(p.kind) { PaceKind.Unknown -> "Pace unknown"; PaceKind.Exhausted -> "Limit reached"; PaceKind.Ahead -> if(p.early && p.exhaustsAt != null) "Brisk start" else "Ahead of pace"; PaceKind.Behind -> "Behind pace"; PaceKind.OnPace -> "On pace" }
fun paceDetail(p: WindowPace): String = when(p.kind) {
    PaceKind.Unknown -> if(p.usedPercent == null) "No reading for this window yet." else if(p.resetsAt == null) "The provider gives no reset time." else "No elapsed window to compare with."
    PaceKind.Exhausted -> if (p.resetsAt == null) "Used up; the provider gives no reset time." else "Used up until the window resets."
    PaceKind.Behind -> "Room to spare — projected ${percentLabel(p.projectedAtReset)} at reset."
    PaceKind.OnPace -> "Used about as fast as the window passes."
    PaceKind.Ahead -> if(p.exhaustsAt != null && p.resetsAt != null) "${if(p.early) "Early estimate: " else "At this rate: "}limit at ${clockTime(p.exhaustsAt)}, ${formatDuration(p.resetsAt - p.exhaustsAt)} before reset." else "Used faster than the window passes."
}
data class ChartPoint(val x: Double, val y: Double)
data class ChartSegment(val from: ChartPoint, val to: ChartPoint)
data class UsageChartGeometry(val points: List<ChartPoint>, val evenPace: ChartSegment?, val projection: ChartSegment?, val limitY: Double, val nowX: Double?)
/** Direct port of web geometry; keep out-of-period samples out of the line, but include them in its scale. */
fun usageChart(window: UsageWindow, now: Double, width: Double, height: Double): UsageChartGeometry {
    val p = windowPace(window, now)
    val samples = window.samples.mapNotNull { s -> parseTime(s.at)?.let { it to s.usedPercent } }.sortedBy { it.first }
    val start = p.startsAt ?: samples.firstOrNull()?.first ?: (now - 3600000)
    var end = p.resetsAt ?: max(now, samples.lastOrNull()?.first ?: now)
    if(end <= start) end = start + 60000
    val top = maxOf(100.0, p.usedPercent ?: 0.0, samples.maxOfOrNull { it.second } ?: 0.0)
    fun round(n: Double) = floor(n * 100 + .5) / 100
    fun x(at: Double) = round((at.coerceIn(start, end) - start) / (end - start) * width)
    fun y(used: Double) = round(height - max(0.0, used) / top * height)
    val series = samples.filter { it.first in start..end }.toMutableList()
    if(p.startsAt != null && (series.firstOrNull()?.first ?: Double.POSITIVE_INFINITY) > start) series.add(0, start to 0.0)
    if(p.usedPercent != null && now <= end && (series.lastOrNull()?.first ?: Double.NEGATIVE_INFINITY) < now) series.add(now to p.usedPercent)
    val points = if(series.size >= 2) series.map { ChartPoint(x(it.first), y(it.second)) } else emptyList()
    val even = if(p.startsAt != null && p.resetsAt != null) ChartSegment(ChartPoint(x(p.startsAt), y(0.0)), ChartPoint(x(p.resetsAt), y(100.0))) else null
    var projection: ChartSegment? = null
    if(p.usedPercent != null && p.resetsAt != null && now < p.resetsAt && p.kind != PaceKind.Exhausted) {
        val until = p.exhaustsAt ?: p.resetsAt
        projectedUsedPercent(p, now, until)?.let { projection = ChartSegment(ChartPoint(x(now), y(p.usedPercent)), ChartPoint(x(until), y(it))) }
    }
    return UsageChartGeometry(points, even, projection, y(100.0), if(now in start..end) x(now) else null)
}
