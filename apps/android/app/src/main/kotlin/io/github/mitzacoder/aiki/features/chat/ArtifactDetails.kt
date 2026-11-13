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
import androidx.compose.foundation.selection.selectable
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.Dp
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
/**
 * How much of an HTML artifact is shown as its page (web `TEXT_PREVIEW_BYTES`). More than this opens as the source:
 * half a document renders as something the worker never wrote, and a page can be read further by downloading it.
 */
internal const val ARTIFACT_HTML_PAGE_LIMIT = 256 * 1024
/** Whether an HTML page of this many bytes is too big to show whole, so it opens as its source. */
internal fun artifactPageTooLarge(bytes: Int): Boolean = bytes > ARTIFACT_HTML_PAGE_LIMIT

/** A text artifact's preview: the text shown, and whether the file has more than what is shown. */
internal data class ArtifactPreview(val text: String, val truncated: Boolean)
/**
 * The preview of the bytes fetched for a text artifact (at most [ARTIFACT_TEXT_LIMIT] + 1): an HTML page keeps only
 * [ARTIFACT_HTML_PAGE_LIMIT] bytes, because a page over that opens as its source; other kinds keep them all.
 * [size] is the artifact's recorded size (-1 when unknown); a file the server says is longer is cut short too.
 */
internal fun artifactPreview(bytes: ByteArray, html: Boolean, size: Long = -1): ArtifactPreview {
    val limit = if (html) ARTIFACT_HTML_PAGE_LIMIT else ARTIFACT_TEXT_LIMIT
    val kept = bytes.copyOf(minOf(bytes.size, limit))
    return ArtifactPreview(artifactPreviewText(kept), bytes.size > limit || (size >= 0 && size > kept.size))
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

/**
 * A text artifact read in place: monospace with a wrap toggle; a Markdown one rendered, its source a toggle away; an
 * HTML one the page itself (see [ArtifactPage]), its source a Page/Source toggle away and Copy always copying the
 * source. [pageHeight] is the room the viewer has for a page; none is filled in the chat or a list.
 */
@Composable internal fun ArtifactTextPreview(
    name: String,
    text: String,
    markdown: Boolean = false,
    html: Boolean = false,
    truncated: Boolean = false,
    size: Long = -1,
    pageHeight: Dp? = null,
    copy: (() -> Unit)? = null,
) {
    var wrap by remember(name) { mutableStateOf(true) }
    var showSource by remember(name) { mutableStateOf(false) }
    var view by remember(name) { mutableStateOf(artifactPageView(ArtifactPageChoice.remembered(), truncated)) }
    val rendered = markdown && !showSource
    val page = html && view == ArtifactPageView.Page
    OutlinedCard(Modifier.fillMaxWidth()) {
        Row(Modifier.fillMaxWidth().padding(start = 12.dp), verticalAlignment = Alignment.CenterVertically) {
            Text(name, Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.labelMedium)
            if (html) ArtifactPageToggle(view) { view = it; ArtifactPageChoice.remember(it) }
            if (markdown) TextButton(onClick = { showSource = !showSource }) { Text(if (showSource) "Show rendered" else "Show source") }
            if (!rendered && !page) TextButton(onClick = { wrap = !wrap }) { Text(if(wrap) "Wrap: on" else "Wrap: off") }
            copy?.let { IconButton(onClick = it) { LucideGlyph(Lucide.Copy, size = 16.dp, contentDescription = "Copy text") } }
        }
        HorizontalDivider()
        when {
            page -> ArtifactPage(text, Modifier.fillMaxWidth().height(pageHeight ?: 288.dp).clipToBounds())
            rendered -> RichMarkdown(text.ifEmpty { "(Empty file)" }, Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 12.dp))
            else -> SelectionContainer {
                Text(text.ifEmpty { "(Empty file)" },
                    Modifier.fillMaxWidth().then(if(wrap) Modifier else Modifier.horizontalScroll(rememberScrollState())).padding(12.dp),
                    softWrap = wrap, fontFamily = FontFamily.Monospace, style = MaterialTheme.typography.bodySmall)
            }
        }
        if (truncated) {
            HorizontalDivider()
            Text(
                "The first ${formatBytes((if (html) ARTIFACT_HTML_PAGE_LIMIT else ARTIFACT_TEXT_LIMIT).toLong())}${if (size > 0) " of ${formatBytes(size)}" else ""}; " +
                    (if (html) {
                        if (page) "the page is drawn from that part only"
                        else "a page cannot be shown whole, so this is its source"
                    } else "this is its source") + "; download it for the rest.",
                Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 8.dp),
                style = MaterialTheme.typography.bodySmall, color = Jarvis.colors.fgSubtle)
        }
    }
}

/** The two ways an HTML artifact is read, as the web's Page/Source segmented control. */
@Composable private fun ArtifactPageToggle(view: ArtifactPageView, choose: (ArtifactPageView) -> Unit) {
    Row(Modifier.padding(horizontal = 4.dp).clip(RoundedCornerShape(8.dp)).background(Jarvis.colors.surface2).padding(2.dp),
        horizontalArrangement = Arrangement.spacedBy(2.dp), verticalAlignment = Alignment.CenterVertically) {
        for (option in ArtifactPageView.entries) {
            val chosen = option == view
            val label = if (option == ArtifactPageView.Page) "Page" else "Source"
            Text(label,
                Modifier.clip(RoundedCornerShape(6.dp))
                    .then(if (chosen) Modifier.background(Jarvis.colors.surface) else Modifier)
                    .selectable(selected = chosen, role = Role.Tab) { choose(option) }
                    .padding(horizontal = 10.dp, vertical = 4.dp),
                style = MaterialTheme.typography.labelMedium,
                color = if (chosen) Jarvis.colors.fg else Jarvis.colors.fgSubtle)
        }
    }
}
