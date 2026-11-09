package com.mihaisaru.harness.features.tasks

import com.mihaisaru.harness.protocol.*

/** Pure presentation and filtering, matching web lib/task-relations.ts. Missing wire fields mean no links. */
data class TaskLinkTarget(val id: String, val title: String, val status: String?, val archived: Boolean) {
    val closed: Boolean get() = archived || status?.let(::isSettled) == true
}
data class TaskLinkGroup(val kind: String, val label: String, val items: List<TaskLinkTarget>)

fun linkGroups(task: BoardTask, tasks: List<BoardTask>, archived: List<BoardTaskBrief> = emptyList()): List<TaskLinkGroup> {
    val groups = listOf(
        Triple("parent", "Subtask of", listOfNotNull(task.parent)),
        Triple("subtasks", "Subtasks", task.subtasks.orEmpty()),
        Triple("foundWhile", "Found while working on", listOfNotNull(task.foundWhile)),
        Triple("ledTo", "Led to", task.ledTo.orEmpty()),
        Triple("blockedBy", "Blocked by", task.blockedBy),
        Triple("blocks", "Blocks", task.blocks.orEmpty()),
        Triple("related", "Related to", task.related.orEmpty()),
    )
    return groups.filter { it.third.isNotEmpty() }.map { (kind, label, ids) ->
        TaskLinkGroup(kind, label, ids.map { id ->
            val live = tasks.find { it.id == id }
            val brief = archived.find { it.id == id }
            TaskLinkTarget(id, live?.title ?: brief?.title.orEmpty(), live?.status ?: brief?.status, live?.archived ?: brief?.archived ?: false)
        })
    }
}
fun subtaskProgressText(task: BoardTask): String? = task.subtaskCount?.takeIf { it.total > 0 }?.let { "${it.done}/${it.total} done" }
fun subtaskBadgeText(task: BoardTask): String? = subtaskProgressText(task)?.removeSuffix(" done")
    ?: task.subtasks?.size?.takeIf { it > 0 }?.let { "$it subtask${if (it == 1) "" else "s"}" }
fun subtaskFraction(task: BoardTask): Float? = task.subtaskCount?.takeIf { it.total > 0 }?.let { (it.done.toFloat() / it.total).coerceIn(0f, 1f) }
fun openFeedbackCount(task: BoardTask): Long = (task.feedback?.open ?: 0) + (task.feedback?.handling ?: 0)
fun feedbackStateWords(state: String): String = when (state) {
    "handling" -> "Being handled"
    else -> state.replaceFirstChar { it.uppercase() }
}
fun sortedFeedback(entries: List<BoardFeedback>): List<BoardFeedback> {
    val (live, closed) = entries.partition { it.state == "open" || it.state == "handling" }
    return live.sortedBy { it.at } + closed.sortedByDescending { it.at }
}
fun linkedIds(taskId: String, tasks: List<BoardTask>): Set<String> {
    val byId = tasks.associateBy { it.id }
    val task = byId[taskId] ?: return setOf(taskId)
    val ids = mutableSetOf(taskId)
    linkGroups(task, emptyList()).forEach { group -> ids.addAll(group.items.map { it.id }) }
    val below = mutableSetOf<String>()
    val queue = ArrayDeque(task.subtasks.orEmpty() + task.ledTo.orEmpty())
    while (queue.isNotEmpty()) {
        val id = queue.removeFirst()
        if (!below.add(id)) continue
        ids.add(id)
        byId[id]?.let { queue.addAll(it.subtasks.orEmpty() + it.ledTo.orEmpty()) }
    }
    return ids
}
fun applyTaskFilter(tasks: List<BoardTask>, topLevelOnly: Boolean, focus: String?): List<BoardTask> {
    val keep = focus?.let { linkedIds(it, tasks) }
    return tasks.filter { (keep == null || it.id in keep) && (!topLevelOnly || it.parent == null || it.id == focus) }
}
val TIMELINE_KINDS = listOf("feedback" to "Feedback", "status" to "Status", "worker" to "Workers", "question" to "Questions", "decision" to "Decisions", "milestone" to "Milestones", "link" to "Links")
fun visibleTimeline(entries: List<BoardTimelineEntry>, hidden: Set<String>): List<BoardTimelineEntry> = entries.filterNot { it.kind in hidden }
