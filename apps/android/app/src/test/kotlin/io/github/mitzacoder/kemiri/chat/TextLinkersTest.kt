package io.github.mitzacoder.kemiri.chat

import androidx.compose.ui.text.LinkAnnotation
import io.github.mitzacoder.kemiri.features.chat.TextLinkSpan
import io.github.mitzacoder.kemiri.features.chat.TextLinker
import io.github.mitzacoder.kemiri.features.chat.linkSpans
import org.junit.Assert.assertEquals
import org.junit.Test

class TextLinkersTest {
    private fun linker(vararg ranges: IntRange) = TextLinker { ranges.map { TextLinkSpan(it.first, it.last + 1, LinkAnnotation.Url("https://x.test/${it.first}")) } }

    @Test fun anEarlierLinkersSpanWinsWhereTwoOverlapAndSpansComeInTextOrder() {
        val text = "see T1 and EX-12 here"
        val spans = linkSpans(text, listOf(linker(11..15, 4..5), linker(4..8, 17..20)))
        assertEquals(listOf(4 to 6, 11 to 16, 17 to 21), spans.map { it.start to it.end })
    }

    @Test fun spansOutsideTheTextAreDropped() {
        assertEquals(emptyList<TextLinkSpan>(), linkSpans("abc", listOf(linker(2..5), TextLinker { listOf(TextLinkSpan(2, 2, LinkAnnotation.Url("https://x.test"))) })))
    }
}
