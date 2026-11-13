package io.github.mitzacoder.kemiri.features.tasks

/*
 * How the chat names board tasks: the places a task ID turns up in text, the `T12` mentions in the coordinator's replies
 * and the `#` picker in the composer. Ported from the web's `apps/web/src/lib/task-chat.ts` with its tests
 * (TaskChatTest); change both together.
 */

private val TASK_ID = Regex("(?<![\\w/#.:-])T\\d+(?![\\w-])")

/** The task IDs a text names, first mention first, each once. */
fun taskIdsIn(text: String): List<String> = TASK_ID.findAll(text).map { it.value }.distinct().toList()

/** The tasks a check-in's digest names (`task T3: 42m in progress`). */
fun checkInTaskIds(body: String): List<String> = Regex("\\btask (T\\d+)\\b").findAll(body).map { it.groupValues[1] }.distinct().toList()

sealed interface TextPiece {
    data class Plain(val text: String) : TextPiece
    data class Task(val taskId: String) : TextPiece
}

/**
 * A text cut into plain pieces and the tasks it names, for the tasks [known] accepts. While the text is still arriving
 * ([streaming]), a mention at its very end may be half of a longer ID, so it stays plain for now.
 */
fun splitTaskMentions(text: String, streaming: Boolean = false, known: (String) -> Boolean): List<TextPiece> {
    val pieces = mutableListOf<TextPiece>()
    var last = 0
    for (match in TASK_ID.findAll(text)) {
        val taskId = match.value
        if (!known(taskId)) continue
        if (streaming && match.range.last == text.lastIndex) continue
        if (match.range.first > last) pieces += TextPiece.Plain(text.substring(last, match.range.first))
        pieces += TextPiece.Task(taskId)
        last = match.range.last + 1
    }
    if (last < text.length) pieces += TextPiece.Plain(text.substring(last))
    return pieces
}

/** What the picker offers for a task. */
data class TaskOption(val id: String, val title: String, val status: String)

private val STATUS_RANK = mapOf("review" to 0, "blocked" to 1, "in_progress" to 2, "todo" to 3, "done" to 4, "dropped" to 5)

fun taskOptions(tasks: List<io.github.mitzacoder.kemiri.protocol.BoardTask>): List<TaskOption> =
    tasks.filterNot { it.archived }.map { TaskOption(it.id, it.title, it.status) }

/** Open tasks first (what needs the user, then what runs); finished ones only when a search asks for them. */
fun pickerChoices(options: List<TaskOption>, query: String, limit: Int = 50): List<TaskOption> {
    val needle = query.trim().lowercase()
    val matching = options.filter { option ->
        if (needle.isEmpty()) option.status != "done" && option.status != "dropped"
        else needle in option.id.lowercase() || needle in option.title.lowercase()
    }
    fun number(id: String) = id.drop(1).toLongOrNull() ?: 0L
    return matching
        .sortedWith(compareBy<TaskOption> { STATUS_RANK[it.status] ?: STATUS_RANK.size }.thenByDescending { number(it.id) })
        .take(limit)
}

/** The `#word` the caret is in: where the `#` is and what was typed after it. */
data class HashTrigger(val start: Int, val query: String)

/** The `#word` the caret is in the middle of, when it starts a word; null otherwise. */
fun hashTrigger(text: String, caret: Int): HashTrigger? {
    val match = Regex("(^|\\s)#([^\\s#]*)$").find(text.substring(0, caret.coerceIn(0, text.length))) ?: return null
    val query = match.groupValues[2]
    return HashTrigger(caret - query.length - 1, query)
}

/** The text without `#query` once a task is picked, and where the caret goes. */
data class TextWithCaret(val text: String, val caret: Int)

fun withoutTrigger(text: String, trigger: HashTrigger): TextWithCaret {
    val end = trigger.start + 1 + trigger.query.length
    val before = text.substring(0, trigger.start)
    val after = text.substring(end).removePrefix(" ")
    return TextWithCaret(before + after, before.length)
}
