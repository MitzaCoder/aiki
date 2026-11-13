package io.github.mitzacoder.kemiri

import io.github.mitzacoder.kemiri.navigation.*
import io.github.mitzacoder.kemiri.features.chat.showPinnedBoardQuestions
import org.junit.Assert.*
import org.junit.Test

class NavigationPresentationTest {
    @Test fun backgroundNavigationTitleKeepsStableThreadFeatureIdentity() {
        assertEquals("Background", PanelTab.Threads.label)
        assertEquals("threads", PanelTab.Threads.feature)
        assertEquals("Board", PanelTab.Board.label)
        assertEquals("Artifacts", PanelTab.Artifacts.label)
    }
    @Test fun resolvedSelectionNotStaleInitialTabControlsBoardPin() {
        val tabs = listOf(PanelTab.Info, PanelTab.Board, PanelTab.Artifacts)
        assertEquals(PanelTab.Board, resolvedPanelTab(PanelTab.Board, tabs))
        assertFalse(showPinnedBoardQuestions(resolvedPanelTab(PanelTab.Board, tabs)))
        assertTrue(showPinnedBoardQuestions(resolvedPanelTab(PanelTab.Info, tabs)))
        assertTrue(showPinnedBoardQuestions(resolvedPanelTab(PanelTab.Board, listOf(PanelTab.Threads))))
        assertNull(resolvedPanelTab(PanelTab.Board, emptyList()))
        assertTrue(showPinnedBoardQuestions(null)) // phone overlay / no side panel
    }
    @Test fun tabReplacementPreservesBackendThreadAndWorkerIdentity() {
        val route = Destination.Chat("https://test.invalid", "p", "background", "worker")
        val switched = Destination.Panel(route, PanelTab.Board).copy(tab = PanelTab.Artifacts)
        assertEquals(route, switched.chat)
        assertEquals(route.screenStateKey(), switched.screenStateKey())
    }
}
