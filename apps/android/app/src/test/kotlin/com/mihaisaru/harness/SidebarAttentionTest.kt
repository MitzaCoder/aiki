package com.mihaisaru.harness

import com.mihaisaru.harness.navigation.*
import com.mihaisaru.harness.protocol.*
import org.junit.Assert.*
import org.junit.Test

class SidebarAttentionTest {
    private val empty = ProjectAttention(0, 0, 0, 0, null, 0, 0, 0, null, null, null, null, null)
    private fun project(id: String, attention: ProjectAttention? = null) = ProjectSummary(
        id, id, "/test", WorkerDefaults(ModelRef("faux", "faux-1"), null), emptyList(), ProjectCheckIns(true, 10),
        state = "open", activity = ProjectActivity("idle", 0, null, null), attention = attention,
    )

    @Test fun crossBackendQuestionsAndFailuresLeadReviewsAndEqualPrioritiesAreStable() {
        val links = needsYouLinks(listOf(
            BackendAttentionProjects("a", "Studio", listOf(project("review", empty.copy(reviewTasks = 3, reviewTaskId = "T1")), project("failure", empty.copy(failedWorkers = 1, failedWorkerTaskId = "T2")))),
            BackendAttentionProjects("b", "Remote", listOf(project("q", empty.copy(questions = 2, warnings = 1, questionTaskId = "T3")), project("also-q", empty.copy(questions = 1)))),
        ))
        assertEquals(listOf("q/Question", "also-q/Question", "q/Warning", "failure/Worker", "review/Review"), links.map { "${it.projectName}/${it.action.kind}" })
        assertEquals(8L, links.sumOf { it.action.count })
        assertEquals("b", links.first().backendKey)
        assertEquals("T3", links.first().action.taskId)
    }

    @Test fun allSignalsAreCountedOnceAndArchivedProjectsAreExcluded() {
        val all = project("all", empty.copy(questions = 1, warnings = 2, failedWorkers = 3, failedThreads = 1, reviewTasks = 4)).copy(activity = ProjectActivity("failed", 0, null, null))
        assertEquals(12L, attentionCount(all))
        assertEquals(AttentionKind.entries, projectAttentionActions(all).map { it.kind })
        assertEquals(0L, attentionCount(all.copy(archived = true)))
    }

    @Test fun oldServersUseActivityButInventNoTaskTotals() {
        val old = project("old").copy(activity = ProjectActivity("failed", 0, null, null, openQuestions = 2))
        assertEquals(listOf("2 questions", "Coordinator failed"), projectAttentionActions(old).map { it.label })
        assertEquals(3L, attentionCount(old))
        assertTrue(projectAttentionActions(project("empty", empty)).isEmpty())
    }

    @Test fun waitingIsCalmUntilServerReturnsItAndAllThreadWorkersAreIncluded() {
        val waiting = project("wait", empty.copy(waitingTasks = 2, nextReturnAt = "2026-11-16T09:00:00Z"))
        assertEquals(0L, attentionCount(waiting))
        assertTrue(sidebarStatus(waiting, projectStatus(waiting, 0)).label.startsWith("Returns "))
        assertEquals("1 to review", projectAttentionActions(waiting.copy(attention = waiting.attention!!.copy(reviewTasks = 1))).first().label)
        val working = project("work", empty.copy(runningWorkers = 2))
        assertEquals("Working · 2 workers", sidebarStatus(working, projectStatus(working, 0)).label)
    }

    @Test fun failedThreadKeepsBackendProjectAndThreadIdentity() {
        val link = needsYouLinks(listOf(BackendAttentionProjects("b", "Remote", listOf(project("p", empty.copy(failedThreads = 1, failedThreadId = "release")))))).single()
        assertEquals("b", link.backendKey)
        assertEquals("p", link.projectId)
        assertEquals("release", link.action.threadId)
    }
}
