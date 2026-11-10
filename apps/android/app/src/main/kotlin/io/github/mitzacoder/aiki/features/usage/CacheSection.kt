package io.github.mitzacoder.aiki.features.usage

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.github.mitzacoder.aiki.data.*
import io.github.mitzacoder.aiki.features.status.BannerTone
import io.github.mitzacoder.aiki.features.status.StatusGlyphs
import io.github.mitzacoder.aiki.features.status.ToneBanner
import io.github.mitzacoder.aiki.features.status.exactTime
import io.github.mitzacoder.aiki.protocol.*
import io.github.mitzacoder.aiki.ui.components.Lucide
import io.github.mitzacoder.aiki.ui.components.LucideGlyph
import io.github.mitzacoder.aiki.ui.theme.Jarvis
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.*
import androidx.lifecycle.repeatOnLifecycle
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter

/** One backend's prompt cache numbers for the range the reader picked. */
data class CacheStatsState(val stats: CacheStats? = null, val days: Long = 30, val loading: Boolean = false, val error: String? = null)

/**
 * Prompt cache statistics for one backend: `cache.stats` read when the Usage screen shows them and after a reconnect,
 * for the picked range. Kept while the app runs, so going back to the screen shows the last numbers at once (web
 * `BackendCacheStats` in `lib/cache-stats.svelte.ts`).
 */
class CacheStatsStore(private val client: HarnessClient) {
    private val mutableState = MutableStateFlow(CacheStatsState())
    val state: StateFlow<CacheStatsState> = mutableState.asStateFlow()
    private var asked = 0L

    /** Reads on every connect while collected; call from the screen's lifecycle. */
    suspend fun observe() {
        client.state.map { it.status == ConnectionStatus.Ready && it.supports(HarnessFeature.CACHE_STATS) }.distinctUntilChanged()
            .collect { ready -> if (ready) load() }
    }

    suspend fun load(days: Long = state.value.days) {
        if (client.state.value.status != ConnectionStatus.Ready || !client.supports(HarnessFeature.CACHE_STATS)) return
        val ask = synchronized(this) { ++asked }
        mutableState.update { it.copy(days = days, loading = true) }
        try {
            val offset = ZoneId.systemDefault().rules.getOffset(Instant.now()).totalSeconds / 60L
            val stats = client.readCacheStats(days = days, utcOffsetMinutes = offset)
            if (ask == asked) mutableState.update { it.copy(stats = stats, error = null) }
        } catch (error: CancellationException) { throw error }
        catch (error: Exception) { if (ask == asked) mutableState.update { it.copy(error = error.message ?: error.toString()) } }
        finally { if (ask == asked) mutableState.update { it.copy(loading = false) } }
    }

    companion object {
        private val stores = java.util.WeakHashMap<HarnessClient, CacheStatsStore>()
        fun of(client: HarnessClient): CacheStatsStore = synchronized(stores) { stores.getOrPut(client) { CacheStatsStore(client) } }
    }
}

/** The miss list starts short; the reader asks for the rest. */
private const val SHORT_LIST = 15

/**
 * One backend's "Prompt cache" section on the Usage screen: what its model requests cost, how much of that billed a
 * cached prompt again and why, what woke the agents, what would have helped, where it went, and each costly miss with
 * what changed in the request (web `usage/CacheSection.svelte`). Each part folds; on a phone they start folded.
 */
@Composable
fun CacheSection(backend: BackendSession, wide: Boolean) {
    val store = remember(backend.client) { CacheStatsStore.of(backend.client) }
    val state by store.state.collectAsStateWithLifecycle()
    val owner = androidx.lifecycle.compose.LocalLifecycleOwner.current
    LaunchedEffect(store, owner) { owner.lifecycle.repeatOnLifecycle(androidx.lifecycle.Lifecycle.State.STARTED) { store.observe() } }
    val scope = rememberCoroutineScope()
    val colors = Jarvis.colors
    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            LucideGlyph(StatusGlyphs.Coins, size = 16.dp, tint = colors.fgSubtle)
            Text("Prompt cache", Modifier.weight(1f), style = MaterialTheme.typography.titleMedium)
            SingleChoiceSegmentedButtonRow {
                CACHE_STATS_RANGES.forEachIndexed { index, days ->
                    SegmentedButton(selected = state.days == days, onClick = { scope.launch { store.load(days) } },
                        shape = SegmentedButtonDefaults.itemShape(index, CACHE_STATS_RANGES.size), icon = {},
                        enabled = !(state.loading && state.days == days)) { Text("$days days", style = MaterialTheme.typography.labelSmall) }
                }
            }
        }
        state.error?.let { ToneBanner(if (state.stats != null) BannerTone.Warning else BannerTone.Error) { Text("Could not read the prompt cache numbers: $it", style = MaterialTheme.typography.bodySmall) } }
        val stats = state.stats
        if (stats == null) { if (state.error == null) LinearProgressIndicator(Modifier.fillMaxWidth()); return@Column }
        Column(Modifier.alpha(if (state.loading) .6f else 1f), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            SummaryCard(stats)
            // Side by side where there is room, as the web's grid does.
            if (wide) Row(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.Top) {
                Box(Modifier.weight(1f)) { ReasonsCard(stats, wide) }
                Box(Modifier.weight(1f)) { WakesCard(stats, wide) }
            } else { ReasonsCard(stats, wide); WakesCard(stats, wide) }
            val ideas = listOfNotNull(longCacheLine(stats)) + wakeAdvice(stats, state.days)
            if (ideas.isNotEmpty()) CacheCard("What would help", wide, icon = StatusGlyphs.Lightbulb) {
                ideas.forEach { idea -> Row { Text("•  ", color = colors.fgMuted); Text(idea, style = MaterialTheme.typography.bodySmall, color = colors.fgMuted) } }
            }
            val groups: List<@Composable () -> Unit> = listOf(
                { GroupCard("By project", stats.byProject, wide) { it.label } },
                { GroupCard("By conversation", stats.byKind, wide) { kindGroupLabel(it.key) } },
                { GroupCard("By model", stats.byModel, wide) { it.label } },
            )
            if (wide) Row(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.Top) { groups.forEach { Box(Modifier.weight(1f)) { it() } } }
            else groups.forEach { it() }
            if (stats.conversations.isNotEmpty()) CacheCard("Conversations that lost the most", wide) {
                stats.conversations.take(8).forEach { row ->
                    ValueRow("${conversationLabel(row)} · ${row.projectName}", "${row.misses}× of ${row.requests}", money(row.missedCost), warn = true)
                }
            }
            if (stats.misses.isNotEmpty()) MissesCard(stats, wide)
            Text("Kept for ${stats.keptDays} days." + (stats.liveSince?.let {
                " Recorded as they run since ${DateTimeFormatter.ofPattern("MMM d, yyyy").withZone(ZoneId.systemDefault()).format(Instant.parse(it))}; earlier requests were read back from the transcripts, without what changed in each request."
            } ?: ""), style = MaterialTheme.typography.labelSmall, color = colors.fgSubtle)
        }
    }
}

@Composable
private fun CacheCard(title: String, wide: Boolean, subtitle: String? = null, icon: io.github.mitzacoder.aiki.ui.components.LucideIcon? = null, content: @Composable ColumnScope.() -> Unit) {
    var open by rememberSaveable(title) { mutableStateOf(wide) }
    val colors = Jarvis.colors
    Surface(Modifier.fillMaxWidth(), shape = RoundedCornerShape(16.dp), color = colors.surface.copy(alpha = .55f), border = BorderStroke(1.dp, colors.border)) {
        Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Row(Modifier.fillMaxWidth().heightIn(min = 32.dp).clickable { open = !open }, verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                icon?.let { LucideGlyph(it, size = 16.dp, tint = colors.accent2) }
                Text(title, style = MaterialTheme.typography.titleSmall)
                subtitle?.let { Text(it, Modifier.weight(1f), style = MaterialTheme.typography.labelSmall, color = colors.fgSubtle, maxLines = 1, overflow = TextOverflow.Ellipsis) } ?: Spacer(Modifier.weight(1f))
                LucideGlyph(if (open) Lucide.ChevronDown else Lucide.ChevronRight, size = 16.dp, tint = colors.fgSubtle, contentDescription = if (open) "Fold $title" else "Open $title")
            }
            if (open) content()
        }
    }
}

@Composable
private fun SummaryCard(stats: CacheStats) {
    val summary = summaryLines(stats)
    val bars = dayBars(stats)
    val colors = Jarvis.colors
    Surface(Modifier.fillMaxWidth(), shape = RoundedCornerShape(16.dp), color = colors.surface.copy(alpha = .55f), border = BorderStroke(1.dp, colors.border)) {
        Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Text("A provider keeps the start of a conversation for a few minutes, so the next request reads it for a fraction of the price. When that copy is gone or no longer matches, the whole prompt is billed again in full.",
                style = MaterialTheme.typography.bodySmall, color = colors.fgMuted)
            BoxWithConstraints {
                val tiles: List<Triple<String, String, Boolean>> = listOf(Triple("Spent", summary.spent, false), Triple("Reused", summary.cached, false), Triple("Billed again", summary.rebilled, stats.totals.misses > 0))
                @Composable fun Tile(tile: Triple<String, String, Boolean>, modifier: Modifier) {
                    val (label, value, warn) = tile
                    Column(modifier.clip(RoundedCornerShape(12.dp)).background(if (warn) colors.warning.copy(alpha = .10f) else colors.surface2.copy(alpha = .6f)).padding(horizontal = 12.dp, vertical = 8.dp)) {
                        Text(label, style = MaterialTheme.typography.labelSmall, color = colors.fgSubtle)
                        Text(value, style = MaterialTheme.typography.bodySmall, fontWeight = FontWeight.Medium)
                    }
                }
                if (maxWidth >= 600.dp) Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.height(IntrinsicSize.Min)) { tiles.forEach { Tile(it, Modifier.weight(1f).fillMaxHeight()) } }
                else Column(verticalArrangement = Arrangement.spacedBy(8.dp)) { tiles.forEach { Tile(it, Modifier.fillMaxWidth()) } }
            }
            stats.keepWarm?.let { Text("Keep-warm cost: ${money(it.cost)} equivalent · ${it.refreshes} refreshes · ${tokens(it.cachedTokens.toLong())} cached-input tokens. Included in spend, not requests or misses.", style = MaterialTheme.typography.bodySmall, color = colors.fgSubtle) }
            if (bars.isNotEmpty()) {
                val spent = colors.accent2.copy(alpha = .45f)
                val missed = colors.warning.copy(alpha = .8f)
                Canvas(Modifier.fillMaxWidth().height(80.dp).semantics {
                    contentDescription = "Cost per day; the amber part was billed again. " + bars.filter { it.cost > 0 }.joinToString("; ") { "${it.day}: ${money(it.cost)}, ${money(it.missedCost)} billed again" }
                }) {
                    val gap = 1.dp.toPx()
                    val width = (size.width - gap * (bars.size - 1)) / bars.size
                    bars.forEachIndexed { index, bar ->
                        val x = index * (width + gap)
                        val height = (bar.height * size.height).toFloat()
                        val radius = CornerRadius(2.dp.toPx())
                        if (height > 0) drawRoundRect(spent, Offset(x, size.height - height), Size(width, height), radius)
                        val missedHeight = (bar.missedHeight * size.height).toFloat()
                        if (missedHeight > 0) drawRoundRect(missed, Offset(x, size.height - missedHeight), Size(width, missedHeight), radius)
                    }
                }
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                    Text(bars.first().day, style = MaterialTheme.typography.labelSmall, color = colors.fgSubtle)
                    Text("Cost per day; amber was billed again", Modifier.weight(1f).padding(horizontal = 4.dp), style = MaterialTheme.typography.labelSmall, color = colors.fgSubtle,
                        textAlign = androidx.compose.ui.text.style.TextAlign.Center, maxLines = 2)
                    Text(bars.last().day, style = MaterialTheme.typography.labelSmall, color = colors.fgSubtle)
                }
            }
        }
    }
}

@Composable
private fun ReasonsCard(stats: CacheStats, wide: Boolean) {
    val colors = Jarvis.colors
    val highest = stats.byReason.maxOfOrNull { it.missedCost } ?: 0.0
    CacheCard("Why it was billed again", wide) {
        if (stats.byReason.isEmpty()) Text("Every request found its copy. Nothing was billed again.", style = MaterialTheme.typography.bodySmall, color = colors.fgMuted)
        stats.byReason.forEach { group ->
            Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(reasonLabel(group.key), Modifier.weight(1f), style = MaterialTheme.typography.bodySmall, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    Text("${group.misses}× · ${tokens(group.missedTokens)}", style = MaterialTheme.typography.labelSmall, color = colors.fgSubtle)
                    Text(money(group.missedCost), style = MaterialTheme.typography.bodySmall, fontWeight = FontWeight.Medium)
                }
                Box(Modifier.fillMaxWidth().height(6.dp).clip(RoundedCornerShape(3.dp)).background(colors.surface2)) {
                    Box(Modifier.fillMaxWidth(if (highest > 0) (group.missedCost / highest).toFloat() else 0f).fillMaxHeight().clip(RoundedCornerShape(3.dp)).background(colors.warning.copy(alpha = .8f)))
                }
                CACHE_REASONS[group.key]?.let { Text(it.detail, style = MaterialTheme.typography.labelSmall, color = colors.fgSubtle) }
            }
        }
    }
}

@Composable
private fun WakesCard(stats: CacheStats, wide: Boolean) {
    val colors = Jarvis.colors
    val wakes = stats.byWake.filter { it.wake != "continue" }
    CacheCard("What woke the agents", wide) {
        if (wakes.isEmpty()) { Text("No requests in this range.", style = MaterialTheme.typography.bodySmall, color = colors.fgMuted); return@CacheCard }
        @Composable fun Cells(first: String, times: String, each: String, again: String, header: Boolean) {
            val style = if (header) MaterialTheme.typography.labelSmall else MaterialTheme.typography.bodySmall
            val color = if (header) colors.fgSubtle else colors.fg
            Row(Modifier.fillMaxWidth().padding(vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                Text(first, Modifier.weight(1f), style = style, color = color)
                Text(times, Modifier.width(52.dp), style = style, color = color, textAlign = androidx.compose.ui.text.style.TextAlign.End)
                Text(each, Modifier.width(60.dp), style = style, color = color, textAlign = androidx.compose.ui.text.style.TextAlign.End)
                Text(again, Modifier.width(76.dp), style = style, color = color, textAlign = androidx.compose.ui.text.style.TextAlign.End)
            }
        }
        Cells("Woken by", "Times", "Each", "Billed again", header = true)
        wakes.forEach { wake ->
            HorizontalDivider(color = colors.border.copy(alpha = .6f))
            Cells(wakeLabel(wake.wake), wake.wakes.toString(), money(if (wake.wakes > 0) wake.turnCost / wake.wakes else 0.0), if (wake.misses > 0) money(wake.missedCost) else "—", header = false)
        }
    }
}

@Composable
private fun ValueRow(label: String, cost: String, missed: String?, warn: Boolean) {
    val colors = Jarvis.colors
    Row(Modifier.fillMaxWidth().padding(vertical = 3.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(label, Modifier.weight(1f), style = MaterialTheme.typography.bodySmall, maxLines = 1, overflow = TextOverflow.Ellipsis)
        Text(cost, style = MaterialTheme.typography.labelSmall, color = colors.fgSubtle)
        Text(missed ?: "—", Modifier.widthIn(min = 56.dp), style = MaterialTheme.typography.bodySmall, color = if (warn && missed != null) colors.warning else colors.fgSubtle,
            textAlign = androidx.compose.ui.text.style.TextAlign.End)
    }
}

@Composable
private fun GroupCard(title: String, groups: List<CacheGroup>, wide: Boolean, label: (CacheGroup) -> String) {
    if (groups.isEmpty()) return
    CacheCard(title, wide) {
        groups.take(8).forEachIndexed { index, group ->
            if (index > 0) HorizontalDivider(color = Jarvis.colors.border.copy(alpha = .6f))
            Box(Modifier.semantics(mergeDescendants = true) { contentDescription = "${label(group)}: ${money(group.cost)}, billed again ${percent(group.missedCost, group.cost)} of the cost" }) {
                ValueRow(label(group), money(group.cost), if (group.missedCost > 0) money(group.missedCost) else null, warn = true)
            }
        }
    }
}

private val missTime = DateTimeFormatter.ofPattern("MMM d, HH:mm").withZone(ZoneId.systemDefault())

@Composable
private fun MissesCard(stats: CacheStats, wide: Boolean) {
    val colors = Jarvis.colors
    var all by rememberSaveable { mutableStateOf(false) }
    CacheCard("The costliest misses", wide, subtitle = "${stats.misses.size} of ${stats.totals.misses}, newest first") {
        (if (all) stats.misses else stats.misses.take(SHORT_LIST)).forEachIndexed { index, miss ->
            if (index > 0) HorizontalDivider(color = colors.border.copy(alpha = .6f))
            var open by rememberSaveable("${miss.projectId}:${miss.conversationId}:${miss.at}") { mutableStateOf(false) }
            Column(Modifier.fillMaxWidth().clickable { open = !open }.padding(vertical = 6.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Row(verticalAlignment = Alignment.Top, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    LucideGlyph(if (open) Lucide.ChevronDown else Lucide.ChevronRight, Modifier.padding(top = 2.dp), size = 14.dp, tint = colors.fgSubtle)
                    Column(Modifier.weight(1f)) {
                        Text(runCatching { missTime.format(Instant.parse(miss.at)) }.getOrDefault(miss.at), style = MaterialTheme.typography.labelSmall, color = colors.fgSubtle)
                        Text("${missHeadline(miss)} · ${conversationLabel(miss)} · ${miss.projectName}", style = MaterialTheme.typography.bodySmall)
                    }
                    Column(horizontalAlignment = Alignment.End) {
                        Text(money(miss.missedCost), style = MaterialTheme.typography.bodySmall, color = colors.warning)
                        Text(tokens(miss.missedTokens), style = MaterialTheme.typography.labelSmall, color = colors.fgSubtle)
                    }
                }
                if (open) Column(Modifier.padding(start = 22.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Text("${tokens(miss.missedTokens)} tokens billed again on ${miss.model}, woken by ${wakePhrase(miss.wake)}. ${CACHE_REASONS[miss.reason]?.detail.orEmpty()}".trim(),
                        style = MaterialTheme.typography.labelSmall, color = colors.fgMuted)
                    Text("What changed in the request:", style = MaterialTheme.typography.labelSmall, color = colors.fgSubtle)
                    changeLines(miss.changes).forEach { Text("•  $it", style = MaterialTheme.typography.labelSmall, color = colors.fgMuted) }
                    Text(exactTime(miss.at), style = MaterialTheme.typography.labelSmall, color = colors.fgSubtle)
                }
            }
        }
        if (stats.misses.size > SHORT_LIST) TextButton(onClick = { all = !all }) { Text(if (all) "Show fewer" else "Show all ${stats.misses.size}") }
    }
}
