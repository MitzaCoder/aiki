package com.mihaisaru.harness.usage

import com.mihaisaru.harness.data.*
import com.mihaisaru.harness.features.usage.*
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.first
import kotlinx.serialization.json.*
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import okhttp3.*
import org.junit.Assert.*
import org.junit.Test
import java.util.concurrent.CopyOnWriteArrayList

class UsageWatchTest {
    @Test fun activeOnlyForceRefreshPushGuardErrorsAndReconnect() = runBlocking {
        val requests = CopyOnWriteArrayList<JsonObject>()
        val sockets = CopyOnWriteArrayList<WebSocket>()
        val server = MockWebServer()
        fun subscription(label: String) = """[{"providerId":"test","label":"$label","plan":null,"account":null,"windows":[],"source":"usage_api","updatedAt":null,"error":null}]"""
        fun listener(supported: Boolean) = object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) { sockets.add(webSocket) }
            override fun onMessage(webSocket: WebSocket, text: String) {
                val r = wireJson.parseToJsonElement(text).jsonObject
                val id = r.getValue("id").jsonPrimitive.content
                when(r.getValue("type").jsonPrimitive.content) {
                    "hello" -> webSocket.send("""{"type":"hello","id":"$id","protocolVersion":1,"server":{"name":"stub","version":"1"},"features":${if(supported) "[\"subscription-usage\"]" else "[]"}}""")
                    "subscriptions.usage" -> {
                        requests.add(r)
                        if(requests.size == 1) {
                            webSocket.send("""{"type":"subscriptions.usage.changed","subscriptions":${subscription("new push")}}""")
                            webSocket.send("""{"type":"subscriptions.usage","id":"$id","subscriptions":${subscription("old answer")}}""")
                        } else if(r["refresh"] == JsonPrimitive(true)) {
                            webSocket.send("""{"type":"error","id":"$id","error":{"code":"failed","message":"Provider unavailable"}}""")
                        } else webSocket.send("""{"type":"subscriptions.usage","id":"$id","subscriptions":${subscription("reconnected")}}""")
                    }
                }
            }
        }
        server.enqueue(MockResponse.Builder().webSocketUpgrade(listener(true)).build())
        server.enqueue(MockResponse.Builder().webSocketUpgrade(listener(true)).build())
        server.enqueue(MockResponse.Builder().webSocketUpgrade(listener(false)).build())
        server.start()
        val http = OkHttpClient()
        val client = HarnessClient(BackendConfig("test", server.url("/").toString().trimEnd('/')), http)
        var job: Job? = null
        try {
            client.connect()
            withTimeout(10000) { client.state.first { it.status == ConnectionStatus.Ready } }
            delay(100)
            assertTrue(requests.isEmpty())
            val watch = UsageWatch(client)
            job = launch { watch.observe() }
            withTimeout(10000) { watch.state.first { it.loaded } }
            delay(100)
            assertEquals("new push", watch.state.value.subscriptions.single().label)
            assertNull(requests.first()["refresh"])
            watch.refresh()
            withTimeout(10000) { watch.state.first { it.error != null } }
            assertEquals(JsonPrimitive(true), requests.last()["refresh"])
            assertEquals("new push", watch.state.value.subscriptions.single().label)
            sockets.first().close(1012, "restart")
            withTimeout(10000) { watch.state.first { it.subscriptions.firstOrNull()?.label == "reconnected" } }
            assertEquals(3, requests.size)
            job.cancelAndJoin()
            val count = requests.size
            sockets.last().close(1012, "restart unsupported")
            withTimeout(10000) { client.state.first { it.status != ConnectionStatus.Ready } }
            withTimeout(10000) { client.state.first { it.status == ConnectionStatus.Ready } }
            job = launch { watch.observe() }
            watch.refresh()
            delay(200)
            assertEquals(count, requests.size)
        } finally {
            job?.cancelAndJoin()
            client.close(); server.close()
            http.dispatcher.executorService.shutdownNow(); http.connectionPool.evictAll()
        }
    }
}
