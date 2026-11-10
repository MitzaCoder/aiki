package io.github.mitzacoder.aiki.features.chat

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp
import io.github.mitzacoder.aiki.features.status.formatBytes
import io.github.mitzacoder.aiki.features.tasks.relativeTime
import io.github.mitzacoder.aiki.protocol.Artifact
import io.github.mitzacoder.aiki.ui.components.Lucide
import io.github.mitzacoder.aiki.ui.components.LucideGlyph
import io.github.mitzacoder.aiki.ui.theme.Jarvis
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle

/** Route identity survives recreation while metadata is loading; no signed capability is saved. */
internal fun artifactSaveTargetMatches(
    targetBackend: String?, targetProject: String?, targetArtifact: String?,
    currentBackend: String, currentProject: String, viewerArtifactId: String, canSave: Boolean,
): Boolean = canSave && targetBackend == currentBackend && targetProject == currentProject && targetArtifact == viewerArtifactId

internal const val ARTIFACT_TEXT_LIMIT = 1_048_576
internal fun artifactPreviewText(bytes: ByteArray): String {
    require(bytes.size <= ARTIFACT_TEXT_LIMIT)
    return bytes.toString(Charsets.UTF_8)
}
internal enum class ArtifactDeleteState {
    Idle, Confirming, Sending, Gone;
    fun canSubmit(connected: Boolean) = this == Confirming && connected
    fun cancel() = if (this == Confirming) Idle else this
}
/** A size as the web writes it ("820 B", "95 KB", "3.2 MB"); null when unknown. */
internal fun artifactDetailSize(bytes: Long): String? = if (bytes < 0) null else formatBytes(bytes)
internal fun artifactDetailTime(value: String): String? = runCatching {
    DateTimeFormatter.ofLocalizedDateTime(FormatStyle.MEDIUM, FormatStyle.SHORT)
        .withZone(ZoneId.systemDefault()).format(Instant.parse(value))
}.getOrNull()
/**
 * The viewer's line under the title (web `ArtifactDialog` facts): "Video · 0:20 · 307 KB · Main · for T2 · 24 min ago";
 * [exact] gives the saved time as a date instead.
 */
internal fun artifactDetailFacts(item: Artifact, now: Long = System.currentTimeMillis(), exact: Boolean = false): String = listOf(
    artifactKindLabel(item.kind), formatMediaDuration(item.durationSeconds), artifactDetailSize(item.size).orEmpty(), savedByLabel(item),
    item.taskId?.takeIf { it.isNotBlank() }?.let { "for $it" }.orEmpty(),
    item.createdAt.takeIf { it.isNotBlank() }?.let { if (exact) artifactDetailTime(it).orEmpty() else relativeTime(it, now) }.orEmpty(),
).filter { it.isNotEmpty() }.joinToString(" · ")

/** Under the media: the title, the facts (a tap shows the exact time), the note, and where the file was saved from. */
@Composable internal fun ArtifactDetails(item: Artifact, copyPath: (String) -> Unit) {
    var exact by remember(item.id) { mutableStateOf(false) }
    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Text(artifactTitle(item), style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
        Text(artifactDetailFacts(item, exact = exact), style = MaterialTheme.typography.bodySmall, color = Jarvis.colors.fgSubtle,
            modifier = Modifier.clickable(onClickLabel = if (exact) "Show how long ago" else "Show the exact time") { exact = !exact })
    }
    item.note?.takeIf { it.isNotBlank() }?.let {
        Surface(shape = RoundedCornerShape(12.dp), color = Jarvis.colors.surface.copy(alpha = .4f), border = BorderStroke(1.dp, Jarvis.colors.border)) {
            RichMarkdown(it, Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 8.dp))
        }
    }
    if (item.sourcePath.isNotBlank()) Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
        Text("Saved from", style = MaterialTheme.typography.labelSmall, color = Jarvis.colors.fgSubtle)
        Text(item.sourcePath, Modifier.weight(1f), style = MaterialTheme.typography.bodySmall, fontFamily = FontFamily.Monospace, color = Jarvis.colors.fgMuted,
            maxLines = 1, overflow = TextOverflow.Ellipsis)
        IconButton(onClick = { copyPath(item.sourcePath) }) { LucideGlyph(Lucide.Copy, size = 16.dp, tint = Jarvis.colors.fgMuted, contentDescription = "Copy the path") }
    }
}

/** A file without a preview (web `ArtifactPlayer`'s file row): its name and "type · size". */
@Composable internal fun ArtifactFileRow(item: Artifact) {
    Surface(shape = RoundedCornerShape(16.dp), color = Jarvis.colors.surface.copy(alpha = .6f), border = BorderStroke(1.dp, Jarvis.colors.border)) {
        Row(Modifier.fillMaxWidth().padding(12.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Box(Modifier.size(40.dp).background(Jarvis.colors.surface2, RoundedCornerShape(12.dp)), contentAlignment = Alignment.Center) {
                LucideGlyph(artifactKindIcon("file"), size = 20.dp, tint = Jarvis.colors.fgMuted)
            }
            Column(Modifier.weight(1f)) {
                Text(item.name, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Medium, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text(listOf(item.mimeType, artifactDetailSize(item.size).orEmpty()).filter { it.isNotBlank() }.joinToString(" · "),
                    style = MaterialTheme.typography.bodySmall, color = Jarvis.colors.fgSubtle, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text("No preview here. Save a copy to open it with another app.", style = MaterialTheme.typography.bodySmall, color = Jarvis.colors.fgSubtle)
            }
        }
    }
}

/** A text artifact read in place: monospace with a wrap toggle; a Markdown one rendered, its source a toggle away. */
@Composable internal fun ArtifactTextPreview(name: String, text: String, markdown: Boolean = false, copy: (() -> Unit)? = null) {
    var wrap by remember(name) { mutableStateOf(true) }
    var showSource by remember(name) { mutableStateOf(false) }
    val rendered = markdown && !showSource
    OutlinedCard(Modifier.fillMaxWidth()) {
        Row(Modifier.fillMaxWidth().padding(start = 12.dp), verticalAlignment = Alignment.CenterVertically) {
            Text(name, Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.labelMedium)
            if (markdown) TextButton(onClick = { showSource = !showSource }) { Text(if (showSource) "Show rendered" else "Show source") }
            if (!rendered) TextButton(onClick = { wrap = !wrap }) { Text(if(wrap) "Wrap: on" else "Wrap: off") }
            copy?.let { IconButton(onClick = it) { LucideGlyph(Lucide.Copy, size = 16.dp, contentDescription = "Copy text") } }
        }
        HorizontalDivider()
        if (rendered) RichMarkdown(text.ifEmpty { "(Empty file)" }, Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 12.dp))
        else SelectionContainer {
            Text(text.ifEmpty { "(Empty file)" },
                Modifier.fillMaxWidth().then(if(wrap) Modifier else Modifier.horizontalScroll(rememberScrollState())).padding(12.dp),
                softWrap = wrap, fontFamily = FontFamily.Monospace, style = MaterialTheme.typography.bodySmall)
        }
    }
}
