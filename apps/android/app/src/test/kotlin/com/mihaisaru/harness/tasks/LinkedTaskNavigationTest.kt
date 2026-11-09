package com.mihaisaru.harness.tasks

import com.mihaisaru.harness.navigation.*
import org.junit.Assert.*
import org.junit.Test

class LinkedTaskNavigationTest {
    @Test fun linkedTasksKeepTheirPanelBehindThemWhenOpeningAndGoingBack() {
        val chat = Destination.Chat("backend", "p")
        val panel = Destination.Panel(chat, PanelTab.Board)
        val parent = Destination.Task(chat, "T1")
        val child = Destination.Task(chat, "T2")
        assertEquals(panel, panelBehindTask(listOf(chat, panel), parent))
        assertEquals(panel, panelBehindTask(listOf(chat, panel, parent), child))
        assertNull(panelBehindTask(listOf(panel, chat), child))
        assertNull(panelBehindTask(listOf(Destination.Panel(chat.copy(projectId = "other"))), child))
    }
}
