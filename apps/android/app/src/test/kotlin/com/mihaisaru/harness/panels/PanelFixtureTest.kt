package com.mihaisaru.harness.panels

import com.mihaisaru.harness.data.*
import com.mihaisaru.harness.features.panels.threadRoute
import com.mihaisaru.harness.navigation.Destination
import com.mihaisaru.harness.protocol.*
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.first
import okhttp3.OkHttpClient
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Test

/** Opt-in against apps/android/verification/fixture.ts, never a production backend.
 * PANELS_FIXTURE_ORIGIN=http://127.0.0.1:4795 enables this test. */
class PanelFixtureTest {
    @Test fun finalThreadAndArtifactContracts() = runBlocking {
        val origin = System.getenv("PANELS_FIXTURE_ORIGIN")
        assumeTrue("Contract fixture was not requested", origin != null)
        require(origin!!.startsWith("http://127.0.0.1:"))
        val http = OkHttpClient()
        val client = HarnessClient(BackendConfig("ANDROID CONTRACT FIXTURE", origin), http)
        try {
            client.connect()
            withTimeout(10_000) { client.state.first { it.status == ConnectionStatus.Ready } }
            val project = "android-fixture"
            val threads = client.request(ThreadsListRequest(projectId = project)).threads
            val background = threads.single { it.id == "background" }
            val target = threadRoute(Destination.Chat(origin, project, workerId = "stale-worker"), background)
            assertEquals("background", target.threadId)
            assertNull(target.workerId)
            val context = client.request(ConversationContextRequest(projectId = project, threadId = target.threadId)).context
            assertEquals("background", context.threadId)
            val stop = client.request(ThreadsStopRequest(projectId = project, threadId = background.id))
            assertEquals("stopped", stop.thread.status)
            client.request(ThreadsArchiveRequest(projectId = project, threadId = background.id, archived = true))
            assertFalse(client.request(ThreadsListRequest(projectId = project)).threads.any { it.id == background.id })
            assertTrue(client.request(ThreadsListRequest(projectId = project, includeArchived = true)).threads.single { it.id == background.id }.archived)
            client.request(ThreadsArchiveRequest(projectId = project, threadId = background.id, archived = false))
            val artifacts = client.request(ArtifactsListRequest(projectId = project, threadId = "background")).artifacts
            assertTrue(artifacts.isNotEmpty())
            assertTrue(artifacts.all { it.threadId == "background" && it.projectId == project })
            assertTrue(client.request(ArtifactsListRequest(projectId = project, threadId = "main", workerId = "missing-worker", taskId = "missing-task")).artifacts.isEmpty())
            assertTrue(client.request(ArtifactsListRequest(projectId = project, threadId = "main")).artifacts.any { it.id == "text" })
        } finally {
            client.close(); http.dispatcher.executorService.shutdownNow(); http.connectionPool.evictAll()
        }
    }
}
