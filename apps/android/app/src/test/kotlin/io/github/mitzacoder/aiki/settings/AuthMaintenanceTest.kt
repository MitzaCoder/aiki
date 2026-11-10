package io.github.mitzacoder.aiki.settings

import io.github.mitzacoder.aiki.features.settings.*
import io.github.mitzacoder.aiki.protocol.*
import io.github.mitzacoder.aiki.data.wireJson
import kotlinx.serialization.encodeToString
import org.junit.Assert.*
import org.junit.Test

class AuthMaintenanceTest {
    @Test fun maintenanceValidationAndShape() {
        val request = maintenanceRequest(null, null, "03:00", "20")
        val json = wireJson.encodeToString(request)
        assertTrue(json.contains("\"model\":null"))
        assertTrue(json.contains("\"thinkingLevel\":null"))
        assertTrue(json.contains("\"type\":\"memory.settings.set\""))
        for ((time, writes) in listOf("24:00" to "20", "3:00" to "20", "03:00" to "0", "03:00" to "1001")) {
            assertTrue(runCatching { maintenanceRequest(null, null, time, writes) }.isFailure)
        }
    }
    private fun login(status: String, at: Long, prompt: AuthPrompt? = null) = AuthLogin("l", "p", status, prompt, emptyList(), if(status == "failed") "Denied" else null, 1, at)
    @Test fun reducerIgnoresOldSnapshotsAndTerminalPrompts() {
        val prompt = AuthPrompt("q", "manual_code", "Paste redirect URL")
        val current = mergeLogin(emptyMap(), login("prompt", 2, prompt))
        assertEquals("q", current["l"]?.prompt?.id)
        assertEquals(current, mergeLogin(current, login("working", 1)))
        val cancelled = mergeLogin(current, login("cancelled", 3, prompt))
        assertNull(cancelled["l"]?.prompt)
        assertEquals("cancelled", mergeLogin(cancelled, login("prompt", 3, prompt))["l"]?.status)
        assertEquals("Denied", mergeLogin(current, login("failed", 4))["l"]?.error)
    }
    @Test fun configuredMaintenancePreservesModelAndThinking() {
        val model = ModelRef("provider", "model")
        val request = maintenanceRequest(model, "max", "23:59", "1000")
        assertEquals(model, request.maintenance.model)
        assertEquals("max", request.maintenance.thinkingLevel)
        assertEquals(1000L, request.maintenance.afterWrites)
        assertNull(maintenanceRequest(null, "max", "00:00", "1").maintenance.thinkingLevel)
        assertTrue(runCatching { maintenanceRequest(model, "unknown", "03:00", "20") }.isFailure)
        assertTrue(runCatching { maintenanceRequest(ModelRef("", ""), null, "03:00", "20") }.isFailure)
    }
    @Test fun newPromptsReplaceOldAndIndependentLoginsRemain() {
        val old = login("prompt", 1, AuthPrompt("one", "select", "Choose", options = listOf(AuthPromptOption("device", "Device"))))
        val next = login("prompt", 2, AuthPrompt("two", "secret", "Answer"))
        val state = mergeLogin(mergeLogin(emptyMap(), old), next)
        assertEquals("two", state["l"]?.prompt?.id)
        assertEquals(2, mergeLogin(state, next.copy(id = "other")).size)
        assertNull(mergeLogin(state, login("succeeded", 3))["l"]?.prompt)
    }
    @Test fun credentialsUseExistingContracts() {
        assertTrue(wireJson.encodeToString(CredentialsSetRequest(providerId = "p", apiKey = "test")).contains("\"apiKey\":\"test\""))
        assertTrue(wireJson.encodeToString(CredentialsLoginAnswerRequest(loginId = "l", promptId = "q", value = "redirect")).contains("\"promptId\":\"q\""))
        assertTrue(wireJson.encodeToString(CredentialsLoginCancelRequest(loginId = "l")).contains("credentials.loginCancel"))
    }
}
