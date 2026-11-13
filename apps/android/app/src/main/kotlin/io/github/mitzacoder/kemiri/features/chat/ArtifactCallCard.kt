package io.github.mitzacoder.kemiri.features.chat

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import io.github.mitzacoder.kemiri.navigation.*
import io.github.mitzacoder.kemiri.protocol.*
import io.github.mitzacoder.kemiri.ui.components.*
import io.github.mitzacoder.kemiri.ui.theme.Jarvis

private fun openArtifact(context: ProjectScreenContext, artifact: Artifact) {
    ChatArtifactMetadata.keep(context.backend.config.key, artifact)
    context.navigate(Destination.Artifact(context.route, artifact.id))
}

/** How far a video was watched on this device, as (place, length) in seconds; null when it was never paused part-way. */
@Composable private fun watchedPlace(artifact: Artifact): Pair<Double, Double>? {
    val memory by VideoMemoryStore.memory(LocalContext.current).collectAsState()
    return artifact.durationSeconds?.takeIf { artifact.kind == "video" && it.isFinite() && it > 0 }?.let { total ->
        resumeTime(memory?.positions?.get(videoKey(artifact.projectId, artifactVersionAddress(artifact)))?.time, total)?.let { it to total }
    }
}

/** A thumbnail with a video's watched place along its bottom edge (web poster "2:15 / 4:00"). */
@Composable internal fun WatchedThumb(context: ProjectScreenContext, artifact: Artifact, modifier: Modifier, duration: Boolean = true) {
    val place = watchedPlace(artifact)
    Box(modifier) {
        ArtifactThumb(context, artifact, Modifier.fillMaxSize(), duration = duration)
        place?.let { (time, total) ->
            LinearProgressIndicator(progress = { (time / total).toFloat().coerceIn(0f, 1f) }, modifier = Modifier.fillMaxWidth().height(3.dp).align(Alignment.BottomCenter),
                color = Jarvis.colors.accent2, trackColor = Jarvis.colors.border, drawStopIndicator = {})
        }
    }
}

/** A thread's or task's artifact in the transcript's strip: its thumbnail over its title and facts; opens the viewer. */
@Composable internal fun ArtifactTile(artifact: Artifact, context: ProjectScreenContext) {
    val title = artifactTitle(artifact)
    Card(onClick = { openArtifact(context, artifact) }, modifier = Modifier.width(136.dp), shape = RoundedCornerShape(12.dp), colors = CardDefaults.cardColors(containerColor = Jarvis.colors.surface2)) {
        WatchedThumb(context, artifact, Modifier.fillMaxWidth().height(76.dp).clip(RoundedCornerShape(12.dp)))
        Column(Modifier.padding(10.dp), verticalArrangement = Arrangement.spacedBy(3.dp)) {
            Text(title, style = MaterialTheme.typography.labelLarge, maxLines = 2, overflow = TextOverflow.Ellipsis)
            Text(artifactFacts(artifact), style = MaterialTheme.typography.labelSmall, color = Jarvis.colors.fgMuted, maxLines = 2, overflow = TextOverflow.Ellipsis)
        }
    }
}

/**
 * An `artifact_save` call in the chat as the artifact itself (web `ArtifactCallCard.svelte`): one header with its title,
 * "Saved <file> · 0:20 · 307 KB" and Details, over a video that plays in place ([InlineArtifactVideo]), an image that opens the
 * viewer, or a row that opens a text, audio or other file. A failed call stays a red line that opens into the error.
 */
@Composable internal fun ArtifactCallCard(part: ChatPart, context: ProjectScreenContext?, artifacts: List<Artifact>) {
    val colors = Jarvis.colors
    var open by rememberSaveable(part.key) { mutableStateOf(false) }
    // The success guard is deliberately at the presentation boundary as well as in artifactCallId.
    val deleted = context != null && artifactCallId(part)?.let { ChatArtifactMetadata.isDeleted(context.backend.config.key, context.route.projectId, it) } == true
    val artifact = if (part.status == "done" && context != null && !deleted) artifactCallId(part)?.let { id ->
        artifacts.find { it.id == id } ?: ChatArtifactMetadata.find(context.backend.config.key, context.route.projectId, id) ?: artifactFromTool(part, context.route.projectId)
    } else null
    val args = part.arguments.record()
    val name = args?.s("path")?.substringAfterLast('/')?.ifBlank { null } ?: "a file"
    val heading = artifact?.let(::artifactTitle) ?: args?.s("title")?.takeIf(String::isNotBlank) ?: name
    val failed = part.status in setOf("error", "exited")
    val running = part.status in setOf("running", "preparing")
    val facts = artifact?.let { listOf(formatMediaDuration(it.durationSeconds), artifactDetailSize(it.size).orEmpty(), artifactVersionCount(it)).filter(String::isNotEmpty).joinToString(" · ") }.orEmpty()
    val subtitle = when {
        failed -> "Could not save $name"
        running -> "Saving $name…"
        deleted -> "Deleted"
        part.status == "done" -> "Saved $name" + if (facts.isNotEmpty()) " · $facts" else ""
        else -> "Save interrupted"
    }
    val tone = if (failed) colors.danger else colors.accent2
    Surface(Modifier.fillMaxWidth(), shape = RoundedCornerShape(14.dp), color = colors.surface.copy(alpha = .85f),
        border = BorderStroke(1.dp, if (failed) colors.danger.copy(alpha = .3f) else colors.border)) {
        Column {
            Row(Modifier.fillMaxWidth().heightIn(min = 56.dp).padding(horizontal = 12.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                Box(Modifier.size(30.dp).background(tone.copy(alpha = .12f), RoundedCornerShape(9.dp)), contentAlignment = Alignment.Center) {
                    LucideGlyph(artifactKindIcon(artifact?.kind ?: kindFromName(name)), tint = tone, size = 15.dp)
                }
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    Text(heading, style = MaterialTheme.typography.labelLarge, fontWeight = FontWeight.SemiBold, color = colors.fg, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    Text(subtitle, style = MaterialTheme.typography.bodySmall, color = colors.fgSubtle, maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
                when {
                    failed -> TextButton(onClick = { open = !open }, colors = ButtonDefaults.textButtonColors(contentColor = colors.danger)) {
                        LucideGlyph(Lucide.X, size = 14.dp); Spacer(Modifier.width(4.dp)); Text("failed"); Spacer(Modifier.width(2.dp))
                        LucideGlyph(if (open) Lucide.ChevronDown else Lucide.ChevronRight, size = 14.dp)
                    }
                    running -> CircularProgressIndicator(Modifier.size(14.dp), strokeWidth = 2.dp, color = colors.accent2)
                    artifact != null && context != null -> TextButton(onClick = { openArtifact(context, artifact) }) { Text("Details", color = colors.accent2) }
                    part.status == "done" -> LucideGlyph(Lucide.Check, size = 14.dp, tint = colors.success, contentDescription = "Done")
                }
            }
            if (failed) ToolDisclosure(open) {
                Column(Modifier.padding(horizontal = 12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(part.text.ifBlank { "The artifact was not saved." }, style = MaterialTheme.typography.bodySmall, color = colors.danger)
                    ToolDiagnostics(part)
                }
            } else if (artifact != null && context != null) {
                if (artifact.kind == "video") {
                    InlineArtifactVideo(context, artifact, heading, Modifier.padding(start = 8.dp, end = 8.dp, bottom = 8.dp)) { openArtifact(context, artifact) }
                } else if (artifact.kind == "image") {
                    val shape = RoundedCornerShape(12.dp)
                    WatchedThumb(context, artifact, Modifier.padding(start = 8.dp, end = 8.dp, bottom = 8.dp).fillMaxWidth().aspectRatio(16f / 9f).clip(shape)
                        .clickable(role = Role.Button, onClickLabel = "View $heading") { openArtifact(context, artifact) })
                } else {
                    HorizontalDivider(color = colors.border)
                    Row(Modifier.fillMaxWidth().clickable(role = Role.Button) { openArtifact(context, artifact) }.padding(horizontal = 12.dp, vertical = 8.dp),
                        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        ArtifactThumb(context, artifact, Modifier.size(width = 48.dp, height = 36.dp).clip(RoundedCornerShape(8.dp)), duration = false)
                        Text(when (artifact.kind) { "text" -> "Read it"; "audio" -> "Listen"; else -> "Download or view the details" },
                            Modifier.weight(1f), style = MaterialTheme.typography.bodySmall, color = colors.fgMuted, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        LucideGlyph(Lucide.ChevronRight, size = 14.dp, tint = colors.fgSubtle)
                    }
                }
            }
        }
    }
}
