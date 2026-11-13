package io.github.mitzacoder.kemiri.features.tasks

data class TaskSearchDocument(val id: String, val title: String, val refs: List<String>, val body: String, val parent: String? = null)
data class TaskSearchHit(val id: String, val score: Double, val ranges: List<SearchRange> = emptyList(), val snippet: String = "", val context: Boolean = false)

private fun exactKeys(document: TaskSearchDocument): Set<String> = buildSet {
    add(searchFold(document.id)); add(searchFold(document.id.replace(Regex("^[tT]"), "")))
    for (ref in document.refs) {
        Regex("(?:/pull/|/pulls/|#)(\\d+)\\b", RegexOption.IGNORE_CASE).findAll(ref).forEach { add("#${it.groupValues[1]}") }
        Regex("\\b[a-z][a-z0-9]*-\\d+\\b", RegexOption.IGNORE_CASE).findAll(ref).forEach { add(searchFold(it.value)) }
    }
}

/** Keep constants and expectations in sync with web task-search.ts and shared task-search.json. */
class TaskSearchIndex {
    val body = SearchBM25()
    private var hasParents = false
    val documents = linkedMapOf<String, TaskSearchDocument>()
    private val keys = mutableMapOf<String, Set<String>>()
    private val shortFields = mutableMapOf<String, List<FuzzyField>>()
    private val snippets = mutableMapOf<String, Pair<String, String>>()

    fun update(next: List<TaskSearchDocument>) {
        hasParents = next.any { it.parent != null }
        val ids = next.map { it.id }.toSet()
        for (id in documents.keys.toList()) if (id !in ids) { documents.remove(id); body.delete(id); keys.remove(id); shortFields.remove(id); snippets.remove(id) }
        for (document in next) {
            val old = documents[document.id]
            if (old == null || old.title != document.title || old.refs != document.refs) {
                keys[document.id] = exactKeys(document)
                shortFields[document.id] = (listOf(document.title) + document.refs).map(::prepareFuzzy)
            }
            if (old?.body != document.body) { val text = document.body.replace(Regex("\\s+"), " ").trim(); snippets[document.id] = text to searchFold(text) }
            documents[document.id] = document
            body.set(document.id, document.body)
        }
    }

    fun search(query: String, eligible: Set<String>? = null): List<TaskSearchHit> {
        val trimmed = searchFold(query.trim())
        if (trimmed.isEmpty()) return emptyList()
        val bodyScores = body.search(query)
        val needle = searchFold(query).filterNot { it.isWhitespace() }
        val words = searchWords(query)
        val hits = mutableListOf<TaskSearchHit>()
        for ((id, document) in documents) {
            if (eligible != null && id !in eligible) continue
            val fields = shortFields.getValue(id)
            val title = fuzzyPrepared(fields[0], needle)
            var fuzzy = title?.score ?: 0.0
            for (at in 1 until fields.size) fuzzy = maxOf(fuzzy, (fuzzyPrepared(fields[at], needle, false)?.score ?: 0.0) * 0.7)
            val bm25 = bodyScores[id] ?: 0.0
            val exact = trimmed in keys.getValue(id)
            if (!exact && fuzzy == 0.0 && bm25 == 0.0) continue
            val score = if (exact) 4.0 else if (fuzzy > 0) 2 + fuzzy / (fuzzy + 40) else 1 + bm25 / (bm25 + 4)
            hits.add(TaskSearchHit(id, score, title?.ranges.orEmpty(), if (!exact && fuzzy == 0.0) searchSnippet(snippets.getValue(id).first, words, snippets.getValue(id).second) else ""))
        }
        val sorted = hits.sortedByDescending { it.score }
        return if (hasParents) searchFamilyContext(sorted, documents, eligible) else sorted
    }
}

fun searchFamilyContext(hits: List<TaskSearchHit>, documents: Map<String, TaskSearchDocument>, eligible: Set<String>? = null): List<TaskSearchHit> {
    val matches = hits.associateBy { it.id }
    val emitted = mutableSetOf<String>()
    val output = mutableListOf<TaskSearchHit>()
    val visiting = mutableSetOf<String>()
    fun emit(hit: TaskSearchHit) {
        if (hit.id in emitted || !visiting.add(hit.id)) return
        val parent = documents[hit.id]?.parent
        if (parent != null && parent in documents && (eligible == null || parent in eligible)) emit(matches[parent] ?: TaskSearchHit(parent, 0.0, context = true))
        visiting.remove(hit.id); emitted.add(hit.id); output.add(hit)
    }
    hits.forEach { emit(it) }
    return output
}
