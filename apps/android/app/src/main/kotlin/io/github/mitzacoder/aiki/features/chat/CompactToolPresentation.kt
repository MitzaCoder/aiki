package io.github.mitzacoder.aiki.features.chat

import io.github.mitzacoder.aiki.protocol.Artifact
import kotlinx.serialization.json.*

internal val codingTools = setOf("read","write","edit","bash")
internal fun compactToolHeadline(part: ChatPart): String {
    val args = part.arguments.record(); val details = part.details.record()
    val failed = part.status in setOf("error","exited")
    val action = part.name.removePrefix("memory_")
    if(part.name.startsWith("memory_") && failed) return "Memory $action failed"
    return when(part.name) {
        "memory_search" -> if(part.status != "done") "Searching memories" else details?.get("hits")?.jsonPrimitive?.intOrNull?.let { "Found $it memor${if(it == 1) "y" else "ies"}" } ?: "Searched memories"
        "memory_read" -> "Read a memory"
        "memory_write" -> when {
            part.status != "done" -> "Writing a memory"
            details?.get("created") == JsonPrimitive(true) -> "Created a memory"
            details?.get("matches") != null -> "Similar memories found · not created"
            "nothing was written" in part.text -> "Memory unchanged"
            else -> "Updated a memory"
        }
        "memory_archive" -> "Archived a memory"
        "codemode" -> args?.s("code")?.lineSequence()?.map { it.trim().removePrefix("//").trim() }?.firstOrNull(String::isNotBlank)?.take(100) ?: "Code mode script"
        "read" -> "Read file"
        "write" -> "Write file"
        "edit" -> "Edit file"
        "bash" -> "Run command"
        else -> part.name.replace('_',' ')
    }
}
internal fun codingHeadline(parts: List<ChatPart>): String = parts.filter { it.kind == "tool" }.groupingBy { it.name }.eachCount().entries.joinToString(" · ") { (name,count) ->
    when(name) {
        "read" -> "Read $count file${if(count == 1) "" else "s"}"
        "write" -> "Wrote $count file${if(count == 1) "" else "s"}"
        "edit" -> "Edited $count file${if(count == 1) "" else "s"}"
        "bash" -> "Ran $count command${if(count == 1) "" else "s"}"
        else -> "$count ${name.replace('_',' ')}"
    }
}
internal fun friendlyStatus(part: ChatPart): String = toolExitCode(part)?.let { "Exit $it" } ?: when(part.status) {
    "error" -> "Failed"
    "exited" -> "Exited non-zero"
    "interrupted","cancelled" -> "Stopped"
    "preparing","pending" -> "Preparing"
    "running" -> "Working"
    "done","ok" -> "Done"
    else -> part.status.replaceFirstChar(Char::uppercase)
}
internal fun threadStatusText(status: String) = when(status) {
    "running" -> "Working"; "idle" -> "Waiting"; "done" -> "Finished"; "failed" -> "Failed"; "stopped" -> "Stopped"; else -> status
}
internal fun artifactFromTool(part: ChatPart, project: String): Artifact? {
    val id = artifactCallId(part) ?: return null
    val args = part.arguments.record()
    val path = args?.s("path").orEmpty()
    val name = path.substringAfterLast('/').ifBlank { id }
    val kind = when(name.substringAfterLast('.',"").lowercase()) {
        "png","jpg","jpeg","gif","webp","avif" -> "image"
        "mp4","webm","mov","mkv" -> "video"
        "mp3","wav","ogg","m4a" -> "audio"
        "md","txt","json","log","csv","html" -> "text"
        else -> "file"
    }
    return Artifact(
        id = id, projectId = project, name = name, title = args?.s("title")?.takeIf(String::isNotBlank), note = args?.s("note")?.takeIf(String::isNotBlank), kind = kind,
        mimeType = "", size = -1, durationSeconds = null, threadId = "main", workerId = null, taskId = args?.s("taskId")?.takeIf(String::isNotBlank), sourcePath = path, createdAt = "",
    )
}
internal fun artifactFacts(artifact: Artifact): String = listOfNotNull(
    artifact.kind.replaceFirstChar(Char::uppercase),
    artifact.durationSeconds?.let { "${it.toInt() / 60}:${(it.toInt() % 60).toString().padStart(2,'0')}" },
    artifact.size.takeIf { it >= 0 }?.let { io.github.mitzacoder.aiki.features.status.formatBytes(it) },
    artifact.taskId
).joinToString(" · ")

// --- tool wording (apps/web/src/lib/chat/tools.ts, lib/transcript.ts) -----------------------------------------------

private val TOOL_HEADLINES = mapOf(
    "schedule_list" to "Listed the schedules",
    "schedule_save" to "Saved a schedule",
    "schedule_delete" to "Deleted a schedule",
    "schedule_run" to "Started a scheduled run",
    "task_progress" to "Reported progress",
    "worker_list" to "Listed the workers",
    "worker_peek" to "Peeked at a worker",
    "worker_stop" to "Stopped a worker",
    "worker_spawn" to "Started a worker",
    "worker_send" to "Sent to a worker",
    "worker_forget" to "Forgot a worker",
)

/** The words a non-coding call's card leads with ("Saved a schedule"); null for the coding tools, which keep their names. */
fun toolHeadline(name: String): String? {
    if (name.isEmpty() || name in codingTools) return null
    TOOL_HEADLINES[name]?.let { return it }
    val words = name.replace(Regex("[._-]+"), " ").trim()
    return words.ifEmpty { null }?.replaceFirstChar(Char::uppercase)
}

/** How a call ended, for its icon and colour: `running`, `failed`, `exited` (non-zero exit that printed), `done`, `stopped`. */
fun toolCallState(part: ChatPart): String = when (part.status) {
    "error" -> "failed"
    "exited" -> "exited"
    "done" -> "done"
    "interrupted", "cancelled" -> "stopped"
    else -> "running"
}

/** A row's one-line status: the label, what went wrong beside it, and the overall state. */
data class CallGroupSummary(val status: String, val label: String, val detail: String? = null)

private fun plural(count: Int, singular: String) = if (count == 1) singular else singular + "s"

private fun groupStatus(calls: List<ChatPart>): Pair<String, String?> {
    val states = calls.map(::toolCallState)
    val running = states.count { it == "running" }
    val failed = states.count { it == "failed" }
    val exited = states.count { it == "exited" }
    val stopped = states.count { it == "stopped" }
    val status = when { running > 0 -> "running"; failed > 0 -> "failed"; exited > 0 -> "exited"; stopped > 0 -> "stopped"; else -> "done" }
    val detail = listOfNotNull(
        "$running running".takeIf { running > 0 }, "$failed failed".takeIf { failed > 0 },
        "$exited exited non-zero".takeIf { exited > 0 }, "$stopped stopped".takeIf { stopped > 0 },
    ).joinToString(" · ").ifEmpty { null }
    return status to detail
}

/** A run of non-coding calls folded into one row: "5 steps", and what went wrong beside it. */
fun stepsGroupSummary(calls: List<ChatPart>): CallGroupSummary {
    val (status, detail) = groupStatus(calls)
    return CallGroupSummary(status, "${calls.size} ${plural(calls.size, "step")}", detail)
}

/** A coding group's header: "Ran 2 commands, read 3 files, edited 1 file", plus "· 2 thoughts" when thinking sits inside. */
fun codingGroupSummary(parts: List<ChatPart>): CallGroupSummary {
    val calls = parts.filter { it.kind == "tool" }
    val thoughts = parts.size - calls.size
    val (status, detail) = groupStatus(calls)
    val clauses = listOf(
        Triple("bash", "Ran" to "Running", "command"), Triple("read", "read" to "reading", "file"),
        Triple("write", "wrote" to "writing", "file"), Triple("edit", "edited" to "editing", "file"),
    ).mapNotNull { (name, verbs, noun) ->
        val total = calls.count { it.name == name }
        if (total == 0) null else "${if (calls.any { it.name == name && toolCallState(it) == "running" }) verbs.second else verbs.first} $total ${plural(total, noun)}"
    }
    val label = clauses.joinToString(", ").replaceFirstChar(Char::uppercase) + if (thoughts == 0) "" else " · $thoughts ${plural(thoughts, "thought")}"
    return CallGroupSummary(status, label, detail)
}
