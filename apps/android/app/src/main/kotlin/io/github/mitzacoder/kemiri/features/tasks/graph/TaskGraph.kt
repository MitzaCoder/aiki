package io.github.mitzacoder.kemiri.features.tasks.graph

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.*
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.github.mitzacoder.kemiri.data.ConnectionStatus
import io.github.mitzacoder.kemiri.data.request
import io.github.mitzacoder.kemiri.features.panels.panelData
import io.github.mitzacoder.kemiri.navigation.ProjectScreenContext
import io.github.mitzacoder.kemiri.protocol.*
import io.github.mitzacoder.kemiri.ui.theme.Jarvis
import kotlinx.coroutines.launch

private val graphSessions = java.util.WeakHashMap<Any, GraphLive>()
@Composable
fun TaskGraph(context: ProjectScreenContext, modifier: Modifier = Modifier, viewSwitch: @Composable () -> Unit, onLeave: () -> Unit) {
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
    val threadsRead = if (connection.supports("threads")) panelData(context, "graph-threads", { it is ThreadsStateEvent && it.projectId == project }) {
        context.backend.client.request(ThreadsListRequest(projectId = project, includeArchived = true)).threads
    } else null
    val workers = workersRead?.value.orEmpty(); val threads = threadsRead?.value.orEmpty()
    val live = remember(context.board) { graphSessions.getOrPut(context.board) { GraphLive() } }
    val now = graphDisplayTime(live)
    val motion = graphMotionAllowed()
    val model = remember(view.tasks, view.questions, workers, threads, now / 30_000) { buildGraphModel(view.tasks, view.questions, workers, threads, now) }
    val snapshot = remember(view.tasks, view.questions, workers, threads) { graphSnapshot(view.tasks, view.questions, workers, threads) }
    val authoritative = connection.status == ConnectionStatus.Ready && graphReadsComplete(connection.generation, view.generation, workersRead?.generation, threadsRead?.generation)
    LaunchedEffect(snapshot, authoritative, connection.generation) {
        if (authoritative) live.read(snapshot, connection.generation, System.currentTimeMillis()) else live.disconnected()
    }
    DisposableEffect(live) { onDispose { live.disconnected() } }
    val key = "${context.backend.config.key}/$project"
    var familyId by rememberSaveable(key) { mutableStateOf<String?>(null) }
    var selectedId by rememberSaveable(key) { mutableStateOf(linkedTask) }
    var sheetOpen by rememberSaveable(key) { mutableStateOf(false) }
    var highlight by rememberSaveable(key) { mutableStateOf<String?>(null) }
    var showClosed by rememberSaveable(key) { mutableStateOf(false) }
    var searchOpen by rememberSaveable(key) { mutableStateOf(false) }
    var pickerOpen by rememberSaveable(key) { mutableStateOf(false) }
    var changesOpen by rememberSaveable(key) { mutableStateOf(false) }
    var canvas by rememberSaveable(key) { mutableStateOf(false) }
    var query by rememberSaveable(key) { mutableStateOf("") }
    var scrollTo by rememberSaveable(key) { mutableStateOf<String?>(null) }
    val canvasState = remember(key) { GraphCanvasState() }
    val families = remember(model, showClosed, selectedId, live.linger.keys.toSet()) { model.families(showClosed, selectedId, live.linger.keys.toSet()) }
    val family = families.find { it.id == familyId } ?: families.find { it.id == initialGraphFamily(families, selectedId?.let(model.details::get)) }
    val scope = rememberCoroutineScope(); val list = rememberLazyListState(); val colors = Jarvis.colors
    LaunchedEffect(family?.id, authoritative) { if (familyId == null && family != null && authoritative) familyId = family.id }
    LaunchedEffect(changesOpen, live.serial) { if (changesOpen) live.markSeen() }
    fun select(id: String) {
        selectedId = id; model.details[id]?.let { familyId = it.familyId }
        sheetOpen = true; scrollTo = id; searchOpen = false; changesOpen = false
    }
    fun switchFamily(id: String) { familyId = id; scope.launch { list.scrollToItem(0) } }
    fun enterCanvas(pinch: Boolean = false) { canvasState.entryZoom = if (pinch) .80f else 1f; canvasState.camera = null; canvas = true }
    LaunchedEffect(scrollTo, family?.id, canvas) {
        val index = family?.cards?.indexOfFirst { it.id == scrollTo } ?: -1
        if (!canvas && index >= 0) { list.scrollToItem(index + 2); scrollTo = null }
    }
    BackHandler {
        when {
            searchOpen -> searchOpen = false
            pickerOpen -> pickerOpen = false
            changesOpen -> changesOpen = false
            else -> {
                val next = graphNavigateBack(GraphNavigation(sheetOpen, selectedId, highlight, canvas))
                if (next == null) onLeave() else { sheetOpen = next.sheet; selectedId = next.selected; highlight = next.highlight; canvas = next.canvas }
            }
        }
    }
    BoxWithConstraints(modifier.fillMaxSize()) {
        val wide = maxWidth >= 840.dp
        val decorativeMotion = motion && !searchOpen && !changesOpen && !pickerOpen && (wide || !sheetOpen)
        Row(Modifier.fillMaxSize()) {
            Column(Modifier.weight(1f).fillMaxHeight()) {
                GraphChrome(viewSwitch, model, highlight, { highlight = it }, { searchOpen = true }, { changesOpen = true }, live.unseen,
                    showClosed, { showClosed = !showClosed }, canvas, { if (canvas) canvas = false else enterCanvas() },
                    connection.status.name, live.lastDataAt, now)
                view.error?.let { Text(it, color = colors.fg) }
                if (highlight != null) {
                    val matching = families.filter { f -> f.cards.any { model.matches(it.id, highlight) } }
                    if (matching.isEmpty()) Text("No matches. Try another counter or Show closed.", color = colors.fg)
                    else TextButton(onClick = { val index = matching.indexOfFirst { it.id == family?.id }; switchFamily(matching[(index + 1) % matching.size].id); canvas = false }, modifier = Modifier.heightIn(min = 48.dp)) { Text("Next family with a match (${matching.size})") }
                }
                if (canvas) GraphCanvas(canvasState, model, families, family?.id, selectedId, highlight, live, now, decorativeMotion, ::select, { switchFamily(it); canvas = false }, Modifier.weight(1f))
                else LazyColumn(Modifier.weight(1f).fillMaxWidth().graphPinchOut { enterCanvas(true) }.semantics { isTraversalGroup = true }, state = list,
                    contentPadding = PaddingValues(12.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
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
                        GraphTaskCard(d, card.depth, selectedId == card.id, model.matches(card.id, highlight), model.holdsUp(card.id).total, now,
                            live.glows[card.id]?.let { it > now } == true, decorativeMotion, live.reports.keys) { select(card.id) }
                    }
                    item(key = "overview") { TextButton(onClick = { enterCanvas() }, modifier = Modifier.heightIn(min = 48.dp)) { Text("All families") } }
                }
            }
            if (wide && sheetOpen && selectedId != null) {
                VerticalDivider()
                GraphDetails(selectedId!!, model, now, ::select, { context.openTask(selectedId!!) }, { sheetOpen = false }, Modifier.width(360.dp).fillMaxHeight())
            }
        }
        if (!wide && sheetOpen && selectedId != null) ModalBottomSheet(onDismissRequest = { sheetOpen = false }, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)) {
            GraphDetails(selectedId!!, model, now, ::select, { context.openTask(selectedId!!) }, { sheetOpen = false }, Modifier.fillMaxWidth().fillMaxHeight(.86f))
        }
    }
    if (searchOpen) GraphSearchDialog(model, query, { query = it }, ::select, { searchOpen = false })
    if (changesOpen) GraphChangesDialog(live.entries, now, ::select, { changesOpen = false })
    if (pickerOpen) AlertDialog(onDismissRequest = { pickerOpen = false }, title = { Text("Choose family") }, text = {
        LazyColumn { items(families, key = { it.id }) { f -> TextButton(onClick = { switchFamily(f.id); pickerOpen = false }, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) { Text("${f.title} · ${f.needsYou} need you") } } }
    }, confirmButton = { TextButton(onClick = { pickerOpen = false }) { Text("Close") } })
}
