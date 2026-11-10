package io.github.mitzacoder.aiki.data

import io.github.mitzacoder.aiki.protocol.*

/**
 * Requests that only some backends answer, by the feature their hello lists (`packages/client` and the web app check
 * the same names). Each helper throws `unsupported_feature` before sending to a backend without it, so screens check
 * [ConnectionState.supports] to hide what the backend cannot do and never see that error in normal use.
 */
object HarnessFeature {
    const val STORAGE = "storage"
    const val TASK_REPORTS = "task-reports"
    const val TASK_LINKS = "task-links"
    const val CACHE_STATS = "cache-stats"
    const val REF_STATUS = "ref-status"
    const val BOARD_MOVES = "board-moves"
    const val REF_DETAILS = "ref-details"
    const val TERMINAL = "terminal"
}

fun HarnessClient.supports(feature: String): Boolean = state.value.supports(feature)

private fun HarnessClient.requireFeature(feature: String) {
    if (!supports(feature)) throw ClientException("unsupported_feature", "This backend does not support $feature")
}

/**
 * The live state of a project's refs (pull requests, issues, Jira tickets) the backend can read; the rest are left out.
 * Asks once for each distinct ref, at most [MAX_REF_STATUS_REFS]. The backend caches, so asking every few minutes is
 * fine. Needs `ref-status`.
 */
suspend fun HarnessClient.readRefStatus(projectId: String, refs: Collection<String>): List<RefStatus> {
    requireFeature(HarnessFeature.REF_STATUS)
    val distinct = refs.distinct().take(MAX_REF_STATUS_REFS)
    if (distinct.isEmpty()) return emptyList()
    return request(RefsStatusRequest(projectId = projectId, refs = distinct)).statuses
}

/** What a ref's card shows; null when the backend cannot read it. The backend caches briefly. Needs `ref-details`. */
suspend fun HarnessClient.readRefDetails(projectId: String, ref: String): RefDetails? {
    requireFeature(HarnessFeature.REF_DETAILS)
    return request(RefsDetailsRequest(projectId = projectId, ref = ref)).details
}

/**
 * What the backend's model requests cost over the last [days] (server default 30) and how much re-billed a prompt the
 * provider should still have cached. [utcOffsetMinutes] buckets the days in the device's zone. Needs `cache-stats`.
 */
suspend fun HarnessClient.readCacheStats(days: Long? = null, projectId: String? = null, utcOffsetMinutes: Long? = null): CacheStats {
    requireFeature(HarnessFeature.CACHE_STATS)
    return request(CacheStatsRequest(days = days, projectId = projectId, utcOffsetMinutes = utcOffsetMinutes)).stats
}

/** What a project's worker and thread workspaces take on disk, largest first, measured a few minutes ago at most. Needs `storage`. */
suspend fun HarnessClient.readProjectStorage(projectId: String): ProjectsStorageResponse {
    requireFeature(HarnessFeature.STORAGE)
    return request(ProjectsStorageRequest(projectId = projectId))
}

/**
 * Removes finished workspaces: [itemIds], or every removable one when null. The server refuses running ones and says why
 * in `refused`; the project checkout itself is never touched. Needs `storage`.
 */
suspend fun HarnessClient.cleanProjectStorage(projectId: String, itemIds: List<String>? = null): ProjectsStorageCleanResponse {
    requireFeature(HarnessFeature.STORAGE)
    return request(ProjectsStorageCleanRequest(projectId = projectId, itemIds = itemIds))
}

/** A task's snapshots, oldest first: one per milestone a report write named and one per status change. Needs `task-reports`. */
suspend fun HarnessClient.readTaskHistory(projectId: String, taskId: String): List<BoardTaskSnapshot> {
    requireFeature(HarnessFeature.TASK_REPORTS)
    return request(BoardTaskHistoryRequest(projectId = projectId, taskId = taskId)).snapshots
}

/** Task feedback and timeline share one read. Needs task-links. */
suspend fun HarnessClient.readTaskTimeline(projectId: String, taskId: String, kinds: List<String>? = null): BoardTaskTimelineResponse {
    requireFeature(HarnessFeature.TASK_LINKS)
    return request(BoardTaskTimelineRequest(projectId = projectId, taskId = taskId, kinds = kinds))
}
suspend fun HarnessClient.setFeedbackState(projectId: String, taskId: String, feedbackId: String, state: String): BoardFeedback {
    requireFeature(HarnessFeature.TASK_LINKS)
    return request(BoardFeedbackSetRequest(projectId = projectId, taskId = taskId, feedbackId = feedbackId, state = state)).feedback
}

/**
 * Creates a task (no [taskId]) or changes one read at [expectedRevision]; `board_conflict` when the row moved on. A
 * [note] (why the user moved it) reaches the coordinator with the change and needs `board-moves`: check it first, and
 * without it send the reason as a `[task T1] ...` message the way the web app does. The answer is the task as stored.
 */
suspend fun HarnessClient.saveBoardTask(
    projectId: String,
    task: BoardTaskInput,
    taskId: String? = null,
    expectedRevision: Long? = null,
    note: String? = null,
): BoardTask {
    if (note != null) requireFeature(HarnessFeature.BOARD_MOVES)
    return request(BoardTaskSaveRequest(projectId = projectId, taskId = taskId, expectedRevision = expectedRevision, task = task, note = note)).task
}

/**
 * One project setting to change, as `projects.configure` takes it. The prompt cache and link settings exist only on
 * backends whose [ProjectSummary] has `longPromptCache` / `links`; offer them only then, as the web app does.
 */
sealed interface ProjectSetting {
    /** "coordinators", "all" or "off"; null restores the server's default. */
    data class LongPromptCache(val value: String?) : ProjectSetting
    data class KeepPromptCacheWarm(val value: Boolean?) : ProjectSetting
    data class PromptCacheWarmHours(val value: Long?) : ProjectSetting
    /** "off", "screenshots" or "screenshots-and-videos" (Show UI changes); null restores the server's default. */
    data class UiProof(val value: String?) : ProjectSetting
    /** Where bare ticket keys and PR numbers point; null lets the server fill them in again. */
    data class Links(val value: ProjectLinks?) : ProjectSetting
}

suspend fun HarnessClient.configureProject(projectId: String, setting: ProjectSetting): ProjectSummary {
    val (request, cleared) = when (setting) {
        is ProjectSetting.LongPromptCache -> ProjectsConfigureRequest(projectId = projectId, longPromptCache = setting.value) to "longPromptCache".takeIf { setting.value == null }
        is ProjectSetting.KeepPromptCacheWarm -> ProjectsConfigureRequest(projectId = projectId, keepPromptCacheWarm = setting.value) to "keepPromptCacheWarm".takeIf { setting.value == null }
        is ProjectSetting.PromptCacheWarmHours -> ProjectsConfigureRequest(projectId = projectId, promptCacheWarmHours = setting.value) to "promptCacheWarmHours".takeIf { setting.value == null }
        is ProjectSetting.UiProof -> ProjectsConfigureRequest(projectId = projectId, uiProof = setting.value) to "uiProof".takeIf { setting.value == null }
        is ProjectSetting.Links -> ProjectsConfigureRequest(projectId = projectId, links = setting.value) to "links".takeIf { setting.value == null }
    }
    return request(request, explicitNulls = setOfNotNull(cleared)).project
}
