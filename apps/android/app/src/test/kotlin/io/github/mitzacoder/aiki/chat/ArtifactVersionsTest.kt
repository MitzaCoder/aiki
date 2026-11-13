package io.github.mitzacoder.aiki.features.chat

import io.github.mitzacoder.aiki.protocol.Artifact
import io.github.mitzacoder.aiki.protocol.ArtifactVersion
import kotlinx.serialization.json.Json
import org.junit.Assert.*
import org.junit.Test

class ArtifactVersionsTest {
    private val legacy = Artifact(id = "a", projectId = "p", name = "report.html", title = null, note = null, kind = "text",
        mimeType = "text/html", size = 12, durationSeconds = null, threadId = "main", workerId = null, taskId = "T1", sourcePath = "", createdAt = "")
    private fun snapshot(number: Long) = ArtifactVersion(id = "a~$number", projectId = "p", name = "report.html", title = "Draft $number",
        note = "Note $number", kind = "text", mimeType = "text/html", size = number, durationSeconds = null, threadId = "main",
        workerId = "worker-$number", taskId = "T1", sourcePath = "", createdAt = "2026-01-01T00:00:00Z", version = number)
    private val versioned get() = legacy.copy(version = 23, versionCount = 23, versions = listOf(snapshot(4), snapshot(22), snapshot(23)))

    @Test fun cacheAndPlaybackIdentityFollowsVersionBytes() {
        assertEquals("a", artifactVersionAddress(legacy))
        assertEquals("a~23", artifactVersionAddress(versioned))
        assertEquals("a~4", artifactVersionAddress(selectedArtifactVersion(versioned, 4)))
    }
    @Test fun oldMetadataKeepsItsBareId() {
        assertEquals(listOf(legacy), artifactVersions(legacy))
        assertEquals(legacy, selectedArtifactVersion(legacy, null))
        assertEquals("", artifactVersionCount(legacy))
    }
    @Test fun defaultsToLatestAndUsesRetainedNumbersNotPositions() {
        assertEquals("a~23", selectedArtifactVersion(versioned, null).id)
        val selected = selectedArtifactVersion(versioned, 4)
        assertEquals("a~4", selected.id)
        assertEquals("Note 4", selected.note)
        assertEquals("worker-4", selected.workerId)
        assertEquals(23L, selected.versionCount)
        assertEquals("a~23", selectedArtifactVersion(versioned, 1).id)
        assertEquals("23 versions", artifactVersionCount(selected))
        assertTrue(artifactFacts(versioned).contains("23 versions"))
    }
    @Test fun protocolRoundTripsSnapshotsAndAcceptsAbsentVersionMetadata() {
        assertEquals(versioned, Json.decodeFromString<Artifact>(Json.encodeToString(Artifact.serializer(), versioned)))
        val oldJson = Json.encodeToString(Artifact.serializer(), legacy)
        assertFalse(oldJson.contains("versions"))
        assertEquals(legacy, Json.decodeFromString<Artifact>(oldJson))
    }
}
