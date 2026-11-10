package io.github.mitzacoder.aiki.chat

import io.github.mitzacoder.aiki.features.chat.*
import io.github.mitzacoder.aiki.protocol.*
import kotlinx.serialization.json.*
import org.junit.Assert.*
import org.junit.Test

class ChatReviewRegressionTest {
    private fun artifact(id: String) = Artifact(id,"p",id,null,null,"text","text/plain",1,null,"main",null,null,"/tmp/a",null,"2026-01-01T00:00:00Z")
    @Test fun olderArtifactOutsideFiveHundredWindowStillAllowsIdBasedAccess() {
        val recent = (1..500).map { artifact("a$it") }
        val old = artifactForViewing("p","a0",recent)
        assertNotNull(old)
        assertEquals("a0",old?.id)
        assertEquals("p",old?.projectId)
        assertEquals("file",old?.kind)
        assertEquals(recent[0],artifactForViewing("p","a1",recent))
    }
    @Test fun realWorkerToolsUseIdAndNeverStealOtherToolsIds() {
        for(name in listOf("worker_spawn","worker_send","worker_stop","worker_peek","worker_forget")) {
            assertEquals("same",workerCallId(ChatPart("a","tool",name = name,arguments = Json.parseToJsonElement("""{"id":"same"}"""))))
        }
        for(name in listOf("thread_send","read","board","artifact_save")) {
            assertNull(workerCallId(ChatPart("a","tool",name = name,arguments = Json.parseToJsonElement("""{"id":"same","workerId":"wrong"}"""))))
        }
    }
    @Test fun workerNamesAndSpawnCallsAreScopedToTheirCoordinator() {
        fun worker(thread: String?) = WorkerSummary("same","Same","done",ModelRef("p","m"),null,"shared",null,1,threadId = thread,spawnedByCallId = "spawn",createdAt = "",updatedAt = "",lastReport = null,failure = null)
        val main = worker(null); val background = worker("poster")
        val all = listOf(main,background)
        val call = ChatPart("a","tool",name = "worker_peek",arguments = Json.parseToJsonElement("""{"id":"same"}"""))
        assertEquals(main,workerForCall(call,all,"main"))
        assertEquals(background,workerForCall(call,all,"poster"))
        assertNull(workerForCall(call,all,"elsewhere"))
        assertNull(workerForCall(call,emptyList(),"poster"))
        assertEquals(background,workerForCall(call.copy(key = "call-spawn",name = "worker_spawn",arguments = null),all,"poster"))
    }
    @Test fun finishStripsIncludeCoordinatorAndWorkerSavesOnlyInThatThreadAndTime() {
        val mainCoordinator = artifact("mc")
        val mainWorker = artifact("mw").copy(workerId = "same")
        val backgroundCoordinator = artifact("bc").copy(threadId = "poster")
        val backgroundWorker = artifact("bw").copy(threadId = "poster",workerId = "same")
        val later = backgroundWorker.copy(id = "later",createdAt = "2026-01-02T00:00:00Z")
        val all = listOf(mainCoordinator,mainWorker,backgroundCoordinator,backgroundWorker,later)
        val finish1 = java.time.Instant.parse("2026-01-01T00:00:00Z").toEpochMilli()
        val finish2 = java.time.Instant.parse("2026-01-02T00:00:00Z").toEpochMilli()
        assertEquals(listOf("mc","mw"),finishArtifacts(all,"main",finish1).map { it.id })
        assertEquals(listOf("bc","bw"),finishArtifacts(all,"poster",finish1).map { it.id })
        assertEquals(listOf("bc","bw","later"),finishArtifacts(all,"poster",finish2).map { it.id })
    }
    @Test fun metadataCacheCannotCrossBackendProjectOrDeletedIdentity() {
        val known = artifact("a0")
        ChatArtifactMetadata.keep("one",known)
        assertEquals(known,ChatArtifactMetadata.find("one","p","a0"))
        assertNull(ChatArtifactMetadata.find("two","p","a0"))
        assertNull(ChatArtifactMetadata.find("one","other","a0"))
        ChatArtifactMetadata.remove("one","p","a0")
        assertNull(ChatArtifactMetadata.find("one","p","a0"))
        ChatArtifactMetadata.keep("one",known)
        assertNull(ChatArtifactMetadata.find("one","p","a0"))
        assertTrue(ChatArtifactMetadata.isDeleted("one","p","a0"))
    }
    @Test fun imageErrorsRenewTwiceThenExposeRetryInsteadOfLooping() {
        assertTrue(imageCanRenew(0)); assertTrue(imageCanRenew(1))
        assertFalse(imageCanRenew(2)); assertFalse(imageCanRenew(100))
    }
}
