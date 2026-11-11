package io.github.mitzacoder.aiki.features.tasks

import io.github.mitzacoder.aiki.protocol.BoardReportSection
import io.github.mitzacoder.aiki.protocol.BoardTaskReport

internal fun reportFreshnessVisible(enabled: Boolean, report: BoardTaskReport): Boolean = enabled && report.freshness != null

internal fun emptyFinishedResults(status: String, results: String): Boolean =
    results.isBlank() && status in listOf("review", "done")

internal fun reportSectionAge(section: BoardReportSection, now: Long): String = listOfNotNull(
    section.writtenAt?.let { "written ${if (section.approximate) "about " else ""}${relativeTime(it, now)}" },
    section.eventsSince.takeIf { it > 0 }?.let { "$it ${if (it == 1L) "event" else "events"} since" },
).joinToString(" · ")

internal fun reportSectionStaleness(section: BoardReportSection): String? = if (section.stale) {
    listOf("needs update", section.reasons.filter { it.isNotBlank() }.joinToString("; ")).filter { it.isNotEmpty() }.joinToString(" · ")
} else null
