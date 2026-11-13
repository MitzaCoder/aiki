package io.github.mitzacoder.kemiri.features.settings

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import io.github.mitzacoder.kemiri.ui.components.Lucide
import io.github.mitzacoder.kemiri.ui.components.LucideGlyph
import io.github.mitzacoder.kemiri.ui.theme.Jarvis

/** Whether the settings show the list and a section side by side; a screen that opens another one replaces its own then. */
internal val LocalSettingsSplit = androidx.compose.runtime.compositionLocalOf { false }

/** Opening a settings screen: [open] pushes it, [replace] swaps the current one, [up] goes to the screen above (popping when that is where we came from). */
class SettingsNavigator(val open: (io.github.mitzacoder.kemiri.navigation.Destination) -> Unit, val replace: (io.github.mitzacoder.kemiri.navigation.Destination) -> Unit, val up: (io.github.mitzacoder.kemiri.navigation.Destination) -> Unit) {
    fun go(destination: io.github.mitzacoder.kemiri.navigation.Destination, split: Boolean) = if (split) replace(destination) else open(destination)
}

/** A section in the list, with the chip that says a state worth seeing before opening it. */
internal data class SettingsNavItem(val section: SettingsSectionInfo, val chip: SectionChip? = null)

/** Both settings areas switch from one screen at a time to list and section side by side from this width (the web's 48rem). */
internal val SETTINGS_SPLIT_WIDTH = 600.dp

/**
 * The frame of both settings areas. From [SETTINGS_SPLIT_WIDTH]: the section list on the left and the chosen section on
 * the right. Below that, one screen at a time: the list (a card per section with its hint and a chevron), then a section
 * with a back button naming the screen it returns to. [activeId] is null on the list itself; [defaultId] is the section a
 * wide screen shows then. [content] gets the section to draw.
 */
@Composable
internal fun SettingsShell(
    items: List<SettingsNavItem>,
    activeId: String?,
    defaultId: String?,
    navLabel: String,
    leaveLabel: String,
    onLeave: () -> Unit,
    parentLabel: String?,
    onParent: (() -> Unit)?,
    onSelect: (id: String, split: Boolean) -> Unit,
    modifier: Modifier = Modifier,
    header: @Composable ColumnScope.() -> Unit,
    content: @Composable ColumnScope.(active: String) -> Unit,
) {
    BoxWithConstraints(modifier.fillMaxSize()) {
        val split = maxWidth >= SETTINGS_SPLIT_WIDTH
        androidx.compose.runtime.CompositionLocalProvider(LocalSettingsSplit provides split) {
        val shown = activeId ?: defaultId.takeIf { split }
        @Composable fun Header() = Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            TextButton(onClick = onLeave, contentPadding = PaddingValues(horizontal = 8.dp), modifier = Modifier.heightIn(min = 44.dp)) {
                LucideGlyph(Lucide.ArrowLeft, size = 16.dp); Spacer(Modifier.width(6.dp)); Text(leaveLabel)
            }
            header()
        }
        if (split) Column(Modifier.fillMaxSize().padding(horizontal = 20.dp).widthIn(max = 1040.dp).align(Alignment.TopCenter), verticalArrangement = Arrangement.spacedBy(16.dp)) {
            Header()
            Row(Modifier.weight(1f).fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(32.dp)) {
                SettingsNav(items, shown, navLabel, split = true, onSelect, Modifier.width(232.dp).verticalScroll(rememberScrollState()))
                Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(bottom = 24.dp)) { shown?.let { content(it) } }
            }
        } else Column(
            Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 12.dp).padding(bottom = 24.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            if (shown == null) {
                Header()
                SettingsNav(items, null, navLabel, split = false, onSelect)
            } else {
                if (onParent != null) TextButton(onClick = onParent, contentPadding = PaddingValues(horizontal = 12.dp), modifier = Modifier.heightIn(min = 44.dp)) {
                    LucideGlyph(Lucide.ArrowLeft, size = 16.dp); Spacer(Modifier.width(6.dp)); Text(parentLabel ?: "Back")
                }
                content(shown)
            }
        }
        }
    }
}

/** The list of sections: beside the content (icon and name, the current one raised) or the whole screen (a card per section). */
@Composable
private fun SettingsNav(items: List<SettingsNavItem>, activeId: String?, label: String, split: Boolean, onSelect: (String, Boolean) -> Unit, modifier: Modifier = Modifier) {
    Column(modifier.fillMaxWidth().semantics { contentDescription = label }, verticalArrangement = Arrangement.spacedBy(if (split) 4.dp else 8.dp)) {
        items.forEach { item ->
            val active = item.section.id == activeId
            val colors = Jarvis.colors
            val shape = RoundedCornerShape(if (split) 12.dp else 14.dp)
            Surface(
                onClick = { onSelect(item.section.id, split) }, shape = shape,
                color = when { active -> colors.surface2; split -> androidx.compose.ui.graphics.Color.Transparent; else -> cardColor(colors) },
                border = if (!split) BorderStroke(1.dp, colors.border) else if (active) BorderStroke(1.dp, colors.borderStrong) else null,
                shadowElevation = if (split) 0.dp else 1.dp,
                modifier = Modifier.fillMaxWidth().semantics { selected = active; contentDescription = "${item.section.label}. ${item.section.hint}" },
            ) {
                Row(
                    Modifier.heightIn(min = if (split) 44.dp else 60.dp).padding(horizontal = if (split) 10.dp else 12.dp, vertical = 8.dp),
                    verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    SectionIconTile(item.section.icon, size = if (split) 32.dp else 40.dp)
                    Column(Modifier.weight(1f)) {
                        Text(item.section.label, style = MaterialTheme.typography.bodyMedium, fontWeight = if (active) FontWeight.SemiBold else FontWeight.Medium,
                            color = if (active || !split) colors.fg else colors.fgMuted, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        if (!split) Text(item.section.hint, style = MaterialTheme.typography.bodySmall, color = colors.fgSubtle, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    }
                    item.chip?.let { StatusChip(it.label, it.tone) }
                    if (!split) LucideGlyph(Lucide.ChevronRight, size = 16.dp, tint = colors.fgSubtle)
                }
            }
        }
    }
}
