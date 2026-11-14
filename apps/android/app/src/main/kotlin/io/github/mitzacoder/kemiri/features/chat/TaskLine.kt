package io.github.mitzacoder.kemiri.features.chat

import io.github.mitzacoder.kemiri.data.localizedTimeFormatter
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.InlineTextContent
import androidx.compose.foundation.text.appendInlineContent
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.*
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import io.github.mitzacoder.kemiri.features.refs.RefTextLinker
import io.github.mitzacoder.kemiri.features.tasks.LocalTaskLinks
import io.github.mitzacoder.kemiri.features.tasks.TextPiece
import io.github.mitzacoder.kemiri.features.tasks.splitTaskMentions
import io.github.mitzacoder.kemiri.ui.components.*
import io.github.mitzacoder.kemiri.ui.theme.Jarvis
import java.time.Instant
import java.time.ZoneId
import java.time.format.FormatStyle

/*
 * One quiet line in the transcript for something the harness posted about a task (a worker's report, a check-in, a
 * thread's result, a board change) or a `board` call: what happened, the task it names as a pill that opens the task,
 * and the time. A tap anywhere but the pill opens the whole text under it. The web's `TaskLine.svelte`, `TaskRef`,
 * `TaskText` and `TaskChip`.
 */

internal fun clockTime(ms: Long): String = Instant.ofEpochMilli(ms).atZone(ZoneId.systemDefault()).format(localizedTimeFormatter(timeStyle = FormatStyle.SHORT))
internal fun fullTime(ms: Long): String = Instant.ofEpochMilli(ms).atZone(ZoneId.systemDefault()).format(localizedTimeFormatter(FormatStyle.MEDIUM, FormatStyle.MEDIUM))

enum class TaskLineTone { Quiet, Report, Done, Failed, Tool }

@Composable private fun TaskLineTone.border(): Color = when (this) {
    TaskLineTone.Quiet -> Jarvis.colors.border
    TaskLineTone.Report -> Jarvis.colors.accent2.copy(alpha = .30f)
    TaskLineTone.Done -> Jarvis.colors.success.copy(alpha = .35f)
    TaskLineTone.Failed -> Jarvis.colors.danger.copy(alpha = .40f)
    TaskLineTone.Tool -> Jarvis.colors.border
}
@Composable private fun TaskLineTone.iconTint(): Color = when (this) {
    TaskLineTone.Quiet -> Jarvis.colors.fgSubtle
    TaskLineTone.Report, TaskLineTone.Tool -> Jarvis.colors.accent2
    TaskLineTone.Done -> Jarvis.colors.success
    TaskLineTone.Failed -> Jarvis.colors.danger
}

/**
 * The line: [icon], [line] (words and pills), the time, and a chevron when [details] are given. [stateKey] keeps it open
 * across scrolling. Without [details] the line does not open.
 */
@Composable internal fun TaskLine(
    stateKey: String,
    icon: LucideIcon,
    tone: TaskLineTone,
    modifier: Modifier = Modifier,
    timestamp: Long? = null,
    minimumTouchTarget: Dp? = null,
    trailing: (@Composable RowScope.() -> Unit)? = null,
    details: (@Composable ColumnScope.() -> Unit)? = null,
    line: @Composable RowScope.() -> Unit,
) {
    var open by rememberSaveable(stateKey) { mutableStateOf(false) }
    val shape = RoundedCornerShape(10.dp)
    val borderColor = tone.border()
    val background = when (tone) {
        TaskLineTone.Failed -> Jarvis.colors.danger.copy(alpha = .06f)
        TaskLineTone.Quiet -> Jarvis.colors.surface.copy(alpha = .40f)
        else -> Jarvis.colors.surface.copy(alpha = .60f)
    }
    val frame = if (tone == TaskLineTone.Quiet) Modifier.drawBehind {
        val stroke = 1.dp.toPx()
        drawRoundRect(borderColor, topLeft = androidx.compose.ui.geometry.Offset(stroke / 2, stroke / 2),
            size = androidx.compose.ui.geometry.Size(size.width - stroke, size.height - stroke), cornerRadius = CornerRadius(10.dp.toPx()),
            style = Stroke(stroke, pathEffect = PathEffect.dashPathEffect(floatArrayOf(4.dp.toPx(), 3.dp.toPx()))))
    } else Modifier.border(1.dp, borderColor, shape)
    Column(modifier.fillMaxWidth().clip(shape).background(background).then(frame)) {
        Row(
            Modifier.fillMaxWidth().heightIn(min = minimumTouchTarget ?: 36.dp)
                .then(if (details != null) Modifier.semantics { stateDescription = if (open) "Expanded" else "Collapsed" }.clickable(role = Role.Button) { open = !open } else Modifier)
                .padding(start = 12.dp, end = if (details != null) 4.dp else 12.dp),
            verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            if (tone == TaskLineTone.Tool) Box(Modifier.size(24.dp).clip(RoundedCornerShape(6.dp)).background(Jarvis.colors.accent2.copy(alpha = .12f)), contentAlignment = Alignment.Center) {
                LucideGlyph(icon, size = 14.dp, tint = tone.iconTint())
            } else LucideGlyph(icon, size = 16.dp, tint = tone.iconTint())
            Row(Modifier.weight(1f), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp), content = line)
            timestamp?.let { Text(clockTime(it), style = MaterialTheme.typography.labelSmall, color = Jarvis.colors.fgSubtle, maxLines = 1) }
            trailing?.invoke(this)
            if (details != null) Box(Modifier.size(minimumTouchTarget ?: 32.dp).semantics { contentDescription = if (open) "Hide the full text" else "Show the full text" }, contentAlignment = Alignment.Center) {
                LucideGlyph(if (open) Lucide.ChevronDown else Lucide.ChevronRight, size = 14.dp, tint = Jarvis.colors.fgSubtle)
            }
        }
        if (open && details != null) {
            HorizontalDivider(color = Jarvis.colors.border.copy(alpha = .7f))
            Column(Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 10.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                timestamp?.let { Text(fullTime(it), style = MaterialTheme.typography.labelSmall, color = Jarvis.colors.fgSubtle) }
                details()
            }
        }
    }
}

/** The words of a line, muted, cut to one line. */
@Composable internal fun LineWords(text: String, modifier: Modifier = Modifier, color: Color = Jarvis.colors.fgMuted, weight: FontWeight? = null) =
    Text(text, modifier, style = MaterialTheme.typography.bodyMedium, color = color, fontWeight = weight, maxLines = 1, overflow = TextOverflow.Ellipsis)

/**
 * A board task as a small pill: a dot in its status' colour, its ID and title. It opens the task's sheet when the screen
 * offers task links and the board holds the task; [title] stands in for a task the board does not hold.
 */
@Composable internal fun TaskPill(taskId: String, modifier: Modifier = Modifier, title: String? = null, showTitle: Boolean = true, onRemove: (() -> Unit)? = null, exactTitle: String? = null, feedbackId: String? = null) {
    val links = LocalTaskLinks.current
    val shown = exactTitle ?: if (showTitle) links?.title(taskId) ?: title else null
    val status = links?.status(taskId)
    val opens = links != null && links.knows(taskId)
    Row(
        modifier.clip(RoundedCornerShape(50)).background(Jarvis.colors.surface2.copy(alpha = .6f)).border(1.dp, Jarvis.colors.border, RoundedCornerShape(50))
            .then(if (opens) Modifier.clickable(role = Role.Button, onClickLabel = "Open $taskId") { links!!.open(taskId) } else Modifier)
            .heightIn(min = 24.dp).padding(start = 8.dp, end = if (onRemove != null) 0.dp else 8.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        status?.let { TaskStatusDot(it) }
        Text(listOfNotNull(taskId, feedbackId).joinToString(" · "), style = MaterialTheme.typography.labelMedium, fontFamily = FontFamily.Monospace, fontWeight = FontWeight.SemiBold, color = Jarvis.colors.accent2, maxLines = 1)
        if (!shown.isNullOrBlank()) Text(shown, Modifier.weight(1f, fill = false), style = MaterialTheme.typography.labelMedium, color = Jarvis.colors.fg, maxLines = 1, overflow = TextOverflow.Ellipsis)
        if (onRemove != null) Box(Modifier.size(28.dp).clip(RoundedCornerShape(50)).clickable(role = Role.Button, onClickLabel = "Remove $taskId", onClick = onRemove).semantics { contentDescription = "Remove $taskId" }, contentAlignment = Alignment.Center) {
            LucideGlyph(Lucide.X, size = 14.dp, tint = Jarvis.colors.fgSubtle)
        }
    }
}

/**
 * A line of the harness' words with each task it names as an inline pill that opens it, cut to one line with one
 * ellipsis. [titles] adds each task's title to its pill, for text that only has the ID.
 */
@Composable internal fun TaskText(text: String, modifier: Modifier = Modifier, titles: Boolean = false, strong: Boolean = false, color: Color = if (strong) Jarvis.colors.fg else Jarvis.colors.fgMuted) {
    val links = LocalTaskLinks.current
    val pieces = remember(text, links) { if (links == null) listOf(TextPiece.Plain(text)) else splitTaskMentions(text) { links.knows(it) } }
    if (pieces.none { it is TextPiece.Task }) {
        LineWords(text, modifier, color, if (strong) FontWeight.SemiBold else null)
        return
    }
    val measurer = rememberTextMeasurer()
    val density = LocalDensity.current
    val pillStyle = MaterialTheme.typography.labelMedium
    val textStyle = MaterialTheme.typography.bodyMedium
    BoxWithConstraints(modifier) {
        // The line is one line: a pill's title gets what is left of it after the words before, cut to fit.
        var left = constraints.maxWidth.toFloat()
        val inline = mutableMapOf<String, InlineTextContent>()
        val annotated = buildAnnotatedString {
            pieces.forEachIndexed { index, piece ->
                when (piece) {
                    is TextPiece.Plain -> { append(piece.text); left -= measurer.measure(piece.text, textStyle).size.width }
                    is TextPiece.Task -> {
                        val idWidth = measurer.measure(piece.taskId, pillStyle.copy(fontFamily = FontFamily.Monospace, fontWeight = FontWeight.SemiBold)).size.width
                        val chrome = with(density) { (8 + 8 + 4 + (if (links?.status(piece.taskId) != null) 13 else 0)).dp.toPx() }
                        var title = if (titles) links?.title(piece.taskId) else null
                        val gap = with(density) { 6.dp.toPx() }
                        var titleWidth = title?.let { measurer.measure(it, pillStyle).size.width.toFloat() } ?: 0f
                        if (title != null && idWidth + chrome + gap + titleWidth > left) {
                            val room = left - idWidth - chrome - gap
                            val fitted = if (room < with(density) { 48.dp.toPx() }) null else {
                                var count = title.length
                                while (count > 1 && measurer.measure(title.take(count) + "…", pillStyle).size.width > room) count = (count * 0.85).toInt().coerceAtMost(count - 1)
                                title.take(count).trimEnd() + "…"
                            }
                            title = fitted
                            titleWidth = fitted?.let { measurer.measure(it, pillStyle).size.width.toFloat() } ?: 0f
                        }
                        val width = idWidth + chrome + (if (title != null) gap + titleWidth else 0f)
                        left -= width
                        val key = "task-$index"
                        val shown = title
                        inline[key] = InlineTextContent(Placeholder(with(density) { width.toSp() }, 22.sp, PlaceholderVerticalAlign.Center)) {
                            TaskPill(piece.taskId, Modifier.padding(horizontal = 2.dp), showTitle = false, exactTitle = shown)
                        }
                        appendInlineContent(key, piece.taskId)
                    }
                }
            }
        }
        Text(annotated, style = textStyle, color = color, fontWeight = if (strong) FontWeight.SemiBold else null, maxLines = 1, overflow = TextOverflow.Ellipsis, inlineContent = inline)
    }
}

/** A call's state as a small icon: working, done, failed, exited non-zero or stopped. */
@Composable internal fun CallStateIcon(part: ChatPart) = CallStateGlyph(toolCallState(part))

@Composable internal fun CallStateGlyph(state: String) {
    when (state) {
        "running" -> CircularProgressIndicator(Modifier.size(13.dp), strokeWidth = 1.5.dp, color = Jarvis.colors.accent2)
        "done" -> LucideGlyph(Lucide.Check, size = 14.dp, tint = Jarvis.colors.success)
        "failed" -> LucideGlyph(Lucide.X, size = 14.dp, tint = Jarvis.colors.danger)
        "exited" -> LucideGlyph(ChatIcons.TriangleAlert, size = 14.dp, tint = Jarvis.colors.warning)
        else -> LucideGlyph(ChatIcons.CircleStop, size = 14.dp, tint = Jarvis.colors.fgSubtle)
    }
}

/**
 * Task mentions (`T12`) in the Markdown inside [content] as links that open the task, where the board holds it; never
 * inside code or an existing link. While a reply is still arriving ([streaming]), a task or ref mention at the very end
 * of [source] (the Markdown as it stands) waits; one that ends a bold run or a list item earlier is whole and links (web
 * `linkTaskMentions`). Without [source], every text run's last mention waits.
 */
@Composable internal fun TaskMentions(streaming: Boolean = false, source: String? = null, userMessage: Boolean = false, content: @Composable () -> Unit) {
    val links = LocalTaskLinks.current
    /** Whether a run of plain text is the end of what has arrived, where a mention may still grow. */
    fun atTail(text: String) = streaming && (source == null || source.trimEnd().endsWith(text.trimEnd()))
    // The ref linker, too, waits for a whole mention at the very end while the reply still arrives.
    val outerLinkers = LocalTextLinkers.current
    val outer = remember(outerLinkers, streaming, source) {
        if (!streaming) outerLinkers else outerLinkers.map { linker ->
            val waiting = (linker as? RefTextLinker)?.streaming() ?: return@map linker
            TextLinker { text -> if (atTail(text)) waiting.find(text) else linker.find(text) }
        }
    }
    if (links == null) { CompositionLocalProvider(LocalTextLinkers provides outer, content = content); return }
    // Like the web's task links: the ID in the accent colour on a faint wash of it.
    val style = TextLinkStyles(SpanStyle(color = if(userMessage) Jarvis.colors.fg else Jarvis.colors.accent2, fontFamily = FontFamily.Monospace, fontWeight = FontWeight.SemiBold, background = Jarvis.colors.accent2.copy(alpha = .12f)))
    val linker = remember(links, streaming, source, style) {
        TextLinker { text ->
            var at = 0
            splitTaskMentions(text, atTail(text)) { links.knows(it) }.mapNotNull { piece ->
                val start = at
                at += when (piece) { is TextPiece.Plain -> piece.text.length; is TextPiece.Task -> piece.taskId.length }
                (piece as? TextPiece.Task)?.let { TextLinkSpan(start, at, LinkAnnotation.Clickable("task:${it.taskId}", style) { _ -> links.open(it.taskId) }) }
            }
        }
    }
    CompositionLocalProvider(LocalTextLinkers provides outer + linker, content = content)
}
