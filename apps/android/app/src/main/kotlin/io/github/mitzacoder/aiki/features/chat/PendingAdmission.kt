package io.github.mitzacoder.aiki.features.chat

import io.github.mitzacoder.aiki.protocol.WorkerDefaults
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.*
import java.security.MessageDigest
import java.util.UUID

/**
 * Small saved-state record: text, the quotes and task it goes with, and dedup identity survive process recreation; image
 * bytes never enter a Bundle (only a digest of all of them, in order). A retry sends exactly what the first try did, under the same request ID.
 */
@Serializable
internal data class PendingAdmission(
    val scope: String,
    val requestId: String,
    val text: String,
    val imageDigest: String?,
    val workerDefaults: WorkerDefaults,
    /** The board task the message is about (`submit.taskId`); the server puts `[task T4] ` in front. */
    val taskId: String? = null,
    /** Quotes from the transcript, sent as blockquotes before [text]. */
    val quotes: List<String> = emptyList(),
    val fileIds: List<String> = emptyList(),
) {
    fun save(): String = Json.encodeToString(serializer(),this)
    fun canRetry(scope: String, text: String, images: List<JsonObject>, taskId: String? = null, quotes: List<String> = emptyList(), fileIds: List<String> = emptyList()): Boolean =
        this.scope == scope && this.text == text && imageDigest == digest(images) && this.taskId == taskId && this.quotes == quotes && this.fileIds == fileIds
    /** The text that goes out: the quotes as blockquotes, then what was typed. */
    val message: String get() = if(quotes.isEmpty()) text else messageWithQuotes(quotes,text)
    /** The content the request carries: the text, then each image in order; null when [images] are not the ones this admission was made with. */
    fun content(images: List<JsonObject>): JsonElement? {
        if(imageDigest != digest(images)) return null
        val sent = message
        return if(images.isEmpty()) JsonPrimitive(sent) else buildJsonArray {
            if(sent.isNotBlank()) add(buildJsonObject { put("type","text"); put("text",sent) })
            images.forEach { add(it) }
        }
    }
    companion object {
        fun create(scope: String,text: String,images: List<JsonObject>,defaults: WorkerDefaults,id: String = UUID.randomUUID().toString(),taskId: String? = null,quotes: List<String> = emptyList(),fileIds: List<String> = emptyList()) =
            PendingAdmission(scope,id,text,digest(images),defaults,taskId,quotes,fileIds)
        fun restore(saved: String?): PendingAdmission? = saved?.let { runCatching { Json.decodeFromString(serializer(),it) }.getOrNull() }
        private fun digest(images: List<JsonObject>): String? = images.takeIf { it.isNotEmpty() }?.let { list ->
            // Fixed field order, independent of JsonObject construction order; the order of the images counts.
            val payload = list.joinToString("\u0001") { it.s("mimeType") + "\u0000" + it.s("data") }
            MessageDigest.getInstance("SHA-256").digest(payload.toByteArray()).joinToString("") { byte -> "%02x".format(byte) }
        }
    }
}
