package io.github.mitzacoder.kemiri.features.panels

import io.github.mitzacoder.kemiri.features.chat.ChatArtifactMetadata
import io.github.mitzacoder.kemiri.navigation.Destination
import io.github.mitzacoder.kemiri.protocol.Artifact

/** A filtered tile may be older than the viewer's 500-item window: stage its full metadata first. */
internal fun stageArtifactDestination(route: Destination.Chat, artifact: Artifact): Destination.Artifact {
    require(route.projectId == artifact.projectId) { "Artifact belongs to another project" }
    ChatArtifactMetadata.keep(route.backendKey, artifact)
    return Destination.Artifact(route.copy(threadId = artifact.threadId, workerId = artifact.workerId), artifact.id)
}
