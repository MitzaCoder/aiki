package io.github.mitzacoder.aiki.features.settings

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.github.mitzacoder.aiki.data.*
import io.github.mitzacoder.aiki.navigation.Destination
import io.github.mitzacoder.aiki.ui.theme.Jarvis
import kotlinx.coroutines.launch

/**
 * General → Backends: the servers this device talks to, each opening its own page (status, rename, accounts and API keys,
 * memory maintenance), then the ways to add one: a published suggestion, a typed address, a link or QR code, and the
 * link or QR code that connects another device.
 */
@Composable
internal fun BackendsSection(repository: HarnessRepository, navigator: SettingsNavigator, connectPayload: String?, onConnectHandled: () -> Unit) {
    val settings by repository.settings.collectAsStateWithLifecycle()
    val sessions by repository.sessions.collectAsStateWithLifecycle()
    val split = LocalSettingsSplit.current
    val scope = rememberCoroutineScope()
    val local = LocalContext.current
    val preferences = remember { local.getSharedPreferences("harness-discovery", android.content.Context.MODE_PRIVATE) }
    var publishedUrl by rememberSaveable { mutableStateOf(preferences.getString("url", DEFAULT_PUBLISHED_URL) ?: DEFAULT_PUBLISHED_URL) }
    var suggestions by remember { mutableStateOf<List<BackendConfig>>(emptyList()) }
    var refresh by remember { mutableIntStateOf(0) }
    var name by rememberSaveable { mutableStateOf("") }
    var address by rememberSaveable { mutableStateOf("") }
    var importValue by rememberSaveable { mutableStateOf("") }
    var previewValue by rememberSaveable { mutableStateOf<String?>(null) }
    var suggestion by remember { mutableStateOf<BackendConfig?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    fun preview(value: String) {
        decodeConnect(value.substringAfter('#', value)).onSuccess { previewValue = value; error = null }.onFailure { error = it.message }
    }
    val imported = previewValue?.let { decodeConnect(it.substringAfter('#', it)).getOrNull() } ?: suggestion?.let { listOf(it) }
    LaunchedEffect(refresh) { suggestions = fetchPublishedBackends(publishedUrl) }
    LaunchedEffect(connectPayload) { connectPayload?.let { preview(it); onConnectHandled() } }
    val missing = suggestions.filter { row -> settings.backends.none { it.key == row.key } }

    SettingsSectionPage("Backends", "The servers this device talks to. Each keeps its own projects, agents and tools.", SettingsIcon.Server) {
        SettingsGroup(title = "Your backends") {
            if (sessions.isEmpty()) GroupNote("No backends yet. Add one below.")
            sessions.forEach { backend -> key(backend.config.key) {
                val connection by backend.client.state.collectAsStateWithLifecycle()
                LinkRow(
                    backend.config.name, backend.config.url,
                    onClick = { navigator.go(Destination.Settings(GeneralPage(GeneralSection.Backends, backend.config.key)), split) },
                    leading = { BackendTile() },
                    chip = { ConnectionBadge(connection.status, connection.attempt) },
                )
            } }
        }
        if (missing.isNotEmpty()) SettingsGroup(title = "Suggested backends", description = "Published beside the app. One tap adds one and connects.") {
            missing.forEach { row ->
                GroupRow {
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        Column(Modifier.weight(1f)) {
                            Text(row.name, style = MaterialTheme.typography.bodyMedium, fontWeight = androidx.compose.ui.text.font.FontWeight.SemiBold)
                            Text(row.url, style = MaterialTheme.typography.labelMedium, fontFamily = FontFamily.Monospace, color = Jarvis.colors.fgMuted)
                        }
                        OutlinedButton(onClick = { suggestion = row.copy(name = row.name.take(48)) }, modifier = Modifier.heightIn(min = 44.dp)) { Text("Add") }
                    }
                }
            }
        }
        SettingsGroup(title = "Add a backend") {
            SettingsRow(
                "Name and address", hint = "A bare name like harness-pc expands to the published domain.", control = RowControl.Full,
                learn = { Text("A backend is a harness server reached over HTTPS: the app opens wss://<address>/ws and keeps one connection per backend. The list is stored on this device.") },
            ) {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedTextField(address, { address = it }, label = { Text("URL, host, or published name") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                    OutlinedTextField(name, { name = it }, label = { Text("Name (optional; filled from address)") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                    if (address.isNotBlank()) runCatching { resolveBackend(address, name, suggestions, publishedUrl) }.getOrNull()?.let {
                        Text("Will add ${it.name} · ${it.url}", style = MaterialTheme.typography.bodySmall, color = Jarvis.colors.fgMuted)
                    }
                    Button(enabled = address.isNotBlank(), modifier = Modifier.heightIn(min = 44.dp), onClick = {
                        scope.launch { runCatching {
                            repository.addBackends(listOf(resolveBackend(address, name, suggestions, publishedUrl)))
                            name = ""; address = ""; error = null
                        }.onFailure { error = it.message } }
                    }) { Text("Add backend") }
                }
            }
            SettingsRow(
                "Published list", hint = "Where the suggestions above come from.", control = RowControl.Full,
                learn = { Text("Unavailable or invalid lists are ignored. Manual setup always works.") },
            ) {
                OutlinedTextField(publishedUrl, { publishedUrl = it }, label = { Text("Published list URL") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                TextButton(onClick = { preferences.edit().putString("url", publishedUrl).apply(); refresh++ }, modifier = Modifier.heightIn(min = 44.dp)) { Text("Reload suggestions") }
            }
        }
        SettingsGroup(title = "Connect with a link or QR") {
            SettingsRow("Scan or paste", hint = "Preview connections before saving them on this device.", control = RowControl.Full) {
                ConnectScanner { preview(it) }
                OutlinedTextField(importValue, { importValue = it }, label = { Text("Connect link") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                TextButton(onClick = { preview(importValue) }, enabled = importValue.isNotBlank(), modifier = Modifier.heightIn(min = 44.dp)) { Text("Preview import") }
            }
        }
        if (settings.backends.isNotEmpty()) ConnectDeviceGroup(settings.backends)
        error?.let { Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall) }
    }
    imported?.let { rows ->
        AlertDialog(onDismissRequest = { previewValue = null; suggestion = null }, title = { Text("Add these backends?") },
            text = { Column {
                Text(rows.joinToString("\n\n") { "${it.name}\n${it.url}" })
                error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
            } },
            confirmButton = { TextButton(onClick = { scope.launch { runCatching {
                repository.addBackends(rows); previewValue = null; suggestion = null; importValue = ""
            }.onFailure { error = it.message } } }) { Text("Add") } },
            dismissButton = { TextButton(onClick = { previewValue = null; suggestion = null }) { Text("Cancel") } })
    }
}

@Composable
internal fun BackendTile() {
    val colors = Jarvis.colors
    Box(Modifier.size(36.dp).background(colors.surface2.copy(alpha = .7f), RoundedCornerShape(10.dp)), contentAlignment = Alignment.Center) {
        io.github.mitzacoder.aiki.ui.components.LucideGlyph(io.github.mitzacoder.aiki.navigation.NavGlyphs.Server, size = 16.dp, tint = colors.fgMuted)
    }
}
