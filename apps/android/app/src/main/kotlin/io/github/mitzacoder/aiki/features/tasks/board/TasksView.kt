package io.github.mitzacoder.aiki.features.tasks.board

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.selection.selectable
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.github.mitzacoder.aiki.data.HarnessFeature
import io.github.mitzacoder.aiki.features.panels.BoardQuestionEditor
import io.github.mitzacoder.aiki.features.panels.TaskDraft
import io.github.mitzacoder.aiki.features.panels.TaskEditor
import io.github.mitzacoder.aiki.navigation.PanelTab
import io.github.mitzacoder.aiki.navigation.ProjectScreenContext
import io.github.mitzacoder.aiki.protocol.BoardQuestion
import io.github.mitzacoder.aiki.protocol.BoardTaskInput
import io.github.mitzacoder.aiki.ui.components.Lucide
import io.github.mitzacoder.aiki.ui.components.LucideGlyph
import io.github.mitzacoder.aiki.ui.theme.Jarvis
import io.github.mitzacoder.aiki.ui.theme.fade
import io.github.mitzacoder.aiki.ui.theme.textStyle
import kotlinx.coroutines.launch

/**
 * The Tasks view (web `TasksView.svelte`): the list or the board, with a List | Board switch this device remembers
 * ([io.github.mitzacoder.aiki.data.DeviceSettings.tasksView], list by default). [list] draws the Tasks list with the switch
 * it is given at the start of its toolbar. [looseQuestion] and [addTask] go to the board ([TaskBoard]).
 */
@Composable
fun TasksView(
    context: ProjectScreenContext,
    modifier: Modifier = Modifier,
    looseQuestion: @Composable (BoardQuestion) -> Unit = { BoardQuestionEditor(context, it) },
    addTask: (@Composable (close: () -> Unit) -> Unit)? = { close -> NewTaskEditor(context, close) },
    list: @Composable (toolbarStart: @Composable () -> Unit) -> Unit,
) {
    val settings by context.repository.settings.collectAsStateWithLifecycle()
    val mode = tasksViewMode(settings.tasksView)
    val scope = rememberCoroutineScope()
    val switch: @Composable () -> Unit = { TasksViewSwitch(mode) { scope.launch { context.repository.setTasksView(it.stored) } } }
    if (mode == TasksViewMode.Board) TaskBoard(context, modifier, switch, looseQuestion, addTask)
    else Column(modifier) { list(switch) }
}

/**
 * Whether a project panel on [tab] shows the Tasks board, which on a tablet takes the full width rather than the side
 * panel's (the web expands its sidebar over the chat for it).
 */
@Composable
fun showsTasksBoard(context: ProjectScreenContext, tab: PanelTab?): Boolean {
    val settings by context.repository.settings.collectAsStateWithLifecycle()
    val connection by context.backend.client.state.collectAsStateWithLifecycle()
    return tab == PanelTab.Board && connection.supports(HarnessFeature.TASK_REPORTS) && tasksViewMode(settings.tasksView) == TasksViewMode.Board
}

/** The List | Board switch: a two-part segmented control, as on the web. */
@Composable
fun TasksViewSwitch(mode: TasksViewMode, onChange: (TasksViewMode) -> Unit) {
    val colors = Jarvis.colors
    Row(
        Modifier.clip(RoundedCornerShape(10.dp)).background(colors.surface2.fade(70f)).padding(3.dp).semantics { contentDescription = "Show the tasks as" },
        horizontalArrangement = Arrangement.spacedBy(2.dp),
    ) {
        listOf(TasksViewMode.List to BoardGlyphs.List, TasksViewMode.Board to Lucide.Kanban).forEach { (entry, icon) ->
            val selected = mode == entry
            val label = if (entry == TasksViewMode.List) "List" else "Board"
            Row(
                Modifier
                    .then(if (selected) Modifier.shadow(1.dp, RoundedCornerShape(7.dp)) else Modifier)
                    .clip(RoundedCornerShape(7.dp))
                    .background(if (selected) colors.bg else colors.bg.fade(0f))
                    .selectable(selected, role = Role.Tab) { onChange(entry) }
                    .heightIn(min = 34.dp)
                    .padding(horizontal = 10.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                LucideGlyph(icon, size = 14.dp, tint = if (selected) colors.fg else colors.fgSubtle)
                Text(label, style = textStyle(0.75f, 1.4f, weight = 600), color = if (selected) colors.fg else colors.fgSubtle)
            }
        }
    }
}

/** The board's "Add task": the panel's task editor on a new to-do task. */
@Composable
internal fun NewTaskEditor(context: ProjectScreenContext, close: () -> Unit) {
    val view by context.board.view.collectAsStateWithLifecycle()
    val draft = remember {
        TaskDraft(null, null, BoardTaskInput(title = "", description = "", acceptance = null, refs = null, status = "todo", blockedBy = emptyList(), blockedReason = null, writeScopes = emptyList()))
    }
    TaskEditor(context, draft, view.tasks, close = close, saved = close)
}
