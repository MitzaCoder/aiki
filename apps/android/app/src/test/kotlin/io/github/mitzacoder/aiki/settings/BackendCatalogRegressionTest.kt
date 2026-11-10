package io.github.mitzacoder.aiki.settings

import io.github.mitzacoder.aiki.data.*
import io.github.mitzacoder.aiki.protocol.*
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicReference
import kotlinx.coroutines.*
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.first
import kotlinx.serialization.json.*
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import okhttp3.*
import org.junit.Assert.*
import org.junit.Test

class BackendCatalogRegressionTest {
    private class Fixture : AutoCloseable {
        val configured = AtomicBoolean(false)
        val holdNext = AtomicBoolean(false)
        val held = Channel<Pair<WebSocket,String>>(Channel.UNLIMITED)
        val socket = AtomicReference<WebSocket>()
        private val server = MockWebServer()
        private val http = OkHttpClient()
        val backend: BackendSession
        init {
            server.enqueue(MockResponse.Builder().webSocketUpgrade(object : WebSocketListener() {
                override fun onOpen(webSocket: WebSocket, response: Response) { socket.set(webSocket) }
                override fun onMessage(webSocket: WebSocket, text: String) {
                    val ws = webSocket
                    val request = wireJson.parseToJsonElement(text).jsonObject
                    val id = request.getValue("id").jsonPrimitive.content
                    when(request.getValue("type").jsonPrimitive.content) {
                        "hello" -> ws.send("""{"type":"hello","id":"$id","protocolVersion":1,"features":["models","projects","logins","credentials"],"server":{"name":"fixture","version":"1"}}""")
                        "projects.list" -> ws.send("""{"type":"projects.list","id":"$id","projects":[]}""")
                        "models.list" -> if (holdNext.compareAndSet(true,false)) held.trySend(ws to id) else reply(ws,id,configured.get())
                        "credentials.set" -> {
                            configured.set(true)
                            ws.send("""{"type":"credentials.set","id":"$id","credential":{"providerId":"p","type":"api_key","updatedAt":1}}""")
                        }
                        "credentials.delete" -> {
                            configured.set(false)
                            ws.send("""{"type":"credentials.delete","id":"$id","deleted":true}""")
                        }
                    }
                }
            }).build())
            server.start()
            val config = BackendConfig("fixture",server.url("/").toString().trimEnd('/'))
            backend = BackendSession(config,HarnessClient(config,http))
        }
        fun reply(ws: WebSocket, id: String, configured: Boolean) {
            ws.send("""{"type":"models.list","id":"$id","providers":[],"models":[{"provider":"p","modelId":"m","name":"Model","contextWindow":1000,"maxTokens":100,"input":["text"],"reasoning":false,"thinkingLevels":[],"configured":$configured}]}""")
        }
        suspend fun ready() { withTimeout(5000) { backend.models.first { it.size == 1 } } }
        override fun close() {
            backend.close(); server.close(); held.close()
            http.dispatcher.executorService.shutdownNow(); http.connectionPool.evictAll()
        }
    }

    @Test fun credentialSaveAndRemovalRefreshTheSharedConfiguredCatalog() = runBlocking {
        Fixture().use { fixture ->
            fixture.ready()
            val backend = fixture.backend
            backend.client.request(CredentialsSetRequest(providerId = "p",apiKey = "fixture-only"))
            backend.refreshModels()
            assertTrue(backend.models.value.single().configured)
            assertTrue(backend.modelCatalog.value!!.models.single().configured)
            backend.client.request(CredentialsDeleteRequest(providerId = "p"))
            backend.refreshModels()
            assertFalse(backend.models.value.single().configured)
            assertFalse(backend.modelCatalog.value!!.models.single().configured)
        }
    }

    @Test fun successfulOAuthReadWinsOverOlderInFlightCatalogResponse() = runBlocking {
        Fixture().use { fixture ->
            fixture.ready()
            fixture.holdNext.set(true)
            val older = async { fixture.backend.refreshModels() }
            val (ws,id) = withTimeout(5000) { fixture.held.receive() }
            fixture.configured.set(true)
            fixture.socket.get().send("""{"type":"credentials.login","login":{"id":"login-1","providerId":"p","status":"succeeded","events":[],"startedAt":1,"updatedAt":2}}""")
            withTimeout(5000) { fixture.backend.models.first { it.singleOrNull()?.configured == true } }
            fixture.reply(ws,id,false)
            older.await()
            assertTrue(fixture.backend.models.value.single().configured)
            assertTrue(fixture.backend.modelCatalog.value!!.models.single().configured)
        }
    }
}
