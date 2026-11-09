package com.mihaisaru.harness.features.chat

import kotlinx.coroutines.*
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.InputStream
import java.io.OutputStream

internal fun artifactDownloadName(name: String): String = name.substringAfterLast('/').substringAfterLast('\\')
    .replace(Regex("[\\p{Cntrl}]"),"_").take(180).ifBlank { "artifact" }

/** Streaming copy, not a whole-file allocation. Cancellation is checked between bounded chunks. */
internal suspend fun copyArtifact(input: InputStream, output: OutputStream): Long {
    val buffer = ByteArray(64 * 1024)
    var total = 0L
    while(true) {
        currentCoroutineContext().ensureActive()
        val count = input.read(buffer)
        if(count < 0) break
        if(count == 0) {
            val next = input.read()
            if(next < 0) break
            output.write(next); total++
            continue
        }
        output.write(buffer,0,count)
        total += count
    }
    output.flush()
    return total
}

/** URL is a local variable only. No DownloadManager, browser handoff, disk cache or token-bearing errors. */
internal suspend fun saveArtifactBytes(http: OkHttpClient, url: String, openOutput: () -> OutputStream): Long = coroutineScope {
    val call = http.newCall(Request.Builder().url(url).build())
    val cancellation = launch(start = CoroutineStart.UNDISPATCHED) {
        try { awaitCancellation() } finally { call.cancel() }
    }
    try {
        withContext(Dispatchers.IO) {
            call.execute().use { response ->
                check(response.isSuccessful) { "Download failed" }
                response.body.byteStream().use { input -> openOutput().use { output -> copyArtifact(input,output) } }
            }
        }
    } finally { cancellation.cancel() }
}
