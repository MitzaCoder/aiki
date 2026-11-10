package io.github.mitzacoder.aiki

import io.github.mitzacoder.aiki.data.*
import io.github.mitzacoder.aiki.protocol.*
import java.util.concurrent.CopyOnWriteArrayList
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.first
import kotlinx.serialization.json.*
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import okhttp3.*
import org.junit.Assert.*
import org.junit.Test

class SocketWatchTest {
    @Test fun helloFirstTypedRequestsImmediateDeltaPagingAndResume() = runBlocking {
        val received = CopyOnWriteArrayList<JsonObject>()
        val sockets = CopyOnWriteArrayList<WebSocket>()
        val server = MockWebServer()
        fun listener(number: Int) = object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) { sockets.add(webSocket) }
            override fun onMessage(ws: WebSocket, text: String) {
                val req = wireJson.parseToJsonElement(text).jsonObject
                received.add(req)
                val id = req.getValue("id").jsonPrimitive.content
                when (req.getValue("type").jsonPrimitive.content) {
                    "hello" -> ws.send("""{"type":"hello","id":"$id","protocolVersion":1,"server":{"name":"stub","version":"1"},"features":["conversation","threads","artifacts","new-feature"]}""")
                    "conversation.watch" -> {
                        val entries = if (number == 1) """[{"id":10,"conversationId":1,"kind":"pi.user"}]""" else """[{"id":11,"conversationId":1,"kind":"pi.assistant"},{"id":12,"conversationId":1,"kind":"pi.user"}]"""
                        ws.send("""{"type":"conversation.watch","id":"$id","watchId":"w$number","conversationId":1,"view":{"conversation":{"id":1},"entries":$entries,"before":9,"docs":{}}}""")
                        if (number == 1) ws.send("""{"type":"conversation.view","watchId":"w1","ops":[["p",["entries"],1,0,[{"id":11,"conversationId":1,"kind":"pi.assistant"}]]]}""")
                    }
                    "conversation.page" -> ws.send("""{"type":"conversation.page","id":"$id","entries":[{"id":1,"conversationId":1,"kind":"pi.user"}],"next":{"opaque":"cursor"}}""")
                    "conversation.submit" -> ws.send("""{"type":"error","id":"$id","error":{"code":"no_coordinator_model","message":"Choose a model"}}""")
                    "threads.list" -> ws.send("""{"type":"threads.list","id":"$id","threads":[]}""")
                    "artifacts.list" -> ws.send("""{"type":"artifacts.list","id":"$id","artifacts":[]}""")
                    "conversation.unwatch" -> ws.send("""{"type":"conversation.unwatch","id":"$id","watchId":"w$number"}""")
                }
            }
        }
        server.enqueue(MockResponse.Builder().webSocketUpgrade(listener(1)).build())
        server.enqueue(MockResponse.Builder().webSocketUpgrade(listener(2)).build())
        server.start()
        val http = OkHttpClient()
        val client = HarnessClient(BackendConfig("test", server.url("/").toString().trimEnd('/')), http)
        try {
            client.connect()
            withTimeout(10_000) { client.state.first { it.status == ConnectionStatus.Ready } }
            assertTrue(client.state.value.supports("threads"))
            assertTrue(client.state.value.supports("new-feature"))
            assertFalse(client.state.value.supports("board"))
            val watch = ConversationWatch(client, ConversationTarget("p", threadId = "research", workerId = "foundation"))
            try {
                withTimeout(10_000) { watch.state.first { it.entries.lastOrNull()?.id == 11L } }
                assertTrue(watch.loadEarlier())
                assertEquals(listOf(1L,10L,11L), watch.state.value.entries.map { it.id })
                sockets.first().close(1012, "restart")
                withTimeout(10_000) { watch.state.first { it.entries.lastOrNull()?.id == 12L } }
                assertEquals(listOf(1L,10L,11L,12L), watch.state.value.entries.map { it.id })
                val attaches = received.filter { it["type"]?.jsonPrimitive?.content == "conversation.watch" }
                assertEquals(2, attaches.size)
                assertNull(attaches[0]["from"])
                assertEquals(11L, attaches[1].getValue("from").jsonPrimitive.long)
                assertEquals("research", attaches[1].getValue("threadId").jsonPrimitive.content)
                assertEquals("foundation", attaches[1].getValue("workerId").jsonPrimitive.content)
                assertTrue(client.request(ThreadsListRequest(projectId = "p")).threads.isEmpty())
                assertTrue(client.request(ArtifactsListRequest(projectId = "p", threadId = "research")).artifacts.isEmpty())
                try {
                    client.request(ConversationSubmitRequest(projectId = "p", requestId = "dedupe", content = JsonPrimitive("hi"), whenBusy = "steer"))
                    fail("Must expose typed server error")
                } catch (error: ClientException) { assertEquals("no_coordinator_model", error.code) }
            } finally { watch.close() }
            assertEquals(2, received.count { it["type"]?.jsonPrimitive?.content == "hello" })
            assertEquals("hello", received.first()["type"]?.jsonPrimitive?.content)
            assertEquals("/ws", server.takeRequest().url.encodedPath)
        } finally {
            client.close(); server.close()
            http.dispatcher.executorService.shutdownNow(); http.connectionPool.evictAll()
        }
    }

    @Test fun generatedRequestsOmitAbsentButKeepExplicitNullAndDiscriminant() {
        val request = ProjectsConfigureRequest(projectId = "p")
        val encoded = withExplicitNulls(wireJson.encodeToJsonElement(ProjectsConfigureRequest.serializer(), request).jsonObject, setOf("coordinatorModel"))
        assertEquals(JsonPrimitive("projects.configure"), encoded["type"])
        assertEquals(JsonNull, encoded["coordinatorModel"])
        assertFalse(encoded.containsKey("name"))
        assertTrue(encoded.getValue("id").jsonPrimitive.content.isNotEmpty())
    }
}
