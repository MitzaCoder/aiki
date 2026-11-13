package io.github.mitzacoder.kemiri.chat

import io.github.mitzacoder.kemiri.features.chat.*
import org.junit.Assert.*
import org.junit.Test

class ComposerLayoutTest {
    @Test fun allControlsFitInitiallyAt320And411IncludingAttachmentAndComposerInsets() {
        for(phone in listOf(320f,411f)) {
            val available = phone - 48f - 48f // Outer + inner composer padding, attachment target.
            val layout = composerControlLayout(available)
            assertTrue("Coordinator must not exceed $available dp",layout.coordinatorWidth <= available)
            assertTrue("Worker current value and chevron must stay inside the viewport",layout.worker <= available)
            assertTrue(layout.model >= 48f); assertTrue(layout.effort >= 48f); assertTrue(layout.worker >= 48f)
        }
    }
    @Test fun largeFontsAndExtraAttachmentActionsStackInsteadOfCropping() {
        val available = 320f - 48f - 3 * 48f
        val layout = composerControlLayout(available,2f)
        assertTrue(layout.stackCoordinator)
        assertTrue(layout.coordinatorWidth <= available)
        assertTrue(layout.worker <= available)
    }
    @Test fun longLoadedModelValuesKeepFullAccessibleNameProviderAndEffort() {
        val name = "A very long provider model name that must never widen a chip beyond its assigned column"
        for(width in listOf(224f,315f,860f)) {
            val layout = composerControlLayout(width)
            assertTrue(layout.worker <= width)
            val label = composerControlDescription(name,"provider","model-version-123",true,"high")
            assertTrue(label.contains(name)); assertTrue(label.contains("provider/model-version-123")); assertTrue(label.contains("thinking: high"))
        }
        assertEquals("Worker model: default; using defaults; thinking: high",composerControlDescription("default",null,null,true,"high"))
    }
    @Test fun tabletIsOneCompactRowRatherThanFullWidthSelectors() {
        val layout = composerControlLayout(860f)
        assertFalse(layout.stackCoordinator)
        assertTrue(layout.coordinatorWidth + layout.worker + 8f <= 860f)
        assertTrue(layout.model <= 240f); assertTrue(layout.worker <= 280f)
    }
    @Test fun aPhonesModelChipShowsItsWholeNameOrItsIcon() {
        assertTrue(compactChipShowsLabel(140f,60f))
        assertTrue(compactChipShowsLabel(104f,60f))
        assertFalse(compactChipShowsLabel(103f,60f))
        assertFalse(compactChipShowsLabel(90f,96f))
    }
}
