package io.github.mitzacoder.kemiri.features.panels

import io.github.mitzacoder.kemiri.features.chat.ChatArtifactMetadata
import io.github.mitzacoder.kemiri.features.chat.artifactForViewing
import io.github.mitzacoder.kemiri.navigation.Destination
import io.github.mitzacoder.kemiri.protocol.Artifact
import org.junit.Assert.*
import org.junit.Test

class ArtifactNavigationTest {
    private val old = Artifact("filtered-old", "project", "proof.png", "Older proof", "Complete filtered metadata", "image", "image/png", 2456, 12.0, "research", "worker-1", "T9", "/scratch/proof.png", null, "2026-11-01T00:00:00Z")

    @Test fun filteredTileStagesFullMetadataBeyondSameOwnerRecentWindow() {
        val route = Destination.Chat("tile-window", "project", null, null)
        val recent = List(500) { old.copy(id = "recent-$it") }
        assertTrue(recent.none { it.id == old.id })
        assertEquals("file", artifactForViewing("project", old.id, recent).kind)
        assertNull(ChatArtifactMetadata.find(route.backendKey, "project", old.id))
        val destination = stageArtifactDestination(route, old)
        assertEquals(Destination.Artifact(route.copy(threadId = "research", workerId = "worker-1"), old.id), destination)
        assertEquals(old, ChatArtifactMetadata.find(route.backendKey, "project", old.id))
        assertNull(ChatArtifactMetadata.find("another-backend", "project", old.id))
        assertNull(ChatArtifactMetadata.find(route.backendKey, "another-project", old.id))
    }

    @Test fun mainOwnerClearsFilteredThreadAndWorker() {
        val main = old.copy(id = "main-filtered-old", threadId = "main", workerId = null)
        val route = Destination.Chat("tile-main", "project", "research", "worker-1")
        assertEquals(Destination.Artifact(route.copy(threadId = "main", workerId = null), main.id), stageArtifactDestination(route, main))
        assertEquals(main, ChatArtifactMetadata.find(route.backendKey, "project", main.id))
    }

    @Test fun wrongProjectCannotStageMetadata() {
        assertThrows(IllegalArgumentException::class.java) { stageArtifactDestination(Destination.Chat("tile-wrong-project", "other"), old) }
        assertNull(ChatArtifactMetadata.find("tile-wrong-project", "project", old.id))
    }
}
