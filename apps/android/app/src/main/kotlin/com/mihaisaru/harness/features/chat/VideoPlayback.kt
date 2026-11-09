package com.mihaisaru.harness.features.chat

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlin.math.ceil
import kotlin.math.floor
import kotlin.math.sign

/**
 * The video player's rules outside the player (port of the web's `lib/video-player.ts`): the clock, the speeds, taps
 * on the video, where a video stopped and the chosen speed (remembered on the device), and the times in a note that
 * seek the video. Keyboard shortcuts, sound detection and the theatre panel stay on the web: Media3 and the full-screen
 * screen cover them here.
 */

/** The speeds the player offers, slowest first. */
val PLAYBACK_RATES = listOf(1.0, 1.25, 1.5, 2.0, 3.0)
/** The ±10s buttons and a double tap move this far. */
const val SKIP_SECONDS = 10
/** Two taps closer than this are a double tap. */
const val DOUBLE_TAP_MS = 300L

/** A player clock: "0:07", "12:30", "1:02:03". Floors, so the clock never shows a second it has not reached. */
fun formatClock(seconds: Double, total: Double = seconds): String {
    val value = if (seconds.isFinite() && seconds > 0) floor(seconds).toLong() else 0L
    val hours = value / 3600
    val minutes = (value % 3600) / 60
    val rest = (value % 60).toString().padStart(2, '0')
    val long = hours > 0 || (total.isFinite() && total >= 3600)
    return if (long) "$hours:${minutes.toString().padStart(2, '0')}:$rest" else "$minutes:$rest"
}

/** A speed as the button shows it: "1×", "1.25×". */
fun formatRate(rate: Double): String {
    val rounded = Math.round(rate * 100) / 100.0
    return (if (rounded == floor(rounded)) rounded.toLong().toString() else rounded.toString()) + "×"
}

/** The next speed up ([step] 1) or down (-1) from [rate], staying at the ends. */
fun stepRate(rate: Double, step: Int): Double =
    if (step > 0) PLAYBACK_RATES.firstOrNull { it > rate + 1e-6 } ?: PLAYBACK_RATES.last()
    else PLAYBACK_RATES.lastOrNull { it < rate - 1e-6 } ?: PLAYBACK_RATES.first()

/** A time inside the video; an unknown length only keeps it from going below zero. */
fun clampTime(seconds: Double, duration: Double): Double {
    val floor = maxOf(0.0, seconds)
    return if (duration.isFinite() && duration > 0) minOf(floor, duration) else floor
}

enum class TapZone { Left, Right }

/** The half of the video a tap at [x] landed on. */
fun tapZone(x: Float, left: Float, width: Float): TapZone = if (x - left < width / 2) TapZone.Left else TapZone.Right

data class VideoTap(val at: Long, val zone: TapZone)

/**
 * A tap on the video: the second of two quick taps on the same half skips (left back, right forward), and so does every
 * quick tap after it; a lone tap shows or hides the controls.
 */
fun isDoubleTap(previous: VideoTap?, tap: VideoTap): Boolean =
    previous != null && tap.at - previous.at <= DOUBLE_TAP_MS && previous.zone == tap.zone

// --- remembered place and speed -----------------------------------------------------------------------------------

/** At most this many videos keep their place; the oldest go first. */
const val VIDEO_POSITIONS_LIMIT = 100
/** A place this close to the start is not worth resuming. */
const val RESUME_MIN_SECONDS = 5.0
/** Nor one this close to the end: the video was watched. */
const val RESUME_END_MARGIN_SECONDS = 5.0

@Serializable
data class VideoPosition(val time: Double, val at: Long)

/** The speed chosen last and where each video stopped, by [videoKey] (web localStorage `mihai-harness.video.v1`). */
@Serializable
data class VideoMemory(val rate: Double = 1.0, val positions: Map<String, VideoPosition> = emptyMap())

fun videoKey(projectId: String, artifactId: String) = "$projectId/$artifactId"

private val memoryJson = Json { ignoreUnknownKeys = true }

/** The stored memory, with anything unreadable dropped. */
fun parseVideoMemory(raw: String?): VideoMemory {
    if (raw == null) return VideoMemory()
    val element = runCatching { memoryJson.parseToJsonElement(raw) }.getOrNull() as? kotlinx.serialization.json.JsonObject ?: return VideoMemory()
    val rate = (element["rate"] as? kotlinx.serialization.json.JsonPrimitive)?.content?.toDoubleOrNull()?.takeIf { it in PLAYBACK_RATES } ?: 1.0
    val positions = (element["positions"] as? kotlinx.serialization.json.JsonObject).orEmpty().mapNotNull { (key, value) ->
        val entry = value as? kotlinx.serialization.json.JsonObject ?: return@mapNotNull null
        val time = (entry["time"] as? kotlinx.serialization.json.JsonPrimitive)?.takeUnless { it.isString }?.content?.toDoubleOrNull()
        val at = (entry["at"] as? kotlinx.serialization.json.JsonPrimitive)?.takeUnless { it.isString }?.content?.toDoubleOrNull()
        if (time == null || !time.isFinite() || time < 0 || at == null || !at.isFinite()) null else key to VideoPosition(time, at.toLong())
    }.toMap()
    return VideoMemory(rate, positions)
}

fun encodeVideoMemory(memory: VideoMemory): String = memoryJson.encodeToString(VideoMemory.serializer(), memory)

/** Where to pick a video up: the stored place, unless it is near the start or the end. */
fun resumeTime(time: Double?, duration: Double): Double? {
    if (time == null || !time.isFinite() || time < RESUME_MIN_SECONDS) return null
    if (duration.isFinite() && duration > 0 && time > duration - RESUME_END_MARGIN_SECONDS) return null
    return time
}

/**
 * The memory with [key]'s place set to [time], or forgotten when the place is not worth resuming (near the start or the
 * end); only the [VIDEO_POSITIONS_LIMIT] most recent places stay.
 */
fun rememberPosition(memory: VideoMemory, key: String, time: Double, duration: Double, now: Long): VideoMemory {
    val positions = memory.positions - key
    val next = if (resumeTime(time, duration) != null) positions + (key to VideoPosition(time, now)) else positions
    val kept = next.entries.sortedByDescending { it.value.at }.take(VIDEO_POSITIONS_LIMIT).associate { it.key to it.value }
    return memory.copy(positions = kept)
}

// --- times in a note -------------------------------------------------------------------------------------------------

/** "2:15" or "1:02:03" as seconds; null when it is not a clock time (minutes or seconds past 59). */
fun parseClock(text: String): Int? {
    val match = Regex("^(?:(\\d{1,2}):)?(\\d{1,2}):(\\d{2})$").find(text) ?: return null
    val hours = match.groups[1]?.value?.toInt()
    val minutes = match.groupValues[2].toInt()
    val seconds = match.groupValues[3].toInt()
    if (seconds > 59 || (hours != null && minutes > 59)) return null
    return (hours ?: 0) * 3600 + minutes * 60 + seconds
}

/** The fragment a note's time links to; [noteTimeFromHref] reads it back. */
fun noteTimeHref(seconds: Int) = "#t=$seconds"

fun noteTimeFromHref(href: String?): Double? = Regex("^#t=(\\d+(?:\\.\\d+)?)$").find(href.orEmpty())?.groupValues?.get(1)?.toDouble()

// Code fences and spans, links and autolinks, and bare URLs: times inside them stay text.
private val SKIPPED = Regex("```[\\s\\S]*?(?:```|$)|~~~[\\s\\S]*?(?:~~~|$)|`[^`\\n]*`|!?\\[[^\\]\\n]*\\]\\([^)\\n]*\\)|<[^>\\s]+>|https?://\\S+")
private val CLOCK = Regex("(?<![\\w:./])(?:\\d{1,2}:)?\\d{1,2}:\\d{2}(?!\\w|:\\d|\\.\\d)")
private val ADDRESS = Regex("https?://\\S+")

/** A time in a run of plain text that seeks the video: where it is and the second it means. */
data class NoteTime(val start: Int, val end: Int, val seconds: Int)

/**
 * The times in a run of plain note text ("at 2:15", "1:02:03"), skipping addresses and, when the video's length is
 * known, times past its end. The Markdown renderer keeps code and links out of the text it hands over.
 */
fun noteTimes(text: String, duration: Double? = null): List<NoteTime> {
    val addresses = ADDRESS.findAll(text).map { it.range }.toList()
    return CLOCK.findAll(text).mapNotNull { match ->
        if (addresses.any { match.range.first in it }) return@mapNotNull null
        val seconds = parseClock(match.value) ?: return@mapNotNull null
        if (duration != null && duration.isFinite() && duration > 0 && seconds > ceil(duration)) return@mapNotNull null
        NoteTime(match.range.first, match.range.last + 1, seconds)
    }.toList()
}

/**
 * A note's Markdown with each time in it made a link to [noteTimeHref] (web `linkNoteTimes`). Times in code, in links
 * and in URLs stay as they are, and so do times past the video's end when its length is known.
 */
fun linkNoteTimes(markdown: String, duration: Double? = null): String {
    val out = StringBuilder()
    var last = 0
    fun plain(part: String) {
        var at = 0
        for (time in noteTimes(part, duration)) {
            out.append(part, at, time.start).append("[").append(part, time.start, time.end).append("](").append(noteTimeHref(time.seconds)).append(")")
            at = time.end
        }
        out.append(part, at, part.length)
    }
    for (match in SKIPPED.findAll(markdown)) {
        plain(markdown.substring(last, match.range.first))
        out.append(match.value)
        last = match.range.last + 1
    }
    plain(markdown.substring(last))
    return out.toString()
}

/** The controls hide this long after the last touch (web `CONTROLS_IDLE_MS`). */
const val CONTROLS_IDLE_MS = 1500

/** What a hardware key does to the player, so the controls stay out of the way (web `shortcut`). */
enum class VideoKey { TogglePlay, Play, Pause, SeekBack, SeekForward }

/** The keyboard/D-pad key the player handles itself (without showing the controls), or null for any other key. */
fun keyAction(keyCode: Int): VideoKey? = when (keyCode) {
    62, 85, 79, 23, 66 -> VideoKey.TogglePlay   // SPACE, MEDIA_PLAY_PAUSE, HEADSETHOOK, DPAD_CENTER, ENTER
    126 -> VideoKey.Play                         // MEDIA_PLAY
    127 -> VideoKey.Pause                        // MEDIA_PAUSE
    21, 89 -> VideoKey.SeekBack                  // DPAD_LEFT, MEDIA_REWIND
    22, 90 -> VideoKey.SeekForward               // DPAD_RIGHT, MEDIA_FAST_FORWARD
    else -> null
}

/** The centred cue for a key or a double tap lasts this long: pop in, hold, fade out (web `CUE_MS`). */
const val CUE_MS = 550

/** What the centred cue shows. */
enum class CueKind { Play, Pause, SeekBack, SeekForward }

/** The cue for [key]; [playing] is whether the video was playing before the key acted. */
fun keyCue(key: VideoKey, playing: Boolean): CueKind = when (key) {
    VideoKey.TogglePlay -> if (playing) CueKind.Pause else CueKind.Play
    VideoKey.Play -> CueKind.Play
    VideoKey.Pause -> CueKind.Pause
    VideoKey.SeekBack -> CueKind.SeekBack
    VideoKey.SeekForward -> CueKind.SeekForward
}

/** The signed seconds a repeated seek adds up to: more the same way add, a turn starts again (web `accumulateSeek`). */
fun accumulateSeek(shown: Int?, by: Int): Int = if (shown != null && shown.sign == by.sign) shown + by else by

/** A seek as the cue shows it: "+10s", "−30s" (a real minus sign). */
fun formatSeekCue(seconds: Int): String = (if (seconds < 0) "−" else "+") + "${kotlin.math.abs(seconds)}s"
