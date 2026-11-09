package com.mihaisaru.harness.features.panels

import com.mihaisaru.harness.features.status.exactTime
import com.mihaisaru.harness.features.status.relativeTime
import com.mihaisaru.harness.navigation.PanelTab
import com.mihaisaru.harness.protocol.Artifact
import com.mihaisaru.harness.protocol.ThreadSummary
import com.mihaisaru.harness.protocol.BoardTask
import com.mihaisaru.harness.protocol.WorkerSummary
import com.mihaisaru.harness.ui.components.Lucide
import com.mihaisaru.harness.ui.components.LucideIcon

/** Bare worker IDs survive ownership handoff/release. Neither current ownership nor
 * even a unique workers.list match proves origin. Return text only: no route or
 * worker metadata can be derived until the protocol supplies authoritative provenance. */
internal fun boardWorkerLabels(task: BoardTask): List<String> = task.workerIds.map { "Worker ID · $it" }

/** A tab's name; the Board tab is "Tasks" on a backend that keeps task reports ([tasks]). */
internal fun panelTabLabel(tab: PanelTab, tasks: Boolean = false) = when {
    tab == PanelTab.Threads -> "Background"
    tab == PanelTab.Board && tasks -> "Tasks"
    else -> tab.label
}
internal fun panelTabDescription(tab: PanelTab, count: Int, tasks: Boolean = false): String = panelTabLabel(tab, tasks) + if (count <= 0) "" else when (tab) {
    PanelTab.Board -> ", $count questions waiting for you"
    PanelTab.Threads -> ", $count running threads"
    else -> ", $count"
}
internal fun panelTabIcon(tab: PanelTab) = when (tab) {
    PanelTab.Board -> Lucide.Kanban
    PanelTab.Threads -> Lucide.Layers
    PanelTab.Info -> Lucide.Info
    PanelTab.Memory -> Lucide.Brain
    PanelTab.Artifacts -> Lucide.Paperclip
}
internal data class BoardOrderState(val ids: List<String>? = null, val saving: Boolean = false, val error: String? = null, val status: String? = null) {
    fun failed(message: String) = BoardOrderState(error = message)
}
/** Project identities only: never overwrite fresh fields/revisions with a drag-start snapshot. */
internal fun projectOrder(server: List<String>, optimistic: List<String>?): List<String> =
    if (optimistic == null) server else optimistic.filter { it in server }.distinct() + server.filter { it !in optimistic }
internal fun moveOrder(ids: List<String>, id: String, to: Int): List<String> {
    if (id !in ids || to !in ids.indices) return ids
    return ids.toMutableList().apply { remove(id); add(to, id) }
}
internal fun threadActivity(thread: ThreadSummary): String = when (thread.status) {
    "failed" -> thread.failure ?: "Its last turn failed."
    "stopped" -> "Stopped; nothing runs."
    "done" -> thread.summary?.lineSequence()?.map { it.trim().trimStart('#').trim() }?.firstOrNull { it.isNotEmpty() }?.take(140) ?: "Finished."
    else -> thread.current?.takeIf { it.isNotBlank() } ?: if (thread.status == "running") "Working…" else "Waiting for a message or its workers."
}
internal fun threadRank(thread: ThreadSummary) = when {
    thread.openQuestions > 0 && thread.status in listOf("running", "idle") -> 0
    thread.status == "running" -> 1
    thread.status == "idle" -> 2
    thread.status == "failed" -> 3
    else -> 4
}

internal fun panelQuestionVisible(routeThread: String?, questionThread: String?) = normalizedThread(routeThread) == "main" || normalizedThread(routeThread) == normalizedThread(questionThread)

internal fun moveGroupOrder(ids: List<String>, group: List<String>, id: String, target: String): List<String> {
    val members = ids.filter { it in group }
    if (id !in members || target !in members) return ids
    val reordered = moveOrder(members, id, members.indexOf(target)).iterator()
    return ids.map { if (it in members) reordered.next() else it }
}

internal fun projectGroupOrder(server: List<String>, optimistic: List<String>?, group: List<String>): List<String> {
    if (optimistic == null) return server
    val members = server.filter { it in group }
    val projected = projectOrder(members, optimistic).iterator()
    return server.map { if (it in members) projected.next() else it }
}

internal val panelTaskStatuses = listOf("in_progress", "review", "blocked", "todo", "done", "dropped")
internal fun panelTaskInitiallyCollapsed(status: String) = status in listOf("done", "dropped")

internal val panelTabOrder = listOf(PanelTab.Board, PanelTab.Threads, PanelTab.Info, PanelTab.Memory, PanelTab.Artifacts)
internal fun panelVisibleLabels(width: Float, tabs: List<PanelTab>, active: PanelTab?, tasks: Boolean = false): Set<PanelTab> {
    val iconWidth = tabs.size * 48f
    val allWidth = iconWidth + tabs.sumOf { panelTabLabel(it, tasks).length * 7 + 8 }
    val activeWidth = iconWidth + (active?.let { panelTabLabel(it, tasks).length * 7 + 8 } ?: 0)
    return when { width >= allWidth -> tabs.toSet(); width >= activeWidth -> setOfNotNull(active); else -> emptySet() }
}
internal fun panelBytes(bytes: Long): String = when {
    bytes < 0 -> "—"
    bytes < 1024 -> "$bytes B"
    bytes < 1024 * 1024 -> String.format(java.util.Locale.ROOT, "%.1f KB", bytes / 1024.0)
    else -> String.format(java.util.Locale.ROOT, "%.1f MB", bytes / (1024.0 * 1024))
}
internal fun panelRelativeTime(value: String, now: java.time.Instant = java.time.Instant.now()): String = try {
    val seconds = java.time.Duration.between(java.time.Instant.parse(value), now).seconds.coerceAtLeast(0)
    when { seconds < 60 -> "Just now"; seconds < 3600 -> "${seconds / 60} min ago"; seconds < 86400 -> "${seconds / 3600} hr ago"; else -> "${seconds / 86400} days ago" }
} catch (_: java.time.DateTimeException) { value }

internal fun panelPreviewRenewDelay(expiresAt: String, nowMillis: Long): Long = try {
    (java.time.Instant.parse(expiresAt).toEpochMilli() - nowMillis - 5_000).coerceIn(1_000L, 3_600_000L)
} catch (_: java.time.DateTimeException) { 60_000L }
internal fun panelArtifactOwner(thread: String, worker: String?) = (if (thread == "main") "Main" else thread) + (worker?.let { " · $it" } ?: "")
internal fun panelIsolationLabel(value: String) = when (value) { "shared" -> "Shared checkout"; "workspace" -> "Own workspace"; else -> value.replace('_', ' ').replaceFirstChar { it.uppercase() } }

// --- Background and Workers (web lib/threads.ts, lib/workers.ts) ---------------------------------------------------

/** "2 workers running", or nothing. */
internal fun runningWorkersText(count: Long): String? = when { count <= 0 -> null; count == 1L -> "1 worker running"; else -> "$count workers running" }

/** "Owns T3, T7", or nothing; long lists keep the first three and count the rest. */
internal fun ownedTasksText(taskIds: List<String>): String? {
    if (taskIds.isEmpty()) return null
    val shown = taskIds.take(3).joinToString(", ")
    return if (taskIds.size > 3) "Owns $shown +${taskIds.size - 3}" else "Owns $shown"
}

/** "1 question for you", or nothing. */
internal fun openQuestionsText(count: Long): String? = when { count <= 0 -> null; count == 1L -> "1 question for you"; else -> "$count questions for you" }

/** Who started a thread, in words: "Started by main", "Scheduled · Nightly triage", "Started by you". */
internal fun threadStartedByText(thread: ThreadSummary, scheduleName: (String) -> String?): String = when (thread.startedBy) {
    "schedule" -> thread.scheduleId?.let(scheduleName)?.let { "Scheduled · $it" } ?: "Started by a schedule"
    "user" -> "Started by you"
    "main" -> "Started by main"
    else -> "Main"
}

/** When a thread last moved: "Ended 3 h ago" once finished, "Active 2 min ago" while running, else "Updated …"; and the exact times. */
internal fun threadTimeText(thread: ThreadSummary, now: Long): Pair<String, String> {
    val at = thread.finishedAt ?: thread.updatedAt
    val verb = when { thread.finishedAt != null -> "Ended"; thread.status == "running" -> "Active"; else -> "Updated" }
    return "$verb ${relativeTime(at, now)}" to "Started ${exactTime(thread.createdAt)} · ${verb.lowercase()} ${exactTime(at)}"
}

/** A thread still doing or able to do work (client `isThreadActive`). */
internal fun threadActive(thread: ThreadSummary) = thread.status == "running" || thread.status == "idle"

/** Where a worker's tools run: the shared checkout, its workspace path, or that the workspace is gone. */
internal fun workerPlace(worker: WorkerSummary): String =
    if (worker.isolation == "shared") "shared checkout" else worker.workspacePath ?: "workspace removed"

/** Active workers first in the server's order, then the finished ones, newest first. */
internal fun sortWorkers(workers: List<WorkerSummary>): List<WorkerSummary> =
    workers.filter { it.status != "done" } + workers.filter { it.status == "done" }.sortedByDescending { it.updatedAt }

// --- Artifacts tab kind filter (web lib/artifacts.ts) --------------------------------------------------------------

private val artifactKindOrder = listOf("video", "image", "audio", "text", "file")

/** A kind as a chip says it: "Video", or "Videos" for more than one. */
internal fun panelArtifactKindLabel(kind: String, plural: Boolean = false): String = when (kind) {
    "video" -> if (plural) "Videos" else "Video"
    "image" -> if (plural) "Images" else "Image"
    "audio" -> "Audio"
    "text" -> "Text"
    "file" -> if (plural) "Files" else "File"
    else -> kind.replaceFirstChar { it.uppercase() }
}

/** How many of each kind a list holds, in the kinds' order, leaving out the absent ones (web `kindCounts`). */
internal fun panelArtifactKinds(artifacts: List<Artifact>): List<Pair<String, Int>> {
    val counts = artifacts.groupingBy { it.kind }.eachCount()
    return (artifactKindOrder + counts.keys.filter { it !in artifactKindOrder }).mapNotNull { kind -> counts[kind]?.let { kind to it } }
}

/** The icons the panels use beyond the shared set (Lucide 1.64.0, ISC). */
internal object PanelIcons {
    val Bot = LucideIcon("bot", "M12 8V4H8", "M6 8h12a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2Z", "M2 14h2", "M20 14h2", "M15 13v2", "M9 13v2")
    val CircleHelp = LucideIcon("circle-help", "M2 12a10 10 0 1 0 20 0a10 10 0 1 0 -20 0", "M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3", "M12 17h.01")
    val CircleStop = LucideIcon("circle-stop", "M2 12a10 10 0 1 0 20 0a10 10 0 1 0 -20 0", "M10 9h4a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1h-4a1 1 0 0 1-1-1v-4a1 1 0 0 1 1-1Z")
    val ClipboardList = LucideIcon("clipboard-list", "M9 2h6a1 1 0 0 1 1 1v2a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1Z",
        "M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2", "M12 11h4", "M12 16h4", "M8 11h.01", "M8 16h.01")
    val ArchiveRestore = LucideIcon("archive-restore", "M3 3h18a1 1 0 0 1 1 1v3a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z",
        "M4 8v11a2 2 0 0 0 2 2h2", "M20 8v11a2 2 0 0 1-2 2h-2", "m9 15 3-3 3 3", "M12 12v9")
    val Lock = LucideIcon("lock", "M5 11h14a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2Z", "M7 11V7a5 5 0 0 1 10 0v4")
    val Timer = LucideIcon("timer", "M10 2h4", "m12 14 3-3", "M4 14a8 8 0 1 0 16 0a8 8 0 1 0 -16 0")
    val Ban = LucideIcon("ban", "M2 12a10 10 0 1 0 20 0a10 10 0 1 0 -20 0", "M4.929 4.929 19.07 19.071")
}
