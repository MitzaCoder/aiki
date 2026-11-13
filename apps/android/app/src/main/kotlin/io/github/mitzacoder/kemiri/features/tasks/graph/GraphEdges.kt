package io.github.mitzacoder.kemiri.features.tasks.graph

import kotlin.math.*

data class GraphRelationship(val from: String, val to: String, val kind: String)
data class GraphRoute(val relationship: GraphRelationship, val points: List<GraphPoint>)
fun graphRelationships(model: GraphModel, layout: GraphLayout, selected: String?, familyId: String?): List<GraphRelationship> = buildList {
    layout.cards.values.forEach { card ->
        card.parent?.let { add(GraphRelationship(card.id, it, "subtask")) }
        val d = model.details[card.id] ?: return@forEach
        if (card.id == selected || card.familyId == familyId) {
            d.task.foundWhile?.let { add(GraphRelationship(card.id, it, "found-while")) }
            d.task.blockedBy.forEach { add(GraphRelationship(card.id, it, "blocked-by")) }
            d.task.related.orEmpty().forEach { add(GraphRelationship(card.id, it, "related")) }
        }
    }
}.distinct()
private fun segmentCrosses(a: GraphPoint, b: GraphPoint, box: GraphRect): Boolean = if (a.x == b.x)
    a.x > box.x && a.x < box.right && min(a.y, b.y) < box.bottom && max(a.y, b.y) > box.y
else a.y > box.y && a.y < box.bottom && min(a.x, b.x) < box.right && max(a.x, b.x) > box.x

/** Axis-aligned corridors outside family bounds, matching the web's obstacle-free reserved gutters. */
private class GraphCorridors(private val layout: GraphLayout) {
    private val gap = layout.options.familyGap / 2
    private val xs = layout.families.flatMap { listOf(it.bounds.x - gap, it.bounds.right + gap) }.distinct().sorted()
    private val ys = layout.families.flatMap { listOf(it.bounds.y - gap, it.bounds.bottom + gap) }.distinct().sorted()
    private val blocked = mutableMapOf<Pair<Int, Int>, Boolean>()
    private fun point(i: Int) = GraphPoint(xs[i % xs.size], ys[i / xs.size])
    fun route(a: GraphPoint, b: GraphPoint): List<GraphPoint> {
        val start = ys.indexOf(a.y) * xs.size + xs.indexOf(a.x)
        val end = ys.indexOf(b.y) * xs.size + xs.indexOf(b.x)
        val parents = mutableMapOf(start to -1)
        val queue = ArrayDeque(listOf(start))
        while (queue.isNotEmpty() && end !in parents) {
            val i = queue.removeFirst(); val column = i % xs.size; val row = i / xs.size
            val neighbors = listOf(if (column > 0) i - 1 else -1, if (row > 0) i - xs.size else -1,
                if (column + 1 < xs.size) i + 1 else -1, if (row + 1 < ys.size) i + xs.size else -1)
            for (n in neighbors) {
                if (n < 0 || n in parents) continue
                val key = min(i, n) to max(i, n)
                if (blocked.getOrPut(key) { layout.families.any { segmentCrosses(point(i), point(n), it.bounds) } }) continue
                parents[n] = i; queue.addLast(n)
            }
        }
        if (end !in parents) return emptyList()
        val path = mutableListOf<GraphPoint>(); var i = end
        while (i >= 0) { path.add(point(i)); i = parents.getValue(i) }
        return path.reversed()
    }
}
fun routeGraphRelationships(layout: GraphLayout, edges: List<GraphRelationship>, detail: GraphDetail): List<GraphRoute> {
    val families = layout.families.associateBy { it.id }
    val corridors by lazy { GraphCorridors(layout) }
    fun gateway(f: GraphRegion, b: GraphRect): List<GraphPoint> {
        val x = f.bounds.x + layout.options.padding / 2; val y = f.bounds.y + layout.options.headerHeight / 2
        return listOf(GraphPoint(b.x, b.center.y), GraphPoint(x, b.center.y), GraphPoint(x, y), GraphPoint(f.bounds.x, y),
            GraphPoint(f.bounds.x - layout.options.familyGap / 2, y), GraphPoint(f.bounds.x - layout.options.familyGap / 2, f.bounds.y - layout.options.familyGap / 2))
    }
    return edges.mapNotNull { edge ->
        val from = layout.cards[edge.from] ?: return@mapNotNull null
        val to = layout.cards[edge.to] ?: return@mapNotNull null
        if (from.id == to.id) return@mapNotNull null
        val a = if (detail == GraphDetail.Pills) from.pill else from.box
        val b = if (detail == GraphDetail.Pills) to.pill else to.box
        val f = families.getValue(from.familyId)
        val points = if (from.familyId == to.familyId) {
            val exterior = f.bounds.x + layout.options.padding / 2
            var gutter = if (edge.kind == "subtask") min(a.x, b.x) - layout.options.padding / 2 else exterior
            if (layout.cards.values.any { it.familyId == from.familyId && segmentCrosses(GraphPoint(gutter, a.center.y), GraphPoint(gutter, b.center.y), if (detail == GraphDetail.Pills) it.pill else it.occupied) }) gutter = exterior
            listOf(GraphPoint(a.x, a.center.y), GraphPoint(gutter, a.center.y), GraphPoint(gutter, b.center.y), GraphPoint(b.x, b.center.y))
        } else {
            val start = gateway(f, a); val end = gateway(families.getValue(to.familyId), b)
            start + corridors.route(start.last(), end.last()) + end.reversed()
        }
        GraphRoute(edge, points.fold(emptyList()) { acc, point -> if (acc.lastOrNull() == point) acc else acc + point })
    }
}
