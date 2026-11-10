package io.github.mitzacoder.aiki.features.tasks.media

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.ContentTransform
import androidx.compose.animation.EnterTransition
import androidx.compose.animation.ExitTransition
import androidx.compose.animation.SizeTransform
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.LocalContentColor
import androidx.compose.material3.ProvideTextStyle
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.layout.Layout
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.layout.layout
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.*
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Constraints
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import io.github.mitzacoder.aiki.features.chat.*
import io.github.mitzacoder.aiki.features.tasks.TaskType
import io.github.mitzacoder.aiki.features.tasks.relativeTime
import io.github.mitzacoder.aiki.features.tasks.TaskIcons
import io.github.mitzacoder.aiki.protocol.Artifact
import io.github.mitzacoder.aiki.ui.components.Lucide
import io.github.mitzacoder.aiki.ui.components.LucideGlyph
import io.github.mitzacoder.aiki.ui.theme.Jarvis
import io.github.mitzacoder.aiki.ui.theme.Text as TextStyles

/** A tag as a small pill; tappable (shows only that tag) when [onClick] is given. */
@Composable
internal fun TagChip(tag: String, onClick: (() -> Unit)? = null) {
    val colors = Jarvis.colors
    val shape = RoundedCornerShape(50)
    Text(
        tag,
        Modifier.clip(shape).background(colors.accent2.copy(alpha = .10f)).border(1.dp, colors.accent2.copy(alpha = .24f), shape)
            .then(if (onClick != null) Modifier.clickable(role = Role.Button, onClickLabel = "Show only $tag", onClick = onClick) else Modifier)
            .padding(horizontal = 9.dp, vertical = 3.dp),
        style = TaskType.meta.copy(fontWeight = FontWeight.Medium), color = colors.fgMuted,
    )
}

/**
 * Under a slide (web `MediaCaption`): the title, what the file is, its tags as chips (a tap shows only that tag), and
 * the note as Markdown clamped to three lines with "more". It cross-fades when the slide changes. With [canEdit] a pencil
 * opens the tag editor; [onDetails] adds an Info button that opens the artifact's own page. [lookup] reads the row of an
 * ID, so the one fading out still shows its own words.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
internal fun MediaCaption(
    artifactId: String?,
    lookup: (String) -> Artifact?,
    task: List<String>,
    project: List<String>,
    canEdit: Boolean,
    busy: Boolean,
    problem: String?,
    reducedMotion: Boolean,
    onEdit: (Artifact, List<String>) -> Unit,
    onFilter: ((String) -> Unit)?,
    onDetails: ((Artifact) -> Unit)?,
    onStartEdit: () -> Unit,
    modifier: Modifier = Modifier,
    seek: ((Artifact, Int) -> Unit)? = null,
) {
    val colors = Jarvis.colors
    val duration = if (reducedMotion) 0 else MediaMotion.captionMs
    AnimatedContent(
        targetState = artifactId,
        modifier = modifier.fillMaxWidth(),
        transitionSpec = {
            if (duration == 0) ContentTransform(EnterTransition.None, ExitTransition.None, sizeTransform = SizeTransform(clip = false) { _, _ -> androidx.compose.animation.core.snap() })
            else (fadeIn(tween(duration, delayMillis = MediaMotion.captionDelayMs, easing = MediaMotion.ease)) togetherWith fadeOut(tween(MediaMotion.captionOutMs, easing = MediaMotion.ease))).using(SizeTransform(clip = false) { _, _ -> tween(duration) })
        },
        label = "caption",
    ) { id ->
        val artifact = id?.let(lookup)
        if (artifact != null) Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            var editing by remember(id) { mutableStateOf(false) }
            var noteOpen by remember(id) { mutableStateOf(false) }
            val now = remember(artifact.id) { System.currentTimeMillis() }
            Row(verticalAlignment = Alignment.Top, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(artifactTitle(artifact), Modifier.weight(1f).semantics { heading() }, style = TextStyles.task.copy(fontWeight = FontWeight.SemiBold), color = colors.fg)
                if (onDetails != null) Box(
                    Modifier.size(32.dp).clip(RoundedCornerShape(50)).clickable(role = Role.Button, onClickLabel = "Details, download, delete") { onDetails(artifact) },
                    contentAlignment = Alignment.Center,
                ) { LucideGlyph(Lucide.Info, size = 16.dp, tint = colors.fgSubtle, contentDescription = "Details of ${artifactTitle(artifact)}") }
            }
            Text(
                listOf(
                    artifactKindLabel(artifact.kind), formatMediaDuration(artifact.durationSeconds), artifactDetailSize(artifact.size).orEmpty(), savedByLabel(artifact),
                    artifact.createdAt.takeIf { it.isNotBlank() }?.let { relativeTime(it, now) }.orEmpty(),
                ).filter { it.isNotEmpty() }.joinToString(" · "),
                style = TaskType.xs, color = colors.fgSubtle,
            )
            if (editing && canEdit) TagEditor(
                tags = artifact.tagList(), task = task, project = project, busy = busy, problem = problem,
                onChange = { onEdit(artifact, it) }, onClose = { editing = false },
            ) else FlowRow(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(4.dp), verticalArrangement = Arrangement.spacedBy(4.dp), itemVerticalAlignment = Alignment.CenterVertically) {
                artifact.tagList().forEach { tag -> TagChip(tag, onClick = onFilter?.let { filter -> { filter(tag) } }) }
                if (canEdit) {
                    val shape = RoundedCornerShape(50)
                    val has = artifact.tagList().isNotEmpty()
                    Row(
                        Modifier.heightIn(min = 32.dp).clip(shape).clickable(role = Role.Button, onClickLabel = if (has) "Edit tags" else "Add tags") { editing = true; onStartEdit() }
                            .border(1.dp, colors.borderStrong, shape).padding(horizontal = 10.dp)
                            .semantics { contentDescription = if (has) "Edit tags" else "Add tags" },
                        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp),
                    ) {
                        if (has) LucideGlyph(TaskIcons.Pencil, size = 12.dp, tint = colors.fgSubtle)
                        else { LucideGlyph(MediaIcons.Tag, size = 12.dp, tint = colors.fgSubtle); Text("Add tags", style = TaskType.xs, color = colors.fgSubtle) }
                    }
                }
            }
            artifact.note?.trim()?.takeIf { it.isNotEmpty() }?.let { note ->
                var overflowing by remember(id) { mutableStateOf(false) }
                val styles = noteTimeLinkStyles()
                val linker = remember(artifact.id, artifact.durationSeconds, styles, seek) {
                    if (artifact.kind == "video" && seek != null) NoteTimeLinker(artifact.durationSeconds, styles) { seek(artifact, it) } else null
                }
                val linkers = LocalTextLinkers.current
                CompositionLocalProvider(LocalTextLinkers provides (listOfNotNull(linker) + linkers)) {
                    Column(Modifier.fillMaxWidth()) {
                        ProvideTextStyle(TextStyles.taskSm) {
                            CompositionLocalProvider(LocalContentColor provides colors.fg) {
                                ClampedBox(open = noteOpen, lines = 3, lineHeight = 25.sp, onOverflow = { overflowing = it }) { RichMarkdown(note, Modifier.fillMaxWidth()) }
                            }
                        }
                        if (overflowing || noteOpen) Text(
                            if (noteOpen) "less" else "more",
                            Modifier.heightIn(min = 32.dp).clickable(role = Role.Button) { noteOpen = !noteOpen }.padding(vertical = 6.dp)
                                .semantics { stateDescription = if (noteOpen) "Expanded" else "Collapsed" },
                            style = TaskType.xsMedium, color = colors.accent2,
                        )
                    }
                }
            }
        }
    }
}

/** Shows [content] at most [lines] lines tall unless [open], and says whether it was cut. */
@Composable
private fun ClampedBox(open: Boolean, lines: Int, lineHeight: androidx.compose.ui.unit.TextUnit, onOverflow: (Boolean) -> Unit, content: @Composable () -> Unit) {
    val density = LocalDensity.current
    val limit = with(density) { (lineHeight * lines).toPx() }.toInt()
    val report by rememberUpdatedState(onOverflow)
    var cutNow by remember { mutableStateOf(false) }
    val fade = !open
    Layout(
        content = content,
        modifier = Modifier.clipToBounds().graphicsLayer { compositingStrategy = androidx.compose.ui.graphics.CompositingStrategy.Offscreen }
            .drawWithContent {
                drawContent()
                // A line cut in half fades out instead of ending sharply.
                if (fade && cutNow) drawRect(
                    androidx.compose.ui.graphics.Brush.verticalGradient(listOf(Color.Black, Color.Transparent), startY = size.height - 16.dp.toPx(), endY = size.height),
                    blendMode = androidx.compose.ui.graphics.BlendMode.DstIn,
                )
            },
    ) { measurables, constraints ->
        val placeable = measurables.first().measure(constraints.copy(minHeight = 0, maxHeight = Constraints.Infinity))
        val cut = placeable.height > limit + 2
        report(cut)
        cutNow = cut
        val height = if (open || !cut) placeable.height else limit
        layout(placeable.width, height) { placeable.placeRelative(0, 0) }
    }
}
