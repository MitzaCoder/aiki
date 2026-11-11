package io.github.mitzacoder.aiki.features.tasks.graph

import androidx.compose.animation.core.*
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.*
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.geometry.*
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.rotate
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import io.github.mitzacoder.aiki.ui.theme.Jarvis
import kotlinx.coroutines.launch
import kotlin.math.sin

@Composable
internal fun GraphCreature(status: String, tone: Color, motion: Boolean = false, reporting: Boolean = false, modifier: Modifier = Modifier) {
    val ink = Jarvis.colors.fg
    val phase = if (motion && status in listOf("running", "idle")) {
        val transition = rememberInfiniteTransition(label = "Crew activity")
        val tick by transition.animateFloat(0f, 6.283185f, infiniteRepeatable(tween(if (status == "running") 2400 else 4800, easing = LinearEasing)), label = "Gentle activity")
        tick
    } else 0f
    val spark = remember { Animatable(1f) }
    LaunchedEffect(reporting, motion) {
        if (reporting && motion) { spark.snapTo(0f); spark.animateTo(1f, tween(1400)) } else spark.snapTo(1f)
    }
    Box(modifier.size(32.dp).clearAndSetSemantics { }) {
        Canvas(Modifier.fillMaxSize()) {
            val w = size.width
            val sway = if (status == "running") sin(phase) * 2f else 0f
            val breathe = if (status == "idle") sin(phase) * w * .015f else 0f
            rotate(sway, center) {
                val top = w * .16f - breathe
                drawLine(ink, Offset(w * .48f, top), Offset(w * .53f, w * .04f), w * .035f)
                drawCircle(tone, w * .045f, Offset(w * .53f, w * .04f))
                drawRoundRect(tone.copy(alpha = .55f), Offset(w * .08f, top), Size(w * .84f, w * .70f + breathe), CornerRadius(w * .24f))
                val y = w * .44f
                if (status == "idle") {
                    drawLine(ink, Offset(w * .25f, y), Offset(w * .40f, y), w * .035f)
                    drawLine(ink, Offset(w * .60f, y), Offset(w * .75f, y), w * .035f)
                } else {
                    drawCircle(ink, w * .045f, Offset(w * .32f, y))
                    drawCircle(ink, w * .045f, Offset(w * .68f, y))
                }
                drawLine(ink, Offset(w * .43f, w * .66f), Offset(w * .57f, w * .66f), w * .035f)
                if (status == "running") {
                    val typing = sin(phase * 4) * w * .025f
                    drawRoundRect(ink, Offset(w * .22f, w * .86f), Size(w * .56f, w * .08f), CornerRadius(w * .02f))
                    drawCircle(ink, w * .045f, Offset(w * .29f, w * .80f + typing))
                    drawCircle(ink, w * .045f, Offset(w * .71f, w * .80f - typing))
                }
            }
            if (reporting && motion && spark.value < 1f) {
                val x = w * .53f; val y = w * (.12f - spark.value * .65f)
                val radius = w * .20f
                val star = androidx.compose.ui.graphics.Path().apply {
                    moveTo(x, y - radius); lineTo(x + radius * .25f, y - radius * .25f)
                    lineTo(x + radius, y); lineTo(x + radius * .25f, y + radius * .25f)
                    lineTo(x, y + radius); lineTo(x - radius * .25f, y + radius * .25f)
                    lineTo(x - radius, y); lineTo(x - radius * .25f, y - radius * .25f); close()
                }
                drawPath(star, ink.copy(alpha = 1 - spark.value))
            }
        }
        if (status == "idle") Text("z", color = ink, fontSize = 12.sp, modifier = Modifier.offset(24.dp, (-5).dp))
        if (status == "failed") Text("!", color = ink, fontSize = 16.sp, modifier = Modifier.offset(24.dp, (-3).dp))
    }
}

internal data class GraphCrewPlacement(val id: String, val taskId: String, val status: String, val point: GraphPoint)
internal fun graphCrewPlacements(layout: GraphLayout, model: GraphModel): List<GraphCrewPlacement> {
    val seen = mutableSetOf<String>()
    return layout.cards.values.flatMap { card ->
        val d = model.details[card.id] ?: return@flatMap emptyList()
        val crew = d.workers.filter { it.status !in listOf("done", "stopped") }.map { "worker:${it.id}" to it.status } +
            d.threads.filter { !it.main && !it.archived && it.status != "done" }.map { "thread:${it.id}" to it.status }
        crew.take(3).mapIndexedNotNull { index, (id, status) ->
            if (!seen.add(id)) null else GraphCrewPlacement(id, card.id, status, GraphPoint(card.box.right - 12 - (crew.take(3).size - index) * 36, card.box.y - 30))
        }
    }
}

/** Keyed world positions animate reassignment, not camera pan/zoom. Only near-viewport crew mount. */
@Composable
internal fun GraphCrewLayer(layout: GraphLayout, model: GraphModel, camera: GraphCamera, viewport: GraphRect, reports: Map<String, Long>, motion: Boolean, now: Long) {
    val current = remember(layout, model) { graphCrewPlacements(layout, model).associateBy { it.id } }
    var previous by remember { mutableStateOf(current) }
    val retired = remember { mutableStateMapOf<String, Pair<GraphCrewPlacement, Long>>() }
    val origins = remember { mutableStateMapOf<String, Pair<GraphPoint, Long>>() }
    LaunchedEffect(current) {
        current.forEach { (id, crew) -> previous[id]?.takeIf { it.point != crew.point }?.let { origins[id] = it.point to (System.currentTimeMillis() + 450) } }
        previous.filterKeys { it !in current }.forEach { (id, crew) -> retired[id] = crew.copy(status = "done") to (System.currentTimeMillis() + 400) }
        current.keys.forEach { retired.remove(it) }
        previous = current
    }
    LaunchedEffect(now) {
        retired.keys.filter { retired.getValue(it).second <= now }.forEach { retired.remove(it) }
        origins.keys.filter { origins.getValue(it).second <= now }.forEach { origins.remove(it) }
    }
    val crew = current.values + retired.values.map { it.first }
    crew.forEach { member ->
        val before = origins[member.id]?.first ?: previous[member.id]?.point ?: member.point
        val near = camera.box(GraphRect(member.point.x, member.point.y, 36f, 36f)).overlaps(viewport.expand(180f)) ||
            camera.box(GraphRect(before.x, before.y, 36f, 36f)).overlaps(viewport.expand(180f))
        if (near) key(member.id) {
            val x = remember { Animatable(member.point.x) }; val y = remember { Animatable(member.point.y) }
            val opacity = remember { Animatable(if (motion) 0f else 1f) }
            LaunchedEffect(member.point, motion) {
                if (!motion) { x.snapTo(member.point.x); y.snapTo(member.point.y) }
                else { launch { x.animateTo(member.point.x, tween(400)) }; launch { y.animateTo(member.point.y, tween(400)) } }
            }
            val finished = member.status == "done"
            LaunchedEffect(finished, motion) {
                if (!motion) opacity.snapTo(if (finished) 0f else 1f)
                else opacity.animateTo(if (finished) 0f else 1f, tween(250))
            }
            val screen = camera.point(GraphPoint(x.value, y.value))
            val reporting = reports[member.id]?.let { it > now } == true
            Box(Modifier.offset(screen.x.dp, screen.y.dp).size((32 * camera.zoom).dp).alpha(opacity.value)) {
                key(reports[member.id] ?: 0L) {
                    GraphCreature(member.status, graphTone(if (member.status == "failed") "blocked" else "in_progress"), motion, reporting)
                }
            }
        }
    }
}
