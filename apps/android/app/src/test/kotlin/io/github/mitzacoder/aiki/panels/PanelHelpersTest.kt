package io.github.mitzacoder.aiki.panels

import io.github.mitzacoder.aiki.features.panels.*
import io.github.mitzacoder.aiki.navigation.Destination
import io.github.mitzacoder.aiki.protocol.*
import org.junit.Assert.*
import org.junit.Test

class PanelHelpersTest {
    private fun task(id: String = "a", revision: Long = 1, blockedBy: List<String> = emptyList()) = BoardTask(
        id = id, revision = revision, title = "Server title", description = "Description", acceptance = null, refs = emptyList(),
        status = "todo", blockedBy = blockedBy, blockedReason = null, writeScopes = emptyList(), workerIds = emptyList(),
        scheduleId = null, ownerThreadId = null, report = BoardTaskReport(now = "", results = "", next = "", revision = 1, updatedAt = null, updatedBy = null), snapshots = 0, order = 1.0,
        createdBy = "user", updatedBy = "user", createdAt = "now", updatedAt = "now", settledAt = null, archived = false,
    )
    @Test fun casPreservesEveryDraftFieldAndAdoptsOnlyLatestRevision() {
        val original = task()
        val input = original.input().copy(title = "Mine", description = "Unsaved", status = "blocked", acceptance = "Pass tests", writeScopes = listOf("src/**"), blockedReason = "Waiting")
        val draft = TaskDraft(original.id, original.revision, input)
        val newer = original.copy(revision = 4, title = "Theirs", status = "done")
        assertEquals(input, draft.keepMine(newer).input)
        assertEquals(4L, draft.keepMine(newer).revision)
        assertEquals(newer.input(), draft.useTheirs(newer).input)
        assertEquals(1L, draft.revision)
    }
    @Test fun dependenciesRejectMissingSelfAndIndirectCycles() {
        val tasks = listOf(task("a"), task("b", blockedBy = listOf("a")))
        val draft = TaskDraft("a", 1, task().input())
        assertNull(validateTask(draft, tasks))
        listOf("a", "b", "missing").forEach { id -> assertNotNull(validateTask(draft.copy(input = draft.input.copy(blockedBy = listOf(id))), tasks)) }
        assertNotNull(validateTask(draft.copy(input = draft.input.copy(title = "  ")), tasks))
        assertEquals(listOf("a", "b"), splitIds(" a, b, , a "))
    }
    private fun info(thread: String? = null, worker: String? = null, project: String = "p") = ConversationContext(project, worker, thread, "/remote/me/work", "/remote/me/work", "/remote/me", "prompt", emptyList(), emptyList(), emptyList())
    @Test fun contextScopeNormalizesMainButNeverConflatesWorkersOrThreads() {
        val route = Destination.Chat("https://one.example", "p")
        assertTrue(matchesContext(route, info()))
        assertTrue(matchesContext(route, info("main")))
        assertFalse(matchesContext(route, info("background")))
        assertFalse(matchesContext(route, info(worker = "w")))
        assertFalse(matchesContext(route, info(project = "other")))
        assertFalse(matchesContext(route.copy(workerId = "w", threadId = "a"), info("b", "w")))
        assertNull(info().usage)
    }
    @Test fun nullUsageIsUnknownNotZeroAndProgressIsBounded() {
        val usage = ContextUsage(null, null, null, null, 0, null, false)
        assertNull(usageFraction(usage))
        assertNull(usageFraction(usage.copy(contextTokens = 4, contextWindow = 0)))
        assertEquals(0.5f, usageFraction(usage.copy(contextTokens = 50, contextWindow = 100)))
        assertEquals(1f, usageFraction(usage.copy(contextTokens = 120, contextWindow = 100)))
        assertEquals("~/work", humanPath("/remote/me/work", "/remote/me"))
        assertEquals("/remote/mean", humanPath("/remote/mean", "/remote/me"))
    }
    @Test fun memoryLinksAndSnippetsAreScopedAndNeverInterpretHtml() {
        assertEquals("global" to "preferences", memoryTarget("global:preferences", "project"))
        assertEquals("project" to "architecture", memoryTarget("architecture", "project"))
        assertEquals(listOf("<b>" to false, "match" to true, "</b>" to false), snippetParts("<b>\u0002match\u0003</b>"))
        assertEquals(listOf("tail" to true), snippetParts("\u0002tail"))
        assertEquals(emptyList<Pair<String, Boolean>>(), snippetParts(""))
        assertTrue(memoryEventMatches(MemoryChangedEvent(scope = "global", projectId = null), "p"))
        assertFalse(memoryEventMatches(MemoryChangedEvent(scope = "project", projectId = "other"), "p"))
    }
    @Test fun threadNavigationPreservesBackendAndProjectClearsWorker() {
        val thread = ThreadSummary(
            id = "background", title = "Title", status = "idle", main = false, startedBy = "main", scheduleId = null, conversationId = 1,
            model = null, thinkingLevel = null, onFinish = "review", runningWorkers = 0, ownedTasks = emptyList(), openQuestions = 0,
            current = null, summary = null, failure = null, createdAt = "now", updatedAt = "now", finishedAt = null, archived = false,
        )
        val from = Destination.Chat("https://two.example", "p", "old", "worker")
        assertEquals(Destination.Chat(from.backendKey, "p", "background", null), threadRoute(from, thread))
        assertEquals(Destination.Chat(from.backendKey, "p"), threadRoute(from, thread.copy(id = "main", main = true)))
    }
}
