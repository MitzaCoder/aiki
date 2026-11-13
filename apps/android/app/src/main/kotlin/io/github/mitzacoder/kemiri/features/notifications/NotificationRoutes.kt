package io.github.mitzacoder.kemiri.features.notifications

import io.github.mitzacoder.kemiri.data.BackendConfig
import io.github.mitzacoder.kemiri.data.wireJson
import io.github.mitzacoder.kemiri.features.settings.*
import io.github.mitzacoder.kemiri.navigation.ChatHighlight
import io.github.mitzacoder.kemiri.navigation.Destination
import io.github.mitzacoder.kemiri.protocol.MAIN_THREAD_ID
import io.github.mitzacoder.kemiri.protocol.NotificationPayload
import java.net.URI
import java.net.URLDecoder
import java.text.Normalizer
import kotlinx.serialization.Serializable
import kotlinx.serialization.SerialName

/** The web app's host: its project links open here when the user lets the app handle them. */
const val APP_LINK_HOST = io.github.mitzacoder.kemiri.BuildConfig.APP_LINK_HOST

/** Where a link or a notification tap lands once the backends are known. */
sealed interface AppLink {
    /** Open these in order: a chat, then (for a task, settings) what sits over it, so back returns to the chat. */
    data class Open(val destinations: List<Destination>) : AppLink
    /** The link names a backend this device does not have. */
    data class UnknownBackend(val backend: String) : AppLink
}

/** A link or tap waiting for the backends to load; survives the activity being recreated. */
// These serial names are persisted; a Kotlin namespace rename must not change them.
@Serializable
sealed interface PendingAppLink {
    @Serializable @SerialName("io.github.mitzacoder.aiki.features.notifications.PendingAppLink.Web") data class Web(val uri: String) : PendingAppLink
    @Serializable @SerialName("io.github.mitzacoder.aiki.features.notifications.PendingAppLink.Notification") data class Notification(val payload: String) : PendingAppLink
}

fun PendingAppLink.encode(): String = wireJson.encodeToString(PendingAppLink.serializer(), this)
fun decodePendingAppLink(value: String): PendingAppLink? = runCatching { wireJson.decodeFromString(PendingAppLink.serializer(), value) }.getOrNull()

fun PendingAppLink.resolve(backends: List<BackendConfig>): AppLink? = when (this) {
    is PendingAppLink.Web -> appLinkFromUri(uri, backends)
    is PendingAppLink.Notification -> parseNotificationPayload(payload)?.let { notificationLink(it, backends) }
}

/** The base of web `backendIdFromName`: lower-case ASCII words joined by "-", at most 32 characters. */
fun backendSlug(name: String): String = Normalizer.normalize(name.lowercase(), Normalizer.Form.NFKD)
    .replace(Regex("[^a-z0-9]+"), "-").trim('-').take(32).ifEmpty { "backend" }

/**
 * The backend a link names. The web's IDs are per-browser slugs of the backend's name when it was added (a second
 * backend with the same name gets "-2"), so this device assigns them the same way in its own order; the published
 * backends' names are their hosts' first labels ("harness-pc" for harness-pc.example.test), which also matches
 * after a rename on either side. A notification names the backend by the key this device registered with, which
 * matches directly.
 */
fun resolveBackend(segment: String, backends: List<BackendConfig>): BackendConfig? {
    backends.firstOrNull { it.key == segment }?.let { return it }
    val taken = mutableSetOf<String>()
    val ids = backends.associateBy { config ->
        val base = backendSlug(config.name)
        var candidate = base
        var suffix = 2
        while (candidate in taken) candidate = "$base-${suffix++}"
        taken += candidate
        candidate
    }
    ids[segment]?.let { return it }
    return backends.filter { hostLabel(it.url) == segment }.singleOrNull()
}

/** The first label of a backend's host, lower case: "harness-pc" for https://harness-pc.example.test. */
private fun hostLabel(url: String): String? = runCatching { URI(url).host }.getOrNull()?.lowercase()?.substringBefore('.')

private fun decode(part: String): String? = runCatching { URLDecoder.decode(part.replace("+", "%2B"), "UTF-8") }.getOrNull()

/** Whether a VIEW intent's URI is a project link of the web app (connect links are handled elsewhere). */
fun isProjectLink(value: String): Boolean = runCatching {
    val uri = URI(value)
    uri.scheme.equals("https", ignoreCase = true) && uri.host.equals(APP_LINK_HOST, ignoreCase = true) && uri.rawUserInfo == null &&
        uri.rawPath.orEmpty().let { it.startsWith("/b/") || it == "/settings" || it.startsWith("/settings/") || it == "/notifications" }
}.getOrDefault(false)

/**
 * A web route as destinations: `/b/<backend>/projects/<id>` with `/settings`, `/threads/<t>`, `/threads/<t>/workers/<w>`
 * or `/workers/<w>`, `?task=<id>` (the task's sheet over that chat), and `#thread-<id>` / `#entry-<n>` (one-shot highlight).
 * Null when the URI is not such a route.
 */
fun appLinkFromUri(value: String, backends: List<BackendConfig>): AppLink? {
    if (!isProjectLink(value)) return null
    val uri = runCatching { URI(value) }.getOrNull() ?: return null
    val parts = uri.rawPath.split('/').filter { it.isNotEmpty() }.map { decode(it) ?: return null }
    if (parts.firstOrNull() == "settings") return generalSettingsLink(parts.drop(1), backends)
    // The web redirects /notifications to /settings/notifications.
    if (parts == listOf("notifications")) return generalSettingsLink(parts, backends)
    if (parts.size < 4 || parts[0] != "b" || parts[2] != "projects" || parts[3].isEmpty()) return null
    val backend = resolveBackend(parts[1], backends) ?: return AppLink.UnknownBackend(parts[1])
    val rest = parts.drop(4)
    var settings = false
    var settingsSection: ProjectSection? = null
    var threadId: String? = null
    var workerId: String? = null
    when {
        rest.isEmpty() -> Unit
        rest == listOf("settings") -> settings = true
        rest.size == 2 && rest[0] == "settings" -> { settings = true; settingsSection = projectSectionFor(rest[1]) ?: return null }
        rest.size == 2 && rest[0] == "workers" -> workerId = rest[1]
        rest.size == 2 && rest[0] == "threads" -> threadId = rest[1]
        rest.size == 4 && rest[0] == "threads" && rest[2] == "workers" -> { threadId = rest[1]; workerId = rest[3] }
        else -> return null
    }
    val chat = Destination.Chat(backend.key, parts[3], threadId?.takeUnless { it == MAIN_THREAD_ID }, workerId)
    val query = uri.rawQuery.orEmpty().split('&').mapNotNull { pair ->
        val key = decode(pair.substringBefore('=')) ?: return@mapNotNull null
        val text = decode(pair.substringAfter('=', "")) ?: return@mapNotNull null
        key to text
    }.toMap()
    val task = query["task"]?.takeIf { it.isNotBlank() }
    val fragment = uri.rawFragment?.let(::decode).orEmpty()
    val highlight = when {
        fragment.startsWith("thread-") && fragment.length > 7 -> ChatHighlight.Thread(fragment.removePrefix("thread-"))
        fragment.startsWith("entry-") -> fragment.removePrefix("entry-").toLongOrNull()?.let { ChatHighlight.Entry(it) }
        else -> null
    }
    // A schedule notification links to `.../settings#schedule-<id>`: the Scheduled tasks section, scrolled to that schedule.
    val scheduleId = fragment.removePrefix("schedule-").takeIf { fragment.startsWith("schedule-") && fragment.length > 9 }
    return AppLink.Open(when {
        settings -> listOf(chat, Destination.ProjectSettings(chat, settingsSection ?: ProjectSection.Schedules.takeIf { scheduleId != null }, scheduleId))
        task != null && workerId == null -> listOf(chat, Destination.Task(chat, task))
        highlight != null -> listOf(chat.copy(highlight = highlight))
        else -> listOf(chat)
    })
}

/**
 * The web's General settings URLs after `/settings`: nothing is the list, then `appearance | notifications | archived |
 * backends`, and `backends/<id>` with `/accounts`. An unknown section opens the list; a backend this device does not have is
 * [AppLink.UnknownBackend].
 */
fun generalSettingsLink(parts: List<String>, backends: List<BackendConfig>): AppLink {
    val section = generalSectionFor(parts.firstOrNull())
    val backendSegment = parts.getOrNull(1)
    if (section == GeneralSection.Backends && backendSegment != null) {
        val backend = resolveBackend(backendSegment, backends) ?: return AppLink.UnknownBackend(backendSegment)
        return AppLink.Open(listOf(Destination.Settings(GeneralPage(section, backend.key, accounts = parts.getOrNull(2) == "accounts", mcp = parts.getOrNull(2) == "mcp"))))
    }
    return AppLink.Open(listOf(Destination.Settings(GeneralPage(section))))
}

/**
 * Where a notification opens (client `notificationUrl`): the task's sheet over main, a worker's transcript, main with a
 * background thread's card highlighted, the project's settings for a schedule, the project, or home without a project.
 */
fun notificationLink(payload: NotificationPayload, backends: List<BackendConfig>): AppLink {
    val backend = resolveBackend(payload.backendKey, backends) ?: return AppLink.UnknownBackend(payload.backendKey)
    val projectId = payload.projectId ?: return AppLink.Open(listOf(Destination.Home))
    val main = Destination.Chat(backend.key, projectId)
    val thread = payload.threadId?.takeUnless { it == MAIN_THREAD_ID }
    return AppLink.Open(when {
        payload.taskId != null -> listOf(main, Destination.Task(main, payload.taskId))
        payload.workerId != null -> listOf(main.copy(threadId = thread, workerId = payload.workerId))
        // A thread's news opens main, where its card is: the user talks to main, not to the thread.
        thread != null -> listOf(main.copy(highlight = ChatHighlight.Thread(thread)))
        payload.scheduleId != null -> listOf(main, Destination.ProjectSettings(main, ProjectSection.Schedules, payload.scheduleId))
        else -> listOf(main)
    })
}

/** A push payload, or null when it is not one this app can draw (client `parseNotificationPayload`). */
fun parseNotificationPayload(raw: String?): NotificationPayload? {
    if (raw == null) return null
    val payload = runCatching { wireJson.decodeFromString(NotificationPayload.serializer(), raw) }.getOrNull() ?: return null
    if (payload.kind != "test" && payload.kind !in NOTIFICATION_KINDS) return null
    if (payload.title.isEmpty() || payload.backendKey.isEmpty() || payload.tag.isEmpty()) return null
    return payload
}
