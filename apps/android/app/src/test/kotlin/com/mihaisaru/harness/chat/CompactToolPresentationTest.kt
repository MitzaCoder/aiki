package com.mihaisaru.harness.chat

import com.mihaisaru.harness.features.chat.*
import kotlinx.serialization.json.*
import org.junit.Assert.*
import org.junit.Test

class CompactToolPresentationTest {
    private fun json(s: String) = Json.parseToJsonElement(s)
    @Test fun codingSummaryNamesActionsNotProtocolTools() {
        assertEquals("Read 2 files · Ran 1 command · Edited 1 file",codingHeadline(listOf(ChatPart("a","tool",name = "read"),ChatPart("b","tool",name = "read"),ChatPart("c","thinking"),ChatPart("d","tool",name = "bash"),ChatPart("e","tool",name = "edit"))))
    }
    @Test fun memorySummariesTrustResultDetailsAndPreserveFailureState() {
        val memory = ChatPart("m","tool",name = "memory_search",status = "done",details = json("""{"hits":3}"""))
        assertEquals("Found 3 memories",compactToolHeadline(memory))
        assertEquals("Memory search failed",compactToolHeadline(memory.copy(status = "error")))
        assertEquals("Created a memory",compactToolHeadline(memory.copy(name = "memory_write",details = json("""{"created":true}"""))))
        assertEquals("Similar memories found · not created",compactToolHeadline(memory.copy(name = "memory_write",details = json("""{"created":false,"matches":2}"""))))
    }
    @Test fun codeModeSummarizesCommentAndErrorsNeverBecomeArtifactPreviews() {
        assertEquals("Inspect the checkout",compactToolHeadline(ChatPart("c","tool",name = "codemode",arguments = json("""{"code":"// Inspect the checkout\nreturn await tools.read({path:'a'})"}"""))))
        for(status in listOf("error","exited","interrupted","running","preparing")) {
            assertNull(artifactCallId(ChatPart("a","tool",name = "artifact_save",status = status,details = json("""{"artifactId":"saved-id"}"""))))
        }
    }
}
