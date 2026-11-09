package com.mihaisaru.harness.features.terminal

import android.content.Context
import androidx.core.content.edit
import com.mihaisaru.harness.data.*
import com.mihaisaru.harness.protocol.*
import java.util.UUID
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.*

/** Where a visit to the terminal screen comes from: a project, one of its workers, or a named session. */
data class TerminalLink(val projectId: String? = null, val workerId: String? = null, val session: String? = null)

/** What the screen shows. */
data class DeckState(
    /** What the backend offers (and the sessions it has); null until the first answer. */
    val listing: TerminalListResponse? = null,
    val listError: String? = null,
    val tabs: List<TerminalTab> = emptyList(),
    val activeId: String? = null,
    /** Whether the first load of this visit is done: the tabs are known. */
    val restored: Boolean = false,
    val endError: String? = null,
)

/** The terminal screens' own pace for letting go of the sessions after the screen is left; a rotation is back well within it. */
internal const val DECK_LEAVE_GRACE_MS = 4_000L

/**
 * A backend's terminals as one thing that outlives the screen: the tabs of this device, a live [TerminalScreenSession] per
 * tab, and the sessions list. The port of `TerminalPage.svelte`'s logic. The activity is recreated on a rotation, so the
 * tabs and their emulators (scrollback and all) cannot belong to the composition; the screen enters and leaves, and the
 * deck detaches everything a few seconds after the last leave.
 *
 * Main thread: the state is read by Compose and the emulators are Termux's, so [scope] runs on the main dispatcher.
 */
class TerminalDeck(
    private val context: Context,
    private val backendKey: String,
    private val client: HarnessClient,
    private val scope: CoroutineScope,
) {
    private val mutableState = MutableStateFlow(DeckState())
    val state: StateFlow<DeckState> = mutableState.asStateFlow()
    private val live = HashMap<String, TerminalScreenSession>()
    private val namers = HashMap<String, Job>()
    private val preferences = context.getSharedPreferences(TERMINAL_TABS_PREFERENCES, Context.MODE_PRIVATE)
    private var leaveJob: Job? = null
    private var link: TerminalLink? = null
    private var palette: TerminalPalette? = null
    private var entering: Job? = null
    /** The size a view last fitted a terminal to; sessions made after it start at that size. */
    private var lastSize: Pair<Int, Int>? = null

    /** The live session of a tab, once the deck made it. */
    fun session(tabId: String): TerminalScreenSession? = live[tabId]

    /** The theme's colours, for terminals open now and ones made later. */
    fun setPalette(next: TerminalPalette) {
        if (palette == next) return
        palette = next
        live.values.forEach { it.applyPalette(next) }
    }

    /**
     * The screen opened for [link]. Coming back within the grace period (a rotation) keeps what is there; otherwise the
     * tabs this device remembered are listed against the backend and attached, and the link's session or project is added.
     */
    fun enter(link: TerminalLink, project: TerminalProject?, worker: TerminalWorker?) {
        val returning = leaveJob?.isActive == true
        leaveJob?.cancel()
        leaveJob = null
        if (returning && link == this.link && mutableState.value.restored) return
        this.link = link
        entering?.cancel()
        entering = scope.launch { restore(link, project, worker) }
    }

    /** The screen was left. The sessions detach after the grace period unless it is entered again. */
    fun leave() {
        leaveJob?.cancel()
        leaveJob = scope.launch {
            delay(DECK_LEAVE_GRACE_MS)
            entering?.cancel()
            dropAllLive()
            link = null
            mutableState.update { DeckState(tabs = it.tabs, activeId = it.activeId) }
        }
    }

    /** "Check again" on the unavailable card. */
    fun checkAgain() { scope.launch { refreshListing() } }

    /** The backend came back: the list is what it has now. */
    suspend fun refreshListing() {
        try {
            val listing = client.request(TerminalListRequest())
            mutableState.update { it.copy(listing = listing, listError = null) }
        } catch (error: CancellationException) { throw error }
        catch (error: Exception) { mutableState.update { it.copy(listError = error.message ?: error.toString()) } }
    }

    private suspend fun restore(link: TerminalLink, project: TerminalProject?, worker: TerminalWorker?) {
        refreshListing()
        val listing = mutableState.value.listing
        if (listing == null || !listing.available) {
            mutableState.update { it.copy(restored = true) }
            return
        }
        val stored = parseTabs(preferences.getString(KEY, null))[backendKey] ?: TerminalTabs()
        val kept = reconcileTabs(stored, listing.sessions)
        dropAllLive()
        kept.tabs.forEach { makeLive(it) }
        mutableState.update { it.copy(tabs = kept.tabs, activeId = kept.active, endError = null) }
        if (link.session != null) attachSession(link.session)
        else if (link.projectId != null || (kept.tabs.isEmpty() && listing.sessions.isEmpty())) {
            val target = terminalTarget(project, worker)
            val existing = sessionForPrefix(listing.sessions, target.prefix)
            if (existing != null) attachSession(existing, target.title) else newTab(target)
        }
        mutableState.update { it.copy(restored = true) }
        remember()
    }

    private fun makeLive(tab: TerminalTab) {
        val session = TerminalScreenSession(
            context, client, scope, tab.session, tab.prefix ?: "term", tab.cwd, palette ?: FALLBACK_PALETTE, lastSize,
        )
        session.onResized = { columns, rows -> lastSize = columns to rows }
        live[tab.id] = session
        // The backend names a new session; the tab remembers it, so a restart reattaches the same one.
        namers[tab.id] = scope.launch { session.state.map { it.session }.filterNotNull().distinctUntilChanged().collect { name -> nameSession(tab.id, name) } }
    }

    private fun dropLive(id: String) {
        namers.remove(id)?.cancel()
        live.remove(id)?.close()
    }

    private fun dropAllLive() {
        namers.values.forEach { it.cancel() }
        namers.clear()
        live.values.forEach { it.close() }
        live.clear()
    }

    private fun add(tab: TerminalTab) {
        if (mutableState.value.tabs.size >= MAX_TERMINAL_TABS) {
            mutableState.update { it.copy(endError = "A screen keeps at most $MAX_TERMINAL_TABS terminals open; close one first.") }
            return
        }
        makeLive(tab)
        mutableState.update { it.copy(tabs = it.tabs + tab, activeId = tab.id, endError = null) }
        remember()
    }

    /** A new session, made from the target's prefix in its folder. */
    fun newTab(target: TerminalTarget) = add(TerminalTab(id = newTabId(), title = target.title, prefix = target.prefix, cwd = target.cwd))

    /** A session that exists, in a tab of its own (or the tab that has it). */
    fun attachSession(name: String, title: String? = null) {
        val existing = mutableState.value.tabs.firstOrNull { it.session == name }
        if (existing != null) { select(existing.id); return }
        add(TerminalTab(id = newTabId(), session = name, title = title ?: name))
    }

    fun select(id: String) {
        mutableState.update { it.copy(activeId = id) }
        remember()
    }

    fun closeTab(id: String) {
        val before = mutableState.value.tabs
        val index = before.indexOfFirst { it.id == id }
        if (index < 0) return
        dropLive(id)
        val tabs = before.filterNot { it.id == id }
        mutableState.update { state ->
            state.copy(tabs = tabs, activeId = if (state.activeId == id) tabs.getOrNull(index.coerceAtMost(tabs.lastIndex))?.id else state.activeId)
        }
        remember()
        scope.launch { refreshListing() }
    }

    /** Where a session ended, start a new one with the same prefix and folder. */
    fun restartTab(id: String, fallback: TerminalTarget) {
        val tab = mutableState.value.tabs.firstOrNull { it.id == id } ?: return
        closeTab(id)
        newTab(fallback.copy(prefix = tab.prefix ?: fallback.prefix))
    }

    private fun nameSession(id: String, session: String) {
        var changed = false
        mutableState.update { state ->
            state.copy(tabs = state.tabs.map { tab -> if (tab.id == id && tab.session != session) { changed = true; tab.copy(session = session) } else tab })
        }
        if (changed) { remember(); scope.launch { refreshListing() } }
    }

    /** End a session on the backend: its processes stop and every tab on it closes. */
    suspend fun endSession(name: String) {
        try {
            client.request(TerminalKillRequest(session = name))
            mutableState.update { it.copy(endError = null) }
        } catch (error: CancellationException) { throw error }
        catch (error: Exception) { mutableState.update { it.copy(endError = error.message ?: error.toString()) } }
        mutableState.value.tabs.filter { it.session == name }.forEach { dropLive(it.id) }
        mutableState.update { state ->
            val tabs = state.tabs.filterNot { it.session == name }
            state.copy(tabs = tabs, activeId = state.activeId?.takeIf { id -> tabs.any { it.id == id } } ?: tabs.firstOrNull()?.id)
        }
        remember()
        refreshListing()
    }

    private fun remember() {
        val current = mutableState.value
        val all = parseTabs(preferences.getString(KEY, null))
        preferences.edit { putString(KEY, storeTabs(all, backendKey, TerminalTabs(current.tabs.filter { it.session != null }, current.activeId))) }
    }

    /** Release everything (the backend was removed). */
    fun close() {
        leaveJob?.cancel()
        entering?.cancel()
        dropAllLive()
    }

    private companion object {
        const val KEY = "tabs"
        fun newTabId(): String = UUID.randomUUID().toString().take(8)
        val FALLBACK_PALETTE = TerminalPalette("#000000", "#ffffff", "#6366f1", List(16) { "#808080" })
    }
}
