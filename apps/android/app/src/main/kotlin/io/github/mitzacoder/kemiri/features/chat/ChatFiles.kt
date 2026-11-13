package io.github.mitzacoder.kemiri.features.chat

import android.content.ContentResolver
import android.net.Uri
import android.provider.OpenableColumns
import io.github.mitzacoder.kemiri.data.HarnessClient
import io.github.mitzacoder.kemiri.data.wireJson
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.*
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.RequestBody
import okio.BufferedSink

internal const val INPUT_FILE_MAX_BYTES = 50L * 1024 * 1024
@Serializable
internal data class ChatFile(val id: String, val name: String, val size: Long, val mimeType: String, val url: String, val path: String)
internal data class FileMessage(val text: String, val files: List<ChatFile>)
internal fun fileSizeLabel(bytes: Long): String = when {
    bytes < 1024 -> "$bytes B"
    bytes < 1024 * 1024 -> String.format(java.util.Locale.ROOT, "%.1f KB", bytes / 1024.0)
    else -> String.format(java.util.Locale.ROOT, "%.1f MB", bytes / 1024.0 / 1024.0)
}
internal fun splitFileMessage(text: String): FileMessage {
    val startMarker = "\n[aiki-files-v1]\n"
    val endMarker = "\n[/aiki-files-v1]"
    val start = text.lastIndexOf(startMarker)
    if (start < 0 || !text.endsWith(endMarker)) return FileMessage(text, emptyList())
    return runCatching {
        val lines = text.substring(start + startMarker.length, text.length - endMarker.length).lineSequence().takeWhile { it.startsWith("{") }
        val files = lines.map { wireJson.decodeFromString(ChatFile.serializer(), it).also { file ->
            require(file.id.matches(Regex("[a-f0-9]{32}")) && file.size in 0..INPUT_FILE_MAX_BYTES && file.url.matches(Regex("/attachments/[a-z0-9][a-z0-9._-]*/[1-9][0-9]*/[a-f0-9]{32}")))
        } }.toList()
        require(files.size in 1..8)
        FileMessage(text.substring(0, start), files)
    }.getOrElse { FileMessage(text, emptyList()) }
}

/** Stream SAF bytes with an independent cap; unknown/lying provider sizes cannot bypass it. No archive expansion. */
internal suspend fun uploadChatFile(client: HarnessClient, resolver: ContentResolver, projectId: String, threadId: String?, uri: Uri): ChatFile = withContext(Dispatchers.IO) {
    require(uri.scheme == "content") { "Choose a file from the document picker" }
    var name = "attachment"
    var size: Long? = null
    resolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE), null, null, null)?.use { cursor ->
        if (cursor.moveToFirst()) {
            cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME).takeIf { it >= 0 }?.let { name = cursor.getString(it) ?: name }
            cursor.getColumnIndex(OpenableColumns.SIZE).takeIf { it >= 0 && !cursor.isNull(it) }?.let { size = cursor.getLong(it).takeIf { n -> n >= 0 } }
        }
    }
    require(size == null || size!! <= INPUT_FILE_MAX_BYTES) { "$name: each attachment must be at most 50 MB" }
    val type = resolver.getType(uri) ?: "application/octet-stream"
    val body = object : RequestBody() {
        override fun contentType() = type.toMediaTypeOrNull()
        override fun contentLength() = size ?: -1
        override fun writeTo(sink: BufferedSink) {
            resolver.openInputStream(uri)?.use { input ->
                val buffer = ByteArray(64 * 1024); var total = 0L
                while (true) { val read = input.read(buffer); if (read < 0) break; total += read; require(total <= INPUT_FILE_MAX_BYTES) { "Each attachment must be at most 50 MB" }; sink.write(buffer, 0, read) }
            } ?: error("Cannot read $name")
        }
    }
    val query = "?name=${Uri.encode(name)}" + (threadId?.let { "&threadId=${Uri.encode(it)}" } ?: "")
    client.attachmentRequest("/attachments/${Uri.encode(projectId)}$query", body).use { response ->
        wireJson.decodeFromString(ChatFile.serializer(), response.body.string())
    }
}
