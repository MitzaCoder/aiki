package io.github.mitzacoder.aiki.features.settings

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.github.mitzacoder.aiki.data.*
import io.github.mitzacoder.aiki.navigation.Destination
import io.github.mitzacoder.aiki.protocol.*
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonPrimitive
import java.util.UUID

internal fun mcpCliSetupMessage(cli: String): String {
    require(cli == "gh" || cli == "acli") { "Unsupported CLI" }
    val name = if (cli == "gh") "GitHub CLI (gh)" else "Atlassian CLI (acli) for Jira"
    return "Please set up the $name on this backend for this project: install it if missing, sign me in (use the headless login steps if there is no browser), and check that it works."
}
internal fun mcpCliSetupRequest(projectId: String, cli: String): ConversationSubmitRequest {
    require(projectId.isNotBlank()) { "Choose a project on this backend." }
    return ConversationSubmitRequest(projectId = projectId, requestId = "submit-${UUID.randomUUID()}", content = JsonPrimitive(mcpCliSetupMessage(cli)), whenBusy = "steer")
}

@Composable
internal fun McpCliHint(backend: BackendSession, cli: String, busy: Boolean, navigate: (Destination) -> Unit) {
    val projects by backend.projects.collectAsStateWithLifecycle()
    var projectId by remember(backend) { mutableStateOf("") }
    var choosing by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text("Agents often work better with the official CLI (acli for Jira, gh for GitHub) than with MCP.", style = MaterialTheme.typography.bodySmall)
        Box {
            OutlinedButton(onClick = { choosing = true }, enabled = !busy) { Text(projects.firstOrNull { it.id == projectId }?.name ?: "Choose a project for CLI setup") }
            DropdownMenu(choosing, { choosing = false }) {
                projects.filter { it.archived != true }.forEach { project -> DropdownMenuItem(text = { Text(project.name) }, onClick = { projectId = project.id; choosing = false }) }
            }
        }
        Text("Sends to the coordinator and opens chat. Nothing is installed by this button.", style = MaterialTheme.typography.bodySmall)
        OutlinedButton(onClick = { scope.launch { backend.mcp.perform {
            backend.client.request(mcpCliSetupRequest(projectId, cli))
            navigate(Destination.Chat(backend.config.key, projectId))
        } } }, enabled = !busy && projectId.isNotBlank(), modifier = Modifier.fillMaxWidth()) { Text("Ask the coordinator to set up $cli") }
        if (projects.isEmpty()) Text("Add a project on this backend first.")
    }
}
