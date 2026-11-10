package io.github.mitzacoder.aiki.data

import io.github.mitzacoder.aiki.core.*
import io.github.mitzacoder.aiki.protocol.*
import java.io.Closeable
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.json.*

data class ConversationTarget(val projectId: String, val threadId: String? = null, val workerId: String? = null)
enum class WatchStatus { Connecting, Live, Reconnecting, Ended, Stopped }
data class WatchState(
    val status: WatchStatus = WatchStatus.Connecting,
    val view: ConversationView? = null,
    val entries: List<EntryRecord> = emptyList(),
    val canLoadEarlier: Boolean = false,
    val loadingEarlier: Boolean = false,
    val earlierError: String? = null,
    val error: String? = null,
)

/** Retains paged history across bounded window updates/reconnects, just like packages/client/watch.ts. */
class ConversationWatch(
    val client: HarnessClient,
    val target: ConversationTarget,
    private val min: Long = 50,
    private val max: Long = 100,
    dispatcher: CoroutineDispatcher = Dispatchers.Default,
) : Closeable {
    private val scope = CoroutineScope(SupervisorJob() + dispatcher)
    private val mutex = Mutex()
    private val mutableState = MutableStateFlow(WatchState())
    val state: StateFlow<WatchState> = mutableState.asStateFlow()
    private var watchId: String? = null
    private var releaseWatch: (() -> Unit)? = null
    private var attachment: Job? = null
    private var rawView: JsonElement? = null
    private var cursor: Map<String, JsonElement>? = null
    private var initializedEarlier = false
    private var hasMore = false
    private var attaching = false
    private var generation = 0
    private var stopped = false
    private var retryAttempt = 0
    private var retry: Job? = null
    // The response and first event can arrive in the same socket tick. Never drop that event.
    private val duringAttach = mutableListOf<ProtocolEvent>()

    init {
        require(min > 0 && max >= min)
        scope.launch(start = CoroutineStart.UNDISPATCHED) {
            client.events.collect { event ->
                if (event !is ConversationViewEvent && event !is ConversationWatchEndedEvent) return@collect
                mutex.withLock {
                    if (stopped) return@withLock
                    if (attaching && watchId == null) duringAttach.add(event) else accept(event)
                }
            }
        }
        scope.launch {
            client.state.collect { connection ->
                mutex.withLock {
                    if (stopped) return@withLock
                    if (connection.status == ConnectionStatus.Ready) {
                        if (state.value.status != WatchStatus.Ended) attach()
                    } else {
                        generation++
                        watchId = null
                        releaseWatch = null
                        attaching = false
                        duringAttach.clear()
                        if (state.value.status == WatchStatus.Live) mutableState.value = state.value.copy(status = WatchStatus.Reconnecting)
                    }
                }
            }
        }
    }

    /** Must hold mutex; network work runs outside it. */
    private fun attach() {
        if (stopped || attaching || watchId != null || client.state.value.status != ConnectionStatus.Ready) return
        attaching = true
        val token = generation
        val from = state.value.view?.entries?.lastOrNull()?.id // NOT oldest merged/page entry, not a revision.
        mutableState.value = state.value.copy(status = if (from == null) WatchStatus.Connecting else WatchStatus.Reconnecting)
        attachment = scope.launch {
            try {
                val attached = client.attachWatch(ConversationWatchRequest(projectId = target.projectId, threadId = target.threadId, workerId = target.workerId, from = from, min = min, max = max))
                val response = attached.response
                mutex.withLock {
                    if (stopped || token != generation) { attached.release(); return@withLock }
                    watchId = response.watchId
                    releaseWatch = attached.release
                    rawView = attached.rawView
                    if (!initializedEarlier) { initializedEarlier = true; hasMore = response.view.before != null }
                    cursor = null
                    mutableState.value = state.value.copy(status = WatchStatus.Live, view = response.view, entries = merge(state.value.entries, response.view.entries), canLoadEarlier = hasMore, error = null)
                    attaching = false
                    retryAttempt = 0
                    retry?.cancel(); retry = null
                    val queued = duringAttach.toList(); duringAttach.clear()
                    queued.forEach(::accept)
                }
            } catch (error: Exception) {
                if (error is CancellationException) throw error
                mutex.withLock {
                    if (stopped || token != generation) return@withLock
                    attaching = false
                    duringAttach.clear()
                    if (isPermanentWatchError((error as? ClientException)?.code)) {
                        mutableState.value = state.value.copy(status = WatchStatus.Ended, error = error.message)
                    } else recover(error.message)
                }
            }
        }
    }

    private fun accept(event: ProtocolEvent) {
        when (event) {
            is ConversationViewEvent -> if (event.watchId == watchId) {
                try {
                    val nextRaw = applyChord(rawView ?: return, event.ops.map { it.jsonArray })
                    val next = wireJson.decodeFromJsonElement(ConversationView.serializer(), nextRaw)
                    rawView = nextRaw
                    mutableState.value = state.value.copy(view = next, entries = merge(state.value.entries, next.entries), error = null)
                } catch (error: Exception) { recover("Could not apply view update: ${error.message}") }
            }
            is ConversationWatchEndedEvent -> if (event.watchId == watchId) recover(event.message ?: "Watch ended (${event.reason})")
            else -> Unit
        }
    }

    private fun recover(message: String?) {
        releaseWatch?.invoke(); releaseWatch = null; watchId = null
        mutableState.value = state.value.copy(status = WatchStatus.Reconnecting, error = message)
        if (stopped || retry?.isActive == true) return
        retry = scope.launch {
            delay(reconnectDelay(retryAttempt++))
            mutex.withLock { retry = null; attach() }
        }
    }

    suspend fun loadEarlier(limit: Long = 50): Boolean {
        val request = mutex.withLock {
            if (stopped || state.value.loadingEarlier || !hasMore) return false
            mutableState.value = state.value.copy(loadingEarlier = true, canLoadEarlier = false, earlierError = null)
            ConversationPageRequest(projectId = target.projectId, threadId = target.threadId, workerId = target.workerId, limit = limit,
                before = if (cursor == null) state.value.entries.firstOrNull()?.id else null, cursor = cursor)
        }
        return try {
            val response = client.request(request)
            mutex.withLock {
                cursor = response.next
                hasMore = response.next != null && response.entries.isNotEmpty()
                mutableState.value = state.value.copy(entries = merge(state.value.entries, response.entries), earlierError = null)
            }
            response.entries.isNotEmpty()
        } catch (error: Exception) {
            if (error is CancellationException) throw error
            mutex.withLock { cursor = null; mutableState.value = state.value.copy(earlierError = error.message ?: "Could not load earlier messages") }
            false
        } finally {
            withContext(NonCancellable) {
                mutex.withLock { mutableState.value = state.value.copy(loadingEarlier = false, canLoadEarlier = hasMore && !stopped) }
            }
        }
    }

    override fun close() {
        scope.launch {
            val pendingAttachment = mutex.withLock {
                if (stopped) return@launch
                stopped = true; generation++
                retry?.cancel(); retry = null
                releaseWatch?.invoke(); releaseWatch = null; watchId = null
                duringAttach.clear()
                mutableState.value = state.value.copy(status = WatchStatus.Stopped, canLoadEarlier = false)
                attachment
            }
            // Keep the bounded request alive long enough to release a late server watch ID.
            pendingAttachment?.join()
            scope.cancel()
        }
    }
}

private fun merge(older: List<EntryRecord>, incoming: List<EntryRecord>): List<EntryRecord> =
    (older.associateBy { it.id } + incoming.associateBy { it.id }).values.sortedBy { it.id }
