package io.github.mitzacoder.aiki.data

import io.github.mitzacoder.aiki.core.reconnectDelay
import io.github.mitzacoder.aiki.protocol.*
import java.io.Closeable
import java.util.concurrent.ConcurrentHashMap
import kotlinx.coroutines.*
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.*
import kotlinx.serialization.DeserializationStrategy
import kotlinx.serialization.json.*
import okhttp3.*
import okio.ByteString
import okio.ByteString.Companion.toByteString

val wireJson = Json { ignoreUnknownKeys = true; encodeDefaults = false }
fun withExplicitNulls(value: JsonObject, fields: Set<String>) = JsonObject(value + fields.associateWith { JsonNull })

class ClientException(val code: String, message: String, val detail: JsonElement? = null) : Exception(message)
enum class ConnectionStatus { Idle, Connecting, Ready, Reconnecting, Closed }
data class ConnectionState(
    val status: ConnectionStatus = ConnectionStatus.Idle,
    /** The reconnect attempt, shown as "Reconnecting (n)…"; zero while connected (web `ClientState.attempt`). */
    val attempt: Int = 0,
    /**
     * The newest hello. It stays through a reconnect, so what the backend supports does not flicker while it is away
     * (as on the web); the next hello replaces it.
     */
    val hello: HelloResponse? = null,
    val error: String? = null,
    /**
     * Counts the sockets this client has had ready. A terminal attaches again when it changes, even if the states in
     * between were never observed (a drop and a reconnect shorter than a collector's turn).
     */
    val generation: Int = 0,
) {
    fun supports(feature: String) = hello?.let { feature in (it.features ?: DEFAULT_HARNESS_FEATURES) } == true
}

/** One thing that arrived on the socket, kept in order: terminal frames are binary, everything else is text. */
private sealed interface Incoming {
    val source: WebSocket
    class Text(override val source: WebSocket, val text: String) : Incoming
    class Binary(override val source: WebSocket, val bytes: ByteArray) : Incoming
}

internal data class WatchAttachment(
    val response: ConversationWatchResponse,
    val rawView: JsonElement,
    val release: () -> Unit,
)

/** One socket per backend, hello before any API request. Owns no Android/UI lifecycle. */
class HarnessClient(
    val backend: BackendConfig,
    private val http: OkHttpClient = OkHttpClient.Builder().pingInterval(30, java.util.concurrent.TimeUnit.SECONDS).build(),
    dispatcher: CoroutineDispatcher = Dispatchers.Default,
    private val requestTimeoutMs: Long = 30_000,
    val deviceAuth: DeviceAuth? = null,
) : Closeable {
    private val socketHttp = if (deviceAuth != null) http.newBuilder().followRedirects(false).followSslRedirects(false).build() else http
    private val scope = CoroutineScope(SupervisorJob() + dispatcher)
    private val mutableState = MutableStateFlow(ConnectionState())
    val state: StateFlow<ConnectionState> = mutableState.asStateFlow()
    private val mutableEvents = MutableSharedFlow<ProtocolEvent>(extraBufferCapacity = 64)
    /** Events are typed; unknown future types survive as UnknownEvent. Collect before requesting snapshots. */
    val events: SharedFlow<ProtocolEvent> = mutableEvents.asSharedFlow()
    private val pending = ConcurrentHashMap<String, CompletableDeferred<JsonObject>>()
    private val incoming = Channel<Incoming>(Channel.UNLIMITED)
    /** The terminals attached on the current socket, by the ID the server gave them; see [openTerminal]. */
    private val terminalsById = ConcurrentHashMap<Long, TerminalSink>()
    private val terminalOpens = ConcurrentHashMap<String, TerminalSink>()
    @Volatile private var socket: WebSocket? = null
    private var connecting: Job? = null
    @Volatile private var closed = false

    init {
        scope.launch {
            for (message in incoming) {
                val source = message.source
                if (source !== socket) continue
                try {
                    if (message is Incoming.Binary) {
                        // Terminal output. Frames of a terminal this socket does not have (any more) are dropped.
                        decodeTerminalFrame(message.bytes)?.takeIf { it.kind == TERMINAL_FRAME_OUTPUT }?.let { terminalsById[it.terminalId]?.onOutput(it.payload) }
                        continue
                    }
                    val raw = wireJson.parseToJsonElement((message as Incoming.Text).text).jsonObject
                    val id = raw["id"]?.jsonPrimitive?.contentOrNull
                    val type = raw["type"]?.jsonPrimitive?.contentOrNull
                    if (id != null) {
                        // Register a terminal here, before the caller wakes, so the frames right behind the answer find it.
                        if (type == "terminal.open") terminalOpens.remove(id)?.let { sink ->
                            raw["terminalId"]?.jsonPrimitive?.longOrNull?.let { terminalsById[it] = sink }
                        }
                        pending.remove(id)?.complete(raw)
                    } else if (type == "terminal.closed") {
                        val event = wireJson.decodeFromJsonElement(TerminalClosedEvent.serializer(), raw)
                        terminalsById.remove(event.terminalId)?.onClosed(event)
                    } else if (type == "terminal.resync") {
                        raw["terminalId"]?.jsonPrimitive?.longOrNull?.let { terminalsById[it]?.onResync() }
                    } else {
                        if (type == "auth.sessionRevoked") {
                            deviceAuth?.signedOut("This device was signed out")
                            source.close(4403, "auth_revoked")
                        }
                        mutableEvents.emit(decodeProtocolEvent(raw, wireJson))
                    }
                } catch (error: CancellationException) { throw error }
                catch (error: Exception) {
                    // A malformed delta/event is a connection fault, not a dropped update.
                    failPending(ClientException("invalid_response", error.message ?: "Malformed server frame"))
                    source.close(1002, "Invalid server frame")
                }
            }
        }
    }

    @Synchronized fun connect() {
        if (closed || connecting?.isActive == true) return
        connecting = scope.launch {
            var attempt = 0
            var generation = state.value.generation
            while (isActive && !closed) {
                publishState(ConnectionState(if (attempt == 0) ConnectionStatus.Connecting else ConnectionStatus.Reconnecting, attempt, hello = state.value.hello, generation = generation))
                val opened = CompletableDeferred<Unit>()
                val ended = CompletableDeferred<Throwable>()
                val listener = object : WebSocketListener() {
                    override fun onOpen(webSocket: WebSocket, response: Response) { opened.complete(Unit) }
                    override fun onMessage(webSocket: WebSocket, text: String) { incoming.trySend(Incoming.Text(webSocket, text)) }
                    override fun onMessage(webSocket: WebSocket, bytes: ByteString) { incoming.trySend(Incoming.Binary(webSocket, bytes.toByteArray())) }
                    override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                        opened.completeExceptionally(t); ended.complete(t)
                        if (webSocket === socket) failPending(t)
                    }
                    override fun onClosing(webSocket: WebSocket, code: Int, reason: String) { webSocket.close(code, reason) }
                    override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                        val error = ClientException(if (code == 4403) "auth_revoked" else if (code == 4401) "auth_expired" else "disconnected",
                            if (code == 4403) "This device was signed out" else if (code == 4401) "Session expired" else "Socket closed ($code)")
                        opened.completeExceptionally(error); ended.complete(error)
                        if (webSocket === socket) failPending(error)
                    }
                }
                var failure: Throwable? = null
                var renewing: Job? = null
                var migrating: Job? = null
                try {
                    val accessToken = deviceAuth?.prepare()
                    val origin = normalizeBackendOrigin(backend.url)
                    // OkHttp converts HTTP(S) to WS(S) for WebSocket upgrades. No browser Origin is spoofed.
                    socket = socketHttp.newWebSocket(Request.Builder().url("$origin/ws").build(), listener)
                    transportTimeout("WebSocket upgrade") { opened.await() }
                    val helloRequest = HelloRequest(protocolVersion = 1, client = HelloRequestClient(name = "harness-android", version = "0.1.0"), auth = accessToken?.let { HelloRequestAuth(accessToken = it) })
                    val hello = exchange(helloRequest.id, wireJson.encodeToJsonElement(HelloRequest.serializer(), helloRequest).jsonObject, HelloResponse.serializer(), allowBeforeReady = true)
                    if (hello.protocolVersion != 1L) throw ClientException("unsupported_protocol", "Unsupported protocol ${hello.protocolVersion}")
                    if (hello.features?.contains("device-auth-v1") == true) deviceAuth?.advertised(hello.backendId, hello.auth?.mode)
                    attempt = 0
                    publishState(ConnectionState(ConnectionStatus.Ready, hello = hello, generation = ++generation))
                    if (deviceAuth != null) {
                        migrating = scope.launch { deviceAuth.migrate { socket?.close(1000, "Authenticated reconnect") } }
                        if (accessToken != null) renewing = scope.launch {
                            runCatching { deviceAuth.acknowledgeStored() }
                            while (isActive) {
                                delay(deviceAuth.renewalDelay())
                                try { request(AuthRenewRequest(accessToken = deviceAuth.refresh())) }
                                catch (error: CancellationException) { throw error }
                                catch (error: Exception) {
                                    ended.complete(error)
                                    socket?.close(1000, "Authentication renewal failed")
                                    return@launch
                                }
                            }
                        }
                    }
                    failure = ended.await()
                } catch (error: CancellationException) { throw error }
                catch (error: Exception) { failure = error }
                finally {
                    renewing?.cancel(); migrating?.cancel()
                    socket?.cancel(); socket = null
                    failPending(failure ?: ClientException("disconnected", "Connection closed"))
                    dropTerminals()
                }
                if (closed) break
                val failureCode = (failure as? ClientException)?.code
                val authFailure = failureCode in setOf("auth_required", "auth_invalid", "auth_expired", "auth_revoked", "auth_downgrade", "auth_origin_changed", "auth_update_required") ||
                    (failure is DeviceAuthHttpException && failure.status in setOf(401, 403))
                if (authFailure && failureCode !in setOf("auth_downgrade", "auth_origin_changed", "auth_update_required")) {
                    deviceAuth?.signedOut(if (failureCode == "auth_required") "Pair this backend" else if (failureCode == "auth_revoked" || (failure is DeviceAuthHttpException && failure.status == 403)) "This device was signed out" else "Session expired")
                }
                if (authFailure) deviceAuth?.blocked(failure.message ?: "Pair this backend")
                val permanent = failureCode == "unsupported_protocol" || authFailure
                publishState(ConnectionState(if (permanent) ConnectionStatus.Closed else ConnectionStatus.Reconnecting, attempt, hello = state.value.hello, error = failure.message, generation = generation))
                if (permanent) break
                delay(maxOf(reconnectDelay(attempt++), (failure as? DeviceAuthHttpException)?.takeIf { it.status == 429 }?.retryAfterMs ?: 0))
            }
        }
    }

    /** Pairing changes identity only on a fresh socket. */
    fun reconnectAuthenticated() {
        val previous = connecting
        previous?.cancel()
        socket?.cancel()
        scope.launch { previous?.join(); connect() }
    }

    /** Typed overloads generated in Requests.kt call this. Mutations are NEVER replayed after a drop. */
    suspend fun <T> exchange(id: String, request: JsonObject, serializer: DeserializationStrategy<T>, allowBeforeReady: Boolean = false): T {
        if (!allowBeforeReady && state.value.status != ConnectionStatus.Ready) throw ClientException("not_ready", "Backend is not connected")
        val active = socket ?: throw ClientException("disconnected", "No socket")
        return wireJson.decodeFromJsonElement(serializer, exchangeOn(active, id, request, allowBeforeReady))
    }

    internal suspend fun attachWatch(request: ConversationWatchRequest): WatchAttachment {
        val active = socket ?: throw ClientException("disconnected", "No socket")
        val raw = exchangeOn(active, request.id, wireJson.encodeToJsonElement(ConversationWatchRequest.serializer(), request).jsonObject)
        val response = wireJson.decodeFromJsonElement(ConversationWatchResponse.serializer(), raw)
        return WatchAttachment(response, raw.getValue("view")) {
            // Cleanup belongs to the connection, not the screen's soon-to-be-cancelled scope.
            scope.launch {
                val unwatch = ConversationUnwatchRequest(watchId = response.watchId)
                try {
                    exchangeOn(active, unwatch.id, wireJson.encodeToJsonElement(ConversationUnwatchRequest.serializer(), unwatch).jsonObject)
                } catch (error: CancellationException) { throw error }
                catch (_: Exception) { /* A disconnected socket has already released its watches. */ }
            }
        }
    }

    /**
     * Attach a terminal on this socket: sends [open] and routes the terminal's binary output and events to [sink]
     * from the moment the answer arrives. The server detaches every terminal of a socket when it closes, so [sink] hears
     * [TerminalSink.onConnectionLost] and opens again once the client is ready.
     */
    suspend fun openTerminal(sink: TerminalSink, open: TerminalOpenRequest): TerminalOpenResponse {
        terminalOpens[open.id] = sink
        try { return request(open) }
        finally { terminalOpens.remove(open.id) }
    }

    /** Forget a terminal's sink (its tab went away); output for it is dropped. */
    fun releaseTerminal(sink: TerminalSink) {
        terminalsById.entries.removeIf { it.value === sink }
    }

    /** Send a binary terminal frame; false when there is no socket to put it on. */
    fun sendBinary(frame: ByteArray): Boolean = socket?.send(frame.toByteString()) ?: false

    private fun dropTerminals() {
        val lost = terminalsById.values.toList()
        terminalsById.clear()
        lost.forEach { it.onConnectionLost() }
    }

    private suspend fun exchangeOn(active: WebSocket, id: String, request: JsonObject, allowBeforeReady: Boolean = false): JsonObject {
        if (closed || active !== socket) throw ClientException("disconnected", "Socket is no longer connected")
        if (!allowBeforeReady && state.value.status != ConnectionStatus.Ready) throw ClientException("not_ready", "Backend is not connected")
        val reply = CompletableDeferred<JsonObject>()
        check(pending.putIfAbsent(id, reply) == null) { "Duplicate in-flight request ID" }
        try {
            if (!active.send(request.toString())) throw ClientException("disconnected", "Socket refused request")
            val raw = transportTimeout("Response to ${request["type"]}") { reply.await() }
            if (raw["type"]?.jsonPrimitive?.content == "error") {
                val error = wireJson.decodeFromJsonElement(ErrorResponse.serializer(), raw).error
                throw ClientException(error.code, error.message, error.data)
            }
            if (raw["type"] != request["type"]) throw ClientException("invalid_response", "Response type does not match request")
            return raw
        } finally { pending.remove(id, reply) }
    }

    private suspend fun <T> transportTimeout(label: String, block: suspend () -> T): T = try {
        withTimeout(requestTimeoutMs) { block() }
    } catch (error: TimeoutCancellationException) {
        // An enclosing caller/lifecycle timeout is real cancellation, not a retryable transport fault.
        currentCoroutineContext().ensureActive()
        throw ClientException("timeout", "$label timed out after ${requestTimeoutMs}ms")
    }

    @Synchronized private fun publishState(next: ConnectionState) {
        if (!closed) mutableState.value = next
    }

    private fun failPending(error: Throwable) {
        pending.entries.forEach { (id, reply) -> if (pending.remove(id, reply)) reply.completeExceptionally(error) }
    }

    @Synchronized override fun close() {
        closed = true
        mutableState.value = ConnectionState(ConnectionStatus.Closed)
        socket?.close(1000, "Client closed")
        socket?.cancel(); socket = null
        failPending(ClientException("closed", "Client closed"))
        dropTerminals()
        connecting?.cancel()
        incoming.close()
        scope.cancel()
        // The HTTP client can be shared by several backends; its pool is not ours to shut down.
    }
}
