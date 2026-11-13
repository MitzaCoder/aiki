package io.github.mitzacoder.kemiri.features.tasks

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.github.mitzacoder.kemiri.protocol.BoardTaskActivity
import io.github.mitzacoder.kemiri.ui.theme.Jarvis
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.*

internal val LocalTaskActivityEnabled = compositionLocalOf { false }

// One clock for all visible activity lines; no server reads or per-row timer jobs.
private val activityMinutes = flow {
    while (true) {
        emit(System.currentTimeMillis())
        delay(60_000)
    }
}.stateIn(CoroutineScope(SupervisorJob() + Dispatchers.Default), SharingStarted.WhileSubscribed(5_000), System.currentTimeMillis())

@Composable
internal fun TaskActivityView(activity: BoardTaskActivity, maxLines: Int = Int.MAX_VALUE, inlineAge: Boolean = false) {
    val now by activityMinutes.collectAsStateWithLifecycle()
    val colors = Jarvis.colors
    val tint = when (activityTone(activity.kind)) {
        ActivityTone.Error -> colors.danger
        ActivityTone.Attention -> colors.warning
        ActivityTone.Active -> colors.accent2
        ActivityTone.Review -> colors.taskStatus(io.github.mitzacoder.kemiri.ui.theme.TaskStatusTone.Review)
        ActivityTone.Muted -> colors.fgSubtle
    }
    val age = activityAge(activity, now)
    Row(Modifier.semantics(mergeDescendants = true) { contentDescription = activityDescription(activity, now) },
        horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.Top) {
        Box(Modifier.padding(top = 6.dp).size(5.dp).background(tint, CircleShape))
        if (inlineAge) Text(buildAnnotatedString {
            append(activity.text)
            if (age.isNotEmpty()) withStyle(SpanStyle(color = colors.fgSubtle)) { append(" · $age") }
        }, Modifier.weight(1f), style = TaskType.xs, color = colors.fgMuted, maxLines = maxLines, overflow = TextOverflow.Ellipsis)
        else Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(activity.text, style = TaskType.xs, color = colors.fgMuted, maxLines = maxLines, overflow = TextOverflow.Ellipsis)
            if (age.isNotEmpty()) Text(age, style = TaskType.meta, color = colors.fgSubtle, maxLines = 1)
        }
    }
}
