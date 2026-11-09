package com.mihaisaru.harness.features.tasks

import androidx.compose.foundation.layout.*
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import com.mihaisaru.harness.protocol.BoardTask
import com.mihaisaru.harness.ui.components.TaskStatusBadge
import com.mihaisaru.harness.ui.theme.Jarvis
import com.mihaisaru.harness.ui.theme.textStyle

internal enum class TaskSummaryKind { Status, Subtasks, Requests, Workers }
internal data class TaskSummaryCell(val kind: TaskSummaryKind, val label: String, val value: String)

/** Presentation counters only: the same optional cells and reading order as the web Dashboard. */
internal fun taskSummaryCells(task: BoardTask, openQuestions: Int, runningWorkers: Int): List<TaskSummaryCell> = buildList {
    add(TaskSummaryCell(TaskSummaryKind.Status, "Status", task.status))
    task.subtaskCount?.takeIf { it.total > 0 }?.let {
        add(TaskSummaryCell(TaskSummaryKind.Subtasks, "Subtasks done", "${it.done} / ${it.total}"))
    }
    val requests = openQuestions + openFeedbackCount(task)
    if (requests > 0) add(TaskSummaryCell(TaskSummaryKind.Requests, "Needs you", "$requests open ${if (requests == 1L) "request" else "requests"}"))
    if (runningWorkers > 0) add(TaskSummaryCell(TaskSummaryKind.Workers, "Workers", "$runningWorkers running"))
}

@Composable
internal fun TaskSummary(task: BoardTask, openQuestions: Int, runningWorkers: Int, twoColumns: Boolean) {
    val colors = Jarvis.colors
    Column(verticalArrangement = Arrangement.spacedBy(16.dp)) {
        FlowRow(
            Modifier.fillMaxWidth(), maxItemsInEachRow = if (twoColumns) 4 else 2,
            horizontalArrangement = Arrangement.spacedBy(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            taskSummaryCells(task, openQuestions, runningWorkers).forEach { cell ->
                Column(Modifier.weight(1f).semantics(mergeDescendants = true) {}, verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Text(cell.label.uppercase(), style = TaskType.heading, color = colors.fgSubtle)
                    if (cell.kind == TaskSummaryKind.Status) TaskStatusBadge(task.status)
                    else Text(cell.value, style = textStyle(1f, 1.4f, weight = 650), color = colors.fg)
                }
            }
        }
        if (task.status == "waiting") Text(waitingSummary(task), style = textStyle(1f, 1.4f, weight = 650), color = colors.fg)
        HorizontalDivider(color = colors.border)
    }
}
