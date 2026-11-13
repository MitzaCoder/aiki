package io.github.mitzacoder.kemiri.features.tasks

import io.github.mitzacoder.kemiri.protocol.BoardTask

/** Context formerly unique to the summary, kept compact in wrapping header metadata. */
internal fun taskSheetMeta(task: BoardTask, now: Long = System.currentTimeMillis()): List<String> = buildList {
    if (task.status == "waiting" && task.waiting != null) add(waitingSummary(task, now))
    task.subtaskCount?.takeIf { it.total > 0 }?.let { add("Subtasks ${it.done} / ${it.total} done") }
}

internal fun taskWorkerCount(total: Int, running: Int): String =
    if (running > 0) "$total · $running running" else total.toString()
