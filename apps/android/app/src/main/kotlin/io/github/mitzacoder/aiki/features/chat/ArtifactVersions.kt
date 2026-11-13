package io.github.mitzacoder.aiki.features.chat

import io.github.mitzacoder.aiki.protocol.Artifact

/** Cache/playback identity changes with bytes, while cards and task references keep their stable ID. */
internal fun artifactVersionAddress(artifact: Artifact): String =
    if (artifact.version != null && !artifact.id.contains("~")) "${artifact.id}~${artifact.version}" else artifact.id

/** Retained metadata with immutable version addresses; legacy backends still expose one snapshot. */
internal fun artifactVersions(artifact: Artifact): List<Artifact> = artifact.versions?.map { snapshot ->
    Artifact(id = snapshot.id, projectId = snapshot.projectId, name = snapshot.name, title = snapshot.title,
        note = snapshot.note, kind = snapshot.kind, mimeType = snapshot.mimeType, size = snapshot.size,
        durationSeconds = snapshot.durationSeconds, threadId = snapshot.threadId, workerId = snapshot.workerId,
        taskId = snapshot.taskId, sourcePath = snapshot.sourcePath, tags = snapshot.tags, createdAt = snapshot.createdAt,
        version = snapshot.version, versionCount = artifact.versionCount ?: artifact.version ?: 1)
}?.takeIf { it.isNotEmpty() } ?: listOf(artifact)

internal fun selectedArtifactVersion(artifact: Artifact, version: Long?): Artifact =
    artifactVersions(artifact).let { retained -> retained.find { it.version == version } ?: retained.last() }

internal fun artifactVersionCount(artifact: Artifact): String =
    (artifact.versionCount ?: 1).takeIf { it > 1 }?.let { "$it versions" }.orEmpty()
