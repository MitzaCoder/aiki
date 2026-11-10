package io.github.mitzacoder.aiki.chat

import androidx.compose.ui.text.font.FontWeight
import io.github.mitzacoder.aiki.features.chat.CODE_TAG
import io.github.mitzacoder.aiki.features.chat.inline
import io.github.mitzacoder.aiki.features.chat.markdownText
import io.github.mitzacoder.aiki.features.tasks.boardMarkdownNeedsDisclosure
import org.commonmark.node.BulletList
import org.commonmark.node.OrderedList
import org.commonmark.parser.Parser
import org.junit.Assert.*
import org.junit.Test

class BoardMarkdownTest {
    @Test fun previewsStripNestedListsEmphasisAndNumbering() {
        assertEquals("Plan One Nested First Second", markdownText("**Plan**\n\n- **One**\n  - *Nested*\n\n1. First\n2. Second"))
    }
    @Test fun optionLabelsKeepCodeAndEscapedPunctuation() {
        assertEquals("Run dry_run and *literal* bun test", markdownText("Run `dry_run` and \\*literal\\*\n\n```sh\nbun test\n```"))
    }
    @Test fun previewsKeepLinkLabelsNotDestinations() {
        assertEquals("Read guide Diagram more", markdownText("[**Read** `guide`](https://example.com/a_(b)) ![Diagram](https://example.com/a.png) [more][doc]\n\n[doc]: https://example.com"))
    }
    @Test fun htmlNeverExecutesAndEntitiesAreReadable() {
        assertEquals("Hello world & #7", markdownText("Hello <b>world</b> &amp; &#35;7\n\n<script>alert(1)</script>"))
        assertEquals("", markdownText(""))
    }
    @Test fun cardFormattingRetainsBoldCodeAndSafeLinks() {
        val node = Parser.builder().build().parse("**Validate:** run `bun test` and [guide](https://example.com)").firstChild
        val text = inline(node, userMessage = true)
        assertEquals("Validate: run bun test and guide", text.text)
        assertTrue(text.spanStyles.any { it.item.fontWeight == FontWeight.Bold })
        assertEquals(1, text.getStringAnnotations(CODE_TAG, 0, text.length).size)
        assertEquals(1, text.getLinkAnnotations(0, text.length).size)
    }
    @Test fun cardListsKeepTheirNestedStructure() {
        val document = Parser.builder().build().parse("- One\n  - Nested\n\n1. First\n2. Second")
        assertTrue(document.firstChild is BulletList)
        assertTrue(document.firstChild.firstChild.lastChild is BulletList)
        assertTrue(document.lastChild is OrderedList)
    }
    @Test fun disclosureUsesWholeSourceNotASyntaxSlice() {
        assertFalse(boardMarkdownNeedsDisclosure("**Short**"))
        assertTrue(boardMarkdownNeedsDisclosure("**" + "long ".repeat(130) + "**"))
        assertTrue(boardMarkdownNeedsDisclosure((1..14).joinToString("\n") { "- item" }))
    }
}
