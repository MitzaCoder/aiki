package com.mihaisaru.harness.features.tasks

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.ui.semantics.Role
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import com.mihaisaru.harness.features.chat.RichMarkdown
import com.mihaisaru.harness.navigation.ProjectScreenContext
import com.mihaisaru.harness.protocol.BoardTask
import com.mihaisaru.harness.protocol.BoardTaskSnapshot
import com.mihaisaru.harness.protocol.BoardWriter
import com.mihaisaru.harness.ui.components.Lucide
import com.mihaisaru.harness.ui.components.LucideGlyph
import com.mihaisaru.harness.ui.components.TaskStatusBadge
import com.mihaisaru.harness.ui.theme.Jarvis
import com.mihaisaru.harness.ui.theme.Text as TextStyles
import kotlinx.coroutines.CancellationException

/**
 * A task's snapshots, one at a time (web `TaskHistory.svelte`): step with the arrows, then read what changed in that
 * snapshot (against the one before it, or against the task as it is now) or the task as it was. Read when it opens, and
 * again when a new snapshot is saved while it is open.
 */
@Composable
internal fun TaskHistory(context: ProjectScreenContext, task: BoardTask, writerName: (BoardWriter) -> String) {
    val colors = Jarvis.colors
    var snapshots by remember(task.id) { mutableStateOf<List<BoardTaskSnapshot>?>(null) }
    var error by remember(task.id) { mutableStateOf<String?>(null) }
    var selectedSeq by rememberSaveable(task.id) { mutableStateOf<Long?>(null) }
    var againstNow by rememberSaveable(task.id) { mutableStateOf(false) }
    var asItWas by rememberSaveable(task.id) { mutableStateOf(false) }
    LaunchedEffect(task.id, task.snapshots) {
        try {
            snapshots = context.board.history(task.id)
            error = null
        } catch (cause: CancellationException) { throw cause }
        catch (cause: Exception) { error = cause.message ?: "Could not read the history" }
    }
    val list = snapshots.orEmpty()
    val found = list.indexOfFirst { it.seq == selectedSeq }
    val index = if (found == -1) list.lastIndex else found
    val snapshot = list.getOrNull(index)
    val before = if (index > 0) list[index - 1] else null
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        when {
            error != null -> Text(error.orEmpty(), style = TaskType.xs, color = colors.danger)
            snapshots == null -> Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Box(Modifier.fillMaxWidth().height(28.dp).background(colors.surface2, RoundedCornerShape(6.dp)))
                Box(Modifier.fillMaxWidth(.66f).height(12.dp).background(colors.surface2, RoundedCornerShape(4.dp)))
                Box(Modifier.fillMaxWidth().height(80.dp).background(colors.surface2, RoundedCornerShape(6.dp)))
            }
            snapshot == null -> Text("Nothing saved yet. A snapshot is saved at each milestone and each status change.", style = TaskType.xs, color = colors.fgSubtle)
            else -> {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    IconButton(onClick = { selectedSeq = list[index - 1].seq }, enabled = index > 0) {
                        LucideGlyph(TaskIcons.ChevronLeft, size = 18.dp, contentDescription = "Earlier snapshot")
                    }
                    Column(Modifier.weight(1f), horizontalAlignment = Alignment.CenterHorizontally) {
                        Text(snapshot.label, style = TextStyles.task.copy(fontWeight = FontWeight.Medium), color = colors.fg, textAlign = TextAlign.Center)
                        Text("${index + 1} of ${list.size} · ${relativeTime(snapshot.at)} · ${writerName(snapshot.by)}", style = TaskType.meta, color = colors.fgSubtle, textAlign = TextAlign.Center)
                    }
                    IconButton(onClick = { selectedSeq = list[index + 1].seq }, enabled = index < list.lastIndex) {
                        LucideGlyph(Lucide.ChevronRight, size = 18.dp, contentDescription = "Later snapshot")
                    }
                }
                FlowRow(horizontalArrangement = Arrangement.spacedBy(12.dp), verticalArrangement = Arrangement.spacedBy(6.dp), itemVerticalAlignment = Alignment.CenterVertically) {
                    // What to show: a small two-way switch, like the web's.
                    Row(Modifier.border(1.dp, colors.border, RoundedCornerShape(10.dp)).padding(2.dp).selectableGroup()) {
                        listOf(false to "What changed", true to "As it was").forEach { (value, name) ->
                            val selected = asItWas == value
                            Text(
                                name,
                                Modifier.clip(RoundedCornerShape(8.dp)).background(if (selected) colors.surface2 else colors.surface2.copy(alpha = 0f))
                                    .selectable(selected, role = Role.Tab) { asItWas = value }
                                    .heightIn(min = 36.dp).wrapContentHeight().padding(horizontal = 10.dp),
                                style = if (selected) TaskType.xsMedium else TaskType.xs,
                                color = if (selected) colors.fg else colors.fgSubtle,
                            )
                        }
                    }
                    if (!asItWas) Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        Text("Compared with", style = TaskType.xs, color = colors.fgSubtle)
                        var menu by remember { mutableStateOf(false) }
                        Box {
                            OutlinedButton(onClick = { menu = true }, contentPadding = PaddingValues(horizontal = 10.dp), modifier = Modifier.heightIn(min = 36.dp)) {
                                Text(if (againstNow) "the task now" else if (before == null) "nothing before it" else "the snapshot before", style = TaskType.xs)
                                Spacer(Modifier.width(4.dp))
                                LucideGlyph(Lucide.ChevronDown, size = 14.dp)
                            }
                            DropdownMenu(menu, { menu = false }) {
                                DropdownMenuItem(text = { Text(if (before == null) "nothing before it" else "the snapshot before") }, onClick = { againstNow = false; menu = false })
                                DropdownMenuItem(text = { Text("the task now") }, onClick = { againstNow = true; menu = false })
                            }
                        }
                    }
                }
                if (asItWas) AsItWas(snapshot)
                else {
                    val changes = if (againstNow) taskChanges(snapshot.state(), task.state()) else taskChanges(before?.state(), snapshot.state())
                    if (!changes.any) Text(
                        if (againstNow) "The task says the same as it did then." else "Nothing differs from the snapshot before.",
                        style = TaskType.xs, color = colors.fgSubtle,
                    )
                    else Changes(changes)
                }
            }
        }
    }
}

@Composable
private fun Changes(changes: TaskChanges) {
    val colors = Jarvis.colors
    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        changes.title?.let { title ->
            Text(buildAnnotatedString {
                withStyle(SpanStyle(fontWeight = FontWeight.SemiBold, color = colors.fg)) { append("Title ") }
                withStyle(SpanStyle(color = colors.fgSubtle, textDecoration = TextDecoration.LineThrough)) { append(title.from) }
                append(" → ${title.to}")
            }, style = TaskType.xs, color = colors.fgMuted)
        }
        changes.status?.let { status ->
            FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), itemVerticalAlignment = Alignment.CenterVertically) {
                Text("Status", style = TaskType.xsSemibold, color = colors.fg)
                TaskStatusBadge(status.from)
                Text("→", style = TaskType.xs, color = colors.fgMuted)
                TaskStatusBadge(status.to)
            }
        }
        changes.sections.forEach { section ->
            Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text(section.label, style = TaskType.xsSemibold, color = colors.fg)
                val shape = RoundedCornerShape(8.dp)
                Column(Modifier.fillMaxWidth().clip(shape).border(1.dp, colors.border, shape)) {
                    section.lines.forEach { line ->
                        when (line) {
                            is UnchangedLines -> Text(
                                "${line.count} unchanged ${if (line.count == 1) "line" else "lines"}",
                                Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 2.dp),
                                style = TaskType.xs.copy(fontStyle = FontStyle.Italic, lineHeight = TextStyles.sm.lineHeight), color = colors.fgSubtle,
                            )
                            is DiffLine -> {
                                val added = line.kind == DiffLine.Kind.Added
                                Row(
                                    Modifier.fillMaxWidth()
                                        .background(if (added) colors.success.copy(alpha = .12f) else colors.danger.copy(alpha = .10f))
                                        .padding(horizontal = 8.dp, vertical = 2.dp)
                                        .semantics(mergeDescendants = true) { contentDescription = "${if (added) "Added" else "Removed"}: ${line.text}" },
                                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                                ) {
                                    Text(if (added) "+" else "−", Modifier.width(12.dp), style = TaskType.xs, color = if (added) colors.fg else colors.fgMuted, textAlign = TextAlign.Center)
                                    Text(line.text, Modifier.weight(1f), style = TaskType.xs.copy(lineHeight = TextStyles.sm.lineHeight), color = if (added) colors.fg else colors.fgMuted)
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun AsItWas(snapshot: BoardTaskSnapshot) {
    val colors = Jarvis.colors
    Column(
        Modifier.fillMaxWidth().border(1.dp, colors.border, RoundedCornerShape(12.dp)).padding(horizontal = 12.dp, vertical = 10.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), itemVerticalAlignment = Alignment.CenterVertically) {
            Text(snapshot.title, style = TaskType.rowTitle.copy(fontSize = TaskType.sectionTitle.fontSize), color = colors.fg)
            TaskStatusBadge(snapshot.status)
        }
        ReportSection.entries.forEach { section ->
            val text = snapshot.report.section(section)
            if (text.isNotBlank()) Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text(section.label, style = TaskType.xsSemibold, color = colors.fgMuted)
                ReportMarkdown(text)
            }
        }
    }
}

/** Report text: Markdown at the task size. */
@Composable
internal fun ReportMarkdown(text: String) {
    ProvideTextStyle(TextStyles.task) { RichMarkdown(text) }
}
