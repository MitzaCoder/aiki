package com.mihaisaru.harness.chat

import com.mihaisaru.harness.data.ConnectionStatus
import com.mihaisaru.harness.data.WatchStatus
import com.mihaisaru.harness.features.chat.*
import com.mihaisaru.harness.features.settings.connectionLabel
import com.mihaisaru.harness.navigation.connectionAwayWord
import com.mihaisaru.harness.protocol.*
import kotlinx.serialization.json.*
import org.junit.Assert.*
import org.junit.Test

/** The chat's own states as the web words them: working, the composer's hint, banners, the orb's turns, the pickers. */
class ChatStatesTest {
    private fun json(s: String) = Json.parseToJsonElement(s)

    @Test fun workingIsARunWithNothingStreamingYet() {
        assertFalse(isWorking(null))
        assertFalse(isWorking(json("""{}""")))
        assertTrue(isWorking(json("""{"run":{"id":"r"}}""")))
        assertTrue(isWorking(json("""{"run":{"id":"r"},"generation":{"retry":{"error":"x"}}}""")))
        assertFalse(isWorking(json("""{"run":{"id":"r"},"generation":{"message":{"role":"assistant","content":[]}}}""")))
        assertFalse(isWorking(json("""{"run":{"id":"r"},"tools":[{"callId":"c","name":"bash","status":"running"}]}""")))
        // A worker's page says so for the whole run, as the web's does.
        assertTrue(isWorking(json("""{"run":{"id":"r"},"tools":[{"callId":"c","name":"bash","status":"running"}]}"""),worker = true))
    }

    @Test fun composerHintFollowsTheWeb() {
        assertEquals("Choose a coordinator model first",composerHint(canChat = false,ready = true,thread = false,busy = false))
        assertEquals("Reconnecting…",composerHint(canChat = true,ready = false,thread = false,busy = true))
        assertEquals("Message this thread directly…",composerHint(canChat = true,ready = true,thread = true,busy = true))
        assertEquals("Send — the coordinator gets it at its next step…",composerHint(canChat = true,ready = true,thread = false,busy = true))
        assertEquals("Message the coordinator…",composerHint(canChat = true,ready = true,thread = false,busy = false))
    }

    @Test fun mainNeedsACoordinatorModelAndAThreadDoesNot() {
        val project = ProjectSummary(id = "p",name = "P",path = "/p",coordinator = WorkerDefaults(model = null,thinkingLevel = null),workerModels = emptyList(),
            checkIns = ProjectCheckIns(enabled = false,intervalMinutes = 30),state = "ready")
        assertFalse(canChat(null,thread = false))
        assertFalse(canChat(project,thread = false))
        assertTrue(canChat(project,thread = true))
        assertTrue(canChat(project.copy(coordinator = WorkerDefaults(model = ModelRef("faux","faux-1"),thinkingLevel = null)),thread = false))
    }

    @Test fun transcriptBannerNamesWhatIsAway() {
        assertNull(transcriptBanner(WatchStatus.Live,null,worker = false))
        assertEquals("Connecting to the transcript…",transcriptBanner(WatchStatus.Connecting,null,worker = false))
        assertEquals("Reconnecting to the transcript… Socket closed",transcriptBanner(WatchStatus.Reconnecting,"Socket closed",worker = false))
        assertEquals("Reconnecting to the worker's transcript…",transcriptBanner(WatchStatus.Reconnecting,null,worker = true))
        assertEquals("The transcript view stopped. gone",transcriptBanner(WatchStatus.Ended,"gone",worker = false))
        assertEquals("The transcript view is stopped.",transcriptBanner(WatchStatus.Stopped,null,worker = false))
    }

    @Test fun connectionWordsCountTheAttempts() {
        assertEquals("Reconnecting…",connectionLabel(ConnectionStatus.Reconnecting))
        assertEquals("Reconnecting (6)…",connectionLabel(ConnectionStatus.Reconnecting,6))
        assertEquals("reconnecting",connectionAwayWord(ConnectionStatus.Reconnecting))
        assertNull(connectionAwayWord(ConnectionStatus.Ready))
    }

    @Test fun oneOrbPerTurnActiveWhileItStreams() {
        fun row(key: String, kind: String, turn: TurnMeta? = null) = ChatRow(key,listOf(ChatPart(key,kind,"x")),turn)
        val rows = listOf(
            row("u1","user"),
            row("t1","thinking"), row("a1","text"), row("c1","tool",TurnMeta()),
            row("u2","user"),
            row("a2","text",TurnMeta(streaming = true)),
            row("n","notice"),
        )
        val orbs = turnOrbs(rows)
        assertEquals(listOf(null,TurnOrb(true,false),TurnOrb(false,false),TurnOrb(false,false),null,TurnOrb(true,true),null),orbs)
    }

    @Test fun thinkingHeaderWordsMatchTheWeb() {
        assertEquals("Thought",thinkingHeaderText(1,false))
        assertEquals("Thinking",thinkingHeaderText(0,true))
        assertEquals("Thought for a while · 3 steps",thinkingHeaderText(3,false))
        assertEquals("Thinking · 2 steps",thinkingHeaderText(2,true))
    }

    @Test fun pickersGroupEveryModelByProviderName() {
        fun model(provider: String, id: String, name: String, configured: Boolean = true) =
            ModelInfo(provider = provider,modelId = id,name = name,contextWindow = 400_000,maxTokens = 1,input = listOf("text"),reasoning = false,thinkingLevels = emptyList(),configured = configured)
        val models = listOf(model("zeta","z1","Zed"),model("faux","f1","Faux One",configured = false),model("faux","f2","Faux Two"))
        val providers = listOf(ProviderInfo(id = "zeta",name = "Alpha Cloud",configured = true),ProviderInfo(id = "faux",name = "Faux",configured = false))
        val groups = groupModels(models,providers,"")
        assertEquals(listOf("Alpha Cloud","Faux"),groups.map { it.label })
        assertEquals(listOf("f1","f2"),groups[1].models.map { it.modelId })
        assertEquals(listOf("z1"),groupModels(models,providers,"alpha").single().models.map { it.modelId })
        assertEquals("400K",compactNumber(400_000.0))
        assertEquals(listOf(0,1,2,3,4),listOf(null,"low","medium","high","max").map(::thinkingIntensity))
    }

    @Test fun onlyTheLiveMessagesLastBlockStillThinks() {
        fun live(content: String) = json("""{"run":{"id":"r"},"generation":{"message":{"role":"assistant","content":$content}}}""")
        val thinking = """{"type":"thinking","thinking":"Check the gate."}"""
        assertEquals("running",transcript(emptyList(),live("[$thinking]")).single().parts.single().status)
        val answering = transcript(emptyList(),live("""[$thinking,{"type":"text","text":"Re-run it."}]"""))
        assertEquals("done",answering.first().parts.single().status)
    }
}
