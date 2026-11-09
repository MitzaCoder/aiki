package com.mihaisaru.harness.chat

import com.mihaisaru.harness.features.chat.*
import com.mihaisaru.harness.protocol.*
import com.mihaisaru.harness.data.wireJson
import kotlinx.serialization.json.*
import org.junit.Assert.*
import org.junit.Test

class ChatControlsTest {
    private fun question(id: String, thread: String?, status: String = "open") = BoardQuestion(id = id, revision = 1, text = "Question", options = emptyList(), taskId = null, threadId = thread, status = status, answer = null, askedAt = "now", answeredAt = null)
    @Test fun mainPinsEveryOpenThreadAndBackgroundOnlyItsOwn() {
        val questions = listOf(question("legacy",null),question("main","main"),question("a","background-a"),question("b","background-b"),question("answered","background-a","answered"),question("withdrawn",null,"withdrawn"))
        assertEquals(listOf("legacy","main","a","b"),pinnedQuestions(questions,null).map { it.id })
        assertEquals(pinnedQuestions(questions,null),pinnedQuestions(questions,"main"))
        assertEquals(listOf("a"),pinnedQuestions(questions,"background-a").map { it.id })
        assertTrue(pinnedQuestions(questions,"missing").isEmpty())
    }
    @Test fun workerDefaultsCannotBeEditedBeforeSnapshotOrWhileSaving() {
        assertFalse(workerDefaultsEditable(loaded = false,ready = true,saving = false))
        assertFalse(workerDefaultsEditable(loaded = true,ready = false,saving = false))
        assertFalse(workerDefaultsEditable(loaded = true,ready = true,saving = true))
        assertTrue(workerDefaultsEditable(loaded = true,ready = true,saving = false))
    }
    @Test fun resettingWorkerOverrideEncodesBothRequiredNulls() {
        val request = WorkersDefaultsSetRequest(projectId = "project",defaults = WorkerDefaults(null,null))
        val defaults = wireJson.encodeToJsonElement(WorkersDefaultsSetRequest.serializer(),request).jsonObject.getValue("defaults").jsonObject
        assertEquals(JsonNull,defaults.getValue("model"))
        assertEquals(JsonNull,defaults.getValue("thinkingLevel"))
    }
    @Test fun coordinatorResetSendsExplicitNullsAndEffortResetPreservesModel() {
        assertEquals(setOf("coordinatorModel","coordinatorThinkingLevel"),coordinatorResetFields(null,null))
        assertEquals(setOf("coordinatorThinkingLevel"),coordinatorResetFields(ModelRef("p","m"),null))
        assertTrue(coordinatorResetFields(ModelRef("p","m"),"high").isEmpty())
    }
}
