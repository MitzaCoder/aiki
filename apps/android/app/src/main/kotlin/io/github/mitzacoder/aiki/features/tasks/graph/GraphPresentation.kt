package io.github.mitzacoder.aiki.features.tasks.graph

/** Screen-space label budget. Never shrink names to fit the whole project into one phone. */
const val GRAPH_DOT_LABEL_MIN_WIDTH = 132f
const val GRAPH_DOT_LABEL_MAX_WIDTH = 168f
const val GRAPH_DOT_TARGET_HEIGHT = 104f
const val GRAPH_DOT_LABEL_GAP = 16f

/** Explicit line breaks prevent platform fallback from splitting a word over two lines. */
fun graphDotLabel(title: String, width: Float, measure: (String) -> Float): String {
    val words = title.trim().split(Regex("\\s+")).filter { it.isNotEmpty() }
    if (words.isEmpty()) return ""
    fun ellipsize(text: String): String {
        var end = text.length
        while (end > 0 && measure(text.take(end).trimEnd() + "…") > width) end--
        return text.take(end).trimEnd() + "…"
    }
    if (measure(title.trim()) <= width) return title.trim()
    if (measure(words.first()) > width) return ellipsize(words.first())
    var firstCount = 1
    while (firstCount < words.size && measure(words.take(firstCount + 1).joinToString(" ")) <= width) firstCount++
    val first = words.take(firstCount).joinToString(" ")
    val remaining = words.drop(firstCount)
    val last = remaining.joinToString(" ")
    if (measure(last) <= width) return "$first\n$last"
    var lastCount = 0
    while (lastCount < remaining.size && measure(remaining.take(lastCount + 1).joinToString(" ") + "…") <= width) lastCount++
    return first + "\n" + if (lastCount == 0) ellipsize(remaining.first()) else remaining.take(lastCount).joinToString(" ") + "…"
}

data class GraphDotCounts(val tasks: Int, val needsYou: Int, val statuses: Map<String, Int>)
fun graphDotCounts(model: GraphModel, ids: List<String>): GraphDotCounts {
    val cards = ids.distinct().mapNotNull(model.details::get)
    return GraphDotCounts(cards.size, cards.count { it.reasons.isNotEmpty() }, cards.groupingBy { it.task.status }.eachCount())
}

/** One fixed meta row; the complete words remain in the card's spoken name and task details. */
fun graphCanvasMeta(d: GraphTask, holdsUp: Int, now: Long): String = buildList {
    if (d.reasons.isNotEmpty()) add(d.reasons.joinToString(" ") { reason -> graphReasons.first { it.key == reason }.mark })
    if (d.children.isNotEmpty()) add(d.progress.replace(" of ", "/").replace(" subtasks done", " done"))
    if (d.quiet) add("◴ " + graphQuietAge(d.task.updatedAt, now).removePrefix("quiet ").replace(" d", "d"))
    if (holdsUp > 0) add("holds up $holdsUp")
}.joinToString(" · ")
