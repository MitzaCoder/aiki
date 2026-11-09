package com.mihaisaru.harness.features.tasks

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.unit.dp
import com.mihaisaru.harness.data.SaveOutcome
import com.mihaisaru.harness.features.panels.boardDraftKey
import com.mihaisaru.harness.features.panels.boardDraftSaver
import com.mihaisaru.harness.navigation.ProjectScreenContext
import com.mihaisaru.harness.protocol.BoardTask
import com.mihaisaru.harness.ui.components.JarvisIconButton
import com.mihaisaru.harness.ui.components.Lucide
import com.mihaisaru.harness.ui.theme.Jarvis
import com.mihaisaru.harness.ui.theme.textStyle
import kotlinx.coroutines.launch
import kotlinx.serialization.Serializable

/**
 * What the editor keeps across a rotation: the draft, the revision and refs it started from, the task as last shown, and
 * a conflict ([conflicted], with the newer version or null when the task is gone).
 */
@Serializable
internal data class TaskEditorState(
    val draft: TaskEditorDraft,
    val baseRevision: Long?,
    val baseRefs: List<String>?,
    val shown: BoardTask?,
    val conflicted: Boolean = false,
    val newer: BoardTask? = null,
) {
    companion object {
        fun of(task: BoardTask?) = TaskEditorState(task?.editorDraft() ?: TaskEditorDraft(), task?.revision, task?.refs, task)
    }
}

/**
 * Add or edit one task (web `BoardTaskEditor.svelte`). A save names the revision the draft was started from; when the
 * task moved on, the editor shows the newer version beside what changed and lets the user take it or save their own
 * over it. Tickets and links are one per line and go to the server only when the user changed them. [scrolls] is false
 * where the editor sits in a scrolling body already (the task sheet).
 */
@Composable
fun TaskEditor(context: ProjectScreenContext, task: BoardTask?, tasks: List<BoardTask>, onBack: () -> Unit, modifier: Modifier = Modifier, scrolls: Boolean = true) {
    val colors = Jarvis.colors
    val draftKey = boardDraftKey(context.backend.config.key, context.route.projectId, "task-editor", task?.id ?: "new")
    var state by rememberSaveable(draftKey, stateSaver = boardDraftSaver(draftKey, TaskEditorState.serializer())) { mutableStateOf(TaskEditorState.of(task)) }
    var saving by remember { mutableStateOf(false) }
    var problem by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    val draft = state.draft
    val taskId = state.shown?.id
    val choices = blockerChoices(tasks, taskId)
    val validation = draftProblem(draft, taskId, tasks)
    val dirty = draftIsDirty(draft, state.shown)
    val live = taskId?.let { id -> tasks.firstOrNull { it.id == id } }
    val movedOn = !state.conflicted && live != null && state.baseRevision != null && live.revision != state.baseRevision
    fun update(change: TaskEditorDraft.() -> TaskEditorDraft) { state = state.copy(draft = state.draft.change()) }

    fun save(from: TaskEditorState) {
        if (saving || draftProblem(from.draft, from.shown?.id, tasks) != null) return
        saving = true
        problem = null
        scope.launch {
            val outcome = context.board.saveTask(from.draft.toInput(from.baseRefs), from.shown?.id, from.baseRevision)
            saving = false
            when (outcome) {
                is SaveOutcome.Saved -> onBack()
                is SaveOutcome.Conflict -> state = from.copy(conflicted = true, newer = outcome.newer)
                is SaveOutcome.Failed -> problem = outcome.message
            }
        }
    }

    val label = textStyle(0.6875f, 1f / 0.6875f, weight = 600)
    val field = textStyle(0.8125f, 1.25f / 0.8125f)
    val mono = field.merge(TextStyle(fontFamily = com.mihaisaru.harness.ui.theme.JetBrainsMono))
    @Composable
    fun Field(name: String, value: String, onChange: (String) -> Unit, minLines: Int = 1, placeholder: String? = null, style: TextStyle = field) {
        Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(name, style = label, color = colors.fgSubtle)
            OutlinedTextField(
                value, onChange, Modifier.fillMaxWidth(), enabled = !saving, textStyle = style, minLines = minLines, maxLines = maxOf(minLines, 8),
                placeholder = placeholder?.let { { Text(it, style = style) } },
                keyboardOptions = KeyboardOptions(capitalization = if (style == mono) KeyboardCapitalization.None else KeyboardCapitalization.Sentences),
                shape = RoundedCornerShape(10.dp),
            )
        }
    }

    Column(modifier.then(if (scrolls) Modifier.verticalScroll(rememberScrollState()) else Modifier).padding(bottom = 16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            JarvisIconButton(Lucide.ArrowLeft, if (task == null) "Back to the tasks" else "Back to the task", onClick = onBack)
            Text((taskId?.let { "$it  " } ?: "") + if (taskId == null) "New task" else "Edit task", Modifier.weight(1f), style = TaskType.rowTitle, color = colors.fg)
        }
        if (state.conflicted) ConflictBox(state, draft, saving, validation == null, useTheirs = {
            val newer = state.newer ?: return@ConflictBox
            state = TaskEditorState.of(newer)
        }, keepMine = {
            val newer = state.newer ?: return@ConflictBox
            val mine = state.copy(baseRevision = newer.revision, shown = newer, conflicted = false, newer = null)
            state = mine
            save(mine)
        })
        else if (movedOn) Text(
            "${authorLabel(live.updatedBy).replaceFirstChar { it.uppercase() }} changed this task while you edit. Saving will ask which version to keep.",
            Modifier.fillMaxWidth().border(1.dp, colors.border, RoundedCornerShape(12.dp)).padding(10.dp),
            style = TaskType.xs, color = colors.fgMuted,
        )
        Field("Title", draft.title, { update { copy(title = it) } })
        Field("Tickets and links", draft.refs, { update { copy(refs = it) } }, minLines = 2, placeholder = "One per line, like EX-1234, #1234 or a link", style = mono)
        Field("Description", draft.description, { update { copy(description = it) } }, minLines = 4)
        Field("Done when", draft.acceptance, { update { copy(acceptance = it) } }, minLines = 2, placeholder = "Acceptance, optional")
        Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text("Status", style = label, color = colors.fgSubtle)
            FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                TASK_STATUSES.forEach { status ->
                    FilterChip(draft.status == status, { update { copy(status = status) } }, enabled = !saving, label = { Text(taskStatusLabel(status)) })
                }
            }
            // A todo task has no time to show; a finished one keeps the time it spent in progress.
            state.shown?.let { shown -> inProgressText(shown)?.takeIf { shown.status == "in_progress" || (shown.inProgressMinutes ?: 0) > 0 } }
                ?.let { Text(it, style = TaskType.xs, color = colors.fgSubtle) }
        }
        if (draft.status == "blocked") Field("Why it is blocked", draft.blockedReason, { update { copy(blockedReason = it) } }, placeholder = "Besides its dependencies")
        Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text("Waits for", style = label, color = colors.fgSubtle)
            if (choices.isEmpty()) Text("No other task to wait for.", style = TaskType.xs, color = colors.fgSubtle)
            else Column(
                Modifier.fillMaxWidth().heightIn(max = 220.dp).border(1.dp, colors.border, RoundedCornerShape(10.dp)).verticalScroll(rememberScrollState()),
            ) {
                choices.forEach { choice ->
                    val checked = choice.id in draft.blockedBy
                    Row(
                        Modifier.fillMaxWidth().clickable(enabled = !saving, role = Role.Checkbox) {
                            update { copy(blockedBy = if (checked) blockedBy - choice.id else blockedBy.filter { it != choice.id } + choice.id) }
                        }.padding(horizontal = 4.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Checkbox(checked, onCheckedChange = null, Modifier.padding(10.dp))
                        Text(androidx.compose.ui.text.buildAnnotatedString {
                            withStyle(androidx.compose.ui.text.SpanStyle(fontFamily = com.mihaisaru.harness.ui.theme.JetBrainsMono, color = colors.fgSubtle)) { append(choice.id) }
                            append(" ${choice.title} ")
                            withStyle(androidx.compose.ui.text.SpanStyle(color = colors.fgSubtle)) { append("· ${taskStatusLabel(choice.status)}") }
                        }, style = TaskType.xs, color = colors.fg)
                    }
                }
            }
            draft.blockedBy.filter { id -> choices.none { it.id == id } }.forEach { id ->
                Text("Also waits for $id, which is archived.", style = TaskType.xs, color = colors.fgSubtle)
            }
        }
        Field("Write scopes", draft.writeScopes, { update { copy(writeScopes = it) } }, minLines = 2, placeholder = "One path per line, relative to the project", style = mono)
        if (validation != null && validation != TITLE_MISSING) Text(validation, style = TaskType.xs, color = colors.danger)
        problem?.let { Text(it, style = TaskType.xs, color = colors.danger) }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Button(onClick = { save(state) }, enabled = !saving && validation == null && !state.conflicted && (dirty || taskId == null)) {
                Text(if (saving) "Saving…" else if (taskId == null) "Add task" else "Save")
            }
            TextButton(onClick = onBack) { Text("Cancel") }
        }
    }
}

@Composable
private fun ConflictBox(state: TaskEditorState, draft: TaskEditorDraft, saving: Boolean, valid: Boolean, useTheirs: () -> Unit, keepMine: () -> Unit) {
    val colors = Jarvis.colors
    val newer = state.newer
    Column(
        Modifier.fillMaxWidth().background(colors.warning.copy(alpha = .10f), RoundedCornerShape(12.dp))
            .border(1.dp, colors.warning.copy(alpha = .5f), RoundedCornerShape(12.dp)).padding(12.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        if (newer == null) {
            Text("This task is gone from the board.", style = TaskType.xsSemibold, color = colors.fg)
            Text("It may have been archived. Your changes were not saved.", style = TaskType.xs, color = colors.fgMuted)
            return@Column
        }
        Text("Changed by ${authorLabel(newer.updatedBy)} since you opened it. Nothing was saved.", style = TaskType.xsSemibold, color = colors.fg)
        val differing = changedFields(draft, newer)
        if (differing.isEmpty()) Text("Their version says the same as yours.", style = TaskType.xs, color = colors.fgMuted)
        differing.forEach { name ->
            Column {
                Text("$name, now", style = TaskType.xsMedium, color = colors.fgMuted)
                Text(fieldValueText(newer, name), style = TaskType.xs, color = colors.fg, maxLines = 3)
            }
        }
        FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            OutlinedButton(onClick = useTheirs) { Text("Use their version") }
            Button(onClick = keepMine, enabled = !saving && valid) { Text("Save mine over it") }
        }
    }
}
