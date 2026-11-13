package io.github.mitzacoder.kemiri.features.chat

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.ui.draw.drawBehind
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import io.github.mitzacoder.kemiri.features.tasks.checkInTaskIds
import io.github.mitzacoder.kemiri.features.tasks.isMainThread
import io.github.mitzacoder.kemiri.features.tasks.threadName
import io.github.mitzacoder.kemiri.navigation.ProjectScreenContext
import io.github.mitzacoder.kemiri.protocol.Artifact
import io.github.mitzacoder.kemiri.protocol.ThreadSummary
import io.github.mitzacoder.kemiri.protocol.WorkerSummary
import io.github.mitzacoder.kemiri.ui.components.*
import io.github.mitzacoder.kemiri.ui.theme.Jarvis

/*
 * What the harness posts into a conversation as user inputs, drawn as one task line each instead of something the user
 * typed: a worker's report or failure, a check-in on running work, a background thread's finish or failure, and a
 * `[board]` note. The web's `WorkerReport`, `WorkerCheckIn`, `ThreadNotice` and `BoardNotice`.
 */

/** What an injected input is, by its prefix; null for text the user typed. */
internal sealed interface InjectedInput {
    data class Report(val notice: WorkerNotice) : InjectedInput
    data class CheckIn(val body: String) : InjectedInput
    data class Reports(val notice: ReportsNotice) : InjectedInput
    data class Board(val notice: BoardNotice) : InjectedInput
    data class Thread(val notice: ThreadNotice) : InjectedInput
}

/** The same order the web's transcript tries: a worker's notice, a check-in, a board note, a thread's notice. */
internal fun injectedInput(text: String): InjectedInput? =
    parseWorkerNotice(text)?.let(InjectedInput::Report)
        ?: parseCheckIn(text)?.let(InjectedInput::CheckIn)
        ?: parseReportsNotice(text)?.let(InjectedInput::Reports)
        ?: parseBoardNotice(text)?.let(InjectedInput::Board)
        ?: parseThreadNotice(text)?.let(InjectedInput::Thread)

/** A notice's whole text, as written, for the opened line. */
@Composable internal fun RawText(text: String) {
    SelectionContainer {
        Text(text, Modifier.heightIn(max = 320.dp).verticalScroll(rememberScrollState()), fontFamily = FontFamily.Monospace, fontSize = 12.sp, lineHeight = 19.sp, color = Jarvis.colors.fgMuted)
    }
}

@Composable private fun OpenLink(label: String, onClick: () -> Unit) =
    TextButton(onClick = onClick, contentPadding = PaddingValues(horizontal = 0.dp, vertical = 0.dp), modifier = Modifier.heightIn(min = 36.dp)) {
        Text(label, style = MaterialTheme.typography.labelMedium, color = Jarvis.colors.fgMuted); Spacer(Modifier.width(4.dp)); Text("→", color = Jarvis.colors.fgMuted)
    }

@Composable private fun Quiet(text: String) = Text(text, style = MaterialTheme.typography.bodySmall, fontStyle = FontStyle.Italic, color = Jarvis.colors.fgSubtle)

@Composable internal fun InjectedLine(part: ChatPart, input: InjectedInput, context: ProjectScreenContext?, workers: List<WorkerSummary>, threads: List<ThreadSummary>, artifacts: List<Artifact>) {
    when (input) {
        is InjectedInput.Report -> WorkerReportLine(part, input.notice, workers.firstOrNull { it.id == input.notice.workerId }, context)
        is InjectedInput.CheckIn -> CheckInLine(part, input.body, threads, context)
        is InjectedInput.Reports -> ReportsNoticeLine(part, input.notice, context)
        is InjectedInput.Board -> BoardNoticeLine(part, input.notice, threads, context)
        is InjectedInput.Thread -> ThreadNoticeLine(part, input.notice, threads, artifacts, context)
    }
}

@Composable private fun WorkerReportLine(part: ChatPart, notice: WorkerNotice, worker: WorkerSummary?, context: ProjectScreenContext?) {
    val ok = notice.kind == "report"
    val taskId = worker?.taskId
    TaskLine(part.key, if (ok) ChatIcons.Bot else Lucide.CircleAlert, if (ok) TaskLineTone.Report else TaskLineTone.Failed, timestamp = part.timestamp, details = {
        if (taskId != null) Text("Worker ${notice.workerId}", style = MaterialTheme.typography.labelSmall, color = Jarvis.colors.fgSubtle)
        if (ok) { if (notice.body.isNotEmpty()) RichMarkdown(reportMarkdown(notice.body)) else Quiet("It answered with no text.") }
        else Text(notice.body.ifEmpty { "It failed without a reason." }, style = MaterialTheme.typography.bodySmall, color = Jarvis.colors.danger)
        if (context != null) OpenLink("Open the worker's transcript") { context.navigate(context.route.copy(workerId = notice.workerId)) }
    }) {
        val words = if (taskId == null) "Worker ${notice.workerId} ${if (ok) "reported" else "failed"}" else if (ok) "Worker reported" else "Worker failed"
        LineWords(words, Modifier.weight(1f, fill = taskId == null), color = if (ok) Jarvis.colors.fgMuted else Jarvis.colors.danger, weight = if (ok) null else FontWeight.Medium)
        if (taskId != null) TaskPill(taskId, Modifier.weight(1f, fill = false), title = worker.title)
    }
}

@Composable private fun CheckInLine(part: ChatPart, body: String, threads: List<ThreadSummary>, context: ProjectScreenContext?) {
    val running = checkInThreads(body)
    val taskIds = checkInTaskIds(body)
    TaskLine(part.key, ChatIcons.Activity, TaskLineTone.Quiet, timestamp = part.timestamp, details = {
        if (running.isNotEmpty()) FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            running.forEach { (id, title) ->
                val name = threadName(id, threads).takeUnless { it == id } ?: title
                Text(name, Modifier.clip(RoundedCornerShape(50)).border(1.dp, Jarvis.colors.border, RoundedCornerShape(50))
                    .then(if (context != null) Modifier.clickable(role = Role.Button) { context.navigate(context.route.copy(threadId = id.takeUnless(::isMainThread), workerId = null)) } else Modifier)
                    .padding(horizontal = 10.dp, vertical = 6.dp), style = MaterialTheme.typography.labelSmall, color = Jarvis.colors.fgMuted)
            }
        }
        RawText(body)
    }) {
        LineWords(if (taskIds.isNotEmpty()) "Check-in" else if (running.isNotEmpty()) "Check-in on running work" else "Check-in on running workers", Modifier.weight(1f, fill = taskIds.isEmpty()))
        taskIds.forEachIndexed { index, taskId -> TaskPill(taskId, if (index == taskIds.lastIndex) Modifier.weight(1f, fill = false) else Modifier, showTitle = taskIds.size == 1) }
    }
}

@Composable private fun BoardNoticeLine(part: ChatPart, notice: BoardNotice, threads: List<ThreadSummary>, context: ProjectScreenContext?) {
    val handoff = parseBoardHandoff(part.text)
    val fromThread = handoff?.from?.takeUnless(::isMainThread)
    val multiline = notice.body.trim() != notice.summary.trim()
    TaskLine(part.key, ChatIcons.ClipboardList, TaskLineTone.Quiet, timestamp = part.timestamp, details = if (multiline || (fromThread != null && context != null)) ({
        if (fromThread != null && context != null) OpenLink("Open ${threadName(fromThread, threads)}") { context.navigate(context.route.copy(threadId = fromThread, workerId = null)) }
        RawText(notice.body)
    }) else null) {
        if (handoff != null) {
            TaskPill(handoff.taskId, Modifier.weight(1f, fill = false), title = handoff.title)
            LineWords("handed over by ${threadName(handoff.from, threads)}", Modifier.weight(1f, fill = false))
        } else TaskText(notice.summary, Modifier.weight(1f), titles = true)
    }
}

@Composable private fun ThreadNoticeLine(part: ChatPart, notice: ThreadNotice, threads: List<ThreadSummary>, artifacts: List<Artifact>, context: ProjectScreenContext?) {
    val threadId = notice.threadId
    val thread = threads.firstOrNull { it.id == threadId }
    val name = if (threadId == null) "A background thread" else threadName(threadId, threads)
    val openThread: (() -> Unit)? = if (context != null && threadId != null && !isMainThread(threadId)) ({ context.navigate(context.route.copy(threadId = threadId, workerId = null)) }) else null
    if (notice.kind == "finished" || notice.kind == "failed") {
        val ok = notice.kind == "finished"
        val taskId = thread?.taskId
        TaskLine(part.key, if (ok) ChatIcons.CircleCheck else Lucide.CircleAlert, if (ok) TaskLineTone.Done else TaskLineTone.Failed, timestamp = part.timestamp, details = {
            if (taskId != null) Text(name, style = MaterialTheme.typography.labelSmall, color = Jarvis.colors.fgSubtle)
            if (ok) {
                if (notice.body.isNotEmpty()) RichMarkdown(notice.body) else Quiet("It finished without a summary.")
                if (context != null && threadId != null) TranscriptArtifactStrip(finishArtifacts(artifacts, threadId, part.timestamp), context)
            } else {
                Text(notice.body.ifEmpty { "It failed without a reason." }, style = MaterialTheme.typography.bodySmall, color = Jarvis.colors.danger)
                thread?.let { ThreadFactsLine(it) }
            }
            openThread?.let { OpenLink("Open thread", it) }
        }) {
            if (taskId == null) {
                Text(name, Modifier.weight(1f, fill = false), style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Medium, color = if (ok) Jarvis.colors.fg else Jarvis.colors.danger, maxLines = 1, overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis)
                LineWords(if (ok) "finished" else "failed", Modifier.weight(1f), color = if (ok) Jarvis.colors.fgMuted else Jarvis.colors.danger)
            } else {
                LineWords(if (ok) "Thread finished" else "Thread failed", color = if (ok) Jarvis.colors.fgMuted else Jarvis.colors.danger, weight = if (ok) null else FontWeight.Medium)
                TaskPill(taskId, Modifier.weight(1f, fill = false), title = thread.title)
            }
        }
    } else {
        // A message from another thread, or a thread note this app does not know yet: a small notice, never typed text.
        val border = Jarvis.colors.border
        Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(Jarvis.colors.surface.copy(alpha = .4f)).drawBehind {
            val stroke = 1.dp.toPx()
            drawRoundRect(border, topLeft = androidx.compose.ui.geometry.Offset(stroke / 2, stroke / 2), size = androidx.compose.ui.geometry.Size(size.width - stroke, size.height - stroke),
                cornerRadius = CornerRadius(12.dp.toPx()), style = Stroke(stroke, pathEffect = PathEffect.dashPathEffect(floatArrayOf(4.dp.toPx(), 3.dp.toPx()))))
        }.padding(horizontal = 12.dp, vertical = 6.dp), verticalAlignment = Alignment.Top, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            LucideGlyph(if (notice.kind == "message") ChatIcons.MessageSquare else Lucide.Layers, size = 14.dp, tint = Jarvis.colors.fgSubtle, modifier = Modifier.padding(top = 2.dp))
            Column(Modifier.weight(1f)) {
                if (notice.kind == "message") {
                    Text("From $name:", style = MaterialTheme.typography.labelMedium, fontWeight = FontWeight.Medium, color = Jarvis.colors.fg)
                    RichMarkdown(notice.body)
                } else Text(notice.body, style = MaterialTheme.typography.bodySmall, color = Jarvis.colors.fgMuted)
            }
            openThread?.let { TextButton(onClick = it, contentPadding = PaddingValues(horizontal = 4.dp)) { Text("Open", style = MaterialTheme.typography.labelMedium, color = Jarvis.colors.fgSubtle) } }
        }
    }
}

/** A failed thread's facts: workers still running, questions waiting, the tasks it holds. */
@Composable private fun ThreadFactsLine(thread: ThreadSummary) {
    val facts = listOfNotNull(
        "${thread.runningWorkers} workers working".takeIf { thread.runningWorkers > 0 },
        "${thread.openQuestions} questions for you".takeIf { thread.openQuestions > 0 },
        thread.ownedTasks.takeIf { it.isNotEmpty() }?.let { "Owns ${it.take(3).joinToString()}${if (it.size > 3) " +${it.size - 3}" else ""}" },
    )
    if (facts.isNotEmpty()) Text(facts.joinToString(" · "), style = MaterialTheme.typography.labelSmall, color = Jarvis.colors.fgMuted)
}
