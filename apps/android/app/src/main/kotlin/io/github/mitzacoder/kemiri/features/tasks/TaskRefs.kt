package io.github.mitzacoder.kemiri.features.tasks

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import io.github.mitzacoder.kemiri.features.refs.LocalRefLinks
import io.github.mitzacoder.kemiri.features.refs.RefLines
import io.github.mitzacoder.kemiri.ui.components.Lucide
import io.github.mitzacoder.kemiri.ui.components.LucideGlyph
import io.github.mitzacoder.kemiri.ui.theme.Jarvis

@Composable
internal fun TaskRefs(refs: List<String>, maxHeight: Dp) {
    val colors = Jarvis.colors
    val links = LocalRefLinks.current
    val summary = taskRefSummary(refs.map { links?.status(it) })
    var expanded by rememberSaveable { mutableStateOf(false) }
    Surface(shape = RoundedCornerShape(8.dp), color = colors.bg, border = BorderStroke(1.dp, colors.border)) {
        Column {
            Surface(onClick = { expanded = !expanded }, color = colors.bg,
                modifier = Modifier.fillMaxWidth().semantics { stateDescription = if (expanded) "Expanded" else "Collapsed" }) {
                Row(Modifier.heightIn(min = 44.dp).padding(horizontal = 10.dp, vertical = 6.dp),
                    verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    LucideGlyph(if (expanded) Lucide.ChevronDown else Lucide.ChevronRight, size = 14.dp, tint = colors.fgSubtle)
                    Column(Modifier.weight(1f)) {
                        Text(summary.counts, style = TaskType.xs, color = colors.fgMuted)
                        Text(summary.status, style = TaskType.xs, color = if (summary.attention) colors.danger else colors.fgSubtle)
                    }
                    Text(if (expanded) "Hide" else "Show", style = TaskType.xs, color = colors.fgSubtle)
                }
            }
            if (expanded) {
                HorizontalDivider(color = colors.border)
                Column(Modifier.fillMaxWidth().heightIn(max = maxHeight).clip(RoundedCornerShape(bottomStart = 8.dp, bottomEnd = 8.dp))
                    .verticalScroll(rememberScrollState()).padding(horizontal = 10.dp, vertical = 4.dp)) {
                    RefLines(refs)
                }
            }
        }
    }
}
