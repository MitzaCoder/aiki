package io.github.mitzacoder.aiki.navigation

import io.github.mitzacoder.aiki.protocol.*
import kotlin.math.roundToLong

/**
 * What a project row in the drawer and the chat header's counts say at a glance. Ports of the web's `lib/projects.ts`
 * (`projectStatus`, `timeAgo`), `lib/board.ts` (`questionBadgeText`, `questionsWaitingLabel`), `lib/threads.ts`
 * (`backgroundThreadsText`), `lib/relative-time.ts` (`elapsedFor`) and `lib/workers.ts`.
 */

enum class ProjectStatusTone { Ok, Busy, Warn, Error, Muted }

/** A row's status: a tone, two or three words, when it last answered or how many workers run, and the long version. */
data class ProjectStatus(val tone: ProjectStatusTone, val label: String, val detail: String? = null, val title: String)

private fun epochMillis(iso: String?): Long? = iso?.let { try { java.time.Instant.parse(it).toEpochMilli() } catch (_: java.time.DateTimeException) { null } }

/** "just now", "4m ago", "3h ago", "5d ago"; empty for a missing or invalid time. */
fun timeAgo(iso: String?, now: Long): String {
    val at = epochMillis(iso) ?: return ""
    val seconds = ((now - at) / 1000.0).roundToLong().coerceAtLeast(0)
    if (seconds < 45) return "just now"
    val minutes = (seconds / 60.0).roundToLong()
    if (minutes < 60) return "${minutes}m ago"
    val hours = (minutes / 60.0).roundToLong()
    if (hours < 24) return "${hours}h ago"
    return "${(hours / 24.0).roundToLong()}d ago"
}

/** How long something has run: "42s", "3m", "1h 5m"; empty for an invalid time. */
fun elapsedFor(at: String, now: Long): String {
    val start = epochMillis(at) ?: return ""
    val seconds = ((now - start) / 1000.0).roundToLong().coerceAtLeast(0)
    if (seconds < 60) return "${seconds}s"
    val minutes = seconds / 60
    if (minutes < 60) return "${minutes}m"
    val hours = minutes / 60
    val rest = minutes % 60
    return if (rest == 0L) "${hours}h" else "${hours}h ${rest}m"
}

private fun workersLabel(count: Long) = if (count == 1L) "1 worker" else "$count workers"

/** What one project is doing, from its state, its model and (when the backend sends it) its activity. */
fun projectStatus(project: ProjectSummary, now: Long): ProjectStatus {
    if (project.state == "failed") return ProjectStatus(ProjectStatusTone.Error, "Open failed", title = project.failure ?: "The project failed to open.")
    if (project.coordinator.model == null) {
        return ProjectStatus(ProjectStatusTone.Warn, "No model", title = "No coordinator model is chosen; this project cannot answer until it has one.")
    }
    val activity = project.activity ?: return if (project.state == "open") {
        ProjectStatus(ProjectStatusTone.Ok, "Open", title = "The project is open. This backend does not report activity.")
    } else ProjectStatus(ProjectStatusTone.Muted, "Closed", title = "The project is closed. This backend does not report activity.")
    val ago = timeAgo(activity.lastReplyAt, now)
    if (project.state == "closed") {
        return ProjectStatus(ProjectStatusTone.Muted, "Closed", activity.runningWorkers.takeIf { it > 0 }?.let(::workersLabel),
            "The project is closed.${if (ago.isNotEmpty()) " It last answered $ago." else ""}")
    }
    when (activity.coordinator) {
        "working" -> {
            val workers = activity.runningWorkers.takeIf { it > 0 }?.let(::workersLabel)
            val with = workers?.let { ", with $it running" }.orEmpty()
            val tool = activity.runningTool
            if (tool != null) {
                val elapsed = elapsedFor(tool.startedAt, now)
                return ProjectStatus(ProjectStatusTone.Busy, "Running ${tool.name}", elapsed.ifEmpty { null },
                    "The coordinator is running ${tool.name}${if (elapsed.isNotEmpty()) " ($elapsed)" else ""}$with.")
            }
            return ProjectStatus(ProjectStatusTone.Busy, "Working", workers, "The coordinator is answering$with.")
        }
        "failed" -> return ProjectStatus(ProjectStatusTone.Error, "Run failed", ago.ifEmpty { null },
            "The coordinator's last run failed${if (ago.isNotEmpty()) " $ago" else ""}.")
    }
    if (activity.runningWorkers > 0) {
        val workers = workersLabel(activity.runningWorkers)
        return ProjectStatus(ProjectStatusTone.Busy, workers, ago.ifEmpty { null },
            "$workers running${if (ago.isNotEmpty()) "; the coordinator last answered $ago" else ""}.")
    }
    if (ago.isEmpty()) return ProjectStatus(ProjectStatusTone.Muted, "Not started", title = "The coordinator has not answered yet.")
    return ProjectStatus(ProjectStatusTone.Muted, "Idle", ago, "The coordinator is idle; it last answered $ago.")
}

/** The count on a badge: nothing for none, "9+" past nine. */
fun questionBadgeText(count: Long?): String? = when {
    count == null || count <= 0 -> null
    count > 9 -> "9+"
    else -> count.toString()
}

fun questionsWaitingLabel(count: Long): String = if (count == 1L) "1 question waiting for you" else "$count questions waiting for you"

/** "2 in background" under a project with background threads going. */
fun backgroundThreadsText(count: Long?): String? = if (count == null || count <= 0) null else "$count in background"

/** Background threads still going: the Background button's count. */
fun activeBackgroundCount(threads: List<ThreadSummary>): Int = threads.count { !it.main && (it.status == "running" || it.status == "idle") }
