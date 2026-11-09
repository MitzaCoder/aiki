package com.mihaisaru.harness.features.notifications

import com.mihaisaru.harness.protocol.NotificationPreferences
import com.mihaisaru.harness.protocol.NotificationPreferencesQuietHours
import kotlinx.serialization.Serializable

/** Quiet hours in the device's own timezone; same shape as the protocol's. */
@Serializable
data class QuietHours(val start: String, val end: String, val timezone: String, val allowFailures: Boolean)

/**
 * What this device wants to be told about (client `DeviceNotificationSettings`), kept in [com.mihaisaru.harness.data.DeviceSettings]
 * and registered with every backend: kinds and quiet hours are shared, mutes belong to the backend whose project it is.
 */
@Serializable
data class NotificationSettings(
    /** The user turned push on for this device; until then nothing registers and no token is made. */
    val enabled: Boolean = false,
    val kinds: List<String> = DEFAULT_NOTIFICATION_KINDS,
    val defaultsVersion: Int = NOTIFICATION_DEFAULTS_VERSION,
    val quietHours: QuietHours? = null,
    /** Backend key -> muted project IDs: a project ID only means something to the backend that made it. */
    val mutedProjects: Map<String, List<String>> = emptyMap(),
    /** The FCM registration token this app instance has, once Firebase gave one. */
    val fcmToken: String? = null,
) {
    /** Kinds brought up to this build's defaults, unknown ones dropped. */
    fun migrated(): NotificationSettings {
        val known = NOTIFICATION_KINDS.filter { it in kinds }
        if (defaultsVersion >= NOTIFICATION_DEFAULTS_VERSION && known == kinds) return this
        return copy(kinds = if (defaultsVersion >= NOTIFICATION_DEFAULTS_VERSION) known else migrateDefaultKinds(known, defaultsVersion), defaultsVersion = NOTIFICATION_DEFAULTS_VERSION)
    }

    /** What this device registers with one backend. */
    fun preferencesFor(backendKey: String) = NotificationPreferences(
        kinds = kinds,
        mutedProjects = mutedProjects[backendKey].orEmpty(),
        quietHours = quietHours?.let { NotificationPreferencesQuietHours(start = it.start, end = it.end, timezone = it.timezone, allowFailures = it.allowFailures) },
    )

    fun isMuted(backendKey: String, projectId: String) = projectId in mutedProjects[backendKey].orEmpty()

    fun withMuted(backendKey: String, projectId: String, muted: Boolean): NotificationSettings {
        val current = mutedProjects[backendKey].orEmpty()
        val next = if (muted) (current + projectId).distinct() else current - projectId
        return copy(mutedProjects = if (next.isEmpty()) mutedProjects - backendKey else mutedProjects + (backendKey to next))
    }

    /** Muted projects as pairs, so a screen can list them without walking the map. */
    fun mutedEntries(): List<Pair<String, String>> = mutedProjects.flatMap { (backend, projects) -> projects.map { backend to it } }
}

private val TIME_OF_DAY = Regex("^([01][0-9]|2[0-3]):[0-5][0-9]$")

/** The stored window, or the one a toggle starts from (client `quietHoursDraft`). */
fun quietHoursDraft(settings: NotificationSettings, timezone: String): QuietHours =
    settings.quietHours ?: QuietHours(start = "22:00", end = "07:00", timezone = timezone, allowFailures = true)

/** Why a quiet-hours draft cannot be saved, or null when it can (web `quietHoursProblem`). */
fun quietHoursProblem(quietHours: QuietHours): String? = when {
    !TIME_OF_DAY.matches(quietHours.start) || !TIME_OF_DAY.matches(quietHours.end) -> "Use a time like 22:00."
    quietHours.start == quietHours.end -> "Start and end are the same, so nothing would be quiet."
    quietHours.timezone.isBlank() -> "This device has no timezone."
    else -> null
}

/** "22:00–07:00 (Europe/Bucharest)". */
fun quietHoursSummary(quietHours: QuietHours): String = "${quietHours.start}–${quietHours.end} (${quietHours.timezone})"

/** Whether quiet hours cover [minuteOfDay] (0..1439, device time) for [kind]; failures pass when allowed. */
fun quietHoursActive(quietHours: QuietHours?, minuteOfDay: Int, kind: String? = null): Boolean {
    if (quietHours == null || quietHours.start == quietHours.end) return false
    if (kind != null && quietHours.allowFailures && isNotificationFailure(kind)) return false
    val start = minutes(quietHours.start) ?: return false
    val end = minutes(quietHours.end) ?: return false
    return if (start < end) minuteOfDay in start until end else minuteOfDay >= start || minuteOfDay < end
}

private fun minutes(value: String): Int? = TIME_OF_DAY.matchEntire(value)?.let { value.substring(0, 2).toInt() * 60 + value.substring(3, 5).toInt() }
