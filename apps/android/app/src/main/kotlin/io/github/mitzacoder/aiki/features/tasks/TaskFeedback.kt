package io.github.mitzacoder.aiki.features.tasks

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.unit.dp
import io.github.mitzacoder.aiki.protocol.BoardFeedback
import io.github.mitzacoder.aiki.ui.theme.Jarvis

@Composable
internal fun TaskFeedback(entries: List<BoardFeedback>, busy: Boolean, onSetState: (BoardFeedback, String) -> Unit) {
    TaskSection(TaskSectionKind.Feedback, count = "${entries.count { it.state == "open" || it.state == "handling" }} open") {
        if (entries.isEmpty()) Text("No feedback yet.", style = TaskType.xs, color = Jarvis.colors.fgSubtle)
        sortedFeedback(entries).forEach { entry ->
            FoldedCard {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(entry.id, style = TaskType.metaMono, color = Jarvis.colors.fgSubtle)
                    Text(feedbackStateWords(entry.state), Modifier.weight(1f), style = TaskType.xsSemibold, color = Jarvis.colors.fgMuted)
                    val live = entry.state == "open" || entry.state == "handling"
                    TextButton(onClick = { onSetState(entry, if (live) "dismissed" else "open") }, enabled = !busy) {
                        Text(if (live) "Dismiss" else "Reopen", style = TaskType.xs)
                    }
                }
                Column(Modifier.alpha(if (entry.state == "dismissed") .55f else 1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    ReportMarkdown(entry.text)
                    entry.note?.takeIf { it.isNotBlank() }?.let { Text(it, style = TaskType.xs, color = Jarvis.colors.fgMuted) }
                    Text(listOfNotNull(entry.at, entry.threadId, entry.images?.takeIf { it > 0 }?.let { "$it images" }).joinToString(" · "), style = TaskType.meta, color = Jarvis.colors.fgSubtle)
                }
            }
        }
    }
}
