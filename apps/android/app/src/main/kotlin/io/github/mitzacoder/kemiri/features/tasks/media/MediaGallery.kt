package io.github.mitzacoder.kemiri.features.tasks.media

import io.github.mitzacoder.kemiri.protocol.Artifact
import java.text.Normalizer
import java.time.Instant

/**
 * The logic behind a task's media carousel, outside the composables so the JVM tests can reach it: a port of the web's
 * `lib/media-gallery.ts` (tests mirror `apps/web/test/media-gallery.test.ts`) and of `normalizeTag`/`normalizeTags`
 * from `packages/protocol/src/artifacts.ts`. Design: docs/DESIGN.md "Artifact tags and the task media carousel".
 */

const val BEFORE_TAG = "before"
const val AFTER_TAG = "after"

/** How many slides on each side of the active one load their full image or mount a video player. */
const val SLIDE_LOAD_RADIUS = 1

/**
 * How long the carousel's motion takes, in milliseconds: the same numbers as the web's `MEDIA_MOTION`
 * (`lib/media-gallery.ts`), so both apps feel alike. Quick, with a strong ease-out (cubic-bezier(0.25, 1, 0.5, 1));
 * reduced motion uses none of them.
 */
object MediaMotion {
    /** A programmatic slide change (a thumbnail tap, a neighbour tap, a key). */
    const val slideMs = 220
    /** The thumbnail strip following the current slide. */
    const val stripMs = 180
    /** The caption's cross-fade: in after [captionDelayMs], out in [captionOutMs]. */
    const val captionMs = 110
    const val captionDelayMs = 20
    const val captionOutMs = 66
    /** The picture flying from its place in the task to full screen, and back. */
    const val viewerOpenMs = 260
    const val viewerCloseMs = 210
    val ease = androidx.compose.animation.core.CubicBezierEasing(0.25f, 1f, 0.5f, 1f)
    fun <T> slide() = androidx.compose.animation.core.tween<T>(slideMs, easing = ease)
    fun <T> strip() = androidx.compose.animation.core.tween<T>(stripMs, easing = ease)
}

/** The hello feature that lets the app change an artifact's tags. */
const val ARTIFACT_TAGS_FEATURE = "artifact-tags"

const val ARTIFACT_MAX_TAGS = 12
const val ARTIFACT_MAX_TAG_LENGTH = 24

/** Offered by the tag editor after the task's and the project's tags (the protocol's `SUGGESTED_ARTIFACT_TAGS`). */
val SUGGESTED_ARTIFACT_TAGS = listOf("web", "android", "phone", "desktop", "tablet", "dark", "light", "before", "after")

// --- tags as the server stores them ----------------------------------------------------------------------------------

private val SEPARATORS = Regex("[\\s,;/\\\\]+")
private val FORBIDDEN = Regex("[^\\p{L}\\p{N}\\-_.+:]")
private val EDGE_PUNCTUATION_START = Regex("^[-_.:+]+")
private val EDGE_PUNCTUATION_END = Regex("[-_.:+]+$")

/**
 * One tag in its stored form: trimmed, lowercase, runs of whitespace and separators as one `-`, no characters but
 * letters, digits, `-`, `_`, `.`, `+` and `:`, cut to [ARTIFACT_MAX_TAG_LENGTH]; null when nothing is left.
 */
fun normalizeTag(tag: String): String? {
    val cleaned = Normalizer.normalize(tag, Normalizer.Form.NFKC).trim().lowercase()
        .replace(SEPARATORS, "-")
        .replace(FORBIDDEN, "")
        .replace(EDGE_PUNCTUATION_START, "")
        .replace(EDGE_PUNCTUATION_END, "")
        .take(ARTIFACT_MAX_TAG_LENGTH)
        .replace(EDGE_PUNCTUATION_END, "")
    return cleaned.ifEmpty { null }
}

/** A list of tags as stored: each normalised, duplicates dropped (first wins), at most [ARTIFACT_MAX_TAGS]. */
fun normalizeTags(tags: List<String>?): List<String> {
    val seen = LinkedHashSet<String>()
    for (tag in tags.orEmpty()) {
        normalizeTag(tag)?.let { seen.add(it) }
        if (seen.size >= ARTIFACT_MAX_TAGS) break
    }
    return seen.toList()
}

// --- which artifacts are media ---------------------------------------------------------------------------------------

/** An artifact's tags; none for a row from a server without tags. */
fun Artifact.tagList(): List<String> = tags.orEmpty()

/** Photos and videos are shown in the carousel; everything else is a plain file. */
fun isMedia(artifact: Artifact): Boolean = artifact.kind == "image" || artifact.kind == "video"

private fun savedAt(artifact: Artifact): Long = runCatching { Instant.parse(artifact.createdAt).toEpochMilli() }.getOrDefault(Long.MIN_VALUE)

/** Save time, then ID: the order the web's `byTimeThenId` gives. */
val byTimeThenId: Comparator<Artifact> = Comparator { left, right ->
    val a = savedAt(left)
    val b = savedAt(right)
    val byTime = if (a == Long.MIN_VALUE || b == Long.MIN_VALUE) 0 else a.compareTo(b)
    if (byTime != 0) byTime else left.id.compareTo(right.id)
}

data class MediaSplit(val media: List<Artifact>, val files: List<Artifact>)

/**
 * A task's artifacts as the Files section shows them: the media oldest first (save order, so "3 of 8" stays put as new
 * ones arrive at the end) and the other files newest first, as the list reads them.
 */
fun splitMedia(artifacts: List<Artifact>): MediaSplit = MediaSplit(
    media = artifacts.filter(::isMedia).sortedWith(byTimeThenId),
    files = artifacts.filterNot(::isMedia).sortedWith(byTimeThenId.reversed()),
)

// --- tag chips and the filter ------------------------------------------------------------------------------------------

data class TagCount(val tag: String, val count: Int)

/** Every tag in the list with how many items carry it: most used first, then alphabetical. */
fun tagCounts(items: List<Artifact>): List<TagCount> {
    val counts = LinkedHashMap<String, Int>()
    for (item in items) for (tag in item.tagList().toSet()) counts[tag] = (counts[tag] ?: 0) + 1
    return counts.map { TagCount(it.key, it.value) }.sortedWith(compareByDescending<TagCount> { it.count }.thenBy { it.tag })
}

/** The items carrying [tag], or all of them for null. */
fun filterByTag(items: List<Artifact>, tag: String?): List<Artifact> =
    if (tag == null) items.toList() else items.filter { tag in it.tagList() }

/** The chosen tag if some item still carries it, else all (null): a filter whose last item went away lets go. */
fun resolveTagFilter(counts: List<TagCount>, tag: String?): String? = if (tag != null && counts.any { it.tag == tag }) tag else null

/** "Screenshot 3 of 8: Checkout" for a slide; videos are "Video". The position counts the filtered media. */
fun slideLabel(artifact: Artifact, index: Int, total: Int): String {
    val noun = if (artifact.kind == "video") "Video" else "Screenshot"
    val title = artifact.title?.trim()?.takeIf { it.isNotEmpty() } ?: artifact.name
    return "$noun ${index + 1} of $total: $title"
}

// --- the carousel's position -----------------------------------------------------------------------------------------

/** The slide nearest the middle of the viewport for a scroll offset, where slides repeat every [pitch] pixels. */
fun nearestSlide(scrollLeft: Float, pitch: Float, count: Int): Int {
    if (count <= 0 || !(pitch > 0f)) return 0
    return Math.round(scrollLeft / pitch).coerceIn(0, count - 1)
}

/** The index a key moves to, or null for a key that does nothing. */
fun stepIndex(index: Int, count: Int, key: String): Int? {
    if (count <= 0) return null
    val last = count - 1
    return when (key) {
        "ArrowLeft", "PageUp" -> maxOf(0, index - 1)
        "ArrowRight", "PageDown" -> minOf(last, index + 1)
        "Home" -> 0
        "End" -> last
        else -> null
    }
}

/** The index to show after the list changed: the same artifact if it is still there, else the nearest position. */
fun keepIndex(previous: List<Artifact>, index: Int, next: List<Artifact>): Int {
    if (next.isEmpty()) return 0
    val id = previous.getOrNull(index)?.id
    val found = if (id == null) -1 else next.indexOfFirst { it.id == id }
    return if (found >= 0) found else minOf(index, next.size - 1)
}

/** Whether a slide, [distance] steps from the active one, loads its full image or mounts a player. */
fun loadsFull(distance: Int): Boolean = Math.abs(distance) <= SLIDE_LOAD_RADIUS

data class SlideLook(val scale: Float, val opacity: Float)

/**
 * How a slide looks at [offset] slides from the middle (fractional while scrolling): full size and brightness in the
 * middle, a little smaller and dimmer beside it, never beyond one step's worth.
 */
fun slideLook(offset: Float): SlideLook {
    val distance = minOf(1f, Math.abs(offset))
    return SlideLook(scale = 1f - 0.07f * distance, opacity = 1f - 0.45f * distance)
}

// --- before and after ------------------------------------------------------------------------------------------------

data class ComparePair(val before: Artifact, val after: Artifact)

data class MediaSlide(val artifact: Artifact, val pair: ComparePair? = null)

/** Collapse each filtered pair at its earliest member, using after for the thumbnail/caption. */
fun mediaSlides(items: List<Artifact>, separate: Boolean = false): List<MediaSlide> {
    val pairs = comparePairs(items)
    val seen = HashSet<String>()
    return buildList {
        for (item in items) {
            val pair = if (separate) null else pairs[item.id]
            if (pair == null) add(MediaSlide(item))
            else if (seen.add(pair.after.id)) add(MediaSlide(pair.after, pair))
        }
    }
}

fun mediaSlideLabel(slide: MediaSlide, index: Int, total: Int): String =
    if (slide.pair == null) slideLabel(slide.artifact, index, total)
    else "Before and after: ${slide.artifact.title?.trim()?.takeIf { it.isNotEmpty() } ?: slide.artifact.name}"

/** Retain either member's position when toggling pairs, filtering or changing tags. */
fun mediaSlideIndex(slides: List<MediaSlide>, artifactId: String?, fallback: Int): Int {
    if (slides.isEmpty()) return 0
    val found = slides.indexOfFirst { it.artifact.id == artifactId || it.pair?.before?.id == artifactId }
    return if (found >= 0) found else fallback.coerceIn(0, slides.lastIndex)
}

/** The tags besides before and after, sorted: what two items must share to be a pair. */
private fun otherTagsKey(item: Artifact): String =
    item.tagList().filter { it != BEFORE_TAG && it != AFTER_TAG }.sorted().joinToString("\u0000")

/**
 * The before/after pairs among [items], by artifact ID (both members of a pair map to it). Only images are paired. A
 * `before` and an `after` are a pair when their other tags are the same set; several with the same other tags pair in
 * order (the first before with the first after, by save time). An item with both tags, or whose other tags have no
 * partner, is unpaired. Give the items as filtered: a pair needs both of them in the list.
 */
fun comparePairs(items: List<Artifact>): Map<String, ComparePair> {
    class Group { val befores = ArrayList<Artifact>(); val afters = ArrayList<Artifact>() }
    val groups = LinkedHashMap<String, Group>()
    for (item in items.sortedWith(byTimeThenId)) {
        if (item.kind != "image") continue
        val tags = item.tagList()
        val before = BEFORE_TAG in tags
        val after = AFTER_TAG in tags
        if (before == after) continue
        val group = groups.getOrPut(otherTagsKey(item)) { Group() }
        (if (before) group.befores else group.afters).add(item)
    }
    val pairs = LinkedHashMap<String, ComparePair>()
    for (group in groups.values) {
        for (at in 0 until minOf(group.befores.size, group.afters.size)) {
            val pair = ComparePair(group.befores[at], group.afters[at])
            pairs[pair.before.id] = pair
            pairs[pair.after.id] = pair
        }
    }
    return pairs
}

/** The share of the width the divider sits at, 0 to 100. */
fun clampPercent(value: Float): Float = if (value.isFinite()) value.coerceIn(0f, 100f) else 50f

/** The divider's position after a key, or null for a key that does nothing. Shift takes a bigger step. */
fun dividerAfterKey(position: Float, key: String, shift: Boolean): Float? {
    val step = if (shift) 10f else 2f
    return when (key) {
        "ArrowLeft", "ArrowDown" -> clampPercent(position - step)
        "ArrowRight", "ArrowUp" -> clampPercent(position + step)
        "PageDown" -> clampPercent(position - 10f)
        "PageUp" -> clampPercent(position + 10f)
        "Home" -> 0f
        "End" -> 100f
        else -> null
    }
}

/** The divider position for a pointer at [x] over a box starting at [left] and [width] wide. */
fun dividerAtPointer(x: Float, left: Float, width: Float): Float = if (width > 0f) clampPercent((x - left) / width * 100f) else 50f

// --- editing tags ----------------------------------------------------------------------------------------------------

/** Every tag across artifacts, most used first: what the project already calls things. */
fun projectTags(artifacts: List<Artifact>): List<String> = tagCounts(artifacts).map { it.tag }

/**
 * Tags to offer for what was typed: those starting with it first, then those containing it. From the task's tags, then
 * the project's, then the suggested ones; those already on the artifact are left out. An empty query offers the first
 * few in that order.
 */
fun suggestTags(query: String, current: List<String>, task: List<String>, project: List<String>, limit: Int = 8): List<String> {
    val typed = normalizeTag(query).orEmpty()
    val have = current.toSet()
    val seen = HashSet<String>()
    val candidates = ArrayList<String>()
    for (tag in task + project + SUGGESTED_ARTIFACT_TAGS) {
        if (tag in have || !seen.add(tag)) continue
        candidates.add(tag)
    }
    if (typed.isEmpty()) return candidates.take(limit)
    val starts = candidates.filter { it.startsWith(typed) }
    val contains = candidates.filter { !it.startsWith(typed) && it.contains(typed) }
    return (starts + contains).take(limit)
}

/** The tags after adding what was typed (it may hold several, separated by commas), normalised and capped. */
fun addTags(current: List<String>, typed: String): List<String> = normalizeTags(current + typed.split(',', ';'))

fun removeTag(current: List<String>, tag: String): List<String> = current.filter { it != tag }

// --- the shared-element flight ---------------------------------------------------------------------------------------

data class Rect(val left: Float, val top: Float, val width: Float, val height: Float)

data class Flight(val x: Float, val y: Float, val scaleX: Float, val scaleY: Float)

/** Where an image of [natural] size shows inside [box] fitted, not scaled up past its pixels when [cap]. */
fun containedRect(naturalWidth: Float, naturalHeight: Float, box: Rect, cap: Boolean = false): Rect {
    if (naturalWidth <= 0f || naturalHeight <= 0f || box.width <= 0f || box.height <= 0f) return box
    val ratio = minOf(box.width / naturalWidth, box.height / naturalHeight, if (cap) 1f else Float.POSITIVE_INFINITY)
    val width = naturalWidth * ratio
    val height = naturalHeight * ratio
    return Rect(box.left + (box.width - width) / 2f, box.top + (box.height - height) / 2f, width, height)
}

/**
 * The transform (origin at the element's top left) that makes what is visible at [to] look like it is at [from]: the
 * start of a flight from a slide into the viewer, or the end of one back. [element] is the animated element's own
 * rectangle; it is [to] when the element is the picture itself, and larger when the picture sits inside it (a pane that
 * fills the screen around an image). Scales are separate so a mismatched shape still lands.
 */
fun flightTransform(from: Rect, to: Rect, element: Rect = to): Flight {
    val scaleX = if (to.width > 0f) from.width / to.width else 1f
    val scaleY = if (to.height > 0f) from.height / to.height else 1f
    return Flight(
        x = from.left - element.left - (to.left - element.left) * scaleX,
        y = from.top - element.top - (to.top - element.top) * scaleY,
        scaleX = scaleX,
        scaleY = scaleY,
    )
}
