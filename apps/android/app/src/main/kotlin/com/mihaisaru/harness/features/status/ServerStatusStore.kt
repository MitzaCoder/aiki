package com.mihaisaru.harness.features.status

import com.mihaisaru.harness.data.ConnectionStatus
import com.mihaisaru.harness.data.HarnessClient
import com.mihaisaru.harness.data.request
import com.mihaisaru.harness.protocol.ServerStatus
import com.mihaisaru.harness.protocol.ServerStatusEvent
import com.mihaisaru.harness.protocol.ServerStatusRequest
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.*
import java.util.concurrent.atomic.AtomicLong

/** The `server-status` feature: `server.status` and its `server.status.changed` push. */
const val SERVER_STATUS_FEATURE = "server-status"

/**
 * One backend's `server.status`: the release it runs, its last deploy and its disks. Read on every connect, replaced by
 * each `server.status.changed` push, and read again by [refresh] (an open chat asks every [SERVER_STATUS_REFRESH_MS],
 * since a disk fills without a push). Null until the first answer, and always for a backend without `server-status`.
 * Lives as long as its backend session (web twin: `BackendConnection.status` in `harness.svelte.ts`).
 */
class ServerStatusStore(private val client: HarnessClient, private val scope: CoroutineScope) {
    private val mutableStatus = MutableStateFlow<ServerStatus?>(null)
    val status: StateFlow<ServerStatus?> = mutableStatus.asStateFlow()
    /** Bumped by every push, so a read that raced one does not overwrite it. */
    private val revision = AtomicLong()

    init {
        scope.launch(start = CoroutineStart.UNDISPATCHED) {
            client.events.collect { event ->
                if (event is ServerStatusEvent) { revision.incrementAndGet(); mutableStatus.value = event.status }
            }
        }
        scope.launch {
            client.state.map { it.status == ConnectionStatus.Ready && it.supports(SERVER_STATUS_FEATURE) }.distinctUntilChanged()
                .collect { ready -> if (ready) read() }
        }
    }

    val supported: Boolean get() = client.state.value.supports(SERVER_STATUS_FEATURE)

    /** Reads it again now; a failed read keeps what was known. */
    fun refresh() {
        if (client.state.value.status == ConnectionStatus.Ready && supported) scope.launch { read() }
    }

    private suspend fun read() {
        val started = revision.get()
        try {
            val status = client.request(ServerStatusRequest()).status
            if (revision.get() == started) mutableStatus.value = status
        } catch (error: CancellationException) { throw error }
        catch (_: Exception) { /* The next connect, push or refresh tries again. */ }
    }
}
