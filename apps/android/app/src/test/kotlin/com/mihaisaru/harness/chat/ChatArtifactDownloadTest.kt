package com.mihaisaru.harness.chat

import com.mihaisaru.harness.features.chat.*
import kotlinx.coroutines.*
import java.io.ByteArrayOutputStream
import org.junit.Assert.*
import org.junit.Test
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import okhttp3.OkHttpClient

class ChatArtifactDownloadTest {
    @Test fun documentNamesCannotContainRemotePathOrControlCharacters() {
        assertEquals("video.mp4",artifactDownloadName("/private/server/video.mp4"))
        assertEquals("file.txt",artifactDownloadName("C:\\temp\\file.txt"))
        assertEquals("bad_name",artifactDownloadName("bad\nname"))
        assertEquals("artifact",artifactDownloadName(""))
    }
    @Test fun streamedDownloadPreservesBinaryBytesWithoutWholeFileBuffer() = runBlocking {
        val bytes = ByteArray(200000) { (it % 251).toByte() }
        val output = ByteArrayOutputStream()
        assertEquals(bytes.size.toLong(),copyArtifact(bytes.inputStream(),output))
        assertArrayEquals(bytes,output.toByteArray())
    }
    @Test fun signedTransferSavesContentsAndRejectsExpiredUrlsBeforeOpeningDestination() = runBlocking {
        val server = MockWebServer()
        server.enqueue(MockResponse.Builder().body("file contents").build())
        server.enqueue(MockResponse.Builder().code(403).body("expired").build())
        server.start()
        val http = OkHttpClient()
        try {
            val output = ByteArrayOutputStream()
            assertEquals(13L,saveArtifactBytes(http,server.url("/file?token=fixture-only").toString()) { output })
            assertEquals("file contents",output.toString("UTF-8"))
            var opened = false
            try {
                saveArtifactBytes(http,server.url("/file?token=expired-fixture").toString()) { opened = true; ByteArrayOutputStream() }
                fail("expected expired URL rejection")
            } catch(e: IllegalStateException) { assertEquals("Download failed",e.message) }
            assertFalse(opened)
        } finally { server.close(); http.dispatcher.executorService.shutdown(); http.connectionPool.evictAll() }
    }
    @Test fun cancelledCopyDoesNotWriteAnything() = runBlocking {
        val output = ByteArrayOutputStream()
        val job = Job().also { it.cancel() }
        try { withContext(job) { copyArtifact("data".byteInputStream(),output) }; fail("expected cancellation") }
        catch(_: CancellationException) { }
        assertEquals(0,output.size())
    }
}
