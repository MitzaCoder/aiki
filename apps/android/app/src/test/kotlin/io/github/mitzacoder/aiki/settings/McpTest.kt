package io.github.mitzacoder.aiki.settings

import io.github.mitzacoder.aiki.features.settings.*
import io.github.mitzacoder.aiki.protocol.McpOAuthCompleteResponseServerToolsItem
import io.github.mitzacoder.aiki.protocol.McpOAuthFlow
import kotlinx.serialization.json.JsonPrimitive
import org.junit.Assert.*
import org.junit.Test

class McpTest {
    private val redirect = "https://app.example.test/mcp/oauth/callback"
    private fun tool(description: String = "Synthetic page search") = McpOAuthCompleteResponseServerToolsItem(
        name = "read_page", description = description, inputSchema = emptyMap(), policy = "ask")

    @Test fun generatedServerIdIsAValidToolNamespace() {
        val id = mcpServerIdFromUuid("12345678-90ab-cdef-1234-567890abcdef")
        assertEquals("server_1234567890ab", id)
        assertTrue(id.matches(Regex("^[a-z][a-z0-9_]{0,39}$")))
        assertFalse(id.contains("__"))
    }
    @Test fun statusWordsAreExplicit() {
        assertEquals(listOf("Connected", "Needs sign-in", "Signing in…", "Error", "Disconnected", "Unknown status"),
            listOf("connected", "needs_sign_in", "signing_in", "error", "disconnected", "future").map(::mcpStatusLabel))
    }
    @Test fun missingOrUnknownPolicyFailsClosed() {
        assertEquals("off", mcpPolicy(null)); assertEquals("off", mcpPolicy("future"))
        MCP_POLICIES.forEach { assertEquals(it, mcpPolicy(it)) }
    }
    @Test fun filterUsesNameAndDescriptionWithoutParsingMarkup() {
        assertTrue(mcpToolMatches(tool(), " READ_PAGE "))
        assertTrue(mcpToolMatches(tool(), "PAGE SEARCH"))
        assertTrue(mcpToolMatches(tool(), "  "))
        assertFalse(mcpToolMatches(tool(), "write"))
        assertTrue(mcpToolMatches(tool("[link](https://example.test)"), "[link]"))
    }
    @Test fun toolHintsDoNotOverridePolicies() {
        assertEquals("Destructive hint", mcpToolHint(tool()))
        assertEquals("Read-only hint", mcpToolHint(tool().copy(annotations = mapOf("readOnlyHint" to JsonPrimitive(true)))))
        assertEquals("Write hint", mcpToolHint(tool().copy(annotations = mapOf("destructiveHint" to JsonPrimitive(false)))))
        assertEquals("Destructive hint", mcpToolHint(tool().copy(annotations = mapOf("readOnlyHint" to JsonPrimitive(true), "destructiveHint" to JsonPrimitive(true)))))
    }
    @Test fun callbackChecksExactConfiguredOriginAndPath() {
        assertEquals("one two", mcpCallbackState("$redirect?code=synthetic&state=one%20two&iss=https%3A%2F%2Fissuer.example.test", redirect))
        assertEquals("abc", mcpCallbackState("https://APP.example.test:443/mcp/oauth/callback?state=abc&error=access_denied", redirect))
        listOf("http://app.example.test/mcp/oauth/callback?state=x", "$redirect/extra?state=x", "$redirect?state=", "$redirect?code=x",
            "$redirect?state=x&state=y", "$redirect?state=x#secret", "https://other.example.test/mcp/oauth/callback?state=x",
            "https://user@app.example.test/mcp/oauth/callback?state=x", "https://app.example.test:444/mcp/oauth/callback?state=x",
            "https://app.example.test/mcp/oauth/%63allback?state=x", "$redirect?state=%ZZ", "not a URL").forEach {
            assertNull(it, mcpCallbackState(it, redirect))
        }
    }
    @Test fun absentExpiredOrReplacedFlowsCannotStrandSignIn() {
        val flow = McpOAuthFlow(flowId = "flow-a", serverId = "synthetic", expiresAt = 123.0, status = "pending")
        assertTrue(mcpFlowStillPending("flow-a", flow))
        assertFalse(mcpFlowStillPending("flow-a", null))
        assertFalse(mcpFlowStillPending("flow-b", flow))
        listOf("succeeded", "failed", "expired", "cancelled").forEach { assertFalse(mcpFlowStillPending("flow-a", flow.copy(status = it))) }
    }
    @Test fun authorizationStateIsRequiredAndUnambiguous() {
        assertEquals("abc", mcpAuthorizationState("https://issuer.example.test/authorize?state=abc"))
        assertNull(mcpAuthorizationState("https://issuer.example.test/authorize?state=a&state=b"))
        assertNull(mcpAuthorizationState("invalid"))
    }
    @Test fun settingsAreCapabilityGatedAndParented() {
        assertFalse(projectSectionAvailable(ProjectSection.Mcp, ProjectSectionSupport({ false }, false, false)))
        assertTrue(projectSectionAvailable(ProjectSection.Mcp, ProjectSectionSupport({ it == MCP_FEATURE }, false, false)))
        assertEquals(GeneralPage(GeneralSection.Backends, "synthetic"), generalParent(GeneralPage(GeneralSection.Backends, "synthetic", mcp = true)))
    }
}
