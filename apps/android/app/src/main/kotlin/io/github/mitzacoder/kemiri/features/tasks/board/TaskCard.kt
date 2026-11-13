package io.github.mitzacoder.kemiri.features.tasks.board

import io.github.mitzacoder.kemiri.features.tasks.TaskRelationChips

import android.provider.Settings
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import io.github.mitzacoder.kemiri.features.tasks.TaskSearchHit
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import io.github.mitzacoder.kemiri.features.refs.RefChips
import io.github.mitzacoder.kemiri.features.tasks.isWarning
import io.github.mitzacoder.kemiri.features.tasks.taskStatusTone
import io.github.mitzacoder.kemiri.features.tasks.taskStatusWords
import io.github.mitzacoder.kemiri.protocol.*
import io.github.mitzacoder.kemiri.ui.components.LucideGlyph
import io.github.mitzacoder.kemiri.ui.components.LucideIcon
import io.github.mitzacoder.kemiri.ui.components.TaskStatusDot
import io.github.mitzacoder.kemiri.ui.theme.Jarvis
import io.github.mitzacoder.kemiri.ui.theme.TaskStatusTone
import io.github.mitzacoder.kemiri.ui.theme.fade
import io.github.mitzacoder.kemiri.ui.theme.mix
import io.github.mitzacoder.kemiri.ui.theme.textStyle
import io.github.mitzacoder.kemiri.ui.theme.Text as TextStyles

/** The board's own Lucide icons (web `@lucide/svelte`), kept here so the shared icon list stays as it is. */
internal object BoardGlyphs {
    val Move = LucideIcon("move", "M12 2v20", "m15 19-3 3-3-3", "m19 9 3 3-3 3", "M2 12h20", "m5 9-3 3 3 3", "m9 5 3-3 3 3")
    val ArrowUpToLine = LucideIcon("arrow-up-to-line", "M5 3h14", "m18 13-6-6-6 6", "M12 7v14")
    val CircleHelp = LucideIcon("circle-help", "M2 12a10 10 0 1 0 20 0a10 10 0 1 0 -20 0", "M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3", "M12 17h.01")
    val TriangleAlert = LucideIcon("triangle-alert", "m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3", "M12 9v4", "M12 17h.01")
    val UserCog = LucideIcon(
        "user-cog", "M10 15H6a4 4 0 0 0-4 4v2", "m14.305 16.53.923-.382", "m15.228 13.852-.923-.383", "m16.852 12.228-.383-.923",
        "m16.852 17.772-.383.924", "m19.148 12.228.383-.923", "m19.53 18.696-.382-.924", "m20.772 13.852.924-.383", "m20.772 16.148.924.383",
        "M15 15a3 3 0 1 0 6 0a3 3 0 1 0 -6 0", "M5 7a4 4 0 1 0 8 0a4 4 0 1 0 -8 0",
    )
    val Link = LucideIcon("link", "M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71", "M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71")
    val Ban = LucideIcon("ban", "M2 12a10 10 0 1 0 20 0a10 10 0 1 0 -20 0", "M4.929 4.929 19.07 19.071")
    val List = LucideIcon("list", "M3 5h.01", "M3 12h.01", "M3 19h.01", "M8 5h13", "M8 12h13", "M8 19h13")
}

/** Whether the user turned animations off (Settings › Accessibility › Remove animations): the web's reduced motion. */
@Composable
internal fun rememberReducedMotion(): Boolean {
    val resolver = LocalContext.current.contentResolver
    return remember(resolver) { Settings.Global.getFloat(resolver, Settings.Global.ANIMATOR_DURATION_SCALE, 1f) == 0f }
}

private val cardShape = RoundedCornerShape(12.dp)
private val small = textStyle(0.6875f, 1f / 0.6875f)

/**
 * One task on the board (web `TaskCard.svelte`): what a list row says (status dot, title, gist, refs, time and ID) and,
 * when it matters, the worker on it, what it waits for and the background thread that holds it. A tap anywhere but a
 * chip or the menu opens the task's sheet. A task that needs the user is tinted like its list row. [ghost] draws the
 * copy that follows a finger or glides to a new column; [lifted] is the card being dragged, which stays faded in place.
 */
@Composable
fun TaskCard(
    card: KanbanCard,
    tasks: List<BoardTask>,
    workers: List<WorkerSummary>,
    threads: List<ThreadSummary>,
    now: Long,
    modifier: Modifier = Modifier,
    onOpen: (() -> Unit)? = null,
    menu: (@Composable () -> Unit)? = null,
    ghost: Boolean = false,
    lifted: Boolean = false,
    pulse: Boolean = true,
    linksEnabled: Boolean = false,
    searchHit: TaskSearchHit? = null,
) {
    val colors = Jarvis.colors
    val task = card.task
    val needsYou = card.waiting.isNotEmpty() && card.column != KanbanColumnId.Done
    val warned = card.waiting.any(::isWarning)
    val activity = io.github.mitzacoder.kemiri.features.tasks.taskActivity(task, io.github.mitzacoder.kemiri.features.tasks.LocalTaskActivityEnabled.current)
    val gist = cardGist(card)
    val time = cardTime(card, now)
    val closed = card.column == KanbanColumnId.Done
    val dropped = task.status == "dropped"
    val running = runningWorkers(task, workers)
    val blockers = waitsFor(task, tasks)
    val holder = holdingThread(task, threads)
    val tone = taskStatusTone(task.status)
    val (background, border) = when {
        needsYou && warned -> colors.warning.mix(colors.bg, 9f) to colors.warning.fade(35f)
        needsYou -> colors.accent2.mix(colors.bg, 8f) to colors.accent2.fade(30f)
        ghost -> colors.bg.mix(colors.surface, 55f) to colors.borderStrong.fade(90f)
        else -> colors.bg.mix(colors.surface, 55f) to colors.border.fade(85f)
    }
    Box(
        modifier
            .alpha(if (lifted) .35f else if (searchHit?.context == true) .5f else if (dropped) .6f else 1f)
            .clip(cardShape)
            .background(background)
            .border(1.dp, border, cardShape)
            .then(if (onOpen != null && !ghost) Modifier.clickable(onClickLabel = "Open ${task.id}", onClick = onOpen) else Modifier),
    ) {
        Row(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 10.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Box(Modifier.height(20.dp).width(14.dp), contentAlignment = Alignment.Center) {
                when {
                    needsYou && warned -> LucideGlyph(BoardGlyphs.TriangleAlert, size = 14.dp, tint = colors.warning, contentDescription = "Warning")
                    needsYou -> LucideGlyph(BoardGlyphs.CircleHelp, size = 14.dp, tint = colors.accent2, contentDescription = "Question")
                    else -> TaskStatusDot(tone, pulse = pulse && task.status == "in_progress" && !ghost)
                }
            }
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text(
                    buildAnnotatedString { append(task.title); searchHit?.ranges?.forEach { addStyle(SpanStyle(background = colors.accent2.copy(alpha = .22f)), it.start, it.end) } },
                    Modifier.padding(end = if (menu != null) 28.dp else 0.dp),
                    style = textStyle(0.875f, 20f / 14f, weight = 500),
                    color = if (closed) colors.fgMuted else colors.fg,
                    textDecoration = if (dropped) TextDecoration.LineThrough else null,
                    maxLines = 3,
                    overflow = TextOverflow.Ellipsis,
                )
                if (activity != null && searchHit?.snippet.isNullOrEmpty()) io.github.mitzacoder.kemiri.features.tasks.TaskActivityView(activity, maxLines = 2, inlineAge = true)
                else if (task.status == "waiting") Text(io.github.mitzacoder.kemiri.features.tasks.waitingSummary(task), style = TextStyles.taskSm, color = colors.fgMuted)
            else if (!searchHit?.snippet.isNullOrEmpty()) Text(searchHit!!.snippet, style = TextStyles.taskSm, color = colors.fgMuted, maxLines = 1, overflow = TextOverflow.Ellipsis)
            else if (gist.isNotEmpty()) Text(gist, style = TextStyles.taskSm, color = colors.fgMuted, maxLines = 2, overflow = TextOverflow.Ellipsis)
                if (needsYou && card.waiting.size > 1) Text("+${card.waiting.size - 1} more waiting", style = small, color = colors.fgSubtle)
                if (linksEnabled) TaskRelationChips(task)
                if (task.refs.isNotEmpty()) RefChips(task.refs, max = 3)
                if (running.isNotEmpty() || blockers.isNotEmpty() || holder != null) {
                    Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                        running.forEach { worker -> Fact(BoardGlyphs.UserCog, colors.taskStatus(TaskStatusTone.Working), "Worker", worker.id, worker.title) }
                        if (blockers.isNotEmpty()) Fact(BoardGlyphs.Link, colors.fgSubtle, "Waits for", blockers.joinToString { it.id }, blockers.joinToString { "${it.id} · ${it.title}" })
                        holder?.let { Fact(io.github.mitzacoder.kemiri.ui.components.Lucide.Layers, colors.fgSubtle, null, it, "A background thread holds this task: $it") }
                    }
                }
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    if (needsYou || dropped) {
                        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                            TaskStatusDot(tone)
                            Text(taskStatusWords(task.status), style = textStyle(0.6875f, 1f / 0.6875f, weight = 500), color = colors.taskStatus(tone))
                        }
                    }
                    Spacer(Modifier.weight(1f))
                    Text(time.text, Modifier.semantics { contentDescription = time.title }, style = small, color = colors.fgSubtle, maxLines = 1)
                    Text("·", style = small, color = colors.fgSubtle)
                    Text(task.id, Modifier.alpha(.8f), style = textStyle(0.625f, 1.6f, mono = true), color = colors.fgSubtle)
                }
            }
        }
        if (menu != null && !ghost) Box(Modifier.align(Alignment.TopEnd).padding(top = 2.dp, end = 2.dp)) { menu() }
    }
}

/** One line under a card's text: who works on it, what it waits for, which thread holds it. */
@Composable
private fun Fact(icon: LucideIcon, tint: androidx.compose.ui.graphics.Color, label: String?, value: String, description: String) {
    val colors = Jarvis.colors
    Row(Modifier.semantics(mergeDescendants = true) { contentDescription = description }, verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        LucideGlyph(icon, size = 12.dp, tint = tint)
        Text(
            androidx.compose.ui.text.buildAnnotatedString {
                if (label != null) {
                    pushStyle(androidx.compose.ui.text.SpanStyle(color = colors.fgSubtle)); append(label); pop(); append(" ")
                }
                append(value)
            },
            style = small,
            color = colors.fgMuted,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
    }
}
