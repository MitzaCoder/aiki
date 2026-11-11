package io.github.mitzacoder.aiki.features.tasks.graph

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.*
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.github.mitzacoder.aiki.data.ConnectionStatus
import io.github.mitzacoder.aiki.data.request
import io.github.mitzacoder.aiki.features.panels.panelData
import io.github.mitzacoder.aiki.navigation.ProjectScreenContext
import io.github.mitzacoder.aiki.protocol.*
import io.github.mitzacoder.aiki.ui.theme.Jarvis
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/** Family-first native graph. T116 can add a project canvas without replacing this semantic/card layer. */
@Composable
fun TaskGraph(context: ProjectScreenContext, modifier: Modifier = Modifier, viewSwitch: @Composable () -> Unit, onLeave: () -> Unit) {
    // Graph-local button/link text uses the stronger foreground tone in every app palette.
    MaterialTheme(colorScheme = MaterialTheme.colorScheme.copy(primary = Jarvis.colors.fgMuted, onPrimary = Jarvis.colors.bg)) {
        TaskGraphContent(context, modifier, viewSwitch, onLeave)
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun TaskGraphContent(context: ProjectScreenContext, modifier: Modifier, viewSwitch: @Composable () -> Unit, onLeave: () -> Unit) {
    val view by context.board.view.collectAsStateWithLifecycle()
    val connection by context.backend.client.state.collectAsStateWithLifecycle()
    val project = context.route.projectId
    val linkedTask by context.board.linkedTask.collectAsStateWithLifecycle()
    val workersRead = if (connection.supports("workers")) panelData(context, "graph-workers", { it is WorkersStateEvent && it.projectId == project }) {
        context.backend.client.request(WorkersListRequest(projectId = project)).workers
    } else null
    val workers = workersRead?.value.orEmpty()
    val threadsRead = if (connection.supports("threads")) panelData(context, "graph-threads", { it is ThreadsStateEvent && it.projectId == project }) {
        context.backend.client.request(ThreadsListRequest(projectId = project, includeArchived = true)).threads
    } else null
    val threads = threadsRead?.value.orEmpty()
    val now by produceState(System.currentTimeMillis()) { while (true) { delay(30_000); value = System.currentTimeMillis() } }
    val model = remember(view.tasks, view.questions, workers, threads, now) { buildGraphModel(view.tasks, view.questions, workers, threads, now) }
    val key = "${context.backend.config.key}/$project"
    var familyId by rememberSaveable(key) { mutableStateOf<String?>(null) }
    var selectedId by rememberSaveable(key) { mutableStateOf(linkedTask) }
    var sheetOpen by rememberSaveable(key) { mutableStateOf(false) }
    var highlight by rememberSaveable(key) { mutableStateOf<String?>(null) }
    var showClosed by rememberSaveable(key) { mutableStateOf(false) }
    var searchOpen by rememberSaveable(key) { mutableStateOf(false) }
    var pickerOpen by rememberSaveable(key) { mutableStateOf(false) }
    var query by rememberSaveable(key) { mutableStateOf("") }
    var scrollTo by rememberSaveable(key) { mutableStateOf<String?>(null) }
    val families = remember(model, showClosed, selectedId) { model.families(showClosed, selectedId) }
    val family = families.find { it.id == familyId } ?: families.find { it.id == initialGraphFamily(families, selectedId?.let(model.details::get)) }
    val scope = rememberCoroutineScope()
    val list = rememberLazyListState()
    val colors = Jarvis.colors
    val crewLoaded = workersRead?.loading != true && threadsRead?.loading != true
    LaunchedEffect(family?.id, crewLoaded) { if (familyId == null && family != null && crewLoaded) familyId = family.id }
    fun select(id: String) {
        selectedId = id
        model.details[id]?.let { familyId = it.familyId }
        sheetOpen = true
        scrollTo = id
        searchOpen = false
    }
    fun switchFamily(id: String) { familyId = id; scope.launch { list.scrollToItem(0) } }
    LaunchedEffect(scrollTo, family?.id) {
        val index = family?.cards?.indexOfFirst { it.id == scrollTo } ?: -1
        if (index >= 0) { list.scrollToItem(index + 4); scrollTo = null }
    }
    BackHandler {
        when {
            searchOpen -> searchOpen = false
            pickerOpen -> pickerOpen = false
            else -> {
                val next = graphBack(GraphBackState(sheetOpen, selectedId, highlight))
                if (next == null) onLeave() else { sheetOpen = next.sheet; selectedId = next.selected; highlight = next.highlight }
            }
        }
    }
    BoxWithConstraints(modifier.fillMaxSize()) {
        val wide = maxWidth >= 840.dp
        Row(Modifier.fillMaxSize()) {
            LazyColumn(Modifier.weight(1f).fillMaxHeight().semantics { isTraversalGroup = true }, state = list,
                contentPadding = PaddingValues(12.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                item(key = "toolbar") {
                    Column {
                        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                            Box(Modifier.weight(1f)) { viewSwitch() }
                            TextButton(onClick = { searchOpen = true }, modifier = Modifier.heightIn(min = 48.dp)) { Text("Search") }
                        }
                        Text("Connected work · " + when (connection.status) {
                            ConnectionStatus.Ready -> "Live"
                            ConnectionStatus.Reconnecting, ConnectionStatus.Connecting -> "Reconnecting · showing last board"
                            else -> "Offline · showing last board"
                        }, color = colors.fg, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.semantics { heading(); liveRegion = LiveRegionMode.Polite })
                        view.error?.let { Text(it, color = colors.fg) }
                    }
                }
                item(key = "summary") {
                    Column {
                        Text("Needs you · reasons overlap", color = colors.fg, style = MaterialTheme.typography.labelMedium)
                        Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                            model.counters.forEach { counter ->
                                FilterChip(selected = highlight == counter.key, onClick = { highlight = counter.key.takeUnless { it == highlight } },
                                    label = { Text("${counter.mark} ${counter.label} ${counter.count}") }, modifier = Modifier.heightIn(min = 48.dp))
                            }
                        }
                        if (highlight != null) {
                            val matching = families.filter { f -> f.cards.any { model.matches(it.id, highlight) } }
                            if (matching.isEmpty()) Text("No matches. Try another counter or Show closed.", color = colors.fg)
                            else TextButton(onClick = {
                                val index = matching.indexOfFirst { it.id == family?.id }
                                switchFamily(matching[(index + 1) % matching.size].id)
                            }, modifier = Modifier.heightIn(min = 48.dp)) { Text("Next family with a match (${matching.size})") }
                        }
                        TextButton(onClick = { showClosed = !showClosed }, modifier = Modifier.heightIn(min = 48.dp)) { Text(if (showClosed) "Hide closed" else "Show closed") }
                    }
                }
                item(key = "switcher") {
                    if (families.isNotEmpty()) Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                        val index = families.indexOfFirst { it.id == family?.id }.coerceAtLeast(0)
                        TextButton(onClick = { switchFamily(families[(index - 1 + families.size) % families.size].id) }, modifier = Modifier.sizeIn(minWidth = 48.dp, minHeight = 48.dp).semantics { contentDescription = "Previous family" }) { Text("‹") }
                        TextButton(onClick = { pickerOpen = true }, modifier = Modifier.weight(1f).heightIn(min = 48.dp)) { Text("Family ${index + 1} of ${families.size} ▾") }
                        TextButton(onClick = { switchFamily(families[(index + 1) % families.size].id) }, modifier = Modifier.sizeIn(minWidth = 48.dp, minHeight = 48.dp).semantics { contentDescription = "Next family" }) { Text("›") }
                    }
                }
                item(key = "family-header") {
                    when {
                        !view.loaded -> { CircularProgressIndicator(); Text("Loading tasks…", color = colors.fg) }
                        model.details.isEmpty() -> Text("No tasks yet. Use List to add work or answer unassigned questions.", color = colors.fg)
                        family == null -> Text("All tasks are closed. Show closed to read them.", color = colors.fg)
                        else -> GraphFamilyHeader(family, model)
                    }
                }
                items(family?.cards.orEmpty(), key = { it.id }) { card ->
                    val d = model.details.getValue(card.id)
                    GraphTaskCard(d, card.depth, selectedId == card.id, model.matches(card.id, highlight), model.holdsUp(card.id).total, now) { select(card.id) }
                }
                item(key = "guidance") { Text("Solid guides connect subtasks. Open a card for dependencies and reports. List also has unassigned questions.", color = colors.fg, style = MaterialTheme.typography.bodySmall) }
            }
            if (wide && sheetOpen && selectedId != null) {
                VerticalDivider()
                GraphDetails(selectedId!!, model, now, ::select, { context.openTask(selectedId!!) }, { sheetOpen = false }, Modifier.width(360.dp).fillMaxHeight())
            }
        }
        if (!wide && sheetOpen && selectedId != null) ModalBottomSheet(
            onDismissRequest = { sheetOpen = false }, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
        ) {
            GraphDetails(selectedId!!, model, now, ::select, { context.openTask(selectedId!!) }, { sheetOpen = false }, Modifier.fillMaxWidth().fillMaxHeight(.86f))
        }
    }
    if (searchOpen) GraphSearchDialog(model, query, { query = it }, ::select, { searchOpen = false })
    if (pickerOpen) AlertDialog(onDismissRequest = { pickerOpen = false }, title = { Text("Choose family") }, text = {
        LazyColumn { items(families, key = { it.id }) { f ->
            TextButton(onClick = { switchFamily(f.id); pickerOpen = false }, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) { Text("${f.title} · ${f.needsYou} need you") }
        } }
    }, confirmButton = { TextButton(onClick = { pickerOpen = false }) { Text("Close") } })
}

@Composable
private fun GraphSearchDialog(model: GraphModel, query: String, onQuery: (String) -> Unit, onSelect: (String) -> Unit, onClose: () -> Unit) {
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
