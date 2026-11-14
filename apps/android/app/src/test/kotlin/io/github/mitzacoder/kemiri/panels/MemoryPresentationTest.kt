package io.github.mitzacoder.kemiri.panels

import io.github.mitzacoder.kemiri.data.ClientException
import io.github.mitzacoder.kemiri.features.panels.*
import io.github.mitzacoder.kemiri.protocol.*
import org.junit.Assert.*
import org.junit.Test

/** How the Memory tab words memory; mirrors the web's `memory.test.ts`. */
class MemoryPresentationTest {
    @org.junit.Before fun use24HourClock() { io.github.mitzacoder.kemiri.data.DeviceTimeFormat.current = io.github.mitzacoder.kemiri.data.TimeFormat.Hour24 }
    @org.junit.After fun restoreClockChoice() { io.github.mitzacoder.kemiri.data.DeviceTimeFormat.current = io.github.mitzacoder.kemiri.data.TimeFormat.Automatic }

    private val now = java.time.Instant.parse("2026-11-04T19:00:00Z").toEpochMilli()

    private fun summary(fileId: String = "testing", title: String = "Testing", status: String = "active", updated: String = "2026-11-04T18:30:00Z") = MemoryFileSummary(
        scope = "global", fileId = fileId, title = title, summary = "How this user tests.", tags = listOf("testing"), links = emptyList(), status = status,
        supersededBy = null, headings = emptyList(), created = "2026-11-01T09:00:00Z", updated = updated,
        source = MemoryFileSummarySource(projectId = "project-1", conversationId = 4, entryId = 12),
    )

    private fun change(
        commit: String = "be84355c5bed5b9bcb2f0a8e4f4b9a0f2f6c1d2e", message: String = "memory: add the testing topic\n\nFrom the review conversation.\n",
        at: String = "2026-11-04T18:30:00Z", kind: String? = "tool", undoable: Boolean? = null, undoneBy: String? = null, entryId: Long? = null,
    ) = MemoryChange(commit = commit, message = message, at = at, files = listOf("testing"), kind = kind,
        source = entryId?.let { MemoryFileSummarySource(projectId = "project-1", conversationId = 4, entryId = it) }, undoable = undoable, undoneBy = undoneBy)

    private fun status(writes: Long = 3, last: MemoryScopeStatusLastMaintenance? = MemoryScopeStatusLastMaintenance(at = "2026-11-04T03:00:00Z", outcome = "ok", commit = "be84355c", message = "Memory maintenance: merged the testing topics."),
                       next: String? = "2026-11-05T03:00:00Z", maintaining: Boolean = false) =
        MemoryScopeStatus(scope = "project", projectId = "project-1", writesSinceMaintenance = writes, maintaining = maintaining, lastMaintenance = last, nextMaintenanceAt = next)

    @Test fun hidesArchivedFilesUntilAskedButCountsThem() {
        val files = listOf(summary(), summary("old-notes", "Old notes", "archived", "2026-11-01T09:00:00Z"), summary("old-deploy", "Old deploy", "superseded", "2026-11-03T09:00:00Z"))
        val hidden = splitMemoryFiles(files, false, now)
        assertEquals(listOf("testing", "old-deploy"), hidden.shown.map { it.file.fileId })
        assertEquals(2, hidden.active)
        assertEquals(1, hidden.archived)
        assertEquals(listOf("testing", "old-deploy", "old-notes"), splitMemoryFiles(files, true, now).shown.map { it.file.fileId })
        assertEquals("30 min ago", hidden.shown.first().updated)
        assertEquals(MemoryFileSplit(emptyList(), 0, 0), splitMemoryFiles(emptyList(), false, now))
    }

    @Test fun namesAHitsSectionAndTheIntroduction() {
        assertEquals("Unit tests", memorySearchHeading("Unit tests"))
        assertEquals("Introduction", memorySearchHeading(null))
        assertEquals("Introduction", memorySearchHeading("   "))
        assertEquals("Global", memoryScopeLabel("global"))
        assertEquals("Project", memoryScopeLabel("project"))
    }

    @Test fun readsCommitsAsRowsNewestFirst() {
        assertEquals("memory: add testing" to "Because it was missing.", memoryMessageParts("memory: add testing\n\nBecause it was missing.\n"))
        assertEquals("one line" to "", memoryMessageParts("one line"))
        val row = memoryChangeRows(listOf(change()), now).single()
        assertEquals("be84355", row.commit)
        assertEquals("memory: add the testing topic", row.subject)
        assertEquals("From the review conversation.", row.body)
        assertEquals("30 min ago", row.`when`)
        assertEquals("By the coordinator", row.kind)
        val older = change(commit = "1111111aaaa", at = "2026-11-01T09:00:00Z", message = "older")
        val newest = change(commit = "2222222bbbb", at = "2026-11-04T18:00:00+00:00", message = "newest")
        assertEquals(listOf("newest", "older"), memoryChangeRows(listOf(older, newest), now).map { it.subject })
    }

    @Test fun saysWhoMadeEachChangeAndWhatCanBeUndone() {
        assertEquals(listOf("By the coordinator", "By hand", "Saved from a compaction", "Maintenance", "Undo", "Change"),
            listOf("tool", "hand", "extraction", "maintenance", "undo", null).map(::memoryChangeKindLabel))
        assertTrue(memoryChangeUndoable(change(kind = "extraction", undoable = true)))
        assertTrue(memoryChangeUndoable(change(kind = "maintenance", undoable = true)))
        assertFalse(memoryChangeUndoable(change(kind = "tool")))
        assertFalse(memoryChangeUndoable(change(kind = "extraction", undoable = true, undoneBy = "abc")))
        assertEquals(88L, memoryChangeRows(listOf(change(kind = "extraction", undoable = true, entryId = 88)), now).single().compactionEntry)
        assertNull(memoryChangeRows(listOf(change(kind = "tool", entryId = 88)), now).single().compactionEntry)
    }

    @Test fun explainsARefusedUndo() {
        assertEquals("Not undone: later changes touched the same memories, so the newer ones win. Nothing was reverted.",
            memoryUndoErrorText(ClientException("memory_conflict", "testing changed after this commit.")))
        assertEquals("No memory testing.", memoryUndoErrorText(ClientException("unknown_memory", "No memory testing.")))
        assertEquals("socket closed", memoryUndoErrorText(Exception("socket closed")))
    }

    @Test fun readsMaintenanceAsOneLine() {
        val view = memoryStatusView(status(), now)
        assertEquals("16 h ago · changed memory", view.last!!.first)
        assertEquals("Memory maintenance: merged the testing topics.", view.last!!.second)
        assertFalse(view.last!!.third)
        assertEquals("in 8 h", view.next!!.first)
        assertEquals("3 writes since the last run", view.writes)
        assertFalse(view.off)
        val failed = memoryStatusView(status(writes = 1, last = MemoryScopeStatusLastMaintenance(at = "2026-11-04T03:00:00Z", outcome = "failed", commit = null, message = "the model failed")), now)
        assertEquals("1 write since the last run", failed.writes)
        assertEquals("16 h ago · failed", failed.last!!.first)
        assertTrue(failed.last!!.third)
        assertEquals("16 h ago · nothing to do", memoryStatusView(status(last = MemoryScopeStatusLastMaintenance(at = "2026-11-04T03:00:00Z", outcome = "nothing_to_do", commit = null, message = null)), now).last!!.first)
        assertNull(memoryStatusView(status(last = null), now).last)
        val off = memoryStatusView(status(next = null), now)
        assertTrue(off.off)
        assertNull(off.next)
        assertEquals("due now", relativeTimeAhead("2026-11-04T19:00:20Z", now))
        assertEquals("in 5 min", relativeTimeAhead("2026-11-04T19:05:00Z", now))
    }

    @Test fun saysWhenMaintenanceRuns() {
        val settings = MemoryMaintenanceSettings(model = ModelRef(provider = "anthropic", modelId = "claude-sonnet-4-5"), thinkingLevel = "medium", time = "03:00", afterWrites = 20)
        assertEquals("Nightly at 03:00 (Europe/Bucharest), or after 20 writes.", memoryMaintenanceSummary(settings, "Europe/Bucharest"))
        assertEquals("Nightly at 03:00 (UTC), or after 1 write.", memoryMaintenanceSummary(settings.copy(afterWrites = 1), "UTC"))
        assertEquals("Off: maintenance doesn't run without a model.", memoryMaintenanceSummary(settings.copy(model = null), "UTC"))
    }

    @Test fun titlesLinksFromTheScopesListAndNamesTheSource() {
        val links = memoryLinkViews(listOf("testing", "global:style", " "), "project", listOf(summary().copy(scope = "project")))
        assertEquals(listOf(MemoryLinkView("project", "testing", "Testing", true), MemoryLinkView("global", "style", "style", false)), links)
        assertEquals("conversation #4, entry #12", memorySourceText(MemoryFileSummarySource(projectId = "p", conversationId = 4, entryId = 12)))
        assertEquals("the coordinator", memorySourceText(MemoryFileSummarySource(projectId = "p", conversationId = null, entryId = null)))
    }
}
