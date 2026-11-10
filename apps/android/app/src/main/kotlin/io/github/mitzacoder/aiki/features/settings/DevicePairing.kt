package io.github.mitzacoder.aiki.features.settings

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp
import io.github.mitzacoder.aiki.data.*
import io.github.mitzacoder.aiki.protocol.*
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch

/** A link is parsed locally, then explicitly confirmed before any enrollment request or backend addition. */
@Composable
fun PairDeviceDialog(repository: HarnessRepository, initialLink: String = "", onDismiss: () -> Unit) {
    var input by remember { mutableStateOf(initialLink) }
    var link by remember { mutableStateOf<DevicePairingLink?>(null) }
    var name by remember { mutableStateOf("") }
    var code by remember { mutableStateOf("") }
    var comparison by remember { mutableStateOf<String?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    LaunchedEffect(initialLink) {
        if (initialLink.isNotBlank()) try {
            link = decodeDevicePairingLink(initialLink)
            name = repository.session(link!!.origin)?.config?.name ?: java.net.URI(link!!.origin).host
        } catch (_: Exception) { error = "This pairing link is invalid or unsupported." }
    }
    AlertDialog(
        onDismissRequest = { if (!busy) onDismiss() },
        title = { Text(if (comparison != null) "Confirm on your other device" else "Pair this backend") },
        text = { Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            if (link == null) {
                OutlinedTextField(input, { input = it; error = null }, label = { Text("Paste pairing link") }, modifier = Modifier.fillMaxWidth())
                Text("Use Add a device on a signed-in device, or the owner CLI. Address-import links do not grant access.")
            } else {
                Text(link!!.origin, fontFamily = FontFamily.Monospace)
                Text("Backend ID: ${link!!.backendId}", style = MaterialTheme.typography.bodySmall)
                OutlinedTextField(name, { if (it.length <= 48) name = it }, label = { Text("Backend name") }, enabled = !busy, modifier = Modifier.fillMaxWidth())
                Text("Full access to this computer", style = MaterialTheme.typography.titleMedium)
                Text("This device can read and change files, run commands and use paid providers. Only pair a computer you trust.")
                if (link!!.bootstrap) OutlinedTextField(code, { code = it.uppercase().filter { char -> char in 'A'..'Z' || char in '2'..'7' }.take(12) },
                    label = { Text("12-character code from the CLI") }, enabled = !busy, modifier = Modifier.fillMaxWidth())
                comparison?.let {
                    Text(it, style = MaterialTheme.typography.headlineMedium, fontFamily = FontFamily.Monospace)
                    Text("Check that this code matches on the approving device. Do not approve if it differs.")
                    LinearProgressIndicator(Modifier.fillMaxWidth())
                }
            }
            error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
        } },
        confirmButton = { if (comparison == null) TextButton(enabled = !busy && (link == null || !link!!.bootstrap || code.length == 12), onClick = {
            if (link == null) {
                try { link = decodeDevicePairingLink(input); name = repository.session(link!!.origin)?.config?.name ?: java.net.URI(link!!.origin).host; input = ""; error = null }
                catch (_: Exception) { error = "This pairing link is invalid or unsupported." }
            } else scope.launch {
                busy = true; error = null
                try { repository.pairBackend(link!!, name, code) { comparison = it }; onDismiss() }
                catch (cancelled: CancellationException) { throw cancelled }
                catch (failure: Exception) { error = failure.message ?: "Pairing failed. Try a new link."; comparison = null }
                finally { busy = false }
            }
        }) { Text(if (link == null) "Review link" else if (busy) "Pairing…" else "Pair and add backend") } },
        dismissButton = { TextButton(onClick = onDismiss) { Text(if (busy) "Close" else "Cancel") } },
    )
}

/** Pending approvals belong to the backend's existing socket and appear on every app screen. */
@Composable
fun DeviceApprovalDialogs(repository: HarnessRepository) {
    val sessions by repository.sessions.collectAsState()
    val pending = remember { mutableStateMapOf<String, Pair<BackendSession, AuthPairing>>() }
    var error by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    sessions.forEach { backend ->
        LaunchedEffect(backend) {
            backend.client.events.collect { event ->
                when (event) {
                    is AuthPairingRequestedEvent -> pending[backend.config.key + event.pairing.id] = backend to event.pairing
                    is AuthDevicesChangedEvent -> {
                        runCatching { backend.client.request(AuthPairingsListRequest()) }.getOrNull()?.pairings?.let { pairings ->
                            pending.keys.filter { pending[it]?.first === backend && pairings.none { pairing -> pairing.id == pending[it]?.second?.id && pairing.state == "claimed" } }.forEach { pending.remove(it) }
                        }
                    }
                    is AuthSessionRevokedEvent -> pending.keys.filter { pending[it]?.first === backend }.forEach { pending.remove(it) }
                    else -> Unit
                }
            }
        }
        LaunchedEffect(backend, backend.client.state.collectAsState().value.generation) {
            if (backend.client.state.value.hello?.auth?.sessionId != null) {
                runCatching { backend.client.request(AuthPairingsListRequest()) }.getOrNull()?.pairings?.filter { it.state == "claimed" }?.forEach {
                    pending[backend.config.key + it.id] = backend to it
                }
            }
        }
    }
    val approval = pending.entries.firstOrNull() ?: return
    val backend = approval.value.first
    val pairing = approval.value.second
    var now by remember { mutableLongStateOf(System.currentTimeMillis()) }
    LaunchedEffect(pairing.id) { while (true) { kotlinx.coroutines.delay(1000); now = System.currentTimeMillis(); if (java.time.Instant.parse(pairing.expiresAt).toEpochMilli() <= now) { pending.remove(approval.key); break } } }
    fun decide(approve: Boolean) { scope.launch {
        busy = true; error = null
        try {
            val claimId = requireNotNull(pairing.claimId)
            if (approve) backend.client.request(AuthPairingsApproveRequest(grantId = pairing.id, claimId = claimId))
            else backend.client.request(AuthPairingsDenyRequest(grantId = pairing.id, claimId = claimId))
            pending.remove(approval.key)
        } catch (cancelled: CancellationException) { throw cancelled }
        catch (failure: Exception) { error = failure.message ?: "Could not send the decision." }
        finally { busy = false }
    } }
    AlertDialog(onDismissRequest = {}, title = { Text("Approve new device?") }, text = {
        Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Text(backend.config.name)
            Text(backend.config.url, style = MaterialTheme.typography.bodySmall)
            Text("${pairing.label.orEmpty()} · ${pairing.platform.orEmpty()}")
            Text(pairing.comparisonCode.orEmpty(), style = MaterialTheme.typography.headlineMedium, fontFamily = FontFamily.Monospace)
            Text("Full access to this computer. Approve only if the code matches on the device you are adding. The name and platform are unverified labels.")
            error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
        }
    }, confirmButton = { TextButton(enabled = !busy, onClick = { decide(true) }) { Text("Approve") } },
        dismissButton = { TextButton(enabled = !busy, onClick = { decide(false) }) { Text("Deny") } })
}
