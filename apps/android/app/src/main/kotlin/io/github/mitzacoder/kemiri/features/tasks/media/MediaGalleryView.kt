package io.github.mitzacoder.kemiri.features.tasks.media

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.selection.DisableSelection
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.*
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import coil3.compose.AsyncImage
import io.github.mitzacoder.kemiri.data.request
import io.github.mitzacoder.kemiri.features.chat.ArtifactThumb
import io.github.mitzacoder.kemiri.features.chat.artifactKindIcon
import io.github.mitzacoder.kemiri.features.chat.artifactTitle
import io.github.mitzacoder.kemiri.features.tasks.TaskType
import io.github.mitzacoder.kemiri.features.tasks.rememberReducedMotion
import io.github.mitzacoder.kemiri.navigation.ProjectScreenContext
import io.github.mitzacoder.kemiri.protocol.Artifact
import io.github.mitzacoder.kemiri.protocol.ArtifactsListRequest
import io.github.mitzacoder.kemiri.ui.components.LucideGlyph
import io.github.mitzacoder.kemiri.ui.theme.Jarvis
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.launch

/**
 * A task's photos and videos as a carousel (web `MediaGallery`; design: docs/DESIGN.md "Artifact tags and the task media
 * carousel"): tag chips that filter it, one large slide at a time with the neighbours peeking, a thumbnail strip, and a
 * caption with the title, tags and note. An image opens in the full-screen viewer with a shared-element zoom; a video plays
 * in place. A before slide and its after ([comparePairs]) collapse into a compare view by default. With [onUpdateTags] the caption
 * edits the tags. [media] is oldest first ([splitMedia]).
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
internal fun MediaGalleryView(
    context: ProjectScreenContext,
    media: List<Artifact>,
    onUpdateTags: (suspend (Artifact, List<String>) -> Artifact?)?,
    onDetails: (Artifact) -> Unit,
    modifier: Modifier = Modifier,
) {
    val colors = Jarvis.colors
    val reducedMotion = rememberReducedMotion()
    val scope = rememberCoroutineScope()
    var filter by rememberSaveable { mutableStateOf<String?>(null) }
    var anchorId by rememberSaveable { mutableStateOf<String?>(null) }
    var viewerOpen by remember { mutableStateOf(false) }
    var viewerStart by remember { mutableIntStateOf(0) }
    var viewerAutoplay by remember { mutableStateOf(false) }
    val settings by context.repository.settings.collectAsStateWithLifecycle()
    val separate = settings.mediaSeparate
    val playing = remember { mutableStateMapOf<String, Boolean>() }
    val seeks = remember { MutableSharedFlow<Pair<String, Int>>(extraBufferCapacity = 4) }
    val slideRects = remember { SlideRects() }

    // Tags changed here show at once; the stored row (answered, then pushed) takes over.
    val pending = remember { mutableStateMapOf<String, List<String>>() }
    var busy by remember { mutableStateOf(false) }
    var problem by remember { mutableStateOf<String?>(null) }
    var projectWanted by remember { mutableStateOf(false) }
    var projectTagNames by remember { mutableStateOf<List<String>>(emptyList()) }

    val tagged = media.map { item -> pending[item.id]?.let { item.copy(tags = it) } ?: item }
    val counts = tagCounts(tagged)
    val activeFilter = resolveTagFilter(counts, filter)
    val filtered = filterByTag(tagged, activeFilter)
    val slides = mediaSlides(filtered, separate)
    val shown = slides.map { it.artifact }
    val pairs = comparePairs(filtered)
    val comparing = slides.filter { it.pair != null }.map { it.artifact.id }.toSet()
    val keys = shown.map { it.id }
    val labels = slides.mapIndexed { at, slide -> mediaSlideLabel(slide, at, slides.size) }
    val taskTagNames = counts.map { it.tag }

    val pager = rememberPagerState(initialPage = keys.indexOf(anchorId).coerceAtLeast(0)) { shown.size }
    val index = pager.currentPage.coerceIn(0, (shown.size - 1).coerceAtLeast(0))
    val current = shown.getOrNull(index)

    // The slide in view stays in view when the list changes (a save at the end, a delete, a tag change under a filter).
    LaunchedEffect(keys) {
        if (keys.isEmpty()) return@LaunchedEffect
        val at = mediaSlideIndex(slides, anchorId, pager.currentPage)
        if (at != pager.currentPage) pager.scrollToPage(at)
        anchorId = keys[at]
    }
    val latestKeys by rememberUpdatedState(keys)
    LaunchedEffect(pager) { snapshotFlow { pager.currentPage }.collect { page -> latestKeys.getOrNull(page)?.let { anchorId = it } } }
    // Stored rows that agree with a local change end it; a change that never comes back is dropped after a while.
    LaunchedEffect(media) {
        pending.keys.toList().forEach { id -> if (media.firstOrNull { it.id == id }?.tagList() == pending[id]) pending.remove(id) }
    }
    LaunchedEffect(projectWanted) {
        if (!projectWanted) return@LaunchedEffect
        try { projectTagNames = projectTags(context.backend.client.request(ArtifactsListRequest(projectId = media.first().projectId, limit = 100)).artifacts) }
        catch (e: CancellationException) { throw e } catch (_: Exception) {}
    }

    fun goTo(at: Int) { scope.launch { if (reducedMotion) pager.scrollToPage(at) else pager.animateScrollToPage(at, animationSpec = MediaMotion.slide()) } }
    fun setFilter(tag: String?) {
        val keep = current?.id
        val next = mediaSlides(filterByTag(tagged, tag), separate).map { it.artifact }
        filter = tag
        val at = keep?.let { id -> next.indexOfFirst { it.id == id } } ?: -1
        anchorId = next.getOrNull(if (at >= 0) at else 0)?.id
    }
    fun toggleCompare(id: String) {
        anchorId = id
        scope.launch { context.repository.setMediaSeparate(!separate) }
    }
    fun editTags(artifact: Artifact, tags: List<String>) {
        val update = onUpdateTags ?: return
        busy = true
        problem = null
        pending[artifact.id] = tags
        scope.launch {
            try {
                val stored = update(artifact, tags)
                if (stored != null) pending[artifact.id] = stored.tagList()
                delay(4000)
            } catch (e: CancellationException) { throw e }
            catch (cause: Exception) { problem = cause.message ?: "Could not change the tags" }
            finally { pending.remove(artifact.id); busy = false }
        }
    }
    fun openViewer(at: Int) {
        viewerStart = at
        viewerAutoplay = shown.getOrNull(at)?.let { playing[it.id] } == true
        viewerOpen = true
    }

    Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        if (counts.isNotEmpty()) Row(
            Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).semantics { contentDescription = "Filter the media by tag" },
            horizontalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            FilterChip("All", tagged.size, activeFilter == null) { setFilter(null) }
            counts.forEach { entry -> key(entry.tag) { FilterChip(entry.tag, entry.count, activeFilter == entry.tag) { setFilter(if (activeFilter == entry.tag) null else entry.tag) } } }
        }

        MediaCarousel(pager, keys, labels, reducedMotion, onSelect = ::goTo) { at, active ->
            val item = shown.getOrNull(at) ?: return@MediaCarousel
            val pair = pairs[item.id]
            val distance = at - index
            val near = loadsFull(distance)
            DisposableEffect(item.id) { onDispose { slideRects.forget(item.id) } }
            Box(
                Modifier.fillMaxSize().clip(RoundedCornerShape(16.dp)).background(colors.surface2).border(1.dp, colors.border, RoundedCornerShape(16.dp)),
                contentAlignment = Alignment.Center,
            ) {
                val comparingThis = pair != null && item.id in comparing
                when {
                    item.kind == "video" -> MediaVideoSlide(
                        context, item, active = active && !viewerOpen, near = near, onPlayingChange = { playing[item.id] = it },
                        seeks = remember(item.id) { kotlinx.coroutines.flow.flow<Int> { seeks.collect { if (it.first == item.id) emit(it.second) } } },
                    )
                    comparingThis && near -> CompareSlider(context, pair!!.before, pair.after, reducedMotion, onOpen = if (active) ({ openViewer(at) }) else null)
                    else -> MediaImage(context, item, labels[at], near, active, slideRects, onOpen = { openViewer(at) })
                }
                if (item.kind == "image" && pair != null) OverlayPill(
                    label = if (separate) "Compare pairs" else "Show singly",
                    active = active, pressed = comparingThis,
                    modifier = Modifier.align(Alignment.BottomStart).padding(8.dp),
                ) { toggleCompare(item.id) }
                OverlayRound(
                    MediaIcons.Expand, "Open ${artifactTitle(item)} full screen", active,
                    Modifier.align(Alignment.TopEnd).padding(8.dp),
                ) { openViewer(at) }
            }
        }

        if (shown.size > 1) MediaStrip(context, shown, index, pairs.keys, reducedMotion, onSelect = ::goTo)

        MediaCaption(
            artifactId = current?.id, lookup = { id -> shown.firstOrNull { it.id == id } }, task = taskTagNames, project = projectTagNames,
            canEdit = onUpdateTags != null, busy = busy, problem = problem, reducedMotion = reducedMotion,
            onEdit = ::editTags, onFilter = ::setFilter, onDetails = onDetails, onStartEdit = { projectWanted = true },
            seek = { artifact, seconds -> seeks.tryEmit(artifact.id to seconds) },
        )
    }

    if (viewerOpen) MediaViewer(
        context = context, items = shown, startIndex = viewerStart, pairs = pairs, comparing = comparing.toSet(),
        onToggleCompare = ::toggleCompare,
        autoplay = viewerAutoplay, task = taskTagNames, project = projectTagNames, canEdit = onUpdateTags != null, busy = busy, problem = problem,
        reducedMotion = reducedMotion, slideRects = slideRects, seeks = seeks, onEdit = ::editTags, onStartEdit = { projectWanted = true },
        onIndexChange = { at -> if (at != pager.currentPage) scope.launch { pager.scrollToPage(at) } },
        onClose = { viewerOpen = false },
    )
}

/** A tag filter chip: "web 5"; the pressed one is tinted. */
@Composable
private fun FilterChip(label: String, count: Int, pressed: Boolean, onClick: () -> Unit) {
    val colors = Jarvis.colors
    val shape = RoundedCornerShape(50)
    Row(
        Modifier.heightIn(min = 40.dp).clip(shape)
            .clickable(role = Role.Button, onClickLabel = if (pressed) "Show all" else "Show only $label", onClick = onClick)
            .background(if (pressed) colors.accent2.copy(alpha = .12f) else Color.Transparent)
            .border(1.dp, if (pressed) colors.accent2.copy(alpha = .45f) else colors.border, shape)
            .padding(horizontal = 12.dp)
            .semantics { selected = pressed; contentDescription = "$label, $count" },
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(5.dp),
    ) {
        Text(label, style = TaskType.xsMedium, color = if (pressed) colors.fg else colors.fgMuted)
        Text(count.toString(), style = TaskType.xs, color = colors.fgSubtle)
    }
}

/** A small round control over a slide; only the active slide has controls, the peeking neighbours are just pictures. */
@Composable
private fun OverlayRound(icon: io.github.mitzacoder.kemiri.ui.components.LucideIcon, label: String, active: Boolean, modifier: Modifier, onClick: () -> Unit) {
    Box(
        modifier.size(40.dp).alpha(if (active) 1f else 0f).clip(CircleShape).background(Color.Black.copy(alpha = .5f))
            .border(1.dp, Color.White.copy(alpha = .18f), CircleShape)
            .then(if (active) Modifier.clickable(role = Role.Button, onClickLabel = label, onClick = onClick) else Modifier)
            .semantics { if (active) contentDescription = label else invisibleToUser() },
        contentAlignment = Alignment.Center,
    ) { LucideGlyph(icon, size = 16.dp, tint = Color.White) }
}

@Composable
private fun OverlayPill(label: String, active: Boolean, pressed: Boolean, modifier: Modifier, onClick: () -> Unit) {
    val colors = Jarvis.colors
    val shape = RoundedCornerShape(50)
    Row(
        modifier.heightIn(min = 40.dp).alpha(if (active) 1f else 0f).clip(shape)
            .background(if (pressed) colors.accent2 else Color.Black.copy(alpha = .5f))
            .border(1.dp, Color.White.copy(alpha = .18f), shape)
            .then(if (active) Modifier.clickable(role = Role.Button, onClick = onClick) else Modifier)
            .padding(horizontal = 12.dp)
            .semantics { if (!active) invisibleToUser() else stateDescription = if (pressed) "Comparing" else "Not comparing" },
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        LucideGlyph(MediaIcons.ArrowLeftRight, size = 14.dp, tint = Color.White)
        Text(label, color = Color.White, style = TaskType.xsSemibold)
    }
}

/**
 * An image in a carousel slide (web `MediaImage`): fitted into the slide and faded in when it has loaded. Slides far from
 * the active one ([near] false) do not ask for it and show a tinted tile. A tap on the active one opens the viewer.
 */
@Composable
private fun MediaImage(
    context: ProjectScreenContext,
    artifact: Artifact,
    label: String,
    near: Boolean,
    active: Boolean,
    slideRects: SlideRects,
    onOpen: () -> Unit,
) {
    val android = LocalContext.current
    val source = rememberMediaUrl(context, artifact, enabled = near)
    var ready by remember(artifact.id) { mutableStateOf(false) }
    val tint = io.github.mitzacoder.kemiri.features.chat.artifactKindColor("image")
    Box(Modifier.fillMaxSize().onGloballyPositioned { slideRects.place(artifact.id, it) }, contentAlignment = Alignment.Center) {
        if (!ready) Box(Modifier.fillMaxSize().background(tint.copy(alpha = .08f)), contentAlignment = Alignment.Center) {
            LucideGlyph(artifactKindIcon("image"), Modifier.alpha(.6f), size = 32.dp, tint = tint)
        }
        source.value?.let { url ->
            val alphaValue by androidx.compose.animation.core.animateFloatAsState(if (ready) 1f else 0f, androidx.compose.animation.core.tween(260), label = "image-ready")
            AsyncImage(
                model = remember(url) { mediaRequest(android, url, artifact, full = false) },
                contentDescription = label,
                contentScale = ContentScale.Fit,
                modifier = Modifier.fillMaxSize().alpha(alphaValue)
                    .then(if (active) Modifier.clickable(onClickLabel = "Open full screen", onClick = onOpen) else Modifier),
                onSuccess = { state ->
                    ready = true
                    source.loaded()
                    slideRects.size(artifact.id, state.painter.intrinsicSize.width, state.painter.intrinsicSize.height)
                },
                onError = { ready = false; source.failed() },
            )
        }
    }
}
