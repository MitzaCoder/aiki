package com.mihaisaru.harness.features.panels

import com.mihaisaru.harness.features.chat.ChatArtifactMetadata
import com.mihaisaru.harness.navigation.Destination
import com.mihaisaru.harness.protocol.Artifact

/** A filtered tile may be older than the viewer's 500-item window: stage its full metadata first. */
internal fun stageArtifactDestination(route: Destination.Chat, artifact: Artifact): Destination.Artifact {
    require(route.projectId == artifact.projectId) { "Artifact belongs to another project" }
    ChatArtifactMetadata.keep(route.backendKey, artifact)
    return Destination.Artifact(route.copy(threadId = artifact.threadId, workerId = artifact.workerId), artifact.id)
}
