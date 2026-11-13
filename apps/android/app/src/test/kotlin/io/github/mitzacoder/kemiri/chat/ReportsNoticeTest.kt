package io.github.mitzacoder.kemiri.chat

import io.github.mitzacoder.kemiri.features.chat.*

import org.junit.Assert.*
import org.junit.Test
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import io.github.mitzacoder.kemiri.protocol.EntryRecord

class ReportsNoticeTest {
    private val raw = "[reports] T132 Next stale: audit: Q140 pending; awaiting human review; T7 Results/Next stale: new activity. Read tasks; rewrite stale sections with evidence."
    @Test fun taskSectionsAndReasons() {
        assertEquals(ReportsNotice(raw, listOf(
            ReportNoticeSection("T132", "Next", "audit: Q140 pending; awaiting human review"),
            ReportNoticeSection("T7", "Results", "new activity"),
            ReportNoticeSection("T7", "Next", "new activity"),
        )), parseReportsNotice(raw))
    }
    @Test fun prefixBoundariesAndFutureBodies() {
        for (text in listOf("[reports]please", "please [reports] T1 Next stale: old", "ordinary text")) assertNull(parseReportsNotice(text))
        for (text in listOf("[reports]", "  [reports]\nFuture shape")) {
            assertEquals(ReportsNotice(text, emptyList()), parseReportsNotice(text))
            assertTrue(injectedInput(text) is InjectedInput.Reports)
        }
        assertEquals(1, parseReportsNotice("[reports] T1 Next/Next stale: old")!!.sections.size)
    }
    @Test fun storedHistoryIsNoticeNotUserBubble() {
        val message = Json.parseToJsonElement("""{"role":"user","content":"[reports] T1 Next stale: audit","timestamp":123}""").jsonObject
        val rows = transcript(listOf(EntryRecord(1, 1, "pi.user", listOf(message))), null)
        assertEquals("notice", rows.single().parts.single().kind)
        assertTrue(isTaskLineRow(rows.single()))
        assertTrue(injectedInput(rows.single().parts.single().text) is InjectedInput.Reports)
        val imageMessage = Json.parseToJsonElement("""{"role":"user","content":[{"type":"text","text":"[reports] T1 Next stale: audit"},{"type":"image","data":"abc","mimeType":"image/png"}]}""")
        assertEquals(listOf("user", "image"), transcript(listOf(EntryRecord(1, 1, "pi.user", listOf(imageMessage))), null).flatMap { it.parts }.map { it.kind })
    }
}
