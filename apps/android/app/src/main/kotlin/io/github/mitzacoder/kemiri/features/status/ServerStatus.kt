package io.github.mitzacoder.kemiri.features.status

import io.github.mitzacoder.kemiri.protocol.*
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import kotlin.math.roundToLong

/**
 * What the Backends screen and the chat read from a backend's `server.status`: the release it runs, a banner when the
 * last deploy needs attention, and how full its disks are. Ports of `packages/client` (`server-status.ts`,
 * `storage.ts`) and the web's `lib/server-status.ts`, with the same sentences; the composables only lay them out.
 */

const val SHORT_COMMIT_LENGTH = 7

/** How often an open chat reads `server.status` again, so a disk filling during a long run shows. */
const val SERVER_STATUS_REFRESH_MS = 5 * 60_000L

/** How many dismissed deploy attempts the device remembers. Deploys are rare, so a handful covers the open failures. */
const val MAX_DISMISSED_DEPLOYS = 20

/** JavaScript's `Number.prototype.toFixed`: rounds the double's exact binary value, so 14.385 reads "14.38" as on the web. */
fun toFixed(value: Double, digits: Int): String = java.math.BigDecimal(value).setScale(digits, java.math.RoundingMode.HALF_UP).toPlainString()

fun shortCommit(commit: String, length: Int = SHORT_COMMIT_LENGTH): String = commit.take(length.coerceAtLeast(1))

private fun parseInstant(at: String): Instant? = try { Instant.parse(at) } catch (_: java.time.DateTimeException) { null }

private fun localDate(at: Instant): String = DateTimeFormatter.ofLocalizedDate(FormatStyle.MEDIUM).withZone(ZoneId.systemDefault()).format(at)

/** The exact time behind a relative phrase, in the device's zone. */
fun exactTime(at: String): String = parseInstant(at)?.let {
    DateTimeFormatter.ofLocalizedDateTime(FormatStyle.MEDIUM).withZone(ZoneId.systemDefault()).format(it)
} ?: at

/** "just now", "5 min ago", "3 h ago", "2 d ago", then a date (web `relativeTime`). */
fun relativeTime(at: String, now: Long): String {
    val ms = parseInstant(at)?.toEpochMilli() ?: return "at an unknown time"
    val seconds = ((now - ms) / 1000.0).roundToLong()
    if (seconds < 45) return "just now"
    val minutes = (seconds / 60.0).roundToLong()
    if (minutes < 60) return "${minutes.coerceAtLeast(1)} min ago"
    val hours = (minutes / 60.0).roundToLong()
    if (hours < 24) return "$hours h ago"
    val days = (hours / 24.0).roundToLong()
    if (days < 30) return "$days d ago"
    return localDate(Instant.ofEpochMilli(ms))
}

/** Bytes in decimal units, as the web shows sizes: "512 B", "1.5 KB", "42 GB" (web `formatBytes`). */
fun formatBytes(bytes: Long): String {
    if (bytes < 0) return ""
    if (bytes < 1000) return "$bytes B"
    val units = listOf("KB", "MB", "GB", "TB")
    var value = bytes / 1000.0
    var unit = 0
    while (value >= 1000 && unit < units.lastIndex) { value /= 1000; unit++ }
    val number = if (value < 10) toFixed(value, 1).removeSuffix(".0") else value.roundToLong().toString()
    return "$number ${units[unit]}"
}

// --- release and deploy ------------------------------------------------------------------------------------------

/** The running release as one row: commit, description, when it was deployed, and the long version for a tap. */
data class ReleaseView(
    val commit: String,
    val description: String,
    val `when`: String,
    val title: String,
    /** "a1b2c3d deployed, backend unchanged since be84355" when the last deploy left this backend on its release. */
    val unchanged: String? = null,
)

fun releaseView(release: ReleaseInfo, now: Long, deploy: DeployStatus? = null): ReleaseView {
    val commit = shortCommit(release.commit)
    return ReleaseView(
        commit = commit,
        description = release.description,
        `when` = relativeTime(release.deployedAt, now),
        title = "${release.name}\n${release.commit}\n${release.description}\nDeployed ${exactTime(release.deployedAt)}",
        unchanged = if (deploy?.state == "ok" && deploy.backendUnchanged && deploy.commit != release.commit) {
            "${shortCommit(deploy.commit)} deployed, backend unchanged since $commit"
        } else null,
    )
}

enum class DeployProblemKind { Failed, RolledBack, UnexpectedRelease }

/** The last deploy when it needs attention, and the release still running (null for a checkout). */
data class DeployProblem(val kind: DeployProblemKind, val deploy: DeployStatus, val running: ReleaseInfo?)

/**
 * Why the last deploy needs attention, or null. A checkout has no release commit to compare with, so only an explicit
 * failure or rollback is a problem there; an `ok` deploy that left the backend unchanged keeps the older release on purpose.
 */
fun deployProblem(status: ServerStatus?): DeployProblem? {
    val deploy = status?.deploy ?: return null
    if (deploy.state == "failed") return DeployProblem(DeployProblemKind.Failed, deploy, status.release)
    if (deploy.state == "rolled_back") return DeployProblem(DeployProblemKind.RolledBack, deploy, status.release)
    if (status.release != null && status.release.commit != deploy.commit && !deploy.backendUnchanged) {
        return DeployProblem(DeployProblemKind.UnexpectedRelease, deploy, status.release)
    }
    return null
}

/** One deploy attempt: a new attempt gets a new key, so dismissing one failure does not hide the next. */
fun deployAttemptKey(deploy: DeployStatus): String = "${deploy.commit}@${deploy.at}"

enum class BannerTone { Error, Warning }

data class DeployBannerView(
    val tone: BannerTone,
    val title: String,
    val commit: String,
    val description: String,
    val `when`: String,
    val detail: String,
    val note: String,
)

private fun runningNote(running: ReleaseInfo?): String =
    if (running == null) "This backend runs from a checkout, so no release was published."
    else "The previous release is still running: ${shortCommit(running.commit)} ${running.description}".trim()

fun deployBanner(problem: DeployProblem, now: Long): DeployBannerView {
    val commit = shortCommit(problem.deploy.commit)
    val description = problem.deploy.description
    val `when` = relativeTime(problem.deploy.at, now)
    return when (problem.kind) {
        DeployProblemKind.Failed -> DeployBannerView(BannerTone.Error, "Deploy failed", commit, description, `when`,
            problem.deploy.message ?: "The deploy failed before it published anything.", runningNote(problem.running))
        DeployProblemKind.RolledBack -> DeployBannerView(BannerTone.Warning, "Deploy rolled back", commit, description, `when`,
            problem.deploy.message ?: "The new release failed its health check after the restart.", runningNote(problem.running))
        DeployProblemKind.UnexpectedRelease -> DeployBannerView(BannerTone.Warning, "Release does not match the last deploy", commit, description, `when`,
            "The last deploy reports $commit as deployed, but this backend runs ${problem.running?.let { shortCommit(it.commit) } ?: "a checkout"}.",
            "Dismiss this once you know whether the running release or the deploy record is the stale one.")
    }
}

fun isDeployDismissed(dismissed: List<String>, deploy: DeployStatus): Boolean = deployAttemptKey(deploy) in dismissed

/** The list after dismissing one attempt, newest last; dismissing twice keeps one entry. */
fun addDismissedDeploy(dismissed: List<String>, deploy: DeployStatus, limit: Int = MAX_DISMISSED_DEPLOYS): List<String> {
    val key = deployAttemptKey(deploy)
    return (dismissed.filter { it != key } + key).takeLast(limit.coerceAtLeast(1))
}

// --- disks -------------------------------------------------------------------------------------------------------

enum class DiskLevel { Ok, Tight, Low }

/** Below this share of free space a disk reads tight before the server calls it low. */
const val DISK_TIGHT_FREE_SHARE = 0.3

fun diskLevel(disk: DiskStatus): DiskLevel = when {
    disk.low -> DiskLevel.Low
    disk.totalBytes > 0 && disk.freeBytes.toDouble() / disk.totalBytes < DISK_TIGHT_FREE_SHARE -> DiskLevel.Tight
    else -> DiskLevel.Ok
}

fun serverDisks(status: ServerStatus?): List<DiskStatus> = status?.disks.orEmpty()
fun lowDisks(status: ServerStatus?): List<DiskStatus> = serverDisks(status).filter { it.low }

/** One filesystem on the machine line: "Data 42 GB free of 512 GB"; [title] is the path and the share free. */
data class DiskView(val label: String, val text: String, val level: DiskLevel, val title: String)

fun diskView(disk: DiskStatus): DiskView {
    val share = if (disk.totalBytes <= 0) "" else "${(100.0 * disk.freeBytes / disk.totalBytes).roundToLong()}% free"
    return DiskView(disk.label, "${formatBytes(disk.freeBytes)} free of ${formatBytes(disk.totalBytes)}", diskLevel(disk),
        if (share.isEmpty()) disk.path else "${disk.path} · $share")
}

/** The short warning while a disk is low: which filesystems and what will go wrong. The harness warns, never blocks. */
fun diskWarning(status: ServerStatus?): String? {
    val low = lowDisks(status)
    if (low.isEmpty()) return null
    val names = low.joinToString(", ") { "${it.label} (${formatBytes(it.freeBytes)} free)" }
    return "$names ${if (low.size == 1) "is" else "are"} low on space. Builds and new workspaces may fail."
}
