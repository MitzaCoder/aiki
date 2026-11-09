package com.mihaisaru.harness.features.refs

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.platform.UriHandler
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.LinkAnnotation
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextLinkStyles
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withLink
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.repeatOnLifecycle
import com.mihaisaru.harness.data.ConnectionStatus
import com.mihaisaru.harness.data.HarnessFeature
import com.mihaisaru.harness.data.readRefDetails
import com.mihaisaru.harness.data.readRefStatus
import com.mihaisaru.harness.features.chat.LocalTextLinkers
import com.mihaisaru.harness.features.chat.TextLinkSpan
import com.mihaisaru.harness.features.chat.TextLinker
import com.mihaisaru.harness.features.tasks.refLabel
import com.mihaisaru.harness.features.tasks.refUrl
import com.mihaisaru.harness.navigation.ProjectScreenContext
import com.mihaisaru.harness.protocol.ProjectLinks
import com.mihaisaru.harness.protocol.RefStatus
import com.mihaisaru.harness.ui.components.Lucide
import com.mihaisaru.harness.ui.components.LucideGlyph
import com.mihaisaru.harness.ui.components.TaskStatusDot
import com.mihaisaru.harness.ui.theme.Jarvis
import com.mihaisaru.harness.ui.theme.TaskStatusTone
import com.mihaisaru.harness.ui.theme.textStyle
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map

/**
 * Where a project's tickets and pull requests point and what state they are in: the Android twin of the web's
 * `lib/ref-links.svelte.ts`, provided by [ProvideRefLinks].
 */
interface RefLinks {
    /** The project's link settings; null on a backend without them. */
    val links: ProjectLinks?
    /** A ref's live state, once read; null while unknown. */
    fun status(ref: String): RefStatus?
    /** The tone of a ref's state dot; null for no dot. */
    fun tone(ref: String): TaskStatusTone?
    /** Where a ref opens; null when it does not link. */
    fun url(ref: String): String?
    /** Opens a ref: its card for a pull request, issue or ticket, else its address. */
    fun open(ref: String)
}

val LocalRefLinks = compositionLocalOf<RefLinks?> { null }

@Stable
private class ProjectRefLinks(
    override val links: ProjectLinks?,
    private val statuses: Map<String, RefStatus>,
    private val showCard: (ResolvedRef, String) -> Unit,
    private val openAddress: (String) -> Unit,
) : RefLinks {
    override fun status(ref: String) = statuses[ref]
    override fun tone(ref: String) = status(ref)?.let(::refStatusTone)
    // The backend's address is the canonical one (a bare #12 resolves to /issues/12, which GitHub forwards).
    override fun url(ref: String) = status(ref)?.url ?: refHref(ref, links)
    override fun open(ref: String) {
        val href = url(ref) ?: return
        cardRefOf(href)?.let { showCard(it, href) } ?: openAddress(href)
    }
}

/** A link in running text, styled like the Markdown's own. */
private fun linkStyles(color: androidx.compose.ui.graphics.Color) =
    TextLinkStyles(SpanStyle(color = color, textDecoration = TextDecoration.Underline))

/**
 * Links ticket keys, `#123`s and bare GitHub and Jira addresses in the plain text of rendered Markdown. A transcript
 * offers a [streaming] copy around a reply still arriving, so a mention at its very end waits until it is whole.
 */
class RefTextLinker(private val links: ProjectLinks?, private val styles: TextLinkStyles, val streaming: Boolean = false) : TextLinker {
    override fun find(text: String): List<TextLinkSpan> =
        textLinkTargets(text, links, streaming).map { TextLinkSpan(it.start, it.end, LinkAnnotation.Url(it.href, styles)) }

    fun streaming(): RefTextLinker = RefTextLinker(links, styles, streaming = true)
}

/** The ref card on screen: what it is about and the address that opened it. */
internal data class ShownCard(val ref: ResolvedRef, val href: String)

/**
 * Offers [RefLinks] for the project to everything in [content]: the link settings, the live state of the board's refs
 * (`refs.status` when they change, every 2 minutes while the app is in front, on coming back and after a reconnect),
 * a [RefTextLinker] added to [LocalTextLinkers], and a card for every pull request, issue or ticket link tapped inside
 * (chips, linked keys, Markdown links), from `refs.details` when the backend has it.
 */
@Composable
fun ProvideRefLinks(context: ProjectScreenContext?, content: @Composable () -> Unit) {
    if (context == null) {
        CompositionLocalProvider(LocalRefLinks provides null, content = content)
        return
    }
    val client = context.backend.client
    val projectId = context.route.projectId
    val latest by rememberUpdatedState(context)
    val projects by context.backend.projects.collectAsStateWithLifecycle()
    val connection by client.state.collectAsStateWithLifecycle()
    val view by context.board.view.collectAsStateWithLifecycle()
    val links = projects.firstOrNull { it.id == projectId }?.links?.links()
    val statusSupported = connection.supports(HarnessFeature.REF_STATUS)

    val store = remember(client, projectId) { RefStatusStore({ refs ->
        android.util.Log.d("HarnessRefs", "refs.status for ${refs.size} refs")
        client.readRefStatus(projectId, refs)
    }) }
    val details = remember(client, projectId) { RefDetailsCache({ client.readRefDetails(projectId, it) }) }
    val boardRefs = remember(view.tasks) { view.tasks.flatMap { it.refs } }
    fun canRead() = client.state.value.let { it.status == ConnectionStatus.Ready && it.supports(HarnessFeature.REF_STATUS) }
    LaunchedEffect(store, boardRefs, statusSupported) {
        if (statusSupported && store.want(boardRefs)) { delay(RefStatusStore.SETTLE_MS); store.refresh() }
    }
    LaunchedEffect(store) {
        client.state.map { it.status == ConnectionStatus.Ready && it.supports(HarnessFeature.REF_STATUS) }.distinctUntilChanged()
            .collect { ready -> if (ready) store.refresh() }
    }
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    LaunchedEffect(store, lifecycle) {
        lifecycle.repeatOnLifecycle(Lifecycle.State.STARTED) {
            if (store.staleOnReturn() && canRead()) store.refresh()
            while (true) {
                delay(RefStatusStore.REFRESH_MS)
                if (canRead()) store.refresh()
            }
        }
    }
    val statuses by store.statuses.collectAsStateWithLifecycle()

    val outer = LocalUriHandler.current
    // One card state per project; the handler and links below are rebuilt with it, so a new project's taps reach it.
    val shownState = remember(client, projectId) { mutableStateOf<ShownCard?>(null) }
    var shown by shownState
    val handler = remember(outer, shownState) {
        object : UriHandler {
            override fun openUri(uri: String) {
                cardRefOf(uri)?.let { shownState.value = ShownCard(it, uri) } ?: runCatching { outer.openUri(uri) }
            }
        }
    }
    val refLinks = remember(links, if (statusSupported) statuses else emptyMap(), handler, shownState) {
        ProjectRefLinks(links, if (statusSupported) statuses else emptyMap(), { ref, href -> shownState.value = ShownCard(ref, href) }, handler::openUri)
    }
    val styles = linkStyles(Jarvis.colors.link)
    val linker = remember(links, styles) { RefTextLinker(links, styles) }
    val linkers = LocalTextLinkers.current + linker
    CompositionLocalProvider(LocalRefLinks provides refLinks, LocalUriHandler provides handler, LocalTextLinkers provides linkers) {
        content()
        shown?.let { card ->
            RefCardSheet(
                card = card,
                links = links,
                tasks = view.tasks,
                statuses = refLinks::status,
                details = details,
                detailsSupported = connection.supports(HarnessFeature.REF_DETAILS),
                canOpenTasks = connection.supports(HarnessFeature.TASK_REPORTS),
                openTask = { taskId -> shown = null; latest.openTask(taskId) },
                openAddress = { href -> shown = null; runCatching { outer.openUri(href) } },
                onDismiss = { shown = null },
            )
        }
    }
}

private val chipShape = RoundedCornerShape(5.dp)

/**
 * One ref as a small quiet chip (web `RefChip`): its key or number, a dot in its state's colour once read. A [compact]
 * chip (rows and board cards) is only as tall as the web's; its tap area still reaches past its edges, as Compose
 * widens a small target's touch area to the minimum touch size.
 */
@Composable
fun RefChip(ref: String, modifier: Modifier = Modifier, compact: Boolean = false) {
    val links = LocalRefLinks.current
    val uri = LocalUriHandler.current
    val colors = Jarvis.colors
    val label = refLabel(ref, links?.links)
    val target = links?.url(ref) ?: refUrl(ref)?.toString()
    val tone = links?.tone(ref)
    val description = refTooltip(ref, label, links?.links, links?.status(ref)).lineSequence().first()
    val open: (() -> Unit)? = when {
        target == null -> null
        links != null -> { { links.open(ref) } }
        else -> { { runCatching { uri.openUri(target) } } }
    }
    // The tap area reaches a little past the chip's edges, as on the web's touch screens.
    Box(modifier
        .then(if (open != null) Modifier.clip(if (compact) chipShape else RoundedCornerShape(8.dp)).clickable(role = Role.Button, onClick = open) else Modifier)
        .semantics { contentDescription = when { open == null -> description; target != null && cardRefOf(target) != null && links != null -> "$description, opens its card"; else -> "$description, opens in the browser" } }
        .padding(vertical = if (compact) 0.dp else 4.dp)) {
        Row(Modifier.clip(chipShape).background(colors.surface2.copy(alpha = .6f)).border(BorderStroke(1.dp, colors.borderStrong.copy(alpha = .65f)), chipShape)
            .padding(horizontal = 5.dp, vertical = 1.dp),
            horizontalArrangement = Arrangement.spacedBy(4.dp), verticalAlignment = Alignment.CenterVertically) {
            tone?.let { TaskStatusDot(it) }
            Text(label, style = textStyle(0.65625f, 1f / 0.65625f, mono = true), color = colors.fgMuted, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
    }
}

/** A task's refs as chips, the first [max] and then "+N" (rows 2, board cards 3, like the web). */
@Composable
fun RefChips(refs: List<String>, max: Int, modifier: Modifier = Modifier) {
    if (refs.isEmpty()) return
    val colors = Jarvis.colors
    Row(modifier, horizontalArrangement = Arrangement.spacedBy(4.dp), verticalAlignment = Alignment.CenterVertically) {
        refs.take(max).forEach { RefChip(it, Modifier.widthIn(max = 144.dp), compact = true) }
        if (refs.size > max) Text("+${refs.size - max}", style = textStyle(0.65625f, 1f / 0.65625f, mono = true), color = colors.fgSubtle)
    }
}

/**
 * A task sheet's refs (web `TaskSheet`): with live state each is a line (its chip, its state in words, its title and
 * an outward arrow, the line opening its card); before any state is known, all of them as chips.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun RefLines(refs: List<String>, modifier: Modifier = Modifier) {
    if (refs.isEmpty()) return
    val links = LocalRefLinks.current
    val colors = Jarvis.colors
    if (links == null || refs.none { links.status(it) != null }) {
        FlowRow(modifier.semantics { contentDescription = "Tickets and pull requests" }, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            refs.forEach { RefChip(it, Modifier.widthIn(max = 256.dp)) }
        }
        return
    }
    Column(modifier.semantics { contentDescription = "Tickets and pull requests" }) {
        refs.forEach { ref ->
            val status = links.status(ref)
            val target = links.url(ref)
            val label = refLabel(ref, links.links)
            Row(Modifier.fillMaxWidth().heightIn(min = 40.dp).clip(RoundedCornerShape(6.dp))
                .then(if (target != null) Modifier.clickable(role = Role.Button) { links.open(ref) } else Modifier)
                .padding(vertical = 4.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                Text(label, Modifier.widthIn(max = 144.dp).clip(chipShape).background(colors.surface2.copy(alpha = .6f))
                    .border(BorderStroke(1.dp, colors.borderStrong.copy(alpha = .65f)), chipShape).padding(horizontal = 5.dp, vertical = 1.dp),
                    style = textStyle(0.65625f, 1f / 0.65625f, mono = true), color = colors.fgMuted, maxLines = 1, overflow = TextOverflow.Ellipsis)
                if (status != null) {
                    Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
                        refStatusTone(status)?.let { TaskStatusDot(it) }
                        Text(refStatusWords(status), style = textStyle(0.75f, 1f / 0.75f, weight = 500), color = colors.fgMuted, maxLines = 1)
                    }
                    status.title?.takeIf { it.isNotEmpty() }?.let {
                        Text(it, Modifier.weight(1f), style = textStyle(0.75f, 1f / 0.75f), color = colors.fgSubtle, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    } ?: Spacer(Modifier.weight(1f))
                } else Spacer(Modifier.weight(1f))
                if (target != null) LucideGlyph(Lucide.ExternalLink, size = 12.dp, tint = colors.fgSubtle.copy(alpha = .7f))
            }
        }
    }
}

/** Plain text (a task sheet's title) with the keys and numbers the project's settings link; taps open their cards. */
@Composable
fun refLinkedText(text: String): AnnotatedString {
    val links = LocalRefLinks.current?.links
    val styles = linkStyles(Jarvis.colors.link)
    return remember(text, links, styles) {
        buildAnnotatedString {
            for (piece in splitRefMentions(text, links)) {
                val href = piece.href
                if (href == null) append(piece.text) else withLink(LinkAnnotation.Url(href, styles)) { append(piece.text) }
            }
        }
    }
}
