package io.github.mitzacoder.aiki.features.tasks.graph

import kotlin.math.*

/** Stable family slots, ported from task-graph-families.ts. Geometry has no status/crew/report inputs. */
data class GraphPoint(val x: Float, val y: Float)
data class GraphRect(val x: Float, val y: Float, val width: Float, val height: Float) {
    val right get() = x + width
    val bottom get() = y + height
    val center get() = GraphPoint(x + width / 2, y + height / 2)
    fun overlaps(b: GraphRect) = x < b.right && right > b.x && y < b.bottom && bottom > b.y
    fun expand(padding: Float) = GraphRect(x - padding, y - padding, width + padding * 2, height + padding * 2)
}
data class GraphLayoutTask(val id: String, val parent: String?, val familyId: String, val order: Double = 0.0, val createdAt: String = "")
data class GraphLayoutOptions(
    val cardWidth: Float = 300f, val cardHeight: Float = 180f, val crewHeight: Float = 32f,
    val gap: Float = 28f, val indent: Float = 28f, val padding: Float = 24f, val headerHeight: Float = 56f,
    val familyGap: Float = 56f, val reserveSlots: Int = 2, val reserveDepth: Int = 2, val aspect: Float = 1.5f,
    val pillWidth: Float = 264f, val pillHeight: Float = 72f,
)
data class GraphSlot(val taskId: String?, val parent: String?, val depth: Int, val x: Float, val y: Float)
data class GraphRegion(val id: String, val bounds: GraphRect, val slots: List<GraphSlot>, val taskIds: List<String> = emptyList())
data class GraphLayoutCard(val id: String, val familyId: String, val parent: String?, val depth: Int, val box: GraphRect, val occupied: GraphRect, val pill: GraphRect)
data class GraphLayout(val families: List<GraphRegion>, val cards: Map<String, GraphLayoutCard>, val bounds: GraphRect, val options: GraphLayoutOptions, val needsRegroup: Boolean, val movedFamilyIds: List<String> = emptyList())
private fun boundsOf(boxes: List<GraphRect>): GraphRect {
    if (boxes.isEmpty()) return GraphRect(0f, 0f, 0f, 0f)
    val x = boxes.minOf { it.x }; val y = boxes.minOf { it.y }
    return GraphRect(x, y, boxes.maxOf { it.right } - x, boxes.maxOf { it.bottom } - y)
}
private data class LayoutTree(val tasks: Map<String, GraphLayoutTask>, val parents: Map<String, String?>, val depth: Map<String, Int>, val ordered: List<GraphLayoutTask>)
private fun graphLayoutTree(input: List<GraphLayoutTask>): LayoutTree {
    require(input.map { it.id }.distinct().size == input.size) { "Duplicate layout task" }
    val tasks = input.associateBy { it.id }
    val parents = input.associate { it.id to it.parent?.takeIf { parent -> parent in tasks && tasks[parent]?.familyId == it.familyId } }.toMutableMap()
    val complete = mutableSetOf<String>()
    for (task in input) {
        val chain = mutableListOf<String>()
        var id: String? = task.id
        while (id != null && id !in complete) {
            val cycle = chain.indexOf(id)
            if (cycle >= 0) { parents[chain.drop(cycle).min()] = null; break }
            chain.add(id); id = parents[id]
        }
        complete.addAll(chain)
    }
    val order = compareBy<GraphLayoutTask> { it.order }.thenBy { it.createdAt }.thenBy { it.id }
    val children = input.groupBy { parents[it.id] }.mapValues { it.value.sortedWith(order) }
    val stack = ArrayDeque(children[null].orEmpty().reversed().map { it to 0 })
    val ordered = mutableListOf<GraphLayoutTask>(); val depths = mutableMapOf<String, Int>()
    while (stack.isNotEmpty()) {
        val (task, depth) = stack.removeLast()
        ordered.add(task); depths[task.id] = depth
        children[task.id].orEmpty().asReversed().forEach { stack.addLast(it to depth + 1) }
    }
    return LayoutTree(tasks, parents, depths, ordered)
}
private fun layoutSlot(id: String?, parent: String?, row: Int, depth: Int, o: GraphLayoutOptions) =
    GraphSlot(id, parent, depth, o.padding + depth * o.indent, o.headerHeight + o.padding + row * (o.cardHeight + o.crewHeight + o.gap))
private fun freshRegion(id: String, tasks: List<GraphLayoutTask>, tree: LayoutTree, o: GraphLayoutOptions): GraphRegion {
    val slots = tasks.mapIndexed { row, task -> layoutSlot(task.id, task.parent, row, tree.depth.getValue(task.id), o) }.toMutableList()
    repeat(o.reserveSlots) { slots.add(layoutSlot(null, null, slots.size, 0, o)) }
    val depth = slots.maxOfOrNull { it.depth } ?: 0
    return GraphRegion(id, GraphRect(0f, 0f, o.padding * 2 + o.cardWidth + (depth + o.reserveDepth) * o.indent,
        o.headerHeight + o.padding * 2 + slots.size * (o.cardHeight + o.crewHeight + o.gap) - o.gap), slots)
}
private fun packRegions(families: List<GraphRegion>, o: GraphLayoutOptions): List<GraphRegion> {
    val target = sqrt(families.sumOf { ((it.bounds.width + o.familyGap) * (it.bounds.height + o.familyGap)).toDouble() }.toFloat() * o.aspect)
    var x = 0f; var y = 0f; var height = 0f
    return families.map { f ->
        if (x > 0 && x + f.bounds.width > target) { x = 0f; y += height + o.familyGap; height = 0f }
        val placed = f.copy(bounds = f.bounds.copy(x = x, y = y))
        x += f.bounds.width + o.familyGap; height = max(height, f.bounds.height)
        placed
    }
}
fun layoutGraphFamilies(input: List<GraphLayoutTask>, previous: GraphLayout? = null, options: GraphLayoutOptions = GraphLayoutOptions()): GraphLayout {
    val o = previous?.options ?: options
    val tree = graphLayoutTree(input)
    val membership = previous?.families.orEmpty().flatMap { f -> f.slots.mapNotNull { s -> s.taskId?.let { it to f.id } } }.toMap()
    var needsRegroup = previous?.needsRegroup ?: false
    val groups = linkedMapOf<String, MutableList<GraphLayoutTask>>()
    for (task in tree.ordered) {
        val family = membership[task.id] ?: task.familyId
        if (family != task.familyId) needsRegroup = true
        groups.getOrPut(family) { mutableListOf() }.add(task)
    }
    val grown = mutableSetOf<String>()
    var families = previous?.families.orEmpty().map { old ->
        val slots = old.slots.toMutableList(); var box = old.bounds
        for (task in groups.remove(old.id).orEmpty()) {
            val retained = slots.firstOrNull { it.taskId == task.id }
            if (retained != null) { if (retained.parent != task.parent) needsRegroup = true; continue }
            val row = slots.indexOfFirst { it.taskId == null }.takeIf { it >= 0 } ?: slots.size
            val slot = layoutSlot(task.id, task.parent, row, tree.depth.getValue(task.id), o)
            if (row < slots.size) slots[row] = slot else slots.add(slot)
            val width = slot.x + o.cardWidth + o.padding
            val height = slot.y + o.cardHeight + o.crewHeight + o.padding
            if (width > box.width || height > box.height) {
                box = box.copy(width = max(box.width, width), height = max(box.height, height))
                grown.add(old.id); needsRegroup = true
            }
        }
        old.copy(bounds = box, slots = slots)
    }.toMutableList()
    val moved = mutableListOf<String>()
    if (grown.isNotEmpty()) {
        val placed = mutableListOf<GraphRegion>()
        for (family in families.sortedWith(compareByDescending<GraphRegion> { it.id in grown }.thenBy { it.id })) {
            var box = family.bounds
            do {
                var collision = false
                for (other in placed) if (box.overlaps(other.bounds.expand(o.familyGap))) {
                    box = box.copy(y = other.bounds.bottom + o.familyGap); collision = true
                }
            } while (collision)
            if (box.y != family.bounds.y) moved.add(family.id)
            placed.add(family.copy(bounds = box))
        }
        families = families.map { family -> placed.first { it.id == family.id } }.toMutableList()
    }
    val arrivals = packRegions(groups.toSortedMap().map { (id, tasks) -> freshRegion(id, tasks, tree, o) }, o)
    val offset = if (previous == null || families.isEmpty()) 0f else boundsOf(families.map { it.bounds }).bottom + o.familyGap
    families.addAll(arrivals.map { it.copy(bounds = it.bounds.copy(y = it.bounds.y + offset)) })
    val cards = linkedMapOf<String, GraphLayoutCard>()
    families = families.map { f ->
        val ids = mutableListOf<String>()
        f.slots.forEachIndexed { row, s ->
            val id = s.taskId
            if (id != null && id in tree.tasks) {
                ids.add(id)
                val x = f.bounds.x + s.x; val y = f.bounds.y + s.y
                cards[id] = GraphLayoutCard(id, f.id, tree.parents[id], s.depth,
                    GraphRect(x, y + o.crewHeight, o.cardWidth, o.cardHeight), GraphRect(x, y, o.cardWidth, o.cardHeight + o.crewHeight),
                    GraphRect(f.bounds.x + o.padding + s.depth * o.indent * min(1f, o.pillWidth / o.cardWidth),
                        f.bounds.y + o.headerHeight + o.padding + row * (o.pillHeight + o.gap / 2), o.pillWidth, o.pillHeight))
            }
        }
        f.copy(taskIds = ids)
    }.toMutableList()
    return GraphLayout(families, cards, boundsOf(families.map { it.bounds }), o, needsRegroup, moved)
}

enum class GraphDetail { Cards, Pills, Dots }
fun graphDetail(zoom: Float, previous: GraphDetail? = null): GraphDetail {
    val card = 12f / 14f * if (previous == null || previous == GraphDetail.Cards) 1f else 1.08f
    val pill = max(12f / 22f, 48f / 72f) * if (previous == GraphDetail.Dots) 1.08f else 1f
    return when { zoom >= card -> GraphDetail.Cards; zoom >= pill -> GraphDetail.Pills; else -> GraphDetail.Dots }
}
data class GraphCamera(val x: Float = 0f, val y: Float = 0f, val zoom: Float = 1f) {
    fun point(p: GraphPoint) = GraphPoint(p.x * zoom + x, p.y * zoom + y)
    fun box(b: GraphRect) = GraphRect(b.x * zoom + x, b.y * zoom + y, b.width * zoom, b.height * zoom)
    fun zoomAt(at: GraphPoint, factor: Float, pan: GraphPoint = GraphPoint(0f, 0f), minimum: Float = .05f): GraphCamera {
        val next = (zoom * factor).coerceIn(minimum, 2f)
        return GraphCamera(at.x - (at.x - x) * next / zoom + pan.x, at.y - (at.y - y) * next / zoom + pan.y, next)
    }
}
fun graphFit(box: GraphRect, width: Float, height: Float, maximum: Float = 1f): GraphCamera {
    if (box.width <= 0 || box.height <= 0) return GraphCamera()
    val zoom = min(maximum, min((width - 48).coerceAtLeast(1f) / box.width, (height - 48).coerceAtLeast(1f) / box.height))
    return GraphCamera((width - box.width * zoom) / 2 - box.x * zoom, (height - box.height * zoom) / 2 - box.y * zoom, zoom)
}

/** Dots frame family anchors, not tall hidden card bounds. Touch targets stay apart; labels stay screen-sized. */
fun graphFitDots(families: List<GraphRegion>, width: Float, height: Float): GraphCamera {
    if (families.isEmpty()) return GraphCamera()
    val points = families.map { it.bounds.center }
    val left = points.minOf { it.x }; val top = points.minOf { it.y }
    val spanX = points.maxOf { it.x } - left; val spanY = points.maxOf { it.y } - top
    val minimum = graphMinimumDotZoom(families)
    val zoom = min(.6f, min((width - 56).coerceAtLeast(1f) / spanX.coerceAtLeast(1f), (height - 160).coerceAtLeast(1f) / spanY.coerceAtLeast(1f))).coerceAtLeast(minimum)
    return GraphCamera((width - spanX * zoom) / 2 - left * zoom, 64 + (height - 64 - spanY * zoom) / 2 - top * zoom, zoom)
}

fun graphMinimumDotZoom(families: List<GraphRegion>): Float {
    val points = families.map { it.bounds.center }
    val nearest = points.flatMap { a -> points.filter { it != a && abs(it.y - a.y) < 100 && abs(it.x - a.x) > 1 }.map { abs(it.x - a.x) } }.minOrNull()
    val vertical = points.flatMap { a -> points.filter { it != a && abs(it.x - a.x) < 100 && abs(it.y - a.y) > 1 }.map { abs(it.y - a.y) } }.minOrNull()
    return max(.05f, max(nearest?.let { 48f / it } ?: 0f, vertical?.let { 72f / it } ?: 0f))
}
