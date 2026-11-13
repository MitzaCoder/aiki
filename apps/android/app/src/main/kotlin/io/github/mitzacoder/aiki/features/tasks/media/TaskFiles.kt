package io.github.mitzacoder.aiki.features.tasks.media

import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import io.github.mitzacoder.aiki.features.chat.*
import io.github.mitzacoder.aiki.features.tasks.TaskType
import io.github.mitzacoder.aiki.features.tasks.relativeTime
import io.github.mitzacoder.aiki.navigation.Destination
import io.github.mitzacoder.aiki.navigation.ProjectScreenContext
import io.github.mitzacoder.aiki.protocol.Artifact
import io.github.mitzacoder.aiki.ui.components.LucideGlyph
import io.github.mitzacoder.aiki.ui.theme.Jarvis

/**
 * The body of a task's Files section (web `TaskFiles`): its photos and videos as the media carousel ([MediaGalleryView])
 * and every other file (logs, text, reports) as the simple rows under it, each opening the artifact's own page.
 * [onUpdateTags] is given only when the backend can change tags (`artifact-tags`).
 */
@Composable
internal fun TaskFiles(
    context: ProjectScreenContext,
    artifacts: List<Artifact>,
    onUpdateTags: (suspend (Artifact, List<String>) -> Artifact?)?,
    modifier: Modifier = Modifier,
) {
    val split = remember(artifacts) { splitMedia(artifacts) }
    fun open(artifact: Artifact) {
        ChatArtifactMetadata.keep(context.backend.config.key, artifact)
        context.navigate(Destination.Artifact(context.route, artifact.id))
    }
    Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        if (split.media.isNotEmpty()) MediaGalleryView(context, split.media, onUpdateTags, onDetails = ::open)
        if (split.files.isNotEmpty()) FileRows(split.files, onOpen = ::open)
    }
}

/** The other files, newest first: four, then all on request. */
@Composable
private fun FileRows(files: List<Artifact>, onOpen: (Artifact) -> Unit) {
    val colors = Jarvis.colors
    var expanded by rememberSaveable { mutableStateOf(false) }
    val limit = 4
    val shown = if (expanded) files else files.take(limit)
    val now = remember(files) { System.currentTimeMillis() }
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        shown.forEach { file ->
            val shape = RoundedCornerShape(10.dp)
            Row(
                Modifier.fillMaxWidth().clip(shape).border(1.dp, colors.border.copy(alpha = .7f), shape)
                    .clickable(onClickLabel = "Open ${artifactTitle(file)}") { onOpen(file) }
                    .heightIn(min = 48.dp).padding(horizontal = 12.dp, vertical = 6.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                LucideGlyph(artifactKindIcon(file.kind), size = 18.dp, tint = artifactKindColor(file.kind))
                Column(Modifier.weight(1f)) {
                    Text(artifactTitle(file), style = TaskType.sectionTitle, color = colors.fg, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    Text(
                        listOf(artifactKindLabel(file.kind), artifactDetailSize(file.size).orEmpty(), artifactVersionCount(file), file.createdAt.takeIf { it.isNotBlank() }?.let { relativeTime(it, now) }.orEmpty())
                            .filter { it.isNotEmpty() }.joinToString(" · "),
                        style = TaskType.meta, color = colors.fgSubtle, maxLines = 1, overflow = TextOverflow.Ellipsis,
                    )
                }
            }
        }
        if (files.size > limit) OutlinedButton(onClick = { expanded = !expanded }, contentPadding = PaddingValues(horizontal = 10.dp)) {
            Text(if (expanded) "Fewer files" else "Show all ${files.size} files", style = TaskType.xsMedium)
        }
    }
}
