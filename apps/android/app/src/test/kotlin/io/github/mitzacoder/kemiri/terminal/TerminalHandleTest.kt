package io.github.mitzacoder.kemiri.terminal

import io.github.mitzacoder.kemiri.data.*
import java.util.concurrent.CopyOnWriteArrayList
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.first
import kotlinx.serialization.json.*
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import okhttp3.*
import okio.ByteString
import okio.ByteString.Companion.toByteString
import org.junit.Assert.*
import org.junit.Test

/** The terminal handle against a stub socket: the binary frames, the ack, reattaching the same session after a drop. */
class TerminalHandleTest {
    private class Collected : TerminalConsumer {
        val events = CopyOnWriteArrayList<String>()
        override fun output(bytes: ByteArray) { events.add("out:" + String(bytes)) }
        override fun reset() { events.add("reset") }
    }

    private class Stub {
        val requests = CopyOnWriteArrayList<JsonObject>()
        val frames = CopyOnWriteArrayList<ByteArray>()
        val sockets = CopyOnWriteArrayList<WebSocket>()
        var openError: String? = null
        private var nextTerminal = 7L

        fun listener() = object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) { sockets.add(webSocket) }
            override fun onMessage(webSocket: WebSocket, bytes: ByteString) { frames.add(bytes.toByteArray()) }
            override fun onMessage(webSocket: WebSocket, text: String) {
                val request = wireJson.parseToJsonElement(text).jsonObject
                requests.add(request)
                val id = request.getValue("id").jsonPrimitive.content
                when (request.getValue("type").jsonPrimitive.content) {
                    "hello" -> webSocket.send("""{"type":"hello","id":"$id","protocolVersion":1,"server":{"name":"stub","version":"1"},"features":["terminal"]}""")
                    "terminal.open" -> {
                        val error = openError
                        if (error != null) { webSocket.send("""{"type":"error","id":"$id","error":{"code":"$error","message":"zellij is not installed on this backend"}}"""); return }
                        val session = request["session"]?.jsonPrimitive?.content ?: "demo-1"
                        val terminal = nextTerminal++
                        webSocket.send("""{"type":"terminal.open","id":"$id","terminalId":$terminal,"session":"$session","created":${request["session"] == null},"cols":${request["cols"]},"rows":${request["rows"]}}""")
                        // Output right behind the answer: it must find the terminal registered.
                        webSocket.send(frame(1, terminal, "hello ".toByteArray()).toByteString())
                        webSocket.send(frame(1, terminal, "world".toByteArray()).toByteString())
                    }
                    "terminal.resize" -> webSocket.send("""{"type":"terminal.resize","id":"$id","terminalId":${request["terminalId"]}}""")
                    "terminal.close" -> webSocket.send("""{"type":"terminal.close","id":"$id","terminalId":${request["terminalId"]}}""")
                }
            }
        }

        fun frame(kind: Int, id: Long, payload: ByteArray) = encodeTerminalFrame(kind, id, payload)
    }

    private suspend fun <T> within(block: suspend () -> T): T = withTimeout(10_000) { block() }

    private suspend fun waitFor(condition: () -> Boolean) = within { while (!condition()) delay(10) }

    private inline fun withBackend(stub: Stub, sockets: Int = 1, block: (HarnessClient, CoroutineScope) -> Unit) {
        val server = MockWebServer()
        repeat(sockets) { server.enqueue(MockResponse.Builder().webSocketUpgrade(stub.listener()).build()) }
        server.start()
        val http = OkHttpClient()
        val client = HarnessClient(BackendConfig("test", server.url("/").toString().trimEnd('/')), http)
        val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
        try {
            client.connect()
            block(client, scope)
        } finally {
            scope.cancel(); client.close(); server.close()
            http.dispatcher.executorService.shutdownNow(); http.connectionPool.evictAll()
        }
    }

    @Test fun attachesStreamsOutputAcksWhatWasRenderedAndTypesIntoTheSession() = runBlocking {
        val stub = Stub()
        withBackend(stub) { client, scope ->
            runBlocking {
                val collected = Collected()
                val handle = TerminalHandle(client, scope, collected, session = null, prefix = "demo-shop", cwd = "/work/shop", cols = 80, rows = 24)
                handle.start()
                within { handle.state.first { it.status == TerminalStatus.Attached } }
                assertEquals("demo-1", handle.state.value.session)
                val open = stub.requests.first { it["type"]?.jsonPrimitive?.content == "terminal.open" }
                assertEquals("demo-shop", open.getValue("prefix").jsonPrimitive.content)
                assertEquals("/work/shop", open.getValue("cwd").jsonPrimitive.content)
                assertNull(open["session"])
                assertEquals(80L, open.getValue("cols").jsonPrimitive.long)
                waitFor { collected.events.size >= 2 }
                assertEquals(listOf("out:hello ", "out:world"), collected.events.toList())

                handle.processed(11)
                waitFor { stub.frames.any { it[0].toInt() == TERMINAL_FRAME_ACK } }
                val ack = stub.frames.first { it[0].toInt() == TERMINAL_FRAME_ACK }
                assertArrayEquals(byteArrayOf(3, 0, 0, 0, 7, 0, 0, 0, 11), ack)

                assertTrue(handle.write("ls\r".toByteArray()))
                waitFor { stub.frames.any { it[0].toInt() == TERMINAL_FRAME_INPUT } }
                assertArrayEquals(byteArrayOf(2, 0, 0, 0, 7, 'l'.code.toByte(), 's'.code.toByte(), 13), stub.frames.first { it[0].toInt() == TERMINAL_FRAME_INPUT })

                handle.resize(100, 30)
                waitFor { stub.requests.any { it["type"]?.jsonPrimitive?.content == "terminal.resize" } }
                val resize = stub.requests.first { it["type"]?.jsonPrimitive?.content == "terminal.resize" }
                assertEquals(100L, resize.getValue("cols").jsonPrimitive.long)
                assertEquals(30L, resize.getValue("rows").jsonPrimitive.long)
                handle.detach()
                waitFor { stub.requests.any { it["type"]?.jsonPrimitive?.content == "terminal.close" } }
                assertEquals(TerminalStatus.Detached, handle.state.value.status)
                assertFalse(handle.write("x".toByteArray()))
            }
        }
    }

    @Test fun aDroppedConnectionAttachesTheSameSessionAgainAndResetsTheScreenBeforeItsOutput() = runBlocking {
        val stub = Stub()
        withBackend(stub, sockets = 2) { client, scope ->
            runBlocking {
                val collected = Collected()
                val handle = TerminalHandle(client, scope, collected, session = "demo-shop-3", prefix = null, cwd = null, cols = 56, rows = 40)
                handle.start()
                within { handle.state.first { it.status == TerminalStatus.Attached } }
                waitFor { collected.events.size >= 2 }
                collected.events.clear()
                stub.sockets.first().close(1012, "restart")
                within { handle.state.first { it.status == TerminalStatus.Reconnecting } }
                within { handle.state.first { it.status == TerminalStatus.Attached } }
                waitFor { collected.events.size >= 3 }
                // The screen is reset first, then what zellij repaints.
                assertEquals(listOf("reset", "out:hello ", "out:world"), collected.events.toList())
                val opens = stub.requests.filter { it["type"]?.jsonPrimitive?.content == "terminal.open" }
                assertEquals(2, opens.size)
                assertEquals("demo-shop-3", opens[1].getValue("session").jsonPrimitive.content)
                assertEquals(56L, opens[1].getValue("cols").jsonPrimitive.long)
                // The new socket's terminal answers to input.
                assertTrue(handle.write("x".toByteArray()))
                waitFor { stub.frames.any { it[0].toInt() == TERMINAL_FRAME_INPUT } }
                handle.detach()
            }
        }
    }

    @Test fun aSessionTheServerEndedIsEndedAndNotOpenedAgain() = runBlocking {
        val stub = Stub()
        withBackend(stub) { client, scope ->
            runBlocking {
                val handle = TerminalHandle(client, scope, Collected(), session = "demo-1", prefix = null, cwd = null, cols = 80, rows = 24)
                handle.start()
                within { handle.state.first { it.status == TerminalStatus.Attached } }
                stub.sockets.first().send("""{"type":"terminal.closed","terminalId":7,"reason":"exited","exitCode":3}""")
                val ended = within { handle.state.first { it.status == TerminalStatus.Ended } }
                assertEquals("exited", ended.endedReason)
                assertEquals(3L, ended.exitCode)
                assertEquals("demo-1", ended.session)
                assertFalse(handle.write("x".toByteArray()))
            }
        }
    }

    @Test fun anErrorThatWillNotGetBetterFailsTheHandleWithTheServersSentence() = runBlocking {
        val stub = Stub().apply { openError = "terminal_unavailable" }
        withBackend(stub) { client, scope ->
            runBlocking {
                val handle = TerminalHandle(client, scope, Collected(), session = null, prefix = "term", cwd = null, cols = 80, rows = 24)
                handle.start()
                val failed = within { handle.state.first { it.status == TerminalStatus.Failed } }
                assertEquals("terminal_unavailable", failed.errorCode)
                assertEquals("zellij is not installed on this backend", failed.error)
            }
        }
    }

    @Test fun aResyncResetsTheScreen() = runBlocking {
        val stub = Stub()
        withBackend(stub) { client, scope ->
            runBlocking {
                val collected = Collected()
                val handle = TerminalHandle(client, scope, collected, session = "demo-1", prefix = null, cwd = null, cols = 80, rows = 24)
                handle.start()
                within { handle.state.first { it.status == TerminalStatus.Attached } }
                waitFor { collected.events.size >= 2 }
                stub.sockets.first().send("""{"type":"terminal.resync","terminalId":7}""")
                waitFor { collected.events.contains("reset") }
                handle.detach()
            }
        }
    }
}
