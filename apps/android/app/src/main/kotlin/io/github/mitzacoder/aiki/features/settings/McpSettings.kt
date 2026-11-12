package io.github.mitzacoder.aiki.features.settings

import android.net.Uri
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import androidx.browser.customtabs.CustomTabsIntent
import androidx.compose.foundation.clickable
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.github.mitzacoder.aiki.data.*
import io.github.mitzacoder.aiki.protocol.*
import io.github.mitzacoder.aiki.navigation.Destination
import androidx.compose.ui.platform.LocalUriHandler
import kotlinx.coroutines.launch
import java.util.UUID

@Composable
internal fun McpServersPage(backend: BackendSession, navigate: (Destination) -> Unit) {
    val connection by backend.client.state.collectAsStateWithLifecycle()
    if (!connection.supports(MCP_FEATURE)) { GroupNote("This backend does not support MCP servers."); return }
    val session = backend.mcp
    val servers by session.servers.collectAsStateWithLifecycle()
    val presets by session.presets.collectAsStateWithLifecycle()
    val error by session.error.collectAsStateWithLifecycle()
    val busy by session.busy.collectAsStateWithLifecycle()
    val scope = rememberCoroutineScope()
    var selectedId by remember(backend) { mutableStateOf<String?>(null) }
    var adding by remember(backend) { mutableStateOf(false) }
    var importing by remember(backend) { mutableStateOf(false) }
    var commandForm by remember(backend) { mutableStateOf(false) }
    var commandPreset by remember(backend) { mutableStateOf<McpListResponsePresetsItem?>(null) }
    fun saveEntries(entries: List<McpImportEntry>) { scope.launch { session.perform {
        entries.forEach { entry ->
            val added = backend.client.request(McpAddRequest(serverId = entry.serverId, name = entry.name, url = entry.url, transport = entry.transport, command = entry.command, env = entry.env, presetId = commandPreset?.id, confirmed = entry.command?.let { true }))
            entry.token?.let { backend.client.request(McpTokenSetRequest(serverId = added.server.id, token = it)) }
            selectedId = added.server.id
        }
        session.reload(); adding = false; importing = false; commandForm = false; commandPreset = null
    } } }
    LaunchedEffect(backend, connection.status) { if (connection.status == ConnectionStatus.Ready) session.perform { session.reload() } }
    val selected = servers.firstOrNull { it.id == selectedId }
    SettingsSectionPage("MCP servers", "Remote tools on this backend. Enable them separately in each project's MCP settings.", SettingsIcon.Server) {
        if (busy) LinearProgressIndicator(Modifier.fillMaxWidth())
        error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
        if (selected != null) {
            TextButton(onClick = { selectedId = null }) { Text("All MCP servers") }
            McpServerDetails(backend, selected, busy, presets.firstOrNull { it.id == selected.presetId }, navigate) { selectedId = null }
        } else if (importing) {
            TextButton(onClick = { importing = false }) { Text("All MCP servers") }
            McpImportForm(servers.flatMap { listOf(it.id, mcpImportServerId(it.name, emptyList())) }, busy, ::saveEntries)
        } else if (commandForm) {
            TextButton(onClick = { commandForm = false; commandPreset = null }) { Text("All MCP servers") }
            McpCommandForm(busy, preset = commandPreset, submit = { saveEntries(listOf(it)) })
        } else if (adding) {
            TextButton(onClick = { adding = false }) { Text("All MCP servers") }
            McpAddForm(backend, presets, busy, navigate, command = { commandPreset = it; commandForm = true; adding = false }) { name, url, preset ->
                scope.launch { session.perform {
                    val added = backend.client.request(McpAddRequest(serverId = mcpServerIdFromUuid(UUID.randomUUID().toString()), name = name.trim(), url = url, presetId = preset))
                    session.reload(); selectedId = added.server.id; adding = false
                } }
            }
        } else {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Button(onClick = { adding = true }, enabled = !busy) { Text("Add server") }
                OutlinedButton(onClick = { commandPreset = null; commandForm = true }, enabled = !busy) { Text("Add command") }
            }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedButton(onClick = { importing = true; commandPreset = null }, enabled = !busy) { Text("Import JSON") }
                OutlinedButton(onClick = { scope.launch { session.perform { session.reload() } } }, enabled = !busy) { Text("Reload") }
            }
            SettingsGroup {
                if (servers.isEmpty()) GroupNote("No MCP servers yet. Add a preset or a remote server URL.")
                servers.forEach { server ->
                    LinkRow(server.name, "${mcpStatusLabel(server.status)} · ${server.tools.size} tools", onClick = { selectedId = server.id })
                }
            }
        }
    }
}

@Composable
private fun McpAddForm(backend: BackendSession, presets: List<McpListResponsePresetsItem>, busy: Boolean, navigate: (Destination) -> Unit, command: (McpListResponsePresetsItem) -> Unit, add: (String, String?, String?) -> Unit) {
    var name by remember { mutableStateOf("") }
    var url by remember { mutableStateOf("") }
    var search by remember { mutableStateOf("") }
    var chosen by remember { mutableStateOf<McpListResponsePresetsItem?>(null) }
    OutlinedTextField(search, { search = it }, label = { Text("Search presets") }, singleLine = true, modifier = Modifier.fillMaxWidth())
    val matches = presets.filter { "${it.name} ${it.description} ${it.group}".contains(search.trim(), ignoreCase = true) }
    if (chosen == null) matches.groupBy { it.group ?: "Docs" }.forEach { (group, entries) ->
        SettingsGroup(title = group) {
            entries.forEach { preset -> LinkRow(preset.name, "${preset.auth.replace('_', ' ')} · ${preset.description.orEmpty()}", onClick = { chosen = preset }) }
        }
    }
    if (matches.isEmpty()) GroupNote("No matching presets.")
    chosen?.let { preset ->
        TextButton(onClick = { chosen = null }) { Text("Back to catalogue") }
        SettingsGroup(title = preset.name) { GroupRow {
            Text(preset.description.orEmpty())
            McpVendorLinks(preset)
            preset.cli?.let { McpCliHint(backend, it, busy, navigate) }
            Button(onClick = { if (preset.command != null) command(preset) else add(preset.name, null, preset.id) }, enabled = !busy) { Text(if (preset.command != null) "Review ${preset.name} command" else "Add ${preset.name}") }
        } }
    }
    SettingsGroup(title = "Custom server") { GroupRow {
        OutlinedTextField(name, { name = it }, label = { Text("Server name") }, singleLine = true, modifier = Modifier.fillMaxWidth())
        OutlinedTextField(url, { url = it }, label = { Text("Server URL") }, singleLine = true, modifier = Modifier.fillMaxWidth())
        Button(onClick = { add(name, url.trim(), null) }, enabled = !busy && name.isNotBlank() && url.isNotBlank()) { Text("Add custom server") }
    } }
}

@Composable
private fun McpVendorLinks(preset: McpListResponsePresetsItem) {
    val uri = LocalUriHandler.current
    preset.docsUrl?.let { TextButton(onClick = { uri.openUri(it) }) { Text("Vendor documentation") } }
    preset.tokenUrl?.let { TextButton(onClick = { uri.openUri(it) }) { Text("Create a token") } }
    preset.appUrl?.let { TextButton(onClick = { uri.openUri(it) }) { Text("Create an app here") } }
    preset.steps?.forEachIndexed { index, step -> Text("${index + 1}. $step", style = MaterialTheme.typography.bodySmall) }
}

@Composable
private fun McpServerDetails(backend: BackendSession, server: McpOAuthCompleteResponseServer, busy: Boolean, preset: McpListResponsePresetsItem?, navigate: (Destination) -> Unit, removed: () -> Unit) {
    val session = backend.mcp
    val client = backend.client
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    var ownApp by remember(server.id) { mutableStateOf(false) }
    var clientId by remember(server.id) { mutableStateOf("") }
    var clientSecret by remember(server.id) { mutableStateOf("") }
    val registeredApp = ownApp || preset?.auth == "registered_oauth"
    fun takeClient(): Pair<String?, String?> {
        val pair = (if (registeredApp) clientId.trim().takeIf { it.isNotEmpty() } else null) to (if (registeredApp) clientSecret.takeIf { it.isNotEmpty() } else null)
        clientId = ""; clientSecret = ""; return pair
    }
    var editingCommand by remember(server.id) { mutableStateOf(false) }
    var tokenDialog by remember(server.id) { mutableStateOf(false) }
    var callbackDialog by remember(server.id) { mutableStateOf(false) }
    var confirmRemove by remember(server.id) { mutableStateOf(false) }
    var filter by remember(server.id) { mutableStateOf("") }
    var copied by remember(server.id) { mutableStateOf(false) }
    LaunchedEffect(server.oauthFlow?.status) { if (server.oauthFlow?.status != "pending") copied = false }
    var copyError by remember(server.id) { mutableStateOf(false) }
    var callbackUrl by remember(server.oauthFlow?.flowId, server.oauthFlow?.status) { mutableStateOf("") }
    fun change(action: suspend () -> Unit) { scope.launch { session.perform { action(); session.reload() } } }
    preset?.let { SettingsGroup(title = it.name) { GroupRow {
        Text(it.description.orEmpty()); McpVendorLinks(it)
        it.cli?.let { cli -> McpCliHint(backend, cli, busy, navigate) }
    } } }
    SettingsGroup(title = server.name) { GroupRow {
        Text("${mcpStatusLabel(server.status)} · ${server.tools.size} tools", style = MaterialTheme.typography.titleMedium)
        Text(server.command?.let { "${it.command} ${it.args}" } ?: server.url, style = MaterialTheme.typography.bodySmall)
        if (server.command != null) {
            Text("Working directory: ${server.command.cwd ?: "(backend default)"}\nEnvironment: ${server.envNames.orEmpty().joinToString()}")
            OutlinedButton(onClick = { editingCommand = !editingCommand }, enabled = !busy) { Text("Edit command") }
            server.stderrTail?.takeIf { it.isNotBlank() }?.let { Text("Redacted stderr tail:\n$it", style = MaterialTheme.typography.bodySmall) }
        }
        server.lastError?.let { Text(it, color = MaterialTheme.colorScheme.error) }
        server.oauthFlow?.let { flow ->
            Text("Sign-in: ${flow.status}${flow.error?.let { ": $it" }.orEmpty()}", style = MaterialTheme.typography.bodySmall)
            if (flow.status == "pending") TextButton(onClick = { scope.launch { session.cancel(flow.flowId) } }, enabled = !busy) { Text("Cancel sign-in") }
        }
        if (server.command == null) {
            if (preset?.auth != "registered_oauth") Row { Checkbox(ownApp, { ownApp = it }); Text("Use my own OAuth app", Modifier.padding(top = 12.dp)) }
            if (registeredApp) {
                Text("Bring your own OAuth app. Register this exact redirect URL:")
                Text(session.redirectUri, style = MaterialTheme.typography.bodySmall)
                TextButton(onClick = {
                    (context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager).setPrimaryClip(ClipData.newPlainText("OAuth redirect URL", session.redirectUri))
                }) { Text("Copy redirect URL") }
                Text("Local installs allow localhost and 127.0.0.1 at the installed port. The vendor may require HTTPS or app approval.", style = MaterialTheme.typography.bodySmall)
                if (server.hasOAuthClient == true) Text("App saved. Leave fields empty to reuse it, or enter a new client ID to replace it.")
                OutlinedTextField(clientId, { clientId = it }, label = { Text("Client ID (write-only)") }, modifier = Modifier.fillMaxWidth())
                OutlinedTextField(clientSecret, { clientSecret = it }, label = { Text("Client secret (optional, write-only)") }, visualTransformation = PasswordVisualTransformation(), keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password, autoCorrectEnabled = false), modifier = Modifier.fillMaxWidth())
                Text("Stored only as a backend credential, never shown again.", style = MaterialTheme.typography.bodySmall)
            }
        }
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            if (server.command == null) {
            Button(onClick = { val app = takeClient(); scope.launch {
                session.start(server.id, app.first, app.second)?.let { authorization ->
                    try { CustomTabsIntent.Builder().build().launchUrl(context, Uri.parse(authorization)) }
                    catch (_: Exception) { session.browserFailed() }
                }
            } }, enabled = !busy && server.oauthFlow?.status != "pending" && (!registeredApp || server.hasOAuthClient == true || clientId.isNotBlank())) { Text("Sign in") }
            OutlinedButton(onClick = { val app = takeClient(); scope.launch {
                try {
                    copied = session.copySignInLink(server.id, app.first, app.second) { url ->
                        val clipboard = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
                        clipboard.setPrimaryClip(ClipData.newPlainText("MCP sign-in link", url))
                    }
                    copyError = false
                } catch (_: Exception) { copyError = true }
            } }, enabled = !busy) { Text("Copy sign-in link") }
            OutlinedButton(onClick = { tokenDialog = true }, enabled = !busy) { Text("Paste token") }
            OutlinedButton(onClick = { callbackDialog = true }, enabled = !busy) { Text("Paste callback URL") }
            }
            OutlinedButton(onClick = { change { client.request(McpRefreshRequest(serverId = server.id)) } }, enabled = !busy) { Text("Refresh tools") }
            OutlinedButton(onClick = { change { client.request(McpDisconnectRequest(serverId = server.id)) } }, enabled = !busy) { Text("Disconnect") }
            TextButton(onClick = { confirmRemove = true }, enabled = !busy) { Text("Remove", color = MaterialTheme.colorScheme.error) }
        }
        if (copied && server.oauthFlow?.status == "pending") Text("Copied — open it in the browser where you're signed in, then come back.", style = MaterialTheme.typography.bodySmall)
        if (copyError) Text("Could not copy the sign-in link. Try again.", color = MaterialTheme.colorScheme.error)
        if (server.oauthFlow?.status == "pending") {
            OutlinedTextField(callbackUrl, { callbackUrl = it }, label = { Text("Paste callback URL") },
                visualTransformation = PasswordVisualTransformation(), keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
                modifier = Modifier.fillMaxWidth(), enabled = !busy)
            Text("Copy the callback link from your browser and paste it here. It contains a short-lived code; do not share it.", style = MaterialTheme.typography.bodySmall)
            Button(onClick = {
                val url = callbackUrl.trim(); callbackUrl = ""
                scope.launch { session.complete(url) }
            }, enabled = !busy && callbackUrl.isNotBlank()) { Text("Complete sign-in") }
        }
        if (server.command == null) Text("Sign-in returns through ${session.redirectUri}. If this backend does not allow the configured web origin, its operator must configure that origin. After signing in, paste the callback URL here if the browser does not return to Aiki.", style = MaterialTheme.typography.bodySmall)
    } }
    if (editingCommand) McpCommandForm(busy, server) { entry -> change {
        client.request(McpAddRequest(serverId = server.id, name = entry.name, command = entry.command, env = entry.env, presetId = server.presetId, confirmed = true, replace = true)); editingCommand = false
    } }
    OutlinedTextField(filter, { filter = it }, label = { Text("Filter tools") }, singleLine = true, modifier = Modifier.fillMaxWidth())
    val tools = server.tools.filter { mcpToolMatches(it, filter) }
    Text("${tools.size} of ${server.tools.size} tools · hints are supplied by the server", style = MaterialTheme.typography.bodySmall)
    // Bounded nested list: settings has its own scroll container. Only visible catalogue rows compose.
    LazyColumn(Modifier.fillMaxWidth().heightIn(min = 120.dp, max = 520.dp)) {
        items(tools, key = { it.name }) { tool ->
            McpToolRow(tool, busy) { policy -> change { client.request(McpPolicySetRequest(serverId = server.id, tool = tool.name, policy = policy)) } }
        }
        if (tools.isEmpty()) item { Text("No matching tools.", Modifier.padding(12.dp)) }
    }
    if (tokenDialog) McpSecretDialog("Paste token", "Token (write-only)", "Save token", { tokenDialog = false }) { secret ->
        tokenDialog = false
        change {
            client.request(McpTokenSetRequest(serverId = server.id, token = secret))
            client.request(McpRefreshRequest(serverId = server.id))
        }
    }
    if (callbackDialog) McpSecretDialog("Paste callback URL", "Full callback URL", "Complete sign-in", { callbackDialog = false }) { callback ->
        callbackDialog = false; scope.launch { session.complete(callback) }
    }
    if (confirmRemove) AlertDialog(onDismissRequest = { confirmRemove = false }, title = { Text("Remove ${server.name}?") },
        text = { Text("Removes this server, its credentials and project enablement from the backend.") },
        confirmButton = { TextButton(onClick = { confirmRemove = false; change { client.request(McpRemoveRequest(serverId = server.id)); removed() } }) { Text("Remove") } },
        dismissButton = { TextButton(onClick = { confirmRemove = false }) { Text("Keep server") } })
}

@Composable
private fun McpToolRow(tool: McpOAuthCompleteResponseServerToolsItem, busy: Boolean, setPolicy: (String) -> Unit) {
    var expanded by remember(tool.name) { mutableStateOf(false) }
    Column(Modifier.fillMaxWidth().padding(vertical = 6.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
        Text(tool.name, style = MaterialTheme.typography.labelLarge)
        Text(mcpToolHint(tool), style = MaterialTheme.typography.labelSmall)
        tool.description?.let { description ->
            Text(description, Modifier.fillMaxWidth().clickable(onClickLabel = if (expanded) "Collapse description" else "Expand description") { expanded = !expanded },
                style = MaterialTheme.typography.bodySmall, maxLines = if (expanded) Int.MAX_VALUE else 1, overflow = TextOverflow.Ellipsis)
        }
        SingleChoiceSegmentedButtonRow(Modifier.fillMaxWidth()) {
            MCP_POLICIES.forEachIndexed { index, policy -> SegmentedButton(
                selected = mcpPolicy(tool.policy) == policy, onClick = { setPolicy(policy) }, enabled = !busy,
                shape = SegmentedButtonDefaults.itemShape(index, MCP_POLICIES.size),
            ) { Text(policy.replaceFirstChar { it.uppercase() }) } }
        }
        HorizontalDivider()
    }
}

/** Secret-bearing fields deliberately use remember, never rememberSaveable or a device store. */
@Composable
private fun McpSecretDialog(title: String, label: String, action: String, dismiss: () -> Unit, submit: (String) -> Unit) {
    var secret by remember { mutableStateOf("") }
    AlertDialog(onDismissRequest = dismiss, title = { Text(title) }, text = {
        OutlinedTextField(secret, { secret = it }, label = { Text(label) }, visualTransformation = PasswordVisualTransformation(),
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password, autoCorrectEnabled = false),
            singleLine = true, modifier = Modifier.fillMaxWidth())
    }, confirmButton = { TextButton(onClick = { val submitted = secret; secret = ""; submit(submitted) }, enabled = secret.isNotBlank()) { Text(action) } },
        dismissButton = { TextButton(onClick = { secret = ""; dismiss() }) { Text("Cancel") } })
}
