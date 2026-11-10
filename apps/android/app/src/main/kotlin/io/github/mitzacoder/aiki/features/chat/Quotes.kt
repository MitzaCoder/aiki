package io.github.mitzacoder.aiki.features.chat

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.contextmenu.builder.item
import androidx.compose.foundation.text.contextmenu.modifier.appendTextContextMenuComponents
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.text.selection.SelectionState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withLink
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import io.github.mitzacoder.aiki.ui.components.LucideGlyph
import io.github.mitzacoder.aiki.ui.components.Lucide
import io.github.mitzacoder.aiki.ui.theme.Jarvis

/*
 * Quotes in the chat: text picked out of the transcript goes into a message as Markdown blockquotes before what the
 * user typed, so the coordinator reads exactly what was quoted, and a user message that starts with blockquotes shows
 * them as quotes again. Ported from `apps/web/src/lib/chat/quotes.ts` with its tests (QuotesTest); change both together.
 */

/** A selection's text as a quote: no-break spaces as spaces, no trailing spaces or outer blank lines, at most one blank line in a row. */
fun quoteFromSelection(selected: String): String = selected
    .replace(Regex("\r\n?"), "\n")
    .replace('\u00a0', ' ')
    .replace(Regex("[ \t]+$", RegexOption.MULTILINE), "")
    .replace(Regex("\n{3,}"), "\n\n")
    .replace(Regex("^\n+|\n+$"), "")

/** Where a selection edge sits: the text of the block it is in, and its offset there. */
data class SelectionEdge(val text: String, val offset: Int)

private val WORD_BEFORE = Regex("[\\p{L}\\p{M}\\p{N}_]+$")
private val WORD_AFTER = Regex("^[\\p{L}\\p{M}\\p{N}_]+")

private fun cutWord(edge: SelectionEdge): Pair<String, String>? {
    val offset = edge.offset.coerceIn(0, edge.text.length)
    val before = WORD_BEFORE.find(edge.text.substring(0, offset))?.value.orEmpty()
    val after = WORD_AFTER.find(edge.text.substring(offset))?.value.orEmpty()
    return if (before.isNotEmpty() && after.isNotEmpty()) before to after else null
}

/** A selection's text with an edge that falls inside a word moved out to the whole word. */
fun selectionInWholeWords(selected: String, start: SelectionEdge?, end: SelectionEdge?): String {
    val head = start?.let { cutWord(it)?.first }.orEmpty()
    val tail = end?.let { cutWord(it)?.second }.orEmpty()
    return head + selected + tail
}

private fun blockquote(quote: String): String = quote.split("\n").joinToString("\n") { if (it.isEmpty()) ">" else "> $it" }

/** The text a message sends: each quote as its own blockquote, then what was typed, separated by blank lines. */
fun messageWithQuotes(quotes: List<String>, text: String): String {
    val blocks = quotes.filter { it.isNotBlank() }.map(::blockquote).toMutableList()
    val typed = text.trim()
    if (typed.isNotEmpty()) blocks += typed
    return blocks.joinToString("\n\n")
}

data class QuotedMessage(val quotes: List<String>, val text: String)

private val QUOTED = Regex("^ {0,3}>")

/**
 * A message cut into the blockquotes it starts with and the text after them. Consecutive `>` lines are one quote and
 * a blank line starts the next; one level of `>` comes off, so a quoted quote keeps its own.
 */
fun splitQuotes(message: String): QuotedMessage {
    val lines = message.split("\n")
    val quotes = mutableListOf<String>()
    var current: MutableList<String>? = null
    var index = 0
    while (index < lines.size) {
        val line = lines[index]
        val quoted = QUOTED.find(line)
        if (quoted != null) {
            if (current == null) current = mutableListOf()
            current += line.substring(quoted.value.length).removePrefix(" ")
        } else if (line.isBlank() && quotes.size + (if (current == null) 0 else 1) > 0) {
            current?.let { quotes += it.joinToString("\n") }
            current = null
        } else break
        index++
    }
    current?.let { quotes += it.joinToString("\n") }
    if (quotes.isEmpty()) return QuotedMessage(emptyList(), message)
    return QuotedMessage(quotes, lines.drop(index).joinToString("\n").trim())
}

/** A quote's first line with text, its whitespace collapsed: what a chip shows of it. */
fun quotePreview(quote: String): String = quote.split("\n").firstOrNull { it.isNotBlank() }.orEmpty().replace(Regex("\\s+"), " ").trim()

// --- quoting from the transcript and showing quotes ------------------------------------------------------------------

/** Where quoted text goes: the composer's quote chips. Null where there is nothing to write (a worker's transcript). */
val LocalQuoteHandler = compositionLocalOf<((String) -> Unit)?> { null }

private object QuoteMenuKey

/**
 * Selectable text whose selection toolbar has a "Quote" item when the screen takes quotes ([LocalQuoteHandler]): the
 * selection's plain text goes to the composer as a quote. Android's own selection already snaps to whole words.
 */
@OptIn(ExperimentalFoundationApi::class)
@Composable fun QuotableSelection(modifier: Modifier = Modifier, content: @Composable () -> Unit) {
    val onQuote = LocalQuoteHandler.current
    if(onQuote == null) { SelectionContainer(modifier, content = content); return }
    val latest by rememberUpdatedState(onQuote)
    val state = remember { SelectionState() }
    SelectionContainer(state, modifier.appendTextContextMenuComponents {
        item(QuoteMenuKey, "Quote") {
            val quote = quoteFromSelection(state.selectedTexts.joinToString("\n") { it.text })
            close()
            state.clear()
            if(quote.isNotEmpty()) latest(quote)
        }
    }, content)
}

/** The chat's gradient rule at a quote's left edge. */
@Composable private fun Modifier.quoteRule(): Modifier {
    val brush = Jarvis.colors.grad()
    return drawBehind { drawLine(brush, Offset(1.dp.toPx(), 0f), Offset(1.dp.toPx(), size.height), strokeWidth = 2.dp.toPx()) }.padding(start = 10.dp)
}

/** A quote at the top of a user message: two lines, with "Show more" when it is longer. */
@Composable internal fun QuoteBlock(quote: String) {
    var expanded by rememberSaveable(quote) { mutableStateOf(false) }
    var clamped by remember(quote) { mutableStateOf(false) }
    Column(horizontalAlignment = Alignment.Start, verticalArrangement = Arrangement.spacedBy(2.dp)) {
        QuotableSelection(Modifier.quoteRule()) {
            Text(quote, style = MaterialTheme.typography.bodyMedium, color = Jarvis.colors.fgMuted, maxLines = if(expanded) Int.MAX_VALUE else 2, overflow = TextOverflow.Ellipsis,
                onTextLayout = { if(!expanded) clamped = it.hasVisualOverflow })
        }
        if(clamped || expanded) Text(if(expanded) "Show less" else "Show more", Modifier.clip(RoundedCornerShape(6.dp)).clickable(role = Role.Button) { expanded = !expanded }.padding(start = 10.dp, top = 4.dp, bottom = 4.dp, end = 8.dp),
            style = MaterialTheme.typography.labelSmall, color = Jarvis.colors.fgSubtle)
    }
}

/** A quote waiting in the composer as a pill: its first line; a tap shows it whole, × removes it. */
@Composable internal fun QuoteChip(quote: String, open: Boolean, onToggle: () -> Unit, onRemove: () -> Unit) {
    val shape = RoundedCornerShape(50)
    Row(Modifier.widthIn(max = 300.dp).clip(shape).background(Jarvis.colors.surface2.copy(alpha = .6f)).border(1.dp, if(open) Jarvis.colors.accent2.copy(alpha = .5f) else Jarvis.colors.border, shape),
        verticalAlignment = Alignment.CenterVertically) {
        Row(Modifier.weight(1f, fill = false).clickable(role = Role.Button, onClickLabel = if(open) "Hide the quote" else "Show the whole quote", onClick = onToggle).heightIn(min = 28.dp).padding(start = 8.dp),
            verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            LucideGlyph(ChatIcons.Quote, size = 12.dp, tint = Jarvis.colors.accent2)
            Text(quotePreview(quote), style = MaterialTheme.typography.labelMedium, color = Jarvis.colors.fgMuted, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        Box(Modifier.size(28.dp).clip(shape).clickable(role = Role.Button, onClickLabel = "Remove the quote", onClick = onRemove).semantics { contentDescription = "Remove the quote" }, contentAlignment = Alignment.Center) {
            LucideGlyph(Lucide.X, size = 14.dp, tint = Jarvis.colors.fgSubtle)
        }
    }
}

/** A tapped quote chip's whole quote, under the chips. */
@Composable internal fun OpenQuote(quote: String) {
    Text(quote, Modifier.fillMaxWidth().heightIn(max = 128.dp).verticalScroll(rememberScrollState()).quoteRule(), style = MaterialTheme.typography.bodySmall, color = Jarvis.colors.fgMuted)
}

/**
 * Quotes taken outside the chat's own transcript (the task sheet's text) on their way to that chat's composer. The
 * sheet provides [LocalQuoteHandler] as `{ ComposerQuotes.send(context.route, it); close() }`; the chat under it takes them.
 */
object ComposerQuotes {
    data class Quote(val route: io.github.mitzacoder.aiki.navigation.Destination.Chat, val text: String)
    val pending = kotlinx.coroutines.flow.MutableSharedFlow<Quote>(extraBufferCapacity = 8)
    fun send(route: io.github.mitzacoder.aiki.navigation.Destination.Chat, text: String) { pending.tryEmit(Quote(route.copy(highlight = null), text)) }
}
