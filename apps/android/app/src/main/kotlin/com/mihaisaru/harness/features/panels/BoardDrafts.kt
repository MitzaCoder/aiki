package com.mihaisaru.harness.features.panels

import androidx.compose.runtime.saveable.Saver
import com.mihaisaru.harness.data.wireJson
import com.mihaisaru.harness.protocol.*
import kotlinx.serialization.KSerializer
import kotlinx.serialization.Serializable

// No refs: a save without them keeps the task's own, so a stale draft never overwrites the coordinator's.
internal fun BoardTask.input() = BoardTaskInput(
    title = title, description = description, acceptance = acceptance, status = status,
    blockedBy = blockedBy, blockedReason = blockedReason, writeScopes = writeScopes,
)

@Serializable
internal data class TaskDraft(
    val id: String?,
    val revision: Long?,
    val input: BoardTaskInput,
    val retainedBlockedBy: List<String> = if (id == null) emptyList() else input.blockedBy,
) {
    fun useTheirs(task: BoardTask) = TaskDraft(task.id, task.revision, task.input())
    fun keepMine(task: BoardTask) = copy(revision = task.revision)
}

@Serializable
internal data class BoardEditorState(val editing: TaskDraft? = null)

@Serializable
internal data class TaskEditorState(
    val draft: TaskDraft,
    val conflict: BoardTask? = null,
    val error: String? = null,
    val blockers: String = draft.input.blockedBy.joinToString(", "),
    val scopes: String = draft.input.writeScopes.joinToString(", "),
)

@Serializable
internal data class QuestionEditorState(val revision: Long, val answer: String = "", val conflict: BoardQuestion? = null)

@Serializable
private data class ScopedBoardDraft<T>(val scope: String, val value: T)

internal fun boardDraftKey(backend: String, project: String, kind: String, id: String): String =
    wireJson.encodeToString(listOf(backend, project, kind, id))

internal fun <T> saveBoardDraft(scope: String, value: T, serializer: KSerializer<T>): String =
    wireJson.encodeToString(ScopedBoardDraft.serializer(serializer), ScopedBoardDraft(scope, value))

internal fun <T> restoreBoardDraft(scope: String, value: String, serializer: KSerializer<T>): T? = runCatching {
    wireJson.decodeFromString(ScopedBoardDraft.serializer(serializer), value).takeIf { it.scope == scope }?.value
}.getOrNull()

internal fun <T : Any> boardDraftSaver(scope: String, serializer: KSerializer<T>): Saver<T, String> = Saver(
    save = { saveBoardDraft(scope, it, serializer) },
    restore = { restoreBoardDraft(scope, it, serializer) },
)

internal fun taskConflictFields(draft: TaskDraft, latest: BoardTask): List<Pair<String, String>> = buildList {
    if (draft.input.title != latest.title) add("Title" to latest.title)
    if (draft.input.description != latest.description) add("Description" to latest.description)
    if (draft.input.acceptance != latest.acceptance) add("Acceptance" to (latest.acceptance ?: "(none)"))
    if (draft.input.status != latest.status) add("Status" to latest.status)
    if (draft.input.blockedBy != latest.blockedBy) add("Blocked by" to latest.blockedBy.joinToString(", ").ifEmpty { "(none)" })
    if (draft.input.blockedReason != latest.blockedReason) add("Blocked reason" to (latest.blockedReason ?: "(none)"))
    if (draft.input.writeScopes != latest.writeScopes) add("Write scopes" to latest.writeScopes.joinToString("\n").ifEmpty { "(none)" })
}
