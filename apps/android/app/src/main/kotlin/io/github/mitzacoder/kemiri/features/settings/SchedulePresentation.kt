package io.github.mitzacoder.kemiri.features.settings

import io.github.mitzacoder.kemiri.navigation.Destination
import io.github.mitzacoder.kemiri.features.status.relativeTime
import io.github.mitzacoder.kemiri.protocol.*
import java.time.Instant

internal fun scheduleExecutionLabel(kind: String?, isolation: String): String =
    if (kind == "thread") "Background thread · own workspace"
    else "Worker · ${if (isolation == "workspace") "isolated workspace" else "shared checkout"}"

internal fun scheduleOutcomeLabel(outcome: String): String = when (outcome) {
    "started" -> "Started"
    "skipped" -> "Skipped"
    "failed" -> "Failed"
    else -> outcome
}
internal fun scheduleTriggerLabel(trigger: String): String = when (trigger) {
    "schedule" -> "Scheduled"
    "catch-up" -> "Catch-up"
    "manual" -> "Run by hand"
    "event" -> "Review requested"
    else -> trigger
}
internal fun scheduleReportLabel(kind: String?, report: String): String = when (report) {
    "record" -> "Record only"
    "review" -> if (kind == "thread") "Main reviews the summary" else "Coordinator reviews the report"
    else -> report
}

/** A run's owner comes from the server, not the screen from which history is opened. */
internal fun scheduleRunDestination(current: Destination.Chat, run: ScheduleRun): Destination.Chat? =
    if (run.outcome != "started" || (run.workerId == null && run.threadId == null)) null
    else current.copy(threadId = run.threadId, workerId = run.workerId)

/** How often the backend checks GitHub for an event rule; the backend's own interval, told to the user. */
const val EVENT_POLL_MINUTES = 2

private val DAY_SHORT = listOf("Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat")
private val DAY_NAMES = listOf("Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday")

private fun plural(count: Long, unit: String) = "$count $unit${if (count == 1L) "" else "s"}"
private fun everyPhrase(count: Long, unit: String) = if (count == 1L) "Every $unit" else "Every ${plural(count, unit)}"

private fun dayList(days: List<Int>): String {
    val names = days.distinct().filter { it in 0..6 }.sorted().map { DAY_SHORT[it] }
    return if (names.size <= 1) names.firstOrNull().orEmpty() else "${names.dropLast(1).joinToString(", ")} and ${names.last()}"
}

fun isEventSpec(spec: ScheduleSpec) = spec is ScheduleSpecGithubReviewRequested

/**
 * A schedule in plain words (web `describeSchedule`): "Every 30 minutes", "Every 2 hours", "Weekdays at 09:00", "Mon, Wed and
 * Fri at 18:30", the raw expression for cron, or the event an event rule waits for.
 */
fun describeSchedule(spec: ScheduleSpec): String = when (spec) {
    is ScheduleSpecGithubReviewRequested ->
        if (spec.repos.isNullOrEmpty()) "When a review is requested from you on GitHub" else "When a review is requested from you on GitHub in ${spec.repos.joinToString(", ")}"
    is ScheduleSpecInterval -> when {
        spec.everyMinutes % 1440 == 0L -> everyPhrase(spec.everyMinutes / 1440, "day")
        spec.everyMinutes % 60 == 0L -> everyPhrase(spec.everyMinutes / 60, "hour")
        else -> everyPhrase(spec.everyMinutes, "minute")
    }
    is ScheduleSpecDaily -> "Every day at ${io.github.mitzacoder.kemiri.data.displayWallTime(spec.time)}"
    is ScheduleSpecWeekly -> {
        val days = spec.days.map { it.toInt() }.distinct().sorted()
        when {
            days == listOf(1, 2, 3, 4, 5) -> "Weekdays at ${io.github.mitzacoder.kemiri.data.displayWallTime(spec.time)}"
            days == listOf(0, 6) -> "Weekends at ${io.github.mitzacoder.kemiri.data.displayWallTime(spec.time)}"
            days.size == 7 -> "Every day at ${io.github.mitzacoder.kemiri.data.displayWallTime(spec.time)}"
            days.size == 1 -> "Every ${DAY_NAMES.getOrElse(days[0]) { "day" }} at ${io.github.mitzacoder.kemiri.data.displayWallTime(spec.time)}"
            else -> "${dayList(days)} at ${io.github.mitzacoder.kemiri.data.displayWallTime(spec.time)}"
        }
    }
    is ScheduleSpecCron -> "Cron: ${spec.expression}"
    is UnknownScheduleSpec -> spec.raw.toString()
}

/** "in less than a minute", "in 25 min", "in 3 h", "in 2 days": a time already past reads as "now". */
fun untilPhrase(deltaMs: Long): String {
    if (deltaMs < 60_000) return if (deltaMs <= 0) "now" else "in less than a minute"
    if (deltaMs < 3_600_000) return "in ${maxOf(1, Math.round(deltaMs / 60_000.0))} min"
    if (deltaMs < 86_400_000) return "in ${Math.round(deltaMs / 3_600_000.0)} h"
    val days = Math.round(deltaMs / 86_400_000.0)
    return if (days < 30) "in ${plural(days, "day")}" else "in ${plural(Math.round(days / 30.0), "month")}"
}

/** The note under the schedule list's title. */
fun timezoneNote(timezone: String) = if (timezone.isEmpty()) "Times follow the backend's clock." else "Times are in the backend's timezone, $timezone."

/** What a schedule says about when it runs (web `whenText`): the next run for a clock rule; for an event rule how GitHub is checked. */
fun scheduleWhenText(schedule: Schedule, timezone: String, now: Long): String {
    if (!isEventSpec(schedule.spec)) {
        val at = schedule.nextRunAt ?: return "Paused"
        val instant = runCatching { Instant.parse(at) }.getOrNull() ?: return "Next run at an unknown time"
        return "Next ${untilPhrase(instant.toEpochMilli() - now)} · ${backendTime(at, timezone)}"
    }
    if (!schedule.enabled) return "Paused"
    val every = "Checks GitHub every $EVENT_POLL_MINUTES min"
    val state = schedule.eventState
    val checkedAt = state?.checkedAt ?: return "$every · not checked yet"
    val error = state.error?.trim().orEmpty()
    val last = relativeTime(checkedAt, now)
    return if (error.isEmpty()) "$every · last checked $last" else "$every · last check failed $last: $error"
}

/** The pull request an event run was about as a chip says it ("platform#1205"), or null for a clock run. */
fun runRefLabel(run: ScheduleRun): String? {
    val ref = run.ref ?: return null
    val match = Regex("github\\.com/([^/]+/[^/]+)/pull/(\\d+)").find(ref)
    return if (match == null) ref else "${match.groupValues[1]}#${match.groupValues[2]}"
}

/** Why a run did nothing, when it did nothing. */
fun runReason(run: ScheduleRun): String? = run.message?.trim()?.takeIf { it.isNotEmpty() }

/** The last run of a schedule as one line (web `lastRunText`): when it ran and what happened; a skip or a failure carries its reason. */
fun scheduleLastRunText(schedule: Schedule, now: Long): String {
    val run = schedule.runs.maxByOrNull { runCatching { Instant.parse(it.at).toEpochMilli() }.getOrDefault(0L) } ?: return "Never ran"
    val whenText = relativeTime(run.at, now)
    return when (run.outcome) {
        "started" -> "Last run started $whenText"
        "skipped" -> "Skipped $whenText — ${runReason(run) ?: "not started"}"
        "failed" -> "Failed $whenText — ${runReason(run) ?: "unknown reason"}"
        else -> "${run.outcome} $whenText"
    }
}
