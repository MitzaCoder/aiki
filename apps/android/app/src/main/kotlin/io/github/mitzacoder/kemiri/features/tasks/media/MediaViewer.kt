package io.github.mitzacoder.kemiri.features.tasks.media

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.platform.LocalWindowInfo
import androidx.compose.ui.semantics.*
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.compose.ui.window.DialogWindowProvider
import androidx.core.view.WindowCompat
import io.github.mitzacoder.kemiri.features.chat.*
import io.github.mitzacoder.kemiri.features.tasks.TaskType
import io.github.mitzacoder.kemiri.navigation.ProjectScreenContext
import io.github.mitzacoder.kemiri.protocol.Artifact
import io.github.mitzacoder.kemiri.ui.components.Lucide
import io.github.mitzacoder.kemiri.ui.components.LucideGlyph
import io.github.mitzacoder.kemiri.ui.components.LucideIcon
import io.github.mitzacoder.kemiri.ui.theme.*
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.filter
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.launch
import kotlin.math.roundToInt

/**
 * The media carousel full screen (web `MediaViewer`): one slide per screen width, an image zoomed and panned
 * ([MediaZoomImage]), a video playing, a before/after compare, the caption with the tags (editable) and the thumbnail
 * strip. It opens with a shared-element flight: the picture grows from where it was in the slide ([slideRects]) to its
 * fitted place, and goes back there on close (back, the close button, or a swipe down at fit, which carries the picture on
 * from where the finger let go). [onIndexChange] tells the carousel behind, so closing lands on the slide the viewer ended
 * on. With [reducedMotion] it only fades. Always dark, whatever the theme.
 */
@Composable
internal fun MediaViewer(
    context: ProjectScreenContext,
    items: List<Artifact>,
    startIndex: Int,
    pairs: Map<String, ComparePair>,
    comparing: Set<String>,
    onToggleCompare: (String) -> Unit,
    autoplay: Boolean,
    task: List<String>,
    project: List<String>,
    canEdit: Boolean,
    busy: Boolean,
    problem: String?,
    reducedMotion: Boolean,
    slideRects: SlideRects,
    seeks: MutableSharedFlow<Pair<String, Int>>,
    onEdit: (Artifact, List<String>) -> Unit,
    onStartEdit: () -> Unit,
    onIndexChange: (Int) -> Unit,
    onClose: () -> Unit,
) {
    val palette = if (Jarvis.colors.neutral) io.github.mitzacoder.kemiri.data.ThemePalette.Neutral else io.github.mitzacoder.kemiri.data.ThemePalette.Jarvis
    val dark = remember(palette) { harnessColors(palette, true) }
    var closeRequest by remember { mutableStateOf(0) }
    Dialog(onDismissRequest = { closeRequest++ }, properties = DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false)) {
        val view = LocalView.current
        SideEffect {
            (view.parent as? DialogWindowProvider)?.window?.let { window ->
                WindowCompat.getInsetsController(window, view).apply {
                    isAppearanceLightStatusBars = false
                    isAppearanceLightNavigationBars = false
                }
            }
        }
        CompositionLocalProvider(LocalJarvisColors provides dark, LocalContentColor provides Color.White) {
            MaterialTheme(colorScheme = harnessColorScheme(dark), typography = HarnessTypography) {
                ViewerContent(
                    context, items, startIndex, pairs, comparing, onToggleCompare, autoplay, task, project, canEdit, busy, problem, reducedMotion,
                    slideRects, seeks, onEdit, onStartEdit, onIndexChange, onClose, closeRequest,
                )
            }
        }
    }
}

private val EASE_OUT = MediaMotion.ease
private val EASE_IN_OUT = MediaMotion.ease

@Composable
private fun ViewerContent(
    context: ProjectScreenContext,
    items: List<Artifact>,
    startIndex: Int,
    pairs: Map<String, ComparePair>,
    comparing: Set<String>,
    onToggleCompare: (String) -> Unit,
    autoplay: Boolean,
    task: List<String>,
    project: List<String>,
    canEdit: Boolean,
    busy: Boolean,
    problem: String?,
    reducedMotion: Boolean,
    slideRects: SlideRects,
    seeks: MutableSharedFlow<Pair<String, Int>>,
    onEdit: (Artifact, List<String>) -> Unit,
    onStartEdit: () -> Unit,
    onIndexChange: (Int) -> Unit,
    onClose: () -> Unit,
    closeRequest: Int,
) {
    val colors = Jarvis.colors
    val density = LocalDensity.current
    // A phone's bar keeps the title, Compare and Close; the zoom buttons are for wider screens (a pinch and a double tap zoom).
    val wideBar = androidx.compose.ui.platform.LocalConfiguration.current.screenWidthDp >= 520
    val scope = rememberCoroutineScope()
    val window = LocalWindowInfo.current.containerSize
    val pager = rememberPagerState(initialPage = startIndex.coerceIn(0, (items.size - 1).coerceAtLeast(0))) { items.size }
    val index = pager.currentPage.coerceIn(0, (items.size - 1).coerceAtLeast(0))
    val current = items.getOrNull(index)
    var selectedVersions by rememberSaveable { mutableStateOf(hashMapOf<String, Long>()) }
    val viewedItems = items.map { selectedArtifactVersion(it, selectedVersions[it.id]) }
    val viewed = viewedItems.getOrNull(index)
    val versions = current?.let(::artifactVersions).orEmpty()
    val versionIndex = versions.indexOfFirst { it.id == viewed?.id }
    val viewingLatest = viewed?.version == current?.version
    val pair = current?.takeIf { viewingLatest }?.let { pairs[it.id] }
    val inCompare = current != null && pair != null && current.id in comparing
    val zooms = remember { mutableStateMapOf<Int, Zoom>() }
    val zoom = zooms[index] ?: ZOOM_FIT
    val zoomable = current?.kind == "image" && !inCompare
    val page = remember { ViewerPage() }
    val flight = remember { FlightState() }
    val pull = remember { Animatable(0f) }
    val backdrop = remember { Animatable(0f) }
    val chrome = remember { Animatable(1f) }
    var closing by remember { mutableStateOf(false) }
    val dismissDistance = with(density) { 90.dp.toPx() }
    val keys = items.map { it.id }
    val labels = items.mapIndexed { at, item -> mediaSlideLabel(MediaSlide(item, if (item.id in comparing) pairs[item.id] else null), at, items.size) }
    val paired = remember(pairs) { pairs.keys }

    var anchorId by remember { mutableStateOf(current?.id) }
    val latestItems by rememberUpdatedState(items)
    LaunchedEffect(keys) {
        val slides = items.map { MediaSlide(it, if (it.id in comparing) pairs[it.id] else null) }
        val at = mediaSlideIndex(slides, anchorId, pager.currentPage)
        pager.scrollToPage(at)
        anchorId = items.getOrNull(at)?.id
    }
    LaunchedEffect(pager) { snapshotFlow { pager.currentPage }.collect {
        latestItems.getOrNull(it)?.let { item -> anchorId = item.id }
        onIndexChange(it)
    } }

    // The flight in: once the page in view is measured, from the slide's picture (or a fade when there is none).
    LaunchedEffect(Unit) {
        snapshotFlow { page.pane.width > 0f || current?.kind != "image" || inCompare }.collect { measured ->
            if (!measured || flight.shown) return@collect
            val item = current ?: return@collect
            delay(16)
            val from = if (item.kind == "image" && !reducedMotion && !inCompare) slideRects.picture(item.id, window.width.toFloat(), window.height.toFloat()) else null
            if (from == null) {
                flight.progress.snapTo(1f)
                flight.shown = true
                backdrop.animateTo(1f, tween(if (reducedMotion) 0 else MediaMotion.viewerOpenMs * 2 / 3))
            } else {
                val picture = page.picture(slideRects.natural(item.id))
                flight.start = flightTransform(from, picture, page.pane)
                flight.progress.snapTo(0f)
                flight.shown = true
                launch { backdrop.animateTo(1f, tween(MediaMotion.viewerOpenMs)) }
                flight.progress.animateTo(1f, tween(MediaMotion.viewerOpenMs, easing = EASE_OUT))
            }
        }
    }

    suspend fun fly(): Unit = kotlinx.coroutines.coroutineScope {
        if (closing) return@coroutineScope
        closing = true
        val item = current
        zooms[index] = ZOOM_FIT
        val from = if (item?.kind == "image" && !reducedMotion && item.id !in comparing) slideRects.picture(item.id, window.width.toFloat(), window.height.toFloat()) else null
        launch { chrome.animateTo(0f, tween(if (reducedMotion) 0 else MediaMotion.viewerCloseMs * 2 / 3)) }
        if (from == null || item == null) {
            backdrop.animateTo(0f, tween(if (reducedMotion) 0 else MediaMotion.viewerCloseMs * 3 / 4))
        } else {
            val picture = page.picture(slideRects.natural(item.id))
            flight.start = flightTransform(from, picture, page.pane)
            launch { delay(20); backdrop.animateTo(0f, tween(MediaMotion.viewerCloseMs)) }
            flight.progress.animateTo(0f, tween(MediaMotion.viewerCloseMs, easing = EASE_IN_OUT))
        }
        onClose()
    }
    LaunchedEffect(closeRequest) { if (closeRequest > 0) fly() }
    val requestClose = { scope.launch { fly() }; Unit }

    fun step(factor: Float) {
        val box = ZoomSize(page.pane.width, page.pane.height)
        val natural = if (page.naturalWidth > 0f) page.naturalWidth to page.naturalHeight else slideRects.natural(current?.id.orEmpty())
        val fit = natural?.let { containedRect(it.first, it.second, Rect(0f, 0f, box.width, box.height)) }?.let { ZoomSize(it.width, it.height) } ?: box
        zooms[index] = zoomAround(zoom, zoom.scale * factor, 0f, 0f, fit, box)
    }

    val pullFraction = (pull.value.coerceAtMost(300f) / 300f)
    Box(Modifier.fillMaxSize().semantics { contentDescription = "Photos and videos, full screen" }) {
        Box(Modifier.fillMaxSize().background(Color(8, 8, 10).copy(alpha = (0.97f - pullFraction * 0.5f).coerceIn(0f, 1f) * backdrop.value)))
        Column(Modifier.fillMaxSize().imePadding()) {
            // The bar: title and position, compare, zoom, close.
            Row(
                Modifier.fillMaxWidth().alpha(chrome.value * (1f - (pull.value.coerceAtMost(140f) / 140f))).statusBarsPadding().padding(horizontal = 8.dp).heightIn(min = 56.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Row(Modifier.weight(1f).padding(horizontal = 8.dp).semantics { heading() }, verticalAlignment = Alignment.CenterVertically) {
                    Text(viewed?.let(::artifactTitle) ?: "Media", Modifier.weight(1f, fill = false), maxLines = 1, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.titleSmall, color = Color.White)
                    Text("${index + 1} / ${items.size}", Modifier.padding(start = 6.dp), style = TaskType.metaMono.copy(fontFamily = FontFamily.Monospace), color = Color.White.copy(alpha = .6f))
                }
                if (current != null && pair != null) TextButton(
                    onClick = { onToggleCompare(current.id) },
                    modifier = Modifier.semantics { stateDescription = if (inCompare) "Comparing" else "Not comparing" },
                    colors = ButtonDefaults.textButtonColors(contentColor = if (inCompare) colors.accent2 else Color.White),
                ) {
                    LucideGlyph(MediaIcons.ArrowLeftRight, size = 16.dp, contentDescription = if (inCompare) "Show singly" else "Compare pairs")
                    if (wideBar) Spacer(Modifier.width(6.dp))
                    Text(if (inCompare) "Show singly" else "Compare", style = TaskType.xsMedium)
                }
                if (zoomable && wideBar) {
                    Text("${(zoom.scale * 100).roundToInt()}%", Modifier.padding(horizontal = 4.dp), style = MaterialTheme.typography.labelMedium, color = Color.White.copy(alpha = .7f))
                    ViewerButton(MediaIcons.ZoomOut, "Zoom out", zoom.scale > ZOOM_MIN) { step(1 / 1.5f) }
                    ViewerButton(MediaIcons.ZoomIn, "Zoom in", zoom.scale < ZOOM_MAX) { step(1.5f) }
                    ViewerButton(MediaIcons.Fit, "Fit", zoom.scale > ZOOM_MIN) { zooms[index] = ZOOM_FIT }
                }
                ViewerButton(Lucide.X, "Close", !closing) { requestClose() }
            }

            if (versions.size > 1 && current != null && viewed != null) {
                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.Center) {
                    IconButton(enabled = versionIndex > 0, onClick = { versions[versionIndex - 1].version?.let { selectedVersions = HashMap(selectedVersions).apply { put(current.id, it) } } }) {
                        Text("←", modifier = Modifier.semantics { contentDescription = "Previous version" })
                    }
                    Text("v${viewed.version ?: 1} of ${current.versionCount ?: versions.size} · ${io.github.mitzacoder.kemiri.features.tasks.relativeTime(viewed.createdAt)}", style = TaskType.xsMedium)
                    IconButton(enabled = versionIndex < versions.lastIndex, onClick = { versions[versionIndex + 1].version?.let { selectedVersions = HashMap(selectedVersions).apply { put(current.id, it) } } }) {
                        Text("→", modifier = Modifier.semantics { contentDescription = "Next version" })
                    }
                }
            }

            Box(Modifier.weight(1f).fillMaxWidth()) {
                HorizontalPager(
                    state = pager,
                    modifier = Modifier.fillMaxSize(),
                    userScrollEnabled = !closing && (!zoomable || zoom.scale <= ZOOM_MIN + 0.01f),
                    key = { items.getOrNull(it)?.id ?: it },
                ) { at ->
                    val root = items[at]
                    val item = viewedItems[at]
                    val active = at == index
                    val itemPair = if (item.version == root.version) pairs[root.id] else null
                    Box(Modifier.fillMaxSize().semantics { contentDescription = labels[at] }) {
                        when {
                            item.kind == "video" -> {
                                val myAutoplay = autoplay && at == startIndex
                                MediaVideoSlide(
                                    context, item, active = active, near = loadsFull(at - index), onPlayingChange = {},
                                    seeks = remember(item.id) { seeks.filter { it.first == item.id }.map { it.second } }, autoplay = myAutoplay,
                                    modifier = Modifier.padding(horizontal = 8.dp),
                                )
                            }
                            itemPair != null && root.id in comparing -> if (loadsFull(at - index)) CompareSlider(context, itemPair.before, itemPair.after, reducedMotion, full = true)
                            loadsFull(at - index) -> MediaZoomImage(
                                context, item, labels[at], active, zooms[at] ?: ZOOM_FIT, { zooms[at] = it }, pull, dismissDistance,
                                onDismiss = { requestClose() }, page = page, flight = flight, slideRects = slideRects,
                            )
                        }
                    }
                }
            }

            Column(
                Modifier.fillMaxWidth().alpha(chrome.value * (1f - (pull.value.coerceAtMost(140f) / 140f))).navigationBarsPadding().padding(horizontal = 12.dp).padding(top = 8.dp, bottom = 4.dp),
                verticalArrangement = Arrangement.spacedBy(4.dp),
            ) {
                Box(Modifier.fillMaxWidth().heightIn(max = 240.dp).verticalScroll(rememberScrollState())) {
                    MediaCaption(
                        artifactId = viewed?.id, lookup = { id -> viewedItems.firstOrNull { it.id == id } }, task = task, project = project, canEdit = canEdit && viewingLatest,
                        busy = busy, problem = problem, reducedMotion = reducedMotion, onEdit = { _, tags -> current?.let { onEdit(it, tags) } }, onFilter = null, onDetails = null, onStartEdit = onStartEdit,
                        seek = { artifact, seconds -> seeks.tryEmit(artifact.id to seconds) },
                    )
                }
                if (items.size > 1) MediaStrip(context, items, index, paired, reducedMotion, onSelect = { at -> scope.launch { if (reducedMotion) pager.scrollToPage(at) else pager.animateScrollToPage(at) } })
            }
        }
    }
}

@Composable
private fun ViewerButton(icon: LucideIcon, label: String, enabled: Boolean, onClick: () -> Unit) {
    IconButton(onClick = onClick, enabled = enabled) {
        LucideGlyph(icon, size = 20.dp, tint = Color.White.copy(alpha = if (enabled) 1f else .35f), contentDescription = label)
    }
}
