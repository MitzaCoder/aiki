package com.mihaisaru.harness.features.tasks

import com.mihaisaru.harness.protocol.BoardTask
import com.mihaisaru.harness.protocol.BoardTaskInput
import kotlinx.serialization.Serializable

/*
 * The task editor's rules, ported from the web's `apps/web/src/lib/board.ts` (draftFromTask, draftToInput, changedFields,
 * draftProblem, blockerChoices) with its tests (TaskEditorDraftTest); change both together.
 */

val TASK_STATUSES = listOf("todo", "in_progress", "blocked", "review", "done", "dropped")

/** A status as the editor's picker names it (web `taskStatusLabel`). */
fun taskStatusLabel(status: String): String = when (status) {
    "todo" -> "Todo"
    "in_progress" -> "In progress"
    "blocked" -> "Blocked"
    "review" -> "Review"
    "done" -> "Done"
    "dropped" -> "Dropped"
    else -> taskStatusWords(status)
}

/** A task as the editor holds it while the user types: tickets and write scopes as text, one per line. */
@Serializable
data class TaskEditorDraft(
    val title: String = "",
    val description: String = "",
    val acceptance: String = "",
    val refs: String = "",
    val status: String = "todo",
    val blockedBy: List<String> = emptyList(),
    val blockedReason: String = "",
    val writeScopes: String = "",
)

fun BoardTask.editorDraft() = TaskEditorDraft(
    title = title,
    description = description,
    acceptance = acceptance.orEmpty(),
    refs = refs.joinToString("\n"),
    status = status,
    blockedBy = blockedBy,
    blockedReason = blockedReason.orEmpty(),
    writeScopes = writeScopes.joinToString("\n"),
)

/** Lines or comma-separated entries, trimmed, without empties or repeats. */
fun parseList(text: String): List<String> = text.split('\n', ',').map { it.trim() }.filter { it.isNotEmpty() }.distinct()

/**
 * What a save sends. The refs go only when they differ from [baseRefs], the refs the draft started from: a save without
 * refs keeps the task's own, so an edit that never touched them cannot undo the coordinator's newer ones.
 */
fun TaskEditorDraft.toInput(baseRefs: List<String>? = null): BoardTaskInput {
    val refList = parseList(refs)
    return BoardTaskInput(
        title = title.trim(),
        description = description.trim(),
        acceptance = acceptance.trim().ifEmpty { null },
        refs = if (baseRefs != null && refList == baseRefs) null else refList,
        status = status,
        blockedBy = blockedBy.distinct(),
        blockedReason = blockedReason.trim().ifEmpty { null },
        writeScopes = parseList(writeScopes),
    )
}

private val fieldLabels = listOf("Title", "Description", "Acceptance", "Tickets and links", "Status", "Blocked by", "Blocked reason", "Write scopes")

private fun fieldsOf(draft: TaskEditorDraft): List<Any?> {
    val input = draft.toInput()
    return listOf(input.title, input.description, input.acceptance, input.refs, input.status, input.blockedBy, input.blockedReason, input.writeScopes)
}

/** The fields where the draft differs from a task, by label; empty when the draft says what the task says. */
fun changedFields(draft: TaskEditorDraft, task: BoardTask): List<String> {
    val mine = fieldsOf(draft)
    val theirs = fieldsOf(task.editorDraft())
    return fieldLabels.filterIndexed { index, _ -> mine[index] != theirs[index] }
}

fun draftIsDirty(draft: TaskEditorDraft, task: BoardTask?): Boolean =
    if (task == null) fieldsOf(draft) != fieldsOf(TaskEditorDraft()) else changedFields(draft, task).isNotEmpty()

/** The text a changed field shows in the "newer version" view. */
fun fieldValueText(task: BoardTask, label: String): String = when (label) {
    "Title" -> task.title
    "Description" -> task.description.ifEmpty { "(empty)" }
    "Acceptance" -> task.acceptance ?: "(none)"
    "Tickets and links" -> task.refs.joinToString(", ").ifEmpty { "(none)" }
    "Status" -> taskStatusLabel(task.status)
    "Blocked by" -> task.blockedBy.joinToString(", ").ifEmpty { "(nothing)" }
    "Blocked reason" -> task.blockedReason ?: "(none)"
    "Write scopes" -> task.writeScopes.joinToString(", ").ifEmpty { "(none)" }
    else -> ""
}

/** Who last changed a task, in words (web `authorLabel`). */
fun authorLabel(author: String): String = when (author) {
    "user" -> "you"
    "coordinator" -> "the coordinator"
    else -> "the harness"
}

/** Whether [taskId] lists [targetId] anywhere in its chain of dependencies. */
private fun dependsOn(tasks: List<BoardTask>, taskId: String, targetId: String, seen: MutableSet<String> = HashSet()): Boolean {
    if (!seen.add(taskId)) return false
    val task = tasks.firstOrNull { it.id == taskId } ?: return false
    return task.blockedBy.any { it == targetId || dependsOn(tasks, it, targetId, seen) }
}

/** The board's order: by `order`, then by ID read as numbers. */
val taskBoardOrder: Comparator<BoardTask> = compareBy<BoardTask> { it.order }.thenComparing({ it.id }, taskIdOrder)

/** The tasks a task may wait for: not itself and not one that waits for it, so the graph stays acyclic. */
fun blockerChoices(tasks: List<BoardTask>, taskId: String?): List<BoardTask> = tasks
    .filter { it.id != taskId }
    .filter { taskId == null || !dependsOn(tasks, it.id, taskId) }
    .sortedWith(taskBoardOrder)

/** What stops a draft from being saved, or null. The server checks again; this spares a round trip. */
fun draftProblem(draft: TaskEditorDraft, taskId: String?, tasks: List<BoardTask>): String? {
    if (draft.title.isBlank()) return TITLE_MISSING
    if (taskId != null && taskId in draft.blockedBy) return "A task cannot wait for itself."
    if (taskId != null) draft.blockedBy.firstOrNull { dependsOn(tasks, it, taskId) }?.let { return "$it already waits for $taskId." }
    return null
}

const val TITLE_MISSING = "A task needs a title."
