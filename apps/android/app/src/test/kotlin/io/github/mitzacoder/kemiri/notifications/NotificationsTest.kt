package io.github.mitzacoder.kemiri.notifications

import io.github.mitzacoder.kemiri.features.settings.*
import io.github.mitzacoder.kemiri.data.BackendConfig
import io.github.mitzacoder.kemiri.data.DeviceSettings
import io.github.mitzacoder.kemiri.data.wireJson
import io.github.mitzacoder.kemiri.features.notifications.*
import io.github.mitzacoder.kemiri.navigation.ChatHighlight
import io.github.mitzacoder.kemiri.navigation.Destination
import io.github.mitzacoder.kemiri.protocol.NotificationDevice
import io.github.mitzacoder.kemiri.protocol.NotificationDeviceLastDelivery
import io.github.mitzacoder.kemiri.protocol.NotificationPayload
import io.github.mitzacoder.kemiri.protocol.NotificationPreferences
import io.github.mitzacoder.kemiri.protocol.NotificationPreferencesQuietHours
import org.junit.Assert.*
import org.junit.Test

class NotificationsTest {
    private val pc = BackendConfig("Harness PC", "https://pc.example")
    private val vm = BackendConfig("Example VM", "https://vm.example:7317")
    private val twin = BackendConfig("Harness PC", "https://pc2.example")
    private val backends = listOf(pc, vm, twin)

    @Test fun kindsAreTheProtocolsWithTheWebsWords() {
        assertEquals(15, NOTIFICATION_KINDS.size)
        assertEquals("reply", NOTIFICATION_KINDS.first())
        assertEquals("task_review", NOTIFICATION_KINDS.last())
        assertEquals("Tasks ready for review", kindInfo("task_review")?.label)
        assertEquals("Background work finished", kindInfo("thread_finished")?.label)
        assertEquals(setOf("worker_failed", "schedule_problem", "deploy_problem", "compaction_failed", "maintenance_failed", "thread_failed", "disk_low"),
            NOTIFICATION_KIND_INFO.filter { it.failure }.map { it.kind }.toSet())
        assertFalse("worker_report" in DEFAULT_NOTIFICATION_KINDS)
        assertTrue("task_review" in DEFAULT_NOTIFICATION_KINDS)
        assertEquals(11, DEFAULT_NOTIFICATION_KINDS.size)
        assertEquals("11 of 15 events", kindsSummary(DEFAULT_NOTIFICATION_KINDS))
        assertEquals(listOf("reply", "worker_report"), withKind(listOf("worker_report"), "reply", true))
    }

    @Test fun storedDefaultsFollowNewDefaultsButCustomKindsStay() {
        val v0 = listOf("reply", "worker_report", "worker_failed", "schedule_problem", "deploy_problem", "login_prompt")
        assertEquals(DEFAULT_NOTIFICATION_KINDS, migrateDefaultKinds(v0, 0))
        assertEquals(listOf("reply"), migrateDefaultKinds(listOf("reply"), 0))
        val stored = NotificationSettings(kinds = v0, defaultsVersion = 0)
        assertEquals(NotificationSettings(kinds = DEFAULT_NOTIFICATION_KINDS), stored.migrated())
        // An older app's settings without the field decode to the defaults, push off.
        val old = wireJson.decodeFromString(DeviceSettings.serializer(), """{"deviceId":"d1","backends":[]}""")
        assertEquals(NotificationSettings(), old.notifications)
        assertFalse(old.notifications.enabled)
    }

    @Test fun mutesBelongToTheirBackend() {
        val muted = NotificationSettings().withMuted(pc.key, "p1", true).withMuted(vm.key, "p1", true)
        assertTrue(muted.isMuted(pc.key, "p1"))
        assertEquals(listOf("p1"), muted.preferencesFor(pc.key).mutedProjects)
        assertEquals(emptyList<String>(), muted.withMuted(pc.key, "p1", false).preferencesFor(pc.key).mutedProjects)
        assertEquals(listOf(vm.key to "p1"), muted.withMuted(pc.key, "p1", false).mutedEntries())
        val quiet = QuietHours("22:00", "07:00", "Europe/Bucharest", true)
        assertEquals(
            NotificationPreferences(kinds = DEFAULT_NOTIFICATION_KINDS, mutedProjects = emptyList(), quietHours = NotificationPreferencesQuietHours(start = "22:00", end = "07:00", timezone = "Europe/Bucharest", allowFailures = true)),
            NotificationSettings(quietHours = quiet).preferencesFor(vm.key),
        )
    }

    @Test fun quietHoursCrossMidnightAndLetFailuresThrough() {
        val quiet = QuietHours("22:00", "07:00", "UTC", allowFailures = true)
        assertTrue(quietHoursActive(quiet, 23 * 60 + 30))
        assertTrue(quietHoursActive(quiet, 6 * 60 + 59))
        assertFalse(quietHoursActive(quiet, 7 * 60))
        assertFalse(quietHoursActive(quiet, 23 * 60, "worker_failed"))
        assertTrue(quietHoursActive(quiet.copy(allowFailures = false), 23 * 60, "worker_failed"))
        assertFalse(quietHoursActive(quiet.copy(end = "22:00"), 23 * 60))
        assertNull(quietHoursProblem(quiet))
        assertEquals("Use a time like 22:00.", quietHoursProblem(quiet.copy(start = "7:00")))
        assertEquals("Start and end are the same, so nothing would be quiet.", quietHoursProblem(quiet.copy(end = "22:00")))
        assertEquals("22:00–07:00 (UTC)", quietHoursSummary(quiet))
        assertEquals(QuietHours("22:00", "07:00", "Europe/Bucharest", true), quietHoursDraft(NotificationSettings(), "Europe/Bucharest"))
    }

    @Test fun webProjectLinksOpenTheirRoutes() {
        val main = Destination.Chat(pc.key, "proj-1")
        fun open(url: String) = (appLinkFromUri(url, backends) as AppLink.Open).destinations
        assertEquals(listOf(main, Destination.Task(main, "T4")), open("https://${io.github.mitzacoder.kemiri.features.notifications.APP_LINK_HOST}/b/harness-pc/projects/proj-1?task=T4"))
        assertEquals(listOf(main), open("https://${io.github.mitzacoder.kemiri.features.notifications.APP_LINK_HOST}/b/harness-pc/projects/proj-1"))
        assertEquals(listOf(Destination.Chat(pc.key, "proj-1", "t1", "w9")), open("https://${io.github.mitzacoder.kemiri.features.notifications.APP_LINK_HOST}/b/harness-pc/projects/proj-1/threads/t1/workers/w9"))
        assertEquals(listOf(Destination.Chat(vm.key, "proj-1", workerId = "w9")), open("https://${io.github.mitzacoder.kemiri.features.notifications.APP_LINK_HOST}/b/example-vm/projects/proj-1/workers/w9"))
        val thread = Destination.Chat(pc.key, "proj-1", "t1")
        assertEquals(listOf(thread, Destination.Task(thread, "T2")), open("https://${io.github.mitzacoder.kemiri.features.notifications.APP_LINK_HOST}/b/harness-pc/projects/proj-1/threads/t1?task=T2"))
        assertEquals(listOf(main.copy(highlight = ChatHighlight.Thread("t-7"))), open("https://${io.github.mitzacoder.kemiri.features.notifications.APP_LINK_HOST}/b/harness-pc/projects/proj-1#thread-t-7"))
        assertEquals(listOf(main.copy(highlight = ChatHighlight.Entry(42))), open("https://${io.github.mitzacoder.kemiri.features.notifications.APP_LINK_HOST}/b/harness-pc/projects/proj-1#entry-42"))
        assertEquals(listOf(main, Destination.ProjectSettings(main, ProjectSection.Schedules, "s1")), open("https://${io.github.mitzacoder.kemiri.features.notifications.APP_LINK_HOST}/b/harness-pc/projects/proj-1/settings#schedule-s1"))
        assertEquals(listOf(main, Destination.ProjectSettings(main)), open("https://${io.github.mitzacoder.kemiri.features.notifications.APP_LINK_HOST}/b/harness-pc/projects/proj-1/settings"))
        assertEquals(listOf(main, Destination.ProjectSettings(main, ProjectSection.Coordinator)), open("https://${io.github.mitzacoder.kemiri.features.notifications.APP_LINK_HOST}/b/harness-pc/projects/proj-1/settings/coordinator"))
        assertEquals(listOf(main, Destination.ProjectSettings(main, ProjectSection.Storage)), open("https://${io.github.mitzacoder.kemiri.features.notifications.APP_LINK_HOST}/b/harness-pc/projects/proj-1/settings/storage"))
        assertNull(appLinkFromUri("https://${io.github.mitzacoder.kemiri.features.notifications.APP_LINK_HOST}/b/harness-pc/projects/proj-1/settings/nonsense", backends))
        assertEquals(listOf(Destination.Settings()), open("https://${io.github.mitzacoder.kemiri.features.notifications.APP_LINK_HOST}/settings"))
        assertEquals(listOf(Destination.Settings(GeneralPage(GeneralSection.Notifications))), open("https://${io.github.mitzacoder.kemiri.features.notifications.APP_LINK_HOST}/settings/notifications"))
        assertEquals(listOf(Destination.Settings(GeneralPage(GeneralSection.Backends))), open("https://${io.github.mitzacoder.kemiri.features.notifications.APP_LINK_HOST}/settings/backends"))
        assertEquals(listOf(Destination.Settings(GeneralPage(GeneralSection.Backends, pc.key))), open("https://${io.github.mitzacoder.kemiri.features.notifications.APP_LINK_HOST}/settings/backends/harness-pc"))
        assertEquals(listOf(Destination.Settings(GeneralPage(GeneralSection.Backends, pc.key, accounts = true))), open("https://${io.github.mitzacoder.kemiri.features.notifications.APP_LINK_HOST}/settings/backends/harness-pc/accounts"))
        assertEquals(AppLink.UnknownBackend("elsewhere"), appLinkFromUri("https://${io.github.mitzacoder.kemiri.features.notifications.APP_LINK_HOST}/settings/backends/elsewhere/accounts", backends))
        assertEquals(listOf(Destination.Settings()), open("https://${io.github.mitzacoder.kemiri.features.notifications.APP_LINK_HOST}/settings/nonsense"))
        assertEquals(listOf(Destination.Settings(GeneralPage(GeneralSection.Notifications))), open("https://${io.github.mitzacoder.kemiri.features.notifications.APP_LINK_HOST}/notifications"))
        assertTrue(isProjectLink("https://${io.github.mitzacoder.kemiri.features.notifications.APP_LINK_HOST}/settings/archived"))
        assertFalse(isProjectLink("https://${io.github.mitzacoder.kemiri.features.notifications.APP_LINK_HOST}/settingsfoo"))
        // The second backend with the same name is "-2", as a browser that added them in this order calls it.
        assertEquals(listOf(Destination.Chat(twin.key, "proj-1")), open("https://${io.github.mitzacoder.kemiri.features.notifications.APP_LINK_HOST}/b/harness-pc-2/projects/proj-1"))
        assertEquals(listOf(Destination.Chat(pc.key, "a b")), open("https://${io.github.mitzacoder.kemiri.features.notifications.APP_LINK_HOST}/b/harness-pc/projects/a%20b"))
        assertEquals(AppLink.UnknownBackend("elsewhere"), appLinkFromUri("https://${io.github.mitzacoder.kemiri.features.notifications.APP_LINK_HOST}/b/elsewhere/projects/proj-1", backends))
        for (bad in listOf(
            "https://${io.github.mitzacoder.kemiri.features.notifications.APP_LINK_HOST}/connect#v1.YQ",
            "https://other.example/b/harness-pc/projects/proj-1",
            "http://${io.github.mitzacoder.kemiri.features.notifications.APP_LINK_HOST}/b/harness-pc/projects/proj-1",
            "https://${io.github.mitzacoder.kemiri.features.notifications.APP_LINK_HOST}/b/harness-pc/projects",
            "https://${io.github.mitzacoder.kemiri.features.notifications.APP_LINK_HOST}/b/harness-pc/projects/proj-1/unknown",
            "https://user@${io.github.mitzacoder.kemiri.features.notifications.APP_LINK_HOST}/b/harness-pc/projects/proj-1",
        )) assertNull(bad, appLinkFromUri(bad, backends))
        assertTrue(isProjectLink("https://${io.github.mitzacoder.kemiri.features.notifications.APP_LINK_HOST}/b/x/projects/y"))
        assertFalse(isProjectLink("https://${io.github.mitzacoder.kemiri.features.notifications.APP_LINK_HOST}/connect"))
    }

    @Test fun publishedBackendsMatchTheirHostAfterARename() {
        val published = listOf(BackendConfig("harness-pc", "https://harness-pc.example.test"), BackendConfig("Work VM", "https://harness-vm.example.test"))
        // What a browser that added the published list calls them, whatever this device renamed them to.
        assertEquals(published[0], resolveBackend("harness-pc", published))
        assertEquals(published[1], resolveBackend("harness-vm", published))
        assertEquals(published[1], resolveBackend("work-vm", published))
        assertNull(resolveBackend("harness", published))
        // Two backends on hosts with the same first label are not guessed between.
        assertNull(resolveBackend("harness", listOf(BackendConfig("A", "https://harness.one.example"), BackendConfig("B", "https://harness.two.example"))))
    }

    @Test fun webBackendSlugsMatchTheWebs() {
        assertEquals("harness-pc", backendSlug("Harness PC"))
        assertEquals("cafe-vm", backendSlug("Café VM!"))
        assertEquals("backend", backendSlug("***"))
        assertEquals("a".repeat(32), backendSlug("a".repeat(40)))
    }

    private fun payload(kind: String = "reply", projectId: String? = "p1", workerId: String? = null, scheduleId: String? = null, threadId: String? = null, taskId: String? = null, backendKey: String = pc.key) =
        NotificationPayload(kind = kind, title = "t", body = "b", backendKey = backendKey, projectId = projectId, workerId = workerId, scheduleId = scheduleId, threadId = threadId, taskId = taskId, tag = "tag", at = "2026-11-07T00:00:00Z")

    @Test fun notificationsOpenWhatTheWebOpens() {
        val main = Destination.Chat(pc.key, "p1")
        fun open(payload: NotificationPayload) = (notificationLink(payload, backends) as AppLink.Open).destinations
        assertEquals(listOf(main, Destination.Task(main, "T4")), open(payload(kind = "task_review", taskId = "T4", threadId = "t1")))
        assertEquals(listOf(main.copy(threadId = "t1", workerId = "w1")), open(payload(kind = "worker_failed", workerId = "w1", threadId = "t1")))
        assertEquals(listOf(main.copy(workerId = "w1")), open(payload(kind = "worker_report", workerId = "w1", threadId = "main")))
        assertEquals(listOf(main.copy(highlight = ChatHighlight.Thread("t1"))), open(payload(kind = "thread_finished", threadId = "t1")))
        assertEquals(listOf(main, Destination.ProjectSettings(main, ProjectSection.Schedules, "s1")), open(payload(kind = "schedule_problem", scheduleId = "s1")))
        assertEquals(listOf(main), open(payload()))
        assertEquals(listOf(Destination.Home), open(payload(kind = "deploy_problem", projectId = null)))
        assertEquals(AppLink.UnknownBackend("https://gone.example"), notificationLink(payload(backendKey = "https://gone.example"), backends))
    }

    @Test fun onlyKnownPayloadsAreDrawn() {
        val raw = wireJson.encodeToString(NotificationPayload.serializer(), payload(kind = "task_review", taskId = "T4"))
        assertEquals("T4", parseNotificationPayload(raw)?.taskId)
        assertNotNull(parseNotificationPayload(raw.replace("task_review", "test")))
        assertNull(parseNotificationPayload(raw.replace("task_review", "future_kind")))
        assertNull(parseNotificationPayload("not json"))
        assertNull(parseNotificationPayload(null))
        // A pending link survives the activity being recreated.
        val pending = PendingAppLink.Notification(raw)
        assertEquals(pending, decodePendingAppLink(pending.encode()))
        assertEquals(PendingAppLink.Web("https://x"), decodePendingAppLink(PendingAppLink.Web("https://x").encode()))
    }

    @Test fun presenceIsPerBackend() {
        val presence = AppPresence(visible = true, backendKey = pc.key, projectId = "p1")
        assertEquals("p1", presence.projectOn(pc.key))
        assertNull(presence.projectOn(vm.key))
    }

    @Test fun backendCardsSayWhyNothingArrives() {
        val on = NotificationSettings(enabled = true, fcmToken = "tok")
        val ready = BackendPushState(connected = true, supportsNotifications = true, supportsFcm = true, configRead = true, fcmProjectId = "harness-app")
        fun label(state: BackendPushState?, settings: NotificationSettings = on, unavailable: String? = null) = backendPushView(state, settings, "harness-app", unavailable).label
        assertEquals("Not connected", label(null))
        assertEquals("No Android push", label(ready.copy(supportsFcm = false)))
        assertEquals("Unavailable", label(ready, unavailable = "no Firebase"))
        assertEquals("Off", label(ready, NotificationSettings()))
        assertEquals("FCM off", label(ready.copy(fcmProjectId = null)))
        assertEquals("Project mismatch", label(ready.copy(fcmProjectId = "other")))
        assertEquals("Not registered", label(ready))
        val device = NotificationDevice(deviceId = "d", label = "l", backendKey = pc.key, preferences = on.preferencesFor(pc.key), createdAt = "2026-11-07T00:00:00Z", lastDelivery = null, transport = "fcm")
        assertEquals("Registered", label(ready.copy(device = device)))
        assertEquals("Registered; nothing pushed yet.", lastDeliveryText(device))
        val relayOn = on.copy(relayEnabled = true)
        val relayState = ready.copy(supportsFcm = false, supportsRelay = true, device = device)
        assertEquals("Working", backendPushView(relayState, relayOn, null, null).label)
        val opaqueFailure = device.copy(lastDelivery = NotificationDeviceLastDelivery(
            at = "not a timestamp", ok = false, status = 410, message = "route_expired"))
        assertEquals("Last attempt delayed.", relayLastAttemptText(opaqueFailure))
        assertFalse(relayLastAttemptText(opaqueFailure).contains("route"))
        val failed = device.copy(lastDelivery = NotificationDeviceLastDelivery(at = "2026-11-07T00:00:00Z", ok = false, status = null, message = "FCM is off on this backend (no service-account key)"))
        assertTrue(lastDeliveryText(failed), lastDeliveryText(failed).endsWith(": FCM is off on this backend (no service-account key)."))
    }
}
