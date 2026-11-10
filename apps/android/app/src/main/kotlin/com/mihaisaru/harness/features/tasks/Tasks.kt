package com.mihaisaru.harness.features.tasks

import com.mihaisaru.harness.features.chat.markdownText

import com.mihaisaru.harness.protocol.*
import com.mihaisaru.harness.ui.theme.TaskStatusTone
import java.net.URI

/*
 * How tasks read once agents keep a report on each: the Tasks view's sections by what a task needs, a report's lines for
 * a row, and what changed between two snapshots. Pure functions, ported from the web's `apps/web/src/lib/tasks.ts` and
 * `packages/client/src/board.ts` with their tests (TasksTest); change both together.
 */

// --- words -------------------------------------------------------------------------------------------------------

/** A status as a person says it. */
fun taskStatusWords(status: String): String = when (status) {
    "todo" -> "To do"
    "in_progress" -> "Working"
    "blocked" -> "Blocked"
    "review" -> "Ready for review"
    "waiting" -> "Waiting"
    "done" -> "Done"
    "dropped" -> "Dropped"
    else -> status.replace('_', ' ').replaceFirstChar { it.uppercase() }
}

fun isSettled(status: String): Boolean = status == "done" || status == "dropped"

/** The tone a status wears, named for what it means (a task `in_progress` reads "working"). An unknown status reads as to do. */
fun taskStatusTone(status: String): TaskStatusTone = when (status) {
    "in_progress" -> TaskStatusTone.Working
    "review" -> TaskStatusTone.Review
    "waiting" -> TaskStatusTone.Waiting
    "blocked" -> TaskStatusTone.Blocked
    "done" -> TaskStatusTone.Done
    "dropped" -> TaskStatusTone.Dropped
    else -> TaskStatusTone.Todo
}

fun isMainThread(threadId: String?): Boolean = threadId == null || threadId == MAIN_THREAD_ID

/** A thread by its title: "Main" for main, else its title, else its ID. */
fun threadName(threadId: String?, threads: List<ThreadSummary>): String {
    if (isMainThread(threadId)) return "Main"
    return threads.firstOrNull { it.id == threadId }?.title?.takeIf { it.isNotEmpty() } ?: threadId.orEmpty()
}

/** Who wrote a report or a snapshot, in words. [workerTitle] names a worker when the list knows it. */
fun writerLabel(writer: BoardWriter?, threads: List<ThreadSummary> = emptyList(), workerTitle: (String) -> String? = { null }): String {
    if (writer == null) return "nobody yet"
    return when (writer.author) {
        "user" -> "you"
        "harness" -> "the harness"
        "coordinator" -> if (isMainThread(writer.threadId)) "the coordinator" else threadName(writer.threadId, threads)
        "worker" -> writer.workerId?.let(workerTitle)?.takeIf { it.isNotEmpty() } ?: "a worker"
        else -> writer.author
    }
}

/** Who wrote, in a couple of words for a header: a worker by its ID, since its title can be a whole sentence. */
fun shortWriterLabel(writer: BoardWriter?, threads: List<ThreadSummary> = emptyList()): String =
    if (writer?.author == "worker") writer.workerId ?: "a worker" else writerLabel(writer, threads)

fun isWarning(item: BoardQuestion): Boolean = item.kind == "warning"

/** "2 questions waiting for you", "1 warning waiting for you", "1 question and 1 warning waiting for you". */
fun itemsWaitingLabel(items: List<BoardQuestion>): String {
    val warnings = items.count(::isWarning)
    val questions = items.size - warnings
    fun part(count: Int, noun: String) = "$count $noun${if (count == 1) "" else "s"}"
    return when {
        warnings == 0 -> "${part(questions, "question")} waiting for you"
        questions == 0 -> "${part(warnings, "warning")} waiting for you"
        else -> "${part(questions, "question")} and ${part(warnings, "warning")} waiting for you"
    }
}

// --- refs: tickets, PRs and links ---------------------------------------------------------------------------------

/** A ref that is a web address, as a URI; null for a ticket key, a PR number or anything else. */
fun refUrl(ref: String): URI? {
    if (!Regex("^https?://", RegexOption.IGNORE_CASE).containsMatchIn(ref)) return null
    return runCatching { URI(ref) }.getOrNull()?.takeIf { !it.host.isNullOrEmpty() }
}

private fun pathParts(url: URI): List<String> = url.rawPath.orEmpty().split('/').filter { it.isNotEmpty() }

/**
 * A ref as a chip says it: a ticket key or PR number as written, a link by what it points at ("#1234" for a pull
 * request or issue, "web#1234" when the project has several repositories, "EX-1234" for a ticket's page), else by its
 * site.
 */
fun refLabel(ref: String, links: ProjectLinks? = null): String {
    val url = refUrl(ref) ?: return ref.trim()
    val path = pathParts(url)
    val numbered = path.indexOfFirst { it in setOf("pull", "pulls", "issues", "merge_requests") }
    val number = path.getOrNull(numbered + 1)
    if (numbered >= 0 && number != null && number.all(Char::isDigit) && number.isNotEmpty()) {
        // With several repositories, or one that is not the project's, "#12" alone would not say which.
        val github = Regex("^(www\\.)?github\\.com$", RegexOption.IGNORE_CASE).matches(url.host) &&
            numbered == 2 && path[2] != "merge_requests" && Regex("[1-9]\\d*").matches(number)
        val repo = if (github) "${path[0]}/${path[1]}" else null
        val repos = links?.githubRepos.orEmpty().map { it.lowercase() }
        val own = repo != null && repos.size == 1 && repos[0] == repo.lowercase()
        if (repo != null && repos.isNotEmpty() && !own) return "${path[1]}#$number"
        return "#$number"
    }
    val browse = path.indexOf("browse")
    if (browse >= 0 && browse + 1 < path.size) return path[browse + 1]
    return url.host.removePrefix("www.")
}

/** One line of Markdown as plain text: list marks, headings, emphasis, code ticks and link syntax removed. */
private fun plainLine(line: String): String = line
    .replace(Regex("^\\s*(?:[-*+]|\\d+[.)])\\s+"), "")
    .replace(Regex("^#{1,6}\\s+"), "")
    .replace(Regex("!?\\[([^\\]]*)\\]\\([^)]*\\)"), "$1")
    .replace(Regex("[*_`~]+"), "")
    .replace(Regex("\\s+"), " ")
    .trim()

/** The first line of some Markdown as plain text, shortened to [length]; empty for empty text. */
fun firstLine(markdown: String, length: Int = 140): String {
    for (line in markdown.split("\n")) {
        val plain = plainLine(line)
        if (plain.isEmpty()) continue
        return if (plain.length > length) plain.take(length - 1).trimEnd() + "…" else plain
    }
    return ""
}

// --- the Tasks view ----------------------------------------------------------------------------------------------

enum class TaskSectionId(val label: String) {
    NeedsYou("Needs you"), Review("Ready for review"), Waiting("Waiting"), Blocked("Blocked"), Working("Working"), Todo("To do"), Closed("Recently closed"),
}

/** A task with its open questions and warnings (warnings first) and the section it belongs to. */
data class TaskRow(val task: BoardTask, val waiting: List<BoardQuestion>, val section: TaskSectionId)

/** Closed tasks are history: their section starts folded. */
data class TaskSection(val id: TaskSectionId, val rows: List<TaskRow>, val collapsedByDefault: Boolean) {
    val label: String get() = id.label
}

private fun warningsFirst(questions: List<BoardQuestion>) = questions.filter(::isWarning) + questions.filterNot(::isWarning)

/** A task's open questions and warnings, warnings first, then in the board's order. */
fun waitingOn(questions: List<BoardQuestion>, taskId: String): List<BoardQuestion> =
    warningsFirst(questions.filter { it.status == "open" && it.taskId == taskId })

/** Open questions and warnings that name no task on the board; the Tasks view answers them where it lists tasks. */
fun looseWaiting(board: Board): List<BoardQuestion> {
    val known = board.tasks.mapTo(HashSet()) { it.id }
    return warningsFirst(board.questions.filter { it.status == "open" && (it.taskId == null || it.taskId !in known) })
}

/** Task IDs in their natural order: T2 before T10. */
val taskIdOrder: Comparator<String> = Comparator { left, right ->
    val a = Regex("\\d+|\\D+").findAll(left).map { it.value }.toList()
    val b = Regex("\\d+|\\D+").findAll(right).map { it.value }.toList()
    for (i in 0 until minOf(a.size, b.size)) {
        val x = a[i]; val y = b[i]
        val compared = if (x[0].isDigit() && y[0].isDigit()) x.toBigInteger().compareTo(y.toBigInteger()) else x.compareTo(y)
        if (compared != 0) return@Comparator compared
    }
    a.size - b.size
}

private val byOrder: Comparator<BoardTask> = compareBy<BoardTask> { it.order }.thenComparing({ it.id }, taskIdOrder)

/** Milliseconds since the epoch of an ISO 8601 time; 0 when it does not parse. */
internal fun isoMillis(value: String?): Long = value?.let {
    runCatching { java.time.OffsetDateTime.parse(it).toInstant().toEpochMilli() }
        .recoverCatching { _ -> java.time.Instant.parse(it).toEpochMilli() }.getOrNull()
} ?: 0L

private fun settledTime(task: BoardTask): Long = isoMillis(task.settledAt ?: task.updatedAt)

/** Where a task belongs: closed ones are history, then anything waiting on the user, then its status. */
fun taskSectionOf(status: String, waiting: Int): TaskSectionId = when {
    isSettled(status) -> TaskSectionId.Closed
    status == "waiting" -> TaskSectionId.Waiting
    waiting > 0 -> TaskSectionId.NeedsYou
    status == "review" -> TaskSectionId.Review
    status == "blocked" -> TaskSectionId.Blocked
    status == "in_progress" -> TaskSectionId.Working
    else -> TaskSectionId.Todo
}

/**
 * The tasks grouped by what each needs from the user, in the order that matters: needs you, ready for review, blocked,
 * working, to do, recently closed. Empty sections are left out, and archived tasks unless asked for.
 */
fun taskSections(tasks: List<BoardTask>, questions: List<BoardQuestion>, includeArchived: Boolean = false): List<TaskSection> {
    val rows = tasks.filter { includeArchived || !it.archived }.map { task ->
        val waiting = waitingOn(questions, task.id)
        TaskRow(task, waiting, taskSectionOf(task.status, waiting.size))
    }
    return TaskSectionId.entries.mapNotNull { id ->
        val inSection = rows.filter { it.section == id }
        if (inSection.isEmpty()) return@mapNotNull null
        val sorted = when (id) {
            TaskSectionId.Closed -> inSection.sortedByDescending { settledTime(it.task) }
            TaskSectionId.NeedsYou -> inSection.sortedWith(compareByDescending<TaskRow> { row -> row.waiting.any(::isWarning) }.thenComparing({ it.task }, byOrder))
            else -> inSection.sortedWith(compareBy(byOrder) { it.task })
        }
        TaskSection(id, sorted, collapsedByDefault = id == TaskSectionId.Closed || id == TaskSectionId.Waiting)
    }
}

/** What a row says under the title: the report line that matters for where the task stands. */
fun rowGist(row: TaskRow): String {
    val task = row.task
    if (task.status == "waiting") return task.waiting?.note.orEmpty()
    val report = task.report
    if (row.section == TaskSectionId.NeedsYou) return markdownText(row.waiting.firstOrNull()?.text.orEmpty())
    val candidates = when (row.section) {
        TaskSectionId.Review, TaskSectionId.Closed -> listOf(report.results, report.now, task.description)
        TaskSectionId.Blocked -> listOf(task.blockedReason.orEmpty(), report.now, report.results)
        TaskSectionId.Working -> listOf(report.now, report.results, task.description)
        else -> listOf(task.description, report.next)
    }
    return candidates.map { firstLine(it) }.firstOrNull { it.isNotEmpty() }.orEmpty()
}

// --- what changed between two snapshots --------------------------------------------------------------------------

sealed interface FoldedDiffLine
/** A line in a diff: kept, added or removed. */
data class DiffLine(val kind: Kind, val text: String) : FoldedDiffLine {
    enum class Kind { Same, Added, Removed }
}
/** A run of unchanged lines folded into its count. */
data class UnchangedLines(val count: Int) : FoldedDiffLine

private fun linesOf(text: String): List<String> = text.split("\n").map { it.trimEnd() }.filter { it.isNotBlank() }

/** A line diff of two texts, blank lines ignored: the longest common run of lines stays, the rest is removed or added. */
fun diffLines(before: String, after: String): List<DiffLine> {
    val left = linesOf(before)
    val right = linesOf(after)
    val common = Array(left.size + 1) { IntArray(right.size + 1) }
    for (i in left.indices.reversed()) for (j in right.indices.reversed()) {
        common[i][j] = if (left[i] == right[j]) common[i + 1][j + 1] + 1 else maxOf(common[i + 1][j], common[i][j + 1])
    }
    val lines = mutableListOf<DiffLine>()
    var i = 0
    var j = 0
    while (i < left.size && j < right.size) {
        when {
            left[i] == right[j] -> { lines += DiffLine(DiffLine.Kind.Same, left[i]); i++; j++ }
            common[i + 1][j] >= common[i][j + 1] -> { lines += DiffLine(DiffLine.Kind.Removed, left[i]); i++ }
            else -> { lines += DiffLine(DiffLine.Kind.Added, right[j]); j++ }
        }
    }
    while (i < left.size) lines += DiffLine(DiffLine.Kind.Removed, left[i++])
    while (j < right.size) lines += DiffLine(DiffLine.Kind.Added, right[j++])
    return lines
}

/** Runs of unchanged lines folded into one count, so a diff shows what moved. */
fun foldUnchanged(lines: List<DiffLine>): List<FoldedDiffLine> {
    val folded = mutableListOf<FoldedDiffLine>()
    for (line in lines) {
        val last = folded.lastOrNull()
        when {
            line.kind != DiffLine.Kind.Same -> folded += line
            last is UnchangedLines -> folded[folded.lastIndex] = UnchangedLines(last.count + 1)
            else -> folded += UnchangedLines(1)
        }
    }
    return folded
}

enum class ReportSection(val label: String) { Now("Now"), Results("Results"), Next("Next") }

/** What a snapshot or the current task says: enough to compare two of them. */
data class TaskState(val title: String, val status: String, val now: String, val results: String, val next: String) {
    fun section(section: ReportSection): String = when (section) {
        ReportSection.Now -> now
        ReportSection.Results -> results
        ReportSection.Next -> next
    }
}

fun BoardTask.state() = TaskState(title, status, report.now, report.results, report.next)
fun BoardTaskSnapshot.state() = TaskState(title, status, report.now, report.results, report.next)

data class Change<T>(val from: T, val to: T)
data class SectionChange(val section: ReportSection, val lines: List<FoldedDiffLine>) {
    val label: String get() = section.label
}
data class TaskChanges(val title: Change<String>? = null, val status: Change<String>? = null, val sections: List<SectionChange> = emptyList()) {
    val any: Boolean get() = title != null || status != null || sections.isNotEmpty()
}

/**
 * What changed from one state to another. Without a [from] (a task's first snapshot) every written section reads as
 * added and the title and status are left out, since nothing came before them.
 */
fun taskChanges(from: TaskState?, to: TaskState): TaskChanges = TaskChanges(
    title = if (from != null && from.title != to.title) Change(from.title, to.title) else null,
    status = if (from != null && from.status != to.status) Change(from.status, to.status) else null,
    sections = ReportSection.entries.mapNotNull { section ->
        val lines = diffLines(from?.section(section).orEmpty(), to.section(section))
        if (lines.all { it.kind == DiffLine.Kind.Same }) null else SectionChange(section, foldUnchanged(lines))
    },
)

// --- the board's notes and task references in the transcript (packages/client board.ts) ---------------------------

/** Whether a user input is a note the harness posted about the board (`[board]` and what changed), not typed text. */
fun isBoardMessage(text: String): Boolean {
    val trimmed = text.trimStart()
    if (!trimmed.startsWith(BOARD_PREFIX)) return false
    val next = trimmed.getOrNull(BOARD_PREFIX.length)
    return next == null || next.isWhitespace()
}

data class TaskReference(val taskId: String?, val text: String, val feedbackId: String? = null)

/**
 * The task a user message names, from the `[task T12] ` (or `[task T12, feedback F3] `) the server puts in front of it,
 * and the text after it, including the optional feedback ID.
 */
fun parseTaskReference(text: String): TaskReference {
    if (!text.startsWith(TASK_REFERENCE_PREFIX)) return TaskReference(null, text)
    val end = text.indexOf(']', TASK_REFERENCE_PREFIX.length)
    if (end < 0) return TaskReference(null, text)
    val taskId = text.substring(TASK_REFERENCE_PREFIX.length, end).substringBefore(',').trim()
    if (taskId.isEmpty() || taskId.any(Char::isWhitespace)) return TaskReference(null, text)
    val feedbackId = text.substring(TASK_REFERENCE_PREFIX.length, end).substringAfter(',', "").trim()
        .takeIf { it.startsWith("feedback ") }?.removePrefix("feedback ")?.trim()
        ?.takeIf { it.isNotEmpty() && it.none(Char::isWhitespace) }
    return TaskReference(taskId, text.substring(end + 1).removePrefix(" "), feedbackId)
}

/** The input text for a message about a task, as the server writes it. */
fun withTaskReference(taskId: String, text: String): String = "$TASK_REFERENCE_PREFIX$taskId] $text"

/** Minutes as a person reads them: `45m`, `2h`, `1h 30m`. */
fun formatMinutes(minutes: Double): String {
    val whole = maxOf(0L, Math.round(minutes))
    if (whole < 60) return "${whole}m"
    val hours = whole / 60
    val rest = whole % 60
    return if (rest == 0L) "${hours}h" else "${hours}h ${rest}m"
}

/** How long a task has been in progress, "In progress 1h 20m"; null when the server does not track it. */
fun inProgressText(task: BoardTask): String? = task.inProgressMinutes?.let { "In progress ${formatMinutes(it.toDouble())}" }
