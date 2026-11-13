package io.github.mitzacoder.kemiri.features.usage

import androidx.compose.foundation.BorderStroke
import io.github.mitzacoder.kemiri.features.settings.*
import io.github.mitzacoder.kemiri.ui.components.*
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.*
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.semantics.*
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.repeatOnLifecycle
import io.github.mitzacoder.kemiri.data.*
import io.github.mitzacoder.kemiri.protocol.*
import kotlinx.coroutines.delay
import io.github.mitzacoder.kemiri.ui.theme.LocalJarvisColors
import kotlin.math.*

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun UsageScreen(repository: HarnessRepository, modifier: Modifier = Modifier) {
    val sessions by repository.sessions.collectAsStateWithLifecycle()
    var now by remember { mutableDoubleStateOf(System.currentTimeMillis().toDouble()) }
    val owner = LocalLifecycleOwner.current
    LaunchedEffect(owner) { owner.lifecycle.repeatOnLifecycle(Lifecycle.State.STARTED) { while(true) { now = System.currentTimeMillis().toDouble(); delay(15000) } } }
    val watches = sessions.map { backend -> key(backend) { backend to remember(backend) { UsageWatch(backend.client) } } }
    // Read every state before aggregating, so short-circuiting cannot drop a backend's subscription.
    val loading = watches.map { (_, watch) -> watch.state.collectAsStateWithLifecycle().value.loading }.any { it }
    PullToRefreshBox(isRefreshing = loading, onRefresh = {
        watches.forEach { (_, watch) -> if (!watch.state.value.loading) watch.refresh() }
    }, modifier = modifier.fillMaxSize()) {
    Column(Modifier.fillMaxSize().wrapContentWidth().widthIn(max = 1200.dp).verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(20.dp)) {
        Text("Subscription usage", style = MaterialTheme.typography.headlineSmall)
        Text("Your subscription limits, not API billing. The outer arc is usage; the inner arc is time passed.", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        if(sessions.isEmpty()) Text("Add a backend in Settings to see its subscription usage.")
        watches.forEach { (backend, watch) -> key(backend) { BackendUsage(backend, watch, now) } }
    }
    }
}

@Composable
private fun BackendUsage(backend: BackendSession, watch: UsageWatch, now: Double) {
    val connection by backend.client.state.collectAsStateWithLifecycle()
    val state by watch.state.collectAsStateWithLifecycle()
    val owner = LocalLifecycleOwner.current
    LaunchedEffect(watch, owner) { owner.lifecycle.repeatOnLifecycle(Lifecycle.State.STARTED) { watch.observe() } }
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text(backend.config.name, style = MaterialTheme.typography.titleLarge)
                Text(backend.config.url, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            SettingsAction("Refresh usage", SettingsGlyphs.Refresh, enabled = connection.status == ConnectionStatus.Ready && connection.supports("subscription-usage") && !state.loading, onClick = watch::refresh)
        }
        when {
            connection.status != ConnectionStatus.Ready -> Text("${connectionLabel(connection.status, connection.attempt)} · showing last available readings", color = MaterialTheme.colorScheme.onSurfaceVariant)
            !connection.supports("subscription-usage") -> Text("This backend does not support subscription usage.")
        }
        state.error?.let { Text("Refresh failed: $it. Previous readings are retained.", color = MaterialTheme.colorScheme.error) }
        if(state.loading) LinearProgressIndicator(Modifier.fillMaxWidth())
        if(state.loaded && state.subscriptions.isEmpty()) io.github.mitzacoder.kemiri.features.settings.UsageEmptyNote()
        val tightest = state.subscriptions.flatMap { s -> s.windows.map { Triple(s, it, windowPace(it, now)) } }
            .filter { it.third.usedPercent != null }
            .sortedWith(compareByDescending<Triple<SubscriptionUsage, UsageWindow, WindowPace>> { pressure(it.third) }.thenBy { it.third.exhaustsAt ?: Double.POSITIVE_INFINITY }).firstOrNull()
        tightest?.let { (s, w, p) -> Surface(color = toneColor(paceTone(p)).copy(alpha = .10f), shape = MaterialTheme.shapes.medium) {
            Row(Modifier.fillMaxWidth().padding(16.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                UsageGauge(p, toneColor(paceTone(p)))
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text("TIGHTEST · ${s.label} · ${w.label}", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    Text(paceDetail(p), style = MaterialTheme.typography.titleSmall)
                    SettingsBadge(paceTitle(p), toneColor(paceTone(p)))
                }
            }
        } }
        state.subscriptions.forEach { subscription -> key(subscription.providerId) { ProviderUsage(subscription, now, backend, watch::refresh) } }
        if (connection.supports(HarnessFeature.CACHE_STATS)) BoxWithConstraints { CacheSection(backend, wide = maxWidth >= 600.dp) }
    }
}

@Composable
private fun ProviderUsage(s: SubscriptionUsage, now: Double, backend: BackendSession, onRefresh: () -> Unit) {
    OutlinedCard(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(4.dp), itemVerticalAlignment = Alignment.CenterVertically) {
                Text(s.label, style = MaterialTheme.typography.titleMedium)
                s.plan?.let { SettingsBadge(it, MaterialTheme.colorScheme.primary) }
            }
            s.account?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
            val updated = parseTime(s.updatedAt)
            val stale = updated != null && now - updated > 900000
            Text("${if(updated == null) "Never updated" else "Updated ${formatDuration(now - updated)} ago"}${if(stale) " · Stale reading" else ""}", color = if(stale) LocalJarvisColors.current.warning else MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.labelMedium)
            Text(when(s.source) { "usage_api" -> "From the provider’s usage endpoint"; "response_headers" -> "From rate-limit headers of recent replies"; "none" -> "The provider reports no limits"; else -> s.source }, style = MaterialTheme.typography.bodySmall)
            s.error?.let { Surface(color = LocalJarvisColors.current.warning.copy(alpha = .1f), shape = MaterialTheme.shapes.small) {
                Text("The last read failed${if (s.windows.isNotEmpty()) " — these are the numbers from before" else ""}: $it", Modifier.padding(12.dp), style = MaterialTheme.typography.bodySmall)
            } }
            if(s.windows.isEmpty()) Text(if (s.source == "none") "This provider reports no limits for the plan." else "No limits read yet.", style = MaterialTheme.typography.bodySmall)
            BoxWithConstraints {
                val columns = if(maxWidth >= 640.dp) 2 else 1
                Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    s.windows.chunked(columns).forEach { row -> Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        row.forEach { window -> WindowUsage(window, now, Modifier.weight(1f)) }
                        if(row.size < columns) Spacer(Modifier.weight(1f))
                    } }
                }
            }
            SubscriptionResets(s, backend, onRefresh)
        }
    }
}

@Composable
private fun WindowUsage(w: UsageWindow, now: Double, modifier: Modifier) {
    val p = windowPace(w, now)
    val color = toneColor(paceTone(p))
    Surface(modifier, color = LocalJarvisColors.current.surface, shape = MaterialTheme.shapes.medium, border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant)) {
        Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                UsageGauge(p, color)
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Text(w.label, style = MaterialTheme.typography.titleMedium)
                    w.windowMinutes?.let { Text("${formatDuration(it * 60000.0)} window", style = MaterialTheme.typography.labelSmall) }
                    SettingsBadge(paceTitle(p), color, if (p.kind == PaceKind.Exhausted) Lucide.CircleAlert else Lucide.Clock)
                    Text(paceDetail(p), style = MaterialTheme.typography.bodySmall)
                }
            }
            Text(p.resetsAt?.let { if(it - now < 60000) "Resetting now · ${clockTime(it)}" else "Resets in ${formatDuration(it - now)} · ${clockTime(it)}" } ?: "Reset time unknown", style = MaterialTheme.typography.labelMedium)
            HistoryChart(w, p, now, color)
        }
    }
}

@Composable
private fun toneColor(tone: PaceTone): Color = when(tone) {
    PaceTone.Danger -> LocalJarvisColors.current.danger
    PaceTone.Warn -> LocalJarvisColors.current.warning
    PaceTone.Good -> LocalJarvisColors.current.success
    PaceTone.Calm -> MaterialTheme.colorScheme.primary
    PaceTone.Muted -> MaterialTheme.colorScheme.onSurfaceVariant
}

@Composable
private fun UsageGauge(p: WindowPace, color: Color) {
    val tokens = LocalJarvisColors.current
    val track = tokens.surface2
    val time = MaterialTheme.colorScheme.onSurfaceVariant
    Box(Modifier.size(100.dp).semantics(mergeDescendants = true) { contentDescription = "${percentLabel(p.usedPercent)} used; ${p.elapsedShare?.let { percentLabel(it * 100) } ?: "unknown"} of window passed" }, contentAlignment = Alignment.Center) {
        Canvas(Modifier.fillMaxSize()) {
            val outer = size.width * .42f
            val inner = size.width * .32f
            fun arc(radius: Float, sweep: Float, c: Color, stroke: Float) = drawArc(c, 135f, sweep, false, Offset(center.x - radius, center.y - radius), Size(radius * 2, radius * 2), style = Stroke(stroke, cap = StrokeCap.Round))
            arc(outer, 270f, track, 8.dp.toPx())
            p.usedPercent?.let { if(it > 0) drawArc(
                brush = Brush.linearGradient(if (paceTone(p) == PaceTone.Calm) listOf(tokens.accent1, tokens.accent2, tokens.accent3) else listOf(color.copy(alpha = .65f), color)),
                startAngle = 135f, sweepAngle = (it / 100).coerceIn(0.0, 1.0).toFloat() * 270, useCenter = false,
                topLeft = Offset(center.x - outer, center.y - outer), size = Size(outer * 2, outer * 2), style = Stroke(8.dp.toPx(), cap = StrokeCap.Round)
            ) }
            arc(inner, 270f, track, 2.dp.toPx())
            p.elapsedShare?.let {
                arc(inner, it.toFloat() * 270, time, 2.dp.toPx())
                val rad = Math.toRadians(135 + it * 270)
                fun point(r: Float) = center + Offset(cos(rad).toFloat() * r, sin(rad).toFloat() * r)
                drawCircle(time, 3.dp.toPx(), point(inner))
                drawLine(time, point(outer - 7.dp.toPx()), point(outer + 7.dp.toPx()), 1.5.dp.toPx())
            }
        }
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Text(percentLabel(p.usedPercent), style = MaterialTheme.typography.titleLarge)
            Text("used", style = MaterialTheme.typography.labelSmall)
        }
        Text(p.elapsedShare?.let { "${percentLabel(it * 100)} of time" } ?: "Time unknown", Modifier.align(Alignment.BottomCenter), style = MaterialTheme.typography.labelSmall)
    }
}

@Composable
private fun HistoryChart(w: UsageWindow, p: WindowPace, now: Double, color: Color) {
    val grid = MaterialTheme.colorScheme.outlineVariant
    val muted = MaterialTheme.colorScheme.onSurfaceVariant
    val geometry = usageChart(w, now, 300.0, 72.0)
    Box(Modifier.fillMaxWidth().height(72.dp).semantics { contentDescription = "Usage history: ${w.samples.size} samples. ${paceDetail(p)}" }, contentAlignment = Alignment.Center) {
        Canvas(Modifier.fillMaxSize().padding(vertical = 6.dp)) {
            fun pt(p: ChartPoint) = Offset((p.x / 300 * size.width).toFloat(), (p.y / 72 * size.height).toFloat())
            fun segment(s: ChartSegment, c: Color, dash: FloatArray) = drawLine(c, pt(s.from), pt(s.to), 1.5.dp.toPx(), pathEffect = PathEffect.dashPathEffect(dash))
            val limitY = (geometry.limitY / 72 * size.height).toFloat()
            drawLine(grid, Offset(0f, limitY), Offset(size.width, limitY))
            drawLine(grid, Offset(0f, size.height), Offset(size.width, size.height))
            geometry.evenPace?.let { segment(it, muted, floatArrayOf(8f, 8f)) }
            if(geometry.points.isNotEmpty()) {
                val line = Path().apply { geometry.points.forEachIndexed { i, p -> val o = pt(p); if(i == 0) moveTo(o.x, o.y) else lineTo(o.x, o.y) } }
                val area = Path().apply { addPath(line); lineTo(pt(geometry.points.last()).x, size.height); lineTo(pt(geometry.points.first()).x, size.height); close() }
                drawPath(area, Brush.verticalGradient(listOf(color.copy(alpha = .28f), color.copy(alpha = .02f))))
                drawPath(line, color, style = Stroke(2.dp.toPx(), cap = StrokeCap.Round, join = StrokeJoin.Round))
                drawCircle(color, 3.dp.toPx(), pt(geometry.points.last()))
            }
            geometry.projection?.let { segment(it, color, floatArrayOf(4f, 8f)) }
            geometry.nowX?.let { val x = (it / 300 * size.width).toFloat(); drawLine(muted.copy(alpha = .5f), Offset(x, 0f), Offset(x, size.height), pathEffect = PathEffect.dashPathEffect(floatArrayOf(2f, 6f))) }
        }
        if(geometry.points.isEmpty()) Text("No history yet", style = MaterialTheme.typography.labelSmall)
    }
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
        Text(p.startsAt?.let(::clockTime) ?: "First sample", style = MaterialTheme.typography.labelSmall)
        Text(p.resetsAt?.let(::clockTime) ?: "Now", style = MaterialTheme.typography.labelSmall)
    }
    Text("━ Used   ┄ Even pace   ··· At this rate", style = MaterialTheme.typography.labelSmall, color = muted)
}
