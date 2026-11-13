package io.github.mitzacoder.kemiri.features.tasks

import kotlin.math.ln

/** Mutable body postings; unchanged documents are never tokenized again. */
class SearchBM25 {
    data class Document(val text: String, val length: Int, val terms: Map<String, Int>)
    val documents = linkedMapOf<String, Document>()
    val postings = mutableMapOf<String, MutableMap<String, Int>>()
    private var length = 0
    private var vocabulary = emptyList<String>()
    private var dirty = false

    fun set(id: String, text: String) {
        if (documents[id]?.text == text) return
        delete(id)
        val words = searchWords(text)
        val terms = words.groupingBy { it }.eachCount()
        documents[id] = Document(text, words.size, terms)
        length += words.size
        for ((term, count) in terms) {
            if (term !in postings) { postings[term] = mutableMapOf(); dirty = true }
            postings.getValue(term)[id] = count
        }
    }

    fun delete(id: String) {
        val document = documents.remove(id) ?: return
        length -= document.length
        for (term in document.terms.keys) {
            val posting = postings.getValue(term)
            posting.remove(id)
            if (posting.isEmpty()) { postings.remove(term); dirty = true }
        }
    }

    fun search(query: String): Map<String, Double> {
        if (dirty) { vocabulary = postings.keys.sorted(); dirty = false }
        val words = searchWords(query)
        var scores: Map<String, Double>? = null
        for ((index, word) in words.withIndex()) {
            var terms = listOf(word)
            if (index == words.lastIndex && query.lastOrNull()?.isWhitespace() != true) {
                var low = 0; var high = vocabulary.size
                while (low < high) { val mid = (low + high) ushr 1; if (vocabulary[mid] < word) low = mid + 1 else high = mid }
                val prefixes = mutableListOf<String>()
                var at = low
                while (at < vocabulary.size && vocabulary[at].startsWith(word)) { prefixes.add(vocabulary[at]); at++ }
                terms = prefixes
            }
            val matches = mutableMapOf<String, Double>()
            for (term in terms) {
                val posting = postings[term] ?: continue
                val idf = ln(1 + (documents.size - posting.size + 0.5) / (posting.size + 0.5))
                for ((id, frequency) in posting) {
                    if (scores != null && id !in scores) continue
                    val average = if (length == 0) 1.0 else length.toDouble() / documents.size
                    val score = idf * frequency * 2.2 / (frequency + 1.2 * (0.25 + 0.75 * documents.getValue(id).length / average))
                    matches[id] = maxOf(matches[id] ?: 0.0, score)
                }
            }
            for ((id, score) in matches.toMap()) matches[id] = score + (scores?.get(id) ?: 0.0)
            scores = matches
        }
        return scores.orEmpty()
    }
}
