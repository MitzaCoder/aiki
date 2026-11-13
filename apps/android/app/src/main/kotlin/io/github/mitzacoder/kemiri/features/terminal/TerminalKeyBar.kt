package io.github.mitzacoder.kemiri.features.terminal

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import io.github.mitzacoder.kemiri.ui.components.Lucide
import io.github.mitzacoder.kemiri.ui.components.LucideGlyph
import io.github.mitzacoder.kemiri.ui.theme.Jarvis

/**
 * The phone's key bar, the twin of the web's: Esc, Tab, sticky Ctrl and Alt, the arrows, then `|` `~` `/` `-`, Paste and
 * Copy. It sits above the soft keyboard (the screen's `imePadding`), inside the box the terminal fits itself to.
 */
@Composable
fun TerminalKeyBar(input: TerminalInput, modifier: Modifier = Modifier) {
    val colors = Jarvis.colors
    Column(
        modifier.fillMaxWidth().background(if (colors.dark) colors.surface else androidx.compose.ui.graphics.Color.White)
            .semantics { contentDescription = "Terminal keys" }.padding(horizontal = 6.dp, vertical = 4.dp),
        verticalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        HorizontalRule()
        KEY_BAR_ROWS.forEachIndexed { rowIndex, row ->
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                row.forEach { key ->
                    val sticky = when (key.modifier) { KeyModifier.Ctrl -> input.modifiers.ctrl; KeyModifier.Alt -> input.modifiers.alt; null -> false }
                    Key(Modifier.weight(1f), key.name, pressed = key.modifier?.let { sticky }, onClick = { input.press(key) }) {
                        Text(key.label, fontFamily = FontFamily.Monospace, style = MaterialTheme.typography.bodyMedium, textAlign = TextAlign.Center, maxLines = 1)
                    }
                }
                if (rowIndex == KEY_BAR_ROWS.lastIndex) {
                    Key(Modifier.weight(1f), "Paste", onClick = input::paste) { LucideGlyph(TerminalGlyphs.ClipboardPaste, size = 18.dp) }
                    Key(Modifier.weight(1f), "Copy the selection", enabled = input.selecting, onClick = { input.copy() }) { LucideGlyph(Lucide.Copy, size = 18.dp) }
                }
            }
        }
    }
}

@Composable
private fun HorizontalRule() {
    Box(Modifier.fillMaxWidth().height(1.dp).background(Jarvis.colors.border))
}

@Composable
private fun Key(modifier: Modifier, name: String, pressed: Boolean? = null, enabled: Boolean = true, onClick: () -> Unit, content: @Composable () -> Unit) {
    val colors = Jarvis.colors
    val primary = MaterialTheme.colorScheme.primary
    val on = pressed == true
    Surface(
        modifier.height(38.dp).alpha(if (enabled) 1f else .4f).semantics { contentDescription = name; role = Role.Button; pressed?.let { selected = it } }
            .clickable(enabled = enabled, onClick = onClick),
        shape = RoundedCornerShape(8.dp),
        color = if (on) primary else MaterialTheme.colorScheme.background,
        contentColor = if (on) MaterialTheme.colorScheme.onPrimary else colors.fg,
        border = BorderStroke(1.dp, if (on) primary else colors.border),
    ) { Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { content() } }
}
