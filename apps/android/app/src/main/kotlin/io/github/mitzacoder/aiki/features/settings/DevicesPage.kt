package io.github.mitzacoder.aiki.features.settings

import android.content.Intent
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.github.mitzacoder.aiki.BuildConfig
import io.github.mitzacoder.aiki.data.*
import io.github.mitzacoder.aiki.protocol.*
import io.github.mitzacoder.aiki.navigation.Destination
import io.github.mitzacoder.aiki.features.status.ToneBanner
import io.github.mitzacoder.aiki.features.status.BannerTone
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

@Composable
internal fun DevicesPage(repository: HarnessRepository, backend: BackendSession) {
    val connection by backend.client.state.collectAsStateWithLifecycle()
    val auth by backend.client.deviceAuth!!.state.collectAsStateWithLifecycle()
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    var devices by remember { mutableStateOf<List<AuthDevice>>(emptyList()) }
    var pairings by remember { mutableStateOf<List<AuthPairing>>(emptyList()) }
    var error by remember { mutableStateOf<String?>(null) }
    var pairingDialog by remember { mutableStateOf(false) }
    var confirm by remember { mutableStateOf(true) }
    var grant by remember { mutableStateOf<AuthPairingsCreateResponse?>(null) }
    var revoking by remember { mutableStateOf<AuthDevice?>(null) }
    var renaming by remember { mutableStateOf<AuthDevice?>(null) }
    var rename by remember { mutableStateOf("") }
    var now by remember { mutableLongStateOf(System.currentTimeMillis()) }
    val authenticated = connection.status == ConnectionStatus.Ready && connection.hello?.auth?.sessionId != null
    suspend fun refresh() {
        if (!authenticated) return
        devices = backend.client.request(AuthDevicesListRequest()).devices
        val latest = backend.client.request(AuthPairingsListRequest()).pairings
        pairings = latest.filter { it.state == "unused" || it.state == "claimed" }
        if (grant != null && latest.none { it.id == grant?.pairing?.id && it.state == "unused" }) grant = null
        error = null
    }
    fun mutate(action: suspend () -> Unit) { scope.launch {
        try { action(); refresh() }
        catch (cancelled: CancellationException) { throw cancelled }
        catch (failure: Exception) { error = failure.message ?: "Device request failed." }
    } }
    LaunchedEffect(backend, authenticated) { try { refresh() } catch (failure: Exception) { error = failure.message } }
    LaunchedEffect(backend, authenticated) { backend.client.events.collect { if (it is AuthDevicesChangedEvent) try { refresh() } catch (failure: Exception) { error = failure.message } } }
    LaunchedEffect(Unit) { while (true) { delay(1000); now = System.currentTimeMillis() } }
    SettingsSectionPage("Devices", backend.config.name, SettingsIcon.Server) {
        Text(backend.config.url, style = MaterialTheme.typography.bodySmall)
        Text("Every signed-in device has full access to this computer. Revoking access does not stop running commands or agents.", style = MaterialTheme.typography.bodySmall)
        auth.notice?.let { notice -> ToneBanner(BannerTone.Warning) {
            Text(if (auth.comparisonCode != null) "$notice · code ${auth.comparisonCode}" else notice)
        } }
        error?.let { ToneBanner(BannerTone.Error) { Text(it) } }
        if (!authenticated) {
            SettingsGroup(title = "Sign in") {
                SettingsRow("Pair this backend", hint = "Use a link from a signed-in device or the owner CLI.") {
                    Button(onClick = { pairingDialog = true }) { Text("Pair") }
                }
            }
        } else {
            SettingsGroup(title = "Signed-in devices") {
                devices.forEach { device ->
                    SettingsRow(device.label + if (device.current) " · This device" else "", hint = "${device.platform} · ${device.connectedCount} connected", control = RowControl.Full) {
                        Text("Created ${device.createdAt}\nLast seen ${device.lastSeenAt}\nExpires ${device.expiresAt}", style = MaterialTheme.typography.bodySmall)
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            OutlinedButton(onClick = { renaming = device; rename = device.label }) { Text("Rename") }
                            TextButton(onClick = { revoking = device }) { Text(if (device.current) "Sign out" else "Revoke", color = MaterialTheme.colorScheme.error) }
                        }
                    }
                }
                TextButton(onClick = { mutate { refresh() } }) { Text("Refresh devices") }
            }
            SettingsGroup(title = "Add a device") {
                SettingsRow("Confirm new device", hint = "Check a matching code before granting access.") { Switch(confirm, { confirm = it }) }
                if (!confirm) Text("Anyone holding this link can get full access without your approval. Do not forward it.", color = MaterialTheme.colorScheme.error, modifier = Modifier.padding(12.dp))
                if (grant == null) Button(onClick = { mutate { grant = backend.client.request(AuthPairingsCreateRequest(confirm = confirm)) } }, modifier = Modifier.padding(12.dp)) { Text("Add a device") }
                grant?.let { created ->
                    val remaining = ((java.time.Instant.parse(created.pairing.expiresAt).toEpochMilli() - now) / 1000).coerceAtLeast(0)
                    val href = remember(created) { BuildConfig.APP_ORIGIN + "/pair" + encodeDevicePairingFragment(DevicePairingLink(auth.backendId!!, backend.config.url, created.pairing.id, created.secret)) }
                    Column(Modifier.fillMaxWidth().padding(12.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                        if (remaining > 0) {
                            val modules = remember(href) { runCatching { qrModules(href) }.getOrNull() }
                            modules?.let { QrCode(it) }
                            Text("Expires in ${remaining / 60}:${(remaining % 60).toString().padStart(2, '0')}")
                            Text("Scan on the device you are adding. Do not share screenshots.")
                            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                OutlinedButton(onClick = {
                                    val clipboard = context.getSystemService(android.content.Context.CLIPBOARD_SERVICE) as android.content.ClipboardManager
                                    val clip = android.content.ClipData.newPlainText("One-time pairing link", href)
                                    clip.description.extras = android.os.PersistableBundle().apply { putBoolean("android.content.extra.IS_SENSITIVE", true) }
                                    clipboard.setPrimaryClip(clip)
                                }) { Text("Copy link") }
                                Button(onClick = { context.startActivity(Intent.createChooser(Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, href), "Share pairing link")) }) { Text("Share") }
                            }
                        } else {
                            Text("This link expired. Create a new link.")
                            TextButton(onClick = { grant = null }) { Text("Create new link") }
                        }
                        TextButton(onClick = { mutate { backend.client.request(AuthPairingsCancelRequest(grantId = created.pairing.id)); grant = null } }) { Text("Cancel link") }
                    }
                }
            }
            if (pairings.isNotEmpty()) SettingsGroup(title = "Pending links") {
                pairings.forEach { pairing ->
                    SettingsRow(if (pairing.state == "claimed") "Waiting for approval" else "One-time pairing link", hint = "${pairing.state} · Expires ${pairing.expiresAt}") {
                        TextButton(onClick = { mutate { backend.client.request(AuthPairingsCancelRequest(grantId = pairing.id)); if (grant?.pairing?.id == pairing.id) grant = null } }) { Text("Cancel") }
                    }
                }
            }
        }
    }
    if (pairingDialog) PairDeviceDialog(repository, onDismiss = { pairingDialog = false })
    revoking?.let { device -> AlertDialog(onDismissRequest = { revoking = null }, title = { Text(if (device.current) "Sign out?" else "Revoke this device?") }, text = {
        Text(if (devices.size == 1) "This is the last device. You will need the owner CLI to pair again. Running commands and agents will keep running." else "${device.label} will lose access immediately. Running commands and agents will keep running.")
    }, confirmButton = { TextButton(onClick = { revoking = null; mutate {
        backend.client.request(AuthDevicesRevokeRequest(sessionId = device.id))
        if (device.current) backend.client.deviceAuth.signedOut("This device was signed out")
    } }) { Text(if (device.current) "Sign out" else "Revoke") } }, dismissButton = { TextButton(onClick = { revoking = null }) { Text("Cancel") } }) }
    renaming?.let { device -> AlertDialog(onDismissRequest = { renaming = null }, title = { Text("Rename device") }, text = { OutlinedTextField(rename, { rename = it.take(120) }, label = { Text("Device name") }) },
        confirmButton = { TextButton(enabled = rename.isNotBlank(), onClick = { renaming = null; mutate { backend.client.request(AuthDevicesRenameRequest(sessionId = device.id, label = rename.trim())) } }) { Text("Save") } },
        dismissButton = { TextButton(onClick = { renaming = null }) { Text("Cancel") } }) }
}

@Composable
internal fun BackendDeviceAccess(repository: HarnessRepository, backend: BackendSession, navigator: SettingsNavigator) {
    val controller = backend.client.deviceAuth ?: return
    val auth by controller.state.collectAsStateWithLifecycle()
    if (auth.backendId == null && auth.notice == null) return
    auth.notice?.let { ToneBanner(BannerTone.Warning) { Text(if (auth.comparisonCode != null) "$it · code ${auth.comparisonCode}" else it, style = MaterialTheme.typography.bodySmall) } }
    SettingsGroup(title = "Device access") {
        LinkRow("Devices", "Pair, rename or sign out devices.", onClick = {
            navigator.go(Destination.Settings(GeneralPage(GeneralSection.Backends, backend.config.key, devices = true)), false)
        })
    }
}
