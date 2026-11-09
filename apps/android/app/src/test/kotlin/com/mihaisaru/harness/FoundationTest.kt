package com.mihaisaru.harness

import com.mihaisaru.harness.core.*
import com.mihaisaru.harness.data.*
import kotlinx.serialization.json.*
import org.junit.Assert.*
import org.junit.Test
import java.util.Base64

class FoundationTest {
    private val json = Json
    private fun value(s: String) = json.parseToJsonElement(s)

    @Test fun allChordVerbsAndRootArrays() {
        val start = value("""{"text":"hello","nested":{"gone":1},"items":[1,2,3]}""")
        val ops = value("""[
            ["a",["text"]," 🌍"],
            ["t",["text"],7],
            ["d",["nested","gone"]],
            ["s",["nested","new"],true],
            ["p",["items"],1,1,[7,8]],
            ["m",["items"],[3,0,1,2]]
        ]""").jsonArray
        val actual = applyChord(start, ops.map { it.jsonArray })
        // JS truncate uses UTF-16 code units, not Unicode codepoints.
        assertEquals('\uDF0D'.toString(), actual.jsonObject.getValue("text").jsonPrimitive.content)
        assertEquals(value("""{"new":true}"""), actual.jsonObject["nested"])
        assertEquals(value("[3,1,7,8]"), actual.jsonObject["items"])
        assertEquals(start, value("""{"text":"hello","nested":{"gone":1},"items":[1,2,3]}"""))
        assertEquals(value("[9,2]"), applyChord(value("[1,2]"), listOf(value("""["p",[],0,1,[9]]""").jsonArray)))
        assertEquals(JsonNull, applyChord(start, listOf(value("""["r",null]""").jsonArray)))
    }

    @Test fun invalidChordIsAtomicAndRejected() {
        val start = value("""{"text":"a"}""")
        assertThrows(IllegalArgumentException::class.java) {
            applyChord(start, listOf(value("""["a",["missing"],"b"]""").jsonArray))
        }
        assertThrows(IllegalArgumentException::class.java) {
            applyChord(value("[1,2]"), listOf(value("""["m",[],[0,0]]""").jsonArray))
        }
        assertEquals(value("""{"text":"a"}"""), start)
    }

    private fun payload(text: String) = "v1." + Base64.getUrlEncoder().withoutPadding().encodeToString(text.toByteArray())
    @Test fun connectDecodeIsStrictAndDeduplicatesOrigins() {
        assertEquals(listOf(BackendConfig("Desk", "https://desk.example")), decodeConnect(payload("Desk\thttps://DESK.example/\nOther\thttps://desk.example")).getOrThrow())
        for (bad in listOf("v2.YQ", "v1.%%", payload("X\thttp://desk.example"), payload("X\thttps://u:p@desk.example"), payload("X\thttps://desk.example/path"), payload("X\thttps://desk.example?"), payload("X\thttps://desk.example\nBAD"))) {
            assertTrue(bad, decodeConnect(bad).isFailure)
        }
        assertTrue(decodeConnect("v1._w").isFailure) // Invalid UTF-8.
        assertTrue(decodeConnect(payload((1..13).joinToString("\n") { "B$it\thttps://b$it.example" })).isFailure)
    }

    @Test fun reconnectBackoffMatchesWeb() {
        assertEquals(250L, reconnectDelay(0, 0.5))
        assertEquals(500L, reconnectDelay(1, 0.5))
        assertEquals(8000L, reconnectDelay(100, 0.5))
        assertEquals(200L, reconnectDelay(0, 0.0))
        assertEquals(300L, reconnectDelay(0, 1.0))
        assertTrue(isPermanentWatchError("unknown_project"))
        assertFalse(isPermanentWatchError("internal"))
    }
}
