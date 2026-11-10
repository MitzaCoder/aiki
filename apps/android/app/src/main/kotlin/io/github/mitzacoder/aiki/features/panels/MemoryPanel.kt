package io.github.mitzacoder.aiki.features.panels

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import io.github.mitzacoder.aiki.features.chat.HarnessMarkdown
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.Alignment
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.github.mitzacoder.aiki.ui.components.*
import io.github.mitzacoder.aiki.ui.theme.Jarvis
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.withStyle
import io.github.mitzacoder.aiki.data.*
import io.github.mitzacoder.aiki.navigation.*
import io.github.mitzacoder.aiki.protocol.*
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/** One scope's lists: its topic files (archived included, so the toggle can count them), its commits, its maintenance. */
internal data class MemoryLists(
    val files: List<MemoryFileSummary> = emptyList(),
    val changes: List<MemoryChange> = emptyList(),
    val status: MemoryStatusResponse? = null,
)

/** What is read beside the lists: the open file, or the search's hits. */
internal data class MemoryDetail(val file: MemoryFile? = null, val hits: List<MemorySearchHit>? = null)

internal fun memoryEventMatches(event: MemoryChangedEvent, project: String) = event.scope == "global" || event.projectId == project

/**
 * The Memory tab (web `MemoryPanel.svelte`): what the backend remembers about the user (global) and this project. The
 * scope switch (remembered on the device), a search over both scopes, and Files | History: topic files with archived ones
 * behind a toggle, or the scope's commits in words with the maintenance line and Undo. A file opens to its front matter
 * and body. Times move on while the panel is open.
 */
@Composable internal fun MemoryPanel(context: ProjectScreenContext) {
    val androidContext = LocalContext.current
    val preferences = remember { androidContext.getSharedPreferences(MEMORY_SCOPE_PREFERENCES, android.content.Context.MODE_PRIVATE) }
    var scope by remember { mutableStateOf(loadMemoryScope(preferences)) }
    var query by remember { mutableStateOf("") }
    var includeArchived by rememberSaveable { mutableStateOf(false) }
    var history by rememberSaveable { mutableStateOf(false) }
    /** The open file: its scope and ID. */
    var opened by remember { mutableStateOf<Pair<String, String>?>(null) }
    var undoTarget by remember { mutableStateOf<MemoryChangeRow?>(null) }
    var undoing by remember { mutableStateOf<String?>(null) }
    var undoError by remember { mutableStateOf<Pair<String, String>?>(null) }
    var maintenanceStarting by remember { mutableStateOf(false) }
    var maintenanceError by remember { mutableStateOf<String?>(null) }
    var now by remember { mutableLongStateOf(System.currentTimeMillis()) }
    LaunchedEffect(Unit) { while (true) { delay(60_000); now = System.currentTimeMillis() } }
    val project = context.route.projectId
    val client = context.backend.client
    val connection by client.state.collectAsStateWithLifecycle()
    val maintenanceEnabled = connection.supports("memory-maintenance")
    val actions = rememberCoroutineScope()
    fun pickScope(next: String) {
        if (next == scope) return
        scope = next
        saveMemoryScope(preferences, next)
        undoError = null
        maintenanceError = null
    }
    /** A file in the other scope switches to it first, as a global link does. */
    fun open(fileId: String, inScope: String = scope) { pickScope(inScope); opened = inScope to fileId }
    // A topic tapped in the chat (a compaction's memories, a memory call) opens here.
    LaunchedEffect(context.backend.config.key, project) {
        io.github.mitzacoder.aiki.features.chat.MemoryFileLinks.pending.collect {
            io.github.mitzacoder.aiki.features.chat.MemoryFileLinks.take(context.backend.config.key, project)?.let { request -> query = ""; history = false; open(request.fileId, request.scope) }
        }
    }
    fun target(of: String) = if (of == "global") null else project
    val relevant = { event: ProtocolEvent -> event is MemoryChangedEvent && memoryEventMatches(event, project) }
    val lists = panelData(context, scope, relevant) {
        MemoryLists(
            files = client.request(MemoryListRequest(scope = scope, projectId = target(scope), includeArchived = true)).files,
            changes = client.request(MemoryHistoryRequest(scope = scope, projectId = target(scope), limit = 50)).changes,
            status = if (client.state.value.supports("memory-maintenance")) client.request(MemoryStatusRequest(scope = scope, projectId = target(scope))) else null,
        )
    }
    val term = query.trim().ifEmpty { null }
    val detail = panelData(context, listOf(term, opened), relevant) {
        val file = opened
        when {
            file != null -> MemoryDetail(file = client.request(MemoryReadRequest(scope = file.first, projectId = target(file.first), fileId = file.second)).file)
            term != null -> {
                // Ask a moment after typing stops, not on every key.
                delay(200)
                MemoryDetail(hits = client.request(MemorySearchRequest(query = term, scope = "both", projectId = project, limit = 30)).hits)
            }
            else -> MemoryDetail()
        }
    }
    fun undo(row: MemoryChangeRow) {
        undoTarget = null
        undoing = row.change.commit
        undoError = null
        actions.launch {
            try {
                client.request(MemoryUndoRequest(scope = scope, projectId = target(scope), commit = row.change.commit))
                lists.refresh.trySend(Unit)
            } catch (e: CancellationException) { throw e }
            catch (e: Exception) { undoError = row.change.commit to memoryUndoErrorText(e) }
            finally { undoing = null }
        }
    }
    fun runMaintenance() {
        if (maintenanceStarting) return
        maintenanceStarting = true
        maintenanceError = null
        actions.launch {
            try {
                client.request(MemoryMaintainRequest(scope = scope, projectId = target(scope)))
                lists.refresh.trySend(Unit)
            } catch (e: CancellationException) { throw e }
            catch (e: Exception) { maintenanceError = panelError(e) }
            finally { maintenanceStarting = false }
        }
    }
    val colors = Jarvis.colors
    val split = splitMemoryFiles(lists.value?.files.orEmpty(), includeArchived, now)
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        SingleChoiceSegmentedButtonRow(Modifier.fillMaxWidth()) {
            MEMORY_SCOPES.forEachIndexed { index, option ->
                SegmentedButton(selected = scope == option, onClick = { pickScope(option); opened = null }, shape = SegmentedButtonDefaults.itemShape(index, MEMORY_SCOPES.size)) { Text(memoryScopeLabel(option)) }
            }
        }
        OutlinedTextField(query, { query = it; if (it.isNotBlank()) opened = null }, placeholder = { Text("Search all memory") }, leadingIcon = { LucideGlyph(Lucide.Search) }, singleLine = true, modifier = Modifier.fillMaxWidth())
        if (term == null && opened == null) SingleChoiceSegmentedButtonRow(Modifier.fillMaxWidth()) {
            val counts = listOf(lists.value?.let { "Files (${split.active})" } ?: "Files", lists.value?.let { "History (${it.changes.size})" } ?: "History")
            listOf(false, true).forEachIndexed { index, value ->
                SegmentedButton(selected = history == value, onClick = { history = value }, shape = SegmentedButtonDefaults.itemShape(index, 2)) { Text(counts[index]) }
            }
        }
        PanelBody(lists) { view ->
            val file = opened
            if (file != null) {
                TextButton(onClick = { opened = null }) { LucideGlyph(Lucide.ArrowLeft, size = 14.dp); Spacer(Modifier.width(6.dp)); Text(if (term == null) "All files" else "Results") }
                detail.error?.let { Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall) }
                val read = detail.value?.file?.takeIf { it.file.fileId == file.second }
                if (read == null) Text("Opening ${file.second}…", style = MaterialTheme.typography.bodySmall, color = colors.fgSubtle)
                else MemoryFileView(context, read, view.files, now, open = ::open)
            } else if (term != null) {
                detail.error?.let { Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall) }
                val hits = detail.value?.hits
                when {
                    hits == null -> Text("Searching for \"$term\"…", style = MaterialTheme.typography.bodySmall, color = colors.fgSubtle)
                    hits.isEmpty() -> Text("No memories in either scope match \"$term\".", style = MaterialTheme.typography.bodySmall, color = colors.fgSubtle)
                    else -> {
                        MemoryHeading("Matches", hits.size)
                        hits.forEach { hit -> MemoryCard(onClick = { open(hit.fileId, hit.scope) }) {
                            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                Text(hit.title, Modifier.weight(1f), style = MaterialTheme.typography.titleSmall, maxLines = 1, overflow = TextOverflow.Ellipsis)
                                MemoryPill(memoryScopeLabel(hit.scope))
                            }
                            Text(memorySearchHeading(hit.heading), style = MaterialTheme.typography.labelSmall, color = colors.fgSubtle, maxLines = 1, overflow = TextOverflow.Ellipsis)
                            Text(buildAnnotatedString { snippetParts(hit.snippet).forEach { (part, match) -> if (match) withStyle(SpanStyle(fontWeight = FontWeight.Medium, color = colors.fg, background = colors.warning.copy(alpha = 0.3f))) { append(part) } else append(part) } },
                                style = MaterialTheme.typography.bodySmall, color = colors.fgMuted, maxLines = 3, overflow = TextOverflow.Ellipsis)
                        } }
                    }
                }
            } else if (history) {
                if (maintenanceEnabled) view.status?.let { response ->
                    val status = memoryStatusView(response.status, now)
                    OutlinedCard(Modifier.fillMaxWidth(), shape = MaterialTheme.shapes.medium) {
                        Column(Modifier.padding(horizontal = 12.dp, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                                val small = MaterialTheme.typography.labelSmall
                                when {
                                    status.running || maintenanceStarting -> Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                                        CircularProgressIndicator(Modifier.size(12.dp), strokeWidth = 1.5.dp)
                                        Text("Maintaining…", style = small, color = colors.fgMuted)
                                    }
                                    status.last != null -> Text("Last run ${status.last.first}", style = small, color = if (status.last.third) colors.warning else colors.fgSubtle)
                                    else -> Text("No maintenance run yet", style = small, color = colors.fgSubtle)
                                }
                                if (status.off) Text("Maintenance off", style = small, color = colors.fgSubtle)
                                else status.next?.let { Text("Next run ${it.first}", style = small, color = colors.fgSubtle) }
                                Text("· ${status.writes}", style = small, color = colors.fgSubtle)
                            }
                            status.last?.second?.takeIf { status.last.third }?.let { Text(it, style = MaterialTheme.typography.labelSmall, color = colors.fgSubtle) }
                            OutlinedButton(onClick = ::runMaintenance, enabled = !status.running && !maintenanceStarting && !status.off, contentPadding = PaddingValues(horizontal = 10.dp), modifier = Modifier.heightIn(min = 32.dp)) {
                                Text("Run maintenance now", style = MaterialTheme.typography.labelMedium)
                            }
                            Text(memoryMaintenanceSummary(response.maintenance, response.timezone), style = MaterialTheme.typography.labelSmall, color = colors.fgSubtle)
                            maintenanceError?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error) }
                        }
                    }
                }
                val rows = memoryChangeRows(view.changes, now)
                if (rows.isEmpty()) Text("No changes yet in the ${memoryScopeLabel(scope).lowercase()} scope.", style = MaterialTheme.typography.bodySmall, color = colors.fgSubtle)
                else MemoryHeading("Commits", rows.size)
                rows.forEach { row -> key(row.change.commit) { MemoryCard {
                    FlowRow(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(2.dp), itemVerticalAlignment = Alignment.CenterVertically) {
                        MemoryPill(row.kind)
                        row.compactionEntry?.let { entry ->
                            val here = row.change.source?.projectId == project
                            Text("compaction at entry #$entry", style = MaterialTheme.typography.labelSmall, color = if (here) colors.fgMuted else colors.fgSubtle,
                                textDecoration = if (here) androidx.compose.ui.text.style.TextDecoration.Underline else null,
                                modifier = if (here) Modifier.clickable(role = Role.Button, onClickLabel = "Show the compaction these memories were saved from") {
                                    context.navigate(context.route.copy(threadId = null, workerId = null, highlight = ChatHighlight.Entry(entry)))
                                } else Modifier)
                        }
                        Spacer(Modifier.weight(1f))
                        Text(row.`when`, style = MaterialTheme.typography.labelSmall, color = colors.fgSubtle)
                    }
                    Text(row.subject.ifEmpty { row.commit }, style = MaterialTheme.typography.titleSmall, maxLines = 2, overflow = TextOverflow.Ellipsis)
                    if (row.body.isNotEmpty()) Text(row.body, style = MaterialTheme.typography.bodySmall, color = colors.fgMuted, maxLines = 3, overflow = TextOverflow.Ellipsis)
                    FlowRow(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(4.dp), verticalArrangement = Arrangement.spacedBy(4.dp), itemVerticalAlignment = Alignment.CenterVertically) {
                        Text(row.commit, fontFamily = FontFamily.Monospace, style = MaterialTheme.typography.labelSmall, color = colors.fgSubtle)
                        row.change.files.forEach { MemoryChip(it, monospace = true) }
                        Spacer(Modifier.weight(1f))
                        if (row.undoable && maintenanceEnabled) OutlinedButton(onClick = { undoTarget = row }, enabled = undoing != row.change.commit,
                            contentPadding = PaddingValues(horizontal = 10.dp), modifier = Modifier.heightIn(min = 32.dp)) {
                            if (undoing == row.change.commit) { CircularProgressIndicator(Modifier.size(12.dp), strokeWidth = 1.5.dp); Spacer(Modifier.width(4.dp)) }
                            Text("Undo", style = MaterialTheme.typography.labelMedium)
                        } else if (row.change.undoneBy != null) MemoryPill("Undone")
                    }
                    undoError?.takeIf { it.first == row.change.commit }?.let { Text(it.second, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error) }
                } } }
            } else {
                if (split.active == 0 && split.archived == 0) Text("No memory yet in the ${memoryScopeLabel(scope).lowercase()} scope. The coordinator writes it as it works.", style = MaterialTheme.typography.bodySmall, color = colors.fgSubtle)
                else {
                    MemoryHeading("Files", split.active)
                    if (split.shown.isEmpty()) Text("No active memories in this scope.", style = MaterialTheme.typography.bodySmall, color = colors.fgSubtle)
                    split.shown.forEach { row -> key(row.file.fileId) { MemoryCard(onClick = { open(row.file.fileId, row.file.scope) }) {
                        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            Text(row.file.title, Modifier.weight(1f), style = MaterialTheme.typography.titleSmall, maxLines = 1, overflow = TextOverflow.Ellipsis)
                            if (row.file.status != "active") MemoryPill(memoryStatusLabel(row.file.status))
                            Text(row.updated, style = MaterialTheme.typography.labelSmall, color = colors.fgSubtle)
                        }
                        if (row.file.summary.isNotEmpty()) Text(row.file.summary, style = MaterialTheme.typography.bodySmall, color = colors.fgMuted, maxLines = 2, overflow = TextOverflow.Ellipsis)
                        if (row.file.tags.isNotEmpty()) FlowRow(horizontalArrangement = Arrangement.spacedBy(4.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) { row.file.tags.forEach { MemoryChip(it) } }
                    } } }
                    if (split.archived > 0) TextButton(onClick = { includeArchived = !includeArchived }, modifier = Modifier.semantics { selected = includeArchived }) {
                        LucideGlyph(if (includeArchived) Lucide.ChevronDown else Lucide.ChevronRight, size = 14.dp)
                        Spacer(Modifier.width(6.dp))
                        Text("Archived (${split.archived})", style = MaterialTheme.typography.labelMedium)
                    }
                }
            }
        }
    }
    undoTarget?.let { row ->
        val files = row.change.files.size
        AlertDialog(
            onDismissRequest = { undoTarget = null },
            title = { Text("Undo this change?") },
            text = { Text("“${row.subject.ifEmpty { "this commit" }}” (${row.kind}, $files ${if (files == 1) "file" else "files"}) is reverted as one undo commit. It is refused if later changes touched the same memories, and nothing is reverted then.") },
            dismissButton = { TextButton(onClick = { undoTarget = null }) { Text("Cancel") } },
            confirmButton = { TextButton(onClick = { undo(row) }, colors = ButtonDefaults.textButtonColors(contentColor = MaterialTheme.colorScheme.error)) { Text("Undo") } },
        )
    }
}

/** An open memory: title, summary, ID and age, then its front matter (status, tags, links, source) and its body. */
@Composable private fun MemoryFileView(context: ProjectScreenContext, read: MemoryFile, files: List<MemoryFileSummary>, now: Long, open: (String, String) -> Unit) {
    val colors = Jarvis.colors
    val file = read.file
    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Text(file.title, style = MaterialTheme.typography.titleSmall)
        if (file.summary.isNotEmpty()) Text(file.summary, style = MaterialTheme.typography.bodySmall, color = colors.fgMuted)
        Text("${file.fileId} · updated ${io.github.mitzacoder.aiki.features.status.relativeTime(memoryInstant(file.updated), now)}", style = MaterialTheme.typography.labelSmall, color = colors.fgSubtle)
    }
    OutlinedCard(Modifier.fillMaxWidth(), shape = MaterialTheme.shapes.medium) {
        Column(Modifier.padding(10.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                MemoryHeading("Status and tags")
                FlowRow(horizontalArrangement = Arrangement.spacedBy(4.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    MemoryPill(memoryStatusLabel(file.status))
                    file.tags.forEach { MemoryChip(it) }
                    if (file.tags.isEmpty()) Text("No tags", style = MaterialTheme.typography.labelSmall, color = colors.fgSubtle)
                }
                file.supersededBy?.let { link ->
                    val (scope, id) = memoryTarget(link, file.scope)
                    Text("Superseded by $id", Modifier.clickable(role = Role.Button) { open(id, scope) }, style = MaterialTheme.typography.labelSmall, color = colors.fgMuted,
                        textDecoration = androidx.compose.ui.text.style.TextDecoration.Underline)
                }
            }
            val links = memoryLinkViews(file.links, file.scope, files)
            if (links.isNotEmpty()) Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                MemoryHeading("Links", links.size)
                FlowRow(horizontalArrangement = Arrangement.spacedBy(4.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    links.forEach { link -> MemoryChip(link.label, monospace = !link.known) { open(link.fileId, link.scope) } }
                }
            }
            Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                MemoryHeading("Source")
                val source = file.source
                when {
                    source == null -> Text("No recorded source.", style = MaterialTheme.typography.labelSmall, color = colors.fgMuted)
                    source.projectId != null -> Text(memorySourceText(source), Modifier.clickable(role = Role.Button, onClickLabel = "Open the project's chat") {
                        context.navigate(context.route.copy(projectId = source.projectId, threadId = null, workerId = null, highlight = null))
                    }, style = MaterialTheme.typography.labelSmall, color = colors.fgMuted, textDecoration = androidx.compose.ui.text.style.TextDecoration.Underline)
                    else -> Text(memorySourceText(source), style = MaterialTheme.typography.labelSmall, color = colors.fgMuted)
                }
            }
            Text("Created ${io.github.mitzacoder.aiki.features.status.relativeTime(memoryInstant(file.created), now)}   Updated ${io.github.mitzacoder.aiki.features.status.relativeTime(memoryInstant(file.updated), now)}",
                style = MaterialTheme.typography.labelSmall, color = colors.fgSubtle)
        }
    }
    OutlinedCard(Modifier.fillMaxWidth(), shape = MaterialTheme.shapes.medium) { HarnessMarkdown(read.body, Modifier.fillMaxWidth().padding(10.dp)) }
}

@Composable private fun MemoryHeading(title: String, count: Int? = null) {
    Text(title.uppercase() + (count?.let { " ($it)" } ?: ""), style = MaterialTheme.typography.labelSmall, color = Jarvis.colors.fgSubtle)
}

/** A row in the lists: a bordered card, tappable when it opens something. */
@Composable private fun MemoryCard(onClick: (() -> Unit)? = null, content: @Composable ColumnScope.() -> Unit) {
    val colors = CardDefaults.outlinedCardColors(containerColor = MaterialTheme.colorScheme.surfaceContainerLow)
    val body: @Composable ColumnScope.() -> Unit = { Column(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(4.dp), content = content) }
    if (onClick != null) OutlinedCard(onClick = onClick, modifier = Modifier.fillMaxWidth(), shape = MaterialTheme.shapes.medium, colors = colors, content = body)
    else OutlinedCard(Modifier.fillMaxWidth(), shape = MaterialTheme.shapes.medium, colors = colors, content = body)
}

/** A bordered label: the change's kind, a hit's scope, a file's status. */
@Composable private fun MemoryPill(text: String) {
    Surface(shape = RoundedCornerShape(50), border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant), color = MaterialTheme.colorScheme.surface.copy(alpha = 0f)) {
        Text(text, Modifier.padding(horizontal = 6.dp, vertical = 1.dp), style = MaterialTheme.typography.labelSmall, color = Jarvis.colors.fgMuted, maxLines = 1)
    }
}

/** A tag, a file name or a link; tappable when [onClick] is given. */
@Composable private fun MemoryChip(text: String, monospace: Boolean = false, onClick: (() -> Unit)? = null) {
    Surface(
        shape = RoundedCornerShape(50), border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant), color = Jarvis.colors.surface2,
        modifier = if (onClick != null) Modifier.clickable(role = Role.Button, onClick = onClick) else Modifier,
    ) {
        Text(text, Modifier.padding(horizontal = 6.dp, vertical = 2.dp), style = MaterialTheme.typography.labelSmall, color = Jarvis.colors.fgMuted,
            fontFamily = if (monospace) FontFamily.Monospace else null, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}
