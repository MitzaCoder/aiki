package io.github.mitzacoder.aiki.features.panels

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.grid.*
import androidx.compose.material3.*
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import io.github.mitzacoder.aiki.features.chat.*
import io.github.mitzacoder.aiki.features.tasks.relativeTime
import io.github.mitzacoder.aiki.navigation.*
import io.github.mitzacoder.aiki.protocol.*
import io.github.mitzacoder.aiki.ui.components.*

/** Lazy tiles only mint preview URLs for composed cells (`ArtifactThumb`). URLs never enter saved state. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable internal fun ArtifactTiles(context: ProjectScreenContext, data: PanelData<List<Artifact>>) {
    val now = remember(data.value) { System.currentTimeMillis() }
    PullToRefreshBox(isRefreshing = data.loading, onRefresh = { data.refresh.trySend(Unit) }, modifier = Modifier.fillMaxSize()) {
        LazyVerticalGrid(columns = GridCells.Adaptive(160.dp), modifier = Modifier.fillMaxSize(), contentPadding = PaddingValues(vertical = 12.dp), horizontalArrangement = Arrangement.spacedBy(10.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            data.error?.let { error -> item(span = { GridItemSpan(maxLineSpan) }) {
                Surface(color = MaterialTheme.colorScheme.errorContainer, shape = MaterialTheme.shapes.medium) {
                    Row(Modifier.padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
                        Text(error, Modifier.weight(1f), style = MaterialTheme.typography.bodySmall)
                        IconAction("Retry artifacts", Lucide.Clock) { data.refresh.trySend(Unit) }
                    }
                }
            } }
            if (data.value == null && !data.loading && data.error == null) item(span = { GridItemSpan(maxLineSpan) }) { WorkbenchEmpty("Waiting for connection", "Saved artifacts will load when the backend reconnects.", Lucide.Paperclip) }
            if (data.value?.isEmpty() == true) item(span = { GridItemSpan(maxLineSpan) }) { WorkbenchEmpty("No matching artifacts", "Saved files and evidence appear here. Try changing the filters.", Lucide.Paperclip) }
            items(data.value.orEmpty(), key = { it.id }) { artifact ->
                OutlinedCard(onClick = {
                    context.navigate(stageArtifactDestination(context.route, artifact))
                }, modifier = Modifier.fillMaxWidth(), shape = MaterialTheme.shapes.medium, colors = CardDefaults.outlinedCardColors(containerColor = MaterialTheme.colorScheme.surfaceContainerLow)) {
                    ArtifactThumb(context, artifact, Modifier.fillMaxWidth().aspectRatio(16f / 9f))
                    Column(Modifier.padding(10.dp), verticalArrangement = Arrangement.spacedBy(5.dp)) {
                        Text(artifactTitle(artifact), style = MaterialTheme.typography.titleSmall, maxLines = 2, overflow = TextOverflow.Ellipsis)
                        Text(listOf(artifact.createdAt.takeIf { it.isNotBlank() }?.let { relativeTime(it, now) }.orEmpty(), artifactDetailSize(artifact.size).orEmpty(), artifactVersionCount(artifact)).filter { it.isNotEmpty() }.joinToString(" · "),
                            style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        Text(savedByLabel(artifact), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        artifact.taskId?.let { PanelMetaChip(it, Lucide.Kanban) }
                        artifact.note?.takeIf { it.isNotBlank() }?.let { Text(it, style = MaterialTheme.typography.bodySmall, maxLines = 2, overflow = TextOverflow.Ellipsis) }
                    }
                }
            }
        }
    }
}
