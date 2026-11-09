package com.mihaisaru.harness.features.tasks

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.mihaisaru.harness.data.HarnessFeature
import com.mihaisaru.harness.navigation.ProjectScreenContext
import com.mihaisaru.harness.protocol.BoardTask
import kotlinx.coroutines.launch

/** Shared list/board filters. Top-level is per device; the linked task is per project's live board. */
@Composable
internal fun filteredTasks(context: ProjectScreenContext, tasks: List<BoardTask>): List<BoardTask> {
    val connection by context.backend.client.state.collectAsStateWithLifecycle()
    val settings by context.repository.settings.collectAsStateWithLifecycle()
    val focus by context.board.linkedTask.collectAsStateWithLifecycle()
    return if (connection.supports(HarnessFeature.TASK_LINKS)) applyTaskFilter(tasks, settings.topLevelTasksOnly, focus) else tasks
}

@Composable
internal fun TaskFilters(context: ProjectScreenContext, tasks: List<BoardTask>) {
    val connection by context.backend.client.state.collectAsStateWithLifecycle()
    if (!connection.supports(HarnessFeature.TASK_LINKS)) return
    val settings by context.repository.settings.collectAsStateWithLifecycle()
    val focus by context.board.linkedTask.collectAsStateWithLifecycle()
    val scope = rememberCoroutineScope()
    FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        if (tasks.any { it.parent != null } || settings.topLevelTasksOnly) FilterChip(
            selected = settings.topLevelTasksOnly,
            onClick = { scope.launch { context.repository.setTopLevelTasksOnly(!settings.topLevelTasksOnly) } },
            label = { Text("Top-level only", style = TaskType.xs) },
        )
        focus?.let { id -> InputChip(selected = true, onClick = { context.board.showWithLinked(null) }, label = { Text("Linked to $id · Clear", style = TaskType.xs) }) }
    }
}
