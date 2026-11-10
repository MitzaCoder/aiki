package io.github.mitzacoder.aiki.chat

import io.github.mitzacoder.aiki.features.chat.*
import java.io.ByteArrayOutputStream
import kotlinx.coroutines.runBlocking
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import okhttp3.OkHttpClient
import org.junit.Assert.*
import org.junit.Test

class ArtifactRemintTest {
    @Test fun expiredDownloadRemintsBeforeOpeningDestination() = runBlocking {
        MockWebServer().use { server ->
            server.start()
            server.enqueue(MockResponse.Builder().code(403).body("expired").build())
            server.enqueue(MockResponse.Builder().body("artifact bytes").build())
            val http = OkHttpClient()
            var minted = 0
            var opened = 0
            val destination = ByteArrayOutputStream()
            try {
                val count = saveArtifactWithRemint(http, mint = { minted++; server.url("/artifact?token=synthetic-$minted").toString() }) { opened++; destination }
                assertEquals(14, count)
                assertEquals(2, minted)
                assertEquals(1, opened)
                assertEquals("artifact bytes", destination.toString())
            } finally { http.dispatcher.executorService.shutdownNow(); http.connectionPool.evictAll() }
        }
    }
    @Test fun permanentFailureRemintsOnlyOnceAndDoesNotWrite() = runBlocking {
        MockWebServer().use { server ->
            server.start()
            repeat(2) { server.enqueue(MockResponse.Builder().code(404).body("missing").build()) }
            val http = OkHttpClient()
            var minted = 0
            try {
                try {
                    saveArtifactWithRemint(http, mint = { minted++; server.url("/missing").toString() }) { throw AssertionError("Must not open output on HTTP failure") }
                    fail()
                } catch (error: IllegalStateException) { assertEquals("Download failed", error.message) }
                assertEquals(2, minted)
            } finally { http.dispatcher.executorService.shutdownNow(); http.connectionPool.evictAll() }
        }
    }
    @Test fun tenMinuteUrlRenewsBeforeExpiry() {
        val now = java.time.Instant.parse("2026-01-01T00:00:00Z").toEpochMilli()
        val delay = artifactRefreshDelay("2026-01-01T00:10:00Z", now)
        assertTrue(delay in 1..599_999)
    }
}
