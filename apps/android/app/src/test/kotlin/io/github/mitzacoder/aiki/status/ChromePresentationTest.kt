package io.github.mitzacoder.aiki.status

import io.github.mitzacoder.aiki.data.BackendConfig
import io.github.mitzacoder.aiki.data.decodeConnect
import io.github.mitzacoder.aiki.features.panels.*
import io.github.mitzacoder.aiki.features.settings.*
import io.github.mitzacoder.aiki.navigation.*
import io.github.mitzacoder.aiki.protocol.*
import org.junit.Assert.*
import org.junit.Test

/**
 * Track E's other ports, each mirroring its web test: apps/web/test/projects.test.ts (drawer rows), cache.test.ts
 * (Info's cache-miss totals), context.test.ts (file labels), storage.test.ts and connect.test.ts.
 */
class ChromePresentationTest {
    private val now = java.time.Instant.parse("2026-11-05T12:00:00.000Z").toEpochMilli()
    private val hourAgo = "2026-11-05T11:00:00.000Z"
    private fun activity(coordinator: String = "idle", runningWorkers: Long = 0, lastReplyAt: String? = null, lastReplyEntryId: Long? = null, runningTool: ProjectRunningTool? = null) =
        ProjectActivity(coordinator = coordinator, runningWorkers = runningWorkers, lastReplyAt = lastReplyAt, lastReplyEntryId = lastReplyEntryId, runningTool = runningTool)
    private fun project(state: String = "open", failure: String? = null, model: ModelRef? = ModelRef(provider = "anthropic", modelId = "claude-sonnet-4-5"), activity: ProjectActivity? = null) =
        ProjectSummary(id = "demo", name = "demo", path = "/home/user/Projects/demo", coordinator = WorkerDefaults(model = model, thinkingLevel = null),
            workerModels = emptyList(), checkIns = ProjectCheckIns(enabled = true, intervalMinutes = 10), state = state, failure = failure, activity = activity)

    @Test fun projectRowsSayWhatEachProjectIsDoing() {
        val failed = projectStatus(project(state = "failed", failure = "jj: not a repository", activity = activity("working")), now)
        assertEquals(ProjectStatus(ProjectStatusTone.Error, "Open failed", title = "jj: not a repository"), failed)
        assertEquals("No model", projectStatus(project(model = null), now).label)
        assertEquals(ProjectStatusTone.Ok to "Open", projectStatus(project(), now).let { it.tone to it.label })
        assertEquals(ProjectStatusTone.Muted to "Closed", projectStatus(project(state = "closed"), now).let { it.tone to it.label })
        val working = projectStatus(project(activity = activity("working", 2, hourAgo)), now)
        assertEquals(Triple(ProjectStatusTone.Busy, "Working", "2 workers"), Triple(working.tone, working.label, working.detail))
        val tool = ProjectRunningTool(name = "bash", startedAt = "2026-11-05T11:57:00.000Z")
        val running = projectStatus(project(activity = activity("working", 1, runningTool = tool)), now)
        assertEquals("Running bash", running.label)
        assertEquals("3m", running.detail)
        assertTrue(running.title.contains("running bash") && running.title.contains("1 worker"))
        assertEquals("4m", projectStatus(project(activity = activity("working", runningTool = tool)), now + 60_000).detail)
        assertEquals(Triple(ProjectStatusTone.Error, "Run failed", "1h ago"), projectStatus(project(activity = activity("failed", lastReplyAt = hourAgo, lastReplyEntryId = 4)), now).let { Triple(it.tone, it.label, it.detail) })
        assertEquals("1 worker", projectStatus(project(activity = activity(runningWorkers = 1)), now).label)
        assertEquals("3 workers", projectStatus(project(activity = activity(runningWorkers = 3)), now).label)
        assertEquals("Idle" to "1h ago", projectStatus(project(activity = activity(lastReplyAt = hourAgo)), now).let { it.label to it.detail })
        assertEquals("Not started", projectStatus(project(activity = activity()), now).label)
        assertEquals("Closed" to "2 workers", projectStatus(project(state = "closed", activity = activity(runningWorkers = 2, lastReplyAt = hourAgo)), now).let { it.label to it.detail })
    }

    @Test fun badgesCountQuestionsAndBackgroundThreads() {
        assertNull(questionBadgeText(0))
        assertNull(questionBadgeText(null))
        assertEquals("3", questionBadgeText(3))
        assertEquals("9+", questionBadgeText(12))
        assertEquals("1 question waiting for you", questionsWaitingLabel(1))
        assertEquals("2 in background", backgroundThreadsText(2))
        assertNull(backgroundThreadsText(0))
    }

    @Test fun cacheMissTotalsStayQuietWhenExplainedAndWarnWhenNot() {
        val base = CacheMissTotals(misses = 3, missedTokens = 150_000, missedCost = 0.6, unexplained = 0, unexplainedTokens = 0, unexplainedCost = 0.0, lastUnexplainedAt = null)
        assertNull(cacheMissTotalsView(null))
        assertNull(cacheMissTotalsView(base.copy(misses = 0)))
        assertEquals(false to "3 cache misses, each after idle time or a change", cacheMissTotalsView(base)!!.let { it.warning to it.label })
        val unexplained = cacheMissTotalsView(base.copy(unexplained = 1, unexplainedTokens = 31_000, unexplainedCost = 0.09, lastUnexplainedAt = "2026-11-06T10:00:00.000Z"))!!
        assertTrue(unexplained.warning)
        assertEquals("1 cache miss with no clear cause · 31k tokens (~$0.09)", unexplained.label)
        assertTrue(unexplained.title.startsWith("3 cache misses so far: 150k tokens re-billed (~$0.60)."))
    }

    @Test fun contextFilesAreLabelledByKindOrOrigin() {
        val project = "/home/user/repos/demo"
        fun file(path: String, scope: String, kind: String? = null) = ContextFile(path = path, scope = scope, kind = kind, content = "x")
        assertEquals("global", contextFileBadge(file("/home/user/.pi/AGENTS.md", "global"), project))
        assertEquals("project", contextFileBadge(file("/home/user/repos/demo/AGENTS.md", "project"), project))
        assertEquals("parent folder", contextFileBadge(file("/home/user/repos/AGENTS.md", "project"), project))
        assertEquals("harness config", contextFileOriginLabel(file("/home/user/.config/aiki/APPEND_SYSTEM.md", "global", "append"), project))
        assertEquals("Appended instructions", contextFileBadge(file("/home/user/.config/aiki/APPEND_SYSTEM.md", "global", "append"), project))
        assertEquals("System prompt override", contextFileKindLabel("system"))
        assertEquals("Model notes", contextFileKindLabel("model"))
        assertEquals("openai-codex--gpt-*.md", contextFileName(file("/cfg/models/openai-codex--gpt-*.md", "global", "model")))
        assertEquals("~840 tokens", formatTokenEstimate(estimateTokens("a".repeat(3360))))
        assertEquals("~3.8k tokens", formatTokenEstimate(3800))
    }

    private fun item(id: String = "worker:main/w1", kind: String = "worker", bytes: Long = 2_500_000_000, removable: Boolean = true) =
        StorageItem(id = id, kind = kind, label = "Android build", path = "/data/w1", bytes = bytes, removable = removable, updatedAt = "2026-11-05T10:00:00.000Z")

    @Test fun storageRowsAndCleanupsReadAsTheWebSays() {
        assertEquals("Worker", storageKindLabel("worker"))
        assertEquals("Background thread", storageKindLabel("thread"))
        assertEquals("finished", storageStateLabel(item()))
        assertEquals("running", storageStateLabel(item(removable = false)))
        assertEquals("empty", storageSize(0))
        assertEquals("2.5 GB", storageSize(2_500_000_000))
        assertEquals(CleanupSummary(2, 3_000_000_000, "2 finished workspaces, 3 GB"), cleanupSummary(listOf(item(), item("t", removable = false), item("w2", bytes = 500_000_000))))
        assertEquals("Nothing finished to clean up.", cleanupSummary(listOf(item(removable = false))).text)
        assertEquals("1 finished workspace, 2.5 GB", cleanupSummary(listOf(item())).text)
        assertEquals(CleanupNotice(false, "Removed 2 workspaces and freed 1.2 MB."),
            cleanupNotice(ProjectsStorageCleanResponse(id = "1", removed = listOf("a", "b"), freedBytes = 1_200_000, refused = emptyList())))
        assertEquals(CleanupNotice(true, "Nothing was removed. 1 was kept: still running."),
            cleanupNotice(ProjectsStorageCleanResponse(id = "1", removed = emptyList(), freedBytes = 0, refused = listOf(ProjectsStorageCleanResponseRefusedItem(id = "a", reason = "still running")))))
        val listing = ProjectsStorageResponse(id = "1", totalBytes = 3_000_000_000, items = listOf(item(), item("w2", bytes = 500_000_000)), measuredAt = "2026-11-05T10:00:00.000Z")
        assertEquals(listOf("w2") to 500_000_000L, withoutRemoved(listing, listOf("worker:main/w1")).let { it.items.map(StorageItem::id) to it.totalBytes })
    }

    private val two = listOf(BackendConfig("harness-pc", "https://harness-pc.example.test"), BackendConfig("harness-vm", "https://harness-vm.example.test"))

    @Test fun aConnectLinkCarriesItsBackendsThroughTheFragment() {
        val payload = encodeConnectList(two)
        assertTrue(payload.startsWith("v1."))
        assertEquals(two, decodeConnect(payload).getOrThrow())
        val link = connectHref("https://${io.github.mitzacoder.aiki.features.notifications.APP_LINK_HOST}", two)
        assertTrue(link.startsWith("https://${io.github.mitzacoder.aiki.features.notifications.APP_LINK_HOST}/connect#"))
        assertEquals(-1, link.indexOf('?'))
        assertEquals(two, decodeConnect(link.substring(link.indexOf('#'))).getOrThrow())
        // Matches the web encoder byte for byte: base64url of "name<TAB>origin" lines without padding.
        val web = "v1." + java.util.Base64.getUrlEncoder().withoutPadding().encodeToString("harness-pc\thttps://harness-pc.example.test".toByteArray())
        assertEquals(web, encodeConnectList(two.take(1)))
        assertEquals(listOf(BackendConfig("harness-pc", "https://harness-pc.example.com")),
            decodeConnect(encodeConnectList(listOf(BackendConfig(" harness-pc ", "https://harness-pc.example.com/")))).getOrThrow())
        assertEquals(two, decodeConnect(encodeConnectList(two + BackendConfig("again", "https://harness-pc.example.test"))).getOrThrow())
    }

    @Test fun aConnectLinkRefusesAddressesAPhoneCouldNotUse() {
        listOf(
            emptyList(),
            listOf(BackendConfig("local", "http://127.0.0.1:7317")),
            listOf(BackendConfig("path", "https://harness.example.com/app")),
            listOf(BackendConfig("secret", "https://user:secret@harness.example.com")),
            listOf(BackendConfig("", "https://harness.example.com")),
            List(MAX_CONNECT_BACKENDS + 1) { BackendConfig("backend-$it", "https://backend-$it.example.com") },
        ).forEach { backends -> assertTrue(runCatching { encodeConnectList(backends) }.isFailure) }
        assertTrue(isConnectUrl("https://harness-pc.example.test"))
        assertTrue(isConnectUrl("https://harness-pc.example.test/"))
        assertFalse(isConnectUrl("http://127.0.0.1:7317"))
        assertFalse(isConnectUrl("https://harness-pc.example.test/app"))
        assertFalse(isConnectUrl("harness-pc"))
        assertEquals("harness-pc", shareableName("  harness-pc  "))
        assertEquals(MAX_CONNECT_NAME_LENGTH, shareableName("a".repeat(MAX_CONNECT_NAME_LENGTH + 20)).length)
        assertEquals("backend", shareableName("   "))
        assertEquals("bell", shareableName("\u0007bell"))
        assertTrue(qrModules(connectHref(CONNECT_APP_ORIGIN, two)).size >= 21)
    }
}
