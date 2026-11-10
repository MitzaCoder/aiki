package io.github.mitzacoder.aiki.features.chat

import io.github.mitzacoder.aiki.protocol.Artifact
import io.github.mitzacoder.aiki.protocol.MAIN_THREAD_ID
import io.github.mitzacoder.aiki.protocol.WorkerSummary

/** Metadata only, never signed URLs; bounded process memory, not saved state. */
object ChatArtifactMetadata {
    private data class Key(val backend: String, val project: String, val id: String)
    private val items = LinkedHashMap<Key,Artifact>()
    private val deleted = LinkedHashSet<Key>()
    @Synchronized fun keep(backend: String, artifact: Artifact) {
        val key = Key(backend,artifact.projectId,artifact.id)
        if(key in deleted) return
        items[key] = artifact
        while(items.size > 1000) items.remove(items.keys.first())
    }
    @Synchronized fun find(backend: String, project: String, id: String): Artifact? = items[Key(backend,project,id)]
    @Synchronized fun isDeleted(backend: String, project: String, id: String): Boolean = Key(backend,project,id) in deleted
    @Synchronized fun remove(backend: String, project: String, id: String) {
        val key = Key(backend,project,id)
        items.remove(key); deleted.add(key)
        while(deleted.size > 1000) deleted.remove(deleted.first())
    }
}
/** List absence cannot block URL-by-ID access. Unknown metadata falls back to a downloadable file. */
internal fun artifactForViewing(projectId: String, id: String, recent: List<Artifact>): Artifact = recent.find { it.id == id && it.projectId == projectId }
    ?: Artifact(id = id, projectId = projectId, name = id, title = null, note = null, kind = "file", mimeType = "application/octet-stream", size = -1, durationSeconds = null, threadId = "main", workerId = null, taskId = null, sourcePath = "", createdAt = "")
internal fun workerCallId(part: ChatPart): String? = if(part.name in setOf("worker_spawn","worker_send","worker_stop","worker_peek","worker_forget")) part.arguments.record()?.s("id")?.takeIf(String::isNotBlank) else null
internal fun sameThread(first: String?, second: String?): Boolean = first.orEmpty().ifBlank { "main" } == second.orEmpty().ifBlank { "main" }
internal fun workerForCall(part: ChatPart, workers: List<WorkerSummary>, threadId: String?): WorkerSummary? = workers.firstOrNull {
    sameThread(it.threadId,threadId) && (it.id == workerCallId(part) || (part.name == "worker_spawn" && it.spawnedByCallId != null && part.key == "call-${it.spawnedByCallId}"))
}
internal fun imageCanRenew(attempts: Int): Boolean = attempts in 0..1

// --- labels and facts (web lib/artifacts.ts) ------------------------------------------------------------------------

/** The kinds in the order the filters list them. */
internal val ARTIFACT_KINDS = listOf("video", "image", "audio", "text", "file")

/** How many times a thumbnail that failed to load asks for a fresh URL before it gives up (web `MEDIA_RETRY_LIMIT`). */
internal const val MEDIA_RETRY_LIMIT = 2

internal fun artifactKindLabel(kind: String, plural: Boolean = false): String = when (kind) {
    "video" -> if (plural) "Videos" else "Video"
    "image" -> if (plural) "Images" else "Image"
    "audio" -> "Audio"
    "text" -> "Text"
    else -> if (plural) "Files" else "File"
}

/** What a card calls an artifact: its title, else its file name. */
internal fun artifactTitle(artifact: Artifact): String = artifact.title?.trim()?.takeIf { it.isNotEmpty() } ?: artifact.name

/** A media length as "0:07", "12:30", "1:02:03"; empty when unknown. */
internal fun formatMediaDuration(seconds: Double?): String {
    if (seconds == null || !seconds.isFinite() || seconds < 0) return ""
    val total = Math.round(seconds)
    val hours = total / 3600
    val minutes = (total % 3600) / 60
    val rest = (total % 60).toString().padStart(2, '0')
    return if (hours > 0) "$hours:${minutes.toString().padStart(2, '0')}:$rest" else "$minutes:$rest"
}

/** Who saved it: main, a background thread, or one of their workers. */
internal fun savedByLabel(artifact: Artifact): String {
    val main = artifact.threadId.isBlank() || artifact.threadId == MAIN_THREAD_ID
    val worker = artifact.workerId?.takeIf { it.isNotBlank() } ?: return if (main) "Main" else "Thread ${artifact.threadId}"
    return "Worker $worker of ${if (main) "main" else "thread ${artifact.threadId}"}"
}

/** How many of each kind a list holds, in the kinds' order, leaving out the absent ones. */
internal fun artifactKindCounts(artifacts: List<Artifact>): List<Pair<String, Int>> =
    ARTIFACT_KINDS.map { kind -> kind to artifacts.count { it.kind == kind } }.filter { it.second > 0 }

/** The list narrowed to one kind, or whole for null. */
internal fun filterByKind(artifacts: List<Artifact>, kind: String?): List<Artifact> =
    if (kind == null) artifacts else artifacts.filter { it.kind == kind }

/** The kind of a file from its name alone, for an artifact the chat names before its record is read. */
internal fun kindFromName(name: String): String {
    val extension = Regex("\\.([a-z0-9]+)$", RegexOption.IGNORE_CASE).find(name)?.groupValues?.get(1)?.lowercase().orEmpty()
    return when (extension) {
        "webm", "mp4", "m4v", "mov", "ogv", "mkv" -> "video"
        "png", "jpg", "jpeg", "gif", "webp", "avif", "svg", "bmp" -> "image"
        "mp3", "wav", "ogg", "oga", "m4a", "flac", "opus", "aac" -> "audio"
        "txt", "log", "md", "json", "jsonl", "csv", "tsv", "yaml", "yml", "xml", "html", "diff", "patch" -> "text"
        else -> "file"
    }
}
/** The artifacts saved as evidence for each task, newest first (web `artifactsByTask`); ones for no task are left out. */
internal fun artifactsByTask(artifacts: List<Artifact>): Map<String, List<Artifact>> =
    artifacts.filter { it.taskId != null }.sortedByDescending { it.createdAt }.groupBy { it.taskId!! }
