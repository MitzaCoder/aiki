package io.github.mitzacoder.kemiri.tasks

import io.github.mitzacoder.kemiri.data.wireJson
import io.github.mitzacoder.kemiri.features.tasks.graph.*
import kotlinx.serialization.json.*
import org.junit.Assert.*
import org.junit.Test
import java.io.File

class GraphCanvasTest {
    private val vector by lazy {
        val file = generateSequence(File(System.getProperty("user.dir")!!)) { it.parentFile }.map { File(it, "apps/android/test-vectors/task-graph-canvas-v1.json") }.first { it.isFile }
        wireJson.parseToJsonElement(file.readText()).jsonObject
    }
    private fun JsonObject.text(key: String) = getValue(key).jsonPrimitive.content
    private fun JsonObject.nullable(key: String) = get(key)?.jsonPrimitive?.contentOrNull
    private fun JsonObject.number(key: String) = getValue(key).jsonPrimitive.float
    private fun JsonObject.ids(key: String) = getValue(key).jsonArray.map { it.jsonPrimitive.content }
    private fun rect(v: JsonElement) = v.jsonObject.let { GraphRect(it.number("x"), it.number("y"), it.number("width"), it.number("height")) }
    private fun assertRect(expected: JsonElement, actual: GraphRect) {
        val b = rect(expected)
        assertEquals(b.x, actual.x, .01f); assertEquals(b.y, actual.y, .01f)
        assertEquals(b.width, actual.width, .01f); assertEquals(b.height, actual.height, .01f)
    }
    private fun input(v: JsonObject) = v.getValue("tasks").jsonArray.map { it.jsonObject.let { t -> GraphLayoutTask(t.text("id"), t.nullable("parent"), t.text("familyId"), t.getValue("order").jsonPrimitive.double, t.text("createdAt")) } }
    @Test fun stableLayoutAndReservationsMatchTheSharedWebVectors() {
        var previous: GraphLayout? = null
        vector.getValue("layouts").jsonArray.forEach { step ->
            val expected = step.jsonObject
            val layout = layoutGraphFamilies(input(expected), previous)
            assertEquals(expected.getValue("needsRegroup").jsonPrimitive.boolean, layout.needsRegroup)
            assertRect(expected.getValue("bounds"), layout.bounds)
            assertEquals(expected.ids("movedFamilyIds"), layout.movedFamilyIds)
            expected.getValue("cards").jsonArray.forEach { c ->
                val card = c.jsonObject; val actual = layout.cards.getValue(card.text("id"))
                assertEquals(card.text("familyId"), actual.familyId); assertEquals(card.nullable("parentId"), actual.parent)
                assertEquals(card.number("depth").toInt(), actual.depth)
                assertRect(card.getValue("box"), actual.box); assertRect(card.getValue("occupiedBox"), actual.occupied); assertRect(card.getValue("pillBox"), actual.pill)
            }
            expected.getValue("families").jsonArray.forEach { f ->
                val family = f.jsonObject; val actual = layout.families.first { it.id == family.text("id") }
                assertRect(family.getValue("bounds"), actual.bounds)
                assertEquals(family.ids("taskIds"), actual.taskIds)
                assertEquals(family.getValue("slots").jsonArray.map { it.jsonObject.nullable("taskId") }, actual.slots.map { it.taskId })
            }
            previous = layout
        }
    }
    @Test fun statusCrewAndReportReplacementsHaveNoGeometryInputs() {
        val tasks = input(vector.getValue("layouts").jsonArray.first().jsonObject)
        val before = layoutGraphFamilies(tasks)
        assertEquals(before, layoutGraphFamilies(tasks, before))
        assertEquals(before.options, layoutGraphFamilies(tasks, before, GraphLayoutOptions(cardWidth = 900f)).options)
    }
    @Test fun hiddenSlotsAreNotReusedAndOverflowMovesOnlyToAvoidOverlap() {
        val tasks = input(vector.getValue("layouts").jsonArray.first().jsonObject)
        val first = layoutGraphFamilies(tasks)
        val hidden = layoutGraphFamilies(tasks.filter { it.id != "T3" }, first)
        assertTrue(hidden.families.any { it.slots.any { s -> s.taskId == "T3" } })
        val arrivals = (20..28).map { GraphLayoutTask("T$it", "T4", "T1", it.toDouble()) }
        val grown = layoutGraphFamilies(tasks + arrivals, hidden)
        assertTrue(grown.needsRegroup)
        grown.families.forEach { a -> grown.families.filter { it.id != a.id }.forEach { b -> assertFalse(a.bounds.overlaps(b.bounds)) } }
        val compact = layoutGraphFamilies(tasks + arrivals)
        assertFalse(compact.needsRegroup)
    }
    @Test fun cyclesAndReparentingRetainIdentityUntilRegroup() {
        val tasks = listOf(GraphLayoutTask("T1", "T2", "T1"), GraphLayoutTask("T2", "T1", "T1"), GraphLayoutTask("T3", null, "T3"))
        val before = layoutGraphFamilies(tasks)
        assertEquals(3, before.cards.size)
        val after = layoutGraphFamilies(tasks.map { if (it.id == "T2") it.copy(parent = "T3", familyId = "T3") else it }, before)
        assertEquals("T1", after.cards.getValue("T2").familyId)
        assertEquals(before.cards.getValue("T2").box, after.cards.getValue("T2").box)
        assertTrue(after.needsRegroup)
    }
    @Test fun detailHysteresisNeverKeepsUnreadableLabelsOrSmallTouchTargets() {
        assertEquals(GraphDetail.Cards, graphDetail(1f))
        assertEquals(GraphDetail.Pills, graphDetail(.84f, GraphDetail.Cards))
        assertEquals(GraphDetail.Pills, graphDetail(.90f, GraphDetail.Pills))
        assertEquals(GraphDetail.Cards, graphDetail(.94f, GraphDetail.Pills))
        assertEquals(GraphDetail.Dots, graphDetail(.65f, GraphDetail.Pills))
        assertEquals(GraphDetail.Dots, graphDetail(.70f, GraphDetail.Dots))
        assertEquals(GraphDetail.Pills, graphDetail(.73f, GraphDetail.Dots))
    }
    @Test fun pointerAnchoredZoomPanAndWorldAnchoredDotsUseOneCamera() {
        val c = GraphCamera(100f, 50f, 1f); val anchor = GraphPoint(250f, 200f)
        val world = GraphPoint(150f, 150f)
        assertEquals(anchor, c.point(world))
        assertEquals(anchor, c.zoomAt(anchor, .7f).point(world))
        assertEquals(GraphPoint(260f, 180f), c.zoomAt(anchor, .7f, GraphPoint(10f, -20f)).point(world))
        assertEquals(GraphPoint(300f, 250f), c.point(GraphRect(100f, 100f, 200f, 200f).center))
    }
    private fun snapshot(v: JsonObject): GraphSnapshot {
        fun objects(name: String) = v.getValue(name).jsonObject.mapValues { it.value.jsonObject }
        return GraphSnapshot(objects("tasks").mapValues { (_, t) -> GraphTaskSnapshot(t.text("status"), t.text("title")) },
            objects("questions").mapValues { (_, q) -> GraphQuestionSnapshot(q.nullable("taskId"), q.text("kind"), q.text("status")) },
            objects("crew").mapValues { (_, c) -> GraphCrewSnapshot(c.nullable("taskId"), c.text("status"), c.text("report"), c.text("title")) })
    }
    private fun change(v: JsonObject) = GraphChange(v.text("key"), v.ids("taskIds"), v.text("text"), v.text("plural"), v.nullable("workerId"), v.text("kind"))
    @Test fun changeDiffAndFixedWindowBatchingMatchTheWebVectors() {
        var before: GraphSnapshot? = null; var entries = emptyList<GraphChangeEntry>(); var serial = 0L
        for (step in vector.getValue("changes").jsonArray.map { it.jsonObject }) {
            val next = snapshot(step.getValue("snapshot").jsonObject)
            val changes = diffGraphSnapshots(before, next)
            assertEquals(step.getValue("changes").jsonArray.map { change(it.jsonObject) }, changes)
            entries = batchGraphChanges(entries, changes, step.getValue("now").jsonPrimitive.long, serial)
            val expected = step.getValue("entries").jsonArray.map { e -> val v = e.jsonObject
                GraphChangeEntry(change(v), v.getValue("id").jsonPrimitive.long, v.getValue("at").jsonPrimitive.long, v.getValue("count").jsonPrimitive.int, v.getValue("serial").jsonPrimitive.long) }
            assertEquals(expected, entries)
            serial = entries.maxOfOrNull { it.serial } ?: 0
            before = next
        }
    }
    @Test fun reconnectAndFirstReadDoNotInventHistory() {
        val all = vector.getValue("changes").jsonArray.map { snapshot(it.jsonObject.getValue("snapshot").jsonObject) }
        val baseline = GraphChangeBaseline()
        assertTrue(baseline.read(all.first()).isEmpty())
        assertTrue(baseline.read(all.last(), reset = true).isEmpty())
        assertTrue(baseline.read(all.last()).isEmpty())
    }
    @Test fun reconnectBaselineWaitsForEveryAuthoritativeReadInTheNewGeneration() {
        assertFalse(graphReadsComplete(2, 1, 2, 2))
        assertFalse(graphReadsComplete(2, 2, 1, 2))
        assertFalse(graphReadsComplete(2, 2, 2, 1))
        assertTrue(graphReadsComplete(2, 2, 2, 2))
        assertTrue(graphReadsComplete(2, 2, null, null))
    }
    @Test fun historyIsBoundedAndAReportBurstKeepsItsLatestLine() {
        val report = GraphChange("worker:pip:report", listOf("T3"), "pip reported on T3 · first", "worker reports", "pip", "report")
        val entries = batchGraphChanges(emptyList(), listOf(report), 1000, 0)
        val second = batchGraphChanges(entries, listOf(report.copy(text = "pip reported on T3 · latest")), 1999, 1)
        assertEquals("pip reported on T3 · latest", second.single().text)
        assertEquals(2, second.single().count)
        assertEquals(2, batchGraphChanges(second, listOf(report), 2000, 2).size)
        val many = batchGraphChanges(emptyList(), (1..60).map { report.copy(key = "$it") }, 1000, 0)
        assertEquals(50, many.size)
    }
    @Test fun backClosesSheetThenSelectionThenCanvasThenLeavesFamilyView() {
        var state = GraphNavigation(true, "T3", "review", true)
        state = graphNavigateBack(state)!!; assertFalse(state.sheet); assertEquals("T3", state.selected)
        state = graphNavigateBack(state)!!; assertNull(state.selected); assertNull(state.highlight); assertTrue(state.canvas)
        state = graphNavigateBack(state)!!; assertFalse(state.canvas)
        assertNull(graphNavigateBack(state))
    }
    @Test fun dotFitFramesAnchorsAndKeepsTouchTargetsApart() {
        val tasks = input(vector.getValue("layouts").jsonArray.first().jsonObject)
        val layout = layoutGraphFamilies(tasks)
        val camera = graphFitDots(layout.families, 411f, 600f)
        assertEquals(GraphDetail.Dots, graphDetail(camera.zoom))
        val points = layout.families.map { camera.point(it.bounds.center) }
        points.forEach { assertTrue(it.x >= 24); assertTrue(it.x <= 387) }
        assertTrue(camera.zoom >= graphMinimumDotZoom(layout.families))
    }
    @Test fun oneColumnDotTargetsCannotOverlapVertically() {
        val regions = (0..9).map { GraphRegion("F$it", GraphRect(0f, it * 300f, 200f, 200f), emptyList()) }
        val camera = graphFitDots(regions, 411f, 600f)
        val centers = regions.map { camera.point(it.bounds.center) }
        centers.zipWithNext().forEach { (a, b) -> assertTrue(b.y - a.y >= 72f) }
    }
    @Test fun blockedArrowsKeepTheirDirectionAndRelationsAreScoped() {
        val input = listOf(GraphLayoutTask("T1", null, "T1"), GraphLayoutTask("T2", "T1", "T1"))
        val layout = layoutGraphFamilies(input)
        val edge = GraphRelationship("T2", "T1", "blocked-by")
        val route = routeGraphRelationships(layout, listOf(edge), GraphDetail.Cards).single()
        val end = layout.cards.getValue("T1").box
        assertEquals(GraphPoint(end.x, end.center.y), route.points.last())
    }
}
