package io.github.mitzacoder.aiki.features.chat

internal data class WorkerNotice(val kind: String, val workerId: String, val body: String)
private val workerFailed = Regex("^\\[worker ([^\\]\\s]+) failed: ([\\s\\S]*)\\]$")
private val workerReported = Regex("^\\[worker ([^\\]\\s]+) reported\\]\\n?")

/** Server failureReport preserves arbitrary brackets/newlines; match its entire wrapper first. */
internal fun parseWorkerNotice(text: String): WorkerNotice? {
    val trimmed = text.trim()
    workerFailed.find(trimmed)?.let { return WorkerNotice("failure",it.groupValues[1],it.groupValues[2].trim()) }
    workerReported.find(trimmed)?.let { return WorkerNotice("report",it.groupValues[1],trimmed.substring(it.range.last + 1).trim()) }
    return null
}

private const val CHECK_IN_PREFIX = "[check-in]"

/**
 * The periodic check-in the harness writes about running workers: `[check-in]`, a line break and a digest. "[check-in]
 * please" typed by the user is not one.
 */
internal fun parseCheckIn(text: String): String? {
    val trimmed = text.trim()
    if (!trimmed.startsWith(CHECK_IN_PREFIX)) return null
    val rest = trimmed.substring(CHECK_IN_PREFIX.length)
    if (!Regex("^\\s*\\n").containsMatchIn(rest)) return null
    return rest.trim()
}

/** The background threads a check-in covers: its digests that start `thread <id> — <title>`. */
internal fun checkInThreads(body: String): List<Pair<String, String>> =
    Regex("^thread (\\S+) — (.+)$", RegexOption.MULTILINE).findAll(body).map { it.groupValues[1] to it.groupValues[2].trim() }.toList()

/** A worker's report keeps its lines apart (Markdown would join them), leaving fenced code as written. */
internal fun reportMarkdown(text: String): String {
    var fenced = false
    return text.split("\n").joinToString("\n") { line ->
        when {
            Regex("^\\s*(```|~~~)").containsMatchIn(line) -> { fenced = !fenced; line }
            fenced || line.isBlank() -> line
            else -> "$line  "
        }
    }
}
