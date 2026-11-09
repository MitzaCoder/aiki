package com.mihaisaru.harness.settings

import com.mihaisaru.harness.features.settings.*
import com.mihaisaru.harness.data.*
import com.mihaisaru.harness.protocol.*
import kotlinx.serialization.json.*
import org.junit.Assert.*
import org.junit.Test

class SettingsSemanticsTest {
    @Test fun optionalManifestDropsBadRowsAndDuplicates() {
        assertEquals(emptyList<BackendConfig>(), parsePublishedBackends("not json"))
        val rows = parsePublishedBackends("""[null,{"name":"Desk","url":"https://desk.example.com/"},{"name":"Other","url":"https://desk.example.com:443"},{"name":"Desk","url":"https://other.example.com"},{"name":"Bad","url":"http://remote.example.com"},{"name":"Two","url":"https://two.example.com"}]""")
        assertEquals(listOf("Desk", "Two"), rows.map { it.name })
    }
    @Test fun addressesUsePublishedNamesAndDomainsNotFixedPrivateHosts() {
        val entries = listOf(BackendConfig("My desk", "https://desk.lab.example.org"))
        assertEquals("https://desk.lab.example.org", resolveBackend("MY DESK", "", entries, "https://app.example.net").url)
        assertEquals(BackendConfig("new", "https://new.lab.example.org"), resolveBackend("new", "", entries, "https://app.example.net"))
        assertEquals("http://localhost:7317", resolveBackend("localhost:7317", "", emptyList()).url)
        for (bad in listOf("https://user:secret@example.com", "https://example.com/path", "http://remote.example.com")) {
            assertTrue(runCatching { resolveBackend(bad, "", emptyList()) }.isFailure)
        }
    }
    @Test fun weeklySundayIsZeroAndIntervalBoundsAreEnforced() {
        val sunday = wireJson.encodeToJsonElement(ScheduleSpecSerializer, scheduleSpec("weekly", "", "09:15", setOf(0), "")).jsonObject
        assertEquals(JsonArray(listOf(JsonPrimitive(0))), sunday["days"])
        assertEquals(JsonPrimitive("weekly"), sunday["kind"])
        for (minutes in listOf("4", "10081", "NaN")) assertTrue(runCatching { scheduleSpec("interval", minutes, "", emptySet(), "") }.isFailure)
        assertTrue(runCatching { scheduleSpec("weekly", "", "09:15", emptySet(), "") }.isFailure)
        assertTrue(runCatching { scheduleSpec("daily", "", "24:00", emptySet(), "") }.isFailure)
        assertTrue(runCatching { scheduleSpec("cron", "", "", emptySet(), "* * *") }.isFailure)
    }
    @Test fun runTimesUseBackendZoneAcrossDstNotDeviceZone() {
        val original = java.util.TimeZone.getDefault()
        try {
            java.util.TimeZone.setDefault(java.util.TimeZone.getTimeZone("Asia/Tokyo"))
            assertTrue(backendTime("2026-03-08T06:30:00Z", "America/New_York").contains("01:30"))
            assertTrue(backendTime("2026-03-08T07:30:00Z", "America/New_York").contains("03:30"))
            assertEquals("—", backendTime(null, "Europe/Bucharest"))
        } finally { java.util.TimeZone.setDefault(original) }
    }
    @Test fun pausingPreservesAllOtherScheduleFields() {
        val row = Schedule("Title", "Brief", scheduleSpec("interval", "5", "", emptySet(), ""), ModelRef("p", "m"), "high", "workspace", "record", true, "thread", "s", "coordinator", "a", "b", null, null, null, emptyList())
        val paused = row.toInput().copy(enabled = false)
        assertEquals(row.toInput(), paused.copy(enabled = true))
        assertEquals("thread", paused.kind)
    }
    @Test fun clearingCoordinatorDoesNotResetWorkerModelsOrCheckIns() {
        val patch = coordinatorPatch("project", null, null)
        val encoded = wireJson.encodeToJsonElement(ProjectsConfigureRequest.serializer(), patch.request).jsonObject
        val wire = withExplicitNulls(encoded, patch.explicitNulls)
        assertEquals(JsonNull, wire["coordinatorModel"])
        assertEquals(JsonNull, wire["coordinatorThinkingLevel"])
        assertFalse(wire.containsKey("workerModels"))
        assertFalse(wire.containsKey("checkIns"))
        val selected = coordinatorPatch("project", ModelRef("p", "m"), "low")
        assertTrue(selected.explicitNulls.isEmpty())
    }
    @Test fun malformedConnectRejectsWholePayloadUnlikePublishedList() {
        val text = "Desk\thttps://desk.example.org\nBroken\thttp://remote.example.org"
        val fragment = "v1." + java.util.Base64.getUrlEncoder().withoutPadding().encodeToString(text.toByteArray())
        assertTrue(decodeConnect(fragment).isFailure)
    }
    @Test fun optionalListCapsAt32AndHandlesWrongFieldTypes() {
        assertTrue(parsePublishedBackends("{\"backends\":[]}").isEmpty())
        assertTrue(parsePublishedBackends("[{\"name\":12,\"url\":\"https://example.org\"}]").isEmpty())
        val rows = (1..40).joinToString(",", "[", "]") { "{\"name\":\"Host$it\",\"url\":\"https://host$it.example.org\"}" }
        assertEquals(32, parsePublishedBackends(rows).size)
    }
    @Test fun changingModelsDropsUnsupportedThinking() {
        val model = ModelInfo(provider = "p", modelId = "m", name = "Model", contextWindow = 100, maxTokens = 10, input = listOf("text"), reasoning = true, thinkingLevels = listOf("low", "high"), configured = true)
        assertNull(validThinking("max", model))
        assertEquals("high", validThinking("high", model))
        assertNull(validThinking("high", null))
    }
}
