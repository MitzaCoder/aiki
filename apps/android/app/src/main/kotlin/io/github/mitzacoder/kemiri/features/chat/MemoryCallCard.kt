package io.github.mitzacoder.kemiri.features.chat

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import io.github.mitzacoder.kemiri.features.status.StatusGlyphs
import io.github.mitzacoder.kemiri.navigation.ProjectScreenContext
import io.github.mitzacoder.kemiri.ui.components.LucideGlyph
import io.github.mitzacoder.kemiri.ui.components.TranscriptSurface
import io.github.mitzacoder.kemiri.ui.theme.Jarvis

/**
 * One memory tool call, in words (web `MemoryCallCard.svelte`): a search's hits, a read's sections, a write's text and
 * close matches, an archive's reason. A topic opens that file in the Memory panel; an error stays collapsed and red.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable internal fun MemoryCallCard(part: ChatPart, context: ProjectScreenContext?) {
    var open by rememberSaveable(part.key) { mutableStateOf(false) }
    val view = remember(part) { memoryCallView(part) }
    val colors = Jarvis.colors
    // A read, write or archive names one scope; "both" only comes from a search, whose hits carry their own.
    val openTopic: ((String, String) -> Unit)? = context?.let { { fileId, scope -> if (fileId.isNotEmpty()) MemoryFileLinks.open(it, if (scope == "both") "project" else scope, fileId) } }
    TranscriptSurface(view.summary, StatusGlyphs.BookOpen, open, { open = !open }, status = "${memoryScopeBadge(view.scope)} · ${friendlyStatus(part)}", tone = callTone(part)) {
        ToolDisclosure(open) {
            when {
                view.isError -> Text(view.output.ifBlank { "The memory tool failed." }, fontFamily = FontFamily.Monospace, fontSize = 12.5.sp, lineHeight = 20.sp, color = colors.danger)
                view is MemoryCallView.Search ->
                    if (view.hits.isEmpty()) Text("No memories matched.", style = MaterialTheme.typography.bodySmall, fontStyle = FontStyle.Italic, color = colors.fgSubtle)
                    else MemoryTopicRows(view.hits, openTopic)
                view is MemoryCallView.Read -> {
                    MemoryTopicLink(view.title ?: view.fileId, view.fileId, view.scope, openTopic)
                    view.summaryText?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = colors.fgSubtle) }
                    val facts = listOfNotNull(view.tags.takeIf { it.isNotEmpty() }?.let { "Tags: ${it.joinToString(", ")}" }, view.status?.takeIf { it != "active" }?.replaceFirstChar(Char::uppercase))
                    if (facts.isNotEmpty()) Text(facts.joinToString(" · "), style = MaterialTheme.typography.labelSmall, color = colors.fgSubtle)
                    if (view.intro.isNotEmpty()) RichMarkdown(view.intro)
                    view.sections.forEachIndexed { index, section ->
                        if (index > 0 || view.intro.isNotEmpty()) HorizontalDivider(color = colors.border.copy(alpha = .6f))
                        Text(section.heading, style = MaterialTheme.typography.labelLarge, color = colors.fg)
                        RichMarkdown(section.text)
                    }
                    if (view.links.isNotEmpty()) {
                        HorizontalDivider(color = colors.border.copy(alpha = .6f))
                        FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                            view.links.forEach { link ->
                                Text(link.title.ifEmpty { link.fileId }, style = MaterialTheme.typography.labelSmall, color = colors.fgMuted, modifier = Modifier
                                    .clip(RoundedCornerShape(50)).border(BorderStroke(1.dp, colors.border), RoundedCornerShape(50))
                                    .then(if (openTopic != null) Modifier.clickable(role = Role.Button, onClickLabel = "Open ${link.fileId} in Memory") { openTopic(link.fileId, link.scope) } else Modifier)
                                    .padding(horizontal = 10.dp, vertical = 6.dp))
                            }
                        }
                    }
                }
                view is MemoryCallView.Write -> {
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        MemoryTopicLink(view.fileId, view.fileId, view.scope, openTopic, Modifier.weight(1f, fill = false))
                        Text(when (view.outcome) { "created" -> "created"; "unchanged" -> "unchanged"; "suggested" -> "not created"; else -> "updated" }, style = MaterialTheme.typography.labelSmall, color = colors.fgSubtle)
                    }
                    Text((view.heading?.let { "Section · $it" } ?: "Introduction").uppercase(), style = MaterialTheme.typography.labelSmall, fontWeight = FontWeight.SemiBold, color = colors.fgSubtle)
                    if (view.text.isNotBlank()) RichMarkdown(view.text)
                    if (view.closeMatches.isNotEmpty()) {
                        Text("Close matches", style = MaterialTheme.typography.labelSmall, color = colors.fgSubtle)
                        MemoryTopicRows(view.closeMatches, openTopic)
                    }
                }
                view is MemoryCallView.Archive -> {
                    if (view.reason != null) Text(view.reason, style = MaterialTheme.typography.bodyMedium, color = colors.fgMuted)
                    else Text("No reason was given.", style = MaterialTheme.typography.bodySmall, fontStyle = FontStyle.Italic, color = colors.fgSubtle)
                    MemoryTopicLink(view.fileId, view.fileId, view.scope, openTopic)
                }
            }
            ToolDiagnostics(part)
        }
    }
}

/** A topic's name that opens it in the Memory panel. */
@Composable private fun MemoryTopicLink(label: String, fileId: String, scope: String, openTopic: ((String, String) -> Unit)?, modifier: Modifier = Modifier) {
    val colors = Jarvis.colors
    Row(modifier
        .heightIn(min = 40.dp)
        .clip(RoundedCornerShape(8.dp))
        .then(if (openTopic != null && fileId.isNotEmpty()) Modifier.clickable(role = Role.Button, onClickLabel = "Open $fileId in Memory") { openTopic(fileId, scope) } else Modifier)
        .padding(horizontal = 4.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        LucideGlyph(StatusGlyphs.BookOpen, size = 14.dp, tint = colors.accent2)
        Text(label, style = MaterialTheme.typography.labelLarge, color = colors.fg, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}

/** Search hits or close matches: each a row with the topic, its scope, the section and the snippet with matches marked. */
@Composable private fun MemoryTopicRows(rows: List<MemoryTopic>, openTopic: ((String, String) -> Unit)?) {
    val colors = Jarvis.colors
    Column(Modifier.fillMaxWidth()) {
        rows.forEachIndexed { index, row ->
            if (index > 0) HorizontalDivider(color = colors.border.copy(alpha = .6f))
            Column(Modifier.fillMaxWidth()
                .heightIn(min = 48.dp)
                .clip(RoundedCornerShape(8.dp))
                .then(if (openTopic != null) Modifier.clickable(role = Role.Button, onClickLabel = "Open ${row.fileId} in Memory") { openTopic(row.fileId, row.scope) } else Modifier)
                .padding(horizontal = 4.dp, vertical = 8.dp),
                verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(row.title.ifEmpty { row.fileId }, Modifier.weight(1f), style = MaterialTheme.typography.labelLarge, color = colors.fg, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    Text(memoryScopeBadge(row.scope), style = MaterialTheme.typography.labelSmall, color = colors.fgMuted, modifier = Modifier
                        .border(BorderStroke(1.dp, colors.border), RoundedCornerShape(50)).padding(horizontal = 6.dp, vertical = 1.dp))
                }
                Text(row.heading ?: "Introduction", style = MaterialTheme.typography.labelSmall, color = colors.fgSubtle, maxLines = 1, overflow = TextOverflow.Ellipsis)
                if (row.parts.isNotEmpty()) Text(buildAnnotatedString {
                    row.parts.forEach { part ->
                        if (part.match) withStyle(SpanStyle(background = colors.warning.copy(alpha = .3f), color = colors.fg, fontWeight = FontWeight.Medium)) { append(part.text) }
                        else append(part.text)
                    }
                }, style = MaterialTheme.typography.bodySmall, color = colors.fgMuted, maxLines = 3, overflow = TextOverflow.Ellipsis)
            }
        }
    }
}
