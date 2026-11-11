package io.github.mitzacoder.aiki.features.tasks.graph

import io.github.mitzacoder.aiki.protocol.*

data class GraphTaskSnapshot(val status: String, val title: String)
data class GraphQuestionSnapshot(val taskId: String?, val kind: String, val status: String)
data class GraphCrewSnapshot(val taskId: String?, val status: String, val report: String, val title: String)
data class GraphSnapshot(val tasks: Map<String, GraphTaskSnapshot>, val questions: Map<String, GraphQuestionSnapshot>, val crew: Map<String, GraphCrewSnapshot>)
data class GraphChange(val key: String, val taskIds: List<String>, val text: String, val plural: String = text, val workerId: String? = null, val kind: String)
data class GraphChangeEntry(val change: GraphChange, val id: Long, val at: Long, val count: Int, val serial: Long) {
    val text get() = if (count == 1 || change.kind == "report") change.text else "$count ${change.plural}"
}
fun graphSnapshot(tasks: List<BoardTask>, questions: List<BoardQuestion>, workers: List<WorkerSummary>, threads: List<ThreadSummary>) = GraphSnapshot(
    tasks.filter { !it.archived }.associate { it.id to GraphTaskSnapshot(it.status, it.title) },
    questions.associate { it.id to GraphQuestionSnapshot(it.taskId, it.kind ?: "question", it.status) },
    workers.associate { w -> "worker:${w.id}" to GraphCrewSnapshot(w.taskId ?: tasks.firstOrNull { w.id in it.workerIds }?.id, w.status, w.lastReport?.trim().orEmpty(), w.title) } +
        threads.filter { !it.main && !it.archived }.associate { t -> "thread:${t.id}" to GraphCrewSnapshot(t.taskId ?: t.ownedTasks.firstOrNull(), t.status, (t.current ?: t.summary)?.trim().orEmpty(), t.title) },
)
/** Null crew generations mean the backend does not support that source, not an unfinished read. */
fun graphReadsComplete(generation: Int, board: Int, workers: Int?, threads: Int?) =
    board == generation && (workers == null || workers == generation) && (threads == null || threads == generation)

class GraphChangeBaseline {
    private var snapshot: GraphSnapshot? = null
    fun read(next: GraphSnapshot, reset: Boolean = false): List<GraphChange> {
        val changes = diffGraphSnapshots(if (reset) null else snapshot, next)
        snapshot = next
        return changes
    }
}
private fun terminalCrew(status: String) = status in listOf("done", "stopped", "failed")
/** Mirrors task-graph-changes.ts. First load/reconnect are baselines, never invented arrivals. */
fun diffGraphSnapshots(previous: GraphSnapshot?, next: GraphSnapshot): List<GraphChange> {
    if (previous == null) return emptyList()
    val changes = mutableListOf<GraphChange>()
    fun add(kind: String, key: String, ids: List<String?>, text: String, plural: String = text, workerId: String? = null) {
        val taskIds = ids.filterNotNull().distinct()
        if (taskIds.isNotEmpty()) changes.add(GraphChange(key, taskIds, text, plural, workerId, kind))
    }
    next.tasks.forEach { (id, task) ->
        val before = previous.tasks[id]
        val title = if (task.title.length > 48) task.title.take(47) + "…" else task.title
        if (before == null) add("arrival", "arrival", listOf(id), "$id $title arrived", "tasks arrived")
        else if (before.status != task.status) {
            val label = graphStatus(task.status).label
            add("status", "status:${task.status}", listOf(id), "$id $title → $label", "tasks moved to $label")
        }
    }
    next.questions.forEach { (id, q) ->
        val before = previous.questions[id]
        if (q.status == "open" && before?.status != "open") add("question", "${q.kind}:open", listOf(q.taskId), "${q.taskId}: new ${q.kind}", "new ${q.kind}s")
        else if (before?.status == "open" && q.status != "open") {
            val action = if (q.status == "answered") "answered" else "closed"
            add("answer", "${q.kind}:${q.status}", listOf(q.taskId), "${q.taskId}: ${q.kind} $action", "${q.kind}s $action")
        }
    }
    previous.questions.filter { (id, q) -> q.status == "open" && id !in next.questions }.values.forEach { q ->
        add("answer", "${q.kind}:answered", listOf(q.taskId), "${q.taskId}: ${q.kind} closed", "${q.kind}s closed")
    }
    next.crew.forEach { (id, crew) ->
        val before = previous.crew[id]
        val worker = id.startsWith("worker:")
        val subject = if (worker) "Worker" else "Thread"
        if (before == null) {
            val action = if (crew.status == "failed") "failed" else if (terminalCrew(crew.status)) "finished" else "started"
            add("crew", "$subject:$action", listOf(crew.taskId), "$subject ${crew.title} $action", "${subject.lowercase()}s $action")
        }
        if (before != null && crew.taskId != before.taskId) add("reassigned", "$subject:reassigned", listOf(before.taskId, crew.taskId),
            "$subject ${crew.title}: ${before.taskId ?: "unassigned"} → ${crew.taskId ?: "unassigned"}", "${subject.lowercase()}s reassigned")
        if (before != null && crew.status != before.status) {
            val action = when { crew.status == "failed" -> "failed"; terminalCrew(crew.status) -> "finished"; crew.status == "running" -> "started"; else -> "resting" }
            add("crew", "$subject:$action", listOf(crew.taskId ?: before.taskId), "$subject ${crew.title} $action", "${subject.lowercase()}s $action")
        }
        if (before != null && crew.report.isNotBlank() && crew.report != before.report) {
            val line = crew.report.lines().last { it.isNotBlank() }.take(180)
            add("report", "$id:report", listOf(crew.taskId), "${if (worker) id.removePrefix("worker:") else crew.title} reported on ${crew.taskId} · $line",
                "${subject.lowercase()} reports", if (worker) id.removePrefix("worker:") else null)
        }
    }
    previous.crew.forEach { (id, crew) ->
        if (id !in next.crew && !terminalCrew(crew.status)) add("crew", "${id.substringBefore(':')}:removed", listOf(crew.taskId), "${crew.title} finished", "crew finished")
    }
    return changes
}
fun batchGraphChanges(entries: List<GraphChangeEntry>, changes: List<GraphChange>, now: Long, serial: Long): List<GraphChangeEntry> {
    val next = entries.toMutableList()
    var sequence = serial
    for (change in changes) {
        val index = next.indexOfFirst { it.change.key == change.key && now - it.at < 1000 }
        if (index >= 0) {
            val entry = next[index]
            next[index] = entry.copy(change = entry.change.copy(taskIds = (entry.change.taskIds + change.taskIds).distinct(), text = if (change.kind == "report") change.text else entry.change.text),
                count = entry.count + 1, serial = ++sequence)
        } else next.add(0, GraphChangeEntry(change, ++sequence, now, 1, sequence))
    }
    return next.take(50)
}

data class GraphNavigation(val sheet: Boolean = false, val selected: String? = null, val highlight: String? = null, val canvas: Boolean = false)
fun graphNavigateBack(state: GraphNavigation): GraphNavigation? = when {
    state.sheet -> state.copy(sheet = false)
    state.selected != null || state.highlight != null -> state.copy(selected = null, highlight = null)
    state.canvas -> state.copy(canvas = false)
    else -> null
}
