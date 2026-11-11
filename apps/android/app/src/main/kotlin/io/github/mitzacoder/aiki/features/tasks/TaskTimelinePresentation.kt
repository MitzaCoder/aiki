package io.github.mitzacoder.aiki.features.tasks

import io.github.mitzacoder.aiki.protocol.BoardTimelineEntry
import io.github.mitzacoder.aiki.features.chat.markdownText
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle

internal fun orderedTimeline(entries: List<BoardTimelineEntry>, newestFirst: Boolean): List<BoardTimelineEntry> {
    val sorted = entries.sortedBy { Instant.parse(it.at) }
    return if (newestFirst) sorted.reversed() else sorted
}

internal fun timelineDay(at: String, now: Long, zone: ZoneId = ZoneId.systemDefault()): String {
    val date = runCatching { Instant.parse(at).atZone(zone).toLocalDate() }.getOrNull() ?: return at
    val today = Instant.ofEpochMilli(now).atZone(zone).toLocalDate()
    return when (date) {
        today -> "Today"
        today.minusDays(1) -> "Yesterday"
        else -> date.format(DateTimeFormatter.ofLocalizedDate(FormatStyle.MEDIUM))
    }
}

internal fun timelineStatus(label: String): List<String>? = label.split(" → ").takeIf { it.size == 2 }?.map { it.replace('_', ' ') }
internal fun timelineDetail(detail: String): String = markdownText(detail).replace(Regex("\\s+"), " ").trim()
internal fun timelineTone(entry: BoardTimelineEntry): String = when {
    entry.state == "failed" || Regex("\\bfailed\\b", RegexOption.IGNORE_CASE).containsMatchIn(entry.label) -> "danger"
    Regex("\\breported\\b", RegexOption.IGNORE_CASE).containsMatchIn(entry.label) -> "success"
    entry.kind == "question" -> "warning"
    entry.kind == "status" || entry.kind == "worker" -> "activity"
    entry.kind == "milestone" -> "success"
    else -> "accent"
}
