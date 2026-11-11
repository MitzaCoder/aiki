package io.github.mitzacoder.aiki.features.tasks

import android.content.Context
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.input.key.*
import androidx.compose.ui.platform.LocalContext
import io.github.mitzacoder.aiki.data.readTaskTimeline
import io.github.mitzacoder.aiki.features.refs.LocalRefLinks
import io.github.mitzacoder.aiki.navigation.ProjectScreenContext
import io.github.mitzacoder.aiki.protocol.*
import kotlinx.coroutines.launch
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.CancellationException

internal val LocalTaskSearchHits = compositionLocalOf<Map<String, TaskSearchHit>> { emptyMap() }
internal class TaskSearchState(initial: String, val save: (String) -> Unit) {
    var query by mutableStateOf(initial)
    val index = TaskSearchIndex()
    private var indexedDocuments: List<TaskSearchDocument> = emptyList()
    fun updateDocuments(documents: List<TaskSearchDocument>) {
        if (documents == indexedDocuments) return
        index.update(documents)
        indexedDocuments = documents
    }
    val feedback = mutableStateMapOf<String, Pair<Long, String>>()
    fun change(text: String) { query = text; save(text) }
}
private val projectSearches = mutableMapOf<String, TaskSearchState>()

@Composable
internal fun taskSearchState(context: ProjectScreenContext, tasks: List<BoardTask>): TaskSearchState {
    val key = "${context.backend.config.key}/${context.route.projectId}"
    val preferences = LocalContext.current.applicationContext.getSharedPreferences("aiki.task-search.v1", Context.MODE_PRIVATE)
    val state = remember(key) { projectSearches.getOrPut(key) { TaskSearchState(preferences.getString(key, "").orEmpty()) { preferences.edit().putString(key, it).apply() } } }
    val refs = LocalRefLinks.current
    val feedback = state.feedback.toMap()
    val documents = remember(tasks, refs, feedback) { tasks.map { task ->
        TaskSearchDocument(task.id, task.title, task.refs.flatMap { ref ->
            val title = when (val status = refs?.status(ref)) { is RefStatusPull -> status.title; is RefStatusIssue -> status.title; is RefStatusJira -> status.title; else -> null }
            listOfNotNull(ref, title)
        }, listOf(task.description, task.report.now, task.report.results, task.report.next, feedback[task.id]?.second.orEmpty()).joinToString("\n"), task.parent)
    } }
    // A non-snapshot memoization cache, safe to recompute after an abandoned composition.
    // Documents exclude query; typing never updates or tokenizes the index.
    state.updateDocuments(documents)
    LaunchedEffect(context.board, tasks.map { it.id to it.timelineRevision }) {
        val pending = tasks.filter { task -> task.feedback?.let { it.open + it.handling + it.addressed + it.dismissed > 0 } == true && state.feedback[task.id]?.first != (task.timelineRevision ?: 0L) }.iterator()
        coroutineScope {
            repeat(4) { launch {
                while (pending.hasNext()) {
                    val task = pending.next()
                    try {
                        val timeline = context.backend.client.readTaskTimeline(context.route.projectId, task.id)
                        state.feedback[task.id] = (task.timelineRevision ?: 0L) to timeline.feedback.joinToString("\n") { it.text }
                    } catch (cancelled: CancellationException) { throw cancelled }
                    catch (_: Exception) { /* Retry on the next board update. */ }
                }
            } }
        }
    }
    return state
}

@Composable
internal fun TaskSearchBox(state: TaskSearchState) {
    OutlinedTextField(state.query, state::change, label = { Text("Search tasks") }, singleLine = true,
        modifier = Modifier.fillMaxWidth().onPreviewKeyEvent { event ->
            if (event.key == Key.Escape && event.type == KeyEventType.KeyDown) { state.change(""); true } else false
        }, trailingIcon = { if (state.query.isNotEmpty()) TextButton(onClick = { state.change("") }) { Text("Clear") } })
}
