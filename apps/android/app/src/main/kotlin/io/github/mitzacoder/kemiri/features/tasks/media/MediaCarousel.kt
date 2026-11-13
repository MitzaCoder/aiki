package io.github.mitzacoder.kemiri.features.tasks.media

import androidx.compose.foundation.clickable
import androidx.compose.foundation.focusable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.PageSize
import androidx.compose.foundation.pager.PagerState
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.key.*
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.semantics.*
import androidx.compose.ui.unit.dp

/** Slides use 84% of the full-width Files area, matching the web Dashboard; no old desktop-width cap. */
private val SLIDE_GAP = 12.dp

/**
 * A row of slides, one at a time, the neighbours peeking (web `MediaCarousel`): a pager with the platform's snapping and
 * momentum. The slide nearest the middle is the active one ([PagerState.currentPage]); the others are a little smaller
 * and dimmer, following the scroll, or only dimmed with [reducedMotion]. A tap on a neighbour brings it to the middle
 * ([onSelect]). What a slide shows is [slide]'s. Hardware keys: arrows, Home and End move by one.
 */
@Composable
internal fun MediaCarousel(
    state: PagerState,
    keys: List<String>,
    labels: List<String>,
    reducedMotion: Boolean,
    onSelect: (Int) -> Unit,
    modifier: Modifier = Modifier,
    slide: @Composable (page: Int, active: Boolean) -> Unit,
) {
    BoxWithConstraints(modifier.fillMaxWidth()) {
        val slideWidth = maxWidth * 0.84f
        val slideHeight = minOf(maxOf(288.dp, maxWidth * 0.48f), LocalConfiguration.current.screenHeightDp.dp * 0.60f)
        val count = keys.size
        HorizontalPager(
            state = state,
            modifier = Modifier.fillMaxWidth().height(slideHeight)
                .semantics { contentDescription = "Photos and videos"; collectionInfo = CollectionInfo(rowCount = 1, columnCount = count) }
                .focusable()
                .onKeyEvent { event ->
                    if (event.type != KeyEventType.KeyDown) return@onKeyEvent false
                    val name = when (event.key) { Key.DirectionLeft -> "ArrowLeft"; Key.DirectionRight -> "ArrowRight"; Key.MoveHome -> "Home"; Key.MoveEnd -> "End"; else -> return@onKeyEvent false }
                    val next = stepIndex(state.currentPage, count, name) ?: return@onKeyEvent false
                    if (next != state.currentPage) onSelect(next)
                    true
                },
            contentPadding = PaddingValues(horizontal = ((maxWidth - slideWidth) / 2).coerceAtLeast(0.dp)),
            pageSize = PageSize.Fixed(slideWidth),
            pageSpacing = SLIDE_GAP,
            key = { keys.getOrElse(it) { "slide-$it" } },
        ) { page ->
            val active = page == state.currentPage
            Box(
                Modifier.fillMaxSize()
                    .graphicsLayer {
                        val offset = (state.currentPage - page) + state.currentPageOffsetFraction
                        if (reducedMotion) alpha = if (page == state.currentPage) 1f else 0.6f
                        else slideLook(offset).let { look -> scaleX = look.scale; scaleY = look.scale; alpha = look.opacity }
                    }
                    .semantics(mergeDescendants = false) {
                        contentDescription = labels.getOrElse(page) { "" }
                        collectionItemInfo = CollectionItemInfo(rowIndex = 0, rowSpan = 1, columnIndex = page, columnSpan = 1)
                        if (active) selected = true
                    },
            ) {
                slide(page, active)
                // The neighbours are just pictures: a tap brings one to the middle instead of acting on what it shows.
                if (!active) Box(
                    Modifier.fillMaxSize().clickable(interactionSource = remember { MutableInteractionSource() }, indication = null, onClickLabel = "Show this one") { onSelect(page) },
                )
            }
        }
    }
}
