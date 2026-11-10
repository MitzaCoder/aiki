package io.github.mitzacoder.aiki.features.settings

import io.github.mitzacoder.aiki.features.status.formatBytes
import io.github.mitzacoder.aiki.protocol.ProjectsStorageCleanResponse
import io.github.mitzacoder.aiki.protocol.ProjectsStorageResponse
import io.github.mitzacoder.aiki.protocol.StorageItem

/** How Project settings' Storage card reads (web `lib/storage.ts`, client `removableStorage`/`withoutRemoved`). */

fun storageKindLabel(kind: String): String = if (kind == "worker") "Worker" else "Background thread"

/** "finished" for one a cleanup may remove, "running" for one still in use. */
fun storageStateLabel(item: StorageItem): String = if (item.removable) "finished" else "running"

/** Bytes as the card reads them; 0 is "empty", not a blank. */
fun storageSize(bytes: Long): String = if (bytes == 0L) "empty" else formatBytes(bytes)

data class CleanupSummary(val count: Int, val bytes: Long, val text: String)

/** What "Clean up finished" and its confirmation say about the finished workspaces. */
fun cleanupSummary(items: List<StorageItem>): CleanupSummary {
    val removable = items.filter { it.removable }
    val bytes = removable.sumOf { it.bytes }
    val what = if (removable.size == 1) "1 finished workspace" else "${removable.size} finished workspaces"
    return CleanupSummary(removable.size, bytes, if (removable.isEmpty()) "Nothing finished to clean up." else "$what, ${storageSize(bytes)}")
}

data class CleanupNotice(val warning: Boolean, val text: String)

/** What a cleanup did: how much it freed, and why the server kept any it was asked to remove. */
fun cleanupNotice(result: ProjectsStorageCleanResponse): CleanupNotice {
    val removed = result.removed.size
    val freed = if (removed == 0) "Nothing was removed."
    else "Removed ${if (removed == 1) "1 workspace" else "$removed workspaces"} and freed ${storageSize(result.freedBytes)}."
    if (result.refused.isEmpty()) return CleanupNotice(false, freed)
    val reasons = result.refused.map { it.reason }.distinct()
    val kept = if (result.refused.size == 1) "1 was kept" else "${result.refused.size} were kept"
    return CleanupNotice(true, "$freed $kept: ${reasons.joinToString("; ")}.")
}

/** The listing after a cleanup: removed items dropped, the total lowered by what they held. */
fun withoutRemoved(storage: ProjectsStorageResponse, removed: List<String>): ProjectsStorageResponse {
    val gone = removed.toSet()
    val freed = storage.items.filter { it.id in gone }.sumOf { it.bytes }
    return storage.copy(items = storage.items.filter { it.id !in gone }, totalBytes = (storage.totalBytes - freed).coerceAtLeast(0))
}
