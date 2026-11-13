package io.github.mitzacoder.kemiri.features.settings

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.github.mitzacoder.kemiri.data.*
import io.github.mitzacoder.kemiri.protocol.*
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch

@Composable
internal fun McpProjectSection(backend: BackendSession, projectId: String) {
    val connection by backend.client.state.collectAsStateWithLifecycle()
    if (!connection.supports(MCP_FEATURE)) return
    val servers by backend.mcp.servers.collectAsStateWithLifecycle()
    var choices by remember(backend, projectId) { mutableStateOf<List<McpProjectGetResponseServersItem>>(emptyList()) }
    var loaded by remember(backend, projectId) { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    LaunchedEffect(backend, projectId, connection.status) {
        loaded = false
        if (connection.status == ConnectionStatus.Ready) try {
            backend.mcp.perform { backend.mcp.reload() }
            choices = backend.client.request(McpProjectGetRequest(projectId = projectId)).servers
            loaded = true; error = null
        } catch (e: CancellationException) { throw e }
        catch (e: Exception) { error = e.message }
    }
    fun save(next: List<McpProjectGetResponseServersItem>) { scope.launch {
        busy = true; error = null
        try { choices = backend.client.request(McpProjectSetRequest(projectId = projectId, servers = next)).servers }
        catch (e: CancellationException) { throw e }
        catch (e: Exception) { error = e.message }
        finally { busy = false }
    } }
    SettingsSectionPage("MCP", "Choose remote tools for this project. Servers and roles start off; tool policies still apply.", SettingsIcon.Server) {
        error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
        if (!loaded || busy) LinearProgressIndicator(Modifier.fillMaxWidth())
        if (loaded && servers.isEmpty()) SettingsGroup { GroupNote("No servers on this backend. Add one in Settings → Backends → MCP servers.") }
        servers.forEach { server ->
            val choice = choices.firstOrNull { it.serverId == server.id } ?: McpProjectGetResponseServersItem(serverId = server.id, enabled = false, roles = emptyList())
            fun replace(next: McpProjectGetResponseServersItem) = save(choices.filterNot { it.serverId == next.serverId } + next)
            SettingsGroup(title = server.name) {
                SettingsRow("Enabled", hint = "${mcpStatusLabel(server.status)} · ${server.tools.size} tools", control = RowControl.Inline) {
                    SettingsSwitch(choice.enabled, { replace(choice.copy(enabled = it)) }, "Enable ${server.name}", enabled = loaded && !busy)
                }
                GroupRow {
                    MCP_ROLES.forEach { role ->
                        val label = when (role) { "coordinator" -> "Coordinator"; "workers" -> "Workers"; else -> "Background threads" }
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = androidx.compose.ui.Alignment.CenterVertically) {
                            Checkbox(checked = role in choice.roles, enabled = loaded && !busy && choice.enabled,
                                modifier = Modifier.semantics { contentDescription = "$label for ${server.name}" },
                                onCheckedChange = { checked -> replace(choice.copy(roles = if (checked) choice.roles + role else choice.roles - role)) })
                            Text(label)
                        }
                    }
                }
            }
        }
    }
}
