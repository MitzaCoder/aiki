package io.github.mitzacoder.aiki

import io.github.mitzacoder.aiki.features.settings.*
import io.github.mitzacoder.aiki.data.wireJson
import io.github.mitzacoder.aiki.navigation.*
import org.junit.Assert.*
import org.junit.Test

class NavigationTest {
    @Test fun backgroundWorkerKeysSurviveNavigationPersistence() {
        val route = Destination.Chat("https://backend.example", "same-project", threadId = "background", workerId = "same-worker")
        for (target in listOf<Destination>(route, Destination.Panel(route, PanelTab.Memory), Destination.Artifact(route, "artifact"), Destination.ProjectSettings(route), Destination.ProjectSettings(route, ProjectSection.Schedules, "s1"), Destination.Settings(), Destination.Settings(GeneralPage(GeneralSection.Backends, "https://b.example", accounts = true)), Destination.Home)) {
            assertEquals(target, wireJson.decodeFromString(Destination.serializer(), wireJson.encodeToString(Destination.serializer(), target)))
        }
        val contextTarget = io.github.mitzacoder.aiki.data.ConversationTarget(route.projectId, route.threadId, route.workerId)
        assertNotEquals(contextTarget, contextTarget.copy(threadId = "main"))
        assertNotEquals(route, route.copy(backendKey = "https://another.example"))
    }
    @Test fun aSavedRouteToTheRemovedWorkersTabReadsBackAsInfo() {
        val route = Destination.Chat("https://backend.example", "p")
        val saved = wireJson.encodeToString(Destination.serializer(), Destination.Panel(route, PanelTab.Memory)).replace("\"Memory\"", "\"Workers\"")
        assertEquals(Destination.Panel(route, PanelTab.Info), wireJson.decodeFromString(Destination.serializer(), saved))
    }
    @Test fun panelsShareOnlyTheirOwnChatSaveableState() {
        val route = Destination.Chat("https://backend.example", "p", "background", "worker")
        assertEquals(route.screenStateKey(), Destination.Panel(route).screenStateKey())
        assertNotEquals(route.screenStateKey(), route.copy(threadId = "main").screenStateKey())
        assertNotEquals(route.screenStateKey(), route.copy(backendKey = "https://other.example").screenStateKey())
        assertNotEquals(route.screenStateKey(), Destination.ProjectSettings(route).screenStateKey())
    }
    @Test fun aTaskSheetAndAHighlightKeepTheirChatsStateAndRoute() {
        val route = Destination.Chat("https://backend.example", "p", "background")
        val highlighted = route.copy(highlight = ChatHighlight.Entry(42))
        val task = Destination.Task(route, "T12")
        for (target in listOf<Destination>(highlighted, task, route.copy(highlight = ChatHighlight.Thread("t1")))) {
            assertEquals(target, wireJson.decodeFromString(Destination.serializer(), wireJson.encodeToString(Destination.serializer(), target)))
            assertEquals(route.screenStateKey(), target.screenStateKey())
            assertEquals(route, target.chatRoute())
        }
        assertNull(Destination.Usage.chatRoute())
    }
    @Test fun onlyConnectRoutesYieldRawPreviewPayload() {
        assertEquals("v1.YQ", connectPayloadFromUri("https://${io.github.mitzacoder.aiki.features.notifications.APP_LINK_HOST}/connect#v1.YQ"))
        assertEquals("v1.YQ", connectPayloadFromUri("harness://connect#v1.YQ"))
        assertEquals("", connectPayloadFromUri("https://${io.github.mitzacoder.aiki.features.notifications.APP_LINK_HOST}/connect"))
        assertEquals("%76%31.YQ", connectPayloadFromUri("https://${io.github.mitzacoder.aiki.features.notifications.APP_LINK_HOST}/connect#%76%31.YQ"))
        for (bad in listOf("http://app.example/connect#v1.YQ", "https://user:password@app.example/connect#v1.YQ", "https://app.example/other#v1.YQ", "https://${io.github.mitzacoder.aiki.features.notifications.APP_LINK_HOST}/connect?secret=1#v1.YQ", "https://other.example/connect#v1.YQ", "harness://other#v1.YQ", "not a uri")) {
            assertNull(bad, connectPayloadFromUri(bad))
        }
    }
}
