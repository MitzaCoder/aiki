package io.github.mitzacoder.kemiri.refs

import io.github.mitzacoder.kemiri.features.refs.RefDetailsCache
import io.github.mitzacoder.kemiri.features.refs.RefStatusStore
import io.github.mitzacoder.kemiri.features.refs.relativeTimeWords
import io.github.mitzacoder.kemiri.features.settings.LinksForm
import io.github.mitzacoder.kemiri.features.settings.linksForm
import io.github.mitzacoder.kemiri.features.settings.linksToSave
import io.github.mitzacoder.kemiri.protocol.*
import kotlinx.coroutines.test.runTest
import org.junit.Assert.*
import org.junit.Test

/** The live-state store, the card's details cache and the link settings form (web `ProjectRefStatus`, `RefCardHost`, `ProjectSettings`). */
class RefStoresTest {
    private val checkedAt = "2026-11-06T12:00:00.000Z"
    private fun open(ref: String) = RefStatusIssue(ref = ref, url = "https://github.com/a/b/issues/1", title = "Bug", checkedAt = checkedAt, state = "open")

    @Test fun readsNewRefsOnlyAndForgetsWhatTheBackendLeftOut() = runTest {
        val asked = mutableListOf<List<String>>()
        var answer: (List<String>) -> List<RefStatus> = { refs -> refs.map(::open) }
        var clock = 1_000L
        val store = RefStatusStore({ refs -> asked += refs; answer(refs) }, now = { clock })
        assertTrue(store.want(listOf("#1", "#2", "#1")))
        assertFalse("the same set again changes nothing", store.want(listOf("#2", "#1")))
        assertFalse(store.staleOnReturn())
        store.refresh()
        assertEquals("the latest set is read", listOf(listOf("#2", "#1")), asked)
        assertEquals(setOf("#1", "#2"), store.statuses.value.keys)

        answer = { listOf(open("#1")) }
        store.refresh()
        assertEquals(setOf("#1"), store.statuses.value.keys)

        answer = { error("offline") }
        store.refresh()
        assertEquals("a failed read keeps what was known", setOf("#1"), store.statuses.value.keys)

        clock += RefStatusStore.STALE_ON_RETURN_MS + 1
        assertTrue(store.staleOnReturn())
        assertTrue(store.want(listOf("#1", "#3")))
    }

    @Test fun keepsDetailsForAMinuteAndAFailedReadKeepsTheEarlierAnswer() = runTest {
        var clock = 0L
        var reads = 0
        var fail = false
        val details = RefDetailsJira(ref = "EX-1", url = "https://a.atlassian.net/browse/EX-1", title = "T", updatedAt = null, checkedAt = checkedAt,
            key = "EX-1", type = "Story", status = "To do", category = "todo", priority = null, assignee = null, reporter = null, parent = null, sprint = null, excerpt = null)
        val cache = RefDetailsCache({ reads++; if (fail) error("offline") else details }, now = { clock })
        cache.load("jira:x:EX-1", "EX-1")
        cache.load("jira:x:EX-1", "EX-1")
        assertEquals(1, reads)
        clock += RefDetailsCache.FRESH_MS
        fail = true
        cache.load("jira:x:EX-1", "EX-1")
        assertEquals(2, reads)
        assertEquals(details, cache.known.value["jira:x:EX-1"]?.details)
        assertEquals(emptySet<String>(), cache.loading.value)
    }

    @Test fun relativeTimeSaysItLikeTheWeb() {
        val at = "2026-11-06T12:00:00Z"
        val base = java.time.Instant.parse(at).toEpochMilli()
        assertEquals("just now", relativeTimeWords(at, base + 30_000))
        assertEquals("5 min ago", relativeTimeWords(at, base + 5 * 60_000))
        assertEquals("3 h ago", relativeTimeWords(at, base + 3 * 3_600_000))
        assertEquals("2 d ago", relativeTimeWords(at, base + 2 * 86_400_000))
        assertEquals("at an unknown time", relativeTimeWords("soon", base))
    }

    @Test fun theLinksFormShowsAndSavesSettingsTheWebsWay() {
        val detected = ProjectLinkSettings(jiraSite = "https://acme.atlassian.net", jiraProjects = listOf("EX", "CORE"), githubRepos = listOf("acme/platform"), detected = true)
        assertEquals(LinksForm("acme.atlassian.net", "EX, CORE", "acme/platform"), linksForm(detected))
        assertEquals(
            ProjectLinks(jiraSite = "https://acme.atlassian.net", jiraProjects = listOf("EX", "OPS"), githubRepos = listOf("acme/platform", "git@github.com:acme/web.git")),
            linksToSave(LinksForm(" acme.atlassian.net/ ", "ex,  ops", "acme/platform git@github.com:acme/web.git")).getOrThrow(),
        )
        assertEquals(ProjectLinks(jiraSite = null, jiraProjects = emptyList(), githubRepos = emptyList()), linksToSave(LinksForm("", "", "")).getOrThrow())
        assertEquals("The Jira site should be an address, like acme.atlassian.net.", linksToSave(LinksForm("not a site", "", "")).exceptionOrNull()?.message)
        assertEquals("Write each repository as owner/name: platform", linksToSave(LinksForm("", "", "acme/web, platform")).exceptionOrNull()?.message)
    }
}
