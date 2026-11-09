package com.mihaisaru.harness.navigation

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.mihaisaru.harness.ui.theme.Jarvis

/** The same compact warm attention panel in the drawer and expanded tablet sidebar. */
@Composable
internal fun NeedsYou(links: List<ProjectAttentionLink>, navigate: (Destination) -> Unit) {
    if (links.isEmpty()) return
    val colors = Jarvis.colors
    var expanded by remember { mutableStateOf(false) }
    Surface(
        Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp),
        shape = RoundedCornerShape(16.dp), color = colors.warning.copy(alpha = .055f),
        border = BorderStroke(1.dp, colors.warning.copy(alpha = .28f)),
    ) {
        Column(Modifier.padding(6.dp)) {
            Row(Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                Text("NEEDS YOU", Modifier.weight(1f), style = MaterialTheme.typography.labelSmall, fontWeight = FontWeight.SemiBold, color = colors.fgMuted)
                Surface(shape = RoundedCornerShape(7.dp), color = colors.warning.copy(alpha = .12f)) {
                    Text(links.sumOf { it.action.count }.toString(), Modifier.padding(horizontal = 7.dp, vertical = 3.dp), style = MaterialTheme.typography.labelSmall, color = colors.warning)
                }
            }
            (if (expanded) links else links.take(3)).forEach { link ->
                val review = link.action.kind == AttentionKind.Review
                Surface(
                    onClick = {
                        val chat = Destination.Chat(link.backendKey, link.projectId, threadId = link.action.threadId)
                        navigate(link.action.taskId?.let { Destination.Task(chat, it) } ?: chat)
                    },
                    shape = RoundedCornerShape(10.dp), color = androidx.compose.ui.graphics.Color.Transparent,
                    modifier = Modifier.semantics(mergeDescendants = true) { contentDescription = "${link.action.label}, ${link.projectName}, ${link.backendName}" },
                ) {
                    Row(Modifier.fillMaxWidth().heightIn(min = 48.dp).padding(8.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        Surface(shape = RoundedCornerShape(9.dp), color = if (review) colors.surface2 else colors.warning.copy(alpha = .10f)) {
                            Box(Modifier.size(29.dp), contentAlignment = Alignment.Center) {
                                Text(when (link.action.kind) { AttentionKind.Question -> "?"; AttentionKind.Review -> "✓"; else -> "!" }, color = if (review) colors.fgMuted else colors.warning, fontWeight = FontWeight.SemiBold)
                            }
                        }
                        Column(Modifier.weight(1f)) {
                            Text(link.action.label, style = MaterialTheme.typography.labelLarge, fontWeight = if (review) FontWeight.Medium else FontWeight.SemiBold, color = if (review) colors.fgMuted else colors.fg, maxLines = 1, overflow = TextOverflow.Ellipsis)
                            Text(link.projectName, style = MaterialTheme.typography.labelSmall, color = colors.fgSubtle, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        }
                        Text("↗", color = colors.fgSubtle)
                    }
                }
            }
            if (links.size > 3) TextButton(onClick = { expanded = !expanded }, modifier = Modifier.fillMaxWidth()) {
                Text(if (expanded) "Show less" else "${links.size - 3} more to check", style = MaterialTheme.typography.labelMedium, color = colors.fgMuted)
            }
        }
    }
}
