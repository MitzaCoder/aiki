package io.github.mitzacoder.kemiri.features.chat

import io.github.mitzacoder.kemiri.data.WatchStatus
import io.github.mitzacoder.kemiri.protocol.ProjectSummary
import kotlinx.serialization.json.JsonElement
import io.github.mitzacoder.kemiri.protocol.BoardQuestion

/** Blocking asks/approvals in this conversation, not warnings, retries, queues or timed task waiting. */
internal fun agentWaitingForUser(questions: List<BoardQuestion>, threadId: String? = null, workerTaskId: String? = null, worker: Boolean = false): Boolean =
    questions.any { it.status == "open" && (it.blocksWork ?: (it.kind != "warning")) && (it.threadId ?: "main") == (threadId ?: "main") && (!worker || (workerTaskId != null && it.taskId == workerTaskId)) }

/** Waiting has its question card, never a standalone mascot row, even during a live run. */
internal fun showsAgentActivityRow(waiting: Boolean, working: Boolean, completed: Boolean): Boolean =
    !waiting && (working || completed)

internal fun agentFinished(previousRunning: Boolean, running: Boolean, waiting: Boolean, connected: Boolean, failed: Boolean) =
    previousRunning && !running && !waiting && connected && !failed

/**
 * What the chat says about its own state, as the web's `ProjectChat` and `WorkerTranscript` word it: whether the
 * coordinator is working before a reply streams, the composer's hint, and the banner while the transcript is away.
 */

/**
 * Whether the transcript ends in "Working…": the run is on but nothing of a reply streams yet (web `working`: busy and
 * no live turn). A worker's page shows it for the whole run, as the web's does.
 */
internal fun isWorking(live: JsonElement?, worker: Boolean = false): Boolean {
    val doc = live.obj() ?: return false
    if (doc["run"] == null) return false
    if (worker) return true
    return doc["generation"].obj()?.get("message") == null && doc["tools"].objects().isEmpty()
}

/** Whether a message can go: main needs a coordinator model, a thread runs on its own (web `canChat`). */
internal fun canChat(project: ProjectSummary?, thread: Boolean): Boolean =
    project != null && (thread || project.coordinator.model != null)

/** The composer's hint (web `ProjectChat`'s `placeholder`, else `Composer`'s own). */
internal fun composerHint(canChat: Boolean, ready: Boolean, thread: Boolean, busy: Boolean): String = when {
    !canChat -> "Choose a coordinator model first"
    !ready -> "Reconnecting…"
    thread -> "Message this thread directly…"
    busy -> "Send — the coordinator gets it at its next step…"
    else -> "Message the coordinator…"
}

/** The banner above the composer while the transcript is not live; null while it is. */
internal fun transcriptBanner(status: WatchStatus, error: String?, worker: Boolean): String? {
    val what = if (worker) "the worker's transcript" else "the transcript"
    val detail = error?.takeIf(String::isNotBlank)?.let { " $it" }.orEmpty()
    return when (status) {
        WatchStatus.Live -> null
        WatchStatus.Connecting -> "Connecting to $what…"
        WatchStatus.Reconnecting -> "Reconnecting to $what…$detail"
        WatchStatus.Ended -> "${what.replaceFirstChar(Char::uppercase)} view stopped.$detail"
        WatchStatus.Stopped -> if (worker) "The worker's transcript view stopped.$detail" else "The transcript view is stopped."
    }
}
