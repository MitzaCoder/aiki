package com.mihaisaru.harness.features.settings

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.clickable
import androidx.compose.foundation.relocation.BringIntoViewRequester
import androidx.compose.foundation.relocation.bringIntoViewRequester
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.mihaisaru.harness.data.*
import com.mihaisaru.harness.features.status.BannerTone
import com.mihaisaru.harness.features.status.ToneBanner
import com.mihaisaru.harness.features.status.relativeTime
import com.mihaisaru.harness.features.status.rememberNow
import com.mihaisaru.harness.navigation.Destination
import com.mihaisaru.harness.navigation.ProjectScreenContext
import com.mihaisaru.harness.protocol.*
import com.mihaisaru.harness.ui.components.Lucide
import com.mihaisaru.harness.ui.components.LucideGlyph
import com.mihaisaru.harness.ui.theme.Jarvis
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.collectLatest

/** What the last "Run now" did, shown under that schedule. */
private data class RunNotice(val scheduleId: String, val tone: BannerTone?, val text: String, val destination: Destination.Chat? = null, val open: String? = null)

/**
 * Project → Scheduled tasks (web `SchedulesSection.svelte`): the briefs the harness runs as workers or background threads on
 * a clock, or on a GitHub review request. Each schedule reads in plain words with its next and last run, a pause switch,
 * run now, edit, delete and its run history. [highlightId] is the schedule a notification named: it is scrolled into view.
 */
@Composable
internal fun SchedulesSection(context: ProjectScreenContext, highlightId: String? = null) {
    key(context.backend.config.key, context.route.projectId) { SchedulesContent(context, highlightId) }
}

@Composable
private fun SchedulesContent(context: ProjectScreenContext, highlightId: String?) {
    val projectId = context.route.projectId
    val client = context.backend.client
    val connection by client.state.collectAsStateWithLifecycle()
    val models by context.backend.models.collectAsStateWithLifecycle()
    val catalog by context.backend.modelCatalog.collectAsStateWithLifecycle()
    val scope = rememberCoroutineScope()
    var schedules by remember(client, projectId) { mutableStateOf<List<Schedule>>(emptyList()) }
    var loaded by remember(client, projectId) { mutableStateOf(false) }
    var timezone by remember(client, projectId) { mutableStateOf("") }
    var error by remember(client, projectId) { mutableStateOf<String?>(null) }
    var notice by remember { mutableStateOf<RunNotice?>(null) }
    var busy by remember { mutableStateOf(false) }
    var editing by rememberSaveable(client.backend.key, projectId) { mutableStateOf<String?>(null) }
    var deleting by remember { mutableStateOf<Schedule?>(null) }
    var deleteError by remember { mutableStateOf<String?>(null) }
    var runningId by remember { mutableStateOf<String?>(null) }
    var revision by remember(client, projectId) { mutableIntStateOf(0) }
    val now = rememberNow()
    suspend fun refresh() {
        val before = revision
        val response = client.request(SchedulesListRequest(projectId = projectId))
        if (before == revision) { schedules = response.schedules; timezone = response.timezone; loaded = true }
    }
    LaunchedEffect(client, projectId) {
        launch(start = CoroutineStart.UNDISPATCHED) {
            client.events.collect { event -> if (event is SchedulesStateEvent && event.projectId == projectId) {
                revision++; schedules = event.schedules; timezone = event.timezone; loaded = true
            } }
        }
        client.state.collectLatest { state ->
            if (state.status == ConnectionStatus.Ready && state.supports("schedules")) {
                try { refresh(); error = null } catch (e: CancellationException) { throw e } catch (e: Exception) { error = e.message }
            }
        }
    }
    fun operation(block: suspend () -> Unit) {
        scope.launch {
            busy = true
            try { block(); error = null; refresh() }
            catch (e: CancellationException) { throw e }
            catch (e: Exception) { error = if (e is ClientException) e.message ?: e.code else e.message }
            finally { busy = false }
        }
    }
    val enabled = !busy && connection.status == ConnectionStatus.Ready && connection.supports("schedules")
    val events = connection.supports("schedule-events")
    var history by rememberSaveable { mutableStateOf(listOf<String>()) }

    SettingsSectionPage("Scheduled tasks", "Work the harness starts on a clock${if (events) " or on an event" else ""}.", SettingsIcon.CalendarClock) {
        error?.let { ToneBanner(BannerTone.Error) { Text(it, style = MaterialTheme.typography.bodySmall) } }
        SettingsGroup(
            title = "Schedules", description = timezoneNote(timezone),
            actions = {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    SettingsAction("Refresh schedules", SettingsGlyphs.Refresh, enabled) { operation { } }
                    OutlinedButton(enabled = enabled && loaded, onClick = { editing = "" }, modifier = Modifier.heightIn(min = 44.dp)) {
                        LucideGlyph(Lucide.Plus, size = 16.dp); Spacer(Modifier.width(6.dp)); Text("New")
                    }
                }
            },
        ) {
            if (busy) LinearProgressIndicator(Modifier.fillMaxWidth())
            when {
                !loaded -> GroupNote(if (connection.supports("schedules")) "Loading scheduled tasks…" else "This backend does not advertise schedules support.")
                schedules.isEmpty() -> Column(Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 24.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Text("No scheduled tasks yet", style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Medium)
                    Text("A nightly test run, a weekly review of the open changes.", style = MaterialTheme.typography.bodySmall, color = Jarvis.colors.fgMuted)
                }
            }
            schedules.forEach { schedule -> key(schedule.id) {
                val requester = remember { BringIntoViewRequester() }
                val target = schedule.id == highlightId
                if (target) LaunchedEffect(Unit) { delay(250); requester.bringIntoView() }
                val open = schedule.id in history
                GroupRow(Modifier.bringIntoViewRequester(requester).then(if (target) Modifier.background(Jarvis.colors.surface2.copy(alpha = .5f)) else Modifier)) {
                    Row(verticalAlignment = Alignment.Top, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                            @OptIn(ExperimentalLayoutApi::class)
                            FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(4.dp), itemVerticalAlignment = Alignment.CenterVertically) {
                                Text(schedule.title, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.SemiBold)
                                if (isEventSpec(schedule.spec)) StatusChip("On an event", ChipTone.Info, dot = false, icon = SettingsGlyphs.GitPullRequest)
                                if (schedule.kind == "thread") StatusChip("Background thread", ChipTone.Muted, dot = false)
                                if (schedule.createdBy == "coordinator") StatusChip("By the coordinator", ChipTone.Muted, dot = false)
                                if (!schedule.enabled) StatusChip("Paused", ChipTone.Warn)
                            }
                            Text(describeSchedule(schedule.spec), style = MaterialTheme.typography.bodyMedium)
                            Text(scheduleWhenText(schedule, timezone, now), style = MaterialTheme.typography.bodySmall, color = Jarvis.colors.fgMuted)
                            Text(scheduleLastRunText(schedule, now), style = MaterialTheme.typography.bodySmall, color = Jarvis.colors.fgMuted)
                            schedule.taskId?.let { task -> TextButton(onClick = { context.openTask(task) }, contentPadding = PaddingValues(horizontal = 4.dp), modifier = Modifier.heightIn(min = 40.dp)) { Text("Board task $task", style = MaterialTheme.typography.labelMedium) } }
                        }
                        Switch(schedule.enabled, modifier = Modifier.semantics { contentDescription = "${schedule.title} enabled" }, enabled = enabled,
                            onCheckedChange = { active -> operation { client.request(SchedulesSaveRequest(projectId = projectId, scheduleId = schedule.id, schedule = schedule.toInput().copy(enabled = active))) } })
                    }
                    @OptIn(ExperimentalLayoutApi::class)
                    FlowRow(Modifier.padding(top = 8.dp), horizontalArrangement = Arrangement.spacedBy(4.dp), verticalArrangement = Arrangement.spacedBy(0.dp), itemVerticalAlignment = Alignment.CenterVertically) {
                        OutlinedButton(enabled = enabled && runningId != schedule.id, modifier = Modifier.heightIn(min = 44.dp), onClick = {
                            runningId = schedule.id; notice = null
                            scope.launch {
                                try {
                                    val run = client.request(SchedulesRunRequest(projectId = projectId, scheduleId = schedule.id)).run
                                    notice = runNotice(context, schedule, run)
                                    refresh()
                                } catch (e: CancellationException) { throw e }
                                catch (e: Exception) { notice = RunNotice(schedule.id, BannerTone.Error, e.message ?: "Could not run it.") }
                                finally { runningId = null }
                            }
                        }) {
                            if (runningId == schedule.id) CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 2.dp) else LucideGlyph(SettingsGlyphs.Play, size = 16.dp)
                            Spacer(Modifier.width(6.dp)); Text("Run now")
                        }
                        TextButton(enabled = enabled, onClick = { editing = schedule.id }, modifier = Modifier.heightIn(min = 44.dp).semantics { contentDescription = "Edit ${schedule.title}" }) {
                            LucideGlyph(SettingsGlyphs.Pencil, size = 16.dp); Spacer(Modifier.width(6.dp)); Text("Edit")
                        }
                        TextButton(enabled = enabled, onClick = { deleteError = null; deleting = schedule }, modifier = Modifier.heightIn(min = 44.dp).semantics { contentDescription = "Delete ${schedule.title}" }) {
                            LucideGlyph(com.mihaisaru.harness.features.status.StatusGlyphs.Trash, size = 16.dp); Spacer(Modifier.width(6.dp)); Text("Delete")
                        }
                        TextButton(onClick = { history = if (open) history - schedule.id else history + schedule.id }, modifier = Modifier.heightIn(min = 44.dp)) {
                            LucideGlyph(if (open) Lucide.ChevronDown else Lucide.ChevronRight, size = 14.dp); Spacer(Modifier.width(4.dp)); Text("Runs (${schedule.runs.size})")
                        }
                    }
                    notice?.takeIf { it.scheduleId == schedule.id }?.let { n ->
                        ToneBanner(n.tone) {
                            Text(n.text, style = MaterialTheme.typography.bodySmall)
                            n.destination?.let { destination -> TextButton(onClick = { context.navigate(destination) }) { Text(n.open ?: "Open") } }
                        }
                    }
                    if (open) Column(Modifier.fillMaxWidth().padding(top = 8.dp).background(Jarvis.colors.surface2.copy(alpha = .4f), androidx.compose.foundation.shape.RoundedCornerShape(10.dp)).padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        if (schedule.runs.isEmpty()) Text("No runs yet; the next one will appear here.", style = MaterialTheme.typography.bodySmall, color = Jarvis.colors.fgMuted)
                        schedule.runs.forEach { run -> RunLine(context, run, timezone, now) }
                    }
                }
            } }
        }
    }
    deleting?.let { row -> AlertDialog(
        onDismissRequest = { if (!busy) deleting = null }, title = { Text("Delete this scheduled task?") },
        text = { Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("${row.title} stops running and its run history goes with it. Work a run already started keeps running as that worker.")
            deleteError?.let { Text(it, color = Jarvis.colors.danger, style = MaterialTheme.typography.bodySmall) }
        } },
        confirmButton = { Button(enabled = enabled, colors = ButtonDefaults.buttonColors(containerColor = Jarvis.colors.danger), onClick = {
            scope.launch {
                busy = true
                try { client.request(SchedulesDeleteRequest(projectId = projectId, scheduleId = row.id)); deleting = null; refresh() }
                catch (e: CancellationException) { throw e }
                catch (e: Exception) { deleteError = e.message }
                finally { busy = false }
            }
        }) { Text("Delete") } },
        dismissButton = { TextButton(onClick = { deleting = null }) { Text("Cancel") } }) }
    editing?.let { id ->
        val row = schedules.firstOrNull { it.id == id }
        if (id.isEmpty() || row != null) key(id) {
            ScheduleEditor(row, timezone, models, catalog?.providers.orEmpty(), enabled, error, allowThreads = connection.supports("threads"), allowEvents = events || row?.spec is ScheduleSpecGithubReviewRequested,
                onDismiss = { editing = null }, onSave = { input ->
                    operation { client.request(SchedulesSaveRequest(projectId = projectId, scheduleId = id.ifEmpty { null }, schedule = input)); editing = null }
                })
        }
    }
}

private fun runNotice(context: ProjectScreenContext, schedule: Schedule, run: ScheduleRun): RunNotice {
    val destination = scheduleRunDestination(context.route, run)
    return when {
        run.outcome == "started" && run.threadId != null -> RunNotice(schedule.id, null, "Started a background thread. Its summary goes to main when it finishes.", destination, "Open the thread")
        run.outcome == "started" -> RunNotice(schedule.id, null, if (run.workerId == null) "Started a worker." else "Started worker ${run.workerId}. The report goes to the coordinator.", destination, "Open the worker")
        else -> RunNotice(schedule.id, if (run.outcome == "skipped") BannerTone.Warning else BannerTone.Error, "Not run (${scheduleOutcomeLabel(run.outcome).lowercase()}) — ${runReason(run) ?: "no reason given"}")
    }
}

@Composable
private fun RunLine(context: ProjectScreenContext, run: ScheduleRun, timezone: String, now: Long) {
    val colors = Jarvis.colors
    val outcomeColor = when (run.outcome) { "started" -> colors.success; "failed" -> colors.danger; else -> colors.warning }
    Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
        @OptIn(ExperimentalLayoutApi::class)
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), itemVerticalAlignment = Alignment.CenterVertically) {
            Text(relativeTime(run.at, now), style = MaterialTheme.typography.labelMedium, color = colors.fgMuted)
            Text(scheduleTriggerLabel(run.trigger), style = MaterialTheme.typography.labelMedium, fontWeight = FontWeight.Medium)
            runRefLabel(run)?.let { label ->
                val uri = androidx.compose.ui.platform.LocalUriHandler.current
                Text(label, Modifier.clickable { run.ref?.takeIf { it.startsWith("https://") }?.let { runCatching { uri.openUri(it) } } }, style = MaterialTheme.typography.labelMedium, color = colors.accent2, textDecoration = androidx.compose.ui.text.style.TextDecoration.Underline)
            }
            Text(scheduleOutcomeLabel(run.outcome), style = MaterialTheme.typography.labelMedium, color = outcomeColor)
        }
        Text(backendTime(run.at, timezone), style = MaterialTheme.typography.labelSmall, color = colors.fgSubtle)
        runReason(run)?.takeIf { run.outcome != "started" }?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = colors.fgMuted) }
        scheduleRunDestination(context.route, run)?.let { destination ->
            TextButton(onClick = { context.navigate(destination) }, contentPadding = PaddingValues(horizontal = 4.dp), modifier = Modifier.heightIn(min = 40.dp)) {
                Text(if (run.threadId != null) "Open the background thread" else "Open worker ${run.workerId}", style = MaterialTheme.typography.labelMedium)
            }
        }
        run.taskId?.let { task -> TextButton(onClick = { context.openTask(task) }, contentPadding = PaddingValues(horizontal = 4.dp), modifier = Modifier.heightIn(min = 40.dp)) { Text("Task $task", style = MaterialTheme.typography.labelMedium) } }
    }
}

private val DAY_LABELS = listOf("Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat")

/** The editor: a full-screen dialog of the same groups and rows as the settings, Cancel and Save on top. */
@Composable
internal fun ScheduleEditor(
    schedule: Schedule?, timezone: String, models: List<ModelInfo>, providers: List<ProviderInfo>, enabled: Boolean, serverError: String?,
    onDismiss: () -> Unit, onSave: (ScheduleInput) -> Unit, allowThreads: Boolean = false, allowEvents: Boolean = false,
) {
    val spec = schedule?.spec?.takeUnless { it is UnknownScheduleSpec }
    var title by rememberSaveable { mutableStateOf(schedule?.title ?: "") }
    var brief by rememberSaveable { mutableStateOf(schedule?.brief ?: "") }
    var kind by rememberSaveable { mutableStateOf(spec?.kind ?: "interval") }
    var minutes by rememberSaveable { mutableStateOf((spec as? ScheduleSpecInterval)?.everyMinutes?.toString() ?: "60") }
    var time by rememberSaveable { mutableStateOf((spec as? ScheduleSpecDaily)?.time ?: (spec as? ScheduleSpecWeekly)?.time ?: "09:00") }
    var days by rememberSaveable { mutableStateOf((spec as? ScheduleSpecWeekly)?.days?.map(Long::toInt) ?: listOf(1, 2, 3, 4, 5)) }
    var cron by rememberSaveable { mutableStateOf((spec as? ScheduleSpecCron)?.expression ?: "0 9 * * 1-5") }
    var repos by rememberSaveable { mutableStateOf((spec as? ScheduleSpecGithubReviewRequested)?.repos?.joinToString(", ") ?: "") }
    var model by rememberSaveable { mutableStateOf(schedule?.model?.let { modelKey(it) } ?: "") }
    var thinking by rememberSaveable { mutableStateOf(schedule?.thinkingLevel) }
    var isolation by rememberSaveable { mutableStateOf(schedule?.isolation ?: "shared") }
    var onReport by rememberSaveable { mutableStateOf(schedule?.onReport ?: "review") }
    var active by rememberSaveable { mutableStateOf(schedule?.enabled ?: true) }
    var targetKind by rememberSaveable { mutableStateOf(schedule?.kind ?: "worker") }
    var error by remember { mutableStateOf<String?>(null) }
    val chosenModel = models.firstOrNull { modelKey(it) == model }
    Dialog(onDismissRequest = onDismiss, properties = DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false)) {
        DialogSystemBars()
        Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
            Column(Modifier.fillMaxSize().windowInsetsPadding(WindowInsets.safeDrawing)) {
                Row(Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                    TextButton(onClick = onDismiss, modifier = Modifier.heightIn(min = 48.dp)) { Text("Cancel") }
                    Text(if (schedule == null) "New scheduled task" else "Edit scheduled task", Modifier.weight(1f), style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis, textAlign = androidx.compose.ui.text.style.TextAlign.Center)
                    Button(enabled = enabled, modifier = Modifier.heightIn(min = 44.dp), onClick = {
                        runCatching {
                            require(title.trim().isNotEmpty() && brief.trim().isNotEmpty()) { "Title and ${if (targetKind == "thread") "prompt" else "brief"} are required." }
                            ScheduleInput(title.trim(), brief.trim(), scheduleSpec(kind, minutes, time, days.toSet(), cron, repos), chosenModel?.let { ModelRef(it.provider, it.modelId) }, if (chosenModel == null) null else thinking, isolation, onReport, active, targetKind)
                        }.onSuccess { error = null; onSave(it) }.onFailure { error = it.message }
                    }) { Text("Save") }
                }
                Column(Modifier.weight(1f).widthIn(max = 720.dp).fillMaxWidth().align(Alignment.CenterHorizontally).verticalScroll(rememberScrollState()).padding(horizontal = 12.dp).padding(bottom = 24.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
                    (error ?: serverError)?.let { ToneBanner(BannerTone.Error) { Text(it, style = MaterialTheme.typography.bodySmall) } }
                    SettingsGroup(title = "What to run") {
                        SettingsRow("Each run", hint = "A worker does one task; a background thread keeps its own conversation.") {
                            Combobox(
                                listOfNotNull(ComboOption("worker", "Run one worker", "The report goes to the coordinator"),
                                    ComboOption("thread", "Start a background thread", "Its summary goes to main").takeIf { allowThreads || schedule?.kind == "thread" }),
                                targetKind, { targetKind = it }, "Each run",
                            )
                        }
                        SettingsRow(if (targetKind == "thread") "Prompt" else "Brief", hint = if (targetKind == "thread") "What the thread starts from." else "The worker's task, self-contained.", control = RowControl.Full) {
                            OutlinedTextField(title, { title = it }, label = { Text("Title") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                            OutlinedTextField(brief, { brief = it }, label = { Text(if (targetKind == "thread") "Prompt" else "Brief") }, minLines = 3, modifier = Modifier.fillMaxWidth())
                        }
                    }
                    SettingsGroup(title = if (kind == "github-review-requested") "When" else "Repeat", description = timezoneNote(timezone)) {
                        SettingsRow(if (kind == "github-review-requested") "Run" else "Repeat") {
                            Combobox(
                                listOfNotNull(
                                    ComboOption("interval", "Every few minutes or hours"), ComboOption("daily", "Every day"), ComboOption("weekly", "On chosen days of the week"),
                                    ComboOption("cron", "Cron expression"),
                                    ComboOption("github-review-requested", "When a review is requested from you on GitHub", "Checked every $EVENT_POLL_MINUTES minutes").takeIf { allowEvents },
                                ), kind, { kind = it }, "Repeat",
                            )
                        }
                        when (kind) {
                            "interval" -> SettingsRow("Every", hint = "5 to 10080 minutes.", control = RowControl.Auto) {
                                OutlinedTextField(minutes, { minutes = it }, suffix = { Text("minutes") }, singleLine = true, modifier = Modifier.widthIn(max = 200.dp), keyboardOptions = androidx.compose.foundation.text.KeyboardOptions(keyboardType = androidx.compose.ui.text.input.KeyboardType.Number))
                            }
                            "daily" -> SettingsRow("At", hint = "24-hour time, HH:MM.", control = RowControl.Auto) {
                                OutlinedTextField(time, { time = it }, singleLine = true, modifier = Modifier.widthIn(max = 160.dp))
                            }
                            "weekly" -> {
                                SettingsRow("On", hint = "Pick at least one day.", control = RowControl.Full) {
                                    @OptIn(ExperimentalLayoutApi::class)
                                    FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                                        DAY_LABELS.forEachIndexed { day, name ->
                                            FilterChip(day in days, { days = if (day in days) days - day else (days + day).distinct() }, label = { Text(name) }, modifier = Modifier.heightIn(min = 44.dp))
                                        }
                                    }
                                }
                                SettingsRow("At", hint = "24-hour time, HH:MM.", control = RowControl.Auto) {
                                    OutlinedTextField(time, { time = it }, singleLine = true, modifier = Modifier.widthIn(max = 160.dp))
                                }
                            }
                            "cron" -> SettingsRow("Cron expression", hint = "Five fields: minute hour day month weekday.") {
                                OutlinedTextField(cron, { cron = it }, singleLine = true, modifier = Modifier.fillMaxWidth())
                            }
                            else -> SettingsRow(
                                "Repositories", hint = "owner/name, separated by commas. Empty: this project's repositories.",
                                learn = { Text("Empty means the project's GitHub repositories, or every repository when it has none. The backend checks GitHub every $EVENT_POLL_MINUTES minutes as the account its gh is signed in to, counting requests to you and to your teams. Each new request starts its own run with your ${if (targetKind == "thread") "prompt" else "brief"} plus the pull request's details, and gets its own task. Requests already open when you turn this on are left alone.") },
                            ) { OutlinedTextField(repos, { repos = it }, singleLine = true, placeholder = { Text("owner/name") }, modifier = Modifier.fillMaxWidth()) }
                        }
                    }
                    SettingsGroup(title = "Model") {
                        SettingsRow("Model", hint = "Worker default: the composer's pick, then the project's worker models.") {
                            Combobox(listOf(ComboOption("", "Worker default", "The composer's pick, then the project's worker models")) + modelOptions(models, providers), model, {
                                model = it; if (it.isEmpty() || validThinking(thinking, models.firstOrNull { m -> modelKey(m) == it }) == null) thinking = null
                            }, "Model", placeholder = "Worker default", searchPlaceholder = "Search models or providers…")
                        }
                        SettingsRow("Thinking level", hint = if (chosenModel == null) "Choose a model to set one." else "How hard the model thinks on each run.") {
                            ThinkingSelect(chosenModel?.thinkingLevels.orEmpty(), thinking, { thinking = it }, enabled = chosenModel != null)
                        }
                    }
                    SettingsGroup(title = "Each run") {
                        if (targetKind != "thread") SettingsRow("Worker isolation", hint = "Where the worker runs.") {
                            Combobox(listOf(ComboOption("shared", "Shared checkout", "The project's own folder"), ComboOption("workspace", "Own workspace", "A separate checkout per run")), isolation, { isolation = it }, "Worker isolation")
                        } else SettingsRow("Workspace", hint = "Each background thread runs in its own workspace.", control = RowControl.Auto)
                        SettingsRow("On report", hint = if (targetKind == "thread") "Review wakes main to read the thread's summary; record keeps it for your next message." else "Reviewing wakes the coordinator for a turn per run; recording waits for your next message.") {
                            Combobox(listOf(ComboOption("review", scheduleReportLabel(targetKind, "review"), "Wakes it for a turn"), ComboOption("record", scheduleReportLabel(targetKind, "record"), "Waits for your next message")), onReport, { onReport = it }, "On report")
                        }
                        SettingsRow("Enabled", hint = "A paused schedule does not run on its own; Run now still works.", control = RowControl.Inline) { SettingsSwitch(active, { active = it }, "Enabled") }
                    }
                }
            }
        }
    }
}
