package io.github.mitzacoder.aiki.settings

import io.github.mitzacoder.aiki.data.*
import io.github.mitzacoder.aiki.features.settings.mergeLogin
import io.github.mitzacoder.aiki.features.settings.LoginSnapshots
import io.github.mitzacoder.aiki.protocol.AuthLogin
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicReference
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.first
import kotlinx.serialization.json.*
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import okhttp3.*
import org.junit.Assert.*
import org.junit.Test

class AuthLifecycleRegressionTest {
    private fun login(start: Long, status: String, updated: Long = start) =
        AuthLogin("login-1", "p", status, null, emptyList(), null, start, updated)

    @Test fun authoritativeLoginCanReuseIdEvenWhenRestartedClockMovesBackwards() {
        val old = login(200, "cancelled", 220)
        val fresh = login(100, "working", 110)
        assertEquals(fresh, mergeLogin(mapOf(old.id to old), fresh)[old.id])
    }

    @Test fun authoritativeSnapshotsReplaceOldIncarnationsAndRetireTheirPushes() {
        val snapshots = LoginSnapshots()
        val old = login(200, "cancelled", 250)
        snapshots.push(old)
        val read = snapshots.beginRead()
        val fresh = login(100, "working", 110)
        snapshots.replace(read, listOf(fresh))
        assertEquals(fresh, snapshots.logins[old.id])
        assertFalse(snapshots.push(old.copy(updatedAt = 999)))
        assertEquals(fresh, snapshots.logins[old.id])
        snapshots.replace(snapshots.beginRead(), emptyList())
        assertTrue(snapshots.logins.isEmpty())
        snapshots.push(fresh.copy(updatedAt = 120))
        assertTrue(snapshots.logins.isEmpty())
    }

    @Test fun newerPushWinsOverStaleReadAndTerminalCannotReviveWithinIncarnation() {
        val snapshots = LoginSnapshots()
        snapshots.push(login(100, "working", 110))
        val read = snapshots.beginRead()
        val finished = login(100, "succeeded", 150)
        snapshots.push(finished)
        snapshots.replace(read, listOf(login(100, "working", 120)))
        assertEquals(finished, snapshots.logins["login-1"])
        snapshots.push(login(100, "prompt", 160))
        assertEquals(finished, snapshots.logins["login-1"])
    }

    @Test fun newPushAbsentFromInFlightListSurvivesButOlderListsDoNotAccumulate() {
        val snapshots = LoginSnapshots()
        val oldRead = snapshots.beginRead()
        val newerRead = snapshots.beginRead()
        val fresh = login(100, "working")
        snapshots.push(fresh)
        snapshots.replace(newerRead, emptyList())
        assertEquals(fresh, snapshots.logins[fresh.id])
        snapshots.replace(oldRead, listOf(login(200, "failed")))
        assertEquals(fresh, snapshots.logins[fresh.id])
        snapshots.replace(snapshots.beginRead(), emptyList())
        assertTrue(snapshots.logins.isEmpty())
    }

    @Test fun startResponseSelectsClockRollbackIncarnationAndKeepsItsNewerPush() {
        val snapshots = LoginSnapshots()
        snapshots.push(login(200, "cancelled", 220))
        val start = snapshots.beginRead()
        val terminal = login(100, "succeeded", 130)
        assertTrue(snapshots.push(terminal))
        snapshots.started(start, login(100, "working", 110))
        assertEquals(terminal, snapshots.logins["login-1"])
        snapshots.push(login(200, "working", 1000))
        assertEquals(terminal, snapshots.logins["login-1"])
    }

    @Test fun foreignPushDuringOldReadRemainsAvailableForAuthoritativeReconciliation() {
        val snapshots = LoginSnapshots()
        val old = login(200, "cancelled", 220)
        snapshots.push(old)
        val oldRead = snapshots.beginRead()
        val fresh = login(100, "succeeded", 150)
        assertTrue(snapshots.push(fresh))
        snapshots.replace(oldRead, listOf(old))
        snapshots.replace(snapshots.beginRead(), listOf(login(100, "working", 110)))
        assertEquals(fresh, snapshots.logins[fresh.id])
    }

    @Test fun successfulOAuthRefreshesBackendModelsWithoutAProviderPanel() = runBlocking {
        val socket = AtomicReference<WebSocket>()
        val modelReads = AtomicInteger()
        val server = MockWebServer()
        server.enqueue(MockResponse.Builder().webSocketUpgrade(object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) { socket.set(webSocket) }
            override fun onMessage(webSocket: WebSocket, text: String) {
                val ws = webSocket
                val request = wireJson.parseToJsonElement(text).jsonObject
                val id = request.getValue("id").jsonPrimitive.content
                when(request.getValue("type").jsonPrimitive.content) {
                    "hello" -> ws.send("""{"type":"hello","id":"$id","protocolVersion":1,"features":["models","projects","logins"],"server":{"name":"fixture","version":"1"}}""")
                    "projects.list" -> ws.send("""{"type":"projects.list","id":"$id","projects":[]}""")
                    "models.list" -> {
                        val configured = modelReads.incrementAndGet() > 1
                        ws.send("""{"type":"models.list","id":"$id","providers":[],"models":[{"provider":"p","modelId":"m","name":"Model","contextWindow":1000,"maxTokens":100,"input":["text"],"reasoning":false,"thinkingLevels":[],"configured":$configured}]}""")
                    }
                }
            }
        }).build())
        server.start()
        val http = OkHttpClient()
        val config = BackendConfig("fixture",server.url("/").toString().trimEnd('/'))
        val backend = BackendSession(config,HarnessClient(config,http))
        try {
            withTimeout(5000) { backend.models.first { it.size == 1 } }
            assertFalse(backend.models.value.single().configured)
            socket.get().send("""{"type":"credentials.login","login":{"id":"login-1","providerId":"p","status":"succeeded","events":[],"startedAt":1,"updatedAt":2}}""")
            withTimeout(3000) { backend.models.first { it.singleOrNull()?.configured == true } }
            assertEquals(2,modelReads.get())
        } finally {
            backend.close(); server.close()
            http.dispatcher.executorService.shutdownNow(); http.connectionPool.evictAll()
        }
    }
}
