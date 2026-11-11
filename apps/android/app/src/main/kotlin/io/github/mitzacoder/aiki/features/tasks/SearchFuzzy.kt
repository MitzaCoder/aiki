package io.github.mitzacoder.aiki.features.tasks

/** UTF-16 offsets and simple character case folding deliberately match the web. */
data class SearchRange(val start: Int, val end: Int)
data class FuzzyMatch(val score: Double, val ranges: List<SearchRange>)
data class FuzzyField(val text: String, val folded: String, val bonuses: DoubleArray)
fun searchFold(text: String): String = buildString(text.length) { text.forEach { append(it.lowercaseChar()) } }
fun searchWords(text: String): List<String> = Regex("[\\p{L}\\p{N}]+").findAll(searchFold(text)).map { it.value }.toList()
fun prepareFuzzy(text: String): FuzzyField {
    val folded = searchFold(text)
    val bonuses = DoubleArray(text.length) { at ->
        val boundary = at == 0 || !folded[at - 1].isLetterOrDigit() || text[at - 1] in 'a'..'z' && text[at] in 'A'..'Z'
        10.0 + (if (boundary) 8 else 0) + 2.0 / (at + 1)
    }
    return FuzzyField(text, folded, bonuses)
}
private class FuzzyScratch {
    var previous = DoubleArray(128)
    var scores = DoubleArray(128)
    var parents = IntArray(2048)
}
private val fuzzyScratch = ThreadLocal.withInitial { FuzzyScratch() }

/** Best subsequence, with boundary, consecutive and early bonuses. Scratch is per thread. */
fun fuzzyPrepared(field: FuzzyField, needle: String, highlights: Boolean = true): FuzzyMatch? {
    val text = field.text; val folded = field.folded
    if (needle.isEmpty() || needle.length > text.length) return null
    var found = -1
    for (letter in needle) { found = folded.indexOf(letter, found + 1); if (found < 0) return null }
    val scratch = fuzzyScratch.get()
    if (scratch.previous.size < text.length) { scratch.previous = DoubleArray(text.length * 2); scratch.scores = DoubleArray(text.length * 2) }
    if (highlights && scratch.parents.size < text.length * needle.length) scratch.parents = IntArray(text.length * needle.length * 2)
    var previous = scratch.previous; var scores = scratch.scores
    previous.fill(Double.NEGATIVE_INFINITY, 0, text.length)
    for (letter in needle.indices) {
        scores.fill(Double.NEGATIVE_INFINITY, 0, text.length)
        var best = Double.NEGATIVE_INFINITY; var bestAt = -1
        for (at in text.indices) {
            if (at > 0 && previous[at - 1] > best) { best = previous[at - 1]; bestAt = at - 1 }
            if (folded[at] != needle[letter]) continue
            if (letter == 0) scores[at] = field.bonuses[at]
            else if (bestAt >= 0) {
                val consecutive = if (at > 0) previous[at - 1] + 6 else Double.NEGATIVE_INFINITY
                if (highlights) scratch.parents[letter * text.length + at] = if (consecutive >= best) at - 1 else bestAt
                scores[at] = field.bonuses[at] + maxOf(best, consecutive)
            }
        }
        val swap = previous; previous = scores; scores = swap
    }
    var end = -1
    for (at in text.indices) if (previous[at] > (if (end < 0) Double.NEGATIVE_INFINITY else previous[end])) end = at
    if (end < 0) return null
    val score = previous[end]
    val ranges = mutableListOf<SearchRange>()
    if (highlights) {
        val positions = IntArray(needle.length)
        for (letter in needle.indices.reversed()) { positions[letter] = end; if (letter > 0) end = scratch.parents[letter * text.length + end] }
        for (at in positions) {
            val last = ranges.lastOrNull()
            if (last?.end == at) ranges[ranges.lastIndex] = last.copy(end = at + 1)
            else ranges.add(SearchRange(at, at + 1))
        }
    }
    return FuzzyMatch(score, ranges)
}
fun fuzzyMatch(text: String, query: String): FuzzyMatch? = fuzzyPrepared(prepareFuzzy(text), searchFold(query).filterNot { it.isWhitespace() })

fun searchSnippet(body: String, words: List<String>, folded: String = searchFold(body)): String {
    val first = words.map { folded.indexOf(it) }.filter { it >= 0 }.minOrNull() ?: body.length
    val start = maxOf(0, first - 36)
    return (if (start > 0) "…" else "") + body.substring(start, minOf(body.length, start + 150)).replace(Regex("\\s+"), " ") + (if (start + 150 < body.length) "…" else "")
}
