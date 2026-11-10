package io.github.mitzacoder.aiki.features.refs

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.github.mitzacoder.aiki.features.tasks.taskStatusTone
import io.github.mitzacoder.aiki.protocol.BoardTask
import io.github.mitzacoder.aiki.protocol.ProjectLinks
import io.github.mitzacoder.aiki.protocol.RefDetails
import io.github.mitzacoder.aiki.protocol.RefDetailsIssue
import io.github.mitzacoder.aiki.protocol.RefDetailsJira
import io.github.mitzacoder.aiki.protocol.RefDetailsPull
import io.github.mitzacoder.aiki.protocol.RefStatus
import io.github.mitzacoder.aiki.ui.components.Lucide
import io.github.mitzacoder.aiki.ui.components.LucideGlyph
import io.github.mitzacoder.aiki.ui.components.TaskStatusDot
import io.github.mitzacoder.aiki.ui.theme.Jarvis
import io.github.mitzacoder.aiki.ui.theme.TaskStatusTone
import io.github.mitzacoder.aiki.ui.theme.textStyle

/**
 * A ticket or pull request's card as a bottom sheet (web `RefCard.svelte`, opened by a tap as on the web's touch
 * screens): what it is and where it stands, then the details the backend read (a pull request's branches, checks,
 * reviews and size; an issue's people and labels; a ticket's people, parent and sprint), the tasks that name it and the
 * way out to GitHub or Jira. Without details (no `ref-details`, no tool or login) it says what is known: the label, the
 * link and the state last read for the board, never an error.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun RefCardSheet(
    card: ShownCard,
    links: ProjectLinks?,
    tasks: List<BoardTask>,
    statuses: (String) -> RefStatus?,
    details: RefDetailsCache,
    detailsSupported: Boolean,
    canOpenTasks: Boolean,
    openTask: (String) -> Unit,
    openAddress: (String) -> Unit,
    onDismiss: () -> Unit,
) {
    val identity = refIdentity(card.ref)
    LaunchedEffect(identity, detailsSupported) { if (detailsSupported) details.load(identity, card.href) }
    val known by details.known.collectAsStateWithLifecycle()
    val loading by details.loading.collectAsStateWithLifecycle()
    val read = known[identity]?.details
    val status = remember(card.ref, tasks, links, statuses) {
        boardRefFor(card.ref, tasks.flatMap { it.refs }, links)?.let(statuses)
    }
    val naming = remember(card.ref, tasks, links) { tasksNaming(card.ref, tasks, links) }
    val href = when (read) { is RefDetailsPull -> read.url; is RefDetailsIssue -> read.url; is RefDetailsJira -> read.url; else -> null }
        ?: status?.url ?: card.href
    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true), containerColor = Jarvis.colors.surface) {
        RefCardContent(card.ref, read, status, loading = read == null && identity in loading, naming, canOpenTasks, href, openTask, openAddress,
            Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(start = 20.dp, end = 20.dp, bottom = 24.dp))
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun RefCardContent(
    ref: ResolvedRef,
    details: RefDetails?,
    status: RefStatus?,
    loading: Boolean,
    tasks: List<BoardTask>,
    canOpenTasks: Boolean,
    href: String,
    openTask: (String) -> Unit,
    openAddress: (String) -> Unit,
    modifier: Modifier,
) {
    val colors = Jarvis.colors
    val now = remember { System.currentTimeMillis() }
    val state = cardState(details, status)
    val pullState = cardPullState(details, status)
    val title = when (details) { is RefDetailsPull -> details.title; is RefDetailsIssue -> details.title; is RefDetailsJira -> details.title; else -> null }
        ?.takeIf { it.isNotEmpty() } ?: status?.title.orEmpty()
    val small = textStyle(0.8125f, 1.25f / 0.8125f)
    Column(modifier, verticalArrangement = Arrangement.spacedBy(14.dp)) {
        Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                val icon = when {
                    ref is ResolvedRef.Jira -> RefIcons.Ticket
                    pullState == "merged" -> RefIcons.GitMerge
                    pullState == "closed" -> RefIcons.GitPullRequestClosed
                    pullState == "draft" -> RefIcons.GitPullRequestDraft
                    pullState == "open" || (ref as? ResolvedRef.Github)?.kind == "pull" -> RefIcons.GitPullRequest
                    else -> RefIcons.CircleDot
                }
                LucideGlyph(icon, size = 16.dp, tint = state?.let { colors.taskStatus(it.second) } ?: colors.fgMuted)
                val mono = textStyle(0.8125f, 1.25f / 0.8125f, mono = true)
                if (ref is ResolvedRef.Github) Row(Modifier.weight(1f), verticalAlignment = Alignment.CenterVertically) {
                    Text(ref.repo, Modifier.weight(1f, fill = false), style = mono, color = colors.fgMuted, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    Text(" #${ref.number}", style = mono, color = colors.fg, maxLines = 1)
                } else Text(cardRefLabel(ref), Modifier.weight(1f), style = mono, color = colors.fg, maxLines = 1, overflow = TextOverflow.Ellipsis)
                state?.let { (words, tone) -> StateBadge(words, tone, Modifier.widthIn(max = 180.dp)) }
            }
            if (title.isNotEmpty()) Text(title, Modifier.semantics { heading() }, style = textStyle(1f, 1.375f, weight = 600), color = colors.fg, maxLines = 3, overflow = TextOverflow.Ellipsis)
            val author = when (details) { is RefDetailsPull -> details.author; is RefDetailsIssue -> details.author; else -> null }
            val updated = when (details) { is RefDetailsPull -> details.updatedAt; is RefDetailsIssue -> details.updatedAt; is RefDetailsJira -> details.updatedAt; else -> null }
            val byline = buildString {
                append(cardKindWords(ref, details, status))
                author?.let { append(" by $it") }
                updated?.let { append(" · updated ${relativeTimeWords(it, now)}") }
            }
            Text(byline, style = textStyle(0.75f, 1f / 0.75f), color = colors.fgSubtle)
        }

        when {
            details == null && loading -> Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                listOf(.75f, .5f, .66f).forEach { Box(Modifier.fillMaxWidth(it).height(12.dp).clip(RoundedCornerShape(4.dp)).background(colors.surface2)) }
            }
            details is RefDetailsPull -> Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                FactRow("Branch") {
                    Column {
                        Text(details.headBranch, style = textStyle(0.75f, 1.4f, mono = true), color = colors.fg, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        Text("→ ${details.baseBranch}", style = textStyle(0.75f, 1.4f, mono = true), color = colors.fgMuted, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        val conflicts = details.conflicts
                        if ((pullState == "open" || pullState == "draft") && conflicts != null) {
                            Text(if (conflicts) "Has conflicts with the base branch" else "No conflicts", style = small, color = if (conflicts) colors.danger else colors.fgSubtle)
                        }
                    }
                }
                FactRow("Checks") {
                    val checks = details.checks
                    if (checks == null) Text("None", style = small, color = colors.fgSubtle)
                    else Column {
                        Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
                            TaskStatusDot(checksTone(checks))
                            Text(checksWords(checks), style = small, color = colors.fg)
                        }
                        failingChecksWords(checks)?.let { Text("Failing: $it", style = small, color = colors.fgMuted) }
                    }
                }
                FactRow("Reviews") {
                    Column {
                        reviewLines(details.reviews).forEach { line ->
                            Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.Top) {
                                TaskStatusDot(line.tone, Modifier.padding(top = 7.dp))
                                Text(line.text, style = small, color = colors.fg)
                            }
                        }
                    }
                }
                FactRow("Changes") { Text(changeWords(details.additions, details.deletions, details.changedFiles), style = small, color = colors.fg) }
            }
            details is RefDetailsIssue -> Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                FactRow("Assignees") {
                    Text(details.assignees.ifEmpty { null }?.joinToString(", ") ?: "Nobody", style = small,
                        color = if (details.assignees.isEmpty()) colors.fgSubtle else colors.fg, maxLines = 2, overflow = TextOverflow.Ellipsis)
                }
                if (details.labels.isNotEmpty()) FactRow("Labels") {
                    FlowRow(horizontalArrangement = Arrangement.spacedBy(4.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        details.labels.forEach { label ->
                            Text(label, Modifier.widthIn(max = 160.dp).clip(RoundedCornerShape(5.dp)).background(colors.surface2.copy(alpha = .6f))
                                .border(BorderStroke(1.dp, colors.borderStrong.copy(alpha = .65f)), RoundedCornerShape(5.dp)).padding(horizontal = 5.dp, vertical = 1.dp),
                                style = textStyle(0.6875f, 1.4f), color = colors.fgMuted, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        }
                    }
                }
                FactRow("Comments") { Text("${details.comments}", style = small, color = colors.fg) }
                Excerpt(details.excerpt, title)
            }
            details is RefDetailsJira -> Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                details.priority?.let { FactRow("Priority") { Text(it, style = small, color = colors.fg) } }
                FactRow("Assignee") { Text(details.assignee ?: "Unassigned", style = small, color = if (details.assignee == null) colors.fgSubtle else colors.fg, maxLines = 1, overflow = TextOverflow.Ellipsis) }
                details.reporter?.let { FactRow("Reporter") { Text(it, style = small, color = colors.fg, maxLines = 1, overflow = TextOverflow.Ellipsis) } }
                details.parent?.let { parent ->
                    FactRow(parent.type ?: "Parent") {
                        Row(Modifier.clip(RoundedCornerShape(4.dp)).clickable(role = Role.Button) { openAddress(parent.url) }, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                            Text(parent.key, style = textStyle(0.75f, 1.4f, mono = true), color = colors.fg)
                            Text(parent.title, style = small.copy(textDecoration = TextDecoration.Underline), color = colors.fg, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        }
                    }
                }
                details.sprint?.let { FactRow("Sprint") { Text(it, style = small, color = colors.fg, maxLines = 1, overflow = TextOverflow.Ellipsis) } }
                Excerpt(details.excerpt, title)
            }
        }

        if (tasks.isNotEmpty()) Column(Modifier.fillMaxWidth().drawBehind {
            drawLine(colors.border, androidx.compose.ui.geometry.Offset(0f, 0f), androidx.compose.ui.geometry.Offset(size.width, 0f), 1.dp.toPx())
        }.padding(top = 10.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(if (tasks.size == 1) "Task naming it" else "Tasks naming it", style = textStyle(0.75f, 1f / 0.75f, weight = 500), color = colors.fgSubtle)
            tasks.forEach { task ->
                Row(Modifier.fillMaxWidth().heightIn(min = 44.dp).clip(RoundedCornerShape(6.dp))
                    .then(if (canOpenTasks) Modifier.clickable(role = Role.Button) { openTask(task.id) } else Modifier)
                    .padding(horizontal = 4.dp),
                    horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                    TaskStatusDot(taskStatusTone(task.status))
                    Text(task.id, style = textStyle(0.8125f, 1.25f / 0.8125f, weight = 600, mono = true), color = colors.accent2)
                    Text(task.title, Modifier.weight(1f), style = small, color = colors.fg, maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
            }
        }

        OutlinedButton(onClick = { openAddress(href) }, Modifier.fillMaxWidth(), border = BorderStroke(1.dp, colors.border),
            colors = ButtonDefaults.outlinedButtonColors(containerColor = colors.surface2.copy(alpha = .6f), contentColor = colors.fg)) {
            Text(openWords(ref), style = textStyle(0.8125f, 1.25f / 0.8125f, weight = 500))
            Spacer(Modifier.width(6.dp))
            LucideGlyph(Lucide.ExternalLink, size = 14.dp)
        }
    }
}

/** A state as a pill in its tone (web `.task-status-badge`). */
@Composable
private fun StateBadge(words: String, tone: TaskStatusTone, modifier: Modifier = Modifier) {
    val color = Jarvis.colors.taskStatus(tone)
    Surface(modifier, shape = RoundedCornerShape(50), color = color.copy(alpha = .12f), contentColor = color, border = BorderStroke(1.dp, color.copy(alpha = .40f))) {
        Row(Modifier.padding(horizontal = 8.dp).heightIn(min = 20.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            TaskStatusDot(tone)
            Text(words, style = textStyle(0.6875f, 1.25f / 0.6875f, weight = 500), maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
    }
}

/** One fact: its name in a narrow column, then what it says. */
@Composable
private fun FactRow(term: String, content: @Composable () -> Unit) {
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(term, Modifier.width(84.dp), style = textStyle(0.8125f, 1.25f / 0.8125f), color = Jarvis.colors.fgSubtle, fontWeight = FontWeight.Normal)
        Box(Modifier.weight(1f)) { content() }
    }
}

/** The start of a description, unless it only repeats the title (a link to a spec named like the ticket). */
@Composable
private fun Excerpt(text: String?, title: String) {
    if (text.isNullOrBlank() || text.trim() == title.trim()) return
    val colors = Jarvis.colors
    Text(text, Modifier.drawBehind { drawLine(colors.border, androidx.compose.ui.geometry.Offset(0f, 0f), androidx.compose.ui.geometry.Offset(0f, size.height), 2.dp.toPx()) }
        .padding(start = 10.dp), style = textStyle(0.8125f, 1.5f), color = colors.fgMuted, maxLines = 3, overflow = TextOverflow.Ellipsis)
}
