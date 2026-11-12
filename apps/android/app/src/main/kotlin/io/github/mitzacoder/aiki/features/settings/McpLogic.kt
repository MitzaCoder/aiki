package io.github.mitzacoder.aiki.features.settings

import io.github.mitzacoder.aiki.protocol.McpOAuthCompleteResponseServerToolsItem
import io.github.mitzacoder.aiki.protocol.McpOAuthFlow
import java.net.URI
import java.net.URLDecoder
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.jsonPrimitive

/** Copy starts no browser and never replaces a still-pending authorization. */
suspend fun copyMcpSignInLink(existing: String?, start: suspend () -> String?, copy: (String) -> Unit): Boolean {
    val url = existing ?: start()
    if (url.isNullOrBlank()) return false // A saved grant may refresh without consent.
    copy(url)
    return true
}

const val MCP_FEATURE = "mcp-servers"
const val MCP_CALLBACK_PATH = "/mcp/oauth/callback"
val MCP_ROLES = listOf("coordinator", "workers", "background")
val MCP_POLICIES = listOf("off", "ask", "allow")
fun mcpServerIdFromUuid(uuid: String): String = "server_" + uuid.replace("-", "").take(12)

fun mcpStatusLabel(status: String): String = when (status) {
    "connected" -> "Connected"
    "needs_sign_in" -> "Needs sign-in"
    "signing_in" -> "Signing in…"
    "error" -> "Error"
    "disconnected" -> "Disconnected"
    else -> "Unknown status"
}

fun mcpFlowStillPending(flowId: String, flow: McpOAuthFlow?): Boolean = flow?.flowId == flowId && flow.status == "pending"
fun mcpPolicy(policy: String?): String = policy?.takeIf { it in MCP_POLICIES } ?: "off"
fun mcpToolMatches(tool: McpOAuthCompleteResponseServerToolsItem, filter: String): Boolean =
    filter.trim().let { it.isEmpty() || tool.name.contains(it, ignoreCase = true) || tool.description.orEmpty().contains(it, ignoreCase = true) }

fun mcpToolHint(tool: McpOAuthCompleteResponseServerToolsItem): String {
    fun hint(name: String) = runCatching { tool.annotations?.get(name)?.jsonPrimitive?.booleanOrNull }.getOrNull()
    return when {
        hint("destructiveHint") == true -> "Destructive hint"
        hint("readOnlyHint") == true -> "Read-only hint"
        hint("destructiveHint") != false -> "Destructive hint"
        else -> "Write hint"
    }
}

/** Parse only the configured callback. A URL never supplies a backend or socket. */
fun mcpCallbackState(url: String, redirectUri: String): String? = runCatching {
    val uri = URI(url.trim())
    val expected = URI(redirectUri)
    require(uri.scheme == "https" && uri.host.equals(expected.host, ignoreCase = true))
    fun port(value: URI) = if (value.port == -1) 443 else value.port
    require(port(uri) == port(expected) && uri.rawUserInfo == null && uri.rawFragment == null)
    require(uri.rawPath == MCP_CALLBACK_PATH && expected.rawPath == MCP_CALLBACK_PATH)
    val query = uri.rawQuery.orEmpty().split('&').map {
        val pair = it.split('=', limit = 2)
        URLDecoder.decode(pair[0], "UTF-8") to URLDecoder.decode(pair.getOrElse(1) { "" }, "UTF-8")
    }
    val states = query.filter { it.first == "state" }
    require(states.size == 1)
    states.single().second.takeIf { it.isNotBlank() }
}.getOrNull()

fun mcpAuthorizationState(url: String): String? = runCatching {
    URI(url).rawQuery.orEmpty().split('&').map { it.split('=', limit = 2) }
        .single { URLDecoder.decode(it[0], "UTF-8") == "state" }
        .let { URLDecoder.decode(it[1], "UTF-8") }.takeIf { it.isNotBlank() }
}.getOrNull()
