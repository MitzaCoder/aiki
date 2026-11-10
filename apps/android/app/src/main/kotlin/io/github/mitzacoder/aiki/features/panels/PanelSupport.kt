package io.github.mitzacoder.aiki.features.panels

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material3.*
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import io.github.mitzacoder.aiki.ui.components.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.text.font.FontFamily
import io.github.mitzacoder.aiki.features.chat.HarnessMarkdown
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import io.github.mitzacoder.aiki.data.*
import io.github.mitzacoder.aiki.navigation.*
import io.github.mitzacoder.aiki.protocol.*
import kotlinx.coroutines.*
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.*

internal class PanelData<T> {
    var value by mutableStateOf<T?>(null)
    var error by mutableStateOf<String?>(null)
    var loading by mutableStateOf(true)
    val refresh = Channel<Unit>(Channel.CONFLATED)
}

/** Invalidation, rather than applying archive-free pushes, keeps archive views complete.
 * collectLatest cancels reads on events/reconnect/filter changes, so old snapshots cannot win. */
@Composable
internal fun <T> panelData(context: ProjectScreenContext, key: Any?, relevant: (ProtocolEvent) -> Boolean, read: suspend () -> T): PanelData<T> {
    val client = context.backend.client
    val data = remember(client, context.route, key) { PanelData<T>() }
    val currentRead by rememberUpdatedState(read)
    val currentRelevant by rememberUpdatedState(relevant)
    LaunchedEffect(data) {
        coroutineScope {
            launch(start = CoroutineStart.UNDISPATCHED) {
                client.events.collect { if (currentRelevant(it)) data.refresh.trySend(Unit) }
            }
            launch(start = CoroutineStart.UNDISPATCHED) {
                client.state.collect { data.refresh.trySend(Unit) }
            }
            latestPanelReads(
                triggers = data.refresh.receiveAsFlow(),
                ready = { client.state.value.status == ConnectionStatus.Ready },
                read = { currentRead() },
                loading = { data.loading = it },
                accept = { data.value = it; data.error = null },
                failure = { data.error = panelError(it) },
            )
        }
    }
    return data
}
internal suspend fun <T> latestPanelReads(
    triggers: Flow<Unit>, ready: () -> Boolean, read: suspend () -> T,
    loading: (Boolean) -> Unit, accept: (T) -> Unit, failure: (Exception) -> Unit,
) {
    triggers.collectLatest {
        if (!ready()) { loading(false); return@collectLatest }
        loading(true)
        try {
            val result = read()
            currentCoroutineContext().ensureActive()
            accept(result)
        } catch (e: CancellationException) { throw e }
        catch (e: Exception) { failure(e) }
        finally { loading(false) }
    }
}

internal fun panelError(e: Exception): String = when ((e as? ClientException)?.code) {
    "unknown_request" -> "This backend does not implement this panel yet."
    "memory_conflict" -> "Memory changed after this commit. Undo was not applied; refresh and review the later changes."
    else -> e.message ?: "Request failed"
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable internal fun <T> PanelBody(data: PanelData<T>, content: @Composable ColumnScope.(T) -> Unit) {
    PullToRefreshBox(isRefreshing = data.loading, onRefresh = { data.refresh.trySend(Unit) }, modifier = Modifier.fillMaxSize()) {
        Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(vertical = 12.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            data.error?.let {
                Surface(color = MaterialTheme.colorScheme.errorContainer, shape = MaterialTheme.shapes.medium) {
                    Row(Modifier.padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
                        Text(it, Modifier.weight(1f), style = MaterialTheme.typography.bodySmall)
                        IconAction("Retry loading panel", Lucide.Clock) { data.refresh.trySend(Unit) }
                    }
                }
            }
            if (data.value == null && !data.loading && data.error == null) WorkbenchEmpty("Waiting for connection", "This panel will load when the backend reconnects.")
            data.value?.let { content(it) }
        }
    }
}
@Composable internal fun PanelCard(title: String, subtitle: String? = null, modifier: Modifier = Modifier, header: @Composable RowScope.() -> Unit = {}, content: @Composable ColumnScope.() -> Unit = {}) {
    OutlinedCard(modifier.fillMaxWidth(), shape = MaterialTheme.shapes.medium, colors = CardDefaults.outlinedCardColors(containerColor = MaterialTheme.colorScheme.surfaceContainerLow)) {
        Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(title, Modifier.weight(1f), style = MaterialTheme.typography.titleSmall)
                header()
            }
            subtitle?.let { Text(it, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
            CompositionLocalProvider(LocalTextStyle provides MaterialTheme.typography.bodySmall) { content() }
        }
    }
}
@Composable internal fun PanelDisclosure(title: String, subtitle: String? = null, initiallyExpanded: Boolean = false, content: @Composable ColumnScope.() -> Unit) {
    var expanded by rememberSaveable(title) { mutableStateOf(initiallyExpanded) }
    Column {
        Surface(onClick = { expanded = !expanded }, color = MaterialTheme.colorScheme.surface.copy(alpha = 0f), shape = MaterialTheme.shapes.small) {
            Row(Modifier.fillMaxWidth().heightIn(min = 48.dp).padding(horizontal = 4.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                LucideGlyph(if (expanded) Lucide.ChevronDown else Lucide.ChevronRight, size = 14.dp)
                Text(title, Modifier.weight(1f), style = MaterialTheme.typography.labelMedium)
                subtitle?.let { Text(it, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
            }
        }
        androidx.compose.animation.AnimatedVisibility(expanded) { Column(Modifier.padding(start = 12.dp, bottom = 8.dp), verticalArrangement = Arrangement.spacedBy(8.dp), content = content) }
    }
}
@Composable internal fun Detail(title: String, body: String, markdown: Boolean = false, monospace: Boolean = false) {
    PanelDisclosure(title) {
        if (markdown) HarnessMarkdown(body, Modifier.fillMaxWidth())
        else SelectionContainer { Text(body, style = MaterialTheme.typography.bodySmall, fontFamily = if (monospace) FontFamily.Monospace else null) }
    }
}
@Composable internal fun PanelMetaChip(label: String, icon: LucideIcon? = null, monospace: Boolean = false) {
    Surface(shape = MaterialTheme.shapes.small, color = MaterialTheme.colorScheme.surfaceContainerHigh, contentColor = MaterialTheme.colorScheme.onSurfaceVariant) {
        Row(Modifier.padding(horizontal = 6.dp, vertical = 3.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            icon?.let { LucideGlyph(it, size = 12.dp) }
            Text(label, style = MaterialTheme.typography.labelSmall, fontFamily = if (monospace) FontFamily.Monospace else null)
        }
    }
}
@Composable internal fun PanelStat(label: String, value: String, modifier: Modifier = Modifier) {
    OutlinedCard(modifier, shape = MaterialTheme.shapes.medium) {
        Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(value, style = MaterialTheme.typography.titleMedium)
            Text(label, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}
@Composable internal fun Action(label: String, enabled: Boolean = true, after: () -> Unit = {}, run: suspend () -> Unit) {
    val scope = rememberCoroutineScope()
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    Column {
        TextButton(enabled = enabled && !busy, onClick = {
            busy = true; error = null
            scope.launch {
                try { run(); after() } catch (e: CancellationException) { throw e }
                catch (e: Exception) { error = panelError(e) } finally { busy = false }
            }
        }) { Text(if (busy) "Working…" else label) }
        error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
    }
}

internal fun normalizedThread(id: String?) = id ?: "main"
internal fun matchesContext(route: Destination.Chat, value: ConversationContext) = route.projectId == value.projectId && route.workerId == value.workerId && normalizedThread(route.threadId) == normalizedThread(value.threadId)
internal fun usageFraction(usage: ContextUsage): Float? {
    val tokens = usage.contextTokens ?: return null
    val window = usage.contextWindow?.takeIf { it > 0 } ?: return null
    return (tokens.toDouble() / window).coerceIn(0.0, 1.0).toFloat()
}
internal fun threadRoute(route: Destination.Chat, thread: ThreadSummary) = route.copy(threadId = if (thread.main) null else thread.id, workerId = null)
internal fun memoryTarget(link: String, scope: String): Pair<String, String> = when {
    link.startsWith("global:") -> "global" to link.removePrefix("global:")
    link.startsWith("project:") -> "project" to link.removePrefix("project:")
    else -> scope to link
}
internal fun snippetParts(snippet: String): List<Pair<String, Boolean>> {
    val parts = mutableListOf<Pair<String, Boolean>>()
    var highlighted = false
    val text = StringBuilder()
    for (c in snippet) {
        if (c == '\u0002' || c == '\u0003') {
            if (text.isNotEmpty()) parts += text.toString() to highlighted
            text.clear(); highlighted = c == '\u0002'
        } else text.append(c)
    }
    if (text.isNotEmpty()) parts += text.toString() to highlighted
    return parts
}
