package io.github.mitzacoder.aiki.features.chat

import io.github.mitzacoder.aiki.protocol.Artifact
import org.junit.Assert.assertEquals
import org.junit.Test

/** The web's `apps/web/test/artifacts.test.ts` vectors for the labels the thumbnails, lists and viewer share. */
class ArtifactLabelsTest {
    private fun artifact(id: String = "a1", kind: String = "video", threadId: String = "main", workerId: String? = null) =
        Artifact(id = id, projectId = "p1", name = "demo.webm", title = null, note = null, kind = kind, mimeType = "video/webm", size = 1000,
            durationSeconds = null, threadId = threadId, workerId = workerId, taskId = null, sourcePath = "", createdAt = "")

    @Test fun sizesAndLengths() {
        assertEquals("820 B", artifactDetailSize(820))
        assertEquals("14 KB", artifactDetailSize(14_200))
        assertEquals("3.2 MB", artifactDetailSize(3_240_000))
        assertEquals("2 MB", artifactDetailSize(2_000_000))
        assertEquals(null, artifactDetailSize(-1))
        assertEquals("0:07", formatMediaDuration(7.4))
        assertEquals("12:30", formatMediaDuration(750.0))
        assertEquals("1:02:03", formatMediaDuration(3723.0))
        assertEquals("", formatMediaDuration(null))
    }

    @Test fun whoSavedIt() {
        assertEquals("Main", savedByLabel(artifact()))
        assertEquals("Thread jira", savedByLabel(artifact(threadId = "jira")))
        assertEquals("Worker w3 of main", savedByLabel(artifact(workerId = "w3")))
        assertEquals("Worker w1 of thread jira", savedByLabel(artifact(threadId = "jira", workerId = "w1")))
    }

    @Test fun theKindFromAFileName() {
        assertEquals("video", kindFromName("a.MP4"))
        assertEquals("image", kindFromName("shot.png"))
        assertEquals("audio", kindFromName("voice.opus"))
        assertEquals("text", kindFromName("run.log"))
        assertEquals("file", kindFromName("bundle.zip"))
        assertEquals("file", kindFromName("README"))
    }

    @Test fun countsAndNarrowsByKind() {
        val list = listOf(artifact("1"), artifact("2", kind = "image"), artifact("3"))
        assertEquals(listOf("video" to 2, "image" to 1), artifactKindCounts(list))
        assertEquals(listOf("2"), filterByKind(list, "image").map { it.id })
        assertEquals(list, filterByKind(list, null))
        assertEquals("Videos", artifactKindLabel("video", plural = true))
        assertEquals("Image", artifactKindLabel("image"))
        assertEquals("Text", artifactKindLabel("text", plural = true))
    }

    @Test fun titleFallsBackToTheName() {
        assertEquals("demo.webm", artifactTitle(artifact().copy(title = "  ")))
        assertEquals("Checkout", artifactTitle(artifact().copy(title = " Checkout ")))
    }

    @Test fun groupsTheArtifactsByTaskNewestFirst() {
        fun saved(id: String, taskId: String?, at: String) = artifact(id).copy(taskId = taskId, createdAt = at)
        val groups = artifactsByTask(listOf(saved("a", "T1", "2026-11-07T10:00:00Z"), saved("b", null, "2026-11-07T11:00:00Z"),
            saved("c", "T2", "2026-11-07T12:00:00Z"), saved("d", "T1", "2026-11-07T13:00:00Z")))
        assertEquals(mapOf("T1" to listOf("d", "a"), "T2" to listOf("c")), groups.mapValues { (_, items) -> items.map { it.id } })
    }
}
