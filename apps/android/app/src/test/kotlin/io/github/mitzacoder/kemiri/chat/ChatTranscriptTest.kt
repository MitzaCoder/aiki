package io.github.mitzacoder.kemiri.chat

import io.github.mitzacoder.kemiri.features.chat.*
import io.github.mitzacoder.kemiri.protocol.EntryRecord
import kotlinx.serialization.json.*
import org.junit.Assert.*
import org.junit.Test

class ChatTranscriptTest {
    private fun entry(id: Long, kind: String, message: String, data: String? = null) = EntryRecord(id, 1, kind, listOf(Json.parseToJsonElement(message)), data?.let(Json::parseToJsonElement))
    @Test fun realThreadInputWhitespaceAndNestedFailureAreNotUserText() {
        for (text in listOf("  [thread poster finished]\nDone", "[thread poster failed: bad [input]]", " [from poster] hello", "[thread poster waiting]future")) {
            val message = buildJsonObject { put("role", "user"); put("content", text) }
            assertEquals(text, "notice", transcript(listOf(EntryRecord(1, 1, "pi.user", listOf(message))), null).single().parts.single().kind)
        }
    }
    @Test fun malformedThreadMarkersStayUserTextAndImagesPreventInjection() {
        for(text in listOf("[from ] hello", "[thread] hello", "[board]game")) {
            val message = buildJsonObject { put("role","user"); put("content",text) }
            assertEquals("user",transcript(listOf(EntryRecord(1,1,"pi.user",listOf(message))),null).single().parts.single().kind)
        }
        val image = entry(1,"pi.user","""{"role":"user","content":[{"type":"text","text":"[thread poster finished] Done"},{"type":"image","data":"abc","mimeType":"image/png"}]}""")
        assertEquals(listOf("user","image"),transcript(listOf(image),null).flatMap { it.parts }.map { it.kind })
    }
    @Test fun completeWorkerFailuresKeepNestedBracketsAndMultilineReasonsOutOfUserBubbles() {
        assertEquals(WorkerNotice("failure","w","denied [403]\nretry failed [timeout]"),parseWorkerNotice("  [worker w failed: denied [403]\nretry failed [timeout]]  "))
        assertEquals(WorkerNotice("report","w","Ordinary report"),parseWorkerNotice(" [worker w reported]\nOrdinary report "))
        for(text in listOf("[worker w failed: denied [403]]", "  [worker w failed: denied [403]\nretry failed [timeout]]  ", "[worker w failed: reason ends in reported]]", " [worker w reported]\nOrdinary report")) {
            val message = buildJsonObject { put("role","user"); put("content",text) }
            val part = transcript(listOf(EntryRecord(1,1,"pi.user",listOf(message))),null).single().parts.single()
            assertEquals(text,"notice",part.kind)
            assertEquals(text,part.text)
        }
        val image = entry(1,"pi.user","""{"role":"user","content":[{"type":"text","text":"[worker w failed: denied [403]]"},{"type":"image","data":"abc","mimeType":"image/png"}]}""")
        assertEquals(listOf("user","image"),transcript(listOf(image),null).flatMap { it.parts }.map { it.kind })
        for(text in listOf("ordinary typed text", "[worker w failed: denied] extra", "[worker w pending]")) {
            val message = buildJsonObject { put("role","user"); put("content",text) }
            assertEquals("user",transcript(listOf(EntryRecord(1,1,"pi.user",listOf(message))),null).single().parts.single().kind)
        }
    }
    @Test fun settledWinsOverLiveAndDetailsBelongToMessage() {
        val call = entry(1,"pi.assistant","""{"role":"assistant","content":[{"type":"toolCall","id":"a","name":"bash","arguments":{"command":"pwd"}}]}""")
        val result = entry(2,"pi.tool-result","""{"role":"toolResult","toolCallId":"a","content":[{"type":"text","text":"output"}],"details":{"exit":2},"isError":true}""", """{"diagnostics":[{"code":"exit_code","message":"Command exited with code 2"}]}""")
        val live = Json.parseToJsonElement("""{"tools":[{"callId":"a","name":"bash","status":"running","output":"old"}]}""")
        val rows = transcript(listOf(call,result),live)
        assertEquals(1,rows.size)
        val tool = rows.single().parts.single()
        assertEquals("output",tool.text)
        assertEquals("exited",tool.status)
        assertEquals(2,tool.details?.jsonObject?.get("exit")?.jsonPrimitive?.int)
    }
    @Test fun codingGroupsKeepThinkingInsideButNotAfter() {
        val parts = listOf(ChatPart("a","tool",name="read"),ChatPart("b","thinking"),ChatPart("c","tool",name="edit"),ChatPart("d","thinking"),ChatPart("e","tool",name="board"))
        assertEquals(listOf(3,1,1),groupParts(parts).map { it.parts.size })
    }
    @Test fun injectedInputsAndImageOnlyInputsAreNotLost() {
        val rows = transcript(listOf(entry(1,"pi.user","""{"role":"user","content":"[worker abc reported]\nDone"}"""),entry(2,"pi.user","""{"role":"user","content":[{"type":"image","data":"abc","mimeType":"image/png"}]}""")),null)
        assertEquals("notice",rows[0].parts.single().kind)
        assertEquals("image",rows[1].parts.single().kind)
    }
    @Test fun liveMessageReplacedByIdenticalSettledMessage() {
        val message = """{"role":"assistant","timestamp":123,"content":[{"type":"text","text":"hello"}]}"""
        assertEquals(1, transcript(listOf(entry(1,"pi.assistant",message)),Json.parseToJsonElement("""{"generation":{"message":$message}}""")).size)
    }
    @Test fun codemodeFlattensOnlyParseableSingleCallsAndClassifiesNestedExit() {
        val nested = Json.parseToJsonElement("""{"id":1,"name":"bash","args":"{\"command\":\"pwd\"}","status":"ok"}""").jsonObject
        val script = ChatPart("s","tool","Script completed\nWall time 1 seconds\nOutput:\nhello", "codemode","done",Json.parseToJsonElement("""{"code":"return await tools.bash({command:'pwd'})"}"""), nested = listOf(nested))
        val flat = unwrapScript(script)
        assertEquals("bash",flat.name)
        assertEquals("hello",flat.text)
        assertNotNull(flat.viaScript)
        assertEquals("exited",nestedCallStatus(Json.parseToJsonElement("""{"status":"error","error":"Command exited with code 2"}""").jsonObject))
        assertEquals("cancelled",nestedCallStatus(Json.parseToJsonElement("""{"status":"cancelled"}""").jsonObject))
        assertEquals("codemode",unwrapScript(script.copy(nested = listOf(nested,nested))).name)
    }
    @Test fun orphanResultsAndInterruptedCallsRemainVisible() {
        assertEquals("done",transcript(listOf(entry(1,"pi.tool-result","""{"role":"toolResult","toolCallId":"x","toolName":"read","content":"ok","details":{"diff":"here"}}""")),null).single().parts.single().status)
        assertEquals("interrupted",transcript(listOf(entry(1,"pi.assistant","""{"role":"assistant","content":[{"type":"toolCall","id":"x","name":"read"}]}""")),null).single().parts.single().status)
    }
}
