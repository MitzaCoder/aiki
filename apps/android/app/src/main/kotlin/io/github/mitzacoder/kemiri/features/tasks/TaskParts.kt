// Icons: a subset of Lucide (@lucide/svelte 1.64.0), ISC license; see LUCIDE-LICENSE.txt.
package io.github.mitzacoder.kemiri.features.tasks

import android.provider.Settings
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.github.mitzacoder.kemiri.data.HarnessFeature
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.unit.dp
import io.github.mitzacoder.kemiri.ui.components.Lucide
import io.github.mitzacoder.kemiri.ui.components.LucideGlyph
import io.github.mitzacoder.kemiri.ui.components.LucideIcon
import io.github.mitzacoder.kemiri.ui.theme.Jarvis
import io.github.mitzacoder.kemiri.ui.theme.textStyle

/** The icons the Tasks list, the task sheet and the question cards use beyond the shared set. */
internal object TaskIcons {
    val TriangleAlert = LucideIcon("triangle-alert", "m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3", "M12 9v4", "M12 17h.01")
    val CircleHelp = LucideIcon("circle-help", "M2 12a10 10 0 1 0 20 0a10 10 0 1 0 -20 0", "M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3", "M12 17h.01")
    val Ban = LucideIcon("ban", "M2 12a10 10 0 1 0 20 0a10 10 0 1 0 -20 0", "M4.929 4.929 19.07 19.071")
    val RotateCcw = LucideIcon("rotate-ccw", "M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8", "M3 3v5h5")
    val Pencil = LucideIcon("pencil", "M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z", "m15 5 4 4")
    val Send = LucideIcon("send", "M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z", "m21.854 2.147-10.94 10.939")
    val ChevronLeft = LucideIcon("chevron-left", "m15 18-6-6 6-6")
}

/** The web's type sizes the task screens use, in rem. */
internal object TaskType {
    /** 11px meta lines: times, IDs, counts. */
    val meta = textStyle(0.6875f, 1f / 0.6875f)
    val metaMono = textStyle(0.625f, 1f / 0.625f, mono = true)
    /** A section's title in the list (13px semibold). */
    val sectionTitle = textStyle(0.8125f, 1.25f / 0.8125f, weight = 600)
    /** A row's title (14px medium). */
    val rowTitle = textStyle(0.875f, 1.25f / 0.875f, weight = 500)
    /** The sheet's small caps headings (11px semibold, tracked). */
    val heading = textStyle(0.6875f, 1f / 0.6875f, weight = 600, letterSpacing = 0.05f)
    val xs = textStyle(0.75f, 1f / 0.75f)
    val xsMedium = textStyle(0.75f, 1f / 0.75f, weight = 500)
    val xsSemibold = textStyle(0.75f, 1f / 0.75f, weight = 600)
}

/**
 * Whether the user asked for less motion (animations off in the developer options or the accessibility settings):
 * then a working task's dot stays still.
 */
@Composable
internal fun rememberReducedMotion(): Boolean {
    val context = LocalContext.current
    return remember(context) { Settings.Global.getFloat(context.contentResolver, Settings.Global.ANIMATOR_DURATION_SCALE, 1f) == 0f }
}

/** A small count in a pill, the accent's when it needs the user. */
@Composable
internal fun CountPill(count: Int, accent: Boolean = false) {
    val colors = Jarvis.colors
    Text(
        count.toString(),
        Modifier.background(if (accent) colors.accent2.copy(alpha = .15f) else colors.surface2, RoundedCornerShape(50)).padding(horizontal = 6.dp),
        style = textStyle(0.6875f, 1f / 0.6875f, weight = 500),
        color = if (accent) colors.accent2 else colors.fgSubtle,
    )
}

/** A heading that opens and closes what is under it, with a turning chevron. */
@Composable
internal fun FoldHeading(label: String, open: Boolean, onToggle: () -> Unit, modifier: Modifier = Modifier, count: Int? = null, chevronFirst: Boolean = true, style: androidx.compose.ui.text.TextStyle = TaskType.xsSemibold) {
    val colors = Jarvis.colors
    Row(
        modifier.clickable(role = Role.Button, onClickLabel = if (open) "Fold $label" else "Open $label", onClick = onToggle)
            .semantics { stateDescription = if (open) "Open" else "Folded" }
            .heightIn(min = 40.dp).padding(horizontal = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        val chevron: @Composable () -> Unit = { LucideGlyph(Lucide.ChevronRight, Modifier.rotate(if (open) 90f else 0f), size = 14.dp, tint = colors.fgSubtle) }
        if (chevronFirst) chevron()
        Text(label, style = style, color = colors.fgMuted)
        count?.let { CountPill(it) }
        if (!chevronFirst) chevron()
    }
}

/** Text that opens something when tapped, read out as a button with [label]. */
internal fun Modifier.clickableLink(label: String, onClick: () -> Unit): Modifier =
    clickable(onClickLabel = label, role = Role.Button, onClick = onClick)

/**
 * Whether the backend keeps reports on its tasks (`task-reports`): then the panels' Board tab is the Tasks list. The
 * connection keeps the last hello through a reconnect, so a moment offline does not swap the list for the old board.
 */
@Composable
fun rememberTasksView(client: io.github.mitzacoder.kemiri.data.HarnessClient): Boolean =
    client.state.collectAsStateWithLifecycle().value.supports(HarnessFeature.TASK_REPORTS)
