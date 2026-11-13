package io.github.mitzacoder.kemiri.features.tasks.media

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.animateScrollBy
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.*
import androidx.compose.ui.unit.dp
import io.github.mitzacoder.kemiri.features.chat.ArtifactThumb
import io.github.mitzacoder.kemiri.features.chat.artifactTitle
import io.github.mitzacoder.kemiri.navigation.ProjectScreenContext
import io.github.mitzacoder.kemiri.protocol.Artifact
import io.github.mitzacoder.kemiri.ui.components.LucideGlyph
import io.github.mitzacoder.kemiri.ui.theme.Jarvis

/**
 * The row of small pictures under the carousel (web `MediaStrip`): one per slide, the current one outlined and kept in
 * the middle, a tap jumps to it. A lazy row, so 50 items are 50 small elements of which a screenful loads. A small mark
 * shows the items that have a before/after partner.
 */
@Composable
internal fun MediaStrip(
    context: ProjectScreenContext,
    items: List<Artifact>,
    index: Int,
    paired: Set<String>,
    reducedMotion: Boolean,
    onSelect: (Int) -> Unit,
    modifier: Modifier = Modifier,
) {
    val colors = Jarvis.colors
    val list = rememberLazyListState()
    val thumbWidth = 56.dp
    val density = LocalDensity.current
    LaunchedEffect(index, items.size) {
        if (index !in items.indices) return@LaunchedEffect
        val viewport = list.layoutInfo.viewportSize.width
        val offset = -((viewport - with(density) { thumbWidth.toPx() }) / 2f).toInt()
        val info = list.layoutInfo.visibleItemsInfo.firstOrNull { it.index == index }
        when {
            reducedMotion -> list.scrollToItem(index, offset)
            // On screen: slide the strip by the distance to the middle, as quickly as the carousel moves.
            info != null -> list.animateScrollBy((info.offset - (viewport - info.size) / 2f), MediaMotion.strip())
            else -> list.scrollToItem(index, offset)
        }
    }
    LazyRow(
        modifier.fillMaxWidth().semantics { contentDescription = "Thumbnails" },
        state = list,
        contentPadding = PaddingValues(horizontal = 4.dp, vertical = 6.dp),
        horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        itemsIndexed(items, key = { _, item -> item.id }) { at, item ->
            val current = at == index
            val shape = RoundedCornerShape(8.dp)
            Box(
                Modifier.size(width = thumbWidth, height = 42.dp).alpha(if (current) 1f else 0.62f)
                    .clip(shape)
                    .border(if (current) BorderStroke(2.dp, colors.accent2) else BorderStroke(1.dp, colors.border), shape)
                    .clickable(onClickLabel = "Show") { onSelect(at) }
                    .semantics {
                        contentDescription = "Go to ${at + 1} of ${items.size}: ${artifactTitle(item)}"
                        selected = current
                    },
            ) {
                ArtifactThumb(context, item, Modifier.fillMaxSize(), duration = false, play = false)
                if (item.id in paired) Box(
                    Modifier.padding(2.dp).size(16.dp).background(Color.Black.copy(alpha = .6f), CircleShape).align(Alignment.TopStart),
                    contentAlignment = Alignment.Center,
                ) { LucideGlyph(MediaIcons.ArrowLeftRight, size = 10.dp, tint = Color.White) }
            }
        }
    }
}
