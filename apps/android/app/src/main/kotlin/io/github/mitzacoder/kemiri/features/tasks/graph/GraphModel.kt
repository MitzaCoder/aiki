package io.github.mitzacoder.kemiri.features.tasks.graph

import io.github.mitzacoder.kemiri.protocol.*
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter

/** Read-only graph semantics, parallel to the web model. All ancestors participate before visibility filtering. */
data class GraphTask(
    val task: BoardTask, val familyId: String, val familyTitle: String, val progress: String,
    val reasons: List<String>, val questions: List<BoardQuestion>, val quiet: Boolean,
    val children: List<String>, val blocks: List<String>, val workers: List<WorkerSummary>, val threads: List<ThreadSummary>,
)
data class GraphFamily(val id: String, val title: String, val cards: List<GraphTreeCard>, val needsYou: Int, val progress: String)
data class GraphTreeCard(val id: String, val depth: Int)
data class GraphCounter(val key: String, val label: String, val mark: String, val count: Int)
data class GraphSearchResult(val taskId: String, val score: Int, val matched: String)
data class GraphHoldsUp(val direct: Int, val total: Int)
data class GraphStatus(val key: String, val label: String, val mark: String)
val graphStatuses = listOf(
    GraphStatus("todo", "Planned", "○"), GraphStatus("in_progress", "Working", "▶"),
    GraphStatus("review", "Review", "◇"), GraphStatus("blocked", "Blocked", "⊣"),
    GraphStatus("waiting", "Waiting", "◷"), GraphStatus("done", "Done", "✓"), GraphStatus("dropped", "Dropped", "−"),
)
val graphReasons = listOf(
    GraphStatus("review", "Review", "◇"), GraphStatus("blocked", "Blocked", "⊣"),
    GraphStatus("waiting", "Waiting", "◷"), GraphStatus("question", "Question / warning", "?"), GraphStatus("failed", "Worker failed", "!"),
)
fun graphStatus(status: String) = graphStatuses.find { it.key == status } ?: GraphStatus(status, status, "○")
fun graphClosed(status: String) = status == "done" || status == "dropped"
fun graphTimestamp(at: String): Long? = runCatching { Instant.parse(at).toEpochMilli() }.getOrNull()
fun graphQuietAge(at: String, now: Long) = "quiet ${((now - (graphTimestamp(at) ?: now)).coerceAtLeast(0) / 86_400_000)} d"
fun graphWaitingDate(until: String?, now: Long): String {
    val at = until?.let(::graphTimestamp) ?: return ""
    return if (at < now) "overdue" else "until " + DateTimeFormatter.ofPattern("MMM d").withZone(ZoneId.systemDefault()).format(Instant.ofEpochMilli(at))
}

class GraphModel(val details: Map<String, GraphTask>) {
    private val counted = details.values.filter { !it.task.archived }
    val counters = graphReasons.map { reason -> GraphCounter("reason:${reason.key}", reason.label, reason.mark, counted.count { reason.key in it.reasons }) } +
        GraphCounter("quiet", "Quiet", "◴", counted.count { it.quiet }) +
        listOf("in_progress", "todo", "done", "dropped").map { key ->
            val status = graphStatus(key)
            GraphCounter("status:$key", status.label, status.mark, counted.count { it.task.status == key })
        }
    fun matches(id: String, counter: String?): Boolean {
        val card = details[id] ?: return false
        return when {
            counter == null -> true
            counter == "quiet" -> card.quiet
            counter.startsWith("reason:") -> counter.removePrefix("reason:") in card.reasons
            else -> card.task.status == counter.removePrefix("status:")
        }
    }
    private val dependents by lazy {
        counted.filter { !graphClosed(it.task.status) }.flatMap { d -> d.task.blockedBy.map { it to d.task.id } }.groupBy({ it.first }, { it.second })
    }
    fun directDependents(id: String) = dependents[id].orEmpty().toSet() - id
    /** Unfinished dependents only, with cycle and diamond defense. */
    fun allDependents(id: String): Set<String> {
        val direct = directDependents(id)
        val seen = mutableSetOf(id)
        val pending = ArrayDeque(direct)
        while (pending.isNotEmpty()) {
            val child = pending.removeLast()
            if (seen.add(child)) pending.addAll(dependents[child].orEmpty())
        }
        return seen - id
    }
    fun holdsUp(id: String) = GraphHoldsUp(directDependents(id).size, allDependents(id).size)
    fun search(query: String): List<GraphSearchResult> {
        val needle = query.trim().lowercase()
        if (needle.isEmpty()) return emptyList()
        return counted.mapNotNull { d ->
            val candidates = listOf(Triple(d.task.id, 100, "Task ID"), Triple(d.task.title, 80, "Title"), Triple(d.familyTitle, 50, "Family")) +
                d.workers.flatMap { listOf(Triple(it.id, 70, "Worker"), Triple(it.title, 60, "Worker")) } + d.threads.map { Triple(it.title, 40, "Thread") }
            val best = candidates.map { (text, weight, kind) ->
                val value = text.lowercase()
                GraphSearchResult(d.task.id, when { value == needle -> weight + 20; value.startsWith(needle) -> weight + 10; needle in value -> weight; else -> 0 }, kind)
            }.maxBy { it.score }
            best.takeIf { it.score > 0 }
        }.sortedWith(compareByDescending<GraphSearchResult> { it.score }.thenComparator { a, b -> graphCompareIds(a.taskId, b.taskId) })
    }
    /** Tree order bridges hidden ancestors, never drops cyclic components, and caps only visual indentation. */
    fun families(showClosed: Boolean, selectedId: String? = null, retainedIds: Set<String> = emptySet()): List<GraphFamily> {
        return counted.filter { showClosed || !graphClosed(it.task.status) || it.task.id == selectedId || it.task.id in retainedIds }.groupBy { it.familyId }.map { (familyId, cards) ->
            val visible = cards.map { it.task.id }.toSet()
            val parents = cards.associate { card ->
                val seen = mutableSetOf(card.task.id)
                var parent = card.task.parent
                while (parent != null && parent !in visible && seen.add(parent)) parent = details[parent]?.task?.parent
                card.task.id to parent?.takeIf { it in visible && it !in seen }
            }
            val ordered = mutableListOf<GraphTreeCard>()
            val visited = mutableSetOf<String>()
            fun visit(id: String, depth: Int) {
                if (!visited.add(id)) return
                ordered.add(GraphTreeCard(id, depth))
                cards.filter { parents[it.task.id] == id }.sortedWith(graphTaskOrder).forEach { visit(it.task.id, depth + 1) }
            }
            cards.filter { parents[it.task.id] == null }.sortedWith(graphTaskOrder).forEach { visit(it.task.id, 0) }
            cards.sortedWith(graphTaskOrder).forEach { visit(it.task.id, 0) }
            GraphFamily(familyId, cards.first().familyTitle, ordered, cards.count { it.reasons.isNotEmpty() }, cards.first().progress)
        }.sortedWith { a, b -> graphCompareIds(a.id, b.id) }
    }
}
private val graphTaskOrder = compareBy<GraphTask> { it.task.order }.thenComparator { a, b -> graphCompareIds(a.task.id, b.task.id) }
fun graphCompareIds(a: String, b: String): Int {
    val digits = Regex("^(.*?)(\\d+)$")
    val am = digits.matchEntire(a); val bm = digits.matchEntire(b)
    if (am != null && bm != null && am.groupValues[1] == bm.groupValues[1]) return am.groupValues[2].toLong().compareTo(bm.groupValues[2].toLong())
    return a.compareTo(b)
}

fun buildGraphModel(tasks: List<BoardTask>, questions: List<BoardQuestion>, workers: List<WorkerSummary>, threads: List<ThreadSummary>, now: Long): GraphModel {
    val byId = tasks.associateBy { it.id }
    val families = mutableMapOf<String, String>()
    for (task in tasks) {
        if (task.id in families) continue
        val path = mutableListOf<String>()
        var id = task.id
        var root: String
        while (true) {
            val cached = families[id]
            if (cached != null) { root = cached; break }
            val cycle = path.indexOf(id)
            if (cycle >= 0) { root = path.drop(cycle).min(); break }
            path.add(id)
            val parent = byId[id]?.parent
            if (parent == null) { root = id; break }
            id = parent
        }
        path.forEach { families[it] = root }
    }
    val children = tasks.filter { it.parent != null }.groupBy { it.parent }
    val blocks = tasks.flatMap { task -> task.blockedBy.distinct().map { it to task.id } }.groupBy({ it.first }, { it.second })
    val progress = tasks.groupBy { families[it.id] }.mapValues { (root, members) ->
        val subtasks = members.filter { it.id != root && it.status != "dropped" }
        "${subtasks.count { it.status == "done" }} of ${subtasks.size} subtasks done"
    }
    val questionsByTask = questions.filter { it.status == "open" }.groupBy { it.taskId }
    val workersByTask = workers.flatMap { worker ->
        (worker.taskId?.let(::listOf) ?: tasks.filter { worker.id in it.workerIds }.map { it.id }).map { it to worker }
    }.groupBy({ it.first }, { it.second })
    val threadsByTask = threads.flatMap { thread ->
        (listOfNotNull(thread.taskId) + thread.ownedTasks + tasks.filter { it.ownerThreadId == thread.id }.map { it.id }).distinct().map { it to thread }
    }.groupBy({ it.first }, { it.second })
    return GraphModel(tasks.associate { task ->
        val familyId = families.getValue(task.id)
        val taskQuestions = questionsByTask[task.id].orEmpty()
        val taskWorkers = workersByTask[task.id].orEmpty()
        val reasons = buildList {
            if (task.status in listOf("review", "blocked", "waiting")) add(task.status)
            if (taskQuestions.isNotEmpty()) add("question")
            if (taskWorkers.any { it.status == "failed" }) add("failed")
        }
        task.id to GraphTask(task, familyId, byId[familyId]?.title ?: familyId, progress.getValue(familyId), reasons, taskQuestions,
            !graphClosed(task.status) && (graphTimestamp(task.updatedAt)?.let { now - it >= 48 * 3_600_000L } ?: false),
            children[task.id].orEmpty().map { it.id }, blocks[task.id].orEmpty(), taskWorkers, threadsByTask[task.id].orEmpty())
    })
}

/** Sheet dismissal preserves selection. The next Back clears selection/highlights; the next leaves Graph. */
data class GraphBackState(val sheet: Boolean, val selected: String?, val highlight: String?)
fun graphBack(state: GraphBackState): GraphBackState? = when {
    state.sheet -> state.copy(sheet = false)
    state.selected != null || state.highlight != null -> GraphBackState(false, null, null)
    else -> null
}
fun initialGraphFamily(families: List<GraphFamily>, selected: GraphTask?): String? = selected?.familyId ?: families.maxByOrNull { it.needsYou }?.id
