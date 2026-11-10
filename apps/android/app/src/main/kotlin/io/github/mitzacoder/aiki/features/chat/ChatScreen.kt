package io.github.mitzacoder.aiki.features.chat

import io.github.mitzacoder.aiki.features.notifications.LocalNotificationCenter
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.*
import androidx.compose.foundation.gestures.scrollBy
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.animation.EnterTransition
import androidx.compose.animation.ExitTransition
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.animation.scaleOut
import androidx.compose.animation.animateColorAsState
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.animation.core.tween
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.content.contentReceiver
import androidx.compose.foundation.text.input.InputTransformation
import androidx.compose.foundation.text.input.TextFieldBuffer
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.key.*
import androidx.compose.ui.text.TextRange
import androidx.compose.ui.text.withLink
import androidx.compose.ui.text.input.TextFieldValue
import io.github.mitzacoder.aiki.features.tasks.*
import io.github.mitzacoder.aiki.navigation.ChatHighlight
import androidx.compose.ui.Modifier
import androidx.compose.ui.Alignment
import io.github.mitzacoder.aiki.ui.components.*
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.github.mitzacoder.aiki.data.*
import io.github.mitzacoder.aiki.navigation.Destination
import io.github.mitzacoder.aiki.navigation.ProjectScreenContext
import io.github.mitzacoder.aiki.navigation.modelLabel
import io.github.mitzacoder.aiki.features.status.BannerTone
import io.github.mitzacoder.aiki.features.status.ToneBanner
import io.github.mitzacoder.aiki.ui.theme.Jarvis
import io.github.mitzacoder.aiki.protocol.*
import kotlinx.coroutines.*
import kotlinx.serialization.json.*

@OptIn(androidx.compose.foundation.ExperimentalFoundationApi::class)
@Composable
fun ChatScreen(context: ProjectScreenContext, modifier: Modifier = Modifier) {
    val artifacts = rememberTranscriptArtifacts(context)
    val watch = remember(context.backend.client, context.target) { ConversationWatch(context.backend.client, context.target) }
    DisposableEffect(watch) { onDispose { watch.close() } }
    val state by watch.state.collectAsStateWithLifecycle()
    val connection by context.backend.client.state.collectAsStateWithLifecycle()
    val scope = rememberCoroutineScope()
    val android = LocalContext.current
    // What the composer holds (text, task, quotes, images) is the chat's draft: kept on this device and on the backend.
    val chatDraft = rememberChatDraft(context)
    // Typing on the soft keyboard never reaches the activity's key dispatch; the field says it instead.
    val notificationCenter = LocalNotificationCenter.current
    var draftValue by chatDraft::value
    val draft = draftValue.text
    fun setDraft(text: String) { draftValue = TextFieldValue(text,TextRange(text.length)) }
    // A message can be about one board task (main's chat only) and carry quotes from the transcript.
    var taskId by chatDraft::taskId
    var quotes by chatDraft::quotes
    var openQuote by remember(context.route) { mutableStateOf<Int?>(null) }
    var pickerListOpen by remember(context.route) { mutableStateOf(false) }
    var trigger by remember(context.route) { mutableStateOf<HashTrigger?>(null) }
    var dismissedAt by remember(context.route) { mutableStateOf<Int?>(null) }
    val admissionScope = "${context.backend.config.key}|${context.route.projectId}|${context.route.threadId ?: "main"}"
    val images = chatDraft.images
    var submitting by remember(context.route) { mutableStateOf(false) }
    var attaching by remember(context.route) { mutableStateOf(false) }
    var error by remember(context.route) { mutableStateOf<String?>(null) }
    // Persist identity before sending. An ambiguous response never authorizes a new UUID.
    var pendingSaved by rememberSaveable(admissionScope) { mutableStateOf<String?>(null) }
    val pending = remember(pendingSaved) { PendingAdmission.restore(pendingSaved) }
    var discardPending by remember { mutableStateOf(false) }
    val retryMatches = remember(pendingSaved,pending,draft,images,admissionScope,taskId,quotes) { pendingSaved == null || pending?.canRetry(admissionScope,draft,chatDraft.imageBlocks(),taskId,quotes) == true }
    var workerDefaults by remember(context.route) { mutableStateOf(WorkerDefaults(null,null)) }
    // Pictures come from the attach button's picker, a paste (long press or keyboard) and the keyboard's own images.
    val intake = rememberImageIntake { files ->
        attaching = true
        try {
            val cache = io.github.mitzacoder.aiki.data.DraftCache.of(android)
            val problem = attachFiles(files) { image -> chatDraft.attach(cache,image.bytes,image.mimeType,image.name) }
            error = problem
        } finally { attaching = false }
    }
    LaunchedEffect(state.entries.lastOrNull()?.id) {
        state.entries.lastOrNull { it.kind == "pi.assistant" }?.let { context.repository.markSeen(context.backend.config.key, context.route.projectId, it.id) }
    }
    var threads by remember(context.route) { mutableStateOf<List<ThreadSummary>>(emptyList()) }
    var threadsRevision by remember(context.route) { mutableIntStateOf(0) }
    LaunchedEffect(context.backend.client,context.route) {
        context.backend.client.events.collect { event -> if(event is ThreadsStateEvent && event.projectId == context.route.projectId) { threadsRevision++; threads = event.threads } }
    }
    LaunchedEffect(connection,context.route) {
        if(connection.status == ConnectionStatus.Ready && connection.supports("threads")) {
            val revision = threadsRevision
            try {
                val loaded = context.backend.client.request(ThreadsListRequest(projectId = context.route.projectId,includeArchived = true)).threads
                if(revision == threadsRevision) threads = loaded
            } catch(e: CancellationException) { throw e }
            catch(_: Exception) { /* Retain transcript IDs when the optional live names are unavailable. */ }
        }
    }
    var workers by remember(context.route) { mutableStateOf<List<WorkerSummary>>(emptyList()) }
    var workersLoaded by remember(context.route) { mutableStateOf(false) }
    var workersRevision by remember(context.route) { mutableIntStateOf(0) }
    LaunchedEffect(context.backend.client,context.route) {
        context.backend.client.events.collect { event -> if(event is WorkersStateEvent && event.projectId == context.route.projectId) { workersRevision++; workers = event.workers; workersLoaded = true } }
    }
    LaunchedEffect(connection,context.route) {
        if(connection.status == ConnectionStatus.Ready && connection.supports("workers")) {
            val revision = workersRevision
            runCatching { context.backend.client.request(WorkersListRequest(projectId = context.route.projectId)).workers }.onSuccess { if(revision == workersRevision) { workers = it; workersLoaded = true } }
        }
    }
    var scheduleTitles by remember(context.route) { mutableStateOf<Map<String,String>>(emptyMap()) }
    LaunchedEffect(connection.status,context.route,workers.any { it.scheduleId != null }) {
        // Only a worker a schedule started needs the schedule's name.
        if(connection.status == ConnectionStatus.Ready && connection.supports("schedules") && workers.any { it.scheduleId != null })
            runCatching { context.backend.client.request(SchedulesListRequest(projectId = context.route.projectId)).schedules }.onSuccess { list -> scheduleTitles = list.associate { it.id to it.title } }
    }
    val rows = remember(state.entries, state.view) { transcript(state.entries, state.view?.docs?.get("pi.live"), state.view?.keepWarm.orEmpty()) }
    val realRows = remember(rows) { rows.filter { it.parts.firstOrNull()?.kind != "cacheWarm" } }
    val titlesBefore = remember(rows,workers) { workerTitlesBeforeSend(rows,workers) }
    val lineRows = remember(rows) { rows.map(::isTaskLineRow) }
    val taskLinks = LocalTaskLinks.current
    val boardView by context.board.view.collectAsStateWithLifecycle()
    val onMain = context.route.workerId == null && sameThread(context.route.threadId,null)
    /** What the `#` picker offers; null hides it (a thread's chat, no board, a server without task reports). */
    val taskChoicesSource = if(onMain && taskLinks != null) remember(boardView.tasks) { taskOptions(boardView.tasks) } else null
    LaunchedEffect(context.route) {
        ComposerQuotes.pending.collect { quote -> if(quote.route == context.route.copy(highlight = null)) { quotes = quotes + quote.text; openQuote = null } }
    }
    val busy = state.view?.docs?.get("pi.live").obj()?.get("run") != null
    // The run is on but no reply streams yet: the transcript ends in "Working…".
    val working = isWorking(state.view?.docs?.get("pi.live"),worker = context.route.workerId != null)
    val orbs = if(showsTurnOrbs()) remember(rows) { turnOrbs(rows) } else null
    // Rows that arrive while the chat is open rise in, as on the web; never with animations off.
    val reducedMotion = rememberReducedMotion()
    val live = state.status == WatchStatus.Live
    val shown = remember(context.route) { ShownRows() }
    val arrived = remember(rows,live) { if(live) arrivedRows(shown.keys,realRows.map { it.key }) else emptySet() }
    SideEffect { if(live) shown.keys = rows.map { it.key } }
    val projects by context.backend.projects.collectAsStateWithLifecycle()
    val list = rememberLazyListState()
    var follow by remember(context.route) { mutableStateOf(true) }
    LaunchedEffect(list) { snapshotFlow { list.isScrollInProgress to list.canScrollForward }.collect { (scrolling,canScroll) -> if(scrolling) follow = !canScroll } }
    // A link to a spot (`#entry-N`, a thread's newest card) scrolls there once and flashes the row.
    var highlightDone by remember(context.highlight) { mutableStateOf(false) }
    var flashKey by remember { mutableStateOf<String?>(null) }
    val earlierRow = state.canLoadEarlier || state.loadingEarlier || state.earlierError != null
    LaunchedEffect(context.highlight,rows,state.canLoadEarlier,state.loadingEarlier,state.earlierError) {
        val target = context.highlight ?: return@LaunchedEffect
        if(highlightDone || rows.isEmpty()) return@LaunchedEffect
        val index = highlightIndex(rows,target)
        if(index < 0) {
            if(target is ChatHighlight.Entry && state.canLoadEarlier && !state.loadingEarlier && state.earlierError == null) {
                follow = false
                // Do not cancel the page when its own loading state restarts this highlight effect.
                scope.launch { watch.loadEarlier() }
            }
            return@LaunchedEffect
        }
        highlightDone = true
        follow = false
        list.scrollToItem(index + if(earlierRow) 1 else 0)
        flashKey = rows[index].key
        delay(1600)
        flashKey = null
    }
    LaunchedEffect(realRows,working) {
        if(context.highlight != null && !highlightDone) return@LaunchedEffect
        if(follow && rows.isNotEmpty() && !state.loadingEarlier) {
            // Keys preserve the visual anchor when prepending history; only tail-follow scrolls.
            list.scrollToEnd((rows.size - 1 + (if(earlierRow) 1 else 0) + (if(working) 1 else 0)).coerceAtLeast(0))
        }
    }
    val highlighting by rememberUpdatedState(context.highlight != null && !highlightDone)
    // Stable transcript keys let LazyColumn retain the visible row and offset during prepend, including flings.
    // Collect (not collectLatest): a request must survive changes to loading/index while it is in flight.
    LaunchedEffect(watch,list) {
        snapshotFlow {
            (shouldPrefetchEarlier(list.firstVisibleItemIndex,list.layoutInfo.visibleItemsInfo.isNotEmpty(),
                state.canLoadEarlier,state.loadingEarlier,state.earlierError != null,follow,list.canScrollForward,
                highlighting) && state.status == WatchStatus.Live) to state.entries.firstOrNull()?.id
        }.collect { (prefetch,_) -> if(prefetch) watch.loadEarlier() }
    }
    val cacheWarmAtTail by rememberUpdatedState(rows.lastOrNull()?.parts?.firstOrNull()?.kind == "cacheWarm")
    // A row that grows at the end (a reply arriving, a compaction's saved memories) keeps the end in view while following.
    LaunchedEffect(list) {
        snapshotFlow { list.canScrollForward }.collect { more ->
            if(more && !cacheWarmAtTail && follow && !list.isScrollInProgress && (context.highlight == null || highlightDone)) list.scrollToEnd(list.layoutInfo.totalItemsCount - 1)
        }
    }
    ChatBackdrop(modifier) {
    Column(Modifier.widthIn(max = 960.dp).fillMaxSize().align(Alignment.TopCenter).imePadding()) {
        val activeThread = threads.find { it.id == context.route.threadId }
        val activeWorker = workers.find { it.id == context.route.workerId && sameThread(it.threadId,context.route.threadId) }
        val models by context.backend.models.collectAsStateWithLifecycle()
        val thread = !sameThread(context.route.threadId,null)
        val project = projects.firstOrNull { it.id == context.route.projectId }
        val chatAllowed = canChat(project,thread)
        val ready = connection.status == ConnectionStatus.Ready
        /** The banners: the missing model, the transcript's state, a worker gone or failed, errors (web order). */
        @Composable fun ChatBanners() = Column(Modifier.fillMaxWidth().padding(horizontal = 12.dp),verticalArrangement = Arrangement.spacedBy(6.dp)) {
            if(context.route.workerId == null && !thread && project != null && project.coordinator.model == null && connection.supports("models"))
                NoCoordinatorBanner { context.navigate(Destination.ProjectSettings(context.route, io.github.mitzacoder.aiki.features.settings.ProjectSection.Coordinator)) }
            transcriptBanner(state.status,state.error,worker = context.route.workerId != null)?.let { text ->
                ToneBanner(BannerTone.Warning) { Text(text,style = MaterialTheme.typography.bodySmall) }
            }
            if(context.route.workerId != null && workersLoaded && activeWorker == null) ToneBanner(BannerTone.Warning) {
                Text("Worker \"${context.route.workerId}\" is not in this project's list any more; its transcript is only history.",style = MaterialTheme.typography.bodySmall)
            }
            if(activeWorker?.status == "failed") activeWorker.failure?.let { failure -> ToneBanner(BannerTone.Error) { Text(failure,style = MaterialTheme.typography.bodySmall) } }
            error?.let { ToneBanner(BannerTone.Error) { Text(it,style = MaterialTheme.typography.bodySmall) } }
        }
        // A worker's facts and banners under the header (web `WorkerTranscript`); its title and a way back are in the header.
        if(context.route.workerId != null) {
            activeWorker?.let { WorkerFacts(it,models,Modifier.padding(horizontal = 16.dp,vertical = 4.dp)) }
            ChatBanners()
        }
        val transcriptScope = TranscriptScope(context,workers,artifacts,threads,titlesBefore,scheduleTitles)
        val onQuote: ((String) -> Unit)? = if(context.route.workerId == null) ({ quote -> quotes = quotes + quote; openQuote = null }) else null
        // Only the transcript owns the overlay: banners, question pin and composer stay outside it.
        Box(Modifier.weight(1f).fillMaxWidth()) {
        CompositionLocalProvider(LocalQuoteHandler provides onQuote) {
        if(rows.isEmpty() && state.status == WatchStatus.Live && !state.canLoadEarlier && context.route.workerId == null) {
            if(sameThread(context.route.threadId,null)) ChatEmptyState(projects.firstOrNull { it.id == context.route.projectId }?.name ?: "Ready",
                "Send a message to start the coordinator. It plans, delegates and reviews.",Modifier.fillMaxSize().padding(16.dp))
            else ChatEmptyState(activeThread?.title?.takeIf(String::isNotEmpty) ?: "Background thread",
                "A background thread of main. It reports to main when it finishes; type here to steer it directly.",Modifier.fillMaxSize().padding(16.dp))
        } else LazyColumn(Modifier.fillMaxSize(),state = list,contentPadding = PaddingValues(16.dp)) {
            if (earlierRow) item(key = "earlier") {
                Box(Modifier.fillMaxWidth().heightIn(min = 32.dp),contentAlignment = Alignment.Center) {
                    if(state.loadingEarlier) CircularProgressIndicator(Modifier.size(16.dp),strokeWidth = 2.dp)
                    else if(state.earlierError != null) TextButton(onClick = { scope.launch { watch.loadEarlier() } }) {
                        Text("Couldn't load earlier messages · Retry",style = MaterialTheme.typography.bodySmall)
                    }
                }
            }
            if (rows.isEmpty()) item { Text(if (state.status == WatchStatus.Live) "Nothing here yet." else "Connecting…",color = Jarvis.colors.fgMuted) }
            itemsIndexed(rows, key = { _,row -> row.key }) { index,row ->
                // Task lines that follow each other sit close together; everything else keeps the chat's rhythm.
                val gap = when { index == 0 -> 0.dp; lineRows[index] && lineRows[index - 1] -> 6.dp; else -> 16.dp }
                val flash by animateColorAsState(if(flashKey == row.key) Jarvis.colors.accent2.copy(alpha = .14f) else Color.Transparent,tween(400),label = "highlight")
                // Decided when the row first shows, so it rises once and not again when scrolled back into view.
                val rises = remember(row.key) { row.key in arrived }
                Box(Modifier.riseIn(rises && !reducedMotion).padding(top = gap).clip(RoundedCornerShape(12.dp)).background(flash)) {
                    TranscriptRow(row,transcriptScope,streaming = busy && index == rows.lastIndex,orb = orbs?.get(index))
                }
            }
            if(working) item(key = "working") { WorkingRow(Modifier.riseIn(!reducedMotion).padding(top = if(rows.isEmpty()) 0.dp else 16.dp)) }
        }
        }
        androidx.compose.animation.AnimatedVisibility(
            visible = !follow && rows.isNotEmpty(),
            modifier = Modifier.align(Alignment.BottomCenter).padding(bottom = 8.dp),
            enter = if(reducedMotion) EnterTransition.None else fadeIn(tween(140)) + scaleIn(tween(140),initialScale = .85f),
            exit = if(reducedMotion) ExitTransition.None else fadeOut(tween(120)) + scaleOut(tween(120),targetScale = .85f),
        ) {
            // 40dp visible circle inside an explicit 48dp touch target. No opaque elevation tint or background blur.
            IconButton(
                onClick = { follow = true; scope.launch { list.scrollToEnd(list.layoutInfo.totalItemsCount - 1) } },
                modifier = Modifier.size(48.dp),
            ) {
                Surface(
                    modifier = Modifier.size(40.dp),
                    shape = CircleShape,
                    color = Jarvis.colors.surface.copy(alpha = .65f),
                    contentColor = Jarvis.colors.fg,
                    border = BorderStroke(1.dp,Jarvis.colors.border),
                    shadowElevation = 4.dp,
                ) {
                    Box(contentAlignment = Alignment.Center) {
                        LucideGlyph(Lucide.ArrowDown,contentDescription = "Jump to latest")
                    }
                }
            }
        }
        }
        // Banners above the composer, in the web's order: the server's, the missing model, the transcript's state, errors.
        if(context.route.workerId == null) {
            io.github.mitzacoder.aiki.features.status.ChatServerBanners(context)
            ChatBanners()
        }
        if (context.route.workerId == null) {
            BoardQuestionPin(context)
            val pickerOpen = taskChoicesSource != null && (pickerListOpen || trigger != null)
            fun closePicker() { trigger?.let { dismissedAt = it.start }; trigger = null; pickerListOpen = false }
            fun syncTrigger(value: TextFieldValue) {
                val found = if(taskChoicesSource == null) null else hashTrigger(value.text,value.selection.start)
                if(found == null) dismissedAt = null
                trigger = found?.takeIf { it.start != dismissedAt }
            }
            fun pick(option: TaskOption) {
                taskId = option.id
                // Read the field as it is now: the `#query` it holds, wherever the caret left it.
                val current = draftValue
                val found = hashTrigger(current.text,current.selection.start) ?: trigger?.takeIf { it.start + 1 + it.query.length <= current.text.length }
                found?.let { val rest = withoutTrigger(current.text,it); draftValue = TextFieldValue(rest.text,TextRange(rest.caret)) }
                trigger = null; dismissedAt = null; pickerListOpen = false
            }
            BackHandler(enabled = pickerOpen) { closePicker() }
            if(pickerOpen) TaskPicker(pickerChoices(taskChoicesSource.orEmpty(),trigger?.query.orEmpty()),searching = !trigger?.query.isNullOrEmpty(),onPick = ::pick,modifier = Modifier.padding(horizontal = 12.dp).padding(top = 4.dp))
            val attached = taskId
            // What the user types, or moves the caret in: the message limit, "interacted", and the `#` task picker.
            val onUserEdit by rememberUpdatedState { buffer: TextFieldBuffer ->
                val value = TextFieldValue(buffer.asCharSequence().toString(),buffer.selection)
                if(value.text.length > 64000) { buffer.revertAllChanges(); error = "Message limit is 64,000 characters." }
                else { if(value.text != chatDraft.textState.text.toString()) notificationCenter?.interacted(); syncTrigger(value) }
            }
            val userEdits = remember { InputTransformation { onUserEdit(this) } }
            MessageComposer(
                textState = chatDraft.textState,
                hint = composerHint(chatAllowed,ready,thread,busy),
                images = images,
                onRemoveImage = chatDraft::removeImage,
                attaching = attaching,
                attachEnabled = !attaching && !submitting && images.size < INPUT_MAX_IMAGES,
                onAttach = intake.pick,
                sendLabel = if(submitting) "Sending" else if(pending != null) "Retry" else if(busy) "Steer" else "Send",
                sendEnabled = (draft.isNotBlank() || images.isNotEmpty() || quotes.isNotEmpty()) && !submitting && !attaching && !chatDraft.imageLoading && retryMatches && ready && chatAllowed,
                modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 8.dp),
                inputTransformation = userEdits,
                fieldModifier = Modifier.contentReceiver(intake.receiver).onFocusChanged { focus -> chatDraft.focused = focus.isFocused; if(!focus.isFocused) chatDraft.sync?.flush() }.onPreviewKeyEvent { event ->
                    // Backspace on an empty message takes off the task, then the last quote.
                    if(event.type != KeyEventType.KeyDown || event.key != Key.Backspace || draft.isNotEmpty()) false
                    else if(taskId != null) { taskId = null; true }
                    else if(quotes.isNotEmpty()) { quotes = quotes.dropLast(1); openQuote = null; true }
                    else false
                },
                beforeInput = {
                    if(pendingSaved != null && pending == null) {
                        Text("Previous admission could not be restored. Check the transcript before starting another.",modifier = Modifier.padding(horizontal = 16.dp))
                        TextButton(onClick = { discardPending = true }) { Text("Start a new admission…") }
                    }
                    if(pending != null && !submitting) {
                        Text("Previous submission may already be accepted. Retry uses the same admission ID.",style = MaterialTheme.typography.bodySmall,modifier = Modifier.padding(horizontal = 16.dp))
                        if(!retryMatches) Text("Restore the previous text, quotes, task and original images before retrying.",style = MaterialTheme.typography.bodySmall,modifier = Modifier.padding(horizontal = 16.dp))
                        Row {
                            if(draft != pending.text || taskId != pending.taskId || quotes != pending.quotes) TextButton(onClick = { setDraft(pending.text); taskId = pending.taskId; quotes = pending.quotes }) { Text("Restore previous message") }
                            TextButton(onClick = { discardPending = true }) { Text("Start a new admission…") }
                        }
                    }
                    if(attached != null) Row(Modifier.fillMaxWidth().padding(horizontal = 4.dp),verticalAlignment = Alignment.CenterVertically,horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        Text("About",style = MaterialTheme.typography.labelSmall,color = Jarvis.colors.fgSubtle)
                        TaskPill(attached,Modifier.weight(1f,fill = false),title = taskChoicesSource?.firstOrNull { it.id == attached }?.title,onRemove = { taskId = null })
                    }
                    if(quotes.isNotEmpty()) Column(Modifier.fillMaxWidth().padding(horizontal = 4.dp),verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp),verticalArrangement = Arrangement.spacedBy(6.dp)) {
                            quotes.forEachIndexed { index,quote -> key(index,quote) { QuoteChip(quote,openQuote == index,onToggle = { openQuote = if(openQuote == index) null else index },onRemove = { quotes = quotes.filterIndexed { at,_ -> at != index }; openQuote = null }) } }
                        }
                        openQuote?.let { quotes.getOrNull(it) }?.let { OpenQuote(it) }
                    }
                },
                afterInput = { chatDraft.origin?.let { DraftOriginHint(it) } },
                controls = {
                    ComposerSettings(context,threadModelNote = activeThread?.model?.let { "Runs on ${modelLabel(it,models)}" },modifier = Modifier.weight(1f)) { workerDefaults = it }
                    if(taskChoicesSource != null) TaskPickerButton(active = attached != null || pickerOpen) { if(pickerOpen) closePicker() else pickerListOpen = true }
                    if (busy) JarvisIconButton(Lucide.Square, "Stop coordinator", onClick = { scope.launch {
                        try { context.backend.client.request(ConversationAbortRequest(projectId = context.route.projectId, threadId = context.route.threadId)) }
                        catch(e: CancellationException) { throw e }
                        catch (failure: Exception) { error = failure.message }
                    } })
                },
                onSend = send@{
                    val message = draft
                    val sentImages = images
                    val blocks = chatDraft.imageBlocks()
                    val sentTask = taskId
                    val sentQuotes = quotes
                    val admission = pending ?: PendingAdmission.create(admissionScope,message,blocks,workerDefaults,taskId = sentTask,quotes = sentQuotes)
                    val content = admission.content(blocks)
                    if(content == null || !admission.canRetry(admissionScope,message,blocks,sentTask,sentQuotes)) return@send
                    pendingSaved = admission.save()
                    val requestId = admission.requestId
                    submitting = true; error = null
                    closePicker()
                    scope.launch {
                        try {
                            context.backend.client.request(ConversationSubmitRequest(projectId = context.route.projectId, threadId = context.route.threadId,
                                requestId = requestId, content = content, whenBusy = "steer",workerModel = admission.workerDefaults.model,workerThinkingLevel = admission.workerDefaults.thinkingLevel,taskId = admission.taskId))
                            if (draft == message) setDraft("")
                            if(chatDraft.images === sentImages) chatDraft.clearImages()
                            if(taskId == sentTask) taskId = null
                            if(quotes == sentQuotes) { quotes = emptyList(); openQuote = null }
                            if(PendingAdmission.restore(pendingSaved)?.requestId == requestId) pendingSaved = null
                            chatDraft.sent()
                            follow = true
                        } catch(e: CancellationException) { throw e }
                        catch (failure: Exception) { error = "${failure.message}\nSend again to retry this admission safely." }
                        finally { submitting = false }
                    }
                },
            )
        } else Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp,vertical = 12.dp),verticalAlignment = Alignment.CenterVertically,horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("Read-only. A worker reports to the coordinator, so send it more work by messaging the coordinator.",Modifier.weight(1f),style = MaterialTheme.typography.bodySmall,color = Jarvis.colors.fgSubtle)
            OutlinedButton(onClick = { context.navigate(context.route.copy(workerId = null)) }) {
                LucideGlyph(Lucide.ArrowLeft,size = 16.dp); Spacer(Modifier.width(6.dp)); Text(if(thread) "Thread" else "Coordinator")
            }
        }
    }
    }
    if(discardPending) AlertDialog(onDismissRequest = { discardPending = false },title = { Text("Start a new admission?") },text = {
        Text("The previous message may already have been accepted. Sending again with a new ID can duplicate it. Check the transcript first.")
    },confirmButton = { TextButton(onClick = { pendingSaved = null; discardPending = false }) { Text("Use a new ID") } },dismissButton = {
        TextButton(onClick = { discardPending = false }) { Text("Keep safe retry") }
    })
}

/** Under the message box: the draft on screen came from another device (web `Composer`'s hint). */
@Composable private fun DraftOriginHint(origin: DraftOrigin) {
    val images = origin.attachments
    Text(
        "Draft from ${origin.name}" + if(images > 0) (if(images == 1) " · with its image" else " · with its $images images") else "",
        style = MaterialTheme.typography.labelSmall,color = Jarvis.colors.fgSubtle,modifier = Modifier.padding(horizontal = 8.dp),
    )
}

/** The row a one-shot highlight points at: a transcript entry, or a thread's newest card (its notice or the call on it); -1 when not loaded. */
internal fun highlightIndex(rows: List<ChatRow>, target: ChatHighlight): Int = when(target) {
    is ChatHighlight.Entry -> rows.indexOfFirst { row -> row.parts.any { it.key == "entry-${target.entryId}" || it.key.startsWith("entry-${target.entryId}-") || it.sourceEntryId == target.entryId } }
    is ChatHighlight.Thread -> rows.indexOfLast { row -> row.parts.any { part ->
        (part.kind == "notice" && (injectedInput(part.text) as? InjectedInput.Thread)?.notice?.threadId == target.threadId) || (part.kind == "tool" && threadCallId(part) == target.threadId)
    } }
}

/** Main has no coordinator model yet (web `ProjectChat`'s banner): pick one in the composer or in settings. */
@Composable private fun NoCoordinatorBanner(openSettings: () -> Unit) {
    val link = Jarvis.colors.link
    val text = remember(link) {
        androidx.compose.ui.text.buildAnnotatedString {
            append("This project has no coordinator model. Pick one in the composer, or ")
            withLink(androidx.compose.ui.text.LinkAnnotation.Clickable("settings",androidx.compose.ui.text.TextLinkStyles(androidx.compose.ui.text.SpanStyle(color = link,textDecoration = androidx.compose.ui.text.style.TextDecoration.Underline))) { openSettings() }) {
                append("choose one in settings")
            }
            append(", before sending a message.")
        }
    }
    ToneBanner(BannerTone.Warning) { Text(text,style = MaterialTheme.typography.bodySmall) }
}

/** A worker's status, model, thinking, where it works and when it last changed (web `WorkerTranscript`'s header line). */
@Composable private fun WorkerFacts(worker: WorkerSummary, models: List<ModelInfo>, modifier: Modifier = Modifier) {
    val updated = remember(worker.updatedAt) { runCatching { fullTime(java.time.Instant.parse(worker.updatedAt).toEpochMilli()) }.getOrDefault(worker.updatedAt) }
    FlowRow(modifier.fillMaxWidth(),horizontalArrangement = Arrangement.spacedBy(6.dp),verticalArrangement = Arrangement.spacedBy(2.dp),itemVerticalAlignment = Alignment.CenterVertically) {
        val style = MaterialTheme.typography.bodySmall
        val subtle = Jarvis.colors.fgSubtle
        StatusBadge(worker.status,domain = "worker")
        Text(modelLabel(worker.model,models),style = style,color = subtle)
        worker.thinkingLevel?.let { Text("· thinking $it",style = style,color = subtle) }
        Text("· ${if(worker.isolation == "workspace") "own workspace" else "shared checkout"}",style = style,color = subtle)
        if(worker.isolation == "workspace") Text(worker.workspacePath ?: "workspace removed",style = style,color = subtle,fontFamily = androidx.compose.ui.text.font.FontFamily.Monospace)
        Text("· updated $updated",style = style,color = subtle)
    }
}

/** Scrolls to the very end of item [last], its bottom too when it is taller than the screen (web: stick to the bottom). */
private suspend fun LazyListState.scrollToEnd(last: Int) {
    scrollToItem(last.coerceAtLeast(0))
    scrollBy(100_000f)
}
