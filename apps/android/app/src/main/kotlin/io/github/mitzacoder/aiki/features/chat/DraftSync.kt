package io.github.mitzacoder.aiki.features.chat

import io.github.mitzacoder.aiki.protocol.ChatDraft
import io.github.mitzacoder.aiki.protocol.DraftContent
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/*
 * Keeping one chat's draft in step with the backend (`chat-drafts`), pure Kotlin: a port of apps/web/src/lib/drafts-sync.ts,
 * with the same constants and rules (docs/DESIGN.md "Chat drafts"). `decideRemote` says what to do with a draft that arrived
 * from another device and never lets it overwrite text the user has typed and not yet synced, or text under the cursor in
 * the middle of typing. `DraftSync` runs the rest: the debounce, the compare-and-set write, the retry after a refused write.
 */

/** Writes go out this long after the user stops typing. */
const val DRAFT_DEBOUNCE_MS = 500L
/** A remote draft waits while the composer is focused and was edited more recently than this. */
const val DRAFT_TYPING_QUIET_MS = 3000L
/** Writes in a row that ended in a refusal before the next change or push tries again. */
const val DRAFT_MAX_ATTEMPTS = 3
/** After a failed request (not a refusal) the write is tried again this long later. */
const val DRAFT_RETRY_MS = 4000L

/** Drafts not changed for this long are dropped by the server and by the device's cache. */
const val DRAFT_MAX_AGE_MS = 30L * 24 * 60 * 60 * 1000
const val DRAFT_TEXT_MAX_CHARS = 100_000
const val DRAFT_QUOTE_MAX_CHARS = 50_000
const val DRAFT_MAX_QUOTES = 20
const val DRAFT_TOTAL_MAX_CHARS = 200_000
const val DRAFT_MAX_ATTACHMENTS = 8

/** What this device last knew the backend held for a chat: its revision (0 for none) and content (null for none). */
data class SyncedDraft(val revision: Long = 0, val content: DraftContent? = null)

/** A draft as the backend sees it: no text (after trimming), task, quotes or attachments is no draft. */
fun DraftContent.isEmptyDraft(): Boolean = text.isBlank() && taskId == null && quotes.isEmpty() && attachments.isNullOrEmpty()

/** An empty draft is null; this is what is compared and written. */
fun DraftContent?.asContent(): DraftContent? = if (this == null || isEmptyDraft()) null else this

/** Same text, task, quotes and attachments (a missing attachment list is an empty one); a reference's type and name do not count. */
fun sameDraftContent(left: DraftContent?, right: DraftContent?): Boolean {
    if (left == null || right == null) return left == null && right == null
    if (left.text != right.text || left.taskId != right.taskId || left.quotes != right.quotes) return false
    return left.attachments.orEmpty().map { it.id } == right.attachments.orEmpty().map { it.id }
}

/** Why a draft is over the caps the backend refuses with, or null. Checked before writing. */
fun draftLimitError(content: DraftContent): String? {
    if (content.text.length > DRAFT_TEXT_MAX_CHARS) return "A draft's text is at most $DRAFT_TEXT_MAX_CHARS characters"
    if (content.quotes.size > DRAFT_MAX_QUOTES) return "A draft holds at most $DRAFT_MAX_QUOTES quotes"
    if (content.quotes.any { it.length > DRAFT_QUOTE_MAX_CHARS }) return "A quote in a draft is at most $DRAFT_QUOTE_MAX_CHARS characters"
    if (content.text.length + content.quotes.sumOf { it.length } > DRAFT_TOTAL_MAX_CHARS) return "A draft's text and quotes together are at most $DRAFT_TOTAL_MAX_CHARS characters"
    if (content.attachments.orEmpty().size > DRAFT_MAX_ATTACHMENTS) return "A draft holds at most $DRAFT_MAX_ATTACHMENTS attachments"
    return null
}

sealed interface RemoteDecision {
    /** Old news: its revision is not newer than what this device already knows. */
    data object Ignore : RemoteDecision
    /** Same as the composer already shows: only the revision moves. */
    data object Adopt : RemoteDecision
    /** The composer is untouched since the last sync: show the remote draft. */
    data object Apply : RemoteDecision
    /** The composer is untouched but the user is typing in it: look again after [waitMs]. */
    data class Defer(val waitMs: Long) : RemoteDecision
    /** The composer has text the backend has not seen: keep it, take the revision, write again. */
    data object Conflict : RemoteDecision
}

/**
 * What to do with an entry from the backend (`remoteRevision`, `remote`), given the composer's [local] draft, what was
 * [synced] last, whether the composer is [focused] and how long ago the user last changed it ([sinceLocalEdit],
 * Long.MAX_VALUE for never). [authoritative] is for an entry the backend itself answered a request with (a refused
 * write, a read): its revision counts even if it is lower than what this device knew (the backend lost the entry).
 */
fun decideRemote(
    local: DraftContent?,
    synced: SyncedDraft,
    remoteRevision: Long,
    remote: DraftContent?,
    focused: Boolean,
    sinceLocalEdit: Long,
    authoritative: Boolean = false,
): RemoteDecision {
    if (!authoritative && remoteRevision <= synced.revision) return RemoteDecision.Ignore
    val mine = local.asContent()
    if (sameDraftContent(mine, remote.asContent())) return RemoteDecision.Adopt
    if (!sameDraftContent(mine, synced.content.asContent())) return RemoteDecision.Conflict
    if (focused && sinceLocalEdit < DRAFT_TYPING_QUIET_MS) return RemoteDecision.Defer(DRAFT_TYPING_QUIET_MS - sinceLocalEdit)
    return RemoteDecision.Apply
}

/** Where a draft on screen came from, when it is from another device: the name for the small hint, and how many images it holds. */
data class DraftOrigin(val name: String, val attachments: Int)

fun draftOrigin(entry: ChatDraft, ownDeviceId: String): DraftOrigin? {
    val author = entry.author ?: return null
    val content = entry.content ?: return null
    if (author.deviceId == ownDeviceId) return null
    return DraftOrigin(author.name ?: "another device", content.attachments.orEmpty().size)
}

/** The backend refused this draft for good (a cap, an unknown attachment): retrying the same write cannot help. */
class DraftRejected(message: String) : Exception(message)

data class DraftWriteResult(val applied: Boolean, val draft: ChatDraft?)

interface DraftTransport {
    /** Connected, and the backend has `chat-drafts`. Re-checked with each action; `connectionChanged` says when it moved. */
    fun available(): Boolean
    suspend fun read(): ChatDraft?
    /** Throws [DraftRejected] when the backend refuses the content for good, anything else for a failed request. */
    suspend fun write(content: DraftContent?, baseRevision: Long): DraftWriteResult
}

/**
 * One chat's draft against the backend. Everything runs on [scope] (one thread of execution: the main dispatcher, or a test
 * scheduler), so no locking. [persist] gets the local draft and what is known synced after each change, for the device's
 * cache; it is not called after [destroy].
 */
class DraftSync(
    private val transport: DraftTransport,
    private val scope: CoroutineScope,
    local: DraftContent?,
    synced: SyncedDraft,
    private val focused: () -> Boolean,
    /** The composer takes this draft (null when the remote one was cleared). */
    private val apply: (DraftContent?, ChatDraft) -> Unit,
    private val persist: (DraftContent?, SyncedDraft) -> Unit,
    private val now: () -> Long = System::currentTimeMillis,
) {
    private var local: DraftContent? = local
    var synced: SyncedDraft = synced
        private set
    private var lastEdit: Long? = null
    private var debounce: Job? = null
    private var recheck: Job? = null
    private var writing = false
    private var refusals = 0
    private var remote: ChatDraft? = null
    private var destroyed = false

    /** The user changed the composer (not a draft applied from outside). */
    fun changed(draft: DraftContent?) {
        if (destroyed) return
        local = draft
        lastEdit = now()
        refusals = 0
        persist(local, synced)
        schedule(DRAFT_DEBOUNCE_MS)
    }

    /** Write now if there is something unsynced: on blur, on leaving the chat, when the app stops, after a send. */
    fun flush() {
        if (destroyed) return
        cancelDebounce()
        scope.launch { write() }
    }

    /** The chat is left: one last write goes out, and nothing after it comes back to this object. */
    fun destroy() {
        if (destroyed) return
        cancelDebounce()
        recheck?.cancel(); recheck = null
        if (dirty() && transport.available() && !writing) scope.launch { write() }
        destroyed = true
    }

    /** The connection came up or the backend's features arrived: read the chat's entry and settle with it. */
    suspend fun connectionChanged() {
        if (destroyed || !transport.available()) return
        val entry = try { transport.read() } catch (e: CancellationException) { throw e } catch (_: Exception) { return }
        if (destroyed) return
        refusals = 0
        receive(entry ?: NO_ENTRY, authoritative = true)
        if (dirty()) schedule(0)
    }

    /** A `drafts.changed` push for this chat. */
    fun pushed(entry: ChatDraft) {
        if (destroyed) return
        refusals = 0
        receive(entry, authoritative = false)
    }

    private fun dirty() = !sameDraftContent(local.asContent(), synced.content.asContent())

    private fun schedule(ms: Long) {
        cancelDebounce()
        if (!dirty() || !transport.available()) return
        debounce = scope.launch { delay(ms); debounce = null; write() }
    }

    private fun cancelDebounce() { debounce?.cancel(); debounce = null }

    private suspend fun write() {
        if (writing || !dirty() || !transport.available()) return
        val content = local.asContent()
        if (content != null && draftLimitError(content) != null) return // Too big for the backend: stays on this device.
        if (refusals >= DRAFT_MAX_ATTEMPTS) return
        writing = true
        val result = try {
            transport.write(content, synced.revision)
        } catch (e: CancellationException) { writing = false; throw e }
        catch (_: DraftRejected) { writing = false; return }
        catch (_: Exception) {
            writing = false
            if (!destroyed) schedule(DRAFT_RETRY_MS)
            return
        }
        writing = false
        if (destroyed) return
        if (result.applied) {
            refusals = 0
            synced = SyncedDraft(result.draft?.revision ?: 0, content)
            persist(local, synced)
            schedule(DRAFT_DEBOUNCE_MS)
            return
        }
        refusals += 1
        receive(result.draft ?: NO_ENTRY, authoritative = true)
    }

    private fun receive(entry: ChatDraft, authoritative: Boolean) {
        recheck?.cancel(); recheck = null
        val decision = decideRemote(
            local, synced, entry.revision, entry.content, focused(),
            lastEdit?.let { now() - it } ?: Long.MAX_VALUE, authoritative,
        )
        when (decision) {
            RemoteDecision.Ignore -> Unit
            RemoteDecision.Adopt -> {
                synced = SyncedDraft(entry.revision, entry.content)
                remote = null
                persist(local, synced)
            }
            RemoteDecision.Apply -> {
                synced = SyncedDraft(entry.revision, entry.content)
                local = entry.content
                remote = null
                persist(local, synced)
                apply(entry.content, entry)
            }
            is RemoteDecision.Defer -> {
                remote = entry
                recheck = scope.launch {
                    delay(decision.waitMs)
                    recheck = null
                    remote?.let { receive(it, authoritative) }
                }
            }
            RemoteDecision.Conflict -> {
                // The later writer wins: keep what was typed, build on the backend's revision, write at once.
                remote = null
                synced = SyncedDraft(entry.revision, entry.content)
                persist(local, synced)
                schedule(0)
            }
        }
    }

    private companion object {
        /** What the backend answers for a chat it holds nothing for. */
        val NO_ENTRY = ChatDraft(projectId = "", threadId = "", revision = 0, updatedAt = "", content = null)
    }
}
