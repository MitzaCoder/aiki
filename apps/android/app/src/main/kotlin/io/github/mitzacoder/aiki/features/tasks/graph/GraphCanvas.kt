package io.github.mitzacoder.aiki.features.tasks.graph

import androidx.compose.foundation.*
import androidx.compose.foundation.gestures.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.input.pointer.*
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.*
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import io.github.mitzacoder.aiki.ui.theme.Jarvis
import io.github.mitzacoder.aiki.ui.components.Lucide
import io.github.mitzacoder.aiki.ui.components.LucideGlyph
import kotlin.math.*

internal class GraphCanvasState {
    var camera by mutableStateOf<GraphCamera?>(null)
    var detail by mutableStateOf(GraphDetail.Cards)
    var entryZoom = 1f
    var layout: GraphLayout? = null
    private var input: List<GraphLayoutTask>? = null
    var regroup by mutableIntStateOf(0)
    fun geometry(tasks: List<GraphLayoutTask>, options: GraphLayoutOptions): GraphLayout {
        if (tasks != input || layout == null) { layout = layoutGraphFamilies(tasks, layout, options); input = tasks }
        return layout!!
    }
    fun regroup() { layout = null; input = null; regroup++ }
}

/** Family lists keep ordinary single-finger scrolling; only a real two-finger zoom-out enters the canvas. */
internal fun Modifier.graphPinchOut(onPinch: () -> Unit): Modifier = pointerInput(Unit) {
    awaitEachGesture {
        awaitFirstDown(requireUnconsumed = false)
        var zoom = 1f
        do {
            val event = awaitPointerEvent()
            if (event.changes.count { it.pressed } >= 2) {
                zoom *= event.calculateZoom()
                event.changes.forEach { it.consume() }
                if (zoom < .92f) { onPinch(); break }
            }
        } while (event.changes.any { it.pressed })
    }
}

@Composable
internal fun GraphCanvas(
    state: GraphCanvasState, model: GraphModel, families: List<GraphFamily>, familyId: String?, selected: String?, highlight: String?,
    live: GraphLive, now: Long, motion: Boolean, onSelect: (String) -> Unit, onFamily: (String) -> Unit, modifier: Modifier = Modifier,
) {
    val density = LocalDensity.current
    val colors = Jarvis.colors
    val inputs = families.flatMap { it.cards }.mapNotNull { card -> model.details[card.id]?.let { d -> GraphLayoutTask(d.task.id, d.task.parent, d.familyId, d.task.order, d.task.createdAt) } }
    val layout = remember(inputs, state.regroup) { state.geometry(inputs, GraphLayoutOptions(cardWidth = 300f * density.fontScale.coerceAtMost(1.5f), cardHeight = 104f * density.fontScale)) }
    val statusTones = graphStatuses.associate { it.key to graphTone(it.key) }
    Column(modifier.fillMaxSize()) {
        BoxWithConstraints(Modifier.weight(1f).fillMaxWidth().clipToBounds().semantics { isTraversalGroup = true; contentDescription = "Project graph. Pan with one finger, pinch or use zoom controls. Tap a family to read it." }) {
            val width = maxWidth.value; val height = maxHeight.value
            val viewport = GraphRect(0f, 0f, width, height)
            val dotWidth = GRAPH_DOT_LABEL_MIN_WIDTH * density.fontScale.coerceAtMost(1.5f)
            val dotHeight = max(GRAPH_DOT_TARGET_HEIGHT, 60 + 36 * density.fontScale)
            val minimum = graphMinimumDotZoom(layout.families, dotWidth, dotHeight)
            val first = layout.families.firstOrNull { it.id == familyId } ?: layout.families.firstOrNull()
            val camera = state.camera ?: GraphCamera(12 - (first?.bounds?.x ?: 0f) * state.entryZoom, 12 - (first?.bounds?.y ?: 0f) * state.entryZoom, state.entryZoom)
            val detail = graphDetail(camera.zoom, state.detail)
            SideEffect { if (state.camera == null) state.camera = camera; state.detail = detail }
            fun zoom(factor: Float, at: GraphPoint = GraphPoint(width / 2, height / 2)) { state.camera = camera.zoomAt(at, factor, minimum = minimum) }
            LaunchedEffect(selected) {
                val card = selected?.let(layout.cards::get) ?: return@LaunchedEffect
                state.camera = GraphCamera(16 - card.box.x, 48 - card.box.y, 1f)
            }
            val boxes = layout.cards.mapValues { (_, card) -> if (detail == GraphDetail.Pills) card.pill else card.occupied }
            val near = boxes.filterValues { camera.box(it).overlaps(viewport.expand(180f)) }.keys
            val visible = boxes.filterValues { camera.box(it).overlaps(viewport) }.keys
            val relationships = remember(model, layout, selected, familyId) { graphRelationships(model, layout, selected, familyId) }
            val edges = remember(layout, relationships, detail) { routeGraphRelationships(layout, relationships, detail) }
            Box(Modifier.fillMaxSize()
                .pointerInput(width, height, minimum) { detectTransformGestures { centroid, pan, scale, _ ->
                    val c = state.camera ?: camera
                    state.camera = c.zoomAt(GraphPoint(centroid.x / density.density, centroid.y / density.density), scale,
                        GraphPoint(pan.x / density.density, pan.y / density.density), minimum)
                } }
                .pointerInput(width, height) { detectTapGestures(onDoubleTap = { at ->
                    val c = state.camera ?: camera
                    state.camera = c.zoomAt(GraphPoint(at.x / density.density, at.y / density.density), 1.6f, minimum = minimum)
                }) },
            ) {
                if (detail != GraphDetail.Dots) {
                    Canvas(Modifier.fillMaxSize()) {
                        layout.families.filter { camera.box(it.bounds).overlaps(viewport.expand(180f)) }.forEach { f ->
                            val b = camera.box(f.bounds)
                            drawRoundRect(colors.surface2.copy(alpha = .45f), Offset(b.x.dp.toPx(), b.y.dp.toPx()), androidx.compose.ui.geometry.Size(b.width.dp.toPx(), b.height.dp.toPx()), androidx.compose.ui.geometry.CornerRadius(18.dp.toPx()))
                        }
                        edges.filter { it.relationship.from in near || it.relationship.to in near }.forEach { route ->
                            val points = route.points.map { camera.point(it).let { p -> Offset(p.x.dp.toPx(), p.y.dp.toPx()) } }
                            if (points.size < 2) return@forEach
                            val path = Path().apply { moveTo(points[0].x, points[0].y); points.drop(1).forEach { lineTo(it.x, it.y) } }
                            val pattern = when (route.relationship.kind) { "found-while" -> floatArrayOf(2.dp.toPx(), 5.dp.toPx()); "blocked-by" -> floatArrayOf(8.dp.toPx(), 5.dp.toPx()); "related" -> floatArrayOf(8.dp.toPx(), 4.dp.toPx(), 2.dp.toPx(), 4.dp.toPx()); else -> null }
                            val tone = if (route.relationship.kind == "blocked-by") colors.danger else colors.fgMuted
                            drawPath(path, tone, style = Stroke(2.dp.toPx(), pathEffect = pattern?.let { PathEffect.dashPathEffect(it) }))
                            if (route.relationship.kind == "blocked-by") {
                                val tip = points.last(); val before = points[points.lastIndex - 1]
                                val angle = atan2(tip.y - before.y, tip.x - before.x)
                                val arrow = Path().apply { moveTo(tip.x, tip.y); lineTo(tip.x - 9.dp.toPx() * cos(angle - .5f), tip.y - 9.dp.toPx() * sin(angle - .5f)); moveTo(tip.x, tip.y); lineTo(tip.x - 9.dp.toPx() * cos(angle + .5f), tip.y - 9.dp.toPx() * sin(angle + .5f)) }
                                drawPath(arrow, tone, style = Stroke(2.dp.toPx()))
                            }
                        }
                    }
                    layout.families.filter { it.taskIds.isNotEmpty() && camera.box(it.bounds.copy(height = layout.options.headerHeight)).overlaps(viewport) }.forEach { f ->
                        val b = camera.box(f.bounds)
                        TextButton(onClick = { onFamily(f.id) }, modifier = Modifier.offset(b.x.dp, b.y.dp).width(b.width.dp).heightIn(min = 48.dp)) {
                            Text(model.details[f.taskIds.first()]?.familyTitle ?: f.id, fontSize = max(12f, 16 * camera.zoom).sp, maxLines = 1, overflow = TextOverflow.Ellipsis, color = colors.fg)
                        }
                    }
                    near.forEach { id ->
                        val card = layout.cards.getValue(id); val d = model.details[id] ?: return@forEach
                        val b = camera.box(if (detail == GraphDetail.Pills) card.pill else card.box)
                        key(id, detail) {
                            CanvasTask(d, b, detail, selected == id, model.matches(id, highlight), live.glows[id]?.let { it > now } == true, motion,
                                id in live.linger, statusTones.getValue(d.task.status), camera.zoom, now, model.holdsUp(id).total) { onSelect(id) }
                        }
                    }
                    if (detail == GraphDetail.Cards) GraphCrewLayer(layout, model, camera, viewport, live.reports, motion, now)
                } else {
                    val regions = layout.families.filter { it.taskIds.isNotEmpty() }
                    regions.forEach { f ->
                        val p = camera.point(f.bounds.center)
                        val neighbor = regions.filter { it.id != f.id && abs(it.bounds.center.y - f.bounds.center.y) < 100 }.minOfOrNull { abs(it.bounds.center.x - f.bounds.center.x) * camera.zoom }
                        val labelWidth = (neighbor?.minus(GRAPH_DOT_LABEL_GAP) ?: GRAPH_DOT_LABEL_MAX_WIDTH * density.fontScale.coerceAtMost(1.5f)).coerceIn(dotWidth, GRAPH_DOT_LABEL_MAX_WIDTH * density.fontScale.coerceAtMost(1.5f))
                        val b = GraphRect(p.x - labelWidth / 2, p.y - dotHeight / 2, labelWidth, dotHeight)
                        if (b.overlaps(viewport.expand(48f))) {
                            val title = model.details[f.taskIds.first()]?.familyTitle ?: f.id
                            GraphFamilyDot(title, graphDotCounts(model, f.taskIds), b) { onFamily(f.id) }
                        }
                    }
                }
            }
            Surface(modifier = Modifier.align(androidx.compose.ui.Alignment.BottomEnd).padding(12.dp), color = colors.surface2, shape = RoundedCornerShape(18.dp), shadowElevation = 4.dp) {
                Row(Modifier.padding(4.dp)) {
                    IconButton(onClick = { onFamily(familyId ?: first?.id.orEmpty()) }, modifier = Modifier.size(48.dp).semantics { contentDescription = "Back to family view" }) { LucideGlyph(Lucide.Network, size = 20.dp, tint = colors.fg) }
                    IconButton(onClick = { state.camera = graphFitDots(layout.families.filter { it.taskIds.isNotEmpty() }, width, height, dotWidth, dotHeight) }, modifier = Modifier.size(48.dp).semantics { contentDescription = "Fit family overview" }) { LucideGlyph(Lucide.Maximize, size = 20.dp, tint = colors.fg) }
                    IconButton(onClick = { zoom(.82f) }, modifier = Modifier.size(48.dp).semantics { contentDescription = "Zoom out" }) { LucideGlyph(Lucide.Minus, size = 20.dp, tint = colors.fg) }
                    IconButton(onClick = { zoom(1.22f) }, modifier = Modifier.size(48.dp).semantics { contentDescription = "Zoom in" }) { LucideGlyph(Lucide.Plus, size = 20.dp, tint = colors.fg) }
                    if (layout.needsRegroup) IconButton(onClick = { state.regroup() }, modifier = Modifier.size(48.dp).semantics { contentDescription = "Regroup families" }) { LucideGlyph(Lucide.Refresh, size = 20.dp, tint = colors.fg) }
                }
            }
            val offscreen = live.entries.take(8).flatMap { it.change.taskIds }.distinct().filter { it in layout.cards && it !in visible }
            if (offscreen.isNotEmpty()) TextButton(onClick = { onSelect(offscreen.first()) }, modifier = Modifier.align(androidx.compose.ui.Alignment.BottomStart).padding(bottom = 80.dp).heightIn(min = 48.dp).background(colors.bg, RoundedCornerShape(12.dp))) { Text("${offscreen.size} changes off screen") }
        }
    }
}

@Composable
private fun CanvasTask(d: GraphTask, b: GraphRect, detail: GraphDetail, selected: Boolean, matches: Boolean, updated: Boolean, motion: Boolean, finishing: Boolean, tone: androidx.compose.ui.graphics.Color, zoom: Float, now: Long, holdsUp: Int, onSelect: () -> Unit) {
    val colors = Jarvis.colors
    val shape = RoundedCornerShape(if (detail == GraphDetail.Pills) 24.dp else 16.dp)
    val size = max(12f, if (detail == GraphDetail.Pills) 22f * zoom else 14f * zoom).sp
    Column(Modifier.offset(b.x.dp, b.y.dp).size(b.width.dp, max(48f, b.height).dp)
        .border(if (selected || updated && motion) 3.dp else 1.dp, if (selected || updated && motion) colors.fg else tone, shape)
        .background(if (matches) tone.copy(alpha = if (finishing) .035f else if (updated && motion) .28f else .10f) else colors.surface2, shape)
        .clickable(role = Role.Button, onClick = onSelect).semantics(mergeDescendants = true) { contentDescription = graphTaskLabel(d, now); this.selected = selected }
        .padding(if (detail == GraphDetail.Pills) 12.dp else (8 * zoom).dp), verticalArrangement = Arrangement.spacedBy(if (detail == GraphDetail.Pills) 0.dp else (3 * zoom).dp)) {
        if (detail == GraphDetail.Pills) Text("${d.task.id} ${graphStatus(d.task.status).mark} ${d.task.title}", color = colors.fg, fontSize = size, maxLines = 1, overflow = TextOverflow.Ellipsis)
        else {
            Text("${d.task.id}  ${graphStatus(d.task.status).mark} ${graphStatus(d.task.status).label}${if (updated) " · Updated" else ""}", color = colors.fg, fontSize = size, lineHeight = (18 * zoom).sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(d.task.title, color = colors.fg, fontSize = max(12f, 16 * zoom).sp, lineHeight = (20 * zoom).sp, minLines = 2, maxLines = 2, overflow = TextOverflow.Ellipsis)
            Text(graphCanvasMeta(d, holdsUp, now).ifBlank { " " }, color = colors.fg, fontSize = 12.sp, lineHeight = max(14f, 16 * zoom).sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
    }
}
