package io.github.mitzacoder.kemiri.features.chat

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import io.github.mitzacoder.kemiri.navigation.ProjectScreenContext
import io.github.mitzacoder.kemiri.ui.theme.Jarvis

internal data class ReportNoticeSection(val taskId: String, val section: String, val reason: String)
internal data class ReportsNotice(val raw: String, val sections: List<ReportNoticeSection>)

/** Plain-text injected input, like board/check-in notices. Parse history on read, without a migration. */
internal fun parseReportsNotice(text: String): ReportsNotice? {
    val prefix = Regex("""^\s*\[reports\](?:\s|$)""").find(text) ?: return null
    val body = text.substring(prefix.range.last + 1).replace(Regex("""\. Read tasks; rewrite stale sections with evidence\.\s*$"""), "").trim()
    val entries = body.split(Regex(""";\s*(?=T\d+ (?:Results|Next)(?:/(?:Results|Next))* stale:)"""))
    val sections = entries.flatMap { entry ->
        val match = Regex("""^(T\d+) ((?:Results|Next)(?:/(?:Results|Next))*) stale:\s*([\s\S]*)$""").matchEntire(entry)
        if (match == null) emptyList() else match.groupValues[2].split('/').map { section ->
            ReportNoticeSection(match.groupValues[1], section, match.groupValues[3].trim())
        }
    }.distinctBy { it.taskId to it.section }
    return ReportsNotice(text, sections)
}

@Composable internal fun ReportsNoticeLine(part: ChatPart, notice: ReportsNotice, context: ProjectScreenContext?) {
    TaskLine(part.key, ChatIcons.ClipboardList, TaskLineTone.Quiet, minimumTouchTarget = 48.dp,
        timestamp = part.timestamp, details = { RawText(notice.raw) }) {
        Column(Modifier.weight(1f).padding(vertical = 4.dp)) {
            Text("Reports out of date", style = MaterialTheme.typography.bodySmall, color = Jarvis.colors.fgMuted)
            FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                notice.sections.forEach { section ->
                    OutlinedButton(
                        onClick = { context?.openTask(section.taskId) }, enabled = context != null,
                        modifier = Modifier.heightIn(min = 48.dp).semantics {
                            contentDescription = "Open ${section.taskId}, ${section.section} report out of date: ${section.reason}"
                        }, contentPadding = PaddingValues(horizontal = 10.dp, vertical = 0.dp),
                    ) { Text("${section.taskId} · ${section.section}", style = MaterialTheme.typography.labelSmall, color = Jarvis.colors.fgMuted) }
                }
            }
            val reasons = notice.sections.map { it.reason }.filter { it.isNotEmpty() }.distinct().joinToString("; ")
            if (reasons.isNotEmpty()) Text(reasons, style = MaterialTheme.typography.labelSmall,
                color = Jarvis.colors.fgSubtle, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
    }
}
