package io.github.mitzacoder.kemiri.panels

import io.github.mitzacoder.kemiri.features.panels.*
import io.github.mitzacoder.kemiri.navigation.PanelTab
import io.github.mitzacoder.kemiri.protocol.ThreadSummary
import io.github.mitzacoder.kemiri.ui.components.*
import org.junit.Assert.*
import org.junit.Test

class PanelPolishTest {
    @Test fun statusesHaveHumanLabelsAndSemanticTones() {
        assertEquals("In progress", workbenchStatus("in_progress").label)
        assertEquals(StatusTone.Danger, workbenchStatus("blocked").tone)
        assertEquals("Waiting", workbenchStatus("idle", "thread").label)
        assertEquals("Finished", workbenchStatus("done", "thread").label)
        assertEquals(StatusTone.Success, workbenchStatus("done", "thread").tone)
        assertEquals(StatusTone.Neutral, workbenchStatus("done", "task").tone)
        // Workers read lower case like the web's `workerStatusLabel`; threads like `threadStatusLabel`.
        assertEquals(listOf("running", "idle", "failed", "stopped", "done"), listOf("running", "idle", "failed", "stopped", "done").map { workbenchStatus(it, "worker").label })
        assertEquals(listOf("Working", "Waiting", "Failed", "Stopped", "Finished"), listOf("running", "idle", "failed", "stopped", "done").map { workbenchStatus(it, "thread").label })
        assertEquals(StatusTone.Subtle, workbenchStatus("done", "worker").tone)
        assertEquals(StatusTone.Warning, workbenchStatus("stopped", "worker").tone)
        assertNull(workbenchStatus("idle", "worker").icon)
        assertEquals(StatusTone.Danger, workbenchStatus("failed").tone)
        assertEquals(StatusTone.Neutral, workbenchStatus("stopped").tone)
    }
    @Test fun taskSectionsPrioritizeLiveWorkAndCollapseSettledWork() {
        assertEquals(listOf("in_progress", "review", "blocked", "todo", "done", "dropped"), panelTaskStatuses)
        assertTrue(panelTaskInitiallyCollapsed("done"))
        assertTrue(panelTaskInitiallyCollapsed("dropped"))
        assertFalse(panelTaskInitiallyCollapsed("blocked"))
    }
    @Test fun tabLabelsAdaptWithoutChangingAccessibleNames() {
        val tabs = listOf(PanelTab.Board, PanelTab.Threads, PanelTab.Info, PanelTab.Memory)
        assertEquals(tabs.toSet(), panelVisibleLabels(700f, tabs, PanelTab.Threads))
        assertEquals(setOf(PanelTab.Threads), panelVisibleLabels(340f, tabs, PanelTab.Threads))
        assertEquals(emptySet<PanelTab>(), panelVisibleLabels(250f, tabs, PanelTab.Threads))
        assertEquals(emptySet<PanelTab>(), panelVisibleLabels(310f, panelTabOrder, PanelTab.Artifacts))
        assertEquals(setOf(PanelTab.Artifacts), panelVisibleLabels(311f, panelTabOrder, PanelTab.Artifacts))
        assertEquals(panelTabOrder.toSet(), panelVisibleLabels(800f, panelTabOrder, PanelTab.Artifacts))
        assertEquals("Background, 2 running threads", panelTabDescription(PanelTab.Threads, 2))
    }
    @Test fun previewRenewalIsBoundedAndOwnerNamesNeverInventNullFields() {
        assertEquals(55_000L, panelPreviewRenewDelay("2026-11-05T12:01:00Z", java.time.Instant.parse("2026-11-05T12:00:00Z").toEpochMilli()))
        assertEquals(1_000L, panelPreviewRenewDelay("2026-11-05T11:00:00Z", java.time.Instant.parse("2026-11-05T12:00:00Z").toEpochMilli()))
        assertEquals(60_000L, panelPreviewRenewDelay("invalid", 0))
        assertEquals("Main", panelArtifactOwner("main", null))
        assertEquals("thread-1 · audit", panelArtifactOwner("thread-1", "audit"))
        assertEquals("Shared checkout", panelIsolationLabel("shared"))
        assertEquals("Own workspace", panelIsolationLabel("workspace"))
    }
    @Test fun metadataIsHumanReadableWithoutInventingUnknownValues() {
        assertEquals("—", panelBytes(-1))
        assertEquals("487 B", panelBytes(487))
        assertEquals("1.5 KB", panelBytes(1536))
        assertEquals("2 min ago", panelRelativeTime("2026-11-05T12:00:00Z", java.time.Instant.parse("2026-11-05T12:02:20Z")))
        assertEquals("unknown", panelRelativeTime("unknown"))
    }
    @Test fun tabNamesAndBadgesAreAccessible() {
        assertEquals("Background", panelTabLabel(PanelTab.Threads))
        assertEquals("Board, 2 questions waiting for you", panelTabDescription(PanelTab.Board, 2))
        assertEquals("Background", panelTabDescription(PanelTab.Threads, 0))
    }
    @Test fun reorderPreservesOtherGroupsAndArchivedSlots() {
        val ids = listOf("todo-a", "blocked", "archived", "todo-b", "done", "todo-c")
        val group = listOf("todo-a", "todo-b", "todo-c")
        assertEquals(listOf("todo-b", "blocked", "archived", "todo-c", "done", "todo-a"), moveGroupOrder(ids, group, "todo-a", "todo-c"))
        assertEquals(ids, moveGroupOrder(ids, group, "todo-a", "blocked"))
        assertEquals(ids, moveGroupOrder(ids, group, "todo-a", "todo-a"))
        assertEquals(emptyList<String>(), moveGroupOrder(emptyList(), emptyList(), "a", "b"))
    }
    @Test fun concurrentStatusUpdateLeavesNewGroupInItsServerSlot() {
        assertEquals(listOf("c", "b", "a", "new"), projectGroupOrder(listOf("a", "b", "c", "new"), listOf("c", "a", "b"), listOf("a", "c")))
    }
    @Test fun projectionOnlyChangesOrderAndRetainsNewServerRows() {
        assertEquals(listOf("b", "a", "new"), projectOrder(listOf("a", "b", "new"), listOf("b", "gone", "a")))
        assertEquals(listOf("a", "b"), projectOrder(listOf("a", "b"), null))
        assertEquals(listOf("b", "c", "a"), moveOrder(listOf("a", "b", "c"), "a", 2))
        assertEquals(listOf("a", "b"), moveOrder(listOf("a", "b"), "gone", 0))
    }
    private fun thread(status: String, current: String? = null, summary: String? = null, failure: String? = null, questions: Long = 0) = ThreadSummary(
        id = "thread-1", title = "Research", status = status, main = false,
        startedBy = "main", scheduleId = null, conversationId = 42, model = null,
        thinkingLevel = null, onFinish = "notify", runningWorkers = 0, ownedTasks = emptyList(),
        openQuestions = questions, current = current, summary = summary, failure = failure,
        createdAt = "2026-11-05T00:00:00Z", updatedAt = "2026-11-05T00:00:00Z", finishedAt = null, archived = false,
    )
    @Test fun threadCardsReadActualSummaryFieldsNotInventedResultObjects() {
        assertEquals("Ready", threadActivity(thread("done", current = "Old turn", summary = "\n# Ready\nDetails")))
        assertEquals("Network failed", threadActivity(thread("failed", current = "Old turn", failure = "Network failed")))
        assertEquals("Waiting for a message or its workers.", threadActivity(thread("idle")))
        assertTrue(threadRank(thread("idle", questions = 1)) < threadRank(thread("running")))
    }
    @Test fun mainQuestionsSpanThreadsButBackgroundIsScoped() {
        assertTrue(panelQuestionVisible(null, "thread-1"))
        assertTrue(panelQuestionVisible("main", "thread-1"))
        assertTrue(panelQuestionVisible("thread-1", "thread-1"))
        assertFalse(panelQuestionVisible("thread-1", null))
        assertFalse(panelQuestionVisible("thread-1", "thread-2"))
    }
    @Test fun failureDropsOnlyProjectionNeverRestoresStaleSnapshot() {
        val state = BoardOrderState(listOf("b", "a"), true).failed("Disconnected")
        assertNull(state.ids)
        assertFalse(state.saving)
        assertEquals("Disconnected", state.error)
        assertEquals(listOf("new", "a"), projectOrder(listOf("new", "a"), state.ids))
    }
}
