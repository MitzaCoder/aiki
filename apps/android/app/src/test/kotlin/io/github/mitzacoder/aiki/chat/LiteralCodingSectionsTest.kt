package io.github.mitzacoder.aiki.chat

import io.github.mitzacoder.aiki.features.chat.*
import kotlinx.serialization.json.*
import org.junit.Assert.*
import org.junit.Test

class LiteralCodingSectionsTest {
    private val literal = "# not a heading\n- not a list\n\t  export const x = `code`;  \r\n\n"
    @Test fun copyKeepsEveryCharacterIncludingTrailingSpacesTabsAndCrLf() {
        assertEquals(literal,literalContentForCopy(literal))
        assertEquals("  \n",literalContentForCopy("  \n"))
        assertEquals("",literalContentForCopy(""))
    }
    @Test fun displayHighlighterAndAccessibleCopyLabelsKeepTheLiteralContract() = kotlinx.coroutines.runBlocking {
        for(language in listOf("", "typescript")) assertEquals(literal,ChatHighlighter.highlight(literal,language,false).text)
        for(title in listOf("Code","Command","Output","Error output","File contents","Diff","Script")) {
            assertEquals("Copy ${title.lowercase()}",literalCopyLabel(LiteralSection(title,literal)))
        }
    }
    @Test fun bashCommandAndStdoutAreIndependentLiteralCopySections() {
        val command = "printf '  # heading\\n'  \n"
        val part = ChatPart("b","tool",literal,"bash","done",buildJsonObject { put("command",command) })
        val sections = codingSections(part)
        assertEquals(listOf("Command","Output"),sections.map { it.title })
        assertEquals(command,sections[0].content)
        assertEquals("bash",sections[0].language)
        assertTrue(sections[0].wrapByDefault && !sections[0].wrap)
        assertEquals(literal,sections[1].content)
        assertTrue(sections[1].wrap)
        assertEquals("",sections[1].language)
    }
    @Test fun readWriteAndDiffKeepSourceWhitespaceAndAppropriateHeaders() {
        val args = buildJsonObject { put("path","proof.ts"); put("content",literal) }
        val read = codingSections(ChatPart("r","tool",literal,"read","done",args)).single()
        assertEquals("File contents",read.title); assertEquals("ts",read.language); assertEquals(literal,read.content)
        val write = codingSections(ChatPart("w","tool","Saved","write","done",args))
        assertEquals(literal,write.first { it.title == "File contents" }.content)
        val diff = "- old  \n+ new\t\n"
        val edit = codingSections(ChatPart("e","tool","Edited","edit","done",details = buildJsonObject { put("diff",diff) }))
        assertEquals(diff,edit.first { it.title == "Diff" }.content)
    }
    @Test fun authoredMarkdownThinkingAndImagesAreNotCodingSections() {
        for(kind in listOf("text","thinking","image","notice")) assertTrue(codingSections(ChatPart("a",kind,literal,name = "bash")).isEmpty())
        assertTrue(codingSections(ChatPart("m","tool",literal,"memory_read","done")).isEmpty())
        val error = codingSections(ChatPart("r","tool",literal,"read","error"))
        assertEquals("Error output",error.single().title)
        assertEquals(literal,error.single().content)
    }
}
