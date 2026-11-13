package io.github.mitzacoder.kemiri.tasks

import io.github.mitzacoder.kemiri.features.tasks.media.*
import io.github.mitzacoder.kemiri.protocol.Artifact
import org.junit.Assert.*
import org.junit.Test
import java.time.Instant

private var counter = 0

private fun artifact(
    kind: String = "image",
    name: String? = null,
    title: String? = null,
    tags: List<String>? = null,
): Artifact {
    counter += 1
    return Artifact(
        id = "a$counter", projectId = "p1", name = name ?: "shot$counter.png", title = title, note = null, kind = kind,
        mimeType = "image/png", size = 1000, durationSeconds = null, threadId = "main", workerId = null, taskId = "T1",
        sourcePath = "/work/shot.png", tags = tags, createdAt = Instant.ofEpochSecond(1_794_000_000L + counter).toString(),
    )
}

/** Mirrors apps/web/test/media-gallery.test.ts (and the tag cases of packages/server/test/artifacts.test.ts). */
class MediaGalleryTest {
    @Test fun collapsesPairAtEarliestMemberWithAfterThumbnailAndOneCount() {
        val before = artifact(tags = listOf("web", "before"))
        val video = artifact(kind = "video")
        val after = artifact(tags = listOf("after", "web"), title = "Checkout")
        val slides = mediaSlides(listOf(before, video, after))
        assertEquals(listOf(after.id, video.id), slides.map { it.artifact.id })
        assertEquals(ComparePair(before, after), slides[0].pair)
        assertEquals("Before and after: Checkout", mediaSlideLabel(slides[0], 0, slides.size))
        assertTrue(mediaSlideLabel(slides[1], 1, slides.size).startsWith("Video 2 of 2:"))
    }

    @Test fun afterFirstAndRepeatedTagSetsKeepSaveOrder() {
        val after1 = artifact(tags = listOf("after"))
        val before1 = artifact(tags = listOf("before"))
        val before2 = artifact(tags = listOf("before"))
        val after2 = artifact(tags = listOf("after"))
        val solo = artifact()
        val slides = mediaSlides(listOf(after1, before1, before2, solo, after2))
        assertEquals(listOf(after1.id, after2.id, solo.id), slides.map { it.artifact.id })
        assertEquals(listOf(before1.id, before2.id, null), slides.map { it.pair?.before?.id })
    }

    @Test fun pairsOnlyWithinFilterAndRestoresSeparatePages() {
        val before = artifact(tags = listOf("web", "before"))
        val after = artifact(tags = listOf("web", "after"))
        val items = listOf(before, after)
        assertEquals(listOf(MediaSlide(before)), mediaSlides(filterByTag(items, "before")))
        assertEquals(1, mediaSlides(filterByTag(items, "web")).size)
        assertEquals(items.map { MediaSlide(it) }, mediaSlides(items, separate = true))
    }

    @Test fun unpairedAmbiguousAndVideoMediaAreUnchanged() {
        val items = listOf(artifact(tags = listOf("before")), artifact(tags = listOf("before", "after")), artifact(kind = "video", tags = listOf("after")))
        assertEquals(items.map { MediaSlide(it) }, mediaSlides(items))
        assertTrue(mediaSlides(emptyList()).isEmpty())
    }

    @Test fun retainsEitherPairMemberWhenTogglingAndClampsRemovedItems() {
        val before = artifact(tags = listOf("before"))
        val solo = artifact()
        val after = artifact(tags = listOf("after"))
        val slides = mediaSlides(listOf(before, solo, after))
        assertEquals(0, mediaSlideIndex(slides, before.id, 2))
        assertEquals(0, mediaSlideIndex(slides, after.id, 2))
        assertEquals(1, mediaSlideIndex(slides, "removed", 9))
        assertEquals(0, mediaSlideIndex(emptyList(), before.id, 0))
    }

    @Test fun normalisesTagsTrimLowercaseDedupeCharactersLengthAndCount() {
        assertEquals(listOf("web", "phone", "dark-mode", "a-b"), normalizeTags(listOf("  Web ", "PHONE", "web", "Dark Mode", "a/b", "", "  ", "!!!")))
        assertEquals(ARTIFACT_MAX_TAG_LENGTH, normalizeTag("x".repeat(40))!!.length)
        assertEquals("before", normalizeTag("-before-"))
        assertEquals("v1.2", normalizeTag("v1.2"))
        assertEquals(ARTIFACT_MAX_TAGS, normalizeTags(List(30) { "tag$it" }).size)
        assertEquals(emptyList<String>(), normalizeTags(null))
        assertNull(normalizeTag("***"))
        // A cut that ends on a separator drops it.
        assertEquals("a".repeat(23), normalizeTag("a".repeat(23) + "-bbb"))
    }

    @Test fun splitMediaKeepsImagesAndVideosOldestFirstAndTheRestNewestFirst() {
        val log = artifact(kind = "text", name = "run.log")
        val clip = artifact(kind = "video", name = "clip.webm")
        val shot = artifact()
        val report = artifact(kind = "file", name = "r.pdf")
        val (media, files) = splitMedia(listOf(report, shot, clip, log))
        assertEquals(listOf(clip.id, shot.id), media.map { it.id })
        assertEquals(listOf(report.id, log.id), files.map { it.id })
        assertTrue(isMedia(clip) && isMedia(shot) && !isMedia(log))
    }

    private val items = listOf(
        artifact(tags = listOf("web", "phone", "dark")),
        artifact(tags = listOf("web", "desktop")),
        artifact(tags = listOf("android", "phone")),
        artifact(),
    )

    @Test fun countsEachTagOncePerItemMostUsedFirstThenAlphabetical() {
        assertEquals(
            listOf(TagCount("phone", 2), TagCount("web", 2), TagCount("android", 1), TagCount("dark", 1), TagCount("desktop", 1)),
            tagCounts(items),
        )
        assertEquals(listOf(TagCount("a", 1)), tagCounts(listOf(artifact(tags = listOf("a", "a")))))
        assertEquals(emptyList<TagCount>(), tagCounts(emptyList()))
    }

    @Test fun filtersByOneTagOrKeepsEverythingForNull() {
        assertEquals(2, filterByTag(items, "phone").size)
        assertEquals(0, filterByTag(items, "nope").size)
        assertEquals(4, filterByTag(items, null).size)
    }

    @Test fun letsGoOfATagNothingCarriesAnyMore() {
        val counts = tagCounts(items)
        assertEquals("web", resolveTagFilter(counts, "web"))
        assertNull(resolveTagFilter(counts, "gone"))
        assertNull(resolveTagFilter(counts, null))
    }

    @Test fun slideLabelSaysTheKindThePositionAmongTheShownMediaAndTheTitleOrName() {
        assertEquals("Screenshot 3 of 8: Checkout", slideLabel(artifact(title = "Checkout"), 2, 8))
        assertEquals("Video 1 of 1: run.webm", slideLabel(artifact(kind = "video", name = "run.webm"), 0, 1))
    }

    @Test fun findsTheNearestSlideForAScrollOffsetAndClampsIt() {
        assertEquals(0, nearestSlide(0f, 300f, 5))
        assertEquals(0, nearestSlide(149f, 300f, 5))
        assertEquals(1, nearestSlide(151f, 300f, 5))
        assertEquals(4, nearestSlide(5000f, 300f, 5))
        assertEquals(0, nearestSlide(-40f, 300f, 5))
        assertEquals(0, nearestSlide(100f, 0f, 5))
        assertEquals(0, nearestSlide(100f, 300f, 0))
    }

    @Test fun movesWithTheArrowsHomeAndEndStoppingAtTheEnds() {
        assertEquals(3, stepIndex(2, 5, "ArrowRight"))
        assertEquals(1, stepIndex(2, 5, "ArrowLeft"))
        assertEquals(0, stepIndex(0, 5, "ArrowLeft"))
        assertEquals(4, stepIndex(4, 5, "ArrowRight"))
        assertEquals(0, stepIndex(2, 5, "Home"))
        assertEquals(4, stepIndex(2, 5, "End"))
        assertNull(stepIndex(2, 5, "a"))
        assertNull(stepIndex(0, 0, "ArrowRight"))
    }

    @Test fun keepsTheSameArtifactInViewWhenTheListChanges() {
        val (a, b, c, d) = listOf(artifact(), artifact(), artifact(), artifact())
        assertEquals(1, keepIndex(listOf(a, b, c), 1, listOf(a, b, c, d)))
        assertEquals(0, keepIndex(listOf(a, b, c), 2, listOf(c, a, b)))
        // The shown one went away: the nearest position, clamped.
        assertEquals(1, keepIndex(listOf(a, b, c), 2, listOf(a, b)))
        assertEquals(0, keepIndex(listOf(a, b, c), 1, emptyList()))
    }

    @Test fun loadsFullImagesOnlyNearTheActiveSlide() {
        assertEquals(listOf(false, true, true, true, false), listOf(-2, -1, 0, 1, 2).map(::loadsFull))
    }

    @Test fun dimsAndShrinksSlidesBesideTheMiddleNoFurtherThanOneStep() {
        assertEquals(SlideLook(1f, 1f), slideLook(0f))
        assertTrue(slideLook(1f).scale < 1f)
        assertEquals(slideLook(1f), slideLook(-1f))
        assertEquals(slideLook(1f), slideLook(3f))
        assertTrue(slideLook(0.5f).opacity > slideLook(1f).opacity)
    }

    @Test fun pairsABeforeWithTheAfterThatHasTheSameOtherTagsInEitherOrder() {
        val after = artifact(tags = listOf("after", "web", "phone"))
        val before = artifact(tags = listOf("web", "phone", "before"))
        val pairs = comparePairs(listOf(after, before))
        assertEquals(ComparePair(before, after), pairs[before.id])
        assertSame(pairs[before.id], pairs[after.id])
        assertEquals(2, pairs.size)
    }

    @Test fun doesNotPairItemsWhoseOtherTagsDiffer() {
        val items = listOf(
            artifact(tags = listOf("web", "phone", "before")),
            artifact(tags = listOf("web", "desktop", "after")),
            artifact(tags = listOf("web", "before")),
            artifact(tags = listOf("web", "phone", "dark", "after")),
        )
        assertEquals(0, comparePairs(items).size)
    }

    @Test fun pairsABareBeforeWithABareAfter() {
        val before = artifact(tags = listOf("before"))
        val after = artifact(tags = listOf("after"))
        assertSame(after, comparePairs(listOf(before, after))[before.id]?.after)
    }

    @Test fun pairsSeveralOfAKindInOrderOfSaveTimeAndLeavesTheExtraOneOut() {
        val b1 = artifact(tags = listOf("web", "before"))
        val b2 = artifact(tags = listOf("web", "before"))
        val a1 = artifact(tags = listOf("web", "after"))
        val a2 = artifact(tags = listOf("web", "after"))
        val b3 = artifact(tags = listOf("web", "before"))
        val pairs = comparePairs(listOf(a2, b3, a1, b2, b1))
        assertSame(a1, pairs[b1.id]?.after)
        assertSame(a2, pairs[b2.id]?.after)
        assertFalse(pairs.containsKey(b3.id))
    }

    @Test fun ignoresVideosItemsWithBothTagsAndUntaggedItems() {
        val items = listOf(
            artifact(kind = "video", tags = listOf("web", "before")),
            artifact(kind = "video", tags = listOf("web", "after")),
            artifact(tags = listOf("web", "before", "after")),
            artifact(tags = listOf("web", "after")),
            artifact(),
        )
        assertEquals(0, comparePairs(items).size)
    }

    @Test fun aPairNeedsBothMembersInTheListItIsGiven() {
        val before = artifact(tags = listOf("web", "before"))
        val after = artifact(tags = listOf("web", "after"))
        assertEquals(0, comparePairs(filterByTag(listOf(before, after), "before")).size)
        assertEquals(2, comparePairs(filterByTag(listOf(before, after), "web")).size)
    }

    @Test fun theDividerClampsToZeroToHundredAndFallsBackToTheMiddleForNonsense() {
        assertEquals(0f, clampPercent(-5f), 0f)
        assertEquals(100f, clampPercent(130f), 0f)
        assertEquals(50f, clampPercent(Float.NaN), 0f)
    }

    @Test fun theDividerMovesWithTheArrowsShiftForMoreHomeAndEndAndStopsAtTheEnds() {
        assertEquals(52f, dividerAfterKey(50f, "ArrowRight", false)!!, 0f)
        assertEquals(40f, dividerAfterKey(50f, "ArrowLeft", true)!!, 0f)
        assertEquals(100f, dividerAfterKey(99f, "ArrowRight", true)!!, 0f)
        assertEquals(0f, dividerAfterKey(50f, "Home", false)!!, 0f)
        assertEquals(100f, dividerAfterKey(50f, "End", false)!!, 0f)
        assertNull(dividerAfterKey(50f, "x", false))
    }

    @Test fun readsThePointersPlaceOverTheBox() {
        assertEquals(25f, dividerAtPointer(150f, 100f, 200f), 0f)
        assertEquals(0f, dividerAtPointer(50f, 100f, 200f), 0f)
        assertEquals(100f, dividerAtPointer(500f, 100f, 200f), 0f)
        assertEquals(50f, dividerAtPointer(500f, 100f, 0f), 0f)
    }

    @Test fun suggestsFromTheTaskThenTheProjectThenTheSuggestedTagsMinusTheOnesAlreadyOn() {
        fun suggest(query: String, limit: Int = 8) = suggestTags(query, current = listOf("web"), task = listOf("dark", "web"), project = listOf("storybook", "phone"), limit = limit)
        assertEquals(listOf("dark", "storybook", "phone", "android"), suggest("", 4))
        assertEquals(listOf("phone"), suggest("pho"))
        // Starting with it first, then merely containing it.
        assertEquals(listOf("phone", "desktop"), suggest("p"))
        assertEquals(listOf("dark"), suggest("ar"))
        assertEquals(emptyList<String>(), suggest("zzz"))
        assertEquals(listOf("dark"), suggest("  DAR "))
    }

    @Test fun putsWhatStartsWithTheTextBeforeWhatOnlyContainsIt() {
        assertEquals(listOf("dark2", "dark", "xdark"), suggestTags("dark", current = emptyList(), task = listOf("xdark", "dark2"), project = emptyList()))
    }

    @Test fun addsTypedTagsNormalisedSeveralAtOnceWithoutDuplicates() {
        assertEquals(listOf("web", "phone", "dark"), addTags(listOf("web"), " Phone, DARK ,web"))
        assertEquals(listOf("web"), addTags(listOf("web"), "  "))
        assertEquals(listOf("phone"), removeTag(listOf("web", "phone"), "web"))
    }

    @Test fun listsTheProjectsTagsMostUsedFirst() {
        assertEquals(listOf("b", "a"), projectTags(listOf(artifact(tags = listOf("b", "a")), artifact(tags = listOf("b")))))
    }

    @Test fun findsWhereAPictureShowsInsideABox() {
        val box = Rect(10f, 20f, 400f, 200f)
        assertEquals(Rect(110f, 20f, 200f, 200f), containedRect(100f, 100f, box))
        assertEquals(Rect(10f, 95f, 400f, 50f), containedRect(800f, 100f, box))
        // Capped: a small picture is not blown up.
        assertEquals(Rect(160f, 95f, 100f, 50f), containedRect(100f, 50f, box, cap = true))
        assertSame(box, containedRect(0f, 0f, box))
    }

    @Test fun theFlightMakesTheEndRectangleLookLikeTheStartOne() {
        val slide = Rect(100f, 300f, 200f, 100f)
        val full = Rect(0f, 50f, 400f, 200f)
        assertEquals(Flight(100f, 250f, 0.5f, 0.5f), flightTransform(slide, full))
        assertEquals(Flight(0f, 0f, 1f, 1f), flightTransform(full, full))
        assertEquals(1f, flightTransform(slide, Rect(0f, 0f, 0f, 0f)).scaleX, 0f)
        // The picture sits inside a bigger element: the transform still lands the picture on the start rectangle.
        val pane = Rect(0f, 0f, 400f, 300f)
        val picture = Rect(50f, 50f, 300f, 200f)
        val from = Rect(120f, 400f, 150f, 100f)
        val t = flightTransform(from, picture, pane)
        assertEquals(from.left, 50f * t.scaleX + t.x, 1e-3f)
        assertEquals(from.top, 50f * t.scaleY + t.y, 1e-3f)
        assertEquals(from.left + from.width, 350f * t.scaleX + t.x, 1e-3f)
    }

    @Test fun theMotionTimesAreTheWebsMediaMotion() {
        // The same numbers as MEDIA_MOTION in apps/web/src/lib/media-gallery.ts.
        assertEquals(220, MediaMotion.slideMs)
        assertEquals(180, MediaMotion.stripMs)
        assertEquals(110, MediaMotion.captionMs)
        assertEquals(20, MediaMotion.captionDelayMs)
        assertEquals(66, MediaMotion.captionOutMs)
        assertEquals(260, MediaMotion.viewerOpenMs)
        assertEquals(210, MediaMotion.viewerCloseMs)
    }
}
