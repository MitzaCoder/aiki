package io.github.mitzacoder.aiki.features.chat

import androidx.compose.runtime.*
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.github.mitzacoder.aiki.data.*
import io.github.mitzacoder.aiki.navigation.*
import io.github.mitzacoder.aiki.protocol.*
import kotlinx.coroutines.CancellationException

@Composable internal fun rememberTranscriptArtifacts(context: ProjectScreenContext): List<Artifact> {
    var items by remember(context.route) { mutableStateOf<List<Artifact>>(emptyList()) }
    var revision by remember(context.route) { mutableIntStateOf(0) }
    val connection by context.backend.client.state.collectAsStateWithLifecycle()
    LaunchedEffect(context.route,context.backend.client) {
        context.backend.client.events.collect { event ->
            if(event is ArtifactsChangedEvent && event.projectId == context.route.projectId) {
                if(event.deleted) ChatArtifactMetadata.remove(context.backend.config.key,context.route.projectId,event.artifact.id)
                else ChatArtifactMetadata.keep(context.backend.config.key,event.artifact)
                revision++
                items = items.filterNot { it.id == event.artifact.id } + if(event.deleted) emptyList() else listOf(event.artifact)
            }
        }
    }
    LaunchedEffect(context.route,connection,revision) {
        if(connection.status == ConnectionStatus.Ready && connection.supports("artifacts")) {
            val before = revision
            try {
                val loaded = context.backend.client.request(ArtifactsListRequest(projectId = context.route.projectId,limit = 500)).artifacts
                if(before == revision) { items = loaded; loaded.forEach { ChatArtifactMetadata.keep(context.backend.config.key,it) } }
            } catch(e: CancellationException) { throw e }
            catch(_: Exception) { /* The artifact panel exposes retry/errors; retain last known metadata here. */ }
        }
    }
    return items
}
@Composable internal fun TranscriptArtifactStrip(items: List<Artifact>, context: ProjectScreenContext) {
    if(items.isEmpty()) return
    var expanded by remember { mutableStateOf(false) }
    Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(vertical = 4.dp),horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        (if(expanded) items else items.take(5)).forEach { artifact ->
            key(artifact.id) { ArtifactTile(artifact,context) }
        }
        if(items.size > 5) TextButton(onClick = { expanded = !expanded }) { Text(if(expanded) "Fewer" else "+${items.size-5}") }
    }
}
