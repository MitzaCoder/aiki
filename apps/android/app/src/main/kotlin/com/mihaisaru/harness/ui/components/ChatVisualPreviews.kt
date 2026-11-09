package com.mihaisaru.harness.ui.components

import androidx.compose.foundation.layout.*
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import com.mihaisaru.harness.data.ThemeMode
import com.mihaisaru.harness.data.ThemePalette
import com.mihaisaru.harness.ui.theme.HarnessTheme

/** Static design fixture, no repository/socket and no animation clock required. */
@Composable
private fun ChatVisualFixture(palette: ThemePalette, mode: ThemeMode) {
    HarnessTheme(palette, mode) {
        ChatBackdrop {
            Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    AssistantOrb(active = true)
                    Text("Harness", style = MaterialTheme.typography.titleMedium)
                }
                UserMessageSurface(Modifier.fillMaxWidth()) { Text("Polish the native chat experience.") }
                Text("I'll check the components and preserve the existing behavior.", style = MaterialTheme.typography.bodyMedium)
                TranscriptSurface("Thinking", Lucide.Brain, false, {}, subtitle = "Reviewing the visual hierarchy") {}
                TranscriptSurface("2 read · 1 edit", Lucide.Code, false, {}, status = "done") {}
                TranscriptSurface("Context summary", Lucide.Archive, false, {}) {}
                GlassComposerSurface(Modifier.fillMaxWidth()) {
                    Text("Message…", style = MaterialTheme.typography.bodyMedium)
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                        JarvisIconButton(Lucide.Plus, "Attach", {})
                        JarvisIconButton(Lucide.ArrowUp, "Send", {}, emphasized = true)
                    }
                }
            }
        }
    }
}

@Preview(name = "Jarvis light · compact", widthDp = 360)
@Composable private fun JarvisLightPreview() = ChatVisualFixture(ThemePalette.Jarvis, ThemeMode.Light)
@Preview(name = "Jarvis dark · compact", widthDp = 360)
@Composable private fun JarvisDarkPreview() = ChatVisualFixture(ThemePalette.Jarvis, ThemeMode.Dark)
@Preview(name = "Neutral light · compact", widthDp = 360)
@Composable private fun NeutralLightPreview() = ChatVisualFixture(ThemePalette.Neutral, ThemeMode.Light)
@Preview(name = "Neutral dark · compact", widthDp = 360)
@Composable private fun NeutralDarkPreview() = ChatVisualFixture(ThemePalette.Neutral, ThemeMode.Dark)
