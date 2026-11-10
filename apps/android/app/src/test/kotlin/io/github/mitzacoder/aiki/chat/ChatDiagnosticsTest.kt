package io.github.mitzacoder.aiki.chat

import io.github.mitzacoder.aiki.features.chat.*
import io.github.mitzacoder.aiki.protocol.EntryRecord
import kotlinx.serialization.json.*
import org.junit.Assert.*
import org.junit.Test

class ChatDiagnosticsTest {
    private val failure = "Command exited with code 37"
    private val diagnostic = """{"severity":"error","code":"exit_code","message":"Command exited with code 37"}"""
    private fun json(value: String) = Json.parseToJsonElement(value)
    private fun result(output: String = "") = EntryRecord(2, 1, "pi.tool-result", listOf(buildJsonObject {
        put("role", "toolResult"); put("toolCallId", "a"); put("toolName", "bash"); put("isError", true)
        putJsonArray("content") { add(buildJsonObject { put("type", "text"); put("text", output) }) }
    }), json("""{"diagnostics":[$diagnostic]}"""))
    private fun projected(output: String = "") = transcript(listOf(result(output)), null).single().parts.single()

    private fun diagnostics(part: ChatPart) = part.diagnostics
    @Test fun silentBashFailureRetainsExactDiagnostic() {
        val part = projected()
        assertEquals("error", part.status)
        assertEquals(37, toolExitCode(part))
        assertEquals("error · exit 37", toolStatusLabel(part))
        assertEquals(listOf(json(diagnostic)), visibleDiagnostics(part))
        assertEquals(listOf(json(diagnostic)), diagnostics(part))
    }
    @Test fun singleChildFlattenPreservesFailureAlongsideScriptOutput() {
        val child = json("""{"id":1,"name":"bash","args":"{\"command\":\"exit 37\"}","status":"error","durationMs":12,"error":"Command exited with code 37"}""").jsonObject
        val part = unwrapScript(ChatPart("a", "tool", "Script completed\nWall time 0.1 seconds\nOutput:\n", "codemode", "done", json("""{"code":"return await tools.bash({command:'exit 37'})"}"""), nested = listOf(child)))
        assertEquals("bash", part.name)
        assertEquals("exited", part.status)
        assertEquals(listOf(json(diagnostic)), diagnostics(part))
        assertNotNull(part.viaScript)
        assertEquals(37, toolExitCode(part))
        assertEquals(listOf(json(diagnostic)), visibleDiagnostics(part))
    }
    @Test fun mixedOutputDoesNotReplaceDiagnostics() {
        val part = projected("partial output\n$failure")
        assertEquals("exited", part.status)
        assertEquals("partial output\n$failure", part.text)
        assertTrue(visibleDiagnostics(part).isEmpty())
        assertEquals(listOf(json(diagnostic)), visibleDiagnostics(projected("partial output")))
        assertEquals(listOf(json(diagnostic)), diagnostics(part))
    }
    @Test fun nonExitChildErrorsAndWarningsRemainDetailed() {
        val child = json("""{"id":1,"name":"read","args":"{\"path\":\"missing\"}","status":"error","error":"File not found: missing"}""").jsonObject
        val warning = json("""{"severity":"warn","code":"truncated","message":"Output truncated"}""").jsonObject
        val part = unwrapScript(ChatPart("a", "tool", "Script completed\nWall time 1 seconds\nOutput:\npartial", "codemode", "done", json("""{"code":"return await tools.read({path:'missing'})"}"""), nested = listOf(child), diagnostics = listOf(warning)))
        assertEquals("error", part.status)
        assertNull(toolExitCode(part))
        assertEquals(listOf("Output truncated", "File not found: missing"), visibleDiagnostics(part).map { it["message"]!!.jsonPrimitive.content })
    }
    @Test fun liveToSettledKeepsDiagnosticsWithoutDuplicates() {
        val live = json("""{"tools":[{"callId":"a","name":"bash","status":"running","diagnostics":[$diagnostic]}]}""")
        val running = transcript(emptyList(), live).single().parts.single()
        val settling = transcript(listOf(result()), live).single().parts.single()
        val settled = projected()
        assertEquals(running.key, settled.key)
        assertEquals(diagnostics(running), diagnostics(settling))
        assertEquals(diagnostics(settling), diagnostics(settled))
        assertEquals(1, diagnostics(settled).size)
    }
}
