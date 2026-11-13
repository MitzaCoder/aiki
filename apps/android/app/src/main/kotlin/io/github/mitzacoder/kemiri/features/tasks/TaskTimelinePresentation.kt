package io.github.mitzacoder.kemiri.features.tasks

import io.github.mitzacoder.kemiri.protocol.BoardTimelineEntry
import io.github.mitzacoder.kemiri.protocol.BoardTimelineFact
import io.github.mitzacoder.kemiri.protocol.BoardTimelineGroup
import io.github.mitzacoder.kemiri.features.chat.markdownText
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


internal fun orderedTimelineGroups(groups: List<BoardTimelineGroup>, newestFirst: Boolean): List<BoardTimelineGroup> {
    val sorted = groups.sortedWith(compareBy({ Instant.parse(it.hour) }, { Instant.parse(it.range.start) }, { it.id }))
    return if (newestFirst) sorted.reversed() else sorted
}

internal fun timelineRange(start: String, end: String, zone: ZoneId = ZoneId.systemDefault()): String {
    val format = DateTimeFormatter.ofPattern("HH:mm").withZone(zone)
    return "${format.format(Instant.parse(start))}–${format.format(Instant.parse(end))}"
}

internal fun timelineGroupKind(kind: String): String = when (kind) {
    "work" -> "Work"
    "decisions" -> "Decisions and feedback"
    "delivery" -> "Delivery"
    else -> kind
}

internal fun timelineGroupTone(group: BoardTimelineGroup): String = when {
    group.entries.any { it.outcome == "failed" || it.outcome == "rolled_back" } -> "danger"
    group.entries.any { it.kind == "question" && it.outcome == "open" } -> "warning"
    group.kind == "delivery" -> "success"
    else -> "activity"
}

internal fun BoardTimelineFact.timelineEntry(): BoardTimelineEntry {
    val start = when {
        source == "worker" || source == "thread" -> "started"
        kind == "question" -> "asked"
        kind == "feedback" -> "received"
        source == "deploy" -> "queued"
        else -> null
    }
    val subject = if (source == "deploy") label else actor?.name ?: ref ?: label
    val evolvingLabel = if (start != null && factCount > 1 && outcome != "running") "$subject · $start → ${outcome.replace('_', ' ')}" else label
    return BoardTimelineEntry(at, kind, evolvingLabel, detail, ref, state, by)
}
