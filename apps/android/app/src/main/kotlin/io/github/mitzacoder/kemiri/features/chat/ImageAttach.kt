package io.github.mitzacoder.kemiri.features.chat

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import android.media.ExifInterface
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import kotlin.math.max
import kotlin.math.roundToInt

/*
 * Images in a message, the same limits and decisions as the web's `lib/chat/images.ts` (docs/DESIGN.md "Image attachments"):
 * png, jpeg, webp or gif; 5 MiB each; 8 a message; 20 MiB together; shrunk to 2000 px on the long edge before sending. The
 * pure parts are first (tests in `chat/ImageAttachTest`); [prepareImage] does the decoding with the platform's codecs.
 */

internal val INPUT_IMAGE_MIME_TYPES = listOf("image/png", "image/jpeg", "image/webp", "image/gif")
internal const val INPUT_IMAGE_MAX_BYTES = 5 * 1024 * 1024
internal const val INPUT_MAX_IMAGES = 8
internal const val INPUT_IMAGES_MAX_BYTES = 20 * 1024 * 1024
internal const val INPUT_IMAGE_MAX_EDGE = 2000
/** The smallest long edge a shrunk image is stepped down to before giving up. */
internal const val MIN_ENCODE_EDGE = 800
/** The most bytes read from a picked, dropped or pasted file before it is shrunk (a camera photo is a few MB). */
internal const val INPUT_IMAGE_MAX_READ_BYTES = 24 * 1024 * 1024

/** One way to encode an image: its size, type and quality (0-100, jpeg and webp only). */
internal data class EncodeAttempt(val width: Int, val height: Int, val type: String, val quality: Int? = null)

internal sealed interface ImagePlan {
    /** Send the bytes as they are. */
    data object Keep : ImagePlan
    /** Draw and encode in these ways, in order, until one is at most 5 MiB. */
    data class Encode(val attempts: List<EncodeAttempt>) : ImagePlan
    data class Reject(val reason: String) : ImagePlan
}

internal fun isInputImageType(type: String?): Boolean = type != null && type in INPUT_IMAGE_MIME_TYPES

/** Scale a size so its long edge is at most [maxEdge], keeping the shape; never up. */
internal fun fitWithin(width: Int, height: Int, maxEdge: Int = INPUT_IMAGE_MAX_EDGE): Pair<Int, Int> {
    val long = max(width, height)
    if (long <= maxEdge) return width to height
    val scale = maxEdge.toDouble() / long
    return max(1, (width * scale).roundToInt()) to max(1, (height * scale).roundToInt())
}

private fun megabytes(bytes: Int): String = ((bytes.toDouble() / (1024 * 1024)) * 10).roundToInt().div(10.0).let { if (it % 1.0 == 0.0) it.toInt().toString() else it.toString() }

/**
 * What to do with one image. It goes as it is when it is one of the four types, within 5 MiB and at most 2000 px on its
 * long edge. Otherwise it is shrunk to 2000 px and encoded in its own format; when that is still over 5 MiB, or the format
 * is not one the protocol takes, the attempts go on to JPEG and step the size down by a quarter until it fits or would be
 * under [MIN_ENCODE_EDGE]. A GIF over the limit is refused: drawing it would keep one frame.
 */
internal fun planImage(type: String, size: Int, width: Int, height: Int): ImagePlan {
    val long = max(width, height)
    if (type.equals("image/gif", ignoreCase = true)) {
        return if (size <= INPUT_IMAGE_MAX_BYTES) ImagePlan.Keep
        else ImagePlan.Reject("is a GIF over ${megabytes(INPUT_IMAGE_MAX_BYTES)} MB, and shrinking it would lose the animation")
    }
    if (isInputImageType(type) && size <= INPUT_IMAGE_MAX_BYTES && long <= INPUT_IMAGE_MAX_EDGE) return ImagePlan.Keep
    val (fitW, fitH) = fitWithin(width, height)
    val own = when (type.lowercase()) { "image/png" -> "image/png"; "image/jpeg", "image/jpg" -> "image/jpeg"; "image/webp" -> "image/webp"; else -> "image/png" }
    val attempts = mutableListOf(EncodeAttempt(fitW, fitH, own, if (own == "image/png") null else 92))
    if (own != "image/jpeg") attempts += EncodeAttempt(fitW, fitH, "image/jpeg", 90)
    var edge = max(fitW, fitH)
    while (true) {
        edge = (edge * 0.75).roundToInt()
        if (edge < MIN_ENCODE_EDGE) break
        val (w, h) = fitWithin(width, height, edge)
        attempts += EncodeAttempt(w, h, "image/jpeg", 85)
    }
    return ImagePlan.Encode(attempts)
}

/** The reason one more image of [size] bytes does not fit a message that holds [count] images of [bytes] together, or null. */
internal fun messageLimitError(count: Int, bytes: Int, size: Int, name: String? = null): String? {
    val label = if (name.isNullOrEmpty()) "This image" else name
    if (count + 1 > INPUT_MAX_IMAGES) return "A message holds at most $INPUT_MAX_IMAGES images"
    if (bytes.toLong() + size > INPUT_IMAGES_MAX_BYTES) return "$label would take the message's images over ${megabytes(INPUT_IMAGES_MAX_BYTES)} MB together"
    return null
}

/** The image type the bytes start as (their magic number), whatever the file was said to be; null when it is none of the four. */
internal fun sniffImageType(bytes: ByteArray): String? {
    fun starts(vararg head: Int, at: Int = 0) = bytes.size >= at + head.size && head.indices.all { (bytes[at + it].toInt() and 0xff) == head[it] }
    return when {
        starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a) -> "image/png"
        starts(0xff, 0xd8, 0xff) -> "image/jpeg"
        starts(0x47, 0x49, 0x46, 0x38) -> "image/gif"
        starts(0x52, 0x49, 0x46, 0x46) && starts(0x57, 0x45, 0x42, 0x50, at = 8) -> "image/webp"
        else -> null
    }
}

/** An image ready to go in a message. */
internal class PreparedImage(val mimeType: String, val bytes: ByteArray, val name: String?)

/** Why an image cannot be used, in words for the user (the file's name goes in front). */
internal class ImageProblem(message: String) : Exception(message)

private fun extensionOf(type: String) = when (type) { "image/png" -> "png"; "image/jpeg" -> "jpg"; "image/webp" -> "webp"; else -> null }

private fun renamed(name: String?, type: String): String? {
    if (name.isNullOrEmpty()) return null
    val extension = extensionOf(type) ?: return name
    return name.replace(Regex("\\.[^./\\\\]+$"), "") + "." + extension
}

/** How the photo is turned in its EXIF data (drawing it again loses that, so it is applied first). */
private fun exifRotation(bytes: ByteArray): Float = runCatching {
    when (ExifInterface(ByteArrayInputStream(bytes)).getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL)) {
        ExifInterface.ORIENTATION_ROTATE_90 -> 90f
        ExifInterface.ORIENTATION_ROTATE_180 -> 180f
        ExifInterface.ORIENTATION_ROTATE_270 -> 270f
        else -> 0f
    }
}.getOrDefault(0f)

/**
 * Read an attached file's bytes: as they are when they fit the limits, else drawn smaller and encoded again. [declared] is
 * the type the source claimed; the bytes' own signature wins. Throws [ImageProblem] when it cannot be used.
 */
internal fun prepareImage(bytes: ByteArray, declared: String?, name: String?): PreparedImage {
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
    if (bounds.outWidth <= 0 || bounds.outHeight <= 0) throw ImageProblem("could not be read as an image")
    val type = sniffImageType(bytes) ?: bounds.outMimeType ?: declared ?: throw ImageProblem("could not be read as an image")
    val plan = planImage(type, bytes.size, bounds.outWidth, bounds.outHeight)
    when (plan) {
        is ImagePlan.Reject -> throw ImageProblem(plan.reason)
        ImagePlan.Keep -> return PreparedImage(type, bytes, name)
        is ImagePlan.Encode -> Unit
    }
    // Decode once, near the largest size any attempt needs, then scale for each attempt.
    val widest = plan.attempts.first()
    var sample = 1
    while (bounds.outWidth / (sample * 2) >= widest.width && bounds.outHeight / (sample * 2) >= widest.height) sample *= 2
    val decoded = BitmapFactory.decodeByteArray(bytes, 0, bytes.size, BitmapFactory.Options().apply { inSampleSize = sample })
        ?: throw ImageProblem("could not be read as an image")
    val rotation = exifRotation(bytes)
    val source = if (rotation == 0f) decoded else Bitmap.createBitmap(decoded, 0, 0, decoded.width, decoded.height, Matrix().apply { postRotate(rotation) }, true)
        .also { if (it !== decoded) decoded.recycle() }
    try {
        val quarterTurn = rotation == 90f || rotation == 270f
        for (attempt in plan.attempts) {
            val (w, h) = if (quarterTurn) attempt.height to attempt.width else attempt.width to attempt.height
            val scaled = if (source.width == w && source.height == h) source else Bitmap.createScaledBitmap(source, w, h, true)
            val output = ByteArrayOutputStream()
            val format = when (attempt.type) {
                "image/png" -> Bitmap.CompressFormat.PNG
                "image/webp" -> Bitmap.CompressFormat.WEBP_LOSSY
                else -> Bitmap.CompressFormat.JPEG
            }
            // JPEG has no transparency: what shows through is white, not black.
            val drawn = if (attempt.type == "image/jpeg" && scaled.hasAlpha()) {
                Bitmap.createBitmap(scaled.width, scaled.height, Bitmap.Config.ARGB_8888).also { flat ->
                    android.graphics.Canvas(flat).apply { drawColor(android.graphics.Color.WHITE); drawBitmap(scaled, 0f, 0f, null) }
                }
            } else scaled
            drawn.compress(format, attempt.quality ?: 100, output)
            if (drawn !== scaled) drawn.recycle()
            if (scaled !== source) scaled.recycle()
            if (output.size() <= INPUT_IMAGE_MAX_BYTES) return PreparedImage(attempt.type, output.toByteArray(), renamed(name, attempt.type))
        }
    } finally { source.recycle() }
    throw ImageProblem("is too large, even shrunk")
}

/** A file as it came in, before it is checked and shrunk: its bytes, the type the source claimed and its name. */
internal class RawImage(val bytes: ByteArray, val declared: String?, val name: String?)

/** Read a picked, dropped or pasted file (a content URI). Throws [ImageProblem] when it is unreadable or beyond [INPUT_IMAGE_MAX_READ_BYTES]. */
internal fun readRawImage(resolver: android.content.ContentResolver, uri: android.net.Uri): RawImage {
    val bytes = try { resolver.openInputStream(uri)?.use { it.readAtMost(INPUT_IMAGE_MAX_READ_BYTES + 1) } } catch (e: java.io.IOException) { null } catch (e: SecurityException) { null }
        ?: throw ImageProblem("could not be read")
    val name = runCatching {
        resolver.query(uri, arrayOf(android.provider.OpenableColumns.DISPLAY_NAME), null, null, null)?.use { if (it.moveToFirst()) it.getString(0) else null }
    }.getOrNull()
    if (bytes.size > INPUT_IMAGE_MAX_READ_BYTES) throw ImageProblem("is too large to read (over ${INPUT_IMAGE_MAX_READ_BYTES / (1024 * 1024)} MB)")
    return RawImage(bytes, runCatching { resolver.getType(uri) }.getOrNull(), name)
}

/**
 * Check and shrink [files] and hand each to [add], which answers why it does not fit the message or null when it was added.
 * Returns what went wrong, in one line for the user, or null.
 */
internal suspend fun attachFiles(files: List<Pair<RawImage?, String?>>, add: suspend (PreparedImage) -> String?): String? {
    val problems = mutableListOf<String>()
    for ((file, readProblem) in files) {
        if (file == null) { readProblem?.let(problems::add); continue }
        val label = file.name?.takeIf { it.isNotEmpty() } ?: "An image"
        try {
            val prepared = kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.Default) { prepareImage(file.bytes, file.declared, file.name) }
            add(prepared)?.let(problems::add)
        } catch (e: ImageProblem) { problems += "$label ${e.message}" }
    }
    return problems.distinct().joinToString(" ").takeIf { it.isNotEmpty() }
}
