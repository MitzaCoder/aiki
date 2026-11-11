package io.github.mitzacoder.aiki.features.tasks.graph

import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.*
import androidx.compose.ui.unit.dp
import io.github.mitzacoder.aiki.ui.components.Lucide
import io.github.mitzacoder.aiki.ui.components.LucideGlyph
import io.github.mitzacoder.aiki.ui.theme.Jarvis

@Composable
internal fun GraphChrome(viewSwitch: @Composable () -> Unit, model: GraphModel, highlight: String?, onHighlight: (String?) -> Unit,
    onSearch: () -> Unit, onChanges: () -> Unit, unseen: Int, showClosed: Boolean, onClosed: () -> Unit, canvas: Boolean,
    onCanvas: () -> Unit, connection: String, lastDataAt: Long, now: Long,
) {
    var overflow by remember { mutableStateOf(false) }
    val status = when (connection) { "Ready" -> "Live"; "Reconnecting", "Connecting" -> "Reconnecting"; else -> "Offline" }
    val age = if (lastDataAt == 0L) "waiting for data" else "last data ${(now - lastDataAt).coerceAtLeast(0) / 1000} seconds ago"
    val connectionTone = when (status) { "Live" -> Jarvis.colors.success; "Reconnecting" -> Jarvis.colors.warning; else -> Jarvis.colors.danger }
    Column(Modifier.fillMaxWidth().background(Jarvis.colors.bg)) {
        Row(Modifier.fillMaxWidth().padding(horizontal = 8.dp), verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.weight(1f)) { viewSwitch() }
            IconButton(onClick = onSearch, modifier = Modifier.sizeIn(minWidth = 48.dp, minHeight = 48.dp).semantics { contentDescription = "Search graph" }) { LucideGlyph(Lucide.Search, size = 20.dp, tint = Jarvis.colors.fg) }
            IconButton(onClick = onChanges, modifier = Modifier.sizeIn(minWidth = 48.dp, minHeight = 48.dp).semantics { contentDescription = "Changes, $unseen unread. $status" }) {
                BadgedBox(badge = { if (unseen > 0) Badge { Text(if (unseen > 99) "99+" else "$unseen") } }) {
                    Box(Modifier.size(24.dp)) {
                        LucideGlyph(Lucide.History, size = 20.dp, tint = connectionTone)
                        Box(Modifier.align(Alignment.BottomEnd).size(6.dp).background(connectionTone, androidx.compose.foundation.shape.CircleShape))
                    }
                }
            }
            Box {
                IconButton(onClick = { overflow = true }, modifier = Modifier.sizeIn(minWidth = 48.dp, minHeight = 48.dp).semantics { contentDescription = "Graph options. $status"; liveRegion = LiveRegionMode.Polite }) { LucideGlyph(Lucide.MoreHorizontal, size = 20.dp, tint = Jarvis.colors.fg) }
                DropdownMenu(expanded = overflow, onDismissRequest = { overflow = false }) {
                    DropdownMenuItem(text = { Text(if (canvas) "Family view" else "All families") }, onClick = { overflow = false; onCanvas() })
                    DropdownMenuItem(text = { Text(if (showClosed) "Hide closed" else "Show closed") }, onClick = { overflow = false; onClosed() })
                    DropdownMenuItem(text = { Text("$status · $age") }, onClick = { overflow = false })
                    DropdownMenuItem(text = { Text("Lines: solid subtask, dotted found-while, dashed arrow blocked-by, dash-dot related") }, onClick = { overflow = false })
                }
            }
        }
        Row(Modifier.fillMaxWidth().padding(horizontal = 8.dp), verticalAlignment = Alignment.CenterVertically) {
            Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).semantics { contentDescription = "Task counters. Needs-you reasons overlap; a task can count in several reasons." }, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                model.counters.forEach { counter ->
                    FilterChip(selected = highlight == counter.key, onClick = { onHighlight(counter.key.takeUnless { it == highlight }) },
                        label = { Text("${counter.mark} ${counter.label} ${counter.count}") }, modifier = Modifier.heightIn(min = 48.dp))
                }
            }
        }
    }
}

@Composable
internal fun GraphSearchDialog(model: GraphModel, query: String, onQuery: (String) -> Unit, onSelect: (String) -> Unit, onClose: () -> Unit) {
    AlertDialog(onDismissRequest = onClose, title = { Text("Search tasks") }, text = {
        Column {
            OutlinedTextField(query, onQuery, label = { Text("ID, title, family, worker or thread") }, modifier = Modifier.fillMaxWidth(), singleLine = true)
            val results = model.search(query)
            if (query.isNotBlank() && results.isEmpty()) Text("No matches.", color = Jarvis.colors.fg)
            LazyColumn(Modifier.heightIn(max = 360.dp)) { items(results, key = { it.taskId }) { result ->
                TextButton(onClick = { onSelect(result.taskId) }, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) {
                    Text("${result.taskId} · ${model.details[result.taskId]?.task?.title}\n${result.matched}", modifier = Modifier.fillMaxWidth())
                }
            } }
        }
    }, confirmButton = { TextButton(onClick = onClose, modifier = Modifier.heightIn(min = 48.dp)) { Text("Close") } })
}

@Composable
internal fun GraphChangesDialog(entries: List<GraphChangeEntry>, now: Long, onSelect: (String) -> Unit, onClose: () -> Unit) {
    AlertDialog(onDismissRequest = onClose, title = { Text("Changes", Modifier.semantics { paneTitle = "Graph changes" }) }, text = {
        if (entries.isEmpty()) Text("No changes since opening this graph.")
        else LazyColumn(Modifier.heightIn(max = 480.dp)) { items(entries, key = { it.id }) { entry ->
            TextButton(onClick = { entry.change.taskIds.firstOrNull()?.let(onSelect) }, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) {
                Text("${entry.text}\n${((now - entry.at).coerceAtLeast(0) / 1000)} s ago", Modifier.fillMaxWidth(), color = Jarvis.colors.fg)
            }
        } }
    }, confirmButton = { TextButton(onClick = onClose, modifier = Modifier.heightIn(min = 48.dp)) { Text("Close") } })
}
