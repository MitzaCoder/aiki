package io.github.mitzacoder.aiki.chat

import io.github.mitzacoder.aiki.features.chat.*
import kotlinx.serialization.json.*
import org.junit.Assert.*
import org.junit.Test

/** Edit diffs as coloured lines (web `DiffView.svelte`, `ToolBody.svelte`) and which rows rise in. */
class TranscriptArrivalTest {
    @Test fun displayDiffLinesReadMarkersNumbersAndGaps() {
        val lines = displayDiffLines("  11 const a = 1;\n- 12 const b = 2;\n+ 12 const b = 3;\n    ...\n+13\tindented\n- old  ")
        assertEquals(listOf(DisplayDiffLine.Kind.Ctx, DisplayDiffLine.Kind.Del, DisplayDiffLine.Kind.Add, DisplayDiffLine.Kind.Gap, DisplayDiffLine.Kind.Add, DisplayDiffLine.Kind.Del), lines.map { it.kind })
        assertEquals(listOf("11", "12", "12", "", "13", ""), lines.map { it.number })
        assertEquals(listOf("const a = 1;", "const b = 2;", "const b = 3;", "⋯", "indented", "old  "), lines.map { it.text })
    }

    @Test fun anEditWithoutADiffShowsItsOldAndNewText() {
        assertEquals("- a\n- b\n+ c", editAsDiff("a\nb", "c"))
        val edits = buildJsonObject { put("path", "x.ts"); put("edits", buildJsonArray { add(buildJsonObject { put("oldText", "a"); put("newText", "b") }); add(buildJsonObject { put("oldText", "c"); put("newText", "d") }) }) }
        val sections = codingSections(ChatPart("e", "tool", "", "edit", "running", edits))
        assertEquals(listOf("Edit 1", "Edit 2"), sections.map { it.title })
        assertEquals(listOf("diff", "diff"), sections.map { it.language })
    }

    @Test fun writesAndEditsShowTheirOutputOnlyWhenTheyFailed() {
        val diff = buildJsonObject { put("diff", "+ 1 x") }
        assertEquals(listOf("Diff"), codingSections(ChatPart("e", "tool", "Successfully replaced text", "edit", "done", details = diff)).map { it.title })
        assertEquals(listOf("Diff", "Error output"), codingSections(ChatPart("e", "tool", "Could not find the text", "edit", "error", details = diff)).map { it.title })
        val write = buildJsonObject { put("path", "a.md"); put("content", "# A") }
        assertEquals(listOf("File contents"), codingSections(ChatPart("w", "tool", "Wrote 3 bytes", "write", "done", write)).map { it.title })
    }

    @Test fun rowsRiseOnlyWhenTheyArriveAtTheEnd() {
        assertTrue("the first load does not rise", arrivedRows(null, listOf("entry-1-0", "entry-2-0")).isEmpty())
        val first = listOf("entry-1-0", "entry-2-0")
        val second = first + listOf("entry-3-0", "live-0")
        assertEquals(setOf("entry-3-0", "live-0"), arrivedRows(first, second))
        // The streamed reply becomes its entry: the new key replaces the one that went and does not rise again.
        val stored = first + listOf("entry-3-0", "entry-4-0")
        assertTrue(arrivedRows(second, stored).isEmpty())
        assertEquals(setOf("entry-5-0"), arrivedRows(second, stored + "entry-5-0"))
        // History loaded above stays still.
        assertTrue(arrivedRows(stored, listOf("entry-0-0") + stored).isEmpty())
        assertTrue("nothing new", arrivedRows(stored, stored).isEmpty())
    }

    @Test fun anEmptyChatsFirstRowRises() {
        assertEquals(setOf("entry-1-0"), arrivedRows(emptyList(), listOf("entry-1-0")))
    }
}
