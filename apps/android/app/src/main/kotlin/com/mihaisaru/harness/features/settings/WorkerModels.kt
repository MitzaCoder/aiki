package com.mihaisaru.harness.features.settings

import com.mihaisaru.harness.protocol.ModelRef
import com.mihaisaru.harness.protocol.WorkerModel

/** Edits of a project's ordered default worker models (web `lib/workers.ts`). Each returns the same list when nothing changes. */
fun sameModel(left: WorkerModel, right: ModelRef) = left.provider == right.provider && left.modelId == right.modelId

fun moveWorkerModel(models: List<WorkerModel>, index: Int, delta: Int): List<WorkerModel> {
    val target = index + delta
    if (index !in models.indices || target !in models.indices || delta == 0) return models
    return models.toMutableList().also { val item = it.removeAt(index); it.add(target, item) }
}

fun removeWorkerModel(models: List<WorkerModel>, model: ModelRef): List<WorkerModel> {
    val next = models.filterNot { sameModel(it, model) }
    return if (next.size == models.size) models else next
}

fun setWorkerModelThinkingLevel(models: List<WorkerModel>, model: ModelRef, level: String?): List<WorkerModel> {
    val index = models.indexOfFirst { sameModel(it, model) }
    if (index < 0 || models[index].thinkingLevel == level) return models
    return models.toMutableList().also { it[index] = it[index].copy(thinkingLevel = level) }
}

/** What identifies a list for "has the backend's answer changed it": models in order with their levels. */
fun workerModelsSignature(models: List<WorkerModel>) = models.joinToString(",") { "${it.provider}/${it.modelId}:${it.thinkingLevel.orEmpty()}" }

/** The check-in interval a text field may hold (web `commitMinutes`): a whole number of minutes from 1 to 1440, else null. */
fun parseCheckInMinutes(text: String): Long? = text.trim().toLongOrNull()?.takeIf { it in 1L..1440L }
