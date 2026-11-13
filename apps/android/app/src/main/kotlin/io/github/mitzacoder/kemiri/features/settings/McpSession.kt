package io.github.mitzacoder.kemiri.features.settings

import io.github.mitzacoder.kemiri.BuildConfig
import io.github.mitzacoder.kemiri.data.*
import io.github.mitzacoder.kemiri.protocol.*
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

/** In-memory only, owned by the backend session so Custom Tab return uses the initiating client. */
class McpSession(private val client: HarnessClient, private val scope: CoroutineScope) {
    private val lock = Mutex()
    private val mutableServers = MutableStateFlow<List<McpOAuthCompleteResponseServer>>(emptyList())
    val servers = mutableServers.asStateFlow()
    private val mutablePresets = MutableStateFlow<List<McpListResponsePresetsItem>>(emptyList())
    val presets = mutablePresets.asStateFlow()
    private val mutableError = MutableStateFlow<String?>(null)
    val error = mutableError.asStateFlow()
    private val mutableBusy = MutableStateFlow(false)
    val busy = mutableBusy.asStateFlow()
    val redirectUri = BuildConfig.APP_ORIGIN.trimEnd('/') + MCP_CALLBACK_PATH
    private data class Pending(val flowId: String, val state: String, val serverId: String, val authorizationUrl: String)
    @Volatile private var pending: Pending? = null

    init {
        scope.launch(start = CoroutineStart.UNDISPATCHED) {
            client.events.collect { event ->
                if (event is McpOAuthChangedEvent && client.state.value.supports(MCP_FEATURE)) {
                    mutableServers.update { rows -> rows.map { if (it.id == event.flow.serverId) it.copy(oauthFlow = event.flow) else it } }
                    if (event.flow.status != "pending" && pending?.flowId == event.flow.flowId) pending = null
                    perform { reload() }
                }
            }
        }
    }
    private fun requireSupported() { check(client.state.value.supports(MCP_FEATURE)) { "This backend does not support MCP servers." } }
    suspend fun reload() {
        requireSupported()
        val response = client.request(McpListRequest())
        mutableServers.value = response.servers
        mutablePresets.value = response.presets
        // Backend restart/removal discards flows. Never strand the phone behind an un-cancellable stale state.
        pending?.let { flow ->
            if (!mcpFlowStillPending(flow.flowId, response.servers.firstOrNull { it.id == flow.serverId }?.oauthFlow)) pending = null
        }
    }
    /** Serialize mutations and reads; never automatically retry a write after a transport error. */
    suspend fun perform(action: suspend () -> Unit) = lock.withLock {
        mutableBusy.value = true
        mutableError.value = null
        try { requireSupported(); action() }
        catch (e: CancellationException) { throw e }
        catch (e: Exception) { mutableError.value = e.message ?: "MCP request failed." }
        finally { mutableBusy.value = false }
    }
    suspend fun start(serverId: String, clientId: String? = null, clientSecret: String? = null): String? {
        var authorization: String? = null
        perform {
            check(pending == null) { "Finish or cancel the pending sign-in first." }
            val response = client.request(McpOAuthStartRequest(serverId = serverId, redirectUri = redirectUri, clientId = clientId, clientSecret = clientSecret))
            if (response.authorizationUrl.isNotBlank()) {
                val state = requireNotNull(mcpAuthorizationState(response.authorizationUrl)) { "The server returned no OAuth state." }
                pending = Pending(response.flowId, state, serverId, response.authorizationUrl)
                authorization = response.authorizationUrl
            }
            reload()
        }
        return authorization
    }
    suspend fun copySignInLink(serverId: String, clientId: String? = null, clientSecret: String? = null, copy: (String) -> Unit): Boolean = copyMcpSignInLink(
        pending?.takeIf { it.serverId == serverId }?.authorizationUrl,
        { start(serverId, clientId, clientSecret) }, copy)
    fun accepts(url: String): Boolean = pending?.state?.let { it == mcpCallbackState(url, redirectUri) } == true
    suspend fun complete(url: String) = perform {
        val flow = pending
        require(flow != null && accepts(url)) { "No matching sign-in on this device. Start sign-in again on the original backend." }
        pending = null // One-use even if the exchange fails.
        client.request(McpOAuthCompleteRequest(flowId = flow.flowId, redirectUrl = url.trim()))
        reload()
    }
    fun receiveCallback(url: String) { scope.launch { complete(url) } }
    suspend fun cancel(flowId: String) = perform {
        client.request(McpOAuthCancelRequest(flowId = flowId))
        if (pending?.flowId == flowId) pending = null
        reload()
    }
    fun browserFailed() { mutableError.value = "No browser could open sign-in. Cancel and try again with a browser installed." }
}
