package io.github.mitzacoder.kemiri.features.tasks

import io.github.mitzacoder.kemiri.data.timeFormatter
import io.github.mitzacoder.kemiri.data.DEFAULT_WORK_DAY_START
import io.github.mitzacoder.kemiri.data.normalizeWorkDayStart
import java.time.Instant
import java.time.LocalDate
import java.time.LocalTime
import java.time.ZoneId
import java.util.Locale

/** Calendar arithmetic: gaps shift forward, overlaps use the earlier offset, matching web Date. */
internal fun resolveWaitingDate(date: String, start: String = DEFAULT_WORK_DAY_START, now: Instant = Instant.now(), zone: ZoneId = ZoneId.systemDefault()): String? {
    if (date.isEmpty()) return null
    var day = LocalDate.parse(date)
    val time = LocalTime.parse(normalizeWorkDayStart(start))
    var resolved = day.atTime(time).atZone(zone)
    while (!resolved.toInstant().isAfter(now)) {
        day = day.plusDays(1)
        resolved = day.atTime(time).atZone(zone)
    }
    return resolved.toInstant().toString()
}

internal fun localWaitingDate(timestamp: String, zone: ZoneId = ZoneId.systemDefault()): String = Instant.parse(timestamp).atZone(zone).toLocalDate().toString()
internal fun formatWaitingTime(timestamp: String, zone: ZoneId = ZoneId.systemDefault()): String =
    timeFormatter("EEE d MMM, HH:mm", Locale.getDefault()).format(Instant.parse(timestamp).atZone(zone))
