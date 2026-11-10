package io.github.mitzacoder.aiki.features.panels

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import io.github.mitzacoder.aiki.data.request
import io.github.mitzacoder.aiki.features.chat.*
import io.github.mitzacoder.aiki.features.tasks.relativeTime
import io.github.mitzacoder.aiki.navigation.ProjectScreenContext
import io.github.mitzacoder.aiki.protocol.*
import io.github.mitzacoder.aiki.ui.components.*
import io.github.mitzacoder.aiki.ui.theme.Jarvis

/** How many rows the section shows before "Show all". */
private const val COLLAPSED_ARTIFACTS = 4

/**
 * The Info tab's Artifacts section for this conversation (a worker's, or main's or a thread's own): its artifacts as
 * rows, newest first, the first few until "Show all"; chips narrow it by kind once it holds more than one; a tap opens
 * the artifact. Hidden while there is none, so a conversation without any keeps its Info tab as it was (web
 * `ArtifactsSection.svelte` with `ArtifactList` rows).
 */
@Composable
internal fun ConversationArtifacts(context: ProjectScreenContext) {
    val route = context.route
    val data = panelData(context, "conversation-artifacts", { it is ArtifactsChangedEvent && it.projectId == route.projectId }) {
        context.backend.client.request(
            if (route.workerId != null) ArtifactsListRequest(projectId = route.projectId, workerId = route.workerId)
            else ArtifactsListRequest(projectId = route.projectId, threadId = route.threadId ?: MAIN_THREAD_ID),
        ).artifacts
    }
    val artifacts = data.value.orEmpty().sortedByDescending { it.createdAt }
    if (artifacts.isEmpty()) return
    var all by rememberSaveable(route) { mutableStateOf(false) }
    var chosenKind by rememberSaveable(route) { mutableStateOf<String?>(null) }
    val counts = artifactKindCounts(artifacts)
    // A kind whose last artifact went away falls back to all.
    val kind = chosenKind?.takeIf { chosen -> counts.any { it.first == chosen } }
    val narrowed = filterByKind(artifacts, kind)
    val now = remember(artifacts) { System.currentTimeMillis() }
    val colors = Jarvis.colors
    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Text("ARTIFACTS (${artifacts.size})", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        if (counts.size > 1) Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            KindChip("All", artifacts.size, kind == null) { chosenKind = null }
            counts.forEach { (each, count) -> KindChip(artifactKindLabel(each, count > 1), count, kind == each) { chosenKind = each } }
        }
        (if (all) narrowed else narrowed.take(COLLAPSED_ARTIFACTS)).forEach { artifact ->
            val title = artifactTitle(artifact)
            Surface(onClick = { context.navigate(stageArtifactDestination(route, artifact)) }, shape = RoundedCornerShape(12.dp),
                color = MaterialTheme.colorScheme.surface.copy(alpha = 0f), modifier = Modifier.semantics { contentDescription = "Open $title" }) {
                Row(Modifier.fillMaxWidth().padding(6.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    ArtifactThumb(context, artifact, Modifier.size(width = 56.dp, height = 40.dp).clip(RoundedCornerShape(8.dp)), duration = false)
                    Column(Modifier.weight(1f)) {
                        Text(title, style = MaterialTheme.typography.bodySmall, fontWeight = FontWeight.Medium, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        Text(listOf(formatMediaDuration(artifact.durationSeconds), artifactDetailSize(artifact.size).orEmpty(), savedByLabel(artifact)).filter { it.isNotEmpty() }.joinToString(" · "),
                            style = MaterialTheme.typography.labelSmall, color = colors.fgSubtle, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    }
                    if (artifact.createdAt.isNotBlank()) Text(relativeTime(artifact.createdAt, now), style = MaterialTheme.typography.labelSmall, color = colors.fgSubtle)
                }
            }
        }
        if (narrowed.size > COLLAPSED_ARTIFACTS) TextButton(onClick = { all = !all }) { Text(if (all) "Show fewer" else "Show all ${narrowed.size}") }
    }
}

/** A kind filter: "Video 1", pressed when chosen (web `ArtifactList`'s chips). */
@Composable
private fun KindChip(label: String, count: Int, selected: Boolean, onClick: () -> Unit) {
    val colors = Jarvis.colors
    Surface(onClick = onClick, shape = RoundedCornerShape(50), color = if (selected) colors.accent2.copy(alpha = .12f) else Color.Transparent,
        border = BorderStroke(1.dp, if (selected) colors.accent2.copy(alpha = .45f) else colors.border),
        modifier = Modifier.semantics { this.selected = selected }) {
        Row(Modifier.heightIn(min = 32.dp).padding(horizontal = 10.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(5.dp)) {
            Text(label, style = MaterialTheme.typography.labelMedium, color = if (selected) colors.fg else colors.fgMuted)
            Text("$count", style = MaterialTheme.typography.labelMedium, color = colors.fgSubtle)
        }
    }
}
