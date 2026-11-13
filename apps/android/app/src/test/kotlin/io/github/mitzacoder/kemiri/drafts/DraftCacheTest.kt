package io.github.mitzacoder.kemiri.drafts

import io.github.mitzacoder.kemiri.data.DraftCacheState
import io.github.mitzacoder.kemiri.features.chat.DRAFT_MAX_AGE_MS
import io.github.mitzacoder.kemiri.features.chat.SyncedDraft
import io.github.mitzacoder.kemiri.protocol.DraftAttachment
import io.github.mitzacoder.kemiri.protocol.DraftContent
import org.junit.Assert.*
import org.junit.Test

private fun d(text: String, quotes: List<String> = emptyList(), taskId: String? = null, attachments: List<DraftAttachment>? = null) =
    DraftContent(text = text, taskId = taskId, quotes = quotes, attachments = attachments)

/** Mirrors the cache part of apps/web/test/drafts.test.ts. */
class DraftCacheTest {
    private val t0 = 1_000_000_000_000L

    @Test fun restoresTextTaskAndQuotesPerChat() {
        val cache = DraftCacheState()
        cache.save("a|p|main", d("hello", listOf("q1"), "T1"), SyncedDraft(), t0)
        cache.save("a|p|t", d("thread"), SyncedDraft(), t0)
        assertEquals(d("hello", listOf("q1"), "T1"), cache.load("a|p|main", t0).draft)
        assertEquals("thread", cache.load("a|p|t", t0).draft?.text)
        assertNull(cache.load("b|p|main", t0).draft)
    }

    @Test fun anEmptySaveRemovesAndATaskOrQuoteAloneIsADraft() {
        val cache = DraftCacheState()
        cache.save("x", d("1"), SyncedDraft(), t0)
        assertNull(cache.save("x", d("  "), SyncedDraft(), t0))
        assertNull(cache.load("x", t0).draft)
        cache.save("y", d("", taskId = "T2"), SyncedDraft(), t0)
        cache.save("z", d("", quotes = listOf("q")), SyncedDraft(), t0)
        assertEquals("T2", cache.load("y", t0).draft?.taskId)
        assertEquals(listOf("q"), cache.load("z", t0).draft?.quotes)
    }

    @Test fun draftsOlderThanThirtyDaysAreDroppedOnReadAndOnWrite() {
        val cache = DraftCacheState()
        cache.save("old", d("stale"), SyncedDraft(), t0)
        assertEquals("stale", cache.load("old", t0 + DRAFT_MAX_AGE_MS - 1).draft?.text)
        assertNull(cache.load("old", t0 + DRAFT_MAX_AGE_MS + 1).draft)
        cache.save("new", d("fresh"), SyncedDraft(), t0 + DRAFT_MAX_AGE_MS + 1)
        assertNull(cache.load("old", t0).draft)
    }

    @Test fun remembersTheRevisionAndContentLastSyncedAndKeepsAnEmptyDraftWhileTheBackendStillHoldsOne() {
        val cache = DraftCacheState()
        cache.save("x", d("ab"), SyncedDraft(4, d("a")), t0)
        assertEquals(SyncedDraft(4, d("a")), cache.load("x", t0).synced)
        // Cleared offline: the empty draft stays so the clear is pushed later.
        cache.save("x", d(""), SyncedDraft(4, d("old")), t0)
        assertNull(cache.load("x", t0).draft)
        assertEquals(SyncedDraft(4, d("old")), cache.load("x", t0).synced)
        // Once synced as empty there is nothing left to keep.
        assertNull(cache.save("x", d(""), SyncedDraft(5, null), t0))
        assertEquals(SyncedDraft(0, null), cache.load("x", t0).synced)
    }

    @Test fun attachmentsFromAnotherDeviceSurviveARoundTrip() {
        val cache = DraftCacheState()
        val attachments = listOf(DraftAttachment(id = "a".repeat(64), mimeType = "image/png", size = 3))
        cache.save("x", d("", attachments = attachments), SyncedDraft(), t0)
        assertEquals(attachments, cache.load("x", t0).draft?.attachments)
    }
}
