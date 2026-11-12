package io.github.mitzacoder.aiki.features.settings

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import io.github.mitzacoder.aiki.protocol.McpOAuthCompleteResponseServer

/** Secrets are transient remember state, never rememberSaveable. */
@Composable
internal fun McpCommandForm(busy: Boolean, existing: McpOAuthCompleteResponseServer? = null, submit: (McpImportEntry) -> Unit) {
    var name by remember { mutableStateOf(existing?.name.orEmpty()) }
    var command by remember { mutableStateOf(existing?.command?.command.orEmpty()) }
    var args by remember { mutableStateOf(existing?.command?.args?.let { kotlinx.serialization.json.JsonArray(it.map { value -> kotlinx.serialization.json.JsonPrimitive(value) }).toString() } ?: "[]") }
    var cwd by remember { mutableStateOf(existing?.command?.cwd.orEmpty()) }
    var env by remember { mutableStateOf("{}") }
    var error by remember { mutableStateOf<String?>(null) }
    var pending by remember { mutableStateOf<McpImportEntry?>(null) }
    SettingsGroup(title = "Command (stdio)") { GroupRow {
        Text("Runs as the backend user, not on this device. New servers are disabled in projects.")
        OutlinedTextField(name, { name = it }, label = { Text("Server name") }, modifier = Modifier.fillMaxWidth())
        OutlinedTextField(command, { command = it }, label = { Text("Command") }, modifier = Modifier.fillMaxWidth())
        OutlinedTextField(args, { args = it }, label = { Text("Arguments (JSON array)") }, modifier = Modifier.fillMaxWidth())
        OutlinedTextField(cwd, { cwd = it }, label = { Text("Working directory (optional)") }, modifier = Modifier.fillMaxWidth())
        OutlinedTextField(env, { env = it }, label = { Text("Environment (secret JSON object)") }, visualTransformation = PasswordVisualTransformation(), modifier = Modifier.fillMaxWidth())
        if (existing != null) Text("An empty environment object keeps existing values. Remove and re-add to clear.")
        error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
        Button(onClick = {
            try {
                require(name.isNotBlank() && name.length <= 120) { "Name must be 1–120 characters" }
                val parsed = parseMcpCommand(command, args, cwd)
                pending = McpImportEntry(name, existing?.id ?: mcpServerIdFromUuid(java.util.UUID.randomUUID().toString()), "command", command, command = parsed, env = if (existing != null && env == "{}") null else parseMcpEnvironment(env), envNames = existing?.envNames)
                error = null
            } catch (failure: Exception) { error = failure.message ?: "Invalid command" }
        }, enabled = !busy) { Text("Review command") }
    } }
    pending?.let { entry -> McpCommandConfirm(listOf(entry), busy, { pending = null }) { pending = null; env = "{}"; submit(entry) } }
}

@Composable
internal fun McpCommandConfirm(entries: List<McpImportEntry>, busy: Boolean, dismiss: () -> Unit, confirm: () -> Unit) {
    AlertDialog(onDismissRequest = dismiss, title = { Text("Confirm backend command") }, text = {
        Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text("This executes code as the backend user. Only confirm commands you trust.")
            entries.filter { it.command != null }.forEach { entry ->
                Text(entry.name, style = MaterialTheme.typography.titleMedium)
                Text("Command: ${entry.command!!.command}\nArguments: ${kotlinx.serialization.json.JsonArray(entry.command.args.map { kotlinx.serialization.json.JsonPrimitive(it) })}\nWorking directory: ${entry.command.cwd ?: "(backend default)"}")
                Text("Environment: ${(entry.env?.keys ?: entry.envNames)?.joinToString { "$it=••••" }?.ifEmpty { "(none)" } ?: "(existing values retained)"}")
            }
        }
    }, confirmButton = { TextButton(onClick = confirm, enabled = !busy) { Text("Confirm and save") } }, dismissButton = { TextButton(onClick = dismiss) { Text("Back") } })
}

@Composable
internal fun McpImportForm(taken: List<String>, busy: Boolean, submit: (List<McpImportEntry>) -> Unit) {
    var text by remember { mutableStateOf("") }
    var entries by remember { mutableStateOf<List<McpImportEntry>>(emptyList()) }
    var selected by remember { mutableStateOf<Set<String>>(emptySet()) }
    var error by remember { mutableStateOf<String?>(null) }
    var confirming by remember { mutableStateOf(false) }
    SettingsGroup(title = "Import MCP servers") { GroupRow {
        Text("Review before saving. Nothing runs or saves yet. Name clashes are renamed; uncheck to skip.")
        if (entries.isEmpty()) {
            OutlinedTextField(text, { text = it }, label = { Text("Server JSON") }, minLines = 4, modifier = Modifier.fillMaxWidth())
            Button(onClick = {
                try { entries = parseMcpImport(text, taken); selected = entries.filter { it.error == null }.map { it.serverId }.toSet(); text = ""; error = null }
                catch (failure: Exception) { error = failure.message ?: "Invalid JSON" }
            }, enabled = !busy && text.isNotBlank()) { Text("Review import") }
        } else {
            entries.forEach { entry -> Row(Modifier.fillMaxWidth()) {
                Checkbox(checked = entry.serverId in selected, onCheckedChange = { checked -> selected = if (checked) selected + entry.serverId else selected - entry.serverId }, enabled = entry.error == null && !busy)
                Column(Modifier.weight(1f)) {
                    Text("${entry.name} · ${entry.kind}", style = MaterialTheme.typography.titleMedium)
                    Text(entry.target)
                    if (entry.renamed) Text("Renamed ID: ${entry.serverId}")
                    entry.error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
                }
            } }
            Button(onClick = { val chosen = entries.filter { it.serverId in selected }; if (chosen.any { it.command != null }) confirming = true else { entries = emptyList(); submit(chosen) } }, enabled = !busy && selected.isNotEmpty()) { Text("Import selected") }
        }
        error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
    } }
    if (confirming) McpCommandConfirm(entries.filter { it.serverId in selected }, busy, { confirming = false }) {
        val chosen = entries.filter { it.serverId in selected }; confirming = false; entries = emptyList(); submit(chosen)
    }
}
