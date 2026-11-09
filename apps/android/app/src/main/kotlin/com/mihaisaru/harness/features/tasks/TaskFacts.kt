package com.mihaisaru.harness.features.tasks

import com.mihaisaru.harness.protocol.*
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle

/*
 * What the Tasks list, the task sheet and the question pin say about time, owners, blockers and waiting questions.
 * Pure functions, ported from the web's `lib/relative-time.ts`, `lib/board.ts` and `lib/threads.ts` with their tests
 * (TaskFactsTest); change both together.
 */

// --- times -------------------------------------------------------------------------------------------------------

/** A timestamp as a short phrase relative to [now]: "just now", "5 min ago", "3 h ago", "2 d ago", then a date. */
fun relativeTime(at: String, now: Long = System.currentTimeMillis()): String {
    val ms = isoMillisOrNull(at) ?: return "at an unknown time"
    val seconds = Math.round((now - ms) / 1000.0)
    if (seconds < 45) return "just now"
    val minutes = Math.round(seconds / 60.0)
    if (minutes < 60) return "${maxOf(1, minutes)} min ago"
    val hours = Math.round(minutes / 60.0)
    if (hours < 24) return "$hours h ago"
    val days = Math.round(hours / 24.0)
    if (days < 30) return "$days d ago"
    return DateTimeFormatter.ofLocalizedDate(FormatStyle.SHORT).withZone(ZoneId.systemDefault()).format(Instant.ofEpochMilli(ms))
}

/** [relativeTime] for a narrow column: one unit and no "ago" ("now", "5m", "3h", "2d", then a short date); empty when unreadable. */
fun compactRelativeTime(at: String, now: Long = System.currentTimeMillis()): String {
    val ms = isoMillisOrNull(at) ?: return ""
    val seconds = Math.round((now - ms) / 1000.0)
    if (seconds < 45) return "now"
    val minutes = Math.round(seconds / 60.0)
    if (minutes < 60) return "${maxOf(1, minutes)}m"
    val hours = Math.round(minutes / 60.0)
    if (hours < 24) return "${hours}h"
    val days = Math.round(hours / 24.0)
    if (days < 30) return "${days}d"
    return DateTimeFormatter.ofPattern("MMM d").withZone(ZoneId.systemDefault()).format(Instant.ofEpochMilli(ms))
}

private fun isoMillisOrNull(value: String): Long? = runCatching { java.time.OffsetDateTime.parse(value).toInstant().toEpochMilli() }
    .recoverCatching { Instant.parse(value).toEpochMilli() }.getOrNull()

/** A row's time, short enough for its narrow column: time in progress while working, else how long ago it moved. */
fun rowTime(row: TaskRow, now: Long = System.currentTimeMillis()): String {
    val task = row.task
    if (row.section == TaskSectionId.Working && task.inProgressMinutes != null) return formatMinutes(task.inProgressMinutes.toDouble())
    return compactRelativeTime(if (row.section == TaskSectionId.Closed) task.settledAt ?: task.updatedAt else task.updatedAt, now)
}

/** The same time in words, for a screen reader or a long press. */
fun rowTimeWords(row: TaskRow, now: Long = System.currentTimeMillis()): String {
    val task = row.task
    if (row.section == TaskSectionId.Working && task.inProgressMinutes != null) return "${formatMinutes(task.inProgressMinutes.toDouble())} in progress"
    if (row.section == TaskSectionId.Closed) return "${if (task.status == "dropped") "Dropped" else "Done"} ${relativeTime(task.settledAt ?: task.updatedAt, now)}"
    return "Updated ${relativeTime(task.updatedAt, now)}"
}

/** "1h 20m in progress" for the sheet; null for a task that has spent no time in progress. */
fun inProgressLine(task: BoardTask): String? {
    val minutes = task.inProgressMinutes ?: return null
    if (minutes <= 0 && task.status != "in_progress") return null
    return "${formatMinutes(minutes.toDouble())} in progress"
}

// --- the report ----------------------------------------------------------------------------------------------------

fun BoardTaskReport.section(section: ReportSection): String = when (section) {
    ReportSection.Now -> now
    ReportSection.Results -> results
    ReportSection.Next -> next
}

fun BoardTaskSnapshotReport.section(section: ReportSection): String = when (section) {
    ReportSection.Now -> now
    ReportSection.Results -> results
    ReportSection.Next -> next
}

fun hasReport(report: BoardTaskReport): Boolean = ReportSection.entries.any { report.section(it).isNotBlank() }

// --- owners, blockers, decisions -------------------------------------------------------------------------------

/** Who holds a task: a thread by name, or nobody. */
data class TaskOwner(val claimed: Boolean, val label: String, val threadId: String?, val main: Boolean)

fun taskOwner(task: BoardTask, threads: List<ThreadSummary>): TaskOwner {
    val threadId = task.ownerThreadId ?: return TaskOwner(claimed = false, label = "Unclaimed", threadId = null, main = false)
    return TaskOwner(claimed = true, label = threadName(threadId, threads), threadId = threadId, main = isMainThread(threadId))
}

/** A task another waits for; [settled] when it is finished, or archived or gone ([status] "unknown"). */
data class Blocker(val id: String, val title: String, val status: String, val settled: Boolean)

fun blockersOf(task: BoardTask, tasks: List<BoardTask>): List<Blocker> = task.blockedBy.map { id ->
    val found = tasks.firstOrNull { it.id == id } ?: return@map Blocker(id, "", "unknown", settled = true)
    Blocker(id, found.title, found.status, settled = isSettled(found.status))
}

/** The decisions a task is tied to, newest first as the board has them. */
fun decisionsFor(decisions: List<BoardDecision>, taskId: String): List<BoardDecision> = decisions.filter { it.taskId == taskId }

// --- questions and warnings --------------------------------------------------------------------------------------

/** Whether a question or a worker belongs to a thread: main's carry no thread or "main". */
fun inThread(itemThreadId: String?, threadId: String?): Boolean =
    if (isMainThread(threadId)) isMainThread(itemThreadId) else itemThreadId == threadId

/** The background thread that asked, by name; null for main. The answer goes to the thread that asked. */
fun questionAskedBy(question: BoardQuestion, threads: List<ThreadSummary>): String? =
    if (isMainThread(question.threadId)) null else threadName(question.threadId, threads)

/** "T4 · Fix parser recovery" for a question about a task the board holds, the bare ID for one it does not, null for none. */
fun questionTaskLabel(question: BoardQuestion, task: (String) -> BoardTask?): String? {
    val id = question.taskId ?: return null
    return task(id)?.let { "${it.id} · ${it.title}" } ?: id
}

data class QuestionPin(val current: BoardQuestion?, val others: List<BoardQuestion>, val more: Int)

/**
 * What the question pin shows: one question open to answer (the chosen one, else the oldest), and the others as one-line
 * rows that switch to them. The rows give every other asker a turn before a second question from the same one; the rest
 * is counted for the Tasks view.
 */
fun questionPin(open: List<BoardQuestion>, chosenId: String?, rows: Int = 2): QuestionPin {
    val current = open.firstOrNull { it.id == chosenId } ?: open.firstOrNull()
    val rest = open.filter { it !== current }
    fun asker(question: BoardQuestion) = if (isMainThread(question.threadId)) MAIN_THREAD_ID else question.threadId ?: MAIN_THREAD_ID
    val seen = HashSet<String>().apply { current?.let { add(asker(it)) } }
    val first = mutableListOf<BoardQuestion>()
    val later = mutableListOf<BoardQuestion>()
    for (question in rest) if (seen.add(asker(question))) first += question else later += question
    val shown = (first + later).take(rows)
    return QuestionPin(current, rest.filter { question -> shown.any { it === question } }, rest.size - shown.size)
}
