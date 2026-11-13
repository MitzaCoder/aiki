package io.github.mitzacoder.kemiri.settings

import io.github.mitzacoder.kemiri.features.settings.*
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.*
import org.junit.Test

class McpCliTest {
    @Test fun registeredClientRequestDiagnosticsNeverContainCredentials() {
        val request = io.github.mitzacoder.kemiri.protocol.McpOAuthStartRequest(serverId = "synthetic", redirectUri = "https://app.example.test/mcp/oauth/callback", clientId = "synthetic-app-id", clientSecret = "synthetic-app-secret")
        assertEquals("McpOAuthStartRequest(redacted)", request.toString())
        assertFalse(request.toString().contains("synthetic-app-id"))
        assertFalse(request.toString().contains("synthetic-app-secret"))
    }

    @Test fun buttonUsesCoordinatorSubmissionAndFreshRequestId() {
        val request = mcpCliSetupRequest("synthetic-project", "gh")
        assertEquals("synthetic-project", request.projectId)
        assertNull(request.threadId)
        assertEquals("steer", request.whenBusy)
        assertTrue(request.content.jsonPrimitive.content.contains("GitHub CLI (gh)"))
        assertTrue(request.content.jsonPrimitive.content.contains("headless login steps"))
        assertNotEquals(request.requestId, mcpCliSetupRequest("synthetic-project", "gh").requestId)
        assertTrue(mcpCliSetupMessage("acli").contains("Atlassian CLI (acli) for Jira"))
    }
    @Test fun missingProjectAndUnknownCliCannotSubmit() {
        assertThrows(IllegalArgumentException::class.java) { mcpCliSetupRequest("", "gh") }
        assertThrows(IllegalArgumentException::class.java) { mcpCliSetupRequest("project", "shell") }
    }
}
