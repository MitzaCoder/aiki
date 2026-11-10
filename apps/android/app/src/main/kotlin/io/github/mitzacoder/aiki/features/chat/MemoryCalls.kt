package io.github.mitzacoder.aiki.features.chat

import kotlinx.serialization.json.*

/**
 * How a memory tool call reads in the transcript (web `lib/chat/memory-tools.ts`). The tools are defined in
 * packages/server/src/memory-tools.ts: their arguments are the call's, their result text is what the model saw, and
 * `details` carries the small facts (scope, file, created) worth trusting over the prose.
 */

/** A run of snippet text, and whether it matched (client `MemorySnippetPart`). */
data class MemorySnippetPart(val text: String, val match: Boolean)

/** A topic a call names: a search hit, a close match or a link. [heading] is null for the topic's introduction; [rank] only on hits. */
data class MemoryTopic(val scope: String, val fileId: String, val title: String, val heading: String?, val parts: List<MemorySnippetPart>, val rank: Double? = null)

data class MemorySection(val heading: String, val text: String)

/** One memory call in the card's terms; [scope] is `global`, `project` or (a search only) `both`. */
sealed interface MemoryCallView {
    /** One line, in words, for the collapsed card. */
    val summary: String
    val scope: String
    /** The full tool result, for an error or a fallback. */
    val output: String
    val isError: Boolean

    data class Search(override val summary: String, override val scope: String, override val output: String, override val isError: Boolean,
        val query: String, val hits: List<MemoryTopic>, val matchCount: Int) : MemoryCallView
    data class Read(override val summary: String, override val scope: String, override val output: String, override val isError: Boolean,
        val fileId: String, val title: String?, val summaryText: String?, val tags: List<String>, val status: String?, val updated: String?,
        val intro: String, val sections: List<MemorySection>, val links: List<MemoryTopic>) : MemoryCallView
    data class Write(override val summary: String, override val scope: String, override val output: String, override val isError: Boolean,
        val fileId: String, val heading: String?, val text: String, val outcome: String, val closeMatches: List<MemoryTopic>) : MemoryCallView
    data class Archive(override val summary: String, override val scope: String, override val output: String, override val isError: Boolean,
        val fileId: String, val reason: String?) : MemoryCallView
}

fun memoryScopeBadge(scope: String): String = when (scope) { "both" -> "Both"; "global" -> "Global"; else -> "Project" }

/**
 * A snippet split into plain and matched runs (client `memorySnippetParts`): the server's `\u0002`…`\u0003` markers pair
 * up left to right and are never shown; an unclosed match runs to the end; empty runs are left out.
 */
fun memorySnippetParts(snippet: String): List<MemorySnippetPart> {
    val parts = mutableListOf<MemorySnippetPart>()
    var matching = false
    val run = StringBuilder()
    fun flush() { if (run.isNotEmpty()) { parts += MemorySnippetPart(run.toString(), matching); run.clear() } }
    for (character in snippet) when {
        character == '\u0002' -> if (!matching) { flush(); matching = true }
        character == '\u0003' -> if (matching) { flush(); matching = false }
        else -> run.append(character)
    }
    flush()
    return parts
}

private val word = Regex("""[\p{L}\p{N}_]+""")

/**
 * Split a snippet for display. The server's markers win when present; otherwise the query's terms are marked like FTS
 * would match them: case-insensitive, at the start of a word and as a prefix of it.
 */
fun highlightedSnippetParts(snippet: String, query: String): List<MemorySnippetPart> {
    if ('\u0002' in snippet || '\u0003' in snippet) return memorySnippetParts(snippet)
    val terms = word.findAll(query.lowercase()).map { it.value }.toList()
    if (terms.isEmpty()) return memorySnippetParts(snippet)
    val parts = mutableListOf<MemorySnippetPart>()
    var cursor = 0
    for (found in word.findAll(snippet)) {
        val at = found.range.first
        if (at > cursor) parts += MemorySnippetPart(snippet.substring(cursor, at), false)
        val lower = found.value.lowercase()
        parts += MemorySnippetPart(found.value, terms.any { lower.startsWith(it) })
        cursor = found.range.last + 1
    }
    if (cursor < snippet.length) parts += MemorySnippetPart(snippet.substring(cursor), false)
    return parts
}

private fun snippetParts(snippet: String, query: String = "") = highlightedSnippetParts(snippet.trim(), query)
private fun plural(count: Int, singular: String, plural: String = singular + "s") = if (count == 1) singular else plural
private fun JsonObject?.string(key: String): String? = (this?.get(key) as? JsonPrimitive)?.takeIf { it.isString }?.content
private fun JsonObject?.nonEmpty(key: String): String? = string(key)?.takeIf(String::isNotEmpty)
private fun scopeFromDetails(details: JsonObject?, fallback: String) = details.string("scope")?.takeIf { it == "global" || it == "project" } ?: fallback
private fun fallbackScope(args: JsonObject?) = if (args.string("scope") == "global") "global" else "project"

// The server writes a hit as `scope:file — Title ("Heading", rank -0.42)`: BM25 ranks are negative, and older text said `section "Heading"`.
private val hitBlock = Regex("""(global|project):(\S+) — (.+?) \((?:(?:section )?"([^"]*)"|intro), rank (-?[0-9.]+)\)\n?([\s\S]*)""")
private val linkLine = Regex("""- (?:global:)?(\S+): (.*?) — (.*)""")
private val readHead = Regex("""(global|project):(\S+) — (.+)""")
private val matchLine = Regex("""- (global|project):(\S+) — (.+?)(?:, section "([^"]*)")?: ([\s\S]*)""")

private fun search(part: ChatPart, args: JsonObject?, details: JsonObject?, failed: Boolean): MemoryCallView.Search {
    val query = args.nonEmpty("query").orEmpty()
    val hits = part.text.split("\n\n").mapNotNull { block ->
        val match = hitBlock.matchEntire(block.trim()) ?: return@mapNotNull null
        val (scope, fileId, title, _, rank, snippet) = match.destructured
        // An unmatched group reads as "" from `destructured`; the introduction's heading is null.
        MemoryTopic(if (scope == "global") "global" else "project", fileId, title, match.groups[4]?.value, snippetParts(snippet, query), rank.toDoubleOrNull() ?: 0.0)
    }
    val count = (details?.get("hits") as? JsonPrimitive)?.takeUnless { it.isString }?.intOrNull ?: hits.size
    val summary = "Searched memory for “$query” · " + if (count == 0) "no matches" else "$count ${plural(count, "match", "matches")}"
    val scope = args.string("scope")?.takeIf { it == "global" || it == "project" || it == "both" } ?: "both"
    return MemoryCallView.Search(summary, scope, part.text, failed, query, hits, count)
}

private fun read(part: ChatPart, args: JsonObject?, details: JsonObject?, failed: Boolean): MemoryCallView.Read {
    val lines = part.text.split("\n")
    val first = readHead.matchEntire(lines.firstOrNull()?.trim().orEmpty())
    val scope = scopeFromDetails(details, if (first?.groupValues?.get(1) == "global") "global" else fallbackScope(args))
    val fileId = args.nonEmpty("fileId") ?: details.string("fileId") ?: first?.groupValues?.get(2).orEmpty()
    val title = first?.groupValues?.get(3)
    var summaryText: String? = null; var status: String? = null; var updated: String? = null
    var tags = emptyList<String>()
    val links = mutableListOf<MemoryTopic>()
    var index = if (first == null) 0 else 1
    while (index < lines.size) {
        val line = lines[index]
        when {
            line.startsWith("Summary: ") -> summaryText = line.removePrefix("Summary: ").trim()
            line.startsWith("Tags: ") -> {
                val split = line.removePrefix("Tags: ").split("; status: ")
                tags = if (split[0] == "none") emptyList() else split[0].split(",").map(String::trim).filter(String::isNotEmpty)
                status = split.getOrNull(1)?.split(",")?.first()?.trim()
            }
            line.startsWith("Updated: ") -> updated = line.removePrefix("Updated: ").trim()
            line.startsWith("Links:") -> {
                index += 1
                while (index < lines.size && lines[index].startsWith("- ")) {
                    val trimmed = lines[index].trim()
                    linkLine.matchEntire(trimmed)?.let { MemoryTopic(if (trimmed.startsWith("- global:")) "global" else scope, it.groupValues[1], it.groupValues[2], null, snippetParts(it.groupValues[3])) }?.let(links::add)
                    index += 1
                }
                index -= 1
            }
            line.isBlank() -> {}
            else -> break
        }
        index += 1
    }
    val intro = mutableListOf<String>()
    val sections = mutableListOf<Pair<String, StringBuilder>>()
    for (line in lines.drop(index)) when {
        line.startsWith("## ") -> sections += line.substring(3).trim() to StringBuilder()
        sections.isNotEmpty() -> sections.last().second.let { if (it.isNotEmpty()) it.append('\n'); it.append(line) }
        else -> intro += line
    }
    val summary = "Read ${fileId.ifEmpty { "memory" }}" + if (sections.isEmpty()) "" else " · ${sections.size} ${plural(sections.size, "section")}"
    return MemoryCallView.Read(summary, scope, part.text, failed, fileId, title, summaryText, tags, status, updated,
        intro.joinToString("\n").trim(), sections.map { MemorySection(it.first, it.second.toString().trim()) }, links)
}

private fun write(part: ChatPart, args: JsonObject?, details: JsonObject?, failed: Boolean): MemoryCallView.Write {
    val output = part.text
    val fileId = args.nonEmpty("fileId") ?: details.string("fileId").orEmpty()
    val heading = args.nonEmpty("heading")
    val closeMatches = output.split("\n").filter { it.startsWith("- ") }.mapNotNull { line ->
        matchLine.matchEntire(line.trim())?.let { MemoryTopic(if (it.groupValues[1] == "global") "global" else "project", it.groupValues[2], it.groupValues[3], it.groups[4]?.value, snippetParts(it.groupValues[5])) }
    }
    val outcome = when {
        failed -> "failed"
        output.startsWith("Memory close to ") -> "suggested"
        details?.get("created") == JsonPrimitive(true) || output.startsWith("Created ") -> "created"
        "already reads that way" in output -> "unchanged"
        else -> "updated"
    }
    val target = fileId.ifEmpty { "memory" }
    val where = heading?.let { " › $it" }.orEmpty()
    val summary = when (outcome) {
        "created" -> "Created $target$where"
        "unchanged" -> "No change to $target$where"
        "suggested" -> "Didn't create $target" + if (closeMatches.isEmpty()) "" else " · ${closeMatches.size} close ${plural(closeMatches.size, "match", "matches")}"
        else -> "Saved to $target$where"
    }
    return MemoryCallView.Write(summary, scopeFromDetails(details, fallbackScope(args)), output, failed, fileId, heading, args.nonEmpty("text").orEmpty(), outcome, closeMatches)
}

private fun archive(part: ChatPart, args: JsonObject?, details: JsonObject?, failed: Boolean): MemoryCallView.Archive {
    val fileId = args.nonEmpty("fileId") ?: details.string("fileId") ?: "memory"
    val reason = args.nonEmpty("reason")
    return MemoryCallView.Archive("Archived $fileId" + reason?.let { " — $it" }.orEmpty(), scopeFromDetails(details, fallbackScope(args)), part.text, failed, fileId, reason)
}

/** What one memory tool call says, in the card's terms; a failed call's summary says which tool failed. */
fun memoryCallView(part: ChatPart): MemoryCallView {
    val args = part.arguments as? JsonObject
    val details = part.details as? JsonObject
    val failed = part.status == "error"
    val view = when (part.name) {
        "memory_search" -> search(part, args, details, failed)
        "memory_read" -> read(part, args, details, failed)
        "memory_write" -> write(part, args, details, failed)
        else -> archive(part, args, details, failed)
    }
    if (!failed) return view
    val label = "Memory ${when (view) { is MemoryCallView.Search -> "search"; is MemoryCallView.Read -> "read"; is MemoryCallView.Write -> "write"; is MemoryCallView.Archive -> "archive" }} failed"
    return when (view) {
        is MemoryCallView.Search -> view.copy(summary = label)
        is MemoryCallView.Read -> view.copy(summary = label)
        is MemoryCallView.Write -> view.copy(summary = label)
        is MemoryCallView.Archive -> view.copy(summary = label)
    }
}
