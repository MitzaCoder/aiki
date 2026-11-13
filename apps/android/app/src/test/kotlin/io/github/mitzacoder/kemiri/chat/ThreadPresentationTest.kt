package io.github.mitzacoder.kemiri.chat

import io.github.mitzacoder.kemiri.features.chat.*
import io.github.mitzacoder.kemiri.protocol.*
import kotlinx.serialization.json.*
import org.junit.Assert.*
import org.junit.Test

class ThreadPresentationTest {
    private fun json(s: String) = Json.parseToJsonElement(s)
    @Test fun realNoticeFormsPreserveFailureAndFutureInputs() {
        assertEquals(ThreadNotice("failed","poster","bad [input]"),parseThreadNotice(" [thread poster failed: bad [input]]"))
        assertEquals("why\n\nmore",parseThreadNotice("[thread poster failed: why] more")?.body)
        assertEquals("message",parseThreadNotice("[from main]do it")?.kind)
        assertEquals("other",parseThreadNotice("[thread poster paused]later")?.kind)
        assertNull(parseThreadNotice("[from ]hello"))
        assertNull(parseThreadNotice("[thread poster"))
    }
    @Test fun handoffTitleIsJsonNotSpaceDelimitedOrRevisionEditable() {
        val title = "Fix \"quotes\", C:\\work\nnext"
        val quoted = JsonPrimitive(title).toString()
        assertEquals(BoardHandoff("poster","T1",title),parseBoardHandoff("[board] Thread \"poster\" handed T1 $quoted (r12) to you. Claim received."))
        assertNull(parseBoardHandoff("[board] Thread \"poster\" handed T1 $quoted (rno) to you."))
        assertNull(parseBoardHandoff("[board] User changed T1"))
    }
    @Test fun actualResultFieldsNotFixtureAssumptions() {
        val start = ChatPart("a","tool",name = "thread_start",status = "done",arguments = json("""{"title":"Poster","brief":"Make art"}"""),details = json("""{"threadId":"poster","conversationId":18}"""))
        assertEquals("poster",threadCallId(start))
        assertEquals("Started Poster in the background",threadCallLabel(start))
        assertEquals("poster",threadCallId(start.copy(name = "thread_send",arguments = json("""{"id":"poster","message":"hello"}"""))))
        assertEquals("art-1",artifactCallId(start.copy(name = "artifact_save",details = json("""{"artifactId":"art-1"}"""))))
        assertNull(artifactCallId(start.copy(details = json("""{"id":"fixture-assumption"}"""))))
        assertEquals("Listed 1 background thread",threadCallLabel(start.copy(name = "thread_list",text = "You are main. 1 background thread.")))
        assertEquals("Looked in on Poster",threadCallLabel(start.copy(name = "thread_peek",text = "poster — Poster\nWorking")))
        assertTrue(threadCallLabel(start.copy(status = "error")).startsWith("Could not"))
        assertNull(threadCallId(start.copy(status = "error")))
        assertNull(artifactCallId(start.copy(status = "error",details = json("""{"artifactId":"art-1"}"""))))
        assertTrue(threadCallLabel(start.copy(status = "interrupted")).endsWith("interrupted"))
    }
    @Test fun finishesOnlyShowArtifactsSavedByThatMessage() {
        fun artifact(id: String, thread: String, at: String) = Artifact(id,"p",id,null,null,"text","text/plain",10,null,thread,null,null,"/tmp/a",null,at)
        val items = listOf(artifact("before","poster","2026-01-01T00:00:00Z"),artifact("later","poster","2026-01-02T00:00:00Z"),artifact("other","main","2026-01-01T00:00:00Z"))
        assertEquals(listOf("before"),finishArtifacts(items,"poster",java.time.Instant.parse("2026-01-01T00:00:00Z").toEpochMilli()).map { it.id })
        assertEquals(2,finishArtifacts(items,"poster",null).size)
        val message = json("""{"role":"user","timestamp":123,"content":"[thread poster finished] Done"}""")
        assertEquals(123L,transcript(listOf(EntryRecord(1,1,"pi.user",listOf(message))),null).single().parts.single().timestamp)
    }
    @Test fun compactControlsKeepExplicitVersusDefaultState() {
        assertEquals("Worker default",composerModelLabel(null,null,"Worker default"))
        assertEquals("Fast",composerModelLabel(ModelRef("p","m"),"Fast","Worker default"))
        assertEquals("m",composerModelLabel(ModelRef("p","m"),null,"Choose a model"))
        assertEquals(setOf("coordinatorModel","coordinatorThinkingLevel"),coordinatorResetFields(null,null))
        assertFalse(workerDefaultsEditable(false,true,false))
    }
}
