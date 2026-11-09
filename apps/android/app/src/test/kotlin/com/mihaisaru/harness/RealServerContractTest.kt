package com.mihaisaru.harness

import com.mihaisaru.harness.data.*
import com.mihaisaru.harness.protocol.*
import java.util.UUID
import java.time.Instant
import java.util.concurrent.CopyOnWriteArrayList
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.first
import kotlinx.serialization.json.*
import okhttp3.OkHttpClient
import okhttp3.Request
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Test

/** Opt-in ACTUAL startServer + actual tools, seeded by verification/launch-real.ts --seed.
 * No UI dependency, server fixture, handler monkeypatch or artifact-store write. */
class RealServerContractTest {
    @Test fun actualSnapshotsChordInputsScopeOwnershipAndSignedHttp() = runBlocking {
        val origin = System.getenv("ANDROID_REAL_CONTRACT_ORIGIN")
        assumeTrue("Real server contract run not requested", origin != null)
        require(origin!!.matches(Regex("http://127\\.0\\.0\\.1:[0-9]+")))
        val http = OkHttpClient()
        val client = HarnessClient(BackendConfig("Isolated real tool proof", origin), http)
        val events = CopyOnWriteArrayList<ProtocolEvent>()
        val observer = launch(start = CoroutineStart.UNDISPATCHED) { client.events.collect { events.add(it) } }
        fun texts(entries: List<EntryRecord>): List<String> = entries.filter { it.kind == "pi.user" }.flatMap { entry ->
            entry.model.orEmpty().mapNotNull { it.jsonObject["content"]?.let { c -> (c as? JsonPrimitive)?.content } }
        }
        try {
            client.connect()
            withTimeout(10_000) { client.state.first { it.status == ConnectionStatus.Ready } }
            assertTrue(client.state.value.supports("threads"))
            assertTrue(client.state.value.supports("artifacts"))
            val project = client.request(ProjectsListRequest()).projects.single { it.name == "Android real checkout (faux model)" }
            require(project.path.contains("/scratch/android-verification-real-smoke-")) { "Not an isolated --seed project" }
            val thread = "contract-proof"
            val background = client.request(ThreadsListRequest(projectId = project.id)).threads.single { it.id == thread }
            assertFalse(background.main)
            assertNull(client.request(BoardGetRequest(projectId = project.id)).board.tasks.single().ownerThreadId)
            assertEquals(thread, client.request(ConversationContextRequest(projectId = project.id, threadId = thread)).context.threadId)
            val main = client.request(ConversationPageRequest(projectId = project.id, limit = 200)).entries
            assertTrue(texts(main).any { it.startsWith("[thread contract-proof finished]\n") })
            assertTrue(texts(main).any { it.startsWith("[from contract-proof] ") })
            assertTrue(texts(main).any { it.startsWith("[board] Thread \"contract-proof\" handed T1") })
            assertTrue(texts(main).any { it.contains("[thread failure-proof failed:") && it.contains("[not a server fixture]]") })
            val results = main.flatMap { it.model.orEmpty() }.map { it.jsonObject }.filter { it["toolName"]?.jsonPrimitive?.content == "thread_start" }
            assertTrue(results.any { it["details"]?.jsonObject?.get("threadId")?.jsonPrimitive?.content == thread })
            val watch = ConversationWatch(client, ConversationTarget(project.id, threadId = thread))
            try {
                withTimeout(10_000) { watch.state.first { it.entries.isNotEmpty() && it.error == null } }
                assertTrue(texts(watch.state.value.entries).contains("[from main] Real steering from main"))
                val content = "R2 native ${UUID.randomUUID()}"
                val requestId = UUID.randomUUID().toString()
                client.request(ConversationSubmitRequest(projectId = project.id, threadId = thread, requestId = requestId, content = JsonPrimitive(content)))
                withTimeout(10_000) { watch.state.first { state -> state.entries.any { entry -> entry.model.orEmpty().any { it.toString().contains("Background received: $content") } } } }
                client.request(ConversationSubmitRequest(projectId = project.id, threadId = thread, requestId = requestId, content = JsonPrimitive(content)))
                assertEquals(1, texts(client.request(ConversationPageRequest(projectId = project.id, threadId = thread, limit = 200)).entries).count { it == content })
                assertEquals(main, client.request(ConversationPageRequest(projectId = project.id, limit = 200)).entries)
                assertTrue(events.any { it is ConversationViewEvent })
                assertNull(watch.state.value.error)
            } finally { watch.close() }
            val artifacts = client.request(ArtifactsListRequest(projectId = project.id, threadId = thread, taskId = "T1")).artifacts
            assertEquals(6, artifacts.size)
            assertTrue(artifacts.all { it.threadId == thread && it.taskId == "T1" })
            assertEquals(1, client.request(ArtifactsListRequest(projectId = project.id, threadId = thread, workerId = "proof-worker", taskId = "T1")).artifacts.size)
            val mainArtifacts = client.request(ArtifactsListRequest(projectId = project.id, threadId = "main")).artifacts
            assertEquals(2, mainArtifacts.size)
            assertTrue(mainArtifacts.any { it.workerId == null })
            assertTrue(mainArtifacts.any { it.workerId == "proof-worker" })
            assertEquals(2, client.request(ArtifactsListRequest(projectId = project.id, workerId = "proof-worker", taskId = "T1")).artifacts.size)
            assertEquals(1, client.request(ArtifactsListRequest(projectId = project.id, threadId = "main", workerId = "proof-worker", taskId = "T1")).artifacts.size)
            val file = artifacts.single { it.kind == "file" }
            val source = client.request(ArtifactsUrlRequest(projectId = project.id, artifactId = file.id))
            http.newCall(Request.Builder().url(source.url).header("Range", "bytes=2-9").build()).execute().use { response ->
                assertEquals(206, response.code)
                assertArrayEquals(ByteArray(8) { (it + 2).toByte() }, response.body.bytes())
                assertTrue(response.header("Content-Disposition")!!.startsWith("inline;"))
            }
            val download = client.request(ArtifactsUrlRequest(projectId = project.id, artifactId = file.id, download = true))
            http.newCall(Request.Builder().url(download.url).build()).execute().use { response ->
                assertEquals(200, response.code)
                assertTrue(response.header("Content-Disposition")!!.startsWith("attachment;"))
                assertArrayEquals(ByteArray(256) { it.toByte() }, response.body.bytes())
            }
            val wait = Instant.parse(source.expiresAt).toEpochMilli() - System.currentTimeMillis()
            require(wait < 5000) { "Use ARTIFACT_URL_TTL_MS=2000 for bounded JVM expiry proof" }
            delay(maxOf(0, wait) + 30)
            http.newCall(Request.Builder().url(source.url).build()).execute().use { assertEquals(403, it.code) }
            val renewed = client.request(ArtifactsUrlRequest(projectId = project.id, artifactId = file.id))
            http.newCall(Request.Builder().url(renewed.url).build()).execute().use { assertEquals(200, it.code) }
            // Never include signed capability values in assertion messages/logs.
            assertTrue(renewed.expiresAt > source.expiresAt)
        } finally {
            observer.cancelAndJoin(); client.close()
            http.dispatcher.executorService.shutdownNow(); http.connectionPool.evictAll()
        }
    }
}
