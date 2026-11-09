package com.mihaisaru.harness.features.settings

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.mihaisaru.harness.data.HarnessRepository
import com.mihaisaru.harness.data.ThemeMode
import com.mihaisaru.harness.data.ThemePalette
import com.mihaisaru.harness.ui.components.Lucide
import com.mihaisaru.harness.ui.components.LucideGlyph
import com.mihaisaru.harness.ui.theme.Jarvis
import com.mihaisaru.harness.ui.theme.harnessColors
import kotlinx.coroutines.launch

/** The palettes, as the web's `THEMES` names them. */
internal val THEME_CARDS = listOf(
    Triple(ThemePalette.Jarvis, "Jarvis", "Violet surfaces with a cyan-to-orange gradient."),
    Triple(ThemePalette.Neutral, "Neutral", "Plain greys."),
)

/**
 * General → Appearance. The theme is a palette: each card draws the app in it, light and dark side by side. Light or dark
 * follows the device unless chosen. Saved on this device at once, so there is nothing to confirm.
 */
@Composable
internal fun AppearanceSection(repository: HarnessRepository) {
    val settings by repository.settings.collectAsStateWithLifecycle()
    val scope = rememberCoroutineScope()
    val context = androidx.compose.ui.platform.LocalContext.current
    SettingsSectionPage("Appearance", "How the app looks on this device.", SettingsIcon.Palette) {
        SettingsGroup(title = "Theme") {
            GroupRow {
                Column(Modifier.selectableGroup(), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    THEME_CARDS.forEach { (palette, name, description) ->
                        ThemeCard(palette, name, description, chosen = settings.palette == palette) { scope.launch { repository.setTheme(palette, settings.mode) } }
                    }
                }
            }
            SettingsRow("Light or dark", hint = "Follows your device's setting unless you choose.", control = RowControl.Wide) {
                Row(Modifier.selectableGroup().fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    ThemeMode.entries.forEach { mode ->
                        val chosen = settings.mode == mode
                        FilterChip(
                            chosen, { scope.launch { repository.setTheme(settings.palette, mode) } }, label = { Text(if (mode == ThemeMode.System) "Device" else mode.name) },
                            leadingIcon = when (mode) {
                                ThemeMode.Light -> ({ LucideGlyph(SettingsGlyphs.Sun, size = 16.dp) })
                                ThemeMode.Dark -> ({ LucideGlyph(SettingsGlyphs.Moon, size = 16.dp) })
                                ThemeMode.System -> null
                            },
                            border = FilterChipDefaults.filterChipBorder(true, chosen, borderColor = Jarvis.colors.borderStrong, selectedBorderColor = Jarvis.colors.accent2),
                            modifier = Modifier.heightIn(min = 44.dp).weight(1f),
                        )
                    }
                }
            }
        }
        SettingsGroup(title = "Waiting tasks") {
            SettingsRow("Work day starts at", hint = "Return dates use this device’s local time zone. Saved on this device.") {
                TextButton(onClick = {
                    val time = java.time.LocalTime.parse(com.mihaisaru.harness.data.normalizeWorkDayStart(settings.workDayStart))
                    android.app.TimePickerDialog(context, { _, hour, minute ->
                        scope.launch { repository.setWorkDayStart(String.format(java.util.Locale.ROOT, "%02d:%02d", hour, minute)) }
                    }, time.hour, time.minute, true).show()
                }) { Text(settings.workDayStart) }
            }
        }
        Text("The theme is kept on this device, not on a backend.", Modifier.padding(horizontal = 4.dp), style = MaterialTheme.typography.bodySmall, color = Jarvis.colors.fgSubtle)
    }
}

@Composable
private fun ThemeCard(palette: ThemePalette, name: String, description: String, chosen: Boolean, onPick: () -> Unit) {
    val colors = Jarvis.colors
    Surface(
        Modifier.fillMaxWidth().selectable(chosen, role = Role.RadioButton, onClick = onPick).semantics { contentDescription = "$name theme. $description" },
        shape = RoundedCornerShape(14.dp), color = cardColor(colors),
        border = if (chosen) BorderStroke(2.dp, colors.accent2) else BorderStroke(1.dp, colors.borderStrong),
        shadowElevation = if (chosen) 3.dp else 0.dp,
    ) {
        Column {
            Row(Modifier.fillMaxWidth()) {
                ThemePreview(palette, dark = false, Modifier.weight(1f))
                ThemePreview(palette, dark = true, Modifier.weight(1f))
            }
            Row(Modifier.fillMaxWidth().background(cardColor(colors)).padding(horizontal = 12.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Column(Modifier.weight(1f)) {
                    Text(name, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.SemiBold)
                    Text(description, style = MaterialTheme.typography.bodySmall, color = colors.fgMuted)
                }
                if (chosen) Box(Modifier.size(20.dp).background(colors.accent2, CircleShape), contentAlignment = Alignment.Center) {
                    LucideGlyph(Lucide.Check, size = 12.dp, tint = androidx.compose.ui.graphics.Color.White)
                } else Box(Modifier.size(20.dp).border(1.dp, colors.borderStrong, CircleShape))
            }
        }
    }
}

/** A small drawing of the app in one palette and mode: its page, a sidebar, a message pair and the gradient. */
@Composable
internal fun ThemePreview(palette: ThemePalette, dark: Boolean, modifier: Modifier = Modifier) {
    val preview = harnessColors(palette, dark)
    Box(modifier.height(92.dp).background(preview.bg)) {
        Row(Modifier.fillMaxSize()) {
            Column(Modifier.width(26.dp).fillMaxHeight().background(preview.surface).padding(5.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                repeat(3) { Box(Modifier.fillMaxWidth().height(5.dp).background(if (it == 0) preview.surface2 else preview.border, RoundedCornerShape(2.dp))) }
            }
            Column(Modifier.weight(1f).fillMaxHeight().padding(8.dp), verticalArrangement = Arrangement.spacedBy(5.dp)) {
                Box(Modifier.align(Alignment.End).width(46.dp).height(12.dp).background(preview.userBubble(), RoundedCornerShape(6.dp)))
                Box(Modifier.fillMaxWidth(0.8f).height(6.dp).background(preview.fgMuted.copy(alpha = .5f), RoundedCornerShape(3.dp)))
                Box(Modifier.fillMaxWidth(0.55f).height(6.dp).background(preview.fgSubtle.copy(alpha = .5f), RoundedCornerShape(3.dp)))
                Spacer(Modifier.weight(1f))
                Box(Modifier.fillMaxWidth().height(14.dp).background(preview.surface2, RoundedCornerShape(7.dp)).padding(horizontal = 4.dp)) {
                    Box(Modifier.align(Alignment.CenterEnd).size(8.dp).background(preview.grad(), CircleShape))
                }
            }
        }
    }
}
