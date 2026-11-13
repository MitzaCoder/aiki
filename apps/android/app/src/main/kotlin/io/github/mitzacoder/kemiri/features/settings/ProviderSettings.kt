package io.github.mitzacoder.kemiri.features.settings

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.compose.ui.Alignment
import io.github.mitzacoder.kemiri.ui.components.*
import io.github.mitzacoder.kemiri.ui.theme.LocalJarvisColors
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.runtime.saveable.rememberSaveable
import io.github.mitzacoder.kemiri.features.status.BannerTone
import io.github.mitzacoder.kemiri.features.status.ToneBanner
import io.github.mitzacoder.kemiri.ui.theme.Jarvis
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.compose.ui.window.SecureFlagPolicy
import io.github.mitzacoder.kemiri.data.*
import io.github.mitzacoder.kemiri.protocol.*
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import kotlinx.serialization.json.*

internal fun AuthLogin.active() = status == "prompt" || status == "working"

/** Timestamp/terminal guards apply only within one incarnation; authoritative reads may select a restarted login. */
internal fun mergeLogin(current: Map<String, AuthLogin>, incoming: AuthLogin, authoritative: Boolean = true): Map<String, AuthLogin> {
    val old = current[incoming.id]
    if (old != null) {
        if (old.startedAt != incoming.startedAt) {
            if (!authoritative) return current
        } else if (old.updatedAt > incoming.updatedAt || (!old.active() && incoming.active())) return current
    }
    return current + (incoming.id to if (incoming.active()) incoming else incoming.copy(prompt = null))
}

/** Lists/start responses choose incarnations; pushes can advance only their matching incarnation. */
internal class LoginSnapshots {
    data class Read(val sequence: Long, val revision: Long)
    private data class Push(val revision: Long, val login: AuthLogin)
    var logins: Map<String, AuthLogin> = emptyMap()
        private set
    private var sequence = 0L
    private var revision = 0L
    private val pushes = mutableMapOf<Pair<String, Long>, Push>()
    private val retired = mutableSetOf<Pair<String, Long>>()
    private fun AuthLogin.identity() = id to startedAt
    fun beginRead() = Read(++sequence, revision)

    /** True asks the caller to reconcile a previously unknown incarnation with an authoritative list. */
    fun push(incoming: AuthLogin): Boolean {
        val identity = incoming.identity()
        if (identity in retired) return false
        val previous = pushes[identity]?.login ?: logins[incoming.id]?.takeIf { it.startedAt == incoming.startedAt }
        val next = mergeLogin(previous?.let { mapOf(it.id to it) }.orEmpty(), incoming).getValue(incoming.id)
        if (previous == next) return false
        pushes[identity] = Push(++revision, next)
        val current = logins[incoming.id]
        if (current != null && current.startedAt != incoming.startedAt) return true
        logins = mergeLogin(logins, next, authoritative = false)
        return false
    }

    private fun withPush(incoming: AuthLogin): AuthLogin {
        val current = logins[incoming.id]?.takeIf { it.startedAt == incoming.startedAt }
        var next = mergeLogin(current?.let { mapOf(it.id to it) }.orEmpty(), incoming).getValue(incoming.id)
        pushes[incoming.identity()]?.let { next = mergeLogin(mapOf(next.id to next), it.login).getValue(next.id) }
        return next
    }

    fun replace(read: Read, incoming: List<AuthLogin>) {
        if (read.sequence != sequence) return
        val next = incoming.associate { it.id to withPush(it) }.toMutableMap()
        pushes.values.filter { it.revision > read.revision }.forEach {
            if (it.login.id !in next) next[it.login.id] = it.login
        }
        publish(next, read.revision)
    }

    fun started(read: Read, incoming: AuthLogin) {
        if (read.sequence == sequence) publish(logins + (incoming.id to withPush(incoming)))
    }

    private fun publish(next: Map<String, AuthLogin>, retireThrough: Long = revision) {
        (logins.values.map { it.identity() } + pushes.filterValues { it.revision <= retireThrough }.keys).forEach { identity ->
            if (next[identity.first]?.startedAt != identity.second) retired += identity
        }
        next.values.forEach { retired -= it.identity() }
        pushes.keys.removeAll(retired)
        logins = next
    }
}

/** How a configured provider got its credential (web `how`). */
internal fun providerHow(provider: ProviderInfo, credentials: List<CredentialInfo>): Pair<String, ChipTone> = when (credentials.firstOrNull { it.providerId == provider.id }?.type) {
    "oauth" -> "Signed in" to ChipTone.Ok
    "api_key" -> "API key" to ChipTone.Ok
    else -> "From environment" to ChipTone.Info
}

/** The "Add a provider" list: the providers without a credential, searchable by name, ID and sign-in name. */
internal fun providerOptions(providers: List<ProviderInfo>): List<ComboOption> = providers.map { provider ->
    ComboOption(
        value = provider.id, label = provider.name,
        description = provider.oauth?.let { "${provider.id} · ${it.name}" } ?: provider.id,
        keywords = provider.oauth?.name.orEmpty(),
        badge = "subscription".takeIf { provider.oauth?.isSubscription == true },
    )
}

/**
 * General → Backends → one backend → Accounts and API keys. Credentials belong to the backend that holds them. Providers
 * that already work are listed with how (signed in, a key, the environment); the rest are one search away, so a long
 * provider list stays short.
 */
@Composable
internal fun AccountsPage(backend: BackendSession) {
    SecureWhileShown()
    val client = backend.client
    val scope = rememberCoroutineScope()
    val catalog by backend.modelCatalog.collectAsStateWithLifecycle()
    var credentials by remember { mutableStateOf<List<CredentialInfo>>(emptyList()) }
    val snapshots = remember(client) { LoginSnapshots() }
    var logins by remember(client) { mutableStateOf(snapshots.logins) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val connection by client.state.collectAsStateWithLifecycle()
    val canKeys = connection.supports("credentials")
    val canLogin = connection.supports("logins")
    var credentialRead by remember { mutableLongStateOf(0) }
    suspend fun refreshCredentials() {
        val read = ++credentialRead
        val response = client.request(CredentialsListRequest())
        if (read == credentialRead) credentials = response.credentials
    }
    suspend fun refreshLogins() {
        val read = snapshots.beginRead()
        val response = client.request(CredentialsLoginsRequest())
        snapshots.replace(read, response.logins)
        logins = snapshots.logins
    }
    suspend fun refresh() {
        backend.refreshModels()
        if (canKeys) refreshCredentials()
        if (canLogin) refreshLogins()
    }
    fun act(block: suspend () -> Unit) {
        scope.launch {
            busy = true; error = null
            try { block() }
            catch (e: CancellationException) { throw e }
            catch (_: Exception) { error = "Request failed. Refresh to check backend state before retrying." }
            finally { busy = false }
        }
    }
    fun pushed(login: AuthLogin) {
        val needsSnapshot = snapshots.push(login)
        logins = snapshots.logins
        if (needsSnapshot) scope.launch {
            try { refreshLogins() }
            catch (e: CancellationException) { throw e }
            catch (_: Exception) { error = "Could not reconcile login. Try refresh." }
        }
    }
    LaunchedEffect(client) {
        client.events.collect { event ->
            if (event is CredentialsLoginEvent) {
                pushed(event.login)
                if (!event.login.active() && canKeys) launch {
                    try { refreshCredentials() }
                    catch (e: CancellationException) { throw e }
                    catch (_: Exception) { error = "Could not refresh configured status." }
                }
            }
        }
    }
    LaunchedEffect(client, connection) {
        if (connection.status == ConnectionStatus.Ready) {
            busy = true
            try { refresh() }
            catch (e: CancellationException) { throw e }
            catch (_: Exception) { error = "Could not load providers. Try refresh." }
            finally { busy = false }
        }
    }
    var expanded by rememberSaveable { mutableStateOf(listOf<String>()) }
    var adding by rememberSaveable { mutableStateOf("") }
    val providers = catalog?.providers.orEmpty()
    val configured = providers.filter { it.configured }
    val others = providers.filter { !it.configured }
    fun inProgress(provider: ProviderInfo) = logins.values.any { it.providerId == provider.id }
    val signingIn = others.filter { inProgress(it) && it.id != adding }
    val addProvider = others.firstOrNull { it.id == adding }
    val supported = canKeys || canLogin

    @Composable fun panel(provider: ProviderInfo) {
        val stored = credentials.any { it.providerId == provider.id }
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            if (provider.configured && canKeys && !stored) Text("Configured outside stored credentials (for example, the backend's environment). Removing a stored key cannot remove environment credentials.", style = MaterialTheme.typography.bodySmall, color = Jarvis.colors.fgMuted)
            var showModels by remember { mutableStateOf(false) }
            TextButton(onClick = { showModels = !showModels }, modifier = Modifier.heightIn(min = 44.dp)) { Text(if (showModels) "Hide models" else "Models") }
            if (showModels) catalog?.models?.filter { it.provider == provider.id }?.forEach {
                Text("${it.name} (${it.modelId}) · ${if (it.configured) "configured" else "not configured"}", style = MaterialTheme.typography.bodySmall)
            }
            if (canKeys) {
                var apiKey by remember(provider.id) { mutableStateOf("") }
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    SecretField(apiKey, { apiKey = it }, if (stored) "Replace stored key" else "API key", Modifier.weight(1f))
                    SettingsAction("Save API key", Lucide.Check, enabled = !busy && apiKey.isNotBlank(), onClick = {
                        val value = apiKey.trim(); apiKey = ""
                        act { client.request(CredentialsSetRequest(providerId = provider.id, apiKey = value)); refresh() }
                    })
                }
                if (stored) {
                    var confirm by remember { mutableStateOf(false) }
                    TextButton(enabled = !busy, onClick = { confirm = !confirm }, modifier = Modifier.heightIn(min = 44.dp)) { Text("Remove stored credential…") }
                    if (confirm) TextButton(enabled = !busy, onClick = { confirm = false; act { client.request(CredentialsDeleteRequest(providerId = provider.id)); refresh() } }, modifier = Modifier.heightIn(min = 44.dp)) { Text("Confirm removal on backend", color = Jarvis.colors.danger) }
                }
            }
            val login = logins.values.filter { it.providerId == provider.id }.maxByOrNull { it.startedAt }
            if (canLogin && provider.oauth != null) {
                Button(enabled = !busy && login?.active() != true, modifier = Modifier.heightIn(min = 44.dp), onClick = {
                    act {
                        val read = snapshots.beginRead()
                        val response = client.request(CredentialsLoginStartRequest(providerId = provider.id))
                        snapshots.started(read, response.login)
                        logins = snapshots.logins
                    }
                }) { Text(provider.oauth.loginLabel) }
            }
            login?.let { current ->
                LoginContents(current, busy, onAnswer = { prompt, answer ->
                    act { pushed(client.request(CredentialsLoginAnswerRequest(loginId = current.id, promptId = prompt.id, value = answer)).login) }
                }, onCancel = {
                    act { client.request(CredentialsLoginCancelRequest(loginId = current.id)); refresh() }
                })
            }
        }
    }

    SettingsSectionPage("Accounts and API keys", "Signed-in accounts and keys for ${backend.config.name}. They stay on that backend.", SettingsIcon.KeyRound, actions = {
        if (providers.isNotEmpty()) StatusChip("${configured.size} of ${providers.size} ready", if (configured.isNotEmpty()) ChipTone.Ok else ChipTone.Warn)
    }) {
        error?.let { ToneBanner(BannerTone.Error) { Text(it, style = MaterialTheme.typography.bodySmall) } }
        if (busy) LinearProgressIndicator(Modifier.fillMaxWidth())
        if (!supported) ToneBanner(BannerTone.Warning) { Text("This backend does not advertise accounts or API keys.", style = MaterialTheme.typography.bodySmall) }
        else if (providers.isEmpty()) Text(if (connection.status == ConnectionStatus.Ready) "Loading providers…" else "Waiting for ${backend.config.name}…", style = MaterialTheme.typography.bodyMedium, color = Jarvis.colors.fgMuted)
        else {
            if (signingIn.isNotEmpty()) SettingsGroup(title = "Signing in") {
                signingIn.forEach { provider -> key(provider.id) {
                    SettingsRow(provider.name, hint = provider.oauth?.name ?: provider.id, control = RowControl.Full, below = { panel(provider) })
                } }
            }
            SettingsGroup(title = "Ready to use", description = if (configured.isEmpty()) "No provider has a credential yet; add one below." else null) {
                configured.forEach { provider -> key(provider.id) {
                    val (howLabel, howTone) = providerHow(provider, credentials)
                    val open = provider.id in expanded || inProgress(provider)
                    SettingsRow(
                        provider.name, hint = provider.oauth?.let { "${provider.id} · ${it.name}" } ?: provider.id, control = RowControl.Auto,
                        below = if (open) ({ panel(provider) }) else null,
                    ) {
                        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            StatusChip(howLabel, howTone)
                            OutlinedButton(onClick = { expanded = if (open) expanded - provider.id else expanded + provider.id }, modifier = Modifier.heightIn(min = 44.dp).semantics { stateDescription = if (open) "Expanded" else "Collapsed" }) {
                                Text(if (open) "Close" else "Manage")
                            }
                        }
                    }
                } }
            }
            if (others.isNotEmpty()) SettingsGroup(title = "Add a provider") {
                SettingsRow(
                    "Provider", hint = "Pick one, then sign in or paste a key.",
                    learn = { Text("Subscriptions sign in with OAuth. Open the link, finish signing in in your browser, then paste the code or the final redirect URL back here: the browser cannot reach the backend's localhost callback. A provider whose key is in the backend's environment already shows as ready.") },
                    below = addProvider?.let { provider -> ({ panel(provider) }) },
                ) {
                    Combobox(remember(others) { providerOptions(others) }, adding, { adding = it }, "Provider", placeholder = "Choose a provider…", searchPlaceholder = "Search providers…")
                }
            }
        }
    }
}

@Composable
private fun SecretField(value: String, change: (String) -> Unit, label: String, modifier: Modifier = Modifier.fillMaxWidth()) {
    OutlinedTextField(value, change, label = { Text(label) }, singleLine = true,
        visualTransformation = PasswordVisualTransformation(),
        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password, autoCorrectEnabled = false), modifier = modifier)
}

@Composable
private fun LoginContents(login: AuthLogin, busy: Boolean, onAnswer: (AuthPrompt, String) -> Unit, onCancel: () -> Unit) {
    SettingsBadge(accountLoginLabel(login.status), color = when (login.status) {
        "succeeded" -> LocalJarvisColors.current.success
        "failed" -> LocalJarvisColors.current.danger
        "prompt", "working" -> LocalJarvisColors.current.warning
        else -> MaterialTheme.colorScheme.onSurfaceVariant
    }, icon = when (login.status) { "succeeded" -> Lucide.Check; "failed" -> Lucide.CircleAlert; else -> Lucide.Clock })
    login.error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
    if (!login.active()) return
    val uri = LocalUriHandler.current
    var linkError by remember { mutableStateOf(false) }
    @Composable fun link(url: String?, label: String) {
        if (url != null && runCatching { java.net.URI(url).scheme in listOf("https", "http") }.getOrDefault(false)) {
            TextButton(onClick = { linkError = runCatching { uri.openUri(url) }.isFailure }) { Text(label) }
        }
    }
    login.events.forEach { event ->
        when (event) {
            is AuthEventAuthUrl -> { link(event.url, "Open sign-in page"); event.instructions?.let { Text(it) } }
            is AuthEventDeviceCode -> { Text("Device code: ${event.userCode}"); link(event.verificationUri, "Open device activation page") }
            is AuthEventInfo -> {
                Text(event.message)
                event.links?.forEach { item -> link(item.url, item.label ?: "Open link") }
            }
            is AuthEventProgress -> Text(event.message)
            is UnknownAuthEvent -> (event.raw["message"] as? JsonPrimitive)?.contentOrNull?.let { Text(it) }
        }
    }
    if (linkError) Text("No browser available to open this link.")
    login.prompt?.let { prompt -> key(login.id, prompt.id) {
        Text(prompt.message)
        if (prompt.type == "select") prompt.options.orEmpty().forEach { option ->
            TextButton(enabled = !busy, onClick = { onAnswer(prompt, option.id) }) { Text(option.label + (option.description?.let { " · $it" } ?: "")) }
        } else {
            var answer by remember { mutableStateOf("") }
            SecretField(answer, { answer = it }, prompt.placeholder ?: "Code or redirect URL")
            Button(enabled = !busy && answer.isNotBlank(), onClick = { val value = answer.trim(); answer = ""; onAnswer(prompt, value) }) { Text("Send answer") }
        }
    } }
    TextButton(enabled = !busy, onClick = onCancel) { Text("Cancel login") }
}

/**
 * Keeps the window out of screenshots and the recents preview while credentials can be on screen (the old dialog did the
 * same with `SecureFlagPolicy.SecureOn`). Debug builds skip it so the page can be captured in tests.
 */
@Composable
internal fun SecureWhileShown() {
    if (io.github.mitzacoder.kemiri.BuildConfig.DEBUG) return
    val window = androidx.activity.compose.LocalActivity.current?.window ?: return
    DisposableEffect(window) {
        window.addFlags(android.view.WindowManager.LayoutParams.FLAG_SECURE)
        onDispose { window.clearFlags(android.view.WindowManager.LayoutParams.FLAG_SECURE) }
    }
}
