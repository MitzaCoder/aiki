package io.github.mitzacoder.kemiri.chat

import io.github.mitzacoder.kemiri.features.chat.*
import io.github.mitzacoder.kemiri.protocol.*
import kotlinx.serialization.json.*
import org.junit.Assert.*
import org.junit.Test

/** Replay of sanitized REAL checkout tool outputs captured by T18; not a new server fixture. */
class RealCardSamplesTest {
    private val json = Json { ignoreUnknownKeys = true }
    private val sample = javaClass.getResourceAsStream("/chat/real-card-samples.json")!!.bufferedReader().use { json.parseToJsonElement(it.readText()).jsonObject }
    @Test fun actualCallsKeepResultFieldsErrorsAndTimestamps() {
        val calls = sample["toolCalls"]!!.jsonArray.map { it.jsonObject["call"]!!.jsonObject }.associateBy { it["id"]!!.jsonPrimitive.content }
        sample["toolResults"]!!.jsonArray.forEachIndexed { index, item ->
            val message = item.jsonObject["message"]!!.jsonObject
            val call = calls[message["toolCallId"]!!.jsonPrimitive.content]!!
            val assistant = buildJsonObject { put("role","assistant"); put("content",JsonArray(listOf(call))) }
            val rows = transcript(listOf(EntryRecord(index*2L,1,"pi.assistant",listOf(assistant)),EntryRecord(index*2L+1,1,"pi.tool-result",listOf(message))),null)
            val part = rows.single().parts.single()
            assertEquals(message["timestamp"]!!.jsonPrimitive.long,part.timestamp)
            assertEquals(message["durationMs"]!!.jsonPrimitive.long,part.durationMs)
            val error = message["isError"] == JsonPrimitive(true)
            if(error) { assertEquals("error",part.status); assertNull(artifactCallId(part)); assertNull(threadCallId(part)); assertNull(artifactFromTool(part,"p")) }
            if(part.name == "thread_list") { assertNull(part.details); assertEquals("Listed 1 background thread",threadCallLabel(part)) }
            if(part.name == "thread_peek") assertEquals("Looked in on Contract proof",threadCallLabel(part))
            if(part.name == "artifact_save" && !error) {
                assertEquals(message["details"]!!.jsonObject["artifactId"]!!.jsonPrimitive.content,artifactCallId(part))
                assertNotNull(artifactFromTool(part,sample["projectId"]!!.jsonPrimitive.content))
            }
        }
    }
    @Test fun actualNoticesAndHistoricalFinishCutsIncludeWorkerSaves() {
        val artifacts = sample["ownership"]!!.jsonArray.map { json.decodeFromJsonElement(Artifact.serializer(),it) }
        val notices = sample["notices"]!!.jsonArray
        notices.forEachIndexed { i, message ->
            val part = transcript(listOf(EntryRecord(i.toLong(),1,"pi.user",listOf(message))),null).single().parts.single()
            assertEquals("notice",part.kind)
            val notice = parseThreadNotice(part.text)
            if(notice?.kind == "failed") assertEquals("Deterministic verification model failure [not a server fixture]",notice.body)
            if(part.text.startsWith("[board]")) assertEquals(BoardHandoff("contract-proof","T1","Contract \"evidence\" \\ trail\nnotes"),parseBoardHandoff(part.text))
        }
        sample["finishCuts"]!!.jsonArray.forEach { cut ->
            val timestamp = cut.jsonObject["timestamp"]!!.jsonPrimitive.long
            val saved = finishArtifacts(artifacts,"contract-proof",timestamp)
            assertEquals(cut.jsonObject["artifacts"]!!.jsonPrimitive.int,saved.size)
            assertTrue(saved.any { it.workerId == "proof-worker" })
            assertTrue(saved.all { it.threadId == "contract-proof" })
        }
        val video = artifacts.single { it.kind == "video" }
        assertEquals("Video · 0:02 · 9.4 KB · T1",artifactFacts(video))
        assertEquals(2,artifacts.filter { it.workerId == "proof-worker" }.map { it.threadId }.distinct().size)
    }
}
