package io.github.mitzacoder.aiki.features.chat

import android.util.Base64
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.animation.core.animateFloat
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil3.compose.AsyncImage
import io.github.mitzacoder.aiki.navigation.*
import io.github.mitzacoder.aiki.features.tasks.rememberReducedMotion
import io.github.mitzacoder.aiki.protocol.Artifact
import io.github.mitzacoder.aiki.protocol.ThreadSummary
import io.github.mitzacoder.aiki.protocol.WorkerSummary
import io.github.mitzacoder.aiki.ui.components.*
import io.github.mitzacoder.aiki.ui.theme.Jarvis
import kotlinx.serialization.json.*

private val pretty = Json { prettyPrint = true }
private fun prettyJson(value: JsonElement) = pretty.encodeToString(JsonElement.serializer(),value)

/** What every row needs from the screen besides the row itself: the project's workers, threads and artifacts, and names. */
data class TranscriptScope(
    val context: ProjectScreenContext? = null,
    val workers: List<WorkerSummary> = emptyList(),
    val artifacts: List<Artifact> = emptyList(),
    val threads: List<ThreadSummary> = emptyList(),
    /** Each retitling `worker_send`'s previous worker title, by call key ([workerTitlesBeforeSend]). */
    val workerTitlesBefore: Map<String,String> = emptyMap(),
    /** Schedule titles by ID, for a worker a schedule started. */
    val scheduleTitles: Map<String,String> = emptyMap(),
)

@Composable private fun ToolDestination(part: ChatPart, context: ProjectScreenContext) {
    val tab = when {
        part.name.startsWith("memory_") -> PanelTab.Memory
        part.name.startsWith("thread_") -> PanelTab.Threads
        part.name == "board" -> PanelTab.Board
        part.name.startsWith("artifact") -> PanelTab.Artifacts
        else -> null
    }
    if (part.name.startsWith("schedule_")) TextButton(onClick = { context.navigate(Destination.ProjectSettings(context.route, io.github.mitzacoder.aiki.features.settings.ProjectSection.Schedules)) }) { Text("Open Scheduled tasks") }
    if(tab != null) TextButton(onClick = { context.navigate(Destination.Panel(context.route,tab)) }) { Text("Open ${tab.label}") }
}

/** Whether a row is one of the one-line task items, which sit close together when they follow each other. */
internal fun isTaskLineRow(row: ChatRow): Boolean {
    val first = row.parts.first()
    if(first.kind != "notice") return false
    return when(val input = injectedInput(first.text)) {
        null -> false
        is InjectedInput.Thread -> input.notice.kind == "finished" || input.notice.kind == "failed"
        else -> true
    }
}

/** Where a reply's row sits in its turn, for the orb beside the turn on a wide screen: [first] draws it, [active] spins it. */
data class TurnOrb(val first: Boolean, val active: Boolean)

/** Whether a row belongs to a reply (thinking, text, calls, how it ended) rather than standing between replies. */
private fun isReplyRow(row: ChatRow): Boolean {
    val first = row.parts.first()
    return first.kind in setOf("text","thinking","tool") || (first.kind == "notice" && first.key.endsWith("-end"))
}

/**
 * Each row's place in its reply (web `AssistantTurn`: one orb per turn, active while the turn streams); null for rows
 * between replies. A turn runs until a row that is not a reply's, or ends at the row that carries its [TurnMeta].
 */
fun turnOrbs(rows: List<ChatRow>): List<TurnOrb?> {
    val orbs = arrayOfNulls<TurnOrb>(rows.size)
    var start = -1
    fun close(end: Int) {
        if(start < 0) return
        val active = rows[end].turn?.streaming == true
        for(index in start..end) orbs[index] = TurnOrb(index == start,active)
        start = -1
    }
    rows.forEachIndexed { index,row ->
        if(!isReplyRow(row)) { close(index - 1); return@forEachIndexed }
        if(start < 0) start = index
        if(row.turn != null) close(index)
    }
    close(rows.lastIndex)
    return orbs.toList()
}

/** Below this window width the replies drop the orb and use the whole width (web `hidden sm:block`). */
private const val ORB_MIN_WIDTH_DP = 640

/** Whether replies sit beside an orb on this screen. */
@Composable fun showsTurnOrbs(): Boolean {
    val width = androidx.compose.ui.platform.LocalWindowInfo.current.containerSize.width
    return with(androidx.compose.ui.platform.LocalDensity.current) { width.toDp() } >= ORB_MIN_WIDTH_DP.dp
}

/**
 * The orb's column beside a reply's row: the orb on the turn's first row, an empty gutter on the rest, so the whole turn
 * lines up as on the web.
 */
@Composable private fun TurnGutter(orb: TurnOrb, content: @Composable () -> Unit) {
    Row(Modifier.fillMaxWidth(),horizontalArrangement = Arrangement.spacedBy(14.dp)) {
        Box(Modifier.width(26.dp)) {
            if(orb.first) AssistantOrb(Modifier.padding(top = 2.dp),size = 26.dp,active = orb.active,animationsEnabled = orb.active && !rememberReducedMotion(),contentDescription = "Assistant")
        }
        Box(Modifier.weight(1f)) { content() }
    }
}

/**
 * The coordinator is working but no reply streams yet (web `TranscriptColumn`'s working row): an active orb and a
 * shimmering "Working…", still with animations off.
 */
@Composable fun WorkingRow(modifier: Modifier = Modifier) {
    val still = rememberReducedMotion()
    Row(modifier.fillMaxWidth().semantics(mergeDescendants = true) {},verticalAlignment = Alignment.CenterVertically,horizontalArrangement = Arrangement.spacedBy(14.dp)) {
        AssistantOrb(size = 26.dp,active = true,animationsEnabled = !still)
        ShimmerText("Working…",animate = !still)
    }
}

/** Text with a light band sweeping across it while something works (web `shimmer-text`); plain subtle text when still. */
@Composable internal fun ShimmerText(text: String, animate: Boolean, modifier: Modifier = Modifier) {
    val colors = Jarvis.colors
    val style = MaterialTheme.typography.bodyMedium.copy(fontWeight = FontWeight.Medium)
    if(!animate) { Text(text,modifier,style = style,color = colors.fgSubtle); return }
    val transition = androidx.compose.animation.core.rememberInfiniteTransition(label = "shimmer")
    // The web's band moves across a 200%-wide gradient in 2 s.
    val shift by transition.animateFloat(1f,-1f,androidx.compose.animation.core.infiniteRepeatable(androidx.compose.animation.core.tween(2000,easing = androidx.compose.animation.core.LinearEasing)),label = "shimmer band")
    var width by remember { mutableFloatStateOf(1f) }
    val brush = androidx.compose.ui.graphics.Brush.linearGradient(
        0f to colors.fgSubtle,.35f to colors.fgSubtle,.5f to colors.fg,.65f to colors.fgSubtle,1f to colors.fgSubtle,
        start = androidx.compose.ui.geometry.Offset(width * shift,0f),end = androidx.compose.ui.geometry.Offset(width * (shift + 2f),0f))
    Text(text,modifier.onSizeChanged { width = it.width.toFloat() },style = style.copy(brush = brush))
}

@Composable fun TranscriptRow(row: ChatRow, scope: TranscriptScope, streaming: Boolean = false, orb: TurnOrb? = null) {
    if(orb != null) TurnGutter(orb) { TranscriptRowContent(row,scope,streaming) }
    else TranscriptRowContent(row,scope,streaming)
}

@Composable private fun TranscriptRowContent(row: ChatRow, scope: TranscriptScope, streaming: Boolean) {
    val first = row.parts.first()
    Column(Modifier.fillMaxWidth()) {
        when {
            first.kind == "cacheWarm" -> CacheWarmLine(first)
            first.kind == "notice" -> injectedInput(first.text)?.let { InjectedLine(first,it,scope.context,scope.workers,scope.threads,scope.artifacts) } ?: TurnNotice(first)
            first.kind == "thinking" -> ThinkingCard(row)
            row.isSteps -> StepsRow(row,scope)
            first.kind == "tool" && first.name in codingTools -> CompactCodingCard(row)
            first.kind == "tool" -> ToolCallCard(first,scope)
            first.kind == "compaction" -> CompactionMarker(first,scope.context)
            first.kind == "image" -> Box(Modifier.fillMaxWidth(),contentAlignment = Alignment.CenterEnd) {
                AsyncImage(model = remember(first.text) { runCatching { Base64.decode(first.text,Base64.DEFAULT) }.getOrNull() },contentDescription = "Attached image",modifier = Modifier.fillMaxWidth(.85f).heightIn(max = 320.dp).clip(RoundedCornerShape(16.dp)))
            }
            first.kind == "user" -> UserMessage(first, scope.context)
            else -> TaskMentions(streaming,source = first.text) { RichMarkdown(first.text,Modifier.fillMaxWidth()) }
        }
        row.turn?.let { TurnFooter(row.key,it) }
    }
}

/** One tool call as the card its kind asks for: a worker's, a thread's, memory's, the board's, an artifact's, a script's, or the generic card. */
@Composable internal fun ToolCallCard(part: ChatPart, scope: TranscriptScope) {
    val context = scope.context
    val worker = if(context != null) workerForCall(part,scope.workers,context.route.threadId) else null
    val board = if(part.name == "board") boardCallView(part.arguments,part.text) else null
    when {
        worker != null && context != null -> WorkerCallCard(part,worker,scope.workerTitlesBefore[part.key],worker.scheduleId?.let { scope.scheduleTitles[it] }) {
            context.navigate(context.route.copy(workerId = worker.id,threadId = worker.threadId ?: context.route.threadId))
        }
        part.name.startsWith("thread_") -> ThreadToolCard(part,scope.threads.find { it.id == threadCallId(part) },context,scope.artifacts)
        part.name == "artifact_save" -> ArtifactCallCard(part,context,scope.artifacts)
        part.name == "codemode" -> CodeModeCard(part)
        part.name.startsWith("memory_") -> MemoryCallCard(part,context)
        board != null -> BoardCallLine(part,board,context)
        part.name in codingTools -> CompactCodingCard(ChatRow(part.key,listOf(part)))
        else -> GenericToolCard(part,scope)
    }
}

/**
 * A run of calls that are not coding calls, folded into one row ("5 steps"): the row counts them and says what failed
 * or still runs; it opens into the card each would have been on its own.
 */
@Composable private fun StepsRow(row: ChatRow, scope: TranscriptScope) {
    var open by rememberSaveable(row.key) { mutableStateOf(false) }
    val summary = stepsGroupSummary(row.parts)
    val tone = when(summary.status) { "failed" -> Jarvis.colors.danger; "exited" -> Jarvis.colors.warning; else -> Jarvis.colors.accent2 }
    val border = when(summary.status) { "failed" -> Jarvis.colors.danger.copy(alpha = .3f); "exited" -> Jarvis.colors.warning.copy(alpha = .3f); else -> Jarvis.colors.border }
    val shape = RoundedCornerShape(16.dp)
    val first = row.parts.first()
    Column(Modifier.fillMaxWidth().clip(shape).background(Jarvis.colors.surface.copy(alpha = .6f)).border(1.dp,border,shape)) {
        Row(Modifier.fillMaxWidth().heightIn(min = 44.dp).semantics { stateDescription = if(open) "Expanded" else "Collapsed" }
            .clickable(role = Role.Button,onClickLabel = row.parts.joinToString { it.name }) { open = !open }.padding(horizontal = 12.dp,vertical = 6.dp),
            verticalAlignment = Alignment.CenterVertically,horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            Box(Modifier.size(24.dp).clip(RoundedCornerShape(6.dp)).background(tone.copy(alpha = .12f)),contentAlignment = Alignment.Center) {
                LucideGlyph(stepIcon(first),size = 14.dp,tint = tone)
            }
            Row(Modifier.weight(1f),verticalAlignment = Alignment.CenterVertically,horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(summary.label,style = MaterialTheme.typography.labelLarge,fontWeight = FontWeight.SemiBold)
                summary.detail?.let { Text(it,style = MaterialTheme.typography.labelSmall,maxLines = 1,color = when(summary.status) { "failed" -> Jarvis.colors.danger; "exited" -> Jarvis.colors.warning; else -> Jarvis.colors.fgSubtle }) }
            }
            CallStateGlyph(summary.status)
            LucideGlyph(if(open) Lucide.ChevronDown else Lucide.ChevronRight,size = 14.dp,tint = Jarvis.colors.fgSubtle)
        }
        if(open) {
            HorizontalDivider(color = Jarvis.colors.border)
            Column(Modifier.fillMaxWidth().background(Jarvis.colors.bg.copy(alpha = .4f)).padding(6.dp),verticalArrangement = Arrangement.spacedBy(4.dp)) {
                row.parts.forEach { part -> key(part.key) { ToolCallCard(part,scope) } }
            }
        }
    }
}

private fun stepIcon(part: ChatPart): LucideIcon = when {
    part.name == "board" -> ChatIcons.ClipboardList
    part.name.startsWith("worker_") -> ChatIcons.Bot
    part.name.startsWith("thread_") -> Lucide.Users
    part.name.startsWith("memory_") -> Lucide.Brain
    part.name.startsWith("schedule_") -> Lucide.Clock
    part.name == "codemode" -> Lucide.Code
    else -> Lucide.Wrench
}

/** A call of a tool with no card of its own: its action in words, the exact name and arguments when opened. */
@Composable private fun GenericToolCard(part: ChatPart, scope: TranscriptScope) {
    val context = scope.context
    var expanded by rememberSaveable(part.key) { mutableStateOf(false) }
    TranscriptSurface(title = toolHeadline(part.name) ?: part.name,icon = stepIcon(part),expanded = expanded,onToggle = { expanded = !expanded },
        subtitle = toolSummary(part).ifBlank { null },
        status = listOfNotNull(friendlyStatus(part),if(part.viaScript != null) "via script" else null).joinToString(" · "),tone = callTone(part)) {
        ToolDisclosure(expanded) {
            Text("${part.name} · ${toolStatusLabel(part)}",style = MaterialTheme.typography.labelMedium,fontFamily = FontFamily.Monospace)
            part.arguments?.let { args -> RichMarkdown("```json\n${prettyJson(args)}\n```") }
            part.viaScript?.let { RichMarkdown("Via script\n```javascript\n$it\n```") }
            if(part.text.isNotBlank()) RichMarkdown(part.text)
            visibleDiagnostics(part).forEach { diagnostic ->
                Text(diagnostic.s("message"),color = when(diagnostic.s("severity")) { "error" -> Jarvis.colors.danger; "warn" -> Jarvis.colors.warning; else -> Jarvis.colors.fgMuted },style = MaterialTheme.typography.bodySmall)
            }
            part.details?.let { RichMarkdown("```json\n${prettyJson(it)}\n```") }
            part.nested.forEach { child ->
                Text("↳ ${child.s("name")} · ${nestedCallStatus(child)}",style = MaterialTheme.typography.labelMedium)
                val args = child["arguments"]?.toString() ?: child.s("args")
                if(args.isNotBlank()) RichMarkdown("```json\n$args\n```")
            }
            if(context != null) ToolDestination(part,context)
        }
        if(context != null && workerCallId(part) != null) {
            Text("Worker ${workerCallId(part)} is not in this thread's current list; it may have been forgotten.",style = MaterialTheme.typography.bodySmall)
        }
    }
}

/** A line in the transcript that is not a message: a reset, a retry, a failure, a stop. */
@Composable private fun TurnNotice(part: ChatPart) {
    if(part.status == "stopped") {
        Row(verticalAlignment = Alignment.CenterVertically,horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            LucideGlyph(ChatIcons.CircleStop,size = 14.dp,tint = Jarvis.colors.fgSubtle)
            Text(part.text,style = MaterialTheme.typography.bodyMedium,color = Jarvis.colors.fgSubtle)
        }
        return
    }
    val (tone,icon) = when(part.status) {
        "error" -> Jarvis.colors.danger to Lucide.CircleAlert
        "warning" -> Jarvis.colors.warning to ChatIcons.TriangleAlert
        else -> Jarvis.colors.fgMuted to Lucide.Info
    }
    val tinted = part.status == "error" || part.status == "warning"
    val shape = RoundedCornerShape(16.dp)
    Row(Modifier.fillMaxWidth().clip(shape).background(if(tinted) tone.copy(alpha = .08f) else Jarvis.colors.surface.copy(alpha = .6f))
        .border(1.dp,if(tinted) tone.copy(alpha = .3f) else Jarvis.colors.border,shape).padding(horizontal = 14.dp,vertical = 10.dp),horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        LucideGlyph(icon,size = 16.dp,tint = tone,modifier = Modifier.padding(top = 2.dp))
        Column(Modifier.weight(1f)) {
            Text(part.text,style = MaterialTheme.typography.bodyMedium,color = tone)
            part.detail?.let { Text(it,fontFamily = FontFamily.Monospace,fontSize = 12.sp,color = tone.copy(alpha = .8f)) }
        }
    }
}

/**
 * A message from the user: the task it is about as a pill above the bubble, the quotes it starts with as small quotes
 * at the top of the bubble, the text, then copy and time.
 */
@Composable private fun UserMessage(part: ChatPart, context: ProjectScreenContext?) {
    val attachment = remember(part.text) { splitFileMessage(part.text) }
    var downloadError by remember { mutableStateOf<String?>(null) }
    val download = context?.let { rememberFileDownload(it.backend.client) { message -> downloadError = message } }
    val reference = remember(attachment.text) { io.github.mitzacoder.aiki.features.tasks.parseTaskReference(attachment.text) }
    val quoted = remember(reference.text) { splitQuotes(reference.text) }
    BoxWithConstraints(Modifier.fillMaxWidth()) {
    val widest = minOf(640.dp,maxWidth * .88f)
    Column(Modifier.fillMaxWidth(),horizontalAlignment = Alignment.End,verticalArrangement = Arrangement.spacedBy(6.dp)) {
        reference.taskId?.let { TaskPill(it,Modifier.widthIn(max = widest), showTitle = reference.feedbackId == null, feedbackId = reference.feedbackId) }
        if(attachment.files.isNotEmpty()) CompositionLocalProvider(LocalFileDownload provides download) { FileChips(attachment.files) }
        downloadError?.let { Text(it, color = MaterialTheme.colorScheme.error) }
        if(reference.text.isNotEmpty()) UserMessageSurface(Modifier.widthIn(max = widest)) {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                quoted.quotes.forEachIndexed { index,quote -> key(index) { QuoteBlock(quote) } }
                if(quoted.text.isNotEmpty()) TaskMentions(source = quoted.text, userMessage = true) {
                    ProvideTextStyle(MaterialTheme.typography.bodyLarge) {
                        RichMarkdown(quoted.text, userMessage = true)
                    }
                }
            }
        }
        Row(verticalAlignment = Alignment.CenterVertically,horizontalArrangement = Arrangement.spacedBy(2.dp)) {
            if(reference.text.isNotEmpty()) CopyTextButton(part.text,"Copy message")
            part.timestamp?.let { Text(clockTime(it),style = MaterialTheme.typography.labelSmall,color = Jarvis.colors.fgSubtle) }
        }
    }
    }
}

/** A copy button for a reply or a message; a check for a moment once copied. */
@Composable internal fun CopyTextButton(text: String, label: String) {
    val clipboard = androidx.compose.ui.platform.LocalContext.current.getSystemService(android.content.ClipboardManager::class.java)
    var copied by remember(text) { mutableStateOf(false) }
    LaunchedEffect(copied) { if(copied) { kotlinx.coroutines.delay(1500); copied = false } }
    IconButton(onClick = { runCatching { clipboard.setPrimaryClip(android.content.ClipData.newPlainText(label,text)) }.onSuccess { copied = true } },modifier = Modifier.size(40.dp)) {
        LucideGlyph(if(copied) Lucide.Check else Lucide.Copy,size = 15.dp,contentDescription = if(copied) "Copied" else label,tint = if(copied) Jarvis.colors.success else Jarvis.colors.fgSubtle)
    }
}

/**
 * Under a reply: a line for each request that re-billed much of the cached prompt, then copy and the time; a tap on the
 * time shows the rest (how long it took, the model, the tokens and the cost), a tap on the tokens every count in full.
 */
@Composable private fun TurnFooter(key: String, turn: TurnMeta) {
    var metaOpen by rememberSaveable(key) { mutableStateOf(false) }
    var countsOpen by rememberSaveable(key) { mutableStateOf(false) }
    Column(Modifier.fillMaxWidth().padding(top = 2.dp),verticalArrangement = Arrangement.spacedBy(2.dp)) {
        turn.cacheMisses.forEachIndexed { index,miss -> key(index) { CacheMissLine(miss,"$key-miss-$index") } }
        if(turn.streaming) return@Column
        val elapsed = if(turn.timestamp != null && turn.ended != null) turn.ended - turn.timestamp else null
        val usage = turn.usage
        val hasMeta = (elapsed != null && elapsed > 1000) || turn.model != null || (usage != null && usage.output > 0)
        // The copy button's icon lines up with the reply's text, its touch target reaching past the edge (web `-ml-1.5`).
        FlowRow(if(turn.text.isNotEmpty()) Modifier.offset(x = (-12).dp) else Modifier,verticalArrangement = Arrangement.Center,horizontalArrangement = Arrangement.spacedBy(10.dp),itemVerticalAlignment = Alignment.CenterVertically) {
            if(turn.text.isNotEmpty()) CopyTextButton(turn.text,"Copy reply")
            turn.ended?.let { ended ->
                Text(clockTime(ended),Modifier.clip(RoundedCornerShape(6.dp)).then(if(hasMeta) Modifier.semantics { stateDescription = if(metaOpen) "Showing what this reply took" else "Tap for what this reply took" }
                    .clickable(role = Role.Button,onClickLabel = if(metaOpen) "Hide what this reply took" else "Show what this reply took") { metaOpen = !metaOpen } else Modifier)
                    .padding(horizontal = 4.dp,vertical = 8.dp),style = MaterialTheme.typography.labelSmall,color = Jarvis.colors.fgSubtle)
            }
            if(metaOpen) {
                val meta = MaterialTheme.typography.labelSmall
                if(elapsed != null && elapsed > 1000) Text(shortDuration(elapsed),style = meta,color = Jarvis.colors.fgSubtle)
                turn.model?.let { Text(it,style = meta,color = Jarvis.colors.fgSubtle) }
                if(usage != null && usage.output > 0) Text("↑${compactNumber(usage.input)} ↓${compactNumber(usage.output)}${if(usage.cacheRead > 0) "  ${compactNumber(usage.cacheRead)} cached" else ""}",
                    Modifier.clip(RoundedCornerShape(6.dp)).clickable(role = Role.Button,onClickLabel = "Show every count") { countsOpen = !countsOpen }.padding(horizontal = 4.dp,vertical = 8.dp),style = meta,color = Jarvis.colors.fgSubtle)
                if(usage != null && usage.cost > 0) Text(turnCost(usage.cost),style = meta,color = Jarvis.colors.fgSubtle)
            }
        }
        if(metaOpen && countsOpen && usage != null) Text(turnUsageTitle(usage),style = MaterialTheme.typography.labelSmall,color = Jarvis.colors.fgMuted)
    }
}

@Composable private fun CacheMissLine(miss: CacheMiss, key: String) {
    var open by rememberSaveable(key) { mutableStateOf(false) }
    Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(6.dp)).clickable(role = Role.Button,onClickLabel = if(open) "Hide why" else "Why") { open = !open }.padding(vertical = 6.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically,horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            LucideGlyph(ChatIcons.Coins,size = 14.dp,tint = Jarvis.colors.warning)
            Text(cacheMissLine(miss),style = MaterialTheme.typography.labelSmall,color = Jarvis.colors.fgSubtle,maxLines = if(open) Int.MAX_VALUE else 1,overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis)
        }
        if(open) Text(cacheMissDetail(miss),Modifier.padding(start = 20.dp,top = 4.dp),style = MaterialTheme.typography.labelSmall,color = Jarvis.colors.fgMuted)
    }
}

@Composable private fun CacheWarmLine(part: ChatPart) {
    var expanded by remember(part.key) { mutableStateOf(false) }
    Text(part.text, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
        modifier = Modifier.padding(start = 40.dp).clickable { expanded = true }.padding(vertical = 6.dp))
    if (expanded) AlertDialog(onDismissRequest = { expanded = false }, title = { Text("Prompt cache") },
        text = { Text(part.detail.orEmpty()) }, confirmButton = { TextButton(onClick = { expanded = false }) { Text("Close") } })
}
