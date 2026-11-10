package io.github.mitzacoder.aiki.features.chat

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.github.mitzacoder.aiki.data.*
import io.github.mitzacoder.aiki.features.panels.panelRelativeTime
import io.github.mitzacoder.aiki.navigation.*
import io.github.mitzacoder.aiki.protocol.*
import io.github.mitzacoder.aiki.ui.components.*
import io.github.mitzacoder.aiki.ui.theme.Jarvis
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.MutableStateFlow

/**
 * A memory file a chat card asked the Memory panel to open: the panel takes it when it shows for that project, once.
 * The transcript has no route to a file, so this is the hand-over.
 */
object MemoryFileLinks {
    data class Request(val backendKey: String, val projectId: String, val scope: String, val fileId: String)
    val pending = MutableStateFlow<Request?>(null)

    fun open(context: ProjectScreenContext, scope: String, fileId: String) {
        pending.value = Request(context.backend.config.key, context.route.projectId, scope, fileId)
        context.navigate(Destination.Panel(context.route, PanelTab.Memory))
    }

    /** The request for this project, taken so it opens once; null when there is none. */
    fun take(backendKey: String, projectId: String): Request? {
        val request = pending.value?.takeIf { it.backendKey == backendKey && it.projectId == projectId } ?: return null
        pending.compareAndSet(request, null)
        return request
    }
}

/** The memories a compaction saved: the extraction commit, the scope it was written in and its topics (file ID → title). */
data class MemoryExtraction(val scope: String, val change: MemoryChange, val topics: List<Pair<String, String>>)

/** The newest extraction in either scope whose source names this compaction entry; the project's scope is read first. */
fun memoryExtractionFor(histories: List<Triple<String, List<MemoryChange>, List<MemoryFileSummary>>>, projectId: String, conversationId: Long?, entryId: Long): MemoryExtraction? {
    var found: MemoryExtraction? = null
    for ((scope, changes, files) in histories.sortedByDescending { it.first == "project" }) for (change in changes) {
        val source = change.source ?: continue
        if (change.kind != "extraction" || source.entryId != entryId || source.projectId != projectId || (conversationId != null && source.conversationId != conversationId)) continue
        if (found != null && found.change.at >= change.at) continue
        found = MemoryExtraction(scope, change, change.files.map { fileId -> fileId to (files.firstOrNull { it.fileId == fileId }?.title ?: fileId) })
    }
    return found
}

/**
 * A compaction in the transcript: a divider saying earlier messages were summarized and when, opening onto the summary.
 * While one runs it is a quiet "Summarizing…" line. When it left memories behind, the divider says how many and names
 * the topics; a topic opens in the Memory panel and the whole extraction can be undone from here.
 */
@Composable internal fun CompactionMarker(part: ChatPart, context: ProjectScreenContext?) {
    if (part.status == "running") {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.Center, verticalAlignment = Alignment.CenterVertically) {
            CircularProgressIndicator(Modifier.size(12.dp), strokeWidth = 1.5.dp, color = Jarvis.colors.fgSubtle)
            Spacer(Modifier.width(8.dp))
            Text("Summarizing earlier messages…", style = MaterialTheme.typography.labelSmall, color = Jarvis.colors.fgSubtle)
        }
        return
    }
    var open by rememberSaveable(part.key) { mutableStateOf(false) }
    val summary = part.text.takeIf(String::isNotBlank)
    val whenText = part.timestamp?.let { panelRelativeTime(java.time.Instant.ofEpochMilli(it).toString()) }
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            HorizontalDivider(Modifier.weight(1f), color = Jarvis.colors.border)
            val shape = RoundedCornerShape(50)
            Row(Modifier.clip(shape).background(Jarvis.colors.surface.copy(alpha = .5f)).border(1.dp, Jarvis.colors.border, shape)
                .then(if (summary != null) Modifier.clickable(role = Role.Button, onClickLabel = if (open) "Hide the summary" else "Show the summary") { open = !open } else Modifier)
                .heightIn(min = 32.dp).padding(horizontal = 10.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                LucideGlyph(Lucide.Archive, size = 12.dp, tint = Jarvis.colors.fgSubtle)
                Text("Earlier messages summarized", style = MaterialTheme.typography.labelSmall, fontWeight = FontWeight.Medium, color = Jarvis.colors.fgSubtle, maxLines = 1, overflow = TextOverflow.Ellipsis)
                whenText?.let { Text("· $it", style = MaterialTheme.typography.labelSmall, color = Jarvis.colors.fgSubtle, maxLines = 1) }
                if (summary != null) LucideGlyph(if (open) Lucide.ChevronDown else Lucide.ChevronRight, size = 12.dp, tint = Jarvis.colors.fgSubtle)
            }
            HorizontalDivider(Modifier.weight(1f), color = Jarvis.colors.border)
        }
        if (open && summary != null) Box(Modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp)).background(Jarvis.colors.surface.copy(alpha = .4f)).border(1.dp, Jarvis.colors.border, RoundedCornerShape(16.dp)).padding(horizontal = 14.dp, vertical = 10.dp)) {
            RichMarkdown(summary)
        }
        if (context != null && part.sourceEntryId != null) CompactionMemory(part, context)
    }
}

@Composable private fun CompactionMemory(part: ChatPart, context: ProjectScreenContext) {
    val connection by context.backend.client.state.collectAsStateWithLifecycle()
    var extraction by remember(part.key, context.route) { mutableStateOf<MemoryExtraction?>(null) }
    var revision by remember { mutableIntStateOf(0) }
    var error by remember { mutableStateOf<String?>(null) }
    var confirm by remember { mutableStateOf(false) }
    var saving by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    LaunchedEffect(context.backend.client, context.route) {
        context.backend.client.events.collect { if (it is MemoryChangedEvent && (it.scope == "global" || it.projectId == context.route.projectId)) revision++ }
    }
    LaunchedEffect(connection, revision, part.sourceEntryId) {
        val entryId = part.sourceEntryId ?: return@LaunchedEffect
        if (connection.status != ConnectionStatus.Ready || !connection.supports("memory")) return@LaunchedEffect
        try {
            val histories = listOf("global", "project").map { target ->
                val project = if (target == "project") context.route.projectId else null
                val changes = context.backend.client.request(MemoryHistoryRequest(scope = target, projectId = project, limit = 100)).changes
                // Titles only matter for the scope that holds this compaction's extraction.
                val files = if (changes.any { it.kind == "extraction" && it.source?.entryId == entryId }) context.backend.client.request(MemoryListRequest(scope = target, projectId = project, includeArchived = true)).files else emptyList()
                Triple(target, changes, files)
            }
            extraction = memoryExtractionFor(histories, context.route.projectId, part.sourceConversationId, entryId)
        } catch (e: CancellationException) { throw e }
        catch (_: Exception) { error = "Memory history unavailable." }
    }
    val found = extraction ?: return error?.let { Text(it, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.error) } ?: Unit
    val saved = found.change.files.size
    if (saved == 0) return
    FlowRow(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(6.dp, Alignment.CenterHorizontally), verticalArrangement = Arrangement.spacedBy(4.dp), itemVerticalAlignment = Alignment.CenterVertically) {
        Text(if (saved == 1) "1 memory saved" else "$saved memories saved", style = MaterialTheme.typography.labelSmall, fontWeight = FontWeight.Medium, color = Jarvis.colors.fgSubtle)
        found.topics.forEach { (fileId, title) ->
            Text(title, Modifier.widthIn(max = 180.dp).clip(RoundedCornerShape(50)).background(Jarvis.colors.surface2).border(1.dp, Jarvis.colors.border, RoundedCornerShape(50))
                .clickable(role = Role.Button, onClickLabel = "Open $title in Memory") { MemoryFileLinks.open(context, found.scope, fileId) }.padding(horizontal = 8.dp, vertical = 6.dp),
                style = MaterialTheme.typography.labelSmall, color = Jarvis.colors.fgMuted, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        if (found.change.undoneBy != null) Text("Undone", Modifier.border(1.dp, Jarvis.colors.border, RoundedCornerShape(50)).padding(horizontal = 8.dp, vertical = 4.dp), style = MaterialTheme.typography.labelSmall, color = Jarvis.colors.fgSubtle)
        else if (found.change.undoable == true) TextButton(enabled = !saving, onClick = { confirm = true }, contentPadding = PaddingValues(horizontal = 6.dp)) { Text("Undo", style = MaterialTheme.typography.labelSmall) }
        Text(if (found.scope == "global") "in your global memory" else "in this project's memory", style = MaterialTheme.typography.labelSmall, color = Jarvis.colors.fgSubtle)
    }
    error?.let { Text(it, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.error) }
    if (confirm) AlertDialog(onDismissRequest = { confirm = false }, title = { Text("Undo these memories?") }, text = {
        Text("This reverts the whole extraction commit ($saved ${if (saved == 1) "file" else "files"}) as one undo commit. It is refused if later changes touched the same memories.")
    }, confirmButton = {
        TextButton(onClick = {
            confirm = false; saving = true
            scope.launch {
                try {
                    context.backend.client.request(MemoryUndoRequest(scope = found.scope, projectId = if (found.scope == "project") context.route.projectId else null, commit = found.change.commit))
                    revision++; error = null
                } catch (e: CancellationException) { throw e }
                catch (e: ClientException) { error = if (e.code == "memory_conflict") "Later memory edits conflict. Review memory history; nothing was overwritten." else e.message }
                catch (_: Exception) { error = "Could not confirm undo. Refresh memory history before retrying." }
                finally { saving = false }
            }
        }) { Text("Undo") }
    }, dismissButton = { TextButton(onClick = { confirm = false }) { Text("Cancel") } })
}
