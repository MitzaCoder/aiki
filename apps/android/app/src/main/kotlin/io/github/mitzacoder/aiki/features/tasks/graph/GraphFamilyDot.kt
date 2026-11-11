package io.github.mitzacoder.aiki.features.tasks.graph

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.*
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import io.github.mitzacoder.aiki.ui.theme.Jarvis

@Composable
internal fun GraphFamilyDot(title: String, counts: GraphDotCounts, box: GraphRect, onOpen: () -> Unit) {
    val colors = Jarvis.colors
    val density = LocalDensity.current
    val measurer = rememberTextMeasurer()
    val labelStyle = MaterialTheme.typography.bodySmall.copy(fontSize = 14.sp, lineHeight = 18.sp, textAlign = TextAlign.Center)
    val label = remember(title, box.width, density.fontScale, density.density) {
        val pixels = with(density) { (box.width - 8).dp.toPx() }
        graphDotLabel(title, pixels) { measurer.measure(it, style = labelStyle, softWrap = false, maxLines = 1).size.width.toFloat() }
    }
    val tones = graphStatuses.associate { it.key to graphTone(it.key) }
    val states = graphStatuses.mapNotNull { status -> counts.statuses[status.key]?.let { "$it ${status.label}" } }.joinToString(", ")
    Column(Modifier.offset(box.x.dp, box.y.dp).width(box.width.dp).heightIn(min = box.height.dp)
        .clickable(role = Role.Button, onClick = onOpen)
        .semantics(mergeDescendants = true) { contentDescription = "$title, ${counts.tasks} tasks, ${counts.needsYou} need you. $states. Open family" },
        horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Box(Modifier.size(52.dp), contentAlignment = Alignment.Center) {
            Canvas(Modifier.fillMaxSize()) {
                val stroke = 4.dp.toPx()
                drawCircle(colors.surface2, radius = (size.minDimension - stroke) / 2)
                var start = -90f
                graphStatuses.forEach { status ->
                    val count = counts.statuses[status.key] ?: 0
                    if (count > 0) {
                        val sweep = 360f * count / counts.tasks.coerceAtLeast(1)
                        drawArc(tones.getValue(status.key), start + 1, (sweep - 2).coerceAtLeast(1f), false,
                            Offset(stroke / 2, stroke / 2), Size(size.width - stroke, size.height - stroke), style = Stroke(stroke))
                        start += sweep
                    }
                }
            }
            Text("${counts.tasks}", color = colors.fg, fontSize = 16.sp, fontWeight = FontWeight.SemiBold)
            if (counts.needsYou > 0) Box(Modifier.align(Alignment.TopEnd).offset(8.dp, (-2).dp).background(colors.fg, CircleShape).padding(horizontal = 5.dp, vertical = 2.dp)) {
                Text("${counts.needsYou}", color = colors.bg, fontSize = 12.sp, lineHeight = 14.sp)
            }
        }
        Text(label, color = colors.fg, style = labelStyle, softWrap = false, maxLines = 2, overflow = TextOverflow.Ellipsis, modifier = Modifier.width((box.width - 8).dp))
    }
}
