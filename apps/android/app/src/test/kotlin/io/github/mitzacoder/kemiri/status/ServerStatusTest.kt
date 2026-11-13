package io.github.mitzacoder.kemiri.status

import io.github.mitzacoder.kemiri.features.status.*
import io.github.mitzacoder.kemiri.protocol.*
import org.junit.Assert.*
import org.junit.Test

/** Mirrors apps/web/test/server-status.test.ts (and packages/client's storage disks) for features/status. */
class ServerStatusTest {
    private val now = java.time.Instant.parse("2026-10-31T12:00:00Z").toEpochMilli()

    private fun release(commit: String = "be84355c5bed5b9bcb2f0a8e4f4b9a0f2f6c1d2e", description: String = "feat: give the harness its own SYSTEM.md and APPEND_SYSTEM.md") =
        ReleaseInfo(name = "20261030T113815Z-be84355", commit = commit, description = description, deployedAt = "2026-10-31T11:38:15Z")

    private fun deploy(state: String = "ok", commit: String = "be84355c5bed5b9bcb2f0a8e4f4b9a0f2f6c1d2e", description: String = "feat: give the harness its own SYSTEM.md and APPEND_SYSTEM.md",
                       message: String? = null, at: String = "2026-10-31T11:39:02Z", backendUnchanged: Boolean = true) =
        DeployStatus(state = state, commit = commit, description = description, message = message, at = at, backendUnchanged = backendUnchanged)

    private fun status(release: ReleaseInfo? = release(), deploy: DeployStatus? = deploy(), disks: List<DiskStatus>? = null) =
        ServerStatus(release = release, deploy = deploy, busy = ServerStatusBusy(conversations = 0, workers = 0), startedAt = "2026-10-31T11:38:20Z", disks = disks)

    private fun problem(deploy: DeployStatus, running: ReleaseInfo? = release()) = deployProblem(status(running, deploy)) ?: error("expected a deploy problem")

    @Test fun relativeTimeCountsMinutesHoursAndDaysThenShowsADate() {
        assertEquals("just now", relativeTime("2026-10-31T12:00:00Z", now))
        assertEquals("just now", relativeTime("2026-10-31T11:59:30Z", now))
        assertEquals("5 min ago", relativeTime("2026-10-31T11:55:00Z", now))
        assertEquals("3 h ago", relativeTime("2026-10-31T09:00:00Z", now))
        assertEquals("2 d ago", relativeTime("2026-10-29T12:00:00Z", now))
        assertTrue(relativeTime("2026-08-01T12:00:00Z", now).contains("2026"))
        assertEquals("at an unknown time", relativeTime("not a time", now))
    }

    @Test fun releaseShowsTheShortCommitItsDescriptionAndWhen() {
        val view = releaseView(release(), now)
        assertEquals("be84355", view.commit)
        assertEquals("feat: give the harness its own SYSTEM.md and APPEND_SYSTEM.md", view.description)
        assertEquals("22 min ago", view.`when`)
        assertTrue(view.title.contains("be84355c5bed5b9bcb2f0a8e4f4b9a0f2f6c1d2e"))
    }

    @Test fun releaseNotesANewerDeployThatLeftTheBackendUnchanged() {
        val unchanged = deploy(commit = "a1b2c3d4e5f6", description = "feat(web): a web-only change", at = "2026-10-31T11:50:00Z", backendUnchanged = true)
        assertEquals("a1b2c3d deployed, backend unchanged since be84355", releaseView(release(), now, unchanged).unchanged)
        assertNull(releaseView(release(), now, unchanged.copy(backendUnchanged = false)).unchanged)
        assertNull(releaseView(release(), now, null).unchanged)
    }

    @Test fun aFailedDeployNamesTheCommitItsMessageAndTheReleaseStillRunning() {
        val view = deployBanner(problem(deploy(state = "failed", commit = "1111111aaaa", description = "feat(web): show deploys", message = "checks failed: typecheck")), now)
        assertEquals(BannerTone.Error, view.tone)
        assertEquals("Deploy failed", view.title)
        assertEquals("1111111", view.commit)
        assertEquals("feat(web): show deploys", view.description)
        assertEquals("checks failed: typecheck", view.detail)
        assertTrue(view.note.contains("The previous release is still running"))
        assertTrue(view.note.contains("be84355"))
    }

    @Test fun aRolledBackDeployFallsBackToItsOwnExplanation() {
        val view = deployBanner(problem(deploy(state = "rolled_back")), now)
        assertEquals(BannerTone.Warning, view.tone)
        assertEquals("Deploy rolled back", view.title)
        assertTrue(view.detail.contains("health check"))
        assertTrue(view.note.contains("still running"))
    }

    @Test fun anOkDeployForAnotherCommitIsFlaggedUnlessTheBackendWasUnchanged() {
        val view = deployBanner(problem(deploy(commit = "2222222bbbb", backendUnchanged = false), release("3333333cccc", "fix: something else")), now)
        assertEquals(BannerTone.Warning, view.tone)
        assertEquals("Release does not match the last deploy", view.title)
        assertTrue(view.detail.contains("2222222"))
        assertTrue(view.detail.contains("3333333"))
        assertNull(deployProblem(status(release("3333333cccc"), deploy(commit = "2222222bbbb", backendUnchanged = true))))
        assertNull(deployProblem(status()))
        assertNull(deployProblem(null))
    }

    @Test fun aCheckoutSaysNoReleaseWasPublished() {
        val view = deployBanner(problem(deploy(state = "failed"), null), now)
        assertEquals("The deploy failed before it published anything.", view.detail)
        assertTrue(view.note.contains("checkout"))
        assertNull(deployProblem(status(null, deploy(commit = "other"))))
    }

    @Test fun aDismissalBelongsToOneAttempt() {
        val dismissed = addDismissedDeploy(emptyList(), deploy())
        assertTrue(isDeployDismissed(dismissed, deploy()))
        assertFalse(isDeployDismissed(dismissed, deploy(at = "2026-10-31T13:00:00Z")))
        assertFalse(isDeployDismissed(dismissed, deploy(commit = "4444444dddd")))
        assertEquals(dismissed, addDismissedDeploy(dismissed, deploy()))
        val next = addDismissedDeploy(dismissed, deploy(at = "2026-10-31T13:00:00Z"))
        assertEquals(2, next.size)
        assertTrue(next.last().contains("2026-10-31T13:00:00Z"))
        var keys = emptyList<String>()
        repeat(MAX_DISMISSED_DEPLOYS + 5) { keys = addDismissedDeploy(keys, deploy(at = "t-$it")) }
        assertEquals(MAX_DISMISSED_DEPLOYS, keys.size)
        assertTrue(keys.last().endsWith("-24"))
    }

    @Test fun disksReadOkTightOrLowWithAWarningOnlyWhenLow() {
        val data = DiskStatus(label = "Data", path = "/var/lib", freeBytes = 42_000_000_000, totalBytes = 512_000_000_000, low = false)
        assertEquals(DiskLevel.Tight, diskLevel(data))
        assertEquals(DiskLevel.Ok, diskLevel(data.copy(freeBytes = 300_000_000_000)))
        assertEquals(DiskLevel.Low, diskLevel(data.copy(low = true)))
        assertEquals(DiskView("Data", "42 GB free of 512 GB", DiskLevel.Tight, "/var/lib · 8% free"), diskView(data))
        assertNull(diskWarning(status(disks = listOf(data))))
        assertNull(diskWarning(status(disks = null)))
        assertEquals("Data (1.5 GB free) is low on space. Builds and new workspaces may fail.",
            diskWarning(status(disks = listOf(data.copy(freeBytes = 1_500_000_000, low = true)))))
        assertEquals("Data (1 GB free), Home (500 MB free) are low on space. Builds and new workspaces may fail.",
            diskWarning(status(disks = listOf(data.copy(freeBytes = 1_000_000_000, low = true), data.copy(label = "Home", freeBytes = 500_000_000, low = true)))))
    }

    @Test fun bytesReadInDecimalUnits() {
        assertEquals("512 B", formatBytes(512))
        assertEquals("1.5 KB", formatBytes(1500))
        assertEquals("3 GB", formatBytes(3_000_000_000))
        assertEquals("42 GB", formatBytes(42_000_000_000))
        assertEquals("1.2 MB", formatBytes(1_200_000))
    }
}
