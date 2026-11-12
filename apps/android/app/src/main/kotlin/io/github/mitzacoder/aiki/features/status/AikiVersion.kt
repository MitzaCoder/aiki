package io.github.mitzacoder.aiki.features.status

import io.github.mitzacoder.aiki.protocol.ServerStatus

fun versionLabel(version: String): String =
    if (Regex("^v?\\d+\\.\\d+\\.\\d+.*").matches(version)) "v${version.removePrefix("v")}" else version

/** Status knows the running release; hello alone only knows the protocol package version. */
fun backendVersion(helloVersion: String?, status: ServerStatus?): String? {
    status?.updates?.takeIf { it.schemaVersion == 1L }?.installedVersion?.takeIf { it.isNotBlank() }?.let { return versionLabel(it) }
    status?.release?.let { release ->
        return if (Regex("^v?\\d+\\.\\d+\\.\\d+(?:-[\\w.-]+)?$").matches(release.name)) versionLabel(release.name) else release.commit.take(7)
    }
    if (status != null) return "dev"
    return helloVersion?.takeIf { it.isNotBlank() }?.let(::versionLabel)
}

fun aikiVersionLabel(helloVersion: String?, status: ServerStatus?): String {
    val identity = backendVersion(helloVersion, status)?.let { "Aiki $it" } ?: "Aiki"
    val update = status?.updates?.takeIf(::visibleReleaseUpdate)?.available
    return if (update != null) "$identity → ${versionLabel(update.version)} available" else identity
}
