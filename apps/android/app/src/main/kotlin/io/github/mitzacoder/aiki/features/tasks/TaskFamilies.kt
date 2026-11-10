package io.github.mitzacoder.aiki.features.tasks

/** Visible children only; quiet same-status branches default folded. Mirrors web task-families.ts. */
data class TaskFamily(
    val row: TaskRow,
    val children: List<TaskFamily>,
    val canToggle: Boolean,
    val expanded: Boolean,
    val foldedCount: Int,
)

fun needsFamilyAttention(row: TaskRow): Boolean =
    row.waiting.isNotEmpty() || row.task.status in setOf("review", "blocked", "waiting")

fun familySectionStartsOpen(section: TaskSection): Boolean =
    section.rows.any(::needsFamilyAttention) || !section.collapsedByDefault

/**
 * Nest only within both status and section. Other-status/section children keep their own group and parent link.
 * Roots and siblings retain priority order; nesting puts parents first. Attention overrides saved collapse choices.
 */
fun taskFamilies(section: TaskSection, expansion: Map<String, Boolean> = emptyMap()): List<TaskFamily> {
    val byId = section.rows.associateBy { it.task.id }
    val parents = linkedMapOf<String, String>()
    section.rows.forEach { row ->
        val parent = byId[row.task.parent]
        if (parent != null && parent.task.status == row.task.status && parent.task.id != row.task.id) {
            parents[row.task.id] = parent.task.id
        }
    }
    // The server rejects cycles, but partial/stale state must not make tasks disappear.
    parents.keys.toList().forEach { id ->
        val seen = hashSetOf(id)
        var ancestor = parents[id]
        while (ancestor != null) {
            if (!seen.add(ancestor)) { parents.remove(id); break }
            ancestor = parents[ancestor]
        }
    }
    val children = section.rows.filter { it.task.id in parents }.groupBy { parents[it.task.id]!! }
    val attention = mutableMapOf<String, Boolean>()
    fun mustShow(row: TaskRow): Boolean = attention.getOrPut(row.task.id) {
        needsFamilyAttention(row) || children[row.task.id].orEmpty().any { mustShow(it) }
    }
    fun branchCount(row: TaskRow): Int = 1 + children[row.task.id].orEmpty().sumOf { branchCount(it) }
    fun family(row: TaskRow): TaskFamily {
        val nested = children[row.task.id].orEmpty()
        val canToggle = nested.any { !mustShow(it) }
        val expanded = canToggle && expansion[row.task.id] == true
        return TaskFamily(
            row = row, canToggle = canToggle, expanded = expanded,
            children = nested.filter { expanded || mustShow(it) }.map { family(it) },
            foldedCount = nested.filter { !expanded && !mustShow(it) }.sumOf { branchCount(it) },
        )
    }
    return section.rows.filter { it.task.id !in parents }.map { family(it) }
}
