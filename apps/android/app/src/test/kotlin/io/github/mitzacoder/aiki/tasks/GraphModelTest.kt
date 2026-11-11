package io.github.mitzacoder.aiki.tasks

import io.github.mitzacoder.aiki.data.DeviceSettings
import io.github.mitzacoder.aiki.data.wireJson
import io.github.mitzacoder.aiki.features.tasks.graph.*
import io.github.mitzacoder.aiki.features.tasks.board.*
import io.github.mitzacoder.aiki.protocol.*
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.*
import org.junit.Assert.*
import org.junit.Test
import java.io.File

class GraphModelTest {
    private val vector by lazy {
        val root = generateSequence(File(System.getProperty("user.dir"))) { it.parentFile }
            .map { File(it, "apps/android/test-vectors/task-graph-v1.json") }.first { it.isFile }
        wireJson.parseToJsonElement(root.readText()).jsonObject
    }
    private val now get() = graphTimestamp(vector.getValue("now").jsonPrimitive.content)!!
    private val tasks get() = wireJson.decodeFromJsonElement(ListSerializer(BoardTask.serializer()), vector.getValue("tasks"))
    private fun model() = buildGraphModel(tasks,
        wireJson.decodeFromJsonElement(ListSerializer(BoardQuestion.serializer()), vector.getValue("questions")),
        wireJson.decodeFromJsonElement(ListSerializer(WorkerSummary.serializer()), vector.getValue("workers")),
        wireJson.decodeFromJsonElement(ListSerializer(ThreadSummary.serializer()), vector.getValue("threads")), now)
    private fun JsonObject.text(key: String) = getValue(key).jsonPrimitive.content
    private fun JsonObject.strings(key: String) = getValue(key).jsonArray.map { it.jsonPrimitive.content }

    @Test fun sharedWebVectorsMatchEveryTaskDetailIncludingHiddenAncestorsAndCycles() {
        val model = model()
        for (expected in vector.getValue("details").jsonArray.map { it.jsonObject }) {
            val d = model.details.getValue(expected.text("id"))
            assertEquals(d.task.id, expected.text("familyId"), d.familyId)
            assertEquals(expected.text("progress"), d.progress)
            assertEquals(expected.strings("reasons"), d.reasons)
            assertEquals(expected.getValue("quiet").jsonPrimitive.boolean, d.quiet)
            assertEquals(expected.strings("children"), d.children)
            assertEquals(expected.strings("blocks"), d.blocks)
            assertEquals(expected.strings("workers"), d.workers.map { it.id })
            assertEquals(expected.strings("threads"), d.threads.map { it.id })
        }
    }
    @Test fun overlappingCountersMatchWebAndExcludeArchivedTasks() {
        val model = model()
        vector.getValue("counters").jsonArray.forEach {
            val expected = it.jsonObject
            assertEquals(expected.text("key"), expected.getValue("count").jsonPrimitive.int, model.counters.first { c -> c.key == expected.text("key") }.count)
        }
        assertTrue(model.details.getValue("T2").reasons.size > 1)
    }
    @Test fun searchWeightsAndNumericTieBreaksMatchWebForIdTitleFamilyWorkerAndThread() {
        val model = model()
        vector.getValue("search").jsonArray.forEach {
            val expected = it.jsonObject
            val actual = model.search(expected.text("query"))
            val results = expected.getValue("results").jsonArray.map { r -> r.jsonObject }
            assertEquals(expected.text("query"), results.map { r -> r.text("taskId") }, actual.map { r -> r.taskId })
            assertEquals(results.map { r -> r.getValue("score").jsonPrimitive.int }, actual.map { r -> r.score })
            assertEquals(results.map { r -> r.text("matched") }, actual.map { r -> r.matched })
        }
        assertTrue(model.search("  ").isEmpty())
    }
    @Test fun directAndIndirectDependencyCountsMatchWebEvenWithADiamond() {
        val model = model()
        vector.getValue("details").jsonArray.forEach {
            val d = it.jsonObject
            val expected = d.getValue("holdsUp").jsonObject
            assertEquals(GraphHoldsUp(expected.getValue("direct").jsonPrimitive.int, expected.getValue("total").jsonPrimitive.int), model.holdsUp(d.text("id")))
        }
    }
    @Test fun familyTreeOrdersParentsBeforeChildrenThroughHiddenAncestors() {
        val model = model()
        val families = model.families(false)
        val first = families.first { it.id == "T1" }
        assertFalse(first.cards.any { it.id == "T1" || it.id == "T5" || it.id == "T9" })
        assertTrue(first.cards.indexOfFirst { it.id == "T7" } < first.cards.indexOfFirst { it.id == "T8" })
        assertEquals(0, first.cards.first { it.id == "T7" }.depth) // dropped parent T5 is bridged to hidden root
        val cycle = families.first { it.id == "T13" }
        assertEquals(setOf("T13", "T14", "T15", "T16", "T17"), cycle.cards.map { it.id }.toSet())
        assertEquals(cycle.cards.size, cycle.cards.map { it.id }.distinct().size)
    }
    @Test fun closedTasksCanBeShownAndSelectionRetainsAJustCompletedCard() {
        val model = model()
        assertTrue(model.families(true).flatMap { it.cards }.any { it.id == "T9" })
        assertTrue(model.families(false, "T9").flatMap { it.cards }.any { it.id == "T9" })
        assertFalse(model.families(false).flatMap { it.cards }.any { it.id == "T9" })
    }
    @Test fun initialFamilyUsesSelectionOtherwiseMostNeedsYou() {
        val model = model()
        val families = model.families(false)
        assertEquals("T10", initialGraphFamily(families, model.details["T11"]))
        assertEquals(families.maxOf { it.needsYou }, families.first { it.id == initialGraphFamily(families, null) }.needsYou)
    }
    @Test fun backClosesSheetThenClearsSelectionAndHighlightThenLeaves() {
        val initial = GraphBackState(true, "T2", "reason:review")
        val closed = graphBack(initial)!!
        assertEquals(GraphBackState(false, "T2", "reason:review"), closed)
        assertEquals(GraphBackState(false, null, null), graphBack(closed))
        assertNull(graphBack(graphBack(closed)!!))
    }
    @Test fun quietBoundaryNeverLabelsClosedWorkAndInvalidDatesAreIgnored() {
        val base = task("T1").copy(updatedAt = "2026-06-10T12:00:00Z")
        fun quiet(task: BoardTask, at: Long = now) = buildGraphModel(listOf(task), emptyList(), emptyList(), emptyList(), at).details.getValue("T1").quiet
        assertTrue(quiet(base)); assertFalse(quiet(base, now - 1))
        assertFalse(quiet(base.copy(status = "done"))); assertFalse(quiet(base.copy(status = "dropped")))
        assertFalse(quiet(base.copy(updatedAt = "invalid")))
        assertEquals("quiet 2 d", graphQuietAge(base.updatedAt, now))
        assertEquals("", graphWaitingDate("invalid", now))
        assertEquals("overdue", graphWaitingDate("2026-06-10T12:00:00Z", now))
    }
    @Test fun statusAndReasonCounterMatchesAreIndependent() {
        val model = model()
        assertTrue(model.matches("T2", "reason:review"))
        assertTrue(model.matches("T2", "reason:question"))
        assertFalse(model.matches("T2", "status:todo"))
        assertTrue(model.matches("T2", null))
    }
    @Test fun graphChoiceRoundTripsPerBackendAndProjectWithLegacyFallback() {
        val saved = DeviceSettings(tasksView = "board", projectTasksView = mapOf("https://one.example.test" to mapOf("p" to "graph", "q" to "list")))
        val restored = wireJson.decodeFromString(DeviceSettings.serializer(), wireJson.encodeToString(DeviceSettings.serializer(), saved))
        assertEquals(TasksViewMode.Graph, tasksViewMode(restored.projectTasksView["https://one.example.test"]?.get("p")))
        assertEquals(TasksViewMode.List, tasksViewMode(restored.projectTasksView["https://one.example.test"]?.get("q")))
        assertEquals(TasksViewMode.Board, tasksViewMode(restored.projectTasksView["missing"]?.get("p") ?: restored.tasksView))
        assertEquals(TasksViewMode.List, tasksViewMode("future"))
        assertTrue(wireJson.decodeFromString(DeviceSettings.serializer(), "{}").projectTasksView.isEmpty())
    }
    @Test fun missingAncestorsAndLooseTasksStillHaveUsableGroups() {
        val model = buildGraphModel(listOf(task("T1").copy(parent = "hidden"), task("T2")), emptyList(), emptyList(), emptyList(), now)
        assertEquals(setOf("hidden", "T2"), model.families(false).map { it.id }.toSet())
    }
}
