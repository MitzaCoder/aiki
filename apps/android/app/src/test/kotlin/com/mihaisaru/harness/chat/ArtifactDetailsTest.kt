package com.mihaisaru.harness.features.chat

import org.junit.Assert.*
import org.junit.Test

class ArtifactDetailsTest {
    @Test fun sizesHideUnknownAndUseReadableUnits() {
        assertEquals(null, artifactDetailSize(-1))
        assertEquals("0 B", artifactDetailSize(0))
        assertEquals("1 KB", artifactDetailSize(1024))
        assertEquals("1.6 MB", artifactDetailSize(1572864))
        assertEquals("307 KB", artifactDetailSize(306_826))
    }
    @Test fun datesHideInvalidAndNeverExposeRawIso() {
        assertNull(artifactDetailTime(""))
        assertNull(artifactDetailTime("bad date"))
        assertFalse(artifactDetailTime("2026-11-05T12:30:00Z")!!.contains("T12:"))
    }
    @Test fun previewKeepsLiteralTextAndEnforcesByteBoundary() {
        assertEquals("# not rendered\n<code>", artifactPreviewText("# not rendered\n<code>".toByteArray()))
        assertEquals(ARTIFACT_TEXT_LIMIT, artifactPreviewText(ByteArray(ARTIFACT_TEXT_LIMIT) { 97 }).length)
        assertThrows(IllegalArgumentException::class.java) { artifactPreviewText(ByteArray(ARTIFACT_TEXT_LIMIT + 1)) }
    }
    @Test fun factsReadLikeTheWebDialog() {
        val item = com.mihaisaru.harness.protocol.Artifact("a", "p", "log.txt", null, null, "text", "text/plain", 34, null, "research", "worker-1", "T1", "/scratch/log.txt", null, "")
        assertEquals("Text · 34 B · Worker worker-1 of thread research · for T1", artifactDetailFacts(item))
        assertEquals("Text · Main", artifactDetailFacts(item.copy(size = -1, threadId = "main", workerId = null, taskId = null)))
        val video = item.copy(kind = "video", size = 306_826, durationSeconds = 20.0, threadId = "main", workerId = null, taskId = "T2", createdAt = "2026-11-07T02:08:00Z")
        val now = java.time.Instant.parse("2026-11-07T02:32:00Z").toEpochMilli()
        assertEquals("Video · 0:20 · 307 KB · Main · for T2 · 24 min ago", artifactDetailFacts(video, now))
        assertFalse(artifactDetailFacts(video, now, exact = true).contains("ago"))
    }
    @Test fun saveTargetSurvivesRecreationWithoutLoadedMetadata() {
        // Only stable route IDs are required; metadata may still be loading after recreation.
        assertTrue(artifactSaveTargetMatches("b", "p", "a", "b", "p", "a", true))
        assertFalse(artifactSaveTargetMatches("b", "p", "a", "other", "p", "a", true))
        assertFalse(artifactSaveTargetMatches("b", "p", "a", "b", "other", "a", true))
        assertFalse(artifactSaveTargetMatches("b", "p", "a", "b", "p", "other", true))
    }
    @Test fun saveTargetRejectsMissingIdentityAndDeletion() {
        assertFalse(artifactSaveTargetMatches(null, "p", "a", "b", "p", "a", true))
        assertFalse(artifactSaveTargetMatches("b", null, "a", "b", "p", "a", true))
        assertFalse(artifactSaveTargetMatches("b", "p", null, "b", "p", "a", true))
        assertFalse(artifactSaveTargetMatches("b", "p", "a", "b", "p", "a", false))
    }
    @Test fun deletionRequiresExplicitConfirmationAndNeverReplays() {
        assertFalse(ArtifactDeleteState.Idle.canSubmit(true))
        assertFalse(ArtifactDeleteState.Confirming.canSubmit(false))
        assertTrue(ArtifactDeleteState.Confirming.canSubmit(true))
        assertFalse(ArtifactDeleteState.Sending.canSubmit(true))
        assertFalse(ArtifactDeleteState.Gone.canSubmit(true))
        assertEquals(ArtifactDeleteState.Idle, ArtifactDeleteState.Confirming.cancel())
        assertEquals(ArtifactDeleteState.Sending, ArtifactDeleteState.Sending.cancel())
    }
}
