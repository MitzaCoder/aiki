package io.github.mitzacoder.aiki.features.chat

import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.github.mitzacoder.aiki.data.HarnessRepository
import io.github.mitzacoder.aiki.data.request
import io.github.mitzacoder.aiki.data.ConnectionStatus
import io.github.mitzacoder.aiki.navigation.Destination
import io.github.mitzacoder.aiki.protocol.ThreadsListRequest

/** URI grants remain owned by the receiving Activity. Selection never sends automatically. */
class SharedFilesState : ViewModel() {
    var uris by mutableStateOf<List<Uri>>(emptyList())
    var target by mutableStateOf<Destination.Chat?>(null)
    var error by mutableStateOf<String?>(null)
    fun clear() { uris = emptyList(); target = null; error = null }
    @Suppress("DEPRECATION")
    fun receive(intent: Intent): Boolean {
        if (intent.action !in listOf(Intent.ACTION_SEND, Intent.ACTION_SEND_MULTIPLE)) return false
        val streams = if (intent.action == Intent.ACTION_SEND_MULTIPLE) intent.getParcelableArrayListExtra<Uri>(Intent.EXTRA_STREAM).orEmpty()
            else listOfNotNull(intent.getParcelableExtra<Uri>(Intent.EXTRA_STREAM))
        val clip = intent.clipData?.let { data -> (0 until data.itemCount).mapNotNull { data.getItemAt(it).uri } }.orEmpty()
        val files = (streams + clip).distinct()
        clear()
        when {
            files.isEmpty() -> error = "This share contains no files. Choose files in the source app."
            files.any { it.scheme != "content" } -> error = "Share files through a document provider, not a filesystem path."
            files.size > 8 -> error = "Share at most 8 attachments at a time."
            else -> uris = files
        }
        return true
    }
}
val LocalSharedFiles = staticCompositionLocalOf<SharedFilesState?> { null }

@Composable
internal fun ShareConversationDialog(repository: HarnessRepository, navigate: (Destination) -> Unit) {
    val shared = LocalSharedFiles.current ?: return
    shared.error?.let { message -> AlertDialog(onDismissRequest = shared::clear, title = { Text("Cannot attach files") }, text = { Text(message) }, confirmButton = { TextButton(onClick = shared::clear) { Text("Close") } }) }
    if (shared.uris.isEmpty() || shared.target != null) return
    val sessions by repository.sessions.collectAsStateWithLifecycle()
    var choices by remember { mutableStateOf<List<Pair<Destination.Chat, String>>>(emptyList()) }
    val projectLists = sessions.map { session -> session.projects.collectAsStateWithLifecycle().value }
    val connections = sessions.map { session -> session.client.state.collectAsStateWithLifecycle().value }
    LaunchedEffect(sessions, projectLists, connections) {
        choices = sessions.filter { it.client.state.value.status == ConnectionStatus.Ready && it.client.state.value.supports("chat-files-v1") }.flatMap { session -> session.projects.value.filter { it.state != "archived" }.map { project -> Destination.Chat(session.config.key, project.id) to "${project.name} · ${session.config.name}" } }
        for (session in sessions) if (session.client.state.value.status == ConnectionStatus.Ready && session.client.state.value.supports("chat-files-v1")) {
            for (project in session.projects.value) {
                runCatching { session.client.request(ThreadsListRequest(projectId = project.id)) }.getOrNull()?.threads?.filter { !it.archived && it.id != "main" }?.forEach { thread ->
                    choices = choices + (Destination.Chat(session.config.key, project.id, threadId = thread.id) to "${project.name} / ${thread.title}")
                }
            }
        }
    }
    AlertDialog(onDismissRequest = shared::clear, title = { Text("Attach ${shared.uris.size} files") }, text = {
        Column(Modifier.heightIn(max = 420.dp).verticalScroll(rememberScrollState())) {
            Text("Choose a conversation. Review the files before sending.")
            if (choices.isEmpty()) Text("Open a connected backend with a project first.")
            choices.forEach { (route, label) -> TextButton(onClick = { shared.target = route; navigate(route) }, modifier = Modifier.fillMaxWidth().sizeIn(minHeight = 48.dp).semantics { contentDescription = "Attach files to $label" }) { Text(label) } }
        }
    }, confirmButton = {}, dismissButton = { TextButton(onClick = shared::clear) { Text("Cancel") } })
}
