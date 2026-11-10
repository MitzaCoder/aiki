package com.mihaisaru.harness.features.tasks

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.mihaisaru.harness.data.request
import com.mihaisaru.harness.features.panels.panelData
import com.mihaisaru.harness.navigation.ProjectScreenContext
import com.mihaisaru.harness.protocol.*
import com.mihaisaru.harness.ui.components.Lucide
import com.mihaisaru.harness.ui.components.LucideGlyph
import com.mihaisaru.harness.ui.theme.Jarvis
import com.mihaisaru.harness.ui.theme.JetBrainsMono
import com.mihaisaru.harness.ui.theme.Text as TextStyles
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/**
 * The project's tasks, the body of the panels' Tasks tab on a `task-reports` backend (web `TasksPanel.svelte`): every
 * task grouped by what it needs from the user (needs you, ready for review, blocked, working, to do, recently closed). A
 * row opens the task's sheet; the questions and warnings that name no task are answered right here. Decisions and
 * answered questions fold at the bottom. [toolbarStart] sits at the start of the toolbar (the board's List | Board switch).
 */
@Composable
fun TasksPanel(context: ProjectScreenContext, modifier: Modifier = Modifier, toolbarStart: (@Composable () -> Unit)? = null) {
    val colors = Jarvis.colors
    val board = context.board
    val view by board.view.collectAsStateWithLifecycle()
    val connection by context.backend.client.state.collectAsStateWithLifecycle()
    val project = context.route.projectId
    val threads = if (connection.supports("threads")) panelData(context, "task-threads", { it is ThreadsStateEvent && it.projectId == project }) {
        context.backend.client.request(ThreadsListRequest(projectId = project, includeArchived = true)).threads
    }.value.orEmpty() else emptyList()
    val stateKey = "${context.backend.config.key}/$project"
    var adding by rememberSaveable(stateKey) { mutableStateOf(false) }
    // Sections the user opened or folded against their default.
    var toggled by rememberSaveable(stateKey) { mutableStateOf(listOf<String>()) }
    var answeredOpen by rememberSaveable(stateKey) { mutableStateOf(false) }
    var decisionsOpen by rememberSaveable(stateKey) { mutableStateOf(false) }
    val list = rememberLazyListState()
    val scope = rememberCoroutineScope()
    val reducedMotion = rememberReducedMotion()
    val now by produceState(System.currentTimeMillis()) { while (true) { delay(30_000); value = System.currentTimeMillis() } }

    if (adding) {
        TaskEditor(context, task = null, tasks = view.tasks, onBack = { adding = false }, modifier = modifier.fillMaxSize())
        return
    }
    val loadedBoard = view.board
    val tasks = view.tasks
    val sections = if (loadedBoard == null) emptyList() else taskSections(filteredTasks(context, tasks), view.questions, includeArchived = view.showArchived)
    val loose = if (loadedBoard == null) emptyList() else looseWaiting(loadedBoard.copy(tasks = tasks))
    val answered = view.questions.filter { it.status == "answered" }
    val decisions = loadedBoard?.decisions.orEmpty()
    val empty = view.loaded && tasks.isEmpty() && loose.isEmpty()
    val archivedShown = if (view.showArchived) tasks.count { it.archived } else 0
    val openCount = tasks.count { !it.archived && !isSettled(it.status) }

    LazyColumn(modifier.fillMaxSize(), state = list, contentPadding = PaddingValues(vertical = 12.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
        view.error?.let { error ->
            item(key = "error") {
                Text(error, Modifier.fillMaxWidth().background(colors.danger.copy(alpha = .1f), RoundedCornerShape(10.dp)).padding(10.dp), style = TaskType.xs, color = colors.danger)
            }
        }
        item(key = "toolbar") {
            Row(Modifier.fillMaxWidth().padding(horizontal = 4.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                toolbarStart?.let { Box(Modifier.padding(end = 6.dp)) { it() } }
                Box(Modifier.weight(1f)) {
                    when {
                        !view.loaded -> Box(Modifier.size(width = 56.dp, height = 12.dp).background(colors.surface2, RoundedCornerShape(4.dp)))
                        empty -> Text("Nothing here yet.", style = TaskType.xs, color = colors.fgSubtle)
                        else -> Text("$openCount open", style = TaskType.xs, color = colors.fgSubtle)
                    }
                }
                TextButton(onClick = { adding = true }, contentPadding = PaddingValues(horizontal = 8.dp)) {
                    LucideGlyph(Lucide.Plus, size = 14.dp)
                    Spacer(Modifier.width(4.dp))
                    Text("Add task", style = TaskType.xs)
                }
            }
        }
        item(key = "task-filters") { TaskFilters(context, tasks) }
        if (!view.loaded) {
            item(key = "skeleton") {
                Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Box(Modifier.padding(horizontal = 4.dp).size(width = 96.dp, height = 14.dp).background(colors.surface2, RoundedCornerShape(4.dp)))
                    TaskGroup {
                        TaskRowSkeleton(.75f, .92f)
                        GroupHairline()
                        TaskRowSkeleton(.67f, .8f)
                        GroupHairline()
                        TaskRowSkeleton(.8f, .75f)
                    }
                }
            }
        } else if (empty) {
            item(key = "empty") {
                Text("The coordinator adds a task for each thing you bring up. You can also add one yourself.", Modifier.padding(horizontal = 4.dp), style = TextStyles.sm, color = colors.fgSubtle)
            }
        }
        if (loose.isNotEmpty()) {
            item(key = "loose") {
                Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    SectionTitle("Waiting for you", loose.size, accent = true)
                    loose.forEach { question ->
                        key(question.id) {
                            QuestionCard(
                                context, question,
                                askedBy = questionAskedBy(question, threads),
                                taskLabel = questionTaskLabel(question, view::task),
                                onOpenTask = question.taskId?.let { id -> { context.openTask(id) } },
                            )
                        }
                    }
                }
            }
        }
        sections.forEach { section ->
            val open = (section.id.name in toggled) != !section.collapsedByDefault
            item(key = "section-${section.id.name}") {
                Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    if (section.collapsedByDefault) FoldHeading(section.label, open, onToggle = {
                        toggled = if (section.id.name in toggled) toggled - section.id.name else toggled + section.id.name
                    }, count = section.rows.size, chevronFirst = false, style = TaskType.sectionTitle)
                    else SectionTitle(section.label, section.rows.size, accent = section.id == TaskSectionId.NeedsYou)
                    if (open) TaskGroup {
                        section.rows.forEachIndexed { index, row ->
                            key(row.task.id) {
                                if (index > 0) GroupHairline()
                                TaskListRow(row, now, reducedMotion, connection.supports(com.mihaisaru.harness.data.HarnessFeature.TASK_LINKS)) { context.openTask(row.task.id) }
                            }
                        }
                    }
                }
            }
        }
        if (view.loaded) item(key = "archived") {
            Row(
                Modifier.clip(RoundedCornerShape(8.dp)).clickable(role = Role.Switch) { scope.launch { board.setShowArchived(!view.showArchived) } }
                    .heightIn(min = 40.dp).padding(horizontal = 4.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                LucideGlyph(Lucide.Archive, size = 14.dp, tint = colors.fgSubtle)
                Text(if (view.showArchived) "Hide archived${if (archivedShown > 0) " ($archivedShown)" else ""}" else "Show archived", style = TaskType.xs, color = colors.fgSubtle)
            }
        }
        if (answered.isNotEmpty()) item(key = "answered") {
            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                FoldHeading("Answered", answeredOpen, onToggle = { answeredOpen = !answeredOpen }, count = answered.size)
                if (answeredOpen) answered.forEach { question ->
                    FoldedCard {
                        Text(question.id, style = TaskType.xs, fontFamily = JetBrainsMono, color = colors.fgSubtle)
                        BoardMarkdown(question.text)
                        BoardMarkdown(question.answer.orEmpty(), Modifier.padding(top = 2.dp))
                    }
                }
            }
        }
        if (decisions.isNotEmpty()) item(key = "decisions") {
            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                FoldHeading("Decisions", decisionsOpen, onToggle = { decisionsOpen = !decisionsOpen }, count = decisions.size)
                if (decisionsOpen) decisions.forEach { decision -> DecisionCard(decision, now, withTask = true) }
            }
        }
        // Last: below every task, the answered questions and the decisions.
        if (view.loaded) item(key = "loose-workers") { LooseWorkers(context, tasks) }
    }
}

/** A section's title with its count, in the accent when it needs the user. */
@Composable
internal fun SectionTitle(title: String, count: Int? = null, accent: Boolean = false) {
    val colors = Jarvis.colors
    Row(Modifier.padding(horizontal = 4.dp).semantics { heading() }, horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(title, style = TaskType.sectionTitle, color = if (accent) colors.accent2 else colors.fgMuted)
        count?.let { CountPill(it, accent) }
    }
}

/** A section's rows as one inset-grouped card, split by hairlines that start where the text does. */
@Composable
internal fun TaskGroup(content: @Composable ColumnScope.() -> Unit) {
    val colors = Jarvis.colors
    val shape = RoundedCornerShape(14.dp)
    Column(
        Modifier.fillMaxWidth().clip(shape).background(colors.surface.copy(alpha = .55f)).border(1.dp, colors.border.copy(alpha = .8f), shape),
        content = content,
    )
}

@Composable
internal fun GroupHairline() = HorizontalDivider(Modifier.padding(start = 36.dp), color = Jarvis.colors.border.copy(alpha = .85f))

@Composable
internal fun FoldedCard(content: @Composable ColumnScope.() -> Unit) {
    val shape = RoundedCornerShape(12.dp)
    Column(Modifier.fillMaxWidth().border(1.dp, Jarvis.colors.border.copy(alpha = .6f), shape).padding(horizontal = 10.dp, vertical = 8.dp), content = content)
}

/** A decision: its ID and text, why, and when (with the task it is about, in the list). */
@Composable
internal fun DecisionCard(decision: BoardDecision, now: Long, withTask: Boolean) {
    val colors = Jarvis.colors
    FoldedCard {
        Text(decision.id, style = TaskType.xs, fontFamily = JetBrainsMono, color = colors.fgSubtle)
        BoardMarkdown(decision.text)
        decision.why?.takeIf { it.isNotBlank() }?.let { BoardMarkdown(it, Modifier.padding(top = 4.dp)) }
        Text(
            listOfNotNull(decision.taskId?.takeIf { withTask }, relativeTime(decision.at, now)).joinToString(" · "),
            Modifier.padding(top = 2.dp), style = TaskType.meta, color = colors.fgSubtle,
        )
    }
}
