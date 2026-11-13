package io.github.mitzacoder.kemiri.features.chat

import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.selection.DisableSelection
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import io.github.mitzacoder.kemiri.ui.theme.Jarvis

/** One line of a display diff: an added, removed or unchanged line with its number, or a `⋯` for a run left out. */
data class DisplayDiffLine(val kind: Kind, val number: String, val text: String) {
    enum class Kind { Add, Del, Ctx, Gap }
}

private val gapLine = Regex("""\s*\.\.\.\s*""")
private val numberedLine = Regex("""[+\- ](\s*\d+)?\s?(.*)""")

/** A diff as pi writes them (web `DiffView.svelte`): lines of `[+- ]<line number> <text>`, with `...` for the parts left out. */
fun displayDiffLines(diff: String): List<DisplayDiffLine> = diff.split('\n').map { line ->
    if (gapLine.matches(line)) return@map DisplayDiffLine(DisplayDiffLine.Kind.Gap, "", "⋯")
    val kind = when (line.firstOrNull()) { '+' -> DisplayDiffLine.Kind.Add; '-' -> DisplayDiffLine.Kind.Del; else -> DisplayDiffLine.Kind.Ctx }
    val match = numberedLine.matchEntire(line) ?: return@map DisplayDiffLine(kind, "", line)
    DisplayDiffLine(kind, match.groupValues[1].trim(), match.groupValues[2])
}

/** An edit's old and new text as one display diff, every old line removed and every new line added (web `ToolBody`). */
fun editAsDiff(oldText: String, newText: String): String =
    (oldText.split('\n').map { "- $it" } + newText.split('\n').map { "+ $it" }).joinToString("\n")

/** A display diff: line numbers, then a green `+` or red `−` on a tinted line; scrolls sideways rather than wrapping. */
@Composable internal fun DiffLines(diff: String, modifier: Modifier = Modifier) {
    val colors = Jarvis.colors
    val lines = remember(diff) { displayDiffLines(diff) }
    val style = androidx.compose.ui.text.TextStyle(fontFamily = FontFamily.Monospace, fontSize = 12.5.sp, lineHeight = 20.sp)
    BoxWithConstraints(modifier.fillMaxWidth()) {
        SelectionContainer {
            // Every line as wide as the widest, so a line's tint runs to the end of the scrolled area.
            Column(Modifier.horizontalScroll(rememberScrollState()).widthIn(min = maxWidth).width(IntrinsicSize.Max).padding(vertical = 8.dp)) {
                lines.forEach { line ->
                    val (tint, marker) = when (line.kind) {
                        DisplayDiffLine.Kind.Add -> colors.success.copy(alpha = .13f) to colors.success
                        DisplayDiffLine.Kind.Del -> colors.danger.copy(alpha = .12f) to colors.danger
                        else -> Color.Transparent to colors.fgSubtle
                    }
                    Row(Modifier.fillMaxWidth().background(tint)) {
                        DisableSelection {
                            Text(line.number, Modifier.width(40.dp).padding(end = 8.dp), style = style, color = colors.fgSubtle, textAlign = TextAlign.End, maxLines = 1)
                            Text(when (line.kind) { DisplayDiffLine.Kind.Add -> "+"; DisplayDiffLine.Kind.Del -> "−"; else -> "" }, Modifier.width(16.dp), style = style, color = marker, textAlign = TextAlign.Center)
                        }
                        // Tabs as four columns, like the web's `tab-size: 4`; copying keeps the literal tabs.
                        Text(line.text.replace("\t", "    "), Modifier.padding(end = 16.dp), style = style, color = if (line.kind == DisplayDiffLine.Kind.Gap) colors.fgSubtle else colors.fg, softWrap = false)
                    }
                }
            }
        }
    }
}
