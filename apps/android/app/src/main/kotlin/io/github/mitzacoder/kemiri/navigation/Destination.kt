package io.github.mitzacoder.kemiri.navigation

import io.github.mitzacoder.kemiri.data.*
import io.github.mitzacoder.kemiri.features.settings.GeneralPage
import io.github.mitzacoder.kemiri.features.settings.ProjectSection
import kotlinx.serialization.Serializable
import kotlinx.serialization.SerialName

// These serial names are persisted; a Kotlin namespace rename must not change them.
@Serializable
sealed interface Destination {
    /** The projects home (web `/`): every backend's projects, Add a project, and the first-run backend form. */
    @Serializable @SerialName("io.github.mitzacoder.aiki.navigation.Destination.Home") data object Home : Destination
    @Serializable @SerialName("io.github.mitzacoder.aiki.navigation.Destination.Usage") data object Usage : Destination
    /** General settings (web `/settings/...`): a section of this device's settings, a backend's page, or its Accounts; null is the list. */
    @Serializable @SerialName("io.github.mitzacoder.aiki.navigation.Destination.Settings") data class Settings(val page: GeneralPage = GeneralPage()) : Destination
    /** A project's settings (web `.../settings/<section>`); null is the list. [scheduleId] is the schedule a notification named. */
    @Serializable @SerialName("io.github.mitzacoder.aiki.navigation.Destination.ProjectSettings") data class ProjectSettings(val chat: Chat, val section: ProjectSection? = null, val scheduleId: String? = null) : Destination
    /** A conversation. [highlight] is a one-shot place to scroll to; screens read it from [ProjectScreenContext.highlight]. */
    @Serializable @SerialName("io.github.mitzacoder.aiki.navigation.Destination.Chat") data class Chat(
        val backendKey: String,
        val projectId: String,
        val threadId: String? = null,
        val workerId: String? = null,
        val highlight: ChatHighlight? = null,
    ) : Destination
    @Serializable @SerialName("io.github.mitzacoder.aiki.navigation.Destination.Panel") data class Panel(val chat: Chat, val tab: PanelTab = PanelTab.Info) : Destination
    @Serializable @SerialName("io.github.mitzacoder.aiki.navigation.Destination.Artifact") data class Artifact(val chat: Chat, val artifactId: String) : Destination
    /** A task's sheet over the chat it was opened from (the web's `?task=` on main's or a thread's page); back closes it. */
    @Serializable @SerialName("io.github.mitzacoder.aiki.navigation.Destination.Task") data class Task(val chat: Chat, val taskId: String) : Destination
    /**
     * A backend's terminals (web `/b/<backend>/terminal`): [projectId] and [workerId] pick where a new terminal opens (the
     * project's folder, a worker's workspace); [session] attaches one by name. Not a chat: it has its own header.
     */
    @Serializable @SerialName("io.github.mitzacoder.aiki.navigation.Destination.Terminal") data class Terminal(
        val backendKey: String,
        val projectId: String? = null,
        val workerId: String? = null,
        val session: String? = null,
    ) : Destination
}

/** Where a chat scrolls to and flashes when it opens: a transcript entry (web `#entry-N`) or a thread's newest card (`#thread-<id>`). */
@Serializable
sealed interface ChatHighlight {
    @Serializable @SerialName("io.github.mitzacoder.aiki.navigation.ChatHighlight.Entry") data class Entry(val entryId: Long) : ChatHighlight
    @Serializable @SerialName("io.github.mitzacoder.aiki.navigation.ChatHighlight.Thread") data class Thread(val threadId: String) : ChatHighlight
}

/** The chat a destination shows or sits on, without its one-shot highlight; null outside a project. */
fun Destination.chatRoute(): Destination.Chat? = when (this) {
    is Destination.Chat -> copy(highlight = null)
    is Destination.Panel -> chat.copy(highlight = null)
    is Destination.Artifact -> chat.copy(highlight = null)
    is Destination.ProjectSettings -> chat.copy(highlight = null)
    is Destination.Task -> chat.copy(highlight = null)
    Destination.Home, Destination.Usage, is Destination.Settings, is Destination.Terminal -> null
}
/** Keep the same panel window behind a chain of linked task sheets, including when Back returns to a parent. */
fun panelBehindTask(previous: List<Destination>, task: Destination.Task): Destination.Panel? =
    (previous.asReversed().firstOrNull { it !is Destination.Task } as? Destination.Panel)
        ?.takeIf { it.chat.chatRoute() == task.chat.chatRoute() }

/** `Workers` is the removed Workers tab: a saved route that still names it reads back as Info. */
@OptIn(kotlinx.serialization.ExperimentalSerializationApi::class)
@Serializable
enum class PanelTab(val feature: String, val label: String) {
    @kotlinx.serialization.json.JsonNames("Workers") Info("context", "Info"), Memory("memory", "Memory"),
    Board("board", "Board"), Threads("threads", "Background"), Artifacts("artifacts", "Artifacts"),
}

fun resolvedPanelTab(requested: PanelTab, available: List<PanelTab>): PanelTab? = requested.takeIf { it in available } ?: available.firstOrNull()

/** A panel and a task sheet share their chat's saved identity, as does a highlight; every other target stays backend/thread/worker scoped. */
fun Destination.screenStateKey(): String = wireJson.encodeToString(
    Destination.serializer(),
    when (this) {
        is Destination.Panel, is Destination.Task, is Destination.Chat -> chatRoute()!!
        else -> this
    },
)

/** Shared screen seam: all feature workers receive this; reuse backend.client for every request/event. */
data class ProjectScreenContext(
    val repository: HarnessRepository,
    val backend: BackendSession,
    val route: Destination.Chat,
    val navigate: (Destination) -> Unit,
    /** Resolved visible tablet panel, never the stale initial tab. Null for phone overlays. */
    val activePanel: PanelTab? = null,
    /** Where the chat should scroll to once, from the destination; [route] never carries it, so it resets no state. */
    val highlight: ChatHighlight? = null,
) {
    /** The project's live board, shared by every screen of this backend. */
    val board: ProjectBoard get() = backend.board(route.projectId)
    /** Opens a task's sheet over this chat. */
    fun openTask(taskId: String) = navigate(Destination.Task(route, taskId))

    val target get() = ConversationTarget(route.projectId, route.threadId, route.workerId)
}
