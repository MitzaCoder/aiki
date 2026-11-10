package io.github.mitzacoder.aiki.features.tasks

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.clickable
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.unit.dp
import io.github.mitzacoder.aiki.protocol.BoardTask
import io.github.mitzacoder.aiki.ui.theme.Jarvis

@Composable
internal fun TaskRelationChips(task: BoardTask) {
    val links = LocalTaskLinks.current
    val labels = listOfNotNull(task.parent?.let { "↳ $it" }, subtaskBadgeText(task),
        openFeedbackCount(task).takeIf { it > 0 }?.let { "$it open feedback" })
    if (labels.isEmpty()) return
    FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
        labels.forEach { label ->
            Surface(shape = RoundedCornerShape(6.dp), color = Jarvis.colors.surface2, border = BorderStroke(1.dp, Jarvis.colors.border)) {
                val parent = task.parent?.takeIf { label == "↳ $it" }
                val modifier = if (parent != null && links != null) Modifier.clickable(onClickLabel = "Open parent $parent") { links.open(parent) }
                    .semantics { contentDescription = "Subtask of $parent" } else Modifier
                Text(label, modifier.padding(horizontal = 6.dp, vertical = 2.dp), style = TaskType.meta, color = Jarvis.colors.fgMuted)
            }
        }
    }
}
