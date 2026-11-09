package com.mihaisaru.harness.refs

import com.mihaisaru.harness.features.refs.*
import com.mihaisaru.harness.features.tasks.refLabel
import com.mihaisaru.harness.protocol.*
import com.mihaisaru.harness.ui.theme.TaskStatusTone
import org.junit.Assert.*
import org.junit.Test

/**
 * Mirrors packages/protocol/test/refs.test.ts, apps/web/test/refs.test.ts and apps/web/test/ref-card.test.ts for the
 * Kotlin ports in features/refs.
 */
class RefsTest {
    private val oneRepo = ProjectLinks(jiraSite = "https://acme.atlassian.net", jiraProjects = listOf("EX"), githubRepos = listOf("acme/platform"))
    private val twoRepos = oneRepo.copy(githubRepos = listOf("acme/platform", "acme/web"))
    private val checkedAt = "2026-11-06T12:00:00.000Z"

    // --- protocol: resolveRef --------------------------------------------------------------------------------------

    @Test fun fullGithubAndJiraUrlsResolveWithoutSettings() {
        assertEquals(ResolvedRef.Github("acme/platform", 1234, "pull", "https://github.com/acme/platform/pull/1234"), resolveRef("https://github.com/acme/platform/pull/1234"))
        val issue = resolveRef("https://github.com/acme/platform/issues/7#issuecomment-1") as ResolvedRef.Github
        assertEquals("issue", issue.kind)
        assertEquals(7L, issue.number)
        assertEquals(ResolvedRef.Jira("EX-1234", "https://acme.atlassian.net", "https://acme.atlassian.net/browse/EX-1234"), resolveRef("https://acme.atlassian.net/browse/EX-1234"))
        assertEquals("https://jira.acme.com/jira", (resolveRef("https://jira.acme.com/jira/browse/OPS-12") as ResolvedRef.Jira).site)
        assertEquals(ResolvedRef.Web("https://example.com/doc"), resolveRef("https://example.com/doc"))
    }

    @Test fun bareKeysAndNumbersNeedTheProjectsSettings() {
        assertNull(resolveRef("EX-1234"))
        assertNull(resolveRef("#1234"))
        assertEquals("https://acme.atlassian.net/browse/EX-1234", resolveRef("EX-1234", oneRepo)?.url)
        // A ref is a ticket whatever its prefix; only text needs the prefix list.
        assertEquals("https://acme.atlassian.net/browse/CORE-9", resolveRef("CORE-9", oneRepo)?.url)
        assertEquals("https://github.com/acme/platform/issues/1234", resolveRef("#1234", oneRepo)?.url)
    }

    @Test fun aNumberWithSeveralRepositoriesLinksOnlyWithARepositoryNamed() {
        assertNull(resolveRef("#12", twoRepos))
        val web = resolveRef("web#12", twoRepos) as ResolvedRef.Github
        assertEquals("acme/web" to 12L, web.repo to web.number)
        assertEquals("acme/web", (resolveRef("acme/web#12", twoRepos) as ResolvedRef.Github).repo)
        assertEquals("other/thing", (resolveRef("other/thing#3", twoRepos) as ResolvedRef.Github).repo)
        assertNull(resolveRef("nothing#3", twoRepos))
    }

    @Test fun aNumberAndItsUrlAreTheSameThing() {
        assertEquals(refIdentity(resolveRef("#1234", oneRepo)!!), refIdentity(resolveRef("https://github.com/Acme/Platform/pull/1234")!!))
    }

    // --- protocol: refMentions -------------------------------------------------------------------------------------

    @Test fun findsKeysWithAKnownPrefixAndNumbersWithOneRepository() {
        val text = "Fixed EX-1234 (see #1234), not UTF-8 or SHA-256; CORE-12 is elsewhere; acme/web#5 too."
        assertEquals(listOf("EX-1234", "#1234", "acme/web#5"), refMentions(text, oneRepo).map { it.text })
    }

    @Test fun leavesNumbersAloneWhenTheRepositoryIsAmbiguous() {
        assertEquals(listOf("web#13"), refMentions("PR #12 and web#13", twoRepos).map { it.text })
    }

    @Test fun doesNotTakePartsOfWordsPathsOrVersions() {
        assertEquals(emptyList<RefMention>(), refMentions("XEX-1 a/EX-2 EX-3x EX-4.5 issue#9 page#top", oneRepo))
    }

    // --- protocol: normalizing settings ----------------------------------------------------------------------------

    @Test fun aJiraSiteBecomesAnAddress() {
        assertEquals("https://acme.atlassian.net", normalizeJiraSite("acme.atlassian.net"))
        assertEquals("https://acme.atlassian.net", normalizeJiraSite("https://acme.atlassian.net/"))
        assertNull(normalizeJiraSite("not a site"))
    }

    @Test fun aRepositoryFromANameAUrlOrARemote() {
        assertEquals("acme/platform", normalizeGithubRepo("acme/platform"))
        assertEquals("acme/platform", normalizeGithubRepo("git@github.com:acme/platform.git"))
        assertEquals("acme/platform", normalizeGithubRepo("https://github.com/acme/platform"))
        assertEquals("acme/platform", normalizeGithubRepo("ssh://git@github.com/acme/platform.git"))
        assertNull(normalizeGithubRepo("git@gitlab.com:acme/platform.git"))
        assertNull(normalizeGithubRepo("platform"))
    }

    // --- web: linking mentions in text -----------------------------------------------------------------------------

    @Test fun linksKeysAndNumbersInProseAndWaitsForAMentionStillArriving() {
        val text = "Fixed EX-1234 in #1234; UTF-8 stays."
        assertEquals(
            listOf(TextLinkTarget(6, 13, "https://acme.atlassian.net/browse/EX-1234"), TextLinkTarget(17, 22, "https://github.com/acme/platform/issues/1234")),
            textLinkTargets(text, oneRepo),
        )
        assertEquals(emptyList<TextLinkTarget>(), textLinkTargets("Working on EX-45", oneRepo, streaming = true))
        assertEquals(listOf(TextLinkTarget(0, 5, "https://acme.atlassian.net/browse/EX-45")), textLinkTargets("EX-45 done", oneRepo, streaming = true))
    }

    @Test fun addressesLinkAsThemselvesAndOnlyThemOnAnOlderBackend() {
        val text = "See https://github.com/acme/web/pull/4. And EX-1, acme/web#5."
        assertEquals(listOf(TextLinkTarget(4, 38, "https://github.com/acme/web/pull/4")), textLinkTargets(text, null))
        assertEquals(listOf(4, 44, 50), textLinkTargets(text, oneRepo).map { it.start })
    }

    @Test fun cutsPlainTextIntoPiecesAddressesLeftAsTheyAre() {
        assertEquals(
            listOf(
                RefPiece("See "),
                RefPiece("EX-1", "https://acme.atlassian.net/browse/EX-1"),
                RefPiece(" and https://x.test/#2 then "),
                RefPiece("#2", "https://github.com/acme/platform/issues/2"),
            ),
            splitRefMentions("See EX-1 and https://x.test/#2 then #2", oneRepo),
        )
        assertEquals(listOf(RefPiece("See EX-1")), splitRefMentions("See EX-1", null))
    }

    // --- web: ref chips --------------------------------------------------------------------------------------------

    private fun pull(state: String, checks: String?) = RefStatusPull(ref = "#12", url = "https://github.com/acme/platform/pull/12", title = "Add comments", checkedAt = checkedAt, state = state, checks = checks)

    @Test fun chipsSayWhereARefOpensAndLabelItByTheProjectsRepositories() {
        assertEquals("https://acme.atlassian.net/browse/EX-1", refHref("EX-1", oneRepo))
        assertNull(refHref("EX-1", null))
        assertEquals("#12", refLabel("https://github.com/acme/platform/pull/12", oneRepo))
        assertEquals("web#12", refLabel("https://github.com/acme/web/pull/12", oneRepo))
        assertEquals("#12", refLabel("https://github.com/acme/web/pull/12"))
    }

    @Test fun aStateInPlainWordsAndATasksColours() {
        assertEquals("Open · checks failing", refStatusWords(pull("open", "failing")))
        assertEquals("Draft · checks running", refStatusWords(pull("draft", "pending")))
        assertEquals("Merged", refStatusWords(pull("merged", "failing")))
        assertEquals(TaskStatusTone.Blocked, refStatusTone(pull("open", "failing")))
        assertEquals(TaskStatusTone.Working, refStatusTone(pull("open", "passing")))
        assertEquals(TaskStatusTone.Done, refStatusTone(pull("merged", null)))
        assertEquals(TaskStatusTone.Dropped, refStatusTone(pull("closed", null)))
        val ticket = RefStatusJira(ref = "EX-1", url = "https://acme.atlassian.net/browse/EX-1", title = "Ship it", checkedAt = checkedAt, status = "In testing", category = "in_progress")
        assertEquals("In testing", refStatusWords(ticket))
        assertEquals(TaskStatusTone.Working, refStatusTone(ticket))
        assertEquals("Ticket EX-1: In testing\nShip it", refTooltip("EX-1", "EX-1", oneRepo, ticket))
        assertEquals("Ticket EX-1", refTooltip("EX-1", "EX-1", null, null))
    }

    // --- web: ref cards --------------------------------------------------------------------------------------------

    @Test fun pullRequestsIssuesAndTicketsGetACardNotOtherPages() {
        val pull = cardRefOf("https://github.com/acme/platform/pull/12/files") as ResolvedRef.Github
        assertEquals("acme/platform" to 12L, pull.repo to pull.number)
        assertEquals("acme/platform #12", cardRefLabel(pull))
        assertEquals("EX-7", cardRefLabel(cardRefOf("https://acme.atlassian.net/browse/EX-7")!!))
        assertNull(cardRefOf("https://github.com/acme/platform"))
        assertNull(cardRefOf("https://example.com/x"))
        assertNull(cardRefOf("?task=T1"))
    }

    @Test fun checksWordsCountAndNameTheFailingOnes() {
        val checks = PullRequestChecks(passed = 12, failing = 2, running = 1, skipped = 40, failingNames = listOf("lint", "e2e (cancelled)"))
        assertEquals("12 passed, 2 failing, 1 running", checksWords(checks))
        assertEquals("40 skipped", checksWords(checks.copy(passed = 0, failing = 0, running = 0)))
        assertEquals("1,234 passed", checksWords(PullRequestChecks(passed = 1234, failing = 0, running = 0, skipped = 0, failingNames = emptyList())))
        assertEquals("lint, e2e (cancelled)", failingChecksWords(checks))
        assertEquals("a, b, c and 3 more", failingChecksWords(checks.copy(failing = 6, failingNames = listOf("a", "b", "c", "d"))))
        assertNull(failingChecksWords(checks.copy(failingNames = emptyList())))
    }

    @Test fun reviewLinesSayWhoApprovedWhoAskedForChangesAndWhomItWaitsOn() {
        val none = PullRequestReviews(decision = null, approvedBy = emptyList(), changesRequestedBy = emptyList(), waitingOn = emptyList())
        assertEquals(listOf(ReviewLine(TaskStatusTone.Todo, "No reviews yet")), reviewLines(none))
        assertEquals(listOf(ReviewLine(TaskStatusTone.Todo, "Needs a review")), reviewLines(none.copy(decision = "review_required")))
        assertEquals(
            listOf(
                ReviewLine(TaskStatusTone.Blocked, "Changes requested by bob"),
                ReviewLine(TaskStatusTone.Done, "Approved by cy"),
                ReviewLine(TaskStatusTone.Review, "Waiting on a, b and 2 others"),
            ),
            reviewLines(none.copy(decision = "changes_requested", changesRequestedBy = listOf("bob"), approvedBy = listOf("cy"), waitingOn = listOf("a", "b", "c", "d"))),
        )
        assertEquals("a, b and c", namesWords(listOf("a", "b", "c")))
        assertEquals("a and b", namesWords(listOf("a", "b")))
    }

    @Test fun sizeInLinesAndFiles() {
        assertEquals("+1,173 −98 · 27 files", changeWords(1173, 98, 27))
        assertEquals("+1 −0 · 1 file", changeWords(1, 0, 1))
    }

    private fun task(id: String, status: String, refs: List<String>) =
        BoardTask(
            id = id, revision = 1, title = id, description = "", acceptance = null, refs = refs, status = status, blockedBy = emptyList(),
            blockedReason = null, writeScopes = emptyList(), workerIds = emptyList(), scheduleId = null, order = 0.0, createdBy = "user",
            updatedBy = "user", createdAt = checkedAt, updatedAt = checkedAt, settledAt = null, archived = false,
        )

    @Test fun aNumberAndItsUrlCountAsOneTaskNamingIt() {
        val tasks = listOf(task("T1", "in_progress", listOf("#12")), task("T2", "todo", listOf("EX-7")), task("T3", "review", listOf("https://github.com/acme/platform/pull/12")))
        val ref = cardRefOf("https://github.com/acme/platform/issues/12")!!
        assertEquals(listOf("T1", "T3"), tasksNaming(ref, tasks, oneRepo).map { it.id })
        assertEquals("#12", boardRefFor(ref, listOf("EX-7", "#12"), oneRepo))
        assertEquals(listOf("T2"), tasksNaming(cardRefOf("https://acme.atlassian.net/browse/EX-7")!!, tasks, oneRepo).map { it.id })
    }
}
