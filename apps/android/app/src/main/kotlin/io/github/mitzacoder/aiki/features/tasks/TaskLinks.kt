package io.github.mitzacoder.aiki.features.tasks

import androidx.compose.runtime.*
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.github.mitzacoder.aiki.data.HarnessFeature
import io.github.mitzacoder.aiki.navigation.ProjectScreenContext
import io.github.mitzacoder.aiki.protocol.BoardTask

/**
 * What the chat's components need to name a task: whether it is on the board, its title and status (so a chip wears its
 * row's colour), and how to open its sheet. The Android twin of the web's `lib/task-links.svelte.ts`.
 */
@Stable
class TaskLinks(private val tasks: Map<String, BoardTask>, private val opener: (String) -> Unit) {
    fun knows(taskId: String): Boolean = taskId in tasks
    /** Null for a task the board does not hold (or has not loaded). */
    fun title(taskId: String): String? = tasks[taskId]?.title
    fun status(taskId: String): String? = tasks[taskId]?.status
    fun task(taskId: String): BoardTask? = tasks[taskId]
    fun open(taskId: String) = opener(taskId)
}

/**
 * Null outside a project chat, in a worker's transcript, on a backend without `task-reports` and before the board has
 * loaded; then the chat shows no task links and every line still reads on its own.
 */
val LocalTaskLinks = compositionLocalOf<TaskLinks?> { null }

/** Offers [TaskLinks] from the project's shared board to everything in [content]. */
@Composable
fun ProvideTaskLinks(context: ProjectScreenContext?, content: @Composable () -> Unit) {
    if (context == null || context.route.workerId != null) {
        CompositionLocalProvider(LocalTaskLinks provides null, content = content)
        return
    }
    val latest by rememberUpdatedState(context)
    val connection by context.backend.client.state.collectAsStateWithLifecycle()
    val view by context.board.view.collectAsStateWithLifecycle()
    val supported = connection.supports(HarnessFeature.TASK_REPORTS)
    val links = remember(supported, view.loaded, view.tasks) {
        if (supported && view.loaded) TaskLinks(view.tasks.associateBy { it.id }) { latest.openTask(it) } else null
    }
    CompositionLocalProvider(LocalTaskLinks provides links, content = content)
}
