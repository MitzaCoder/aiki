package io.github.mitzacoder.kemiri.chat

import io.github.mitzacoder.kemiri.features.chat.CODE_TAG
import io.github.mitzacoder.kemiri.features.chat.inline
import org.commonmark.parser.Parser
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.commonmark.node.FencedCodeBlock
import androidx.compose.ui.text.LinkAnnotation
import io.github.mitzacoder.kemiri.features.chat.TextLinker
import io.github.mitzacoder.kemiri.features.chat.TextLinkSpan
import org.junit.Test

class MarkdownInlineTest {
    private fun paragraph(source: String) = inline(Parser.builder().build().parse(source).firstChild)

    @Test fun softLineBreaksJoinLikeTheWeb() {
        assertEquals("Outcome: done Files changed: a.ts", paragraph("Outcome: done\nFiles changed: a.ts").text)
    }

    @Test fun hardLineBreaksStay() {
        assertEquals("one\ntwo\nthree", paragraph("one  \ntwo\\\nthree").text)
    }

    @Test fun userSoftLineBreaksStayAsTyped() {
        val node = Parser.builder().build().parse("one\ntwo\nthree").firstChild
        assertEquals("one\ntwo\nthree", inline(node, userMessage = true).text)
        assertEquals("one two three", inline(node).text)
    }

    @Test fun userFormattingAndTaskLinksKeepTheirSpans() {
        val node = Parser.builder().build().parse("**bold** *italic* T12 `T12`").firstChild
        val linker = TextLinker { text ->
            if(text.contains("T12")) listOf(TextLinkSpan(text.indexOf("T12"), text.indexOf("T12") + 3, LinkAnnotation.Url("https://example.com/tasks/T12"))) else emptyList()
        }
        val text = inline(node, listOf(linker), userMessage = true)
        assertEquals("bold italic T12 T12", text.text)
        assertEquals(1, text.getLinkAnnotations(0, text.length).size)
        assertEquals(1, text.getStringAnnotations(CODE_TAG, 0, text.length).size)
        assertTrue(text.spanStyles.isNotEmpty())
    }

    @Test fun userHtmlStaysLiteralAndUnsafeLinksAreNotClickable() {
        val node = Parser.builder().build().parse("hello <b>world</b> [bad](javascript:alert(1))").firstChild
        val text = inline(node, userMessage = true)
        assertEquals("hello <b>world</b> bad", text.text)
        assertTrue(text.getLinkAnnotations(0, text.length).isEmpty())
    }

    @Test fun userFencesKeepTheirCodeForCopyAndWrap() {
        val code = Parser.builder().build().parse("```kt\nval x = 1\n```").firstChild as FencedCodeBlock
        assertEquals("kt", code.info)
        assertEquals("val x = 1\n", code.literal)
    }

    @Test fun inlineCodeIsMarkedForItsBox() {
        val text = paragraph("Run `bun test` now")
        assertEquals("Run bun test now", text.text)
        assertEquals(listOf(4 to 12), text.getStringAnnotations(CODE_TAG, 0, text.length).map { it.start to it.end })
    }
}
