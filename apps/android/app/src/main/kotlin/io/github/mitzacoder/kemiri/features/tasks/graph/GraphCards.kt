package io.github.mitzacoder.kemiri.features.tasks.graph

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.runtime.key
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.*
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import io.github.mitzacoder.kemiri.ui.theme.Jarvis

@Composable
internal fun graphTone(status: String): Color = when (status) {
    "in_progress" -> Jarvis.colors.accent1
    "review" -> Jarvis.colors.accent2
    "blocked" -> Jarvis.colors.danger
    "waiting" -> Jarvis.colors.warning
    else -> Jarvis.colors.fgMuted
}

internal fun graphTaskLabel(d: GraphTask, now: Long): String = buildList {
    add("${d.task.id}, ${d.task.title}, ${graphStatus(d.task.status).label}")
    addAll(d.reasons.map { reason -> graphReasons.first { it.key == reason }.label })
    if (d.quiet) add(graphQuietAge(d.task.updatedAt, now))
    add(d.progress)
    addAll(d.workers.map { "Worker ${it.id}, ${it.status}" })
    addAll(d.threads.filter { !it.main && !it.archived }.map { "Thread ${it.title}, ${it.status}" })
}.joinToString(". ")

@Composable
internal fun GraphTaskCard(d: GraphTask, depth: Int, selected: Boolean, matches: Boolean, holdsUp: Int, now: Long, updated: Boolean = false, motion: Boolean = false, reports: Set<String> = emptySet(), onSelect: () -> Unit) {
    val colors = Jarvis.colors
    val tone = graphTone(d.task.status)
    val guide = colors.fgMuted
    val shape = RoundedCornerShape(18.dp)
    val status = graphStatus(d.task.status)
    val largeText = LocalDensity.current.fontScale > 1.3f
    val crew = d.workers.map { it.status } + d.threads.filter { !it.main && !it.archived }.map { it.status }
    Box(Modifier.fillMaxWidth().padding(top = if (crew.isEmpty()) 0.dp else 28.dp, start = depth.coerceAtMost(4).times(10).dp).drawBehind {
        if (depth > 0) drawLine(guide, Offset(2.dp.toPx(), 0f), Offset(2.dp.toPx(), size.height), 1.dp.toPx())
    }.padding(start = if (depth > 0) 10.dp else 0.dp)) {
        Column(
            Modifier.fillMaxWidth().border(if (selected) 3.dp else 1.dp, if (selected) colors.fg else if (matches) tone else colors.border, shape)
                .background(if (matches) tone.copy(alpha = if (updated && motion) .28f else .10f) else colors.surface2, shape)
                .clickable(role = Role.Button, onClickLabel = "Show task details", onClick = onSelect)
                .semantics(mergeDescendants = true) { contentDescription = graphTaskLabel(d, now); this.selected = selected }
                .padding(14.dp), verticalArrangement = Arrangement.spacedBy(7.dp),
        ) {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.size(8.dp, 24.dp).background(if (matches) tone else colors.fgMuted, RoundedCornerShape(4.dp)))
                Text(d.task.id, color = colors.fg, style = MaterialTheme.typography.labelLarge)
                Text("${status.mark} ${status.label}", color = colors.fg, style = MaterialTheme.typography.labelLarge, modifier = Modifier.weight(1f))
            }
            if (updated) Text("Updated", color = colors.fg, style = MaterialTheme.typography.labelMedium)
            Text(d.task.title, maxLines = 2, overflow = TextOverflow.Ellipsis, color = colors.fg, style = MaterialTheme.typography.titleMedium)
            if (d.reasons.isNotEmpty()) Text(d.reasons.joinToString(" · ") { reason ->
                val entry = graphReasons.first { it.key == reason }
                "${entry.mark} ${entry.label}" + if (reason == "waiting") " ${graphWaitingDate(d.task.waiting?.until, now)}" else ""
            }, color = colors.fg, style = MaterialTheme.typography.bodyMedium)
            if (d.quiet) Text("◴ ${graphQuietAge(d.task.updatedAt, now)}", color = colors.fg, style = MaterialTheme.typography.bodyMedium)
            if (d.children.isNotEmpty()) Text(d.progress, color = colors.fg, style = MaterialTheme.typography.bodyMedium)
            if (holdsUp > 0) Text("⊣ holds up $holdsUp", color = colors.fg, style = MaterialTheme.typography.bodyMedium)
        }
        Row(Modifier.align(Alignment.TopEnd).offset(y = (-28).dp).padding(end = 12.dp)) {
            val members = d.workers.map { Triple("worker:${it.id}", it.status, it.id) } + d.threads.filter { !it.main && !it.archived }.map { Triple("thread:${it.id}", it.status, it.id) }
            members.take(3).forEach { (id, status, _) -> key(id, id in reports) { GraphCreature(status, tone, motion, id in reports) } }
            if (members.size > 3) Text("+${members.size - 3}", color = colors.fg)
        }
    }
}

@Composable
internal fun GraphFamilyHeader(family: GraphFamily, model: GraphModel) {
    val colors = Jarvis.colors
    Column(Modifier.fillMaxWidth().background(colors.surface2, RoundedCornerShape(18.dp)).padding(12.dp), verticalArrangement = Arrangement.spacedBy(5.dp)) {
        Text(family.title, color = colors.fg, style = MaterialTheme.typography.titleMedium, modifier = Modifier.semantics { heading() })
        Text("${family.progress} · ${family.needsYou} need you", color = colors.fg, style = MaterialTheme.typography.bodySmall)
        Row(Modifier.fillMaxWidth().height(6.dp).clearAndSetSemantics { }) {
            graphStatuses.forEach { status ->
                val count = family.cards.count { model.details[it.id]?.task?.status == status.key }
                if (count > 0) Box(Modifier.weight(count.toFloat()).fillMaxHeight().background(graphTone(status.key)))
            }
        }
    }
}
