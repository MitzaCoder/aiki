package io.github.mitzacoder.aiki.features.panels

import android.content.SharedPreferences
import androidx.core.content.edit
import io.github.mitzacoder.aiki.data.ClientException
import io.github.mitzacoder.aiki.features.status.exactTime
import io.github.mitzacoder.aiki.features.status.relativeTime
import io.github.mitzacoder.aiki.features.status.shortCommit
import io.github.mitzacoder.aiki.protocol.MemoryChange
import io.github.mitzacoder.aiki.protocol.MemoryFileSummary
import io.github.mitzacoder.aiki.protocol.MemoryFileSummarySource
import io.github.mitzacoder.aiki.protocol.MemoryMaintenanceSettings
import io.github.mitzacoder.aiki.protocol.MemoryScopeStatus
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import kotlin.math.roundToLong

/**
 * How memory reads in the Memory tab: the scope switch and the scope it remembers, topic files as rows with the archived
 * ones counted apart, search hits, the history's commits in words, the maintenance line, a file's links and source.
 * Ports of the web's `lib/memory.ts` (and `relativeTimeAhead` from `lib/relative-time.ts`).
 */

val MEMORY_SCOPES = listOf("global", "project")

/** Where the remembered scope is kept, per device (web localStorage `aiki.memory-scope.v1`). */
const val MEMORY_SCOPE_PREFERENCES = io.github.mitzacoder.aiki.BuildConfig.PREFERENCES_PREFIX + ".memory-scope.v1"
private const val MEMORY_SCOPE_KEY = "scope"

/** A conversation is about its project, so memory opens on the project's scope until the reader picks another. */
const val DEFAULT_MEMORY_SCOPE = "project"

fun memoryScopeLabel(scope: String): String = when (scope) { "global" -> "Global"; "project" -> "Project"; else -> scope }

fun loadMemoryScope(preferences: SharedPreferences): String =
    preferences.getString(MEMORY_SCOPE_KEY, null)?.takeIf { it in MEMORY_SCOPES } ?: DEFAULT_MEMORY_SCOPE

fun saveMemoryScope(preferences: SharedPreferences, scope: String) {
    preferences.edit { putString(MEMORY_SCOPE_KEY, scope) }
}

fun memoryStatusLabel(status: String): String = when (status) {
    "active" -> "Active"
    "superseded" -> "Superseded"
    "archived" -> "Archived"
    else -> status
}

private fun timestamp(at: String): Long = try { Instant.parse(at).toEpochMilli() } catch (_: java.time.DateTimeException) {
    try { java.time.OffsetDateTime.parse(at).toInstant().toEpochMilli() } catch (_: java.time.DateTimeException) { 0L }
}

/** A timestamp ahead of [now]: "in 5 min", "in 3 h", "in 2 d", "due now" once due (web `relativeTimeAhead`). */
fun relativeTimeAhead(at: String, now: Long): String {
    val ms = timestamp(at).takeIf { it != 0L } ?: return "at an unknown time"
    val seconds = ((ms - now) / 1000.0).roundToLong()
    if (seconds < 45) return "due now"
    val minutes = (seconds / 60.0).roundToLong()
    if (minutes < 60) return "in $minutes min"
    val hours = (minutes / 60.0).roundToLong()
    if (hours < 24) return "in $hours h"
    val days = (hours / 24.0).roundToLong()
    if (days < 30) return "in $days d"
    return DateTimeFormatter.ofLocalizedDate(FormatStyle.MEDIUM).withZone(ZoneId.systemDefault()).format(Instant.ofEpochMilli(ms))
}

/** The server's times may carry an offset ("…+02:00"); the shared helpers read only instants, so normalise first. */
internal fun memoryInstant(at: String): String = timestamp(at).takeIf { it != 0L }?.let { Instant.ofEpochMilli(it).toString() } ?: at

/** One topic file row: archived or not, and when it changed (short and exact). */
data class MemoryFileRow(val file: MemoryFileSummary, val archived: Boolean, val updated: String, val updatedTitle: String)

/** What the list shows, and how many active and archived files there are; the archived count is known either way. */
data class MemoryFileSplit(val shown: List<MemoryFileRow>, val active: Int, val archived: Int)

/** Topic files as rows, most recently updated first; archived ones only when [includeArchived]. */
fun splitMemoryFiles(files: List<MemoryFileSummary>, includeArchived: Boolean, now: Long): MemoryFileSplit {
    val rows = files.sortedWith(compareByDescending<MemoryFileSummary> { timestamp(it.updated) }.thenBy { it.title }).map {
        MemoryFileRow(it, it.status == "archived", relativeTime(memoryInstant(it.updated), now), exactTime(memoryInstant(it.updated)))
    }
    return MemoryFileSplit(rows.filter { includeArchived || !it.archived }, rows.count { !it.archived }, rows.count { it.archived })
}

/** What a hit's section is called; a match in the file's introduction has no heading. */
fun memorySearchHeading(heading: String?): String = if (heading.isNullOrBlank()) "Introduction" else heading

/** A commit message split into its subject line and the rest. */
fun memoryMessageParts(message: String): Pair<String, String> {
    val lines = message.trim().split("\n")
    return lines.first().trim() to lines.drop(1).joinToString("\n").trim()
}

/** Who made a change, as the history says it; a commit from before kinds reads as a plain change. */
fun memoryChangeKindLabel(kind: String?): String = when (kind) {
    null -> "Change"
    "tool" -> "By the coordinator"
    "hand" -> "By hand"
    "extraction" -> "Saved from a compaction"
    "maintenance" -> "Maintenance"
    "undo" -> "Undo"
    else -> kind
}

/** Whether `memory.undo` takes this change: the server says so, and nothing has undone it yet. */
fun memoryChangeUndoable(change: MemoryChange): Boolean = change.undoneBy == null && change.undoable == true

/** A refused undo in words; any other failure shows what the server said. */
fun memoryUndoErrorText(error: Throwable): String =
    if ((error as? ClientException)?.code == "memory_conflict") "Not undone: later changes touched the same memories, so the newer ones win. Nothing was reverted."
    else error.message ?: "Undo failed"

/** One commit row in the History view. */
data class MemoryChangeRow(
    val change: MemoryChange,
    val commit: String,
    val subject: String,
    val body: String,
    val `when`: String,
    val whenTitle: String,
    val kind: String,
    val undoable: Boolean,
    /** The `pi.compaction` entry an extraction came from. */
    val compactionEntry: Long?,
)

/** A scope's commits as rows, newest first. */
fun memoryChangeRows(changes: List<MemoryChange>, now: Long): List<MemoryChangeRow> =
    changes.sortedByDescending { timestamp(it.at) }.map { change ->
        val (subject, body) = memoryMessageParts(change.message)
        MemoryChangeRow(
            change, shortCommit(change.commit), subject, body, relativeTime(memoryInstant(change.at), now), exactTime(memoryInstant(change.at)),
            memoryChangeKindLabel(change.kind), memoryChangeUndoable(change), change.source?.entryId?.takeIf { change.kind == "extraction" },
        )
    }

/** A scope's maintenance as one status line: the last run, the next one, and the writes waiting for it. */
data class MemoryStatusView(
    val running: Boolean,
    /** "3 h ago · changed memory", with the server's message (or the exact time) for a tap, and whether it failed. */
    val last: Triple<String, String, Boolean>?,
    /** "in 5 h" and its exact time; null when maintenance is off. */
    val next: Pair<String, String>?,
    val writes: String,
    /** No model set, so maintenance never runs. */
    val off: Boolean,
)

fun memoryStatusView(status: MemoryScopeStatus, now: Long): MemoryStatusView {
    val last = status.lastMaintenance
    val count = status.writesSinceMaintenance
    val outcome = when (last?.outcome) { "ok" -> "changed memory"; "nothing_to_do" -> "nothing to do"; "failed" -> "failed"; else -> last?.outcome }
    return MemoryStatusView(
        running = status.maintaining,
        last = last?.let { Triple("${relativeTime(memoryInstant(it.at), now)} · $outcome", it.message ?: exactTime(memoryInstant(it.at)), it.outcome == "failed") },
        next = status.nextMaintenanceAt?.let { relativeTimeAhead(it, now) to exactTime(memoryInstant(it)) },
        writes = if (count == 1L) "1 write since the last run" else "$count writes since the last run",
        off = status.nextMaintenanceAt == null,
    )
}

/** When maintenance runs on a backend: nightly in its timezone, or after N writes. */
fun memoryMaintenanceSummary(settings: MemoryMaintenanceSettings, timezone: String): String {
    if (settings.model == null) return "Off: maintenance doesn't run without a model."
    val writes = if (settings.afterWrites == 1L) "after 1 write" else "after ${settings.afterWrites} writes"
    return "Nightly at ${settings.time} ($timezone), or $writes."
}

/** A front matter link ready to render: where it goes and what to call it (the title when this scope's list has it). */
data class MemoryLinkView(val scope: String, val fileId: String, val label: String, val known: Boolean)

fun memoryLinkViews(links: List<String>, scope: String, files: List<MemoryFileSummary>): List<MemoryLinkView> = links.mapNotNull { link ->
    if (link.isBlank()) return@mapNotNull null
    val (linkedScope, fileId) = memoryTarget(link.trim(), scope)
    if (fileId.isBlank()) return@mapNotNull null
    val known = files.firstOrNull { it.fileId == fileId }?.takeIf { linkedScope == scope }
    MemoryLinkView(linkedScope, fileId.trim(), known?.title ?: fileId.trim(), known != null)
}

/** Where a memory's last write came from: "conversation #3, entry #12", or "the coordinator". */
fun memorySourceText(source: MemoryFileSummarySource): String =
    listOfNotNull(source.conversationId?.let { "conversation #$it" }, source.entryId?.let { "entry #$it" }).joinToString(", ").ifEmpty { "the coordinator" }
