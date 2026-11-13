package io.github.mitzacoder.kemiri.drafts

import io.github.mitzacoder.kemiri.features.chat.*
import io.github.mitzacoder.kemiri.protocol.ChatDraft
import io.github.mitzacoder.kemiri.protocol.DraftAttachment
import io.github.mitzacoder.kemiri.protocol.DraftAuthor
import io.github.mitzacoder.kemiri.protocol.DraftContent
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.currentTime
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.Assert.*
import org.junit.Test

private fun draft(text: String, taskId: String? = null, quotes: List<String> = emptyList(), attachments: List<DraftAttachment>? = null) =
    DraftContent(text = text, taskId = taskId, quotes = quotes, attachments = attachments)
private val none = SyncedDraft(0, null)
private fun entry(revision: Long, content: DraftContent?, author: DraftAuthor? = null) =
    ChatDraft(projectId = "p", threadId = "main", revision = revision, updatedAt = "2026-11-08T10:00:00.000Z", author = author, content = content)
private fun synced(revision: Long, content: DraftContent?) = SyncedDraft(revision, content)
private val image = DraftAttachment(id = "a".repeat(64), mimeType = "image/png", size = 1)
private const val NEVER = Long.MAX_VALUE

/** Mirrors apps/web/test/drafts-sync.test.ts: the rule that never overwrites what the user has not synced. */
class DecideRemoteTest {
    private fun decide(local: DraftContent?, synced: SyncedDraft, remote: ChatDraft, focused: Boolean = false, since: Long = NEVER, authoritative: Boolean = false) =
        decideRemote(local, synced, remote.revision, remote.content, focused, since, authoritative)

    @Test fun anEntryThatIsNotNewerIsIgnored() {
        val s = synced(3, draft("a"))
        assertEquals(RemoteDecision.Ignore, decide(draft("a"), s, entry(3, draft("b"))))
        assertEquals(RemoteDecision.Ignore, decide(draft("a"), s, entry(2, draft("b"))))
        // ... unless the backend itself answered with it (it may have lost its entry).
        assertEquals(RemoteDecision.Apply, decide(draft("a"), s, entry(2, draft("b")), authoritative = true))
    }

    @Test fun theSameContentOnlyMovesTheRevision() {
        assertEquals(RemoteDecision.Adopt, decide(draft("same"), none, entry(1, draft("same"))))
        // Empty and cleared are the same thing, and a missing attachment list is an empty one.
        assertEquals(RemoteDecision.Adopt, decide(draft("  "), synced(1, draft("x")), entry(2, null)))
        assertEquals(RemoteDecision.Adopt, decide(draft("t", attachments = emptyList()), none, entry(1, draft("t"))))
    }

    @Test fun anUntouchedComposerTakesTheRemoteDraftAndARemoteClear() {
        val s = synced(1, draft("old"))
        assertEquals(RemoteDecision.Apply, decide(draft("old"), s, entry(2, draft("new"))))
        assertEquals(RemoteDecision.Apply, decide(draft("old"), s, entry(2, null)))
        assertEquals(RemoteDecision.Apply, decide(draft(""), none, entry(1, draft("hi", taskId = "T1"))))
    }

    @Test fun aComposerWithUnsyncedTextKeepsItWhetherFocusedOrNot() {
        val s = synced(1, draft("old"))
        for (focused in listOf(true, false)) {
            assertEquals(RemoteDecision.Conflict, decide(draft("old, plus typing"), s, entry(2, draft("theirs")), focused = focused, since = 10_000))
        }
        // A task or a quote added offline counts.
        assertEquals(RemoteDecision.Conflict, decide(draft("old", quotes = listOf("q")), s, entry(2, draft("theirs"))))
        // Text typed into a chat the backend had nothing for, while a remote draft arrives.
        assertEquals(RemoteDecision.Conflict, decide(draft("typed"), none, entry(1, draft("theirs"))))
    }

    @Test fun aFocusedComposerThatWasJustTypedInWaitsUntilTheTypingStops() {
        val s = synced(1, draft("old"))
        assertEquals(RemoteDecision.Defer(DRAFT_TYPING_QUIET_MS - 1000), decide(draft("old"), s, entry(2, draft("n")), focused = true, since = 1000))
        assertEquals(RemoteDecision.Apply, decide(draft("old"), s, entry(2, draft("n")), focused = true, since = DRAFT_TYPING_QUIET_MS))
        assertEquals(RemoteDecision.Apply, decide(draft("old"), s, entry(2, draft("n")), focused = false, since = 100))
    }

    @Test fun namesAnotherDeviceNotThisOneNotAClear() {
        val other = DraftAuthor(deviceId = "b", name = "Pixel 8")
        assertEquals(DraftOrigin("Pixel 8", 0), draftOrigin(entry(1, draft("x"), other), "a"))
        assertEquals(DraftOrigin("another device", 0), draftOrigin(entry(1, draft("x"), DraftAuthor(deviceId = "b")), "a"))
        assertNull(draftOrigin(entry(1, draft("x"), DraftAuthor(deviceId = "a")), "a"))
        assertNull(draftOrigin(entry(1, null, other), "a"))
        assertNull(draftOrigin(entry(1, draft("x")), "a"))
        assertEquals(1, draftOrigin(entry(1, draft("", attachments = listOf(image)), other), "a")?.attachments)
    }

    @Test fun contentRulesMatchTheProtocolHelpers() {
        assertTrue(draft("  \n").isEmptyDraft())
        assertFalse(draft("", taskId = "T1").isEmptyDraft())
        assertFalse(draft("", attachments = listOf(image)).isEmptyDraft())
        assertTrue(sameDraftContent(null, null))
        assertFalse(sameDraftContent(null, draft("x")))
        assertNull(draftLimitError(draft("x".repeat(100_000), quotes = listOf("y".repeat(50_000), "z".repeat(50_000)))))
        assertNotNull(draftLimitError(draft("x".repeat(100_001))))
        assertNotNull(draftLimitError(draft("", quotes = List(21) { "q" })))
        assertNotNull(draftLimitError(draft("x".repeat(100_000), quotes = listOf("y".repeat(50_000), "z".repeat(50_000), "w"))))
        assertNotNull(draftLimitError(draft("", attachments = List(DRAFT_MAX_ATTACHMENTS + 1) { image })))
    }
}

/** A backend with one chat, and a sync run on a test scheduler's virtual clock. */
@OptIn(ExperimentalCoroutinesApi::class)
private class Rig(local: DraftContent? = null, synced: SyncedDraft = none, scope: TestScope) {
    var available = true
    var focused = false
    var entry: ChatDraft? = null
    var failNext = false
    /** Another device always writes first: every write is refused with a newer entry. */
    var alwaysRefuse = false
    var rejectNext = false
    val writes = mutableListOf<Pair<DraftContent?, Long>>()
    val applied = mutableListOf<DraftContent?>()
    val persisted = mutableListOf<Pair<DraftContent?, SyncedDraft>>()
    private val transport = object : DraftTransport {
        override fun available() = available
        override suspend fun read() = entry
        override suspend fun write(content: DraftContent?, baseRevision: Long): DraftWriteResult {
            writes += content to baseRevision
            if (failNext) { failNext = false; throw IllegalStateException("offline") }
            if (rejectNext) { rejectNext = false; throw DraftRejected("too big") }
            if (alwaysRefuse) {
                entry = entry(((entry?.revision) ?: 0) + 1, draft("other ${writes.size}"))
                return DraftWriteResult(false, entry)
            }
            val current = entry
            val same = if (current == null) content == null else sameDraftContent(current.content, content)
            if (same) return DraftWriteResult(true, current)
            if (baseRevision != (current?.revision ?: 0)) return DraftWriteResult(false, current)
            entry = entry((current?.revision ?: 0) + 1, content)
            return DraftWriteResult(true, entry)
        }
    }
    val sync = DraftSync(transport, scope, local, synced, { focused }, { content, _ -> applied += content }, { l, s -> persisted += l to s }, now = { 1_000_000 + scope.currentTime })
    val testScope = scope
    fun advance(ms: Long) { testScope.advanceTimeBy(ms); testScope.runCurrent() }
    fun settle() = testScope.runCurrent()
    fun type(text: String) = sync.changed(draft(text))
}

@OptIn(ExperimentalCoroutinesApi::class)
class DraftSyncTest {
    @Test fun writesOnceADebounceAfterTypingStops() = runTest {
        val t = Rig(scope = this)
        t.type("h"); t.advance(300); t.type("he"); t.advance(300); t.type("hel")
        assertEquals(0, t.writes.size)
        t.advance(DRAFT_DEBOUNCE_MS)
        assertEquals(listOf(draft("hel") to 0L), t.writes)
        assertEquals(SyncedDraft(1, draft("hel")), t.sync.synced.copy(content = t.sync.synced.content))
        // The next write builds on the revision the last one got.
        t.type("hello"); t.advance(DRAFT_DEBOUNCE_MS)
        assertEquals(draft("hello") to 1L, t.writes[1])
    }

    @Test fun flushWritesAtOnceAndAnEmptyComposerClears() = runTest {
        val t = Rig(draft("x"), synced(4, draft("x")), this)
        t.entry = entry(4, draft("x"))
        t.sync.changed(draft(""))
        t.sync.flush(); t.settle()
        assertEquals(listOf<Pair<DraftContent?, Long>>(null to 4L), t.writes)
        assertEquals(SyncedDraft(5, null), t.sync.synced)
    }

    @Test fun typingWhileAWriteIsInFlightIsWrittenAfterIt() = runTest {
        val t = Rig(scope = this)
        t.type("a"); t.advance(DRAFT_DEBOUNCE_MS)
        t.type("ab"); t.advance(DRAFT_DEBOUNCE_MS)
        assertEquals(listOf("a", "ab"), t.writes.map { it.first?.text })
        assertEquals(1L, t.writes[1].second)
    }

    @Test fun aPushIntoAnIdleComposerIsAppliedAndOfWhatItAlreadyShowsIsNot() = runTest {
        val t = Rig(draft("mine"), synced(1, draft("mine")), this)
        t.sync.pushed(entry(2, draft("mine")))
        assertEquals(emptyList<DraftContent?>(), t.applied)
        t.sync.pushed(entry(3, draft("from B", taskId = "T1")))
        assertEquals(listOf<DraftContent?>(draft("from B", taskId = "T1")), t.applied)
        assertEquals(3L, t.sync.synced.revision)
        // It is the remote draft now, so nothing is written back.
        t.advance(2000)
        assertEquals(0, t.writes.size)
        t.sync.pushed(entry(4, null))
        assertNull(t.applied.last())
    }

    @Test fun aPushWhileTheUserIsTypingWaitsForQuietThenApplies() = runTest {
        val t = Rig(draft("a"), synced(1, draft("a")), this)
        t.entry = entry(1, draft("a"))
        t.focused = true
        t.type("ab"); t.advance(DRAFT_DEBOUNCE_MS)
        assertEquals(2L, t.sync.synced.revision)
        t.entry = entry(3, draft("from B"))
        t.sync.pushed(entry(3, draft("from B")))
        assertEquals(emptyList<DraftContent?>(), t.applied)
        t.advance(DRAFT_TYPING_QUIET_MS)
        assertEquals(listOf<DraftContent?>(draft("from B")), t.applied)

        // Typing again before the wait is over: that text wins and is written on top.
        t.type("from B, edited"); t.advance(DRAFT_DEBOUNCE_MS)
        assertEquals(4L, t.sync.synced.revision)
        t.entry = entry(5, draft("C was here"))
        t.sync.pushed(entry(5, draft("C was here")))
        t.type("from B, edited more")
        t.advance(DRAFT_TYPING_QUIET_MS + DRAFT_DEBOUNCE_MS)
        assertEquals(1, t.applied.size)
        assertEquals("from B, edited more", t.entry?.content?.text)
    }

    @Test fun aRefusedWriteKeepsTheLocalTextAndSendsItOnTheNewRevision() = runTest {
        val t = Rig(draft("a"), synced(1, draft("a")), this)
        t.entry = entry(2, draft("B was faster"))
        t.type("a, and mine"); t.advance(DRAFT_DEBOUNCE_MS)
        assertEquals(listOf(draft("a, and mine") to 1L, draft("a, and mine") to 2L), t.writes)
        assertEquals(3L, t.entry?.revision)
        assertEquals("a, and mine", t.entry?.content?.text)
        assertEquals(emptyList<DraftContent?>(), t.applied)
    }

    @Test fun aPushForAComposerWithUnsyncedTextKeepsItAndWritesIt() = runTest {
        val t = Rig(draft("a"), synced(1, draft("a")), this)
        t.entry = entry(1, draft("a"))
        t.type("a plus")
        // B's write lands before A's debounce fires.
        t.entry = entry(2, draft("from B"))
        t.sync.pushed(entry(2, draft("from B")))
        t.advance(0)
        assertEquals(emptyList<DraftContent?>(), t.applied)
        assertEquals(3L, t.entry?.revision)
        assertEquals("a plus", t.entry?.content?.text)
    }

    @Test fun givesUpAfterRepeatedRefusalsUntilTheNextChangeOrPush() = runTest {
        val t = Rig(draft("a"), synced(1, draft("a")), this)
        t.alwaysRefuse = true
        t.type("b"); t.advance(DRAFT_DEBOUNCE_MS); t.advance(10_000)
        assertEquals(DRAFT_MAX_ATTEMPTS, t.writes.size)
        t.type("bc"); t.advance(DRAFT_DEBOUNCE_MS)
        assertEquals(DRAFT_MAX_ATTEMPTS * 2, t.writes.size)
        // The local text was never thrown away.
        assertEquals(emptyList<DraftContent?>(), t.applied)
        t.alwaysRefuse = false
        t.sync.pushed(entry(100, draft("settled")))
        t.advance(DRAFT_DEBOUNCE_MS)
        assertEquals("bc", t.entry?.content?.text)
    }

    @Test fun aFailedRequestIsRetriedLaterAndOfflineNothingIsWrittenAndTheCacheHasIt() = runTest {
        val t = Rig(scope = this)
        t.failNext = true
        t.type("typed offline-ish"); t.advance(DRAFT_DEBOUNCE_MS)
        assertEquals(1, t.writes.size)
        t.advance(DRAFT_RETRY_MS)
        assertEquals(2, t.writes.size)
        assertEquals("typed offline-ish", t.entry?.content?.text)

        val offline = Rig(scope = this)
        offline.available = false
        offline.type("no network"); offline.advance(10_000)
        assertEquals(0, offline.writes.size)
        assertEquals("no network", offline.persisted.last().first?.text)
        // The connection comes back: the text typed meanwhile goes up.
        offline.available = true
        offline.sync.connectionChanged(); offline.advance(0)
        assertEquals("no network", offline.entry?.content?.text)
    }

    @Test fun aRefusalForGoodIsNotRetried() = runTest {
        val t = Rig(scope = this)
        t.rejectNext = true
        t.type("refused"); t.advance(DRAFT_DEBOUNCE_MS); t.advance(30_000)
        assertEquals(1, t.writes.size)
        // The next change tries again.
        t.type("refused, shorter"); t.advance(DRAFT_DEBOUNCE_MS)
        assertEquals(2, t.writes.size)
    }

    @Test fun onConnectAnUntouchedCacheTakesTheBackendsDraftAnEditedOneIsPushedAClearMadeOfflineStaysCleared() = runTest {
        val fresh = Rig(scope = this)
        fresh.entry = entry(5, draft("from B"))
        fresh.sync.connectionChanged()
        assertEquals(listOf<DraftContent?>(draft("from B")), fresh.applied)

        val edited = Rig(draft("old plus offline"), synced(5, draft("old")), this)
        edited.entry = entry(5, draft("old"))
        edited.sync.connectionChanged(); edited.advance(0)
        assertEquals(6L, edited.entry?.revision)
        assertEquals("old plus offline", edited.entry?.content?.text)
        assertEquals(emptyList<DraftContent?>(), edited.applied)

        val cleared = Rig(draft(""), synced(5, draft("old")), this)
        cleared.entry = entry(5, draft("old"))
        cleared.sync.connectionChanged(); cleared.advance(0)
        assertEquals(6L, cleared.entry?.revision)
        assertNull(cleared.entry?.content)
        assertEquals(emptyList<DraftContent?>(), cleared.applied)

        // Offline edits against a draft B changed meanwhile: the local text wins (the later writer).
        val both = Rig(draft("mine"), synced(5, draft("old")), this)
        both.entry = entry(7, draft("B's"))
        both.sync.connectionChanged(); both.advance(0)
        assertEquals(8L, both.entry?.revision)
        assertEquals("mine", both.entry?.content?.text)
    }

    @Test fun aDraftTooBigForTheBackendStaysOnTheDevice() = runTest {
        val t = Rig(scope = this)
        t.type("x".repeat(100_001)); t.advance(DRAFT_DEBOUNCE_MS * 3)
        assertEquals(0, t.writes.size)
        assertEquals(100_001, t.persisted.last().first?.text?.length)
    }

    @Test fun sendThenTheServersOwnClearIsANoOpForTheSender() = runTest {
        val t = Rig(draft("sent"), synced(1, draft("sent")), this)
        t.entry = entry(1, draft("sent"))
        t.sync.changed(draft(""))
        t.sync.flush(); t.settle()
        // The server cleared on submit (revision 2) at the same moment; the push arrives after the writer's own clear.
        t.sync.pushed(entry(2, null))
        assertEquals(emptyList<DraftContent?>(), t.applied)
        assertNull(t.sync.synced.content)
    }

    @Test fun afterDestroyALastWriteGoesOutAndNothingComesBack() = runTest {
        val t = Rig(scope = this)
        t.type("leaving")
        val persisted = t.persisted.size
        t.sync.destroy(); t.settle()
        assertEquals("leaving", t.entry?.content?.text)
        assertEquals(persisted, t.persisted.size)
        t.sync.pushed(entry(9, draft("late")))
        assertEquals(emptyList<DraftContent?>(), t.applied)
        t.sync.changed(draft("again")); t.advance(5000)
        assertEquals(1, t.writes.size)
    }
}
