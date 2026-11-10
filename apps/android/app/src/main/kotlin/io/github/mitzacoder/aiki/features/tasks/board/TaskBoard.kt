package io.github.mitzacoder.aiki.features.tasks.board

import android.os.SystemClock
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.gestures.detectDragGesturesAfterLongPress
import androidx.compose.foundation.gestures.scrollBy
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.foundation.relocation.BringIntoViewRequester
import androidx.compose.foundation.relocation.bringIntoViewRequester
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.draw.scale
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.boundsInRoot
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.semantics.*
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.github.mitzacoder.aiki.data.*
import io.github.mitzacoder.aiki.features.panels.panelData
import io.github.mitzacoder.aiki.features.tasks.looseWaiting
import io.github.mitzacoder.aiki.features.tasks.taskIdOrder
import io.github.mitzacoder.aiki.navigation.ProjectScreenContext
import io.github.mitzacoder.aiki.protocol.*
import io.github.mitzacoder.aiki.ui.components.Lucide
import io.github.mitzacoder.aiki.ui.components.LucideGlyph
import io.github.mitzacoder.aiki.ui.components.TaskStatusDot
import io.github.mitzacoder.aiki.ui.theme.Jarvis
import io.github.mitzacoder.aiki.ui.theme.TaskStatusTone
import io.github.mitzacoder.aiki.ui.theme.fade
import io.github.mitzacoder.aiki.ui.theme.mix
import io.github.mitzacoder.aiki.ui.theme.textStyle
import java.util.UUID
import kotlin.math.abs
import kotlin.math.ceil
import kotlin.math.hypot
import kotlin.math.min
import kotlin.math.sqrt
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonPrimitive

/** Below this width the board shows one column at a time, with the column names as tabs and a swipe between them. */
val ONE_COLUMN_BELOW: Dp = 640.dp

private data class Notice(val text: String, val error: Boolean, val undo: (() -> Unit)? = null, val at: Long = SystemClock.uptimeMillis())

/** Where a card was last laid out (in root coordinates) and, once its item left the screen, when. */
private data class CardSpot(val column: KanbanColumnId, val rect: Rect, val goneAt: Long? = null)

/** A copy of a card on its way to another column. */
private data class Glide(val card: KanbanCard, val from: Rect, val to: Rect)

/** What a drop here would do: the status, and in To do the card it goes before (null = last) and where the line shows. */
private data class DropSpot(val column: KanbanColumnId, val target: String?, val beforeId: String? = null, val lineY: Float? = null)

private class Drag(val card: KanbanCard, val grab: Offset, val width: Float, pointer: Offset) {
    var pointer by mutableStateOf(pointer)
    var over by mutableStateOf<DropSpot?>(null)
}

private fun tone(column: KanbanColumnId) = when (column) {
    KanbanColumnId.Todo -> TaskStatusTone.Todo
    KanbanColumnId.Working -> TaskStatusTone.Working
    KanbanColumnId.Blocked -> TaskStatusTone.Blocked
    KanbanColumnId.Review -> TaskStatusTone.Review
    KanbanColumnId.Waiting -> TaskStatusTone.Waiting
    KanbanColumnId.Done -> TaskStatusTone.Done
}

private val GLIDE_EASING = CubicBezierEasing(0.22f, 0.8f, 0.24f, 1f)

/**
 * The project's tasks as a board (web `TaskBoard.svelte`): one column per status, To do in the user's priority order
 * and the rest sorted by themselves. The user moves a card with its "Move to…" menu or, with every column on screen, by
 * holding it and dragging; every move is a save the server passes on to the coordinator as a `[board]` note. Moving a
 * task back from review asks why, and the agents get the answer with the move (as the save's note with `board-moves`,
 * else as a message about the task to main). When an agent moves a task, its card glides to its new column unless
 * animations are off. Narrower than [ONE_COLUMN_BELOW], one column shows at a time.
 *
 * [looseQuestion] draws a question or warning that names no task, which the board shows above the columns;
 * [addTask] draws the new-task editor (null hides "Add task").
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun TaskBoard(
    context: ProjectScreenContext,
    modifier: Modifier = Modifier,
    viewSwitch: @Composable () -> Unit = {},
    looseQuestion: @Composable (BoardQuestion) -> Unit,
    addTask: (@Composable (close: () -> Unit) -> Unit)? = null,
) {
    val board = context.board
    val view by board.view.collectAsStateWithLifecycle()
    val client = context.backend.client
    val connection by client.state.collectAsStateWithLifecycle()
    val canNote = connection.supports(HarnessFeature.BOARD_MOVES)
    val canSendReason = connection.supports("conversation")
    val project = context.route.projectId
    val workers = if (connection.supports("workers")) panelData(context, "board-workers", { it is WorkersStateEvent && it.projectId == project }) {
        client.request(WorkersListRequest(projectId = project)).workers
    }.value.orEmpty() else emptyList()
    val threads = if (connection.supports("threads")) panelData(context, "board-threads", { it is ThreadsStateEvent && it.projectId == project }) {
        client.request(ThreadsListRequest(projectId = project)).threads
    }.value.orEmpty() else emptyList()

    val colors = Jarvis.colors
    val density = LocalDensity.current
    val haptics = LocalHapticFeedback.current
    val reduced = rememberReducedMotion()
    val scope = rememberCoroutineScope()

    var now by remember { mutableLongStateOf(System.currentTimeMillis()) }
    LaunchedEffect(Unit) { while (true) { delay(30_000); now = System.currentTimeMillis() } }
    var onlyNeedsYou by rememberSaveable(project) { mutableStateOf(false) }
    var doneExpanded by rememberSaveable(project) { mutableStateOf(false) }
    var adding by rememberSaveable(project) { mutableStateOf(false) }
    /** Moves sent and not answered yet: the card shows in its new column at once. */
    val pending = remember { mutableStateMapOf<String, String>() }
    var notice by remember { mutableStateOf<Notice?>(null) }
    var asking by remember { mutableStateOf<MoveRequest?>(null) }

    fun withPending(tasks: List<BoardTask>) = if (pending.isEmpty()) tasks else tasks.map { task -> pending[task.id]?.let { task.copy(status = it) } ?: task }
    val tasks = withPending(view.tasks)
    val visibleTasks = io.github.mitzacoder.aiki.features.tasks.filteredTasks(context, tasks)
    val questions = view.questions
    val columns = remember(visibleTasks, questions, view.showArchived, doneExpanded, onlyNeedsYou) {
        kanbanColumns(visibleTasks, questions, view.showArchived, if (doneExpanded) Int.MAX_VALUE else DONE_SHOWN, onlyNeedsYou)
    }
    val needsYou = needsYouCount(visibleTasks, questions)
    val loose = if (view.board == null) emptyList() else looseWaiting(Board(tasks = tasks, questions = questions, decisions = emptyList(), updatedAt = null))
    val archivedShown = if (view.showArchived) tasks.count { it.archived } else 0
    val columnOf = remember(columns) { columns.flatMap { column -> column.cards.map { it.task.id to column.id } }.toMap() }
    val latestColumnOf by rememberUpdatedState(columnOf)

    LaunchedEffect(notice) {
        val shown = notice ?: return@LaunchedEffect
        delay(if (shown.error) 9_000 else 6_000)
        if (notice == shown) notice = null
    }
    fun say(text: String, error: Boolean = false, undo: (() -> Unit)? = null) { notice = Notice(text, error, undo) }

    // --- moves -----------------------------------------------------------------------------------------------------

    /** To do in priority order, whatever the filter shows: what a reorder sends. */
    fun todoIds() = withPending(board.view.value.tasks).filter { it.status == "todo" && !it.archived }
        .sortedWith(compareBy<BoardTask> { it.order }.thenComparing({ it.id }, taskIdOrder)).map { it.id }

    /** Puts a To do card before [beforeId] (last with null): the priority the coordinator works by. */
    suspend fun reorder(taskId: String, beforeId: String?) {
        if (beforeId == taskId) return
        val todo = todoIds()
        val rest = todo.filter { it != taskId }
        val index = if (beforeId == null) rest.size else maxOf(0, rest.indexOf(beforeId))
        val order = todoOrderWith(todo, taskId, index)
        if (order == todo) return
        board.reorder(order)?.let { say("Could not reorder: $it", error = true) }
    }

    suspend fun undoMove(moved: BoardTask, before: BoardTask) {
        notice = null
        pending[moved.id] = before.status
        val outcome = board.saveTask(moveInput(moved, "todo").copy(status = before.status, blockedReason = before.blockedReason, waitingFor = before.waiting?.note, waitUntil = before.waiting?.until), moved.id, moved.revision)
        pending.remove(moved.id)
        when (outcome) {
            is SaveOutcome.Conflict -> say("${moved.id} changed since; it was left where it is.", error = true)
            is SaveOutcome.Failed -> say("Could not undo: ${outcome.message}", error = true)
            is SaveOutcome.Saved -> Unit
        }
    }

    suspend fun commitMove(task: BoardTask, target: String, beforeId: String?, placed: Boolean, reason: String? = null, blockedReason: String? = null) {
        val note = reason?.trim()
        pending[task.id] = target
        val outcome = board.saveTask(moveInput(task, target, blockedReason), task.id, task.revision, note?.takeIf { canNote })
        pending.remove(task.id)
        val saved = when (outcome) {
            is SaveOutcome.Conflict -> return say("${task.id} changed while you moved it. It shows where it is now; try again if you still want it moved.", error = true)
            is SaveOutcome.Failed -> return say("Could not move ${task.id}: ${outcome.message}", error = true)
            is SaveOutcome.Saved -> outcome.task
        }
        if (note != null && !canNote && canSendReason) {
            try {
                // A backend older than board-moves takes no note: the reason goes to main as a message about the task.
                client.request(ConversationSubmitRequest(projectId = project, requestId = "submit-${UUID.randomUUID()}", content = JsonPrimitive(reasonMessage(note)), whenBusy = "steer", taskId = task.id))
            } catch (error: CancellationException) { throw error }
            catch (error: Exception) {
                return say("${task.id} moved, but your reason did not reach the coordinator: ${error.message}", error = true)
            }
        }
        if (target == "todo" && placed) reorder(task.id, beforeId)
        // A reason already went to the agents; taking the move back would leave them with half a story.
        val undo: (() -> Unit)? = if (note == null) { { scope.launch { undoMove(saved, task) } } } else null
        say(moveNotice(task.id, target), undo = undo)
    }

    /** Moves a card; [placed] puts it in To do before [beforeId] (last with null). A move that needs words asks first. */
    fun requestMove(task: BoardTask, target: String, beforeId: String? = null, placed: Boolean = false) {
        if (target == task.status) {
            if (target == "todo" && placed) scope.launch { reorder(task.id, beforeId) }
            return
        }
        val question = moveQuestion(task.status, target)
        if (question != MoveQuestion.None) {
            asking = MoveRequest(task, target, beforeId, placed, question)
            return
        }
        scope.launch { commitMove(task, target, beforeId, placed) }
    }

    /** The menu's priority moves, by place in the shown To do list. */
    fun reorderTo(card: KanbanCard, index: Int) {
        val shown = columns.first { it.id == KanbanColumnId.Todo }.cards.map { it.task.id }.filter { it != card.task.id }
        scope.launch { reorder(card.task.id, shown.getOrNull(index)) }
    }

    // --- where cards are: for the glide and for dragging -----------------------------------------------------------

    var boardBounds by remember { mutableStateOf(Rect.Zero) }
    val spots = remember { HashMap<String, CardSpot>() }
    val glides = remember { mutableStateListOf<Glide>() }
    /** Cards the user just dropped: they are already where the finger left them, so they do not glide. */
    val settledByHand = remember { HashSet<String>() }
    val columnBounds = remember { HashMap<KanbanColumnId, Rect>() }
    var droppedZone by remember { mutableStateOf<Rect?>(null) }
    var drag by remember { mutableStateOf<Drag?>(null) }
    val listStates = KanbanColumnId.entries.associateWith { rememberLazyListState() }
    val rowScroll = rememberScrollState()

    /**
     * A card laid out in [column]. One that changed column glides there: a copy flies over the board from its old place
     * to its new one while the card waits hidden. Reports from a card's old column (still leaving) are ignored.
     */
    fun cardPlaced(card: KanbanCard, column: KanbanColumnId, rect: Rect) {
        val id = card.task.id
        if (latestColumnOf[id] != column) return
        val old = spots[id]
        spots[id] = CardSpot(column, rect)
        if (old == null || old.column == column || reduced || drag != null || id in settledByHand) return
        if (old.goneAt != null && SystemClock.uptimeMillis() - old.goneAt > 700) return
        if (old.rect.width == 0f || !rect.overlaps(boardBounds)) return
        glides.removeAll { it.card.task.id == id }
        glides += Glide(card, old.rect, rect)
    }
    fun cardGone(id: String, column: KanbanColumnId) {
        spots[id]?.let { if (it.column == column && it.goneAt == null) spots[id] = it.copy(goneAt = SystemClock.uptimeMillis()) }
    }

    /** The column under the finger (the nearest one in a gap) and, in To do, where the card would go. */
    fun spotAt(point: Offset, dragged: String): DropSpot? {
        val slack = with(density) { 48.dp.toPx() }
        val best = columnBounds.entries.minByOrNull { (_, rect) ->
            if (point.x < rect.left) rect.left - point.x else if (point.x > rect.right) point.x - rect.right else 0f
        } ?: return null
        val rect = best.value
        val distance = if (point.x < rect.left) rect.left - point.x else if (point.x > rect.right) point.x - rect.right else 0f
        if (distance > slack) return null
        val column = best.key
        if (column == KanbanColumnId.Done) return DropSpot(column, dropTarget(column, droppedZone?.let { point.y >= it.top } == true))
        if (column != KanbanColumnId.Todo) return DropSpot(column, dropTarget(column))
        val items = spots.filter { (id, spot) -> spot.column == KanbanColumnId.Todo && spot.goneAt == null && id != dragged }.entries.sortedBy { it.value.rect.top }
        val gap = with(density) { 5.dp.toPx() }
        for ((id, spot) in items) if (point.y < spot.rect.center.y) return DropSpot(column, "todo", id, spot.rect.top - gap)
        return DropSpot(column, "todo", null, items.lastOrNull()?.value?.rect?.bottom?.plus(gap) ?: (rect.top + with(density) { 44.dp.toPx() }))
    }

    fun drop() {
        val ended = drag ?: return
        drag = null
        val over = ended.over ?: return
        val target = over.target ?: return
        val id = ended.card.task.id
        if (target != ended.card.task.status) {
            settledByHand += id
            scope.launch { delay(400); settledByHand -= id }
        }
        requestMove(ended.card.task, target, over.beforeId, placed = over.column == KanbanColumnId.Todo)
    }

    // Near an edge, scroll the columns sideways and the column under the finger up or down.
    LaunchedEffect(drag != null) {
        val edge = with(density) { 56.dp.toPx() }
        fun step(distance: Float) = ceil((edge - distance) / edge * 14f)
        while (true) {
            val current = drag ?: break
            withFrameNanos { }
            val (x, y) = current.pointer
            var moved = false
            if (x < boardBounds.left + edge && rowScroll.value > 0) { rowScroll.scrollBy(-step(maxOf(0f, x - boardBounds.left))); moved = true }
            else if (x > boardBounds.right - edge && rowScroll.value < rowScroll.maxValue) { rowScroll.scrollBy(step(maxOf(0f, boardBounds.right - x))); moved = true }
            val over = current.over?.column
            val list = over?.let { listStates[it] }
            val rect = over?.let { columnBounds[it] }
            if (list != null && rect != null) {
                if (y < rect.top + edge && y > rect.top - edge && list.canScrollBackward) { list.scrollBy(-step(maxOf(0f, y - rect.top))); moved = true }
                else if (y > rect.bottom - edge && y < rect.bottom + edge && list.canScrollForward) { list.scrollBy(step(maxOf(0f, rect.bottom - y))); moved = true }
            }
            if (moved) current.over = spotAt(current.pointer, current.card.task.id)
        }
    }

    // --- the card in a column ----------------------------------------------------------------------------------------

    val cardContent: @Composable (KanbanCard, Int, Int, Boolean, Modifier) -> Unit = { card, index, count, draggable, itemModifier ->
        val id = card.task.id
        val latestCard by rememberUpdatedState(card)
        DisposableEffect(id, card.column) { onDispose { cardGone(id, card.column) } }
        val hidden = glides.any { it.card.task.id == id }
        TaskCard(
            card, tasks, workers, threads, now,
            linksEnabled = connection.supports(HarnessFeature.TASK_LINKS),
            modifier = itemModifier
                .alpha(if (hidden) 0f else 1f)
                .onGloballyPositioned { cardPlaced(latestCard, latestCard.column, it.boundsInRoot()) }
                .pointerInput(id, draggable) {
                    if (!draggable) return@pointerInput
                    detectDragGesturesAfterLongPress(
                        onDragStart = { offset ->
                            val spot = spots[id] ?: return@detectDragGesturesAfterLongPress
                            haptics.performHapticFeedback(HapticFeedbackType.LongPress)
                            drag = Drag(latestCard, offset, spot.rect.width, spot.rect.topLeft + offset).also { it.over = spotAt(it.pointer, id) }
                        },
                        onDrag = { change, _ ->
                            change.consume()
                            val current = drag ?: return@detectDragGesturesAfterLongPress
                            val origin = spots[id]?.rect?.topLeft ?: return@detectDragGesturesAfterLongPress
                            current.pointer = origin + change.position
                            current.over = spotAt(current.pointer, id)
                        },
                        onDragEnd = { drop() },
                        onDragCancel = { drag = null },
                    )
                },
            onOpen = { context.openTask(id) },
            menu = {
                MoveMenu(
                    card.task,
                    if (card.column == KanbanColumnId.Todo) TodoPosition(index, count) else null,
                    onMove = { requestMove(card.task, it) },
                    onReorder = { reorderTo(card, it) },
                )
            },
            lifted = drag?.card?.task?.id == id,
            pulse = !reduced,
        )
    }

    BoxWithConstraints(modifier.fillMaxSize().onGloballyPositioned { boardBounds = it.boundsInRoot() }) {
        val oneColumn = maxWidth < ONE_COLUMN_BELOW
        val boardHeight = maxHeight
        val wide = maxWidth
        Column(Modifier.fillMaxSize()) {
            FlowRow(
                Modifier.fillMaxWidth().padding(top = 10.dp, bottom = 8.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalArrangement = Arrangement.spacedBy(6.dp),
                itemVerticalAlignment = Alignment.CenterVertically,
            ) {
                viewSwitch()
                if (needsYou > 0 || onlyNeedsYou) NeedsYouToggle(needsYou, onlyNeedsYou) { onlyNeedsYou = !onlyNeedsYou }
                Spacer(Modifier.weight(1f))
                TextButton(onClick = { scope.launch { board.setShowArchived(!view.showArchived) } }, contentPadding = PaddingValues(horizontal = 8.dp), modifier = Modifier.heightIn(min = 40.dp).semantics { selected = view.showArchived }) {
                    LucideGlyph(Lucide.Archive, size = 14.dp, tint = colors.fgMuted)
                    Spacer(Modifier.width(6.dp))
                    Text(if (view.showArchived) "Hide archived" + if (archivedShown > 0) " ($archivedShown)" else "" else "Show archived", style = textStyle(0.75f, 1.4f, weight = 500), color = colors.fgMuted)
                }
                if (addTask != null) TextButton(onClick = { adding = true }, contentPadding = PaddingValues(horizontal = 8.dp), modifier = Modifier.heightIn(min = 40.dp)) {
                    LucideGlyph(Lucide.Plus, size = 14.dp, tint = colors.fg)
                    Spacer(Modifier.width(6.dp))
                    Text("Add task", style = textStyle(0.75f, 1.4f, weight = 500), color = colors.fg)
                }
            }
            io.github.mitzacoder.aiki.features.tasks.TaskFilters(context, view.tasks)
            view.error?.let { error ->
                Surface(Modifier.fillMaxWidth().padding(bottom = 8.dp), shape = RoundedCornerShape(10.dp), color = colors.danger.fade(10f), contentColor = colors.danger) {
                    Text(error, Modifier.padding(horizontal = 12.dp, vertical = 8.dp), style = textStyle(0.8125f, 1.4f))
                }
            }
            if (loose.isNotEmpty()) {
                Column(
                    Modifier.fillMaxWidth().heightIn(max = boardHeight * 0.4f).verticalScroll(rememberScrollState()).padding(bottom = 8.dp)
                        .semantics { contentDescription = "Waiting for you, not about a task" },
                    verticalArrangement = Arrangement.spacedBy(6.dp),
                ) {
                    Row(Modifier.padding(horizontal = 4.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        Text("Waiting for you", style = textStyle(0.8125f, 1.4f, weight = 600), color = colors.accent2)
                        CountPill(loose.size, accent = true)
                    }
                    FlowRow(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp), maxItemsInEachRow = if (wide >= 1100.dp) 3 else if (wide >= 760.dp) 2 else 1) {
                        loose.forEach { question -> Box(Modifier.weight(1f)) { key(question.id) { looseQuestion(question) } } }
                    }
                }
            }
            if (oneColumn) {
                val pager = rememberPagerState { columns.size }
                Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(bottom = 8.dp).semantics { contentDescription = "Columns" }, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                    columns.forEachIndexed { index, column ->
                        val selected = pager.currentPage == index
                        val bring = remember { BringIntoViewRequester() }
                        LaunchedEffect(selected) { if (selected) bring.bringIntoView() }
                        ColumnTab(column, selected, Modifier.bringIntoViewRequester(bring)) {
                            scope.launch { if (reduced) pager.scrollToPage(index) else pager.animateScrollToPage(index) }
                        }
                    }
                }
                HorizontalPager(pager, Modifier.fillMaxWidth().weight(1f).padding(bottom = 12.dp), pageSpacing = 12.dp, key = { columns[it].id }) { page ->
                    val column = columns[page]
                    ColumnPanel(column, view.loaded, onlyNeedsYou, oneColumn = true, listStates.getValue(column.id), reduced, drag = null, onShowMore = { doneExpanded = true }, onBounds = {}, onDroppedZone = {}, modifier = Modifier.fillMaxSize()) { card, index, count, itemModifier ->
                        cardContent(card, index, count, false, itemModifier)
                    }
                }
            } else {
                val gap = 12.dp
                val width = ((wide - gap * 4) / 5).coerceIn(224.dp, 384.dp)
                Row(Modifier.fillMaxWidth().weight(1f).horizontalScroll(rowScroll).padding(bottom = 12.dp), horizontalArrangement = Arrangement.spacedBy(gap)) {
                    columns.forEach { column ->
                        ColumnPanel(
                            column, view.loaded, onlyNeedsYou, oneColumn = false, listStates.getValue(column.id), reduced, drag,
                            onShowMore = { doneExpanded = true },
                            onBounds = { columnBounds[column.id] = it },
                            onDroppedZone = { droppedZone = it },
                            modifier = Modifier.width(width).fillMaxHeight(),
                        ) { card, index, count, itemModifier -> cardContent(card, index, count, true, itemModifier) }
                    }
                }
            }
            // Below every column; a long list scrolls in its own box instead of taking the board's height.
            if (view.loaded) Box(Modifier.fillMaxWidth().heightIn(max = boardHeight * 0.35f).verticalScroll(rememberScrollState()).padding(bottom = 8.dp)) {
                io.github.mitzacoder.aiki.features.tasks.LooseWorkers(context, tasks)
            }
        }

        // The overlay: drop line, gliding copies, the dragged card and the notice.
        drag?.let { current ->
            val over = current.over
            val rect = over?.let { columnBounds[it.column] }
            if (over?.column == KanbanColumnId.Todo && over.lineY != null && rect != null) {
                val inset = with(density) { 8.dp.toPx() }
                Box(
                    Modifier
                        .offset { IntOffset((rect.left + inset - boardBounds.left).toInt(), (over.lineY - boardBounds.top).toInt()) }
                        .size(with(density) { (rect.width - inset * 2).toDp() }, 2.dp)
                        .background(colors.accent2, RoundedCornerShape(1.dp)),
                )
            }
            Box(
                Modifier
                    .offset { IntOffset((current.pointer.x - current.grab.x - boardBounds.left).toInt(), (current.pointer.y - current.grab.y - boardBounds.top).toInt()) }
                    .width(with(density) { current.width.toDp() })
                    .then(if (reduced) Modifier else Modifier.rotate(1.5f).scale(1.02f))
                    .shadow(12.dp, RoundedCornerShape(12.dp)),
            ) {
                TaskCard(current.card, tasks, workers, threads, now, ghost = true, pulse = false, linksEnabled = connection.supports(HarnessFeature.TASK_LINKS))
            }
        }
        glides.toList().forEach { glide ->
            key(glide.card.task.id, glide.from) {
                GlidingCard(glide, boardBounds, onLanded = { glides.remove(glide) }) {
                    TaskCard(glide.card, tasks, workers, threads, now, ghost = true, pulse = false, linksEnabled = connection.supports(HarnessFeature.TASK_LINKS))
                }
            }
        }
        notice?.let { shown ->
            Snackbar(
                Modifier.align(Alignment.BottomCenter).padding(12.dp).widthIn(max = 560.dp).semantics { liveRegion = if (shown.error) LiveRegionMode.Assertive else LiveRegionMode.Polite },
                action = shown.undo?.let { undo -> { TextButton(onClick = undo) { Text("Undo") } } },
                dismissAction = { IconButton(onClick = { notice = null }) { LucideGlyph(Lucide.X, size = 16.dp, contentDescription = "Dismiss") } },
                containerColor = if (shown.error) MaterialTheme.colorScheme.errorContainer else SnackbarDefaults.color,
                contentColor = if (shown.error) MaterialTheme.colorScheme.onErrorContainer else SnackbarDefaults.contentColor,
                dismissActionContentColor = if (shown.error) MaterialTheme.colorScheme.onErrorContainer else SnackbarDefaults.dismissActionContentColor,
            ) { Text(shown.text) }
        }
    }

    asking?.let { request ->
        MoveDialog(request, onDismiss = { asking = null }) { text ->
            asking = null
            scope.launch {
                commitMove(
                    request.task, request.target, request.beforeId, request.placed,
                    reason = text.takeIf { request.question == MoveQuestion.Reason },
                    blockedReason = text.takeIf { request.question == MoveQuestion.BlockedReason },
                )
            }
        }
    }
    if (adding && addTask != null) addTask { adding = false }
}

/** A copy of a card flying from its old column to its new one; the duration grows with the distance, like the web's. */
@Composable
private fun GlidingCard(glide: Glide, board: Rect, onLanded: () -> Unit, content: @Composable () -> Unit) {
    val density = LocalDensity.current
    val progress = remember { Animatable(0f) }
    LaunchedEffect(Unit) {
        val distance = with(density) { hypot(glide.to.left - glide.from.left, glide.to.top - glide.from.top).toDp().value }
        progress.animateTo(1f, tween(min(560, (220 + sqrt(distance) * 10).toInt()), easing = GLIDE_EASING))
        onLanded()
    }
    val p = progress.value
    val x = glide.from.left + (glide.to.left - glide.from.left) * p - board.left
    val y = glide.from.top + (glide.to.top - glide.from.top) * p - board.top
    val width = glide.from.width + (glide.to.width - glide.from.width) * p
    Box(Modifier.offset { IntOffset(x.toInt(), y.toInt()) }.width(with(density) { width.toDp() }).shadow(10.dp, RoundedCornerShape(12.dp))) { content() }
}

@Composable
private fun NeedsYouToggle(count: Int, on: Boolean, onClick: () -> Unit) {
    val colors = Jarvis.colors
    Surface(
        onClick = onClick,
        shape = CircleShape,
        color = if (on) colors.accent2.fade(15f) else colors.bg.fade(0f),
        border = androidx.compose.foundation.BorderStroke(1.dp, if (on) colors.accent2 else colors.accent2.fade(35f)),
        modifier = Modifier.heightIn(min = 32.dp).semantics {
            selected = on
            stateDescription = if (on) "Showing only what needs you" else "Showing every task"
        },
    ) {
        Row(Modifier.padding(horizontal = 10.dp, vertical = 6.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            Text("Needs you", style = textStyle(0.75f, 1.4f, weight = 600), color = colors.accent2)
            Box(Modifier.defaultMinSize(minWidth = 16.dp).background(colors.accent2, CircleShape).padding(horizontal = 4.dp), contentAlignment = Alignment.Center) {
                Text("$count", style = textStyle(0.625f, 1.6f, weight = 600), color = androidx.compose.ui.graphics.Color.White)
            }
        }
    }
}

@Composable
private fun CountPill(count: Int, accent: Boolean = false) {
    val colors = Jarvis.colors
    Box(Modifier.background(if (accent) colors.accent2.fade(15f) else colors.surface2, CircleShape).padding(horizontal = 6.dp)) {
        Text("$count", style = textStyle(0.6875f, 16f / 11f, weight = 500), color = if (accent) colors.accent2 else colors.fgSubtle)
    }
}

@Composable
private fun ColumnTab(column: KanbanColumn, selected: Boolean, modifier: Modifier, onClick: () -> Unit) {
    val colors = Jarvis.colors
    Surface(
        onClick = onClick,
        shape = CircleShape,
        color = if (selected) colors.surface2 else colors.bg.fade(0f),
        modifier = modifier.heightIn(min = 36.dp).semantics { role = Role.Tab; this.selected = selected },
    ) {
        Row(Modifier.padding(horizontal = 10.dp, vertical = 6.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            TaskStatusDot(tone(column.id))
            Text(column.label, style = textStyle(0.75f, 1.4f, weight = 600), color = if (selected) colors.fg else colors.fgSubtle)
            Text("${column.total}", Modifier.alpha(.7f), style = textStyle(0.75f, 1.4f, weight = 600), color = if (selected) colors.fg else colors.fgSubtle)
        }
    }
}

@Composable
private fun ColumnPanel(
    column: KanbanColumn,
    loaded: Boolean,
    onlyNeedsYou: Boolean,
    oneColumn: Boolean,
    listState: LazyListState,
    reduced: Boolean,
    drag: Drag?,
    onShowMore: () -> Unit,
    onBounds: (Rect) -> Unit,
    onDroppedZone: (Rect) -> Unit,
    modifier: Modifier,
    card: @Composable (KanbanCard, Int, Int, Modifier) -> Unit,
) {
    val colors = Jarvis.colors
    val status = colors.taskStatus(tone(column.id))
    val dragging = drag != null
    val over = drag?.over?.column == column.id
    val refusing = dragging && column.id in setOf(KanbanColumnId.Review, KanbanColumnId.Waiting)
    val highlighted = drag != null && over && !refusing && drag.over?.target != drag.card.task.status
    val shape = RoundedCornerShape(16.dp)
    Box(
        modifier
            .clip(shape)
            .background(if (highlighted) status.mix(colors.bg, 7f) else colors.surface.fade(45f))
            .border(1.dp, if (highlighted) status.fade(55f) else colors.border.fade(55f), shape)
            .onGloballyPositioned { onBounds(it.boundsInRoot()) }
            .semantics { contentDescription = "${column.label}, ${column.total} ${if (column.total == 1) "task" else "tasks"}" },
    ) {
        Column(Modifier.fillMaxSize().alpha(if (refusing) .45f else 1f)) {
            if (!oneColumn) {
                Row(Modifier.padding(start = 12.dp, end = 12.dp, top = 10.dp, bottom = 6.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    TaskStatusDot(tone(column.id))
                    Text(column.label, style = textStyle(0.8125f, 1.4f, weight = 600), color = colors.fg)
                    CountPill(column.total)
                }
            }
            LazyColumn(
                Modifier.weight(1f).fillMaxWidth(),
                state = listState,
                contentPadding = PaddingValues(start = 8.dp, end = 8.dp, top = 4.dp, bottom = 8.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                itemsIndexed(column.cards, key = { _, entry -> entry.task.id }) { index, entry ->
                    card(entry, index, column.cards.size, Modifier.animateItem(fadeInSpec = null, placementSpec = if (reduced) null else tween(220), fadeOutSpec = null))
                }
                if (!loaded) items(3) { index -> CardSkeleton(index) }
                else if (column.cards.isEmpty() && !(over && column.id != KanbanColumnId.Done)) item {
                    Text(if (onlyNeedsYou) "Nothing here needs you." else column.empty, Modifier.padding(horizontal = 8.dp, vertical = 12.dp), style = textStyle(0.75f, 1.4f), color = colors.fgSubtle)
                }
            }
            if (column.id == KanbanColumnId.Done && column.hidden > 0) {
                TextButton(onClick = onShowMore, modifier = Modifier.padding(horizontal = 8.dp).padding(bottom = 4.dp)) {
                    Text("Show ${column.hidden} more", style = textStyle(0.75f, 1.4f), color = colors.fgSubtle)
                }
            }
        }
        if (refusing) {
            DashedZone(colors.borderStrong.fade(80f), Modifier.fillMaxSize().padding(start = 8.dp, end = 8.dp, top = 40.dp, bottom = 8.dp)) {
                Text("Agents put tasks here when they are ready for you.", Modifier.padding(16.dp), style = textStyle(0.75f, 1.4f), color = colors.fgMuted, textAlign = TextAlign.Center)
            }
        }
        if (dragging && column.id == KanbanColumnId.Done) {
            // While a card is dragged, Done splits in two: close it as done, or drop it.
            Column(Modifier.fillMaxSize().padding(start = 8.dp, end = 8.dp, top = 40.dp, bottom = 8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                val target = if (over) drag.over?.target else null
                DropZone("Done", Lucide.Check, colors.taskStatus(TaskStatusTone.Done), target == "done", Modifier.weight(1f).fillMaxWidth())
                DropZone("Dropped", BoardGlyphs.Ban, colors.fgSubtle, target == "dropped", Modifier.weight(1f).fillMaxWidth().onGloballyPositioned { onDroppedZone(it.boundsInRoot()) })
            }
        }
    }
}

@Composable
private fun DropZone(label: String, icon: io.github.mitzacoder.aiki.ui.components.LucideIcon, tint: androidx.compose.ui.graphics.Color, over: Boolean, modifier: Modifier) {
    val colors = Jarvis.colors
    DashedZone(if (over) tint else tint.fade(55f), modifier.background(colors.bg.mix(tint, if (over) 72f else 88f), RoundedCornerShape(14.dp)), solid = over) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            LucideGlyph(icon, size = 16.dp, tint = if (label == "Dropped") colors.fgMuted else tint)
            Text(label, style = textStyle(0.8125f, 1.4f, weight = 600), color = if (label == "Dropped") colors.fgMuted else tint)
        }
    }
}

@Composable
private fun DashedZone(color: androidx.compose.ui.graphics.Color, modifier: Modifier, solid: Boolean = false, content: @Composable () -> Unit) {
    val colors = Jarvis.colors
    Box(
        modifier
            .background(if (solid) androidx.compose.ui.graphics.Color.Transparent else colors.bg.fade(70f), RoundedCornerShape(14.dp))
            .drawBehind {
                val stroke = 1.5.dp.toPx()
                drawRoundRect(
                    color,
                    topLeft = Offset(stroke / 2, stroke / 2),
                    size = androidx.compose.ui.geometry.Size(size.width - stroke, size.height - stroke),
                    cornerRadius = CornerRadius(14.dp.toPx()),
                    style = Stroke(stroke, pathEffect = if (solid) null else PathEffect.dashPathEffect(floatArrayOf(6.dp.toPx(), 4.dp.toPx()))),
                )
            },
        contentAlignment = Alignment.Center,
    ) { content() }
}

@Composable
private fun CardSkeleton(index: Int) {
    val colors = Jarvis.colors
    Column(Modifier.fillMaxWidth().border(1.dp, colors.border.fade(70f), RoundedCornerShape(12.dp)).padding(12.dp).clearAndSetSemantics { }, verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Box(Modifier.fillMaxWidth(if (index == 1) .66f else .8f).height(14.dp).background(colors.surface2, RoundedCornerShape(4.dp)))
        Box(Modifier.fillMaxWidth(.92f).height(12.dp).background(colors.surface2, RoundedCornerShape(4.dp)))
        Box(Modifier.align(Alignment.End).width(48.dp).height(10.dp).background(colors.surface2, RoundedCornerShape(4.dp)))
    }
}
