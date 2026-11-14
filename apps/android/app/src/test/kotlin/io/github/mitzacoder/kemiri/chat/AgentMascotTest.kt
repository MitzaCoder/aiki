package io.github.mitzacoder.kemiri.chat

import io.github.mitzacoder.kemiri.features.chat.showsAgentActivityRow
import io.github.mitzacoder.kemiri.features.chat.agentFinished
import io.github.mitzacoder.kemiri.features.chat.agentWaitingForUser
import io.github.mitzacoder.kemiri.protocol.BoardQuestion
import io.github.mitzacoder.kemiri.ui.components.AgentMotion
import io.github.mitzacoder.kemiri.ui.components.MascotPose
import io.github.mitzacoder.kemiri.ui.components.mascotPose
import org.junit.Assert.*
import org.junit.Test

class AgentMascotTest {
    private fun question() = BoardQuestion(id="Q1",revision=1,text="Proceed?",options=emptyList(),taskId=null,status="open",answer=null,askedAt="2026-01-01T00:00:00Z",answeredAt=null)
    @Test fun onlyScopedBlockingAsksMeanWaiting() {
        val q = question()
        assertTrue(agentWaitingForUser(listOf(q)))
        for(other in listOf(q.copy(status="answered"),q.copy(status="withdrawn"),q.copy(kind="warning"),q.copy(blocksWork=false),q.copy(threadId="background"))) assertFalse(agentWaitingForUser(listOf(other)))
        assertTrue(agentWaitingForUser(listOf(q.copy(threadId="background")),threadId="background"))
        assertTrue(agentWaitingForUser(listOf(q.copy(kind="warning",blocksWork=true))))
        assertFalse(agentWaitingForUser(listOf(q),worker=true))
        assertTrue(agentWaitingForUser(listOf(q.copy(taskId="T1")),workerTaskId="T1",worker=true))
        assertFalse(agentWaitingForUser(listOf(q.copy(taskId="T2")),workerTaskId="T1",worker=true))
    }
    @Test fun waitingNeverAddsAnActivityMascot() {
        for(working in listOf(false,true)) for(completed in listOf(false,true)) {
            assertFalse(showsAgentActivityRow(true,working,completed))
            assertEquals(working || completed,showsAgentActivityRow(false,working,completed))
        }
    }
    @Test fun onlySuccessfulLiveCompletionCelebrates() {
        assertTrue(agentFinished(true,false,false,true,false))
        assertFalse(agentFinished(false,false,false,true,false))
        assertFalse(agentFinished(true,true,false,true,false))
        assertFalse(agentFinished(true,false,true,true,false))
        assertFalse(agentFinished(true,false,false,false,false))
        assertFalse(agentFinished(true,false,false,true,true))
    }
    @Test fun loopsAreSeamlessAndDoneSettlesWithoutLooping() {
        assertEquals(mascotPose(AgentMotion.Working,0),mascotPose(AgentMotion.Working,6000))
        assertEquals(mascotPose(AgentMotion.Waiting,0),mascotPose(AgentMotion.Waiting,3500))
        assertEquals(MascotPose(),mascotPose(AgentMotion.Done,1300))
        assertEquals(MascotPose(),mascotPose(AgentMotion.Done,9000))
        assertEquals(MascotPose(),mascotPose(AgentMotion.Idle,1800))
        assertTrue(mascotPose(AgentMotion.Done,442).y < 0f)
    }
    @Test fun largerMascotUsesFullVectorMotion() {
        assertEquals(-12f,mascotPose(AgentMotion.Working,1500).y,.001f)
        assertEquals(-4.5f,mascotPose(AgentMotion.Working,900).leaf,.001f)
        assertEquals(-42f,mascotPose(AgentMotion.Done,442).y,.001f)
    }
    @Test fun waitingBodyIsStillAndWorkingBlinksOnceInTwoLoops() {
        for(t in 0L..3500L step 100L) {
            val p = mascotPose(AgentMotion.Waiting,t)
            assertEquals(0f,p.y,0f); assertEquals(1f,p.scaleX,0f); assertEquals(1f,p.scaleY,0f)
        }
        assertEquals(1f,mascotPose(AgentMotion.Working,2550).blink,0f)
        assertEquals(.08f,mascotPose(AgentMotion.Working,5550).blink,.001f)
        assertTrue(mascotPose(AgentMotion.Waiting,500).gazeX < 0f)
        assertTrue(mascotPose(AgentMotion.Waiting,1200).gazeY < 0f)
        assertTrue(mascotPose(AgentMotion.Waiting,2000).gazeX > 0f)
    }
}
