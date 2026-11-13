package io.github.mitzacoder.kemiri.features.refs

import io.github.mitzacoder.kemiri.protocol.ProjectLinkSettings
import io.github.mitzacoder.kemiri.protocol.ProjectLinks
import io.github.mitzacoder.kemiri.protocol.RefStatus
import io.github.mitzacoder.kemiri.protocol.RefStatusIssue
import io.github.mitzacoder.kemiri.protocol.RefStatusJira
import io.github.mitzacoder.kemiri.protocol.RefStatusPull
import io.github.mitzacoder.kemiri.ui.theme.TaskStatusTone
import java.net.URI

/**
 * Tickets and pull requests as links: the Kotlin port of the protocol's `refs.ts` (`resolveRef`, `refMentions`,
 * `refIdentity`, the settings' normalizers) and the web's `lib/refs.ts` (words, tones, plain text cut into mentions).
 * Pure functions; tests in `RefsTest.kt` carry both suites' cases.
 */

val NO_PROJECT_LINKS = ProjectLinks(jiraSite = null, jiraProjects = emptyList(), githubRepos = emptyList())

/** The settings that apply, without whether they were filled in automatically. */
fun ProjectLinkSettings.links(): ProjectLinks = ProjectLinks(jiraSite = jiraSite, jiraProjects = jiraProjects, githubRepos = githubRepos)

/** What a ref is about and where it opens. */
sealed interface ResolvedRef {
    val url: String

    /** An issue or pull request on github.com; [kind] ("pull", "issue", "unknown") is only known from a URL that says so. */
    data class Github(val repo: String, val number: Long, val kind: String, override val url: String) : ResolvedRef
    data class Jira(val key: String, val site: String, override val url: String) : ResolvedRef
    /** Any other web address. */
    data class Web(override val url: String) : ResolvedRef
}

private val JIRA_KEY = Regex("^[A-Z][A-Z0-9_]+-[1-9]\\d*$")
private val REPO = Regex("^[\\w.-]+/[\\w.-]+$")
private val HTTP = Regex("^https?://", RegexOption.IGNORE_CASE)

/** A parsed web address the way a browser's `URL` gives it: lower-case scheme and host, the default port dropped. */
private class WebAddress(val host: String, val origin: String, val path: String, val href: String)

private fun parseAddress(text: String): WebAddress? {
    val uri = runCatching { URI(text) }.getOrNull() ?: return null
    val scheme = uri.scheme?.lowercase() ?: return null
    val host = uri.host?.lowercase()?.takeIf { it.isNotEmpty() } ?: return null
    val port = uri.port.takeUnless { (scheme == "https" && it == 443) || (scheme == "http" && it == 80) } ?: -1
    val path = uri.rawPath.orEmpty().ifEmpty { "/" }
    val query = uri.rawQuery?.let { "?$it" }.orEmpty()
    val fragment = uri.rawFragment?.let { "#$it" }.orEmpty()
    val user = uri.rawUserInfo?.let { "$it@" }.orEmpty()
    val hostPort = host + if (port == -1) "" else ":$port"
    return WebAddress(host, "$scheme://$hostPort", path, "$scheme://$user$hostPort$path$query$fragment")
}

/** "https://acme.atlassian.net/" or "acme.atlassian.net" as "https://acme.atlassian.net"; null when it is no address. */
fun normalizeJiraSite(site: String): String? {
    val text = site.trim()
    if (text.isEmpty()) return null
    val url = parseAddress(if (HTTP.containsMatchIn(text)) text else "https://$text") ?: return null
    if (!url.host.contains('.')) return null
    return url.origin + url.path.replace(Regex("/+$"), "")
}

private val GITHUB_REMOTE = Regex("^(?:(?:https?|ssh|git)://)?(?:[\\w.-]+@)?(?:www\\.)?github\\.com[:/]([\\w.-]+/[\\w.-]+)$", RegexOption.IGNORE_CASE)

/** "acme/platform", a github.com URL or an SSH remote of it as "owner/name"; null for anything else. */
fun normalizeGithubRepo(repo: String): String? {
    val text = repo.trim().replace(Regex("\\.git$"), "").replace(Regex("/+$"), "")
    GITHUB_REMOTE.find(text)?.let { return it.groupValues[1] }
    return text.takeIf { REPO.matches(it) }
}

// GitHub sends /issues/N on to /pull/N when N is a pull request, so a number of unknown kind opens either.
private fun githubUrl(repo: String, number: Long, kind: String) = "https://github.com/$repo/${if (kind == "pull") "pull" else "issues"}/$number"

/** The configured repository a short name means ("platform" for "acme/platform"), when only one does. */
private fun repoNamed(name: String, links: ProjectLinks): String? {
    val lower = name.lowercase()
    val matches = links.githubRepos.filter { it.lowercase() == lower || it.split('/').getOrNull(1)?.lowercase() == lower }
    return matches.singleOrNull()
}

private val NUMBERED = Regex("^(?:([\\w.-]+/[\\w.-]+|[\\w.-]+))?#([1-9]\\d*)$")
private val GITHUB_HOST = Regex("^(www\\.)?github\\.com$", RegexOption.IGNORE_CASE)

/**
 * What a ref is about and where it opens: a GitHub or Jira URL as itself, any other URL as a web link, `#123` and
 * `name#123` through the project's repositories, `EX-1234` through its Jira site. Null for what cannot be linked.
 */
fun resolveRef(ref: String, links: ProjectLinks = NO_PROJECT_LINKS): ResolvedRef? {
    val text = ref.trim()
    if (HTTP.containsMatchIn(text)) {
        val url = parseAddress(text) ?: return null
        val path = url.path.split('/').filter { it.isNotEmpty() }
        if (GITHUB_HOST.matches(url.host) && path.size >= 4) {
            val kind = when (path[2]) { "pull", "pulls" -> "pull"; "issues" -> "issue"; else -> null }
            if (kind != null && Regex("^[1-9]\\d*$").matches(path[3])) {
                path[3].toLongOrNull()?.let { return ResolvedRef.Github("${path[0]}/${path[1]}", it, kind, url.href) }
            }
        }
        val browse = path.indexOf("browse")
        val key = if (browse >= 0) path.getOrNull(browse + 1) else null
        if (key != null && JIRA_KEY.matches(key)) {
            val site = url.origin + if (browse == 0) "" else "/" + path.subList(0, browse).joinToString("/")
            return ResolvedRef.Jira(key, site, url.href)
        }
        return ResolvedRef.Web(url.href)
    }
    NUMBERED.find(text)?.let { match ->
        val named = match.groups[1]?.value
        val repo = when {
            named == null -> links.githubRepos.singleOrNull()
            named.contains('/') -> named
            else -> repoNamed(named, links)
        } ?: return null
        val number = match.groupValues[2].toLongOrNull() ?: return null
        return ResolvedRef.Github(repo, number, "unknown", githubUrl(repo, number, "unknown"))
    }
    val site = links.jiraSite
    if (JIRA_KEY.matches(text) && site != null) return ResolvedRef.Jira(text, site, "$site/browse/$text")
    return null
}

/** The identity of what a ref resolves to, so `#1234` and its full URL count as one: "github:o/r#1234", "jira:<site>:EX-1". */
fun refIdentity(resolved: ResolvedRef): String = when (resolved) {
    is ResolvedRef.Github -> "github:${resolved.repo.lowercase()}#${resolved.number}"
    is ResolvedRef.Jira -> "jira:${resolved.site.lowercase()}:${resolved.key}"
    is ResolvedRef.Web -> "web:${resolved.url}"
}

// --- mentions in text ----------------------------------------------------------------------------------------------

/** A key, `#123`, `name#123` or `owner/name#123` in running text that links, with where it is. */
data class RefMention(val index: Int, val text: String, val resolved: ResolvedRef)

private val MENTION = Regex("(?<![\\w/#.:@-])(?:([A-Z][A-Z0-9_]+)-[1-9]\\d*|(?:[\\w.-]+/[\\w.-]+|[\\w.-]+)?#[1-9]\\d*)(?![\\w-]|\\.\\d)")

/**
 * The tickets and pull requests a plain text names that the project's settings can link: keys only with a prefix in
 * `jiraProjects`, `#123` only with one repository, `name#123` for a repository it has, `owner/name#123` always.
 * The caller keeps code, links and addresses out of [text].
 */
fun refMentions(text: String, links: ProjectLinks): List<RefMention> {
    val prefixes = links.jiraProjects.map { it.uppercase() }.toSet()
    return MENTION.findAll(text).mapNotNull { match ->
        val prefix = match.groups[1]?.value
        if (prefix != null && prefix !in prefixes) return@mapNotNull null
        resolveRef(match.value, links)?.let { RefMention(match.range.first, match.value, it) }
    }.toList()
}

/** A piece of plain text: either text, or a mention or address that links to [href]. */
data class RefPiece(val text: String, val href: String? = null)

private val ADDRESS = Regex("https?://\\S+")

/**
 * Plain text (a title, a run of Markdown text) cut into text and the mentions that link; addresses are left as they
 * are. While the text is still arriving ([streaming]), a mention at its very end may be half of a longer one, so it
 * waits (web `linkRefMentions`).
 */
fun splitRefMentions(text: String, links: ProjectLinks?, streaming: Boolean = false): List<RefPiece> {
    if (links == null) return listOf(RefPiece(text))
    val pieces = mutableListOf<RefPiece>()
    var last = 0
    fun add(segment: String, offset: Int) {
        for (mention in refMentions(segment, links)) {
            val start = offset + mention.index
            if (streaming && start + mention.text.length == text.length) continue
            if (start > last) pieces += RefPiece(text.substring(last, start))
            pieces += RefPiece(mention.text, mention.resolved.url)
            last = start + mention.text.length
        }
    }
    var from = 0
    for (match in ADDRESS.findAll(text)) {
        add(text.substring(from, match.range.first), from)
        from = match.range.last + 1
    }
    add(text.substring(from), from)
    if (last < text.length) pieces += RefPiece(text.substring(last))
    return pieces
}

/** Where a link starts and ends in a text and where it goes. */
data class TextLinkTarget(val start: Int, val end: Int, val href: String)

/** Trailing characters that end a sentence rather than the address before them. */
private val ADDRESS_TAIL = Regex("[.,;:!?'\")\\]>*_~]+$")

/**
 * The links in a run of plain Markdown text (never code or an existing link; the renderer keeps those out): the
 * mentions the project's settings can link, and bare web addresses, which the web's Markdown links by itself.
 */
fun textLinkTargets(text: String, links: ProjectLinks?, streaming: Boolean = false): List<TextLinkTarget> {
    val targets = mutableListOf<TextLinkTarget>()
    var at = 0
    for (piece in splitRefMentions(text, links, streaming)) {
        piece.href?.let { targets += TextLinkTarget(at, at + piece.text.length, it) }
        at += piece.text.length
    }
    for (match in ADDRESS.findAll(text)) {
        val address = match.value.replace(ADDRESS_TAIL, "")
        if (streaming && match.range.last == text.lastIndex) continue
        if (resolveRef(address) != null) targets += TextLinkTarget(match.range.first, match.range.first + address.length, address)
    }
    return targets.sortedBy { it.start }
}

/** Where a ref opens; null for one the settings cannot link (a bare key without a Jira site, say). */
fun refHref(ref: String, links: ProjectLinks?): String? = resolveRef(ref, links ?: NO_PROJECT_LINKS)?.url

/** What kind of thing a ref is, in a word or two. */
fun refKindWords(resolved: ResolvedRef?, status: RefStatus?): String = when {
    status is RefStatusPull -> "Pull request"
    status is RefStatusIssue -> "Issue"
    status is RefStatusJira || resolved is ResolvedRef.Jira -> "Ticket"
    resolved is ResolvedRef.Github -> when (resolved.kind) { "pull" -> "Pull request"; "issue" -> "Issue"; else -> "Pull request or issue" }
    else -> "Link"
}

/** What a ref the settings cannot link looks like it is. */
private fun unlinkedKindWords(ref: String): String {
    val text = ref.trim()
    return when {
        Regex("^[A-Z][A-Z0-9_]+-\\d+$").matches(text) -> "Ticket"
        Regex("#\\d+$").containsMatchIn(text) -> "Pull request or issue"
        else -> "Ref"
    }
}

/** A pull request's checks are only news while it is open. */
private fun checksWords(status: RefStatusPull): String? {
    if ((status.state != "open" && status.state != "draft") || status.checks == null) return null
    return when (status.checks) { "passing" -> "checks passing"; "failing" -> "checks failing"; "pending" -> "checks running"; else -> null }
}

/** The state in plain words: "Merged", "Open · checks failing", "Closed", or the Jira status as its project names it. */
fun refStatusWords(status: RefStatus): String = when (status) {
    is RefStatusJira -> status.status
    is RefStatusPull -> {
        val state = when (status.state) { "open" -> "Open"; "closed" -> "Closed"; "draft" -> "Draft"; else -> "Merged" }
        checksWords(status)?.let { "$state · $it" } ?: state
    }
    is RefStatusIssue -> if (status.state == "open") "Open" else "Closed"
    else -> status.kind.replaceFirstChar { it.uppercase() }
}

/**
 * The colour a state wears, from the task tones so it sits with the rows: open and in progress like working, a draft or
 * a ticket not started like to do, merged and done like done, closed unmerged like dropped, and failing checks on an
 * open pull request like blocked. Null for a kind this build does not know.
 */
fun refStatusTone(status: RefStatus): TaskStatusTone? = when (status) {
    is RefStatusPull -> when {
        (status.state == "open" || status.state == "draft") && status.checks == "failing" -> TaskStatusTone.Blocked
        status.state == "open" -> TaskStatusTone.Working
        status.state == "draft" -> TaskStatusTone.Todo
        status.state == "merged" -> TaskStatusTone.Done
        else -> TaskStatusTone.Dropped
    }
    is RefStatusIssue -> if (status.state == "open") TaskStatusTone.Working else TaskStatusTone.Done
    is RefStatusJira -> when (status.category) { "done" -> TaskStatusTone.Done; "in_progress" -> TaskStatusTone.Working; else -> TaskStatusTone.Todo }
    else -> null
}

/** Where a status says the ref opens (the backend's canonical address). */
val RefStatus.url: String? get() = when (this) { is RefStatusPull -> url; is RefStatusIssue -> url; is RefStatusJira -> url; else -> null }

/** The title the backend read for a ref. */
val RefStatus.title: String? get() = when (this) { is RefStatusPull -> title; is RefStatusIssue -> title; is RefStatusJira -> title; else -> null }

/** The ref as the request named it. */
val RefStatus.ref: String? get() = when (this) { is RefStatusPull -> ref; is RefStatusIssue -> ref; is RefStatusJira -> ref; else -> null }

/** A chip's description for a screen reader (web tooltip): what it is and where it stands, then its title. */
fun refTooltip(ref: String, label: String, links: ProjectLinks?, status: RefStatus?): String {
    val resolved = resolveRef(ref, links ?: NO_PROJECT_LINKS)
    val kind = if (resolved == null) unlinkedKindWords(ref) else refKindWords(resolved, status)
    val head = "$kind $label" + (status?.let { ": ${refStatusWords(it)}" } ?: "")
    val title = status?.title?.takeIf { it.isNotEmpty() }
    return listOfNotNull(head, title).joinToString("\n")
}
