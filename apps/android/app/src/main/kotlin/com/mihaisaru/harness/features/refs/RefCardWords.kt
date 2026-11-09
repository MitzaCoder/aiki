package com.mihaisaru.harness.features.refs

import com.mihaisaru.harness.protocol.BoardTask
import com.mihaisaru.harness.protocol.ProjectLinks
import com.mihaisaru.harness.protocol.PullRequestChecks
import com.mihaisaru.harness.protocol.PullRequestReviews
import com.mihaisaru.harness.protocol.RefDetails
import com.mihaisaru.harness.protocol.RefDetailsIssue
import com.mihaisaru.harness.protocol.RefDetailsJira
import com.mihaisaru.harness.protocol.RefDetailsPull
import com.mihaisaru.harness.protocol.RefStatus
import com.mihaisaru.harness.protocol.RefStatusIssue
import com.mihaisaru.harness.protocol.RefStatusPull
import com.mihaisaru.harness.ui.theme.TaskStatusTone
import java.util.Locale

/**
 * What a ticket or pull request's card says: the port of the web's `lib/ref-card.ts` (placement left out, a bottom
 * sheet places itself). Pure functions; `RefCard.kt` draws them. Tests in `RefsTest.kt`.
 */

/** The ref an address is about when it gets a card (a GitHub pull request or issue, a Jira ticket); null for any other. */
fun cardRefOf(href: String): ResolvedRef? = resolveRef(href)?.takeIf { it !is ResolvedRef.Web }

/** The card's heading: "acme/platform #12", "EX-1234". */
fun cardRefLabel(ref: ResolvedRef): String = when (ref) {
    is ResolvedRef.Github -> "${ref.repo} #${ref.number}"
    is ResolvedRef.Jira -> ref.key
    is ResolvedRef.Web -> ref.url
}

/** What it is in a word: "Pull request", "Issue", "Story"; the details know best, a cached state next. */
fun cardKindWords(ref: ResolvedRef, details: RefDetails?, status: RefStatus?): String {
    val kind = details?.kind ?: status?.kind
    if (kind == "pull") return "Pull request"
    if (kind == "issue") return "Issue"
    if (details is RefDetailsJira && details.type != null) return details.type
    if (ref is ResolvedRef.Jira) return "Ticket"
    val github = ref as? ResolvedRef.Github
    return when (github?.kind) { "pull" -> "Pull request"; "issue" -> "Issue"; else -> "Pull request or issue" }
}

/** "Open in GitHub", "Open in Jira". */
fun openWords(ref: ResolvedRef): String = if (ref is ResolvedRef.Jira) "Open in Jira" else "Open in GitHub"

private fun count(value: Long) = String.format(Locale.US, "%,d", value)

/** "12 passed, 2 failing, 1 running"; skipped ones only when nothing else ran. */
fun checksWords(checks: PullRequestChecks): String {
    val parts = buildList {
        if (checks.passed > 0) add("${count(checks.passed)} passed")
        if (checks.failing > 0) add("${count(checks.failing)} failing")
        if (checks.running > 0) add("${count(checks.running)} running")
        if (isEmpty() && checks.skipped > 0) add("${count(checks.skipped)} skipped")
    }
    return parts.joinToString(", ")
}

/** The failing checks by name, a few then how many more: "lint, e2e (cancelled) and 3 more". */
fun failingChecksWords(checks: PullRequestChecks, shown: Int = 3): String? {
    if (checks.failingNames.isEmpty()) return null
    val names = checks.failingNames.take(shown)
    val more = maxOf(checks.failing, checks.failingNames.size.toLong()) - names.size
    return if (more > 0) "${names.joinToString(", ")} and $more more" else names.joinToString(", ")
}

/** The overall colour of the checks: failing, running or passing. */
fun checksTone(checks: PullRequestChecks): TaskStatusTone = when {
    checks.failing > 0 -> TaskStatusTone.Blocked
    checks.running > 0 -> TaskStatusTone.Working
    checks.passed > 0 -> TaskStatusTone.Done
    else -> TaskStatusTone.Todo
}

/** A list of names as people say it: "ana", "ana and bob", "ana, bob and 2 others". */
fun namesWords(names: List<String>, shown: Int = 2): String {
    if (names.size <= shown + 1) {
        return if (names.size <= 1) names.firstOrNull().orEmpty() else "${names.dropLast(1).joinToString(", ")} and ${names.last()}"
    }
    return "${names.take(shown).joinToString(", ")} and ${names.size - shown} others"
}

data class ReviewLine(val tone: TaskStatusTone, val text: String)

/** Where the review stands, one line each: who asked for changes, who approved, whom it waits on. */
fun reviewLines(reviews: PullRequestReviews): List<ReviewLine> {
    val lines = buildList {
        if (reviews.changesRequestedBy.isNotEmpty()) add(ReviewLine(TaskStatusTone.Blocked, "Changes requested by ${namesWords(reviews.changesRequestedBy)}"))
        if (reviews.approvedBy.isNotEmpty()) add(ReviewLine(TaskStatusTone.Done, "Approved by ${namesWords(reviews.approvedBy)}"))
        if (reviews.waitingOn.isNotEmpty()) add(ReviewLine(TaskStatusTone.Review, "Waiting on ${namesWords(reviews.waitingOn)}"))
    }
    if (lines.isNotEmpty()) return lines
    return listOf(when (reviews.decision) {
        "approved" -> ReviewLine(TaskStatusTone.Done, "Approved")
        "review_required" -> ReviewLine(TaskStatusTone.Todo, "Needs a review")
        else -> ReviewLine(TaskStatusTone.Todo, "No reviews yet")
    })
}

/** "+1,173 −98 · 27 files". */
fun changeWords(additions: Long, deletions: Long, changedFiles: Long): String =
    "+${count(additions)} −${count(deletions)} · ${count(changedFiles)} ${if (changedFiles == 1L) "file" else "files"}"

/** A pull request's state as a word: "Open", "Draft", "Merged", "Closed". */
fun githubStateWords(details: RefDetailsPull): String = when (details.state) {
    "open" -> "Open"; "draft" -> "Draft"; "merged" -> "Merged"; else -> "Closed"
}

/** An issue's state as words: "Open", "Closed as not planned", "Closed as duplicate", "Closed". */
fun githubStateWords(details: RefDetailsIssue): String = when {
    details.state == "open" -> "Open"
    details.closedAs == "not_planned" -> "Closed as not planned"
    details.closedAs == "duplicate" -> "Closed as duplicate"
    else -> "Closed"
}

/** The state a card's badge shows and its colour: from the details when read, else the state last read for the board. */
fun cardState(details: RefDetails?, status: RefStatus?): Pair<String, TaskStatusTone>? = when (details) {
    is RefDetailsJira -> details.status to when (details.category) { "done" -> TaskStatusTone.Done; "in_progress" -> TaskStatusTone.Working; else -> TaskStatusTone.Todo }
    is RefDetailsPull -> githubStateWords(details) to when (details.state) {
        "open" -> TaskStatusTone.Working; "draft" -> TaskStatusTone.Todo; "merged" -> TaskStatusTone.Done; else -> TaskStatusTone.Dropped
    }
    is RefDetailsIssue -> githubStateWords(details) to when {
        details.state == "open" -> TaskStatusTone.Working; details.closedAs == "completed" -> TaskStatusTone.Done; else -> TaskStatusTone.Dropped
    }
    else -> status?.let { known -> refStatusTone(known)?.let { refStatusWords(known) to it } }
}

/** A pull request's state from what is known: "open", "draft", "merged", "closed"; null for anything else. */
fun cardPullState(details: RefDetails?, status: RefStatus?): String? =
    (details as? RefDetailsPull)?.state ?: (status as? RefStatusPull)?.state

private fun sameThing(entry: String, identity: String, links: ProjectLinks?): Boolean =
    resolveRef(entry, links ?: NO_PROJECT_LINKS)?.let { refIdentity(it) == identity } == true

/** The tasks whose refs are about the same ticket or pull request, in board order. */
fun tasksNaming(ref: ResolvedRef, tasks: List<BoardTask>, links: ProjectLinks?): List<BoardTask> {
    val identity = refIdentity(ref)
    return tasks.filter { task -> task.refs.any { sameThing(it, identity, links) } }
}

/** The board ref (as written on a task) about the same thing as [ref], so its cached state can be found. */
fun boardRefFor(ref: ResolvedRef, refs: List<String>, links: ProjectLinks?): String? {
    val identity = refIdentity(ref)
    return refs.firstOrNull { sameThing(it, identity, links) }
}

/** When something happened, as the web's `relativeTime` says it: "just now", "5 min ago", "3 h ago", "2 d ago", then a date. */
fun relativeTimeWords(at: String, now: Long): String {
    val ms = runCatching { java.time.Instant.parse(at).toEpochMilli() }.getOrNull() ?: return "at an unknown time"
    val seconds = Math.round((now - ms) / 1000.0)
    if (seconds < 45) return "just now"
    val minutes = Math.round(seconds / 60.0)
    if (minutes < 60) return "${maxOf(1, minutes)} min ago"
    val hours = Math.round(minutes / 60.0)
    if (hours < 24) return "$hours h ago"
    val days = Math.round(hours / 24.0)
    if (days < 30) return "$days d ago"
    return java.time.format.DateTimeFormatter.ofLocalizedDate(java.time.format.FormatStyle.MEDIUM)
        .format(java.time.Instant.ofEpochMilli(ms).atZone(java.time.ZoneId.systemDefault()))
}
