package com.mihaisaru.harness.features.chat

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.expandVertically
import androidx.compose.animation.shrinkVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.clickable
import androidx.compose.ui.Alignment
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.mihaisaru.harness.navigation.*
import com.mihaisaru.harness.protocol.*
import com.mihaisaru.harness.ui.components.*
import com.mihaisaru.harness.ui.theme.Jarvis
import kotlinx.serialization.json.*

@Composable internal fun ToolDisclosure(open: Boolean, content: @Composable ColumnScope.() -> Unit) {
    AnimatedVisibility(open,enter = expandVertically() + fadeIn(),exit = shrinkVertically() + fadeOut()) {
        Column(Modifier.fillMaxWidth().padding(bottom = 8.dp),verticalArrangement = Arrangement.spacedBy(8.dp),content = content)
    }
}
@Composable internal fun callTone(part: ChatPart) = when(part.status) {
    "error" -> Jarvis.colors.danger
    "exited","interrupted","cancelled" -> Jarvis.colors.warning
    "done","ok" -> Jarvis.colors.success
    else -> Jarvis.colors.fgMuted
}
@Composable internal fun ToolDiagnostics(part: ChatPart) {
    visibleDiagnostics(part).forEach { diagnostic -> Text(diagnostic.s("message"),style = MaterialTheme.typography.bodySmall,color = when(diagnostic.s("severity")) { "error" -> Jarvis.colors.danger; "warn" -> Jarvis.colors.warning; else -> Jarvis.colors.fgMuted }) }
    var technical by rememberSaveable(part.key) { mutableStateOf(false) }
    TextButton(onClick = { technical = !technical }) { Text(if(technical) "Hide technical details" else "Technical details") }
    ToolDisclosure(technical) {
        val json = Json { prettyPrint = true }
        listOfNotNull(part.arguments,part.details).forEach { RichMarkdown("```json\n${json.encodeToString(JsonElement.serializer(),it)}\n```") }
        if(part.nested.isNotEmpty()) RichMarkdown("```json\n${json.encodeToString(JsonElement.serializer(),JsonArray(part.nested))}\n```")
    }
}
@Composable internal fun DisclosureLine(title: String, icon: LucideIcon, open: Boolean, toggle: () -> Unit, status: String? = null, mono: Boolean = false, tone: Color = Jarvis.colors.fgMuted) {
    Row(Modifier.fillMaxWidth().heightIn(min = 48.dp).semantics { stateDescription = if(open) "Expanded" else "Collapsed" }.clickable(role = Role.Button,onClick = toggle).padding(vertical = 6.dp),verticalAlignment = Alignment.CenterVertically,horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        LucideGlyph(icon,size = 14.dp,tint = Jarvis.colors.fgMuted)
        Text(title,modifier = Modifier.weight(1f),style = MaterialTheme.typography.bodySmall,fontFamily = if(mono) FontFamily.Monospace else FontFamily.Default,maxLines = 1,overflow = TextOverflow.Ellipsis)
        status?.let { Text(it,style = MaterialTheme.typography.labelSmall,color = tone) }
        LucideGlyph(if(open) Lucide.ChevronDown else Lucide.ChevronRight,size = 14.dp,tint = Jarvis.colors.fgMuted)
    }
}
/** The thinking row's words: "Thought", "Thinking", "Thought for a while · 3 steps" (web `thinkingHeaderText`). */
internal fun thinkingHeaderText(steps: Int, active: Boolean): String =
    if(steps <= 1) (if(active) "Thinking" else "Thought") else (if(active) "Thinking" else "Thought for a while") + " · $steps steps"

/**
 * The model's reasoning as the web's `ThinkingBlock`: one quiet inline line, "Thought ›" (shimmering "Thinking" with the
 * last lines as a preview while it thinks), that opens into the steps, each divided from the one before.
 */
@Composable internal fun ThinkingCard(row: ChatRow) {
    var open by rememberSaveable(row.key) { mutableStateOf(false) }
    val steps = row.parts.filter { it.text.isNotBlank() }
    val active = row.parts.lastOrNull()?.status == "running"
    val colors = Jarvis.colors
    val still = com.mihaisaru.harness.features.tasks.rememberReducedMotion()
    Column(Modifier.padding(vertical = 2.dp)) {
        Row(Modifier.heightIn(min = 40.dp).semantics { stateDescription = if(open) "Expanded" else "Collapsed" }
            .clickable(enabled = steps.isNotEmpty(),role = Role.Button) { open = !open }.padding(vertical = 4.dp).padding(end = 8.dp),
            verticalAlignment = Alignment.CenterVertically,horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            LucideGlyph(Lucide.Brain,size = 14.dp,tint = if(active) colors.accent3 else colors.fgSubtle)
            val words = thinkingHeaderText(steps.size,active)
            if(active) ShimmerText(words,animate = !still) else Text(words,style = MaterialTheme.typography.bodySmall,fontWeight = androidx.compose.ui.text.font.FontWeight.Medium,color = colors.fgSubtle)
            if(steps.isNotEmpty()) LucideGlyph(if(open) Lucide.ChevronDown else Lucide.ChevronRight,size = 14.dp,tint = colors.fgSubtle)
        }
        val border = colors.border
        ToolDisclosure(open && steps.isNotEmpty()) {
            Column(Modifier.fillMaxWidth().padding(start = 6.dp).drawBehind { drawLine(border,Offset.Zero,Offset(0f,size.height),strokeWidth = 2.dp.toPx()) }.padding(start = 16.dp)) {
                steps.forEachIndexed { index,step ->
                    if(index > 0) HorizontalDivider(Modifier.padding(vertical = 10.dp),color = border.copy(alpha = .6f))
                    RichMarkdown(step.text.trim())
                }
            }
        }
        if(!open && active) {
            // While it thinks, the tail of the last step, as it arrives.
            val preview = steps.lastOrNull()?.text.orEmpty().trim().lines().filter(String::isNotBlank).takeLast(2).joinToString(" ")
            if(preview.isNotEmpty()) Text(preview,Modifier.padding(start = 20.dp),style = MaterialTheme.typography.bodySmall,color = colors.fgSubtle.copy(alpha = .8f),
                fontStyle = androidx.compose.ui.text.font.FontStyle.Italic,maxLines = 2,overflow = TextOverflow.Ellipsis)
        }
    }
}
@Composable private fun CodingBody(part: ChatPart) {
    if(part.kind == "thinking") RichMarkdown(part.text)
    else codingSections(part).forEach { LiteralCodeBlock(it) }
    part.viaScript?.let { ScriptDisclosure(it,"Original script") }
    if(part.kind == "tool") ToolDiagnostics(part)
}
@Composable internal fun CompactCodingCard(row: ChatRow) {
    var open by rememberSaveable(row.key) { mutableStateOf(false) }
    var selected by rememberSaveable(row.key) { mutableStateOf<String?>(null) }
    val calls = row.parts.filter { it.kind == "tool" }
    val worst = calls.firstOrNull { it.status == "error" } ?: calls.firstOrNull { it.status == "exited" } ?: calls.firstOrNull { it.status in setOf("running","preparing","interrupted") } ?: calls.first()
    // A run reads like the web's header: "Ran 2 commands, read 3 files · 1 thought", with what failed or runs beside it.
    val group = codingGroupSummary(row.parts)
    TranscriptSurface(title = if(calls.size == 1) compactToolHeadline(calls.first()) else group.label,icon = if(calls.first().name == "bash") Lucide.Terminal else Lucide.Code,
        expanded = open,onToggle = { open = !open },subtitle = if(calls.size == 1) toolSummary(calls.first()) else null,status = if(calls.size == 1) friendlyStatus(worst) else group.detail ?: friendlyStatus(worst),tone = callTone(worst),compactHeader = true) {
        ToolDisclosure(open) {
            if(row.parts.size == 1) CodingBody(calls.first())
            else row.parts.forEach { part ->
                key(part.key) {
                    val itemOpen = selected == part.key
                    DisclosureLine(if(part.kind == "thinking") part.text.lineSequence().firstOrNull().orEmpty().ifBlank { "Thought" } else toolSummary(part).ifBlank { compactToolHeadline(part) },
                        if(part.kind == "thinking") Lucide.Brain else when(part.name) { "bash" -> Lucide.Terminal; "write","edit" -> Lucide.FilePenLine; else -> Lucide.FileText },
                        itemOpen,{ selected = if(itemOpen) null else part.key },if(part.kind == "thinking") null else listOfNotNull(friendlyStatus(part),part.durationMs?.let { if(it < 1000) "<1s" else "${it / 1000}s" }).joinToString(" · "),mono = part.kind == "tool",tone = callTone(part))
                    ToolDisclosure(itemOpen) { CodingBody(part) }
                }
            }
        }
    }
}
@Composable private fun ScriptDisclosure(script: String, label: String = "Script") {
    var show by rememberSaveable { mutableStateOf(false) }
    TextButton(onClick = { show = !show }) { LucideGlyph(Lucide.Code); Spacer(Modifier.width(6.dp)); Text(if(show) "Hide $label" else label) }
    ToolDisclosure(show) { LiteralCodeBlock(LiteralSection("Script",script,"javascript")) }
}
@Composable internal fun CodeModeCard(part: ChatPart) {
    var open by rememberSaveable(part.key) { mutableStateOf(false) }
    var selectedCall by rememberSaveable(part.key) { mutableStateOf<Int?>(null) }
    val nestedLabel = part.nested.groupingBy { it.s("name").replace('_',' ') }.eachCount().entries.joinToString(" · ") { "${it.value} ${it.key}" }
    TranscriptSurface(compactToolHeadline(part),Lucide.Code,open,{ open = !open },subtitle = nestedLabel.ifBlank { "Code mode" },status = friendlyStatus(part),tone = callTone(part),compactHeader = true) {
        ToolDisclosure(open) {
            part.arguments.record()?.s("code")?.takeIf(String::isNotBlank)?.let { ScriptDisclosure(it) }
            part.nested.forEachIndexed { index, child ->
                key(child.s("id").ifBlank { index.toString() }) {
                    val childOpen = selectedCall == index
                    val arguments = child["arguments"] ?: child["args"].record()
                    val nested = ChatPart("${part.key}-$index","tool",name = child.s("name"),status = nestedCallStatus(child),arguments = arguments)
                    val failure = child["summary"].obj()?.s("error") ?: child.s("error")
                    DisclosureLine(toolSummary(nested).ifBlank { compactToolHeadline(nested) },when(nested.name) { "bash" -> Lucide.Terminal; "read" -> Lucide.FileText; "write","edit" -> Lucide.FilePenLine; else -> Lucide.Wrench },childOpen,{ selectedCall = if(childOpen) null else index },status = friendlyStatus(nested),mono = true,tone = callTone(nested))
                    ToolDisclosure(childOpen) {
                        if(failure.isNotBlank()) Text(failure,color = callTone(nested))
                        arguments?.let { RichMarkdown("```json\n$it\n```") }
                    }
                }
            }
            if(part.text.isNotBlank()) LiteralCodeBlock(LiteralSection("Output",scriptOutput(part.text),wrap = true))
            ToolDiagnostics(part)
        }
    }
}
@Composable internal fun ThreadToolCard(part: ChatPart, thread: ThreadSummary?, context: ProjectScreenContext?, artifacts: List<Artifact>) {
    var open by rememberSaveable(part.key) { mutableStateOf(false) }
    val failed = part.status in setOf("error","exited")
    val detail = part.arguments.record()?.let { args -> listOf("brief","message","summary").firstNotNullOfOrNull { args.s(it).takeIf(String::isNotBlank) } }
    val line = part.name in setOf("thread_list","thread_peek")
    val tone = if(failed) Jarvis.colors.danger else when(thread?.status) { "failed" -> Jarvis.colors.danger; "done" -> Jarvis.colors.success; "stopped" -> Jarvis.colors.warning; else -> Jarvis.colors.fgMuted }
    val title = if(line) threadCallLabel(part,thread?.title) else thread?.title ?: part.arguments.record()?.s("title")?.takeIf(String::isNotBlank) ?: threadCallId(part) ?: "Background thread"
    TranscriptSurface(title,Lucide.Users,open,{ open = !open },subtitle = if(line) null else threadCallLabel(part,thread?.title),status = if(failed || thread == null) friendlyStatus(part) else threadStatusText(thread.status),tone = tone) {
        if(!line && !failed && thread != null) {
            Text(thread.current ?: thread.failure ?: thread.summary?.let { com.mihaisaru.harness.features.tasks.firstLine(it) }?.takeIf(String::isNotEmpty) ?: "Works in the background",maxLines = 2,style = MaterialTheme.typography.bodySmall,color = Jarvis.colors.fgMuted)
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                if(thread.runningWorkers > 0) Text("${thread.runningWorkers} workers working",style = MaterialTheme.typography.labelSmall)
                if(thread.openQuestions > 0) Text("${thread.openQuestions} questions for you",style = MaterialTheme.typography.labelSmall,color = Jarvis.colors.warning)
                if(thread.ownedTasks.isNotEmpty()) Text("Owns ${thread.ownedTasks.take(3).joinToString()}${if(thread.ownedTasks.size > 3) " +${thread.ownedTasks.size - 3}" else ""}",style = MaterialTheme.typography.labelSmall)
            }
        }
        if(!line && context != null && !failed) {
            if(part.name == "thread_finish" && part.status == "done") threadCallId(part)?.let { TranscriptArtifactStrip(finishArtifacts(artifacts,it,part.timestamp),context) }
            Row(Modifier.fillMaxWidth(),horizontalArrangement = Arrangement.SpaceBetween) {
                if(detail != null) TextButton(onClick = { open = !open }) { LucideGlyph(if(open) Lucide.ChevronDown else Lucide.ChevronRight); Text(when(part.name) { "thread_start" -> "Brief"; "thread_send" -> "Message"; else -> "Summary" }) }
                threadCallId(part)?.let { id -> TextButton(onClick = { context.navigate(context.route.copy(threadId = id.takeUnless { it == "main" },workerId = null)) }) { Text("Open thread") } }
            }
        }
        ToolDisclosure(open) {
            if(detail != null) RichMarkdown(detail)
            if(part.text.isNotBlank()) RichMarkdown(part.text)
            ToolDiagnostics(part)
        }
    }
}

internal fun codingSections(part: ChatPart): List<LiteralSection> {
    if(part.kind != "tool" || part.name !in codingTools) return emptyList()
    val args = part.arguments.record()
    val language = args?.s("path")?.substringAfterLast('.',"").orEmpty()
    val failed = part.status in setOf("error","exited")
    return buildList {
        if(part.name == "bash") args?.s("command")?.takeIf(String::isNotEmpty)?.let { add(LiteralSection("Command",it,"bash",wrapByDefault = true)) }
        if(part.name == "write") args?.s("content")?.takeIf(String::isNotEmpty)?.let { add(LiteralSection("File contents",it,language)) }
        if(part.name == "edit") {
            // The tool's own diff once it ran; before that (or without one) each edit's old and new text.
            val diff = part.details.record()?.s("diff")?.takeIf(String::isNotEmpty)
            if(diff != null) add(LiteralSection("Diff",diff,"diff"))
            else args?.get("edits").objects().forEachIndexed { index,edit -> add(LiteralSection("Edit ${index + 1}",editAsDiff(edit.s("oldText"),edit.s("newText")),"diff")) }
        }
        // A write shows what it wrote and an edit its diff; their output only matters when they failed.
        if(part.text.isNotEmpty() && part.name != "write" && (part.name != "edit" || failed)) add(LiteralSection(
            if(failed) "Error output" else if(part.name == "read") "File contents" else "Output",
            part.text,if(part.name == "read" && !failed) language else "",wrap = true))
    }
}
