package io.github.mitzacoder.aiki

import io.github.mitzacoder.aiki.core.isPermanentWatchError
import io.github.mitzacoder.aiki.data.*
import io.github.mitzacoder.aiki.protocol.*
import java.io.Closeable
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.first
import kotlinx.serialization.json.*
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import okhttp3.*
import org.junit.Assert.*
import org.junit.Test

class ProtocolRegressionTest {
    @Test fun unansweredHelloTimesOutAndReconnectsHelloFirst() = runBlocking {
        Stub(answerHello = { it != 1 }).use { stub ->
            stub.client.connect()
            withTimeout(4_000) { stub.client.state.first { it.status == ConnectionStatus.Ready } }
            assertEquals(2, stub.server.requestCount)
            assertEquals(listOf("hello", "hello"), stub.requests.map { it.second.type })
        }
    }

    @Test fun unansweredUpgradeTimesOutAndReconnects() = runBlocking {
        Stub(openingDelayMs = 1_000).use { stub ->
            stub.client.connect()
            withTimeout(4_000) { stub.client.state.first { it.status == ConnectionStatus.Ready } }
            assertEquals(2, stub.server.requestCount)
        }
    }

    @Test fun disconnectDuringHelloDoesNotWaitForRequestTimeout() = runBlocking {
        Stub(timeoutMs = 10_000, answerHello = { it != 1 }, onRequest = { number, ws, request ->
            if (number == 1 && request.type == "hello") ws.close(1012, "restart during hello")
        }).use { stub ->
            stub.client.connect()
            withTimeout(3_000) { stub.client.state.first { it.status == ConnectionStatus.Ready } }
            assertEquals(2, stub.server.requestCount)
        }
    }

    @Test fun unansweredWatchTimesOutAndRetriesOnTheSameSocket() = runBlocking {
        val attempts = AtomicInteger()
        Stub(onRequest = { _, ws, request ->
            if (request.type == "conversation.watch" && attempts.incrementAndGet() > 1) replyWatch(ws, request)
        }).use { stub ->
            stub.ready()
            val watch = ConversationWatch(stub.client, ConversationTarget("p"))
            try {
                withTimeout(4_000) { watch.state.first { it.status == WatchStatus.Live } }
                assertEquals(1, stub.server.requestCount)
                assertEquals(2, stub.requests.count { it.second.type == "conversation.watch" })
            } finally { watch.close() }
        }
    }

    @Test fun closingWhileAttachIsPendingUnwatchesTheLateResponseExactlyOnce() = runBlocking {
        Stub(timeoutMs = 5_000).use { stub ->
            stub.ready()
            val watch = ConversationWatch(stub.client, ConversationTarget("p"))
            val request = stub.awaitRequest("conversation.watch")
            watch.close()
            withTimeout(2_000) { watch.state.first { it.status == WatchStatus.Stopped } }
            replyWatch(stub.sockets.first(), request)
            stub.awaitRequest("conversation.unwatch")
            delay(400)
            assertEquals(WatchStatus.Stopped, watch.state.value.status)
            assertEquals(1, stub.requests.count { it.second.type == "conversation.unwatch" })
            assertEquals(1, stub.requests.count { it.second.type == "conversation.watch" })
        }
    }

    @Test fun unknownSnapshotFieldsRemainInTheChordBase() = runBlocking {
        Stub(onRequest = { _, ws, request ->
            if (request.type == "conversation.watch") {
                replyWatch(ws, request, """{"conversation":{"id":1,"future":{"text":"a"}},"entries":[{"id":1,"conversationId":1,"kind":"pi.user","future":{"text":"a"}}],"before":null,"docs":{}}""")
                ws.send("""{"type":"conversation.view","watchId":"w","ops":[["a",["conversation","future","text"],"b"],["a",["entries",0,"future","text"],"b"],["s",["docs","marker"],"updated"]]}""")
                // A second operation must apply against the preserved first raw revision, too.
                ws.send("""{"type":"conversation.view","watchId":"w","ops":[["t",["entries",0,"future","text"],1],["s",["docs","marker"],"done"]]}""")
            }
        }).use { stub ->
            stub.ready()
            val watch = ConversationWatch(stub.client, ConversationTarget("p"))
            try {
                val state = withTimeout(3_000) { watch.state.first { it.view?.docs?.get("marker") == JsonPrimitive("done") } }
                assertEquals(WatchStatus.Live, state.status)
                assertNull(state.error)
                assertEquals(1, stub.requests.count { it.second.type == "conversation.watch" })
            } finally { watch.close() }
        }
    }

    @Test fun absentHelloFeaturesUseTheExactTsFallback() = runBlocking {
        Stub(features = null).use { stub ->
            stub.ready()
            val state = stub.client.state.value
            for (feature in listOf("projects", "filesystem", "models", "credentials", "logins", "conversation", "workers", "context", "server-status", "memory", "schedules", "memory-maintenance", "notifications", "board", "subscription-usage", "threads", "artifacts")) {
                assertTrue("Missing fallback feature $feature", state.supports(feature))
            }
            assertFalse(state.supports("future-flag"))
            assertFalse(ConnectionState().supports("models"))
        }
    }

    @Test fun aReconnectKeepsTheLastHellosFeatures() = runBlocking {
        // Only the first connection answers hello, so the client stays away after the drop.
        Stub(features = listOf("conversation", "task-reports"), answerHello = { it == 1 }).use { stub ->
            stub.ready()
            stub.sockets.first().close(1001, "Server restart")
            val away = withTimeout(3_000) { stub.client.state.first { it.status == ConnectionStatus.Reconnecting } }
            assertTrue(away.supports("task-reports"))
            assertFalse(away.supports("models"))
        }
    }

    @Test fun explicitEmptyAndUnknownFeatureListsAreNotReplacedByFallback() = runBlocking {
        for (features in listOf(emptyList(), listOf("future-flag"))) {
            Stub(features = features).use { stub ->
                stub.ready()
                assertFalse(stub.client.state.value.supports("models"))
                assertEquals(features.contains("future-flag"), stub.client.state.value.supports("future-flag"))
            }
        }
    }

    @Test fun discriminatedUnionsDecodeEachKindAndKeepUnknownOnes() {
        val response = wireJson.decodeFromString(RefsStatusResponse.serializer(), """{"type":"refs.status","id":"r","statuses":[
            {"ref":"#1","url":"u1","title":"PR","checkedAt":"t","kind":"pull","state":"draft","checks":null},
            {"ref":"EX-1","url":"u2","title":"Ticket","checkedAt":"t","kind":"jira","status":"In review","category":"in_progress"},
            {"ref":"x","url":"u3","title":"Later","checkedAt":"t","kind":"gitlab","extra":1}]}""")
        val (pull, jira, future) = response.statuses
        assertEquals(RefStatusPull(ref = "#1", url = "u1", title = "PR", checkedAt = "t", state = "draft", checks = null), pull)
        assertEquals("In review", (jira as RefStatusJira).status)
        assertEquals("gitlab", (future as UnknownRefStatus).kind)
        // Unknown variants and known ones go back out as they came, discriminator included.
        val encoded = wireJson.encodeToJsonElement(RefsStatusResponse.serializer(), response).jsonObject.getValue("statuses").jsonArray
        assertEquals(JsonPrimitive("pull"), encoded[0].jsonObject["kind"])
        assertEquals(JsonPrimitive(1), encoded[2].jsonObject["extra"])
        val details = wireJson.decodeFromString(RefsDetailsResponse.serializer(), """{"type":"refs.details","id":"r","details":null}""")
        assertNull(details.details)
        val writer = wireJson.decodeFromString(BoardWriter.serializer(), """{"author":"worker","threadId":"main","workerId":"w1"}""")
        assertEquals("worker", writer.author)
    }

    @Test fun aBoardFromBeforeTaskReportsStillDecodes() {
        val task = wireJson.decodeFromString(BoardTask.serializer(), """{"id":"T1","revision":2,"title":"Old","description":"",
            "acceptance":null,"status":"todo","blockedBy":[],"blockedReason":null,"writeScopes":[],"workerIds":[],"scheduleId":null,
            "order":1,"createdBy":"user","updatedBy":"user","createdAt":"a","updatedAt":"b","settledAt":null,"archived":false}""")
        assertEquals(emptyList<String>(), task.refs)
        assertEquals(0L, task.snapshots)
        assertEquals("", task.report.now)
    }

    @Test fun featureHelpersRefuseWithoutTheFeatureAndSendNothing() = runBlocking {
        Stub(features = listOf("board", "ref-status"), onRequest = { _, ws, request ->
            if (request.type == "refs.status") reply(ws, request, """{"statuses":[]}""")
        }).use { stub ->
            stub.ready()
            for (call in listOf<suspend () -> Unit>(
                { stub.client.readRefDetails("p", "#1") },
                { stub.client.readCacheStats() },
                { stub.client.readProjectStorage("p") },
                { stub.client.readTaskHistory("p", "T1") },
                { stub.client.readTaskTimeline("p", "T1") },
                { stub.client.setFeedbackState("p", "T1", "F1", "dismissed") },
                { stub.client.saveBoardTask("p", BoardTaskInput(title = "t", description = "", acceptance = null, status = "todo", blockedBy = emptyList(), blockedReason = null, writeScopes = emptyList()), note = "why") },
            )) {
                val error = runCatching { call() }.exceptionOrNull()
                assertEquals("unsupported_feature", (error as ClientException).code)
            }
            assertEquals(emptyList<RefStatus>(), stub.client.readRefStatus("p", listOf("#1", "#1", "EX-2")))
            assertEquals(emptyList<RefStatus>(), stub.client.readRefStatus("p", emptyList()))
            val sent = stub.requests.map { it.second }.filter { it.type != "hello" }
            assertEquals(listOf("refs.status"), sent.map { it.type })
            assertEquals(JsonArray(listOf(JsonPrimitive("#1"), JsonPrimitive("EX-2"))), sent.single()["refs"])
        }
    }

    @Test fun timelineGroupingRequiresExplicitCapabilityAndCarriesKindFilters() = runBlocking {
        for (groupedCapability in listOf(false, true)) {
            Stub(features = listOf("board", "task-links") + if (groupedCapability) listOf("task-timeline-groups") else emptyList(), onRequest = { _, ws, request ->
                if (request.type == "board.task.timeline") reply(ws, request, """{"projectId":"p","taskId":"T1","entries":[],"feedback":[]}""")
            }).use { stub ->
                stub.ready()
                stub.client.readTaskTimeline("p", "T1", listOf("worker"), grouped = true)
                val request = stub.requests.map { it.second }.single { it.type == "board.task.timeline" }
                assertEquals(if (groupedCapability) JsonPrimitive(true) else null, request["grouped"])
                assertEquals(JsonArray(listOf(JsonPrimitive("worker"))), request["kinds"])
            }
        }
    }

    @Test fun projectBoardLoadsOnConnectTakesPushesAndReportsConflicts() = runBlocking {
        fun board(id: String) = """{"tasks":[{"id":"$id","revision":1,"title":"$id","description":"","acceptance":null,"status":"todo","blockedBy":[],
            "blockedReason":null,"writeScopes":[],"workerIds":[],"scheduleId":null,"order":1,"createdBy":"user","updatedBy":"user",
            "createdAt":"a","updatedAt":"b","settledAt":null,"archived":false}],"questions":[],"decisions":[],"updatedAt":null}"""
        Stub(features = listOf("board"), onRequest = { _, ws, request ->
            when (request.type) {
                "board.get" -> reply(ws, request, """{"board":${board("T1")}}""")
                "board.task.save" -> reply(ws, request, """{"error":{"code":"board_conflict","message":"moved on"}}""", type = "error")
            }
        }).use { stub ->
            val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
            try {
                val projectBoard = ProjectBoard(stub.client, "p", scope)
                stub.ready()
                withTimeout(2_000) { projectBoard.view.first { it.loaded } }
                assertEquals(listOf("T1"), projectBoard.view.value.tasks.map { it.id })
                stub.sockets.first().send("""{"type":"board.state","projectId":"p","board":${board("T2")}}""")
                stub.sockets.first().send("""{"type":"board.state","projectId":"other","board":${board("T9")}}""")
                withTimeout(2_000) { projectBoard.view.first { view -> view.tasks.any { it.id == "T2" } } }
                val input = projectBoard.view.value.task("T2")!!.let { BoardTaskInput(title = it.title, description = "", acceptance = null, status = "done", blockedBy = emptyList(), blockedReason = null, writeScopes = emptyList()) }
                val outcome = projectBoard.saveTask(input, taskId = "T2", expectedRevision = 1)
                // The conflict reads the board again, which the stub answers with T1.
                assertEquals(SaveOutcome.Conflict(null), outcome)
                assertEquals(2, stub.requests.count { it.second.type == "board.get" })
                assertFalse("refs" in stub.awaitRequest("board.task.save").getValue("task").jsonObject)
            } finally { scope.cancel() }
        }
    }

    @Test fun clearingAProjectSettingSendsAnExplicitNull() = runBlocking {
        Stub().use { stub ->
            stub.ready()
            // Unanswered: only what goes out matters here.
            runCatching { stub.client.configureProject("p", ProjectSetting.Links(null)) }
            runCatching { stub.client.configureProject("p", ProjectSetting.LongPromptCache("all")) }
            val (links, cache) = stub.requests.map { it.second }.filter { it.type == "projects.configure" }
            assertEquals(JsonNull, links["links"])
            assertFalse("longPromptCache" in links)
            assertEquals(JsonPrimitive("all"), cache["longPromptCache"])
            assertFalse("links" in cache)
        }
    }

    @Test fun unknownThreadIsPermanentAndKeepsThreadRouting() = runBlocking {
        assertTrue(isPermanentWatchError("unknown_thread"))
        Stub(onRequest = { _, ws, request ->
            if (request.type == "conversation.watch") reply(ws, request, """{"error":{"code":"unknown_thread","message":"Thread removed"}}""", "error")
        }).use { stub ->
            stub.ready()
            val watch = ConversationWatch(stub.client, ConversationTarget("p", threadId = "gone", workerId = "worker"))
            try {
                withTimeout(2_000) { watch.state.first { it.status == WatchStatus.Ended } }
                delay(600)
                val request = stub.awaitRequest("conversation.watch")
                assertEquals(JsonPrimitive("gone"), request["threadId"])
                assertEquals(JsonPrimitive("worker"), request["workerId"])
                assertEquals(1, stub.requests.count { it.second.type == "conversation.watch" })
            } finally { watch.close() }
        }
    }

    @Test fun callerCancellationIsNotARequestTimeoutAndDoesNotReplay() = runBlocking {
        Stub(timeoutMs = 300).use { stub ->
            stub.ready()
            val request = launch { stub.client.request(ProjectsListRequest()) }
            stub.awaitRequest("projects.list")
            request.cancelAndJoin()
            delay(600)
            assertTrue(request.isCancelled)
            assertEquals(ConnectionStatus.Ready, stub.client.state.value.status)
            assertEquals(1, stub.requests.count { it.second.type == "projects.list" })
        }
    }

    @Test fun enclosingTimeoutRemainsCancellationRatherThanAClientError() = runBlocking {
        Stub(timeoutMs = 10_000).use { stub ->
            stub.ready()
            try {
                withTimeout(150) { stub.client.request(ProjectsListRequest()) }
                fail("The caller's timeout must cancel its request")
            } catch (_: TimeoutCancellationException) { /* Expected caller cancellation. */ }
            assertEquals(ConnectionStatus.Ready, stub.client.state.value.status)
            assertEquals(1, stub.requests.count { it.second.type == "projects.list" })
        }
    }

    @Test fun pageTimeoutIsRetryableWithoutCancellingItsCaller() = runBlocking {
        val attempts = AtomicInteger()
        Stub(onRequest = { _, ws, request ->
            if (request.type == "conversation.watch") replyWatch(ws, request, """{"conversation":{"id":1},"entries":[{"id":10,"conversationId":1,"kind":"pi.user"}],"before":9,"docs":{}}""")
            if (request.type == "conversation.page" && attempts.incrementAndGet() > 1) reply(ws, request, """{"entries":[{"id":1,"conversationId":1,"kind":"pi.user"}]}""")
        }).use { stub ->
            stub.ready()
            val watch = ConversationWatch(stub.client, ConversationTarget("p"))
            try {
                withTimeout(2_000) { watch.state.first { it.status == WatchStatus.Live } }
                val first = async { watch.loadEarlier() }
                stub.awaitRequest("conversation.page")
                assertFalse(watch.loadEarlier()) // One request even when the UI and a highlight both trigger.
                assertEquals(1, attempts.get())
                assertFalse(first.await())
                assertFalse(watch.state.value.loadingEarlier)
                assertTrue(watch.state.value.canLoadEarlier)
                assertTrue(watch.state.value.earlierError.orEmpty().contains("timed out"))
                assertNull(watch.state.value.error)
                assertTrue(watch.loadEarlier())
                assertNull(watch.state.value.earlierError)
                assertEquals(listOf(1L, 10L), watch.state.value.entries.map { it.id })
                assertFalse(watch.state.value.canLoadEarlier)
            } finally { watch.close() }
        }
    }

    @Test fun releaseFromAnOldSocketCannotUnwatchTheSameIdOnANewSocket() = runBlocking {
        Stub(onRequest = { _, ws, request ->
            if (request.type == "conversation.watch") replyWatch(ws, request)
        }).use { stub ->
            stub.ready()
            val old = stub.client.attachWatch(ConversationWatchRequest(projectId = "p"))
            stub.sockets.first().close(1012, "restart")
            withTimeout(3_000) {
                while (stub.sockets.size < 2) delay(10)
                stub.client.state.first { it.status == ConnectionStatus.Ready }
            }
            val current = stub.client.attachWatch(ConversationWatchRequest(projectId = "p"))
            old.release()
            delay(400)
            assertEquals(0, stub.requests.count { it.second.type == "conversation.unwatch" })
            current.release()
            stub.awaitRequest("conversation.unwatch")
            assertEquals(listOf(2), stub.requests.filter { it.second.type == "conversation.unwatch" }.map { it.first })
        }
    }

    @Test fun closingClientDuringHelloNeverReconnectsOrPublishesReady() = runBlocking {
        Stub(answerHello = { false }).use { stub ->
            stub.client.connect()
            stub.awaitRequest("hello")
            stub.client.close()
            delay(800)
            assertEquals(ConnectionStatus.Closed, stub.client.state.value.status)
            assertEquals(1, stub.server.requestCount)
        }
    }

    private class Stub(
        val timeoutMs: Long = 300,
        val openingDelayMs: Long = 0,
        val features: List<String>? = listOf("conversation", "threads"),
        val answerHello: (Int) -> Boolean = { true },
        val onRequest: (Int, WebSocket, JsonObject) -> Unit = { _, _, _ -> },
    ) : Closeable {
        val server = MockWebServer()
        val http = OkHttpClient()
        val sockets = CopyOnWriteArrayList<WebSocket>()
        val requests = CopyOnWriteArrayList<Pair<Int, JsonObject>>()
        val client: HarnessClient

        init {
            for (number in 1..6) server.enqueue(MockResponse.Builder().apply {
                if (number == 1 && openingDelayMs > 0) headersDelay(openingDelayMs, TimeUnit.MILLISECONDS)
            }.webSocketUpgrade(object : WebSocketListener() {
                override fun onOpen(webSocket: WebSocket, response: Response) { sockets.add(webSocket) }
                override fun onMessage(webSocket: WebSocket, text: String) {
                    val request = wireJson.parseToJsonElement(text).jsonObject
                    requests.add(number to request)
                    if (request.type == "hello" && answerHello(number)) {
                        val fields = buildJsonObject {
                            put("protocolVersion", 1)
                            put("server", buildJsonObject { put("name", "stub"); put("version", "1") })
                            if (features != null) put("features", JsonArray(features.map(::JsonPrimitive)))
                        }
                        reply(webSocket, request, fields.toString())
                    }
                    if (request.type == "conversation.unwatch") reply(webSocket, request, """{"watchId":${request.getValue("watchId")}}""")
                    onRequest(number, webSocket, request)
                }
            }).build())
            server.start()
            client = HarnessClient(BackendConfig("test", server.url("/").toString()), http, requestTimeoutMs = timeoutMs)
        }

        suspend fun ready() {
            client.connect()
            withTimeout(3_000) { client.state.first { it.status == ConnectionStatus.Ready } }
        }

        suspend fun awaitRequest(type: String): JsonObject = withTimeout(2_000) {
            while (requests.none { it.second.type == type }) delay(10)
            requests.first { it.second.type == type }.second
        }

        override fun close() {
            client.close()
            server.close()
            http.dispatcher.executorService.shutdownNow()
            http.connectionPool.evictAll()
        }
    }

    private companion object {
        val JsonObject.type: String get() = getValue("type").jsonPrimitive.content
        fun reply(ws: WebSocket, request: JsonObject, payload: String, type: String = request.type) {
            ws.send(JsonObject(wireJson.parseToJsonElement(payload).jsonObject + mapOf("type" to JsonPrimitive(type), "id" to request.getValue("id"))).toString())
        }
        fun replyWatch(ws: WebSocket, request: JsonObject, view: String = """{"conversation":{"id":1},"entries":[],"docs":{}}""") {
            reply(ws, request, """{"watchId":"w","conversationId":1,"view":$view}""")
        }
    }
}
