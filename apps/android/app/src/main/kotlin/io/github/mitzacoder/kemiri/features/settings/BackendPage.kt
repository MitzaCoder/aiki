package io.github.mitzacoder.kemiri.features.settings

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.github.mitzacoder.kemiri.data.*
import io.github.mitzacoder.kemiri.features.status.*
import io.github.mitzacoder.kemiri.navigation.Destination
import io.github.mitzacoder.kemiri.ui.theme.Jarvis
import kotlinx.coroutines.launch

/**
 * General → Backends → one backend: its connection and release, its name (saved when you leave the field), where its
 * accounts and API keys live, its memory maintenance, and removing it from this device.
 */
@Composable
internal fun BackendPage(repository: HarnessRepository, backend: BackendSession, navigator: SettingsNavigator) {
    val connection by backend.client.state.collectAsStateWithLifecycle()
    val backendError by backend.error.collectAsStateWithLifecycle()
    val catalog by backend.modelCatalog.collectAsStateWithLifecycle()
    val scope = rememberCoroutineScope()
    val nameSave = rememberSaveState(backend.config.key)
    var confirmingRemove by rememberSaveable { mutableStateOf(false) }
    val providers = catalog?.providers.orEmpty()
    val ready = providers.count { it.configured }
    val split = LocalSettingsSplit.current
    SettingsSectionPage(backend.config.name, backend.config.url, SettingsIcon.Server, actions = { ConnectionBadge(connection.status, connection.attempt) }) {
        backendError?.let { ToneBanner(BannerTone.Error) { Text(it, style = MaterialTheme.typography.bodySmall) } }
        connection.error?.let { ToneBanner(BannerTone.Error) { Text(it, style = MaterialTheme.typography.bodySmall) } }
        if (connection.status != ConnectionStatus.Ready) ToneBanner(BannerTone.Warning) {
            Text(
                if (connection.status == ConnectionStatus.Connecting || connection.status == ConnectionStatus.Reconnecting) "Connecting to ${backend.config.name}…" else "${backend.config.name} is offline.",
                style = MaterialTheme.typography.bodySmall,
            )
        }
        BackendDeviceAccess(repository, backend, navigator)
        if (connection.supports(SERVER_STATUS_FEATURE)) {
            val status by backend.serverStatus.status.collectAsStateWithLifecycle()
            DeployBanner(repository, backend)
            SettingsGroup(title = "Status") {
                SettingsRow("Release", hint = "The commit this backend runs.", control = RowControl.Full) { ReleaseLine(status, compact = false) }
                SettingsRow("Machine", hint = "Disk space on the host.", control = RowControl.Full) {
                    MachineLine(status)
                    if (status == null || serverDisks(status).isEmpty()) Text("Not reported.", style = MaterialTheme.typography.bodySmall, color = Jarvis.colors.fgMuted)
                }
            }
        } else connection.hello?.server?.let { GroupLessNote("Server: ${it.name} ${it.version}") }
        SettingsGroup(title = "This backend") {
            SettingsRow("Name", hint = "Only for you, on this device.", status = nameSave) {
                AutoInput(backend.config.name, nameSave, label = "Backend name") { next ->
                    require(next.length in 1..48) { "Use a name of 1–48 characters." }
                    repository.renameBackend(backend.config.key, next)
                }
            }
            SettingsRow("Address", hint = "Where the app connects.", control = RowControl.Auto) { CopyableValue(backend.config.url, "Copy the address") }
            if (connection.supports("credentials") || connection.supports("logins")) LinkRow(
                "Accounts and API keys", "Sign in to a subscription or paste a key.",
                onClick = { navigator.go(Destination.Settings(GeneralPage(GeneralSection.Backends, backend.config.key, accounts = true)), split) },
                chip = if (providers.isNotEmpty()) ({ StatusChip("$ready of ${providers.size} ready", if (ready > 0) ChipTone.Ok else ChipTone.Warn) }) else null,
            )
        }
        if (connection.supports(MCP_FEATURE)) SettingsGroup {
            LinkRow("MCP servers", "Remote tools, sign-in and tool policies.",
                onClick = { navigator.go(Destination.Settings(GeneralPage(GeneralSection.Backends, backend.config.key, mcp = true)), split) })
        }
        if (connection.supports("memory-maintenance")) MemoryMaintenanceGroup(backend)
        SettingsGroup(title = "Remove", danger = true) {
            SettingsRow("Remove this backend", hint = "Forgets it on this device. Its projects and data stay on the server.", control = RowControl.Auto) {
                if (confirmingRemove) Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedButton(onClick = { confirmingRemove = false }, modifier = Modifier.heightIn(min = 44.dp)) { Text("Keep it") }
                    Button(
                        onClick = { scope.launch { runCatching { repository.removeBackend(backend.config.key) }; navigator.replace(Destination.Settings(GeneralPage(GeneralSection.Backends))) } },
                        colors = ButtonDefaults.buttonColors(containerColor = Jarvis.colors.danger), modifier = Modifier.heightIn(min = 44.dp),
                    ) { Text("Remove") }
                } else OutlinedButton(onClick = { confirmingRemove = true }, modifier = Modifier.heightIn(min = 44.dp)) { Text("Remove", color = Jarvis.colors.danger) }
            }
        }
    }
}

@Composable
internal fun GroupLessNote(text: String) = Text(text, style = MaterialTheme.typography.bodySmall, color = Jarvis.colors.fgMuted)
