package io.github.mitzacoder.aiki.features.tasks

import io.github.mitzacoder.aiki.protocol.*

internal data class TaskRefSummary(val counts: String, val status: String, val attention: Boolean)

/** Missing live state never counts as closed; only open PR checks are actionable. */
internal fun taskRefSummary(statuses: List<RefStatus?>): TaskRefSummary {
    fun count(kind: String) = statuses.count { it?.kind == kind }
    val unknown = statuses.count { it == null || it.kind !in setOf("pull", "issue", "jira") }
    val counts = buildList {
        count("pull").takeIf { it > 0 }?.let { add("$it PR${if (it == 1) "" else "s"}") }
        count("issue").takeIf { it > 0 }?.let { add("$it issue${if (it == 1) "" else "s"}") }
        count("jira").takeIf { it > 0 }?.let { add("$it ticket${if (it == 1) "" else "s"}") }
        if (unknown > 0) add("$unknown unknown")
    }.joinToString(" · ")
    val openPulls = statuses.filterIsInstance<RefStatusPull>().filter { it.state == "open" || it.state == "draft" }
    val failing = openPulls.count { it.checks == "failing" }
    val running = openPulls.count { it.checks == "pending" }
    val closed = statuses.count { when (it) {
        is RefStatusPull -> it.state == "merged" || it.state == "closed"
        is RefStatusIssue -> it.state == "closed"
        is RefStatusJira -> it.category == "done"
        else -> false
    } }
    val open = statuses.size - closed - unknown
    val status = buildList {
        if (failing > 0 || running > 0) {
            if (failing > 0) add("$failing PR${if (failing == 1) "" else "s"} failing checks")
            if (running > 0) add("$running PR${if (running == 1) "" else "s"} running checks")
        } else {
            if (open > 0) add("$open open")
            if (closed > 0) add("$closed closed")
            if (unknown > 0) add("$unknown status unknown")
        }
    }.joinToString(" · ")
    return TaskRefSummary(if (unknown == statuses.size) "$unknown ref${if (unknown == 1) "" else "s"}" else counts, status, failing > 0)
}
