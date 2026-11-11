package io.github.mitzacoder.aiki.features.tasks

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import io.github.mitzacoder.aiki.navigation.ProjectScreenContext
import io.github.mitzacoder.aiki.protocol.*
import io.github.mitzacoder.aiki.ui.theme.Jarvis
import io.github.mitzacoder.aiki.ui.theme.Text as TextStyles

/** The report the agents keep current: next, now and results as Markdown, with when and who last wrote. */
@Composable
internal fun ReportSectionView(task: BoardTask, now: Long, writerName: (BoardWriter) -> String, freshnessEnabled: Boolean, context: ProjectScreenContext) {
    val colors = Jarvis.colors
    val report = task.report
    var marked by remember(task.id) { mutableStateOf(false) }
    val showFreshness = reportFreshnessVisible(freshnessEnabled, report)
    TaskSection(
        TaskSectionKind.Report, count = if (hasReport(report)) "Current update" else null,
        metadata = report.updatedAt?.let { at -> {
            Text(
                listOfNotNull(relativeTime(at, now), report.updatedBy?.let(writerName)).joinToString(" · "),
                style = TaskType.meta, color = colors.fgSubtle,
                textAlign = TextAlign.End, maxLines = 2, overflow = TextOverflow.Ellipsis,
            )
        } },
        headerAction = if (freshnessEnabled) { { ReportStaleAction(context, task.id) { marked = true } } } else null,
    ) {
        if (hasReport(report) || showFreshness) TASK_SHEET_REPORT_SECTIONS.forEach { section ->
            val text = report.section(section)
            val freshness = if (!showFreshness) null else when (section) {
                ReportSection.Results -> report.freshness?.results
                ReportSection.Next -> report.freshness?.next
                else -> null
            }
            val emptyResults = showFreshness && section == ReportSection.Results && emptyFinishedResults(task.status, text)
            if (text.isNotBlank() || emptyResults || freshness?.stale == true) Column(
                if (section == ReportSection.Next) Modifier.fillMaxWidth().background(colors.accent2.copy(alpha = .07f), RoundedCornerShape(12.dp)).padding(12.dp) else Modifier,
                verticalArrangement = Arrangement.spacedBy(4.dp),
            ) {
                Text(section.label.uppercase(), style = TaskType.heading, color = colors.accent2)
                if (text.isNotBlank()) ReportMarkdown(text)
                if (emptyResults) Text("No results yet · work finished", style = TaskType.xs, color = colors.fgMuted)
                freshness?.let { metadata ->
                    val age = reportSectionAge(metadata, now)
                    val meta = buildAnnotatedString {
                        append(age)
                        if (metadata.stale) {
                            if (length > 0) append(" · ")
                            withStyle(SpanStyle(fontWeight = FontWeight.SemiBold, color = colors.fg)) { append("needs update") }
                            append(reportSectionStaleness(metadata).orEmpty().removePrefix("needs update"))
                        }
                    }
                    if (meta.isNotEmpty()) Text(meta, style = TaskType.meta, color = colors.fgSubtle)
                }
            }
        }
        else Text("Nothing written yet. The agents fill this in as they work.", style = TextStyles.task, color = colors.fgSubtle)
        if (marked) Text("Marked as needing an update.", style = TaskType.xs, color = colors.fgMuted)
    }
}

