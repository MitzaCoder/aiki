package io.github.mitzacoder.aiki.features.usage

import io.github.mitzacoder.aiki.data.*
import io.github.mitzacoder.aiki.protocol.*
import kotlinx.coroutines.*
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.*

data class UsageState(val subscriptions: List<SubscriptionUsage> = emptyList(), val loaded: Boolean = false, val loading: Boolean = false, val error: String? = null)

/** Screen/lifecycle-owned observer, never owns or closes the shared backend socket. */
class UsageWatch(private val client: HarnessClient) {
    private val mutable = MutableStateFlow(UsageState())
    val state = mutable.asStateFlow()
    private val refreshes = Channel<Unit>(Channel.CONFLATED)
    fun refresh() { refreshes.trySend(Unit) }
    suspend fun observe(): Unit = coroutineScope {
        var revision = 0L
        var request: Job? = null
        fun read(force: Boolean) {
            if(client.state.value.status != ConnectionStatus.Ready || !client.state.value.supports("subscription-usage")) return
            request?.cancel()
            val ticket = ++revision
            mutable.update { it.copy(loading = true) }
            request = launch {
                try {
                    val result = client.request(SubscriptionsUsageRequest(refresh = if(force) true else null))
                    if(ticket == revision) mutable.value = UsageState(result.subscriptions, loaded = true)
                } catch(e: CancellationException) { throw e }
                catch(e: Exception) { if(ticket == revision) mutable.update { it.copy(loading = false, error = e.message ?: "Could not read usage") } }
            }
        }
        // Subscribe synchronously before any snapshot, so a push always invalidates an older answer.
        launch(start = CoroutineStart.UNDISPATCHED) {
            client.events.collect { event ->
                if(event is SubscriptionsUsageEvent && client.state.value.supports("subscription-usage")) {
                    revision++
                    mutable.value = UsageState(event.subscriptions, loaded = true)
                }
            }
        }
        launch { refreshes.receiveAsFlow().collect { read(true) } }
        try {
            client.state.collect { connection ->
                revision++
                request?.cancel()
                mutable.update { it.copy(loading = false) }
                if(connection.status == ConnectionStatus.Ready) read(false)
            }
        } finally { request?.cancel(); mutable.update { it.copy(loading = false) } }
    }
}
