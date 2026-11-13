package io.github.mitzacoder.kemiri

import io.github.mitzacoder.kemiri.features.settings.*
import io.github.mitzacoder.kemiri.data.wireJson
import io.github.mitzacoder.kemiri.navigation.*
import org.junit.Assert.*
import org.junit.Test

class NavigationTest {
    @Test fun oldPersistedRouteDiscriminatorsRemainByteCompatible() {
        val saved = """{"type":"io.github.mitzacoder.aiki.navigation.Destination.Chat","backendKey":"https://backend.example","projectId":"p"}"""
        val route = Destination.Chat("https://backend.example", "p")
        assertEquals(route, wireJson.decodeFromString(Destination.serializer(), saved))
        assertEquals(saved, wireJson.encodeToString(Destination.serializer(), route))
        assertEquals("io.github.mitzacoder.aiki.navigation.ChatHighlight.Entry", ChatHighlight.Entry.serializer().descriptor.serialName)
    }

    @Test fun backgroundWorkerKeysSurviveNavigationPersistence() {
        val route = Destination.Chat("https://backend.example", "same-project", threadId = "background", workerId = "same-worker")
        for (target in listOf<Destination>(route, Destination.Panel(route, PanelTab.Memory), Destination.Artifact(route, "artifact"), Destination.ProjectSettings(route), Destination.ProjectSettings(route, ProjectSection.Schedules, "s1"), Destination.Settings(), Destination.Settings(GeneralPage(GeneralSection.Backends, "https://b.example", accounts = true)), Destination.Home)) {
            assertEquals(target, wireJson.decodeFromString(Destination.serializer(), wireJson.encodeToString(Destination.serializer(), target)))
        }
        val contextTarget = io.github.mitzacoder.kemiri.data.ConversationTarget(route.projectId, route.threadId, route.workerId)
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
        assertEquals("v1.YQ", connectPayloadFromUri("https://${io.github.mitzacoder.kemiri.features.notifications.APP_LINK_HOST}/connect#v1.YQ"))
        for (scheme in listOf("harness", "aiki", "kemiri")) {
            assertEquals("v1.YQ", connectPayloadFromUri("$scheme://connect#v1.YQ"))
            assertEquals("%76%31.YQ", connectPayloadFromUri("$scheme://connect/#%76%31.YQ"))
            for (bad in listOf("$scheme://other#v1.YQ", "$scheme://connect/other#v1.YQ", "$scheme://connect?secret=1#v1.YQ", "$scheme://user@connect#v1.YQ")) {
                assertNull(bad, connectPayloadFromUri(bad))
            }
        }
        assertEquals("", connectPayloadFromUri("https://${io.github.mitzacoder.kemiri.features.notifications.APP_LINK_HOST}/connect"))
        assertEquals("%76%31.YQ", connectPayloadFromUri("https://${io.github.mitzacoder.kemiri.features.notifications.APP_LINK_HOST}/connect#%76%31.YQ"))
        for (bad in listOf("http://app.example/connect#v1.YQ", "https://user:password@app.example/connect#v1.YQ", "https://app.example/other#v1.YQ", "https://${io.github.mitzacoder.kemiri.features.notifications.APP_LINK_HOST}/connect?secret=1#v1.YQ", "https://other.example/connect#v1.YQ", "harness://other#v1.YQ", "not a uri")) {
            assertNull(bad, connectPayloadFromUri(bad))
        }
    }
}
