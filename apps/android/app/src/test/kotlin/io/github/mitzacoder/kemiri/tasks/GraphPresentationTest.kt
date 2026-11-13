package io.github.mitzacoder.kemiri.tasks

import io.github.mitzacoder.kemiri.features.tasks.graph.*
import org.junit.Assert.*
import org.junit.Test

class GraphPresentationTest {
    private val measure: (String) -> Float = { it.length * 7f }

    @Test fun labelsWrapOnlyBetweenWordsAndEllipsizeTheFinalLine() {
        assertEquals("Access &\nidentity", graphDotLabel("Access & identity", 70f, measure))
        assertEquals("Search &\ndiscovery…", graphDotLabel("Search & discovery and release", 77f, measure))
        assertEquals("Mobile polish", graphDotLabel("Mobile polish", 132f, measure))
    }
    @Test fun aLongUnbrokenNameEndsInEllipsisInsteadOfContinuingOnAnotherLine() {
        val label = graphDotLabel("NotificationsAndRecovery", 70f, measure)
        assertFalse(label.contains('\n'))
        assertTrue(label.endsWith("…"))
        assertTrue(measure(label) <= 70f)
    }
    @Test fun needsYouBadgesCountUniqueTasksNotOverlappingReasons() {
        val now = graphTimestamp("2026-06-12T12:00:00Z")!!
        val model = buildGraphModel(listOf(task("T1", "review"), task("T2", "blocked")), listOf(question("Q1", "T1")), emptyList(), emptyList(), now)
        assertEquals(GraphDotCounts(2, 2, mapOf("review" to 1, "blocked" to 1)), graphDotCounts(model, listOf("T1", "T1", "T2")))
    }
    @Test fun canvasCardsKeepACompactFixedBudgetAndOneMetaRow() {
        val options = GraphLayoutOptions()
        assertEquals(104f, options.cardHeight, 0f)
        assertEquals(12f, options.gap, 0f)
        assertTrue(18 + 40 + 16 + 6 + 16 <= options.cardHeight)
        val now = graphTimestamp("2026-06-12T12:00:00Z")!!
        val root = task("T1", "in_progress").copy(updatedAt = "2026-06-12T12:00:00Z")
        val model = buildGraphModel(listOf(root, task("T2", "done").copy(parent = "T1")), emptyList(), emptyList(), emptyList(), now)
        assertEquals("1/1 done · holds up 2", graphCanvasMeta(model.details.getValue("T1"), 2, now))
    }
    @Test fun dotLabelsHaveRealScreenSpaceInsteadOfTinyWorldScaledText() {
        val families = listOf(
            GraphRegion("T1", GraphRect(0f, 0f, 400f, 600f), emptyList()),
            GraphRegion("T2", GraphRect(450f, 0f, 400f, 600f), emptyList()),
        )
        val camera = graphFitDots(families, 411f, 700f)
        val distance = camera.point(families[1].bounds.center).x - camera.point(families[0].bounds.center).x
        assertTrue(distance >= GRAPH_DOT_LABEL_MIN_WIDTH + GRAPH_DOT_LABEL_GAP)
    }
}
