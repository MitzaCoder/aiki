package com.mihaisaru.harness.chat

import com.mihaisaru.harness.features.chat.*
import com.mihaisaru.harness.features.tasks.parseTaskReference
import com.mihaisaru.harness.features.tasks.withTaskReference
import org.junit.Assert.*
import org.junit.Test

/** Mirrors apps/web/test/quotes.test.ts for Quotes.kt. */
class QuotesTest {
    @Test fun keepsTheLinesAndDropsTheEdges() {
        assertEquals("  first line\nsecond line\n\nthird", quoteFromSelection("\n\n  first line  \r\nsecond\u00a0line\n\n\n\nthird\n"))
        assertEquals("", quoteFromSelection(" \n\t\n"))
    }

    private val paragraph = "This paragraph is quoted."

    @Test fun movesAnEdgeInsideAWordOutToTheWholeWord() {
        assertEquals("This paragraph", selectionInWholeWords("his par", SelectionEdge(paragraph, 1), SelectionEdge(paragraph, 8)))
        assertEquals("paragraph", selectionInWholeWords("paragraph", SelectionEdge(paragraph, 5), SelectionEdge(paragraph, 14)))
        assertEquals("This", selectionInWholeWords("This", SelectionEdge(paragraph, 0), SelectionEdge(paragraph, 4)))
        assertEquals("quoted.", selectionInWholeWords("quoted.", SelectionEdge(paragraph, 18), SelectionEdge(paragraph, 25)))
        assertEquals("paragraph", selectionInWholeWords("ragra", SelectionEdge(paragraph, 7), SelectionEdge(paragraph, 12)))
    }

    @Test fun readsOnlyTheEdgesOwnBlock() {
        assertEquals("$paragraph\n", selectionInWholeWords("$paragraph\n", SelectionEdge(paragraph, 0), SelectionEdge("Next block", 0)))
        val code = "const a = 1;\nconst b = 2;"
        assertEquals("const a = 1", selectionInWholeWords("onst a = 1", SelectionEdge(code, 1), SelectionEdge(code, 11)))
        assertEquals("= 1;\nconst", selectionInWholeWords("= 1;\ncon", SelectionEdge(code, 8), SelectionEdge(code, 16)))
        assertEquals("his", selectionInWholeWords("his", null, null))
        val text = "Ştiinţa şi über"
        assertEquals("Ştiinţa şi über", selectionInWholeWords("inţa şi üb", SelectionEdge(text, 3), SelectionEdge(text, 13)))
    }

    @Test fun putsEachQuoteBeforeTheTypedTextAsABlockquote() {
        assertEquals("> one line\n\n> two\n>\n> paragraphs\n\nWhy?", messageWithQuotes(listOf("one line", "two\n\nparagraphs"), "  Why?  "))
        assertEquals("> just this", messageWithQuotes(listOf("just this"), ""))
        assertEquals("hello", messageWithQuotes(emptyList(), "hello"))
        assertEquals("hello", messageWithQuotes(listOf("  "), "hello"))
        assertEquals("> > earlier\n> reply\n\nok", messageWithQuotes(listOf("> earlier\nreply"), "ok"))
    }

    @Test fun splitQuotesReadsBackWhatMessageWithQuotesWrote() {
        val quotes = listOf("one line", "two\n\nparagraphs", "> earlier\nreply", "  indented code")
        assertEquals(QuotedMessage(quotes, "Why?\n\n> not a quote"), splitQuotes(messageWithQuotes(quotes, "Why?\n\n> not a quote")))
        assertEquals(QuotedMessage(listOf("only"), ""), splitQuotes(messageWithQuotes(listOf("only"), "")))
        assertEquals(QuotedMessage(emptyList(), "hello\n> later"), splitQuotes("hello\n> later"))
        assertEquals(QuotedMessage(emptyList(), ""), splitQuotes(""))
        assertEquals(QuotedMessage(listOf("tight\nspaced"), "rest"), splitQuotes(">tight\n> spaced\n\n\nrest"))
    }

    @Test fun worksAfterTheTaskReferenceTheServerPutsInFront() {
        val reference = parseTaskReference(withTaskReference("T12", messageWithQuotes(listOf("the plan"), "Go ahead")))
        assertEquals("T12", reference.taskId)
        assertEquals(QuotedMessage(listOf("the plan"), "Go ahead"), splitQuotes(reference.text))
    }

    @Test fun previewIsTheFirstLineWithText() {
        assertEquals("a b", quotePreview("\n   \n  a   b \nsecond"))
        assertEquals("", quotePreview(""))
    }
}
