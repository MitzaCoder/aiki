package io.github.mitzacoder.aiki.features.chat

import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.Alignment
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextOverflow
import io.github.mitzacoder.aiki.ui.components.JarvisIconButton
import io.github.mitzacoder.aiki.ui.components.Lucide
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.text.*
import androidx.compose.ui.text.font.*
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.text.style.TextIndent
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.layout.Layout
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Constraints
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.em
import io.github.mitzacoder.aiki.ui.theme.Jarvis
import io.github.mitzacoder.aiki.ui.theme.JetBrainsMono
import org.commonmark.node.*
import org.commonmark.parser.Parser
import org.commonmark.ext.gfm.tables.*
import coil3.compose.AsyncImage

private val parser = Parser.builder().extensions(listOf(TablesExtension.create())).build()
private fun children(node: Node): List<Node> = buildList { var n = node.firstChild; while(n != null) { add(n); n = n.next } }
/** A link found in plain Markdown text: the characters from [start] up to [end] and what tapping them does. */
data class TextLinkSpan(val start: Int, val end: Int, val link: LinkAnnotation)

/**
 * Finds links in the plain text of rendered Markdown, never in code or inside a link the text already has: task
 * mentions (`T12`), ticket keys and PR numbers. Screens provide them through [LocalTextLinkers].
 */
fun interface TextLinker { fun find(text: String): List<TextLinkSpan> }

/** The linkers [RichMarkdown] applies, in order; where two spans overlap, the earlier linker's wins. */
val LocalTextLinkers = compositionLocalOf<List<TextLinker>> { emptyList() }

/** Each linker's spans that fit the text and overlap none taken before, in text order. */
internal fun linkSpans(text: String, linkers: List<TextLinker>): List<TextLinkSpan> {
    val taken = mutableListOf<TextLinkSpan>()
    for (linker in linkers) for (span in linker.find(text)) {
        if (span.start < 0 || span.end > text.length || span.start >= span.end) continue
        if (taken.none { span.start < it.end && it.start < span.end }) taken += span
    }
    return taken.sortedBy { it.start }
}

internal fun inline(node: Node, linkers: List<TextLinker> = emptyList(), userMessage: Boolean = false): AnnotatedString = buildAnnotatedString {
    fun plain(text: String, inLink: Boolean) {
        if (inLink || linkers.isEmpty()) { append(text); return }
        var at = 0
        for (span in linkSpans(text, linkers)) {
            append(text.substring(at, span.start))
            withLink(span.link) { append(text.substring(span.start, span.end)) }
            at = span.end
        }
        append(text.substring(at))
    }
    fun visit(n: Node, inLink: Boolean) {
        when(n) {
            is Text -> plain(n.literal, inLink)
            // MarkdownText draws the bordered box behind the span (web `.md :not(pre) > code`).
            is Code -> withAnnotation(CODE_TAG, "") { withStyle(SpanStyle(fontFamily = JetBrainsMono, fontSize = 0.85.em)) { append(n.literal) } }
            is StrongEmphasis -> withStyle(SpanStyle(fontWeight = FontWeight.Bold)) { children(n).forEach { visit(it, inLink) } }
            is Emphasis -> withStyle(SpanStyle(fontStyle = FontStyle.Italic)) { children(n).forEach { visit(it, inLink) } }
            is Link -> if(n.destination.startsWith("https://") || n.destination.startsWith("http://")) withLink(LinkAnnotation.Url(n.destination)) { children(n).forEach { visit(it, true) } } else children(n).forEach { visit(it, true) }
            // CommonMark joins a paragraph's lines, as the web's renderer does; a hard break (two spaces, `\\`) keeps one.
            is SoftLineBreak -> append(if(userMessage) "\n" else " ")
            is HtmlInline -> if(userMessage) append(n.literal)
            is HardLineBreak -> append("\n")
            else -> children(n).forEach { visit(it, inLink) }
        }
    }
    visit(node, false)
}
/** Shared native Markdown entry point for memory, context and other feature panels. */
@Composable fun HarnessMarkdown(text: String, modifier: Modifier = Modifier) = RichMarkdown(text, modifier)

private val LocalCompactMarkdown = compositionLocalOf { false }

@Composable fun RichMarkdown(source: String, modifier: Modifier = Modifier, userMessage: Boolean = false, compact: Boolean = false) {
    val document = remember(source) { parser.parse(source) }
    CompositionLocalProvider(LocalCompactMarkdown provides compact) {
        ProvideTextStyle(if (compact) LocalTextStyle.current.copy(fontSize = 14.sp, lineHeight = 21.sp) else LocalTextStyle.current) {
            QuotableSelection(modifier) { Column(verticalArrangement = Arrangement.spacedBy(if (compact) 4.dp else 8.dp)) { children(document).forEach { MarkdownNode(it, userMessage) } } }
        }
    }
}
@Composable private fun MarkdownNode(node: Node, userMessage: Boolean = false) {
    val linkers = LocalTextLinkers.current
    val compact = LocalCompactMarkdown.current
    val lineHeight = if (compact) 21.sp else 25.sp
    fun inline(node: Node) = inline(node, linkers, userMessage)
    when(node) {
        is FencedCodeBlock -> CodeBlock(node.literal,node.info)
        is IndentedCodeBlock -> CodeBlock(node.literal,"")
        is Heading -> MarkdownText(inline(node),fontSize = (if(compact) 15 else if(userMessage) maxOf(16, 19 - node.level) else 26 - node.level * 2).sp,fontWeight = FontWeight.SemiBold)
        is ThematicBreak -> HorizontalDivider()
        is TableBlock -> MarkdownTable(node, ::inline)
        is org.commonmark.node.Paragraph -> if(children(node).any { it is org.commonmark.node.Image }) {
            Column { children(node).forEach { child ->
                if(child is org.commonmark.node.Image && (child.destination.startsWith("https://") || child.destination.startsWith("http://"))) AsyncImage(model = child.destination,contentDescription = inline(child).text,modifier = Modifier.fillMaxWidth().heightIn(max = 320.dp))
                else MarkdownText(inline(child))
            } }
        } else MarkdownText(inline(node),lineHeight = lineHeight)
        // The marker's Text is Compose's: a bare `Text(String)` here is commonmark's node constructor and draws nothing.
        // Markers in the subtle colour, numbers in tabular figures (web `li::marker`).
        is BulletList, is OrderedList -> Column { children(node).forEachIndexed { i,item -> Row {
            androidx.compose.material3.Text(if(node is OrderedList) "${node.startNumber + i}. " else "• ",lineHeight = lineHeight,color = Jarvis.colors.fgSubtle,style = LocalTextStyle.current.copy(fontFeatureSettings = "tnum"))
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(if (compact) 2.dp else 0.dp)) { children(item).forEach { MarkdownNode(it, userMessage) } }
        } } }
        // A gradient bar at the left and muted text (web `.md blockquote`).
        is BlockQuote -> {
            val colors = Jarvis.colors
            CompositionLocalProvider(LocalContentColor provides colors.fgMuted) {
                Column(Modifier.fillMaxWidth().drawBehind { drawRect(quoteBar(colors.gradStops, size), size = Size(3.dp.toPx(), size.height)) }.padding(start = 16.dp, top = 2.dp, bottom = 2.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp)) { children(node).forEach { MarkdownNode(it, userMessage) } }
            }
        }
        is HtmlBlock -> androidx.compose.material3.Text(node.literal) // Never execute model-supplied HTML. (Plain `Text` here would be commonmark's node.)
        else -> MarkdownText(inline(node),lineHeight = lineHeight)
    }
}

/**
 * The web's `border-image: var(--chat-grad)` on a quote's left edge: the 120° gradient laid over the whole quote, of
 * which the bar shows the left strip (mostly the first colour on a wide quote).
 */
private fun quoteBar(stops: Array<Pair<Float, androidx.compose.ui.graphics.Color>>, size: Size): Brush {
    val direction = Offset(0.866f, 0.5f) // 120°: right and a little down
    val length = size.width * 0.866f + size.height * 0.5f
    val center = Offset(size.width / 2, size.height / 2)
    return Brush.linearGradient(colorStops = stops, start = center - direction * (length / 2), end = center + direction * (length / 2))
}

/** Marks inline code in [inline]'s output, for [MarkdownText] to box. */
internal const val CODE_TAG = "md-code"

/**
 * Rendered Markdown text with each inline code span in a rounded box, the theme's surface inside a border (web
 * `.md :not(pre) > code`). A span that wraps gets a box per line.
 */
@Composable private fun MarkdownText(
    text: AnnotatedString,
    modifier: Modifier = Modifier,
    fontSize: TextUnit = TextUnit.Unspecified,
    fontWeight: FontWeight? = null,
    lineHeight: TextUnit = TextUnit.Unspecified,
    textAlign: TextAlign? = null,
    softWrap: Boolean = true,
) {
    val codes = remember(text) { text.getStringAnnotations(CODE_TAG, 0, text.length) }
    if(codes.isEmpty()) {
        Text(text, modifier, fontSize = fontSize, fontWeight = fontWeight, lineHeight = lineHeight, textAlign = textAlign, softWrap = softWrap)
        return
    }
    val colors = Jarvis.colors
    var layout by remember { mutableStateOf<TextLayoutResult?>(null) }
    Text(text, modifier.drawBehind {
        val result = layout ?: return@drawBehind
        val codeSize = result.layoutInput.style.fontSize.toPx() * 0.85f
        val radius = CornerRadius(codeSize * 0.4f)
        val stroke = Stroke(1.dp.toPx())
        codes.forEach { code -> codeBoxes(result, code.start, code.end, codeSize).forEach { box ->
            drawRoundRect(colors.surface, box.topLeft, box.size, radius)
            drawRoundRect(colors.border, box.topLeft, box.size, radius, style = stroke)
        } }
    }, fontSize = fontSize, fontWeight = fontWeight, lineHeight = lineHeight, textAlign = textAlign, softWrap = softWrap, onTextLayout = { layout = it })
}

/**
 * One box per line the characters [start] to [end] cover: the glyphs' width plus 0.3em each side, cap height to
 * descent. A side that touches other text (`board.ts.`) gets 0.1em, so the box does not run over the punctuation.
 */
private fun codeBoxes(layout: TextLayoutResult, start: Int, end: Int, codeSize: Float): List<Rect> {
    val text = layout.layoutInput.text.text
    if(start >= end || end > text.length) return emptyList()
    fun pad(neighbour: Int) = codeSize * (if(text.getOrNull(neighbour)?.isWhitespace() == false) 0.1f else 0.3f)
    return (layout.getLineForOffset(start)..layout.getLineForOffset(end - 1)).mapNotNull { line ->
        val from = maxOf(start, layout.getLineStart(line))
        val to = minOf(end, layout.getLineEnd(line, visibleEnd = true))
        if(from >= to) return@mapNotNull null
        val baseline = layout.getLineBaseline(line)
        val left = layout.getBoundingBox(from).left - (if(from == start) pad(start - 1) else codeSize * 0.3f)
        val right = layout.getBoundingBox(to - 1).right + (if(to == end) pad(end) else codeSize * 0.3f)
        Rect(left, baseline - codeSize * 1.05f, right, baseline + codeSize * 0.4f)
    }
}

/**
 * A GFM table in a rounded frame (web `.md .md-table`): a tinted header row, a rule under each row, columns as wide as
 * their content (cells from 96dp, wrapping past 320dp; header cells never wrap), filling the width when they fit and
 * scrolling sideways when they do not.
 */
@Composable private fun MarkdownTable(node: TableBlock, inline: (Node) -> AnnotatedString) {
    val colors = Jarvis.colors
    val rows = remember(node) { children(node).flatMap(::children) }
    val columns = rows.maxOfOrNull { children(it).size } ?: 0
    if(columns == 0) return
    val shape = RoundedCornerShape(14.dp)
    val ruleWidth = with(LocalDensity.current) { 1.dp.toPx() }
    BoxWithConstraints(Modifier.fillMaxWidth()) {
        val frame = maxWidth
        Box(Modifier.fillMaxWidth().clip(shape).border(1.dp, colors.border, shape).horizontalScroll(rememberScrollState())) {
            ProvideTextStyle(MaterialTheme.typography.bodyMedium.copy(fontFeatureSettings = "tnum")) {
                TableGrid(columns, rows.size, frame - 2.dp) {
                    rows.forEachIndexed { r, row ->
                        val cells = children(row)
                        val last = r == rows.lastIndex
                        repeat(columns) { c ->
                            val cell = cells.getOrNull(c) as? TableCell
                            val header = cell?.isHeader == true
                            Box(Modifier
                                .then(if(header) Modifier.background(colors.surface) else Modifier)
                                .drawBehind { if(!last) drawRect(colors.border, Offset(0f, size.height - ruleWidth), Size(size.width, ruleWidth)) }
                                .padding(horizontal = 12.dp, vertical = 8.dp)) {
                                if(cell != null) MarkdownText(inline(cell), fontWeight = if(header) FontWeight.SemiBold else null, softWrap = !header,
                                    textAlign = when(cell.alignment) { TableCell.Alignment.CENTER -> TextAlign.Center; TableCell.Alignment.RIGHT -> TextAlign.End; else -> TextAlign.Start },
                                    modifier = Modifier.fillMaxWidth())
                            }
                        }
                    }
                }
            }
        }
    }
}

/** Lays out [rows] × [columns] cells, row by row, sizing columns to their content and stretching them to [fill]. */
@Composable private fun TableGrid(columns: Int, rows: Int, fill: androidx.compose.ui.unit.Dp, content: @Composable () -> Unit) {
    Layout(content) { cells, _ ->
        val minColumn = 96.dp.roundToPx()
        // Header cells never wrap; body cells wrap down to their longest word, never under 96dp.
        val widest = IntArray(columns) { c -> (0 until rows).maxOf { r -> cells[r * columns + c].maxIntrinsicWidth(Constraints.Infinity).let { if(r == 0) it else maxOf(it, minColumn) } } }
        val narrowest = IntArray(columns) { c -> (0 until rows).maxOf { r ->
            val cell = cells[r * columns + c]
            if(r == 0) cell.maxIntrinsicWidth(Constraints.Infinity) else maxOf(cell.minIntrinsicWidth(Constraints.Infinity), minColumn)
        } }
        val widths = widest.copyOf()
        val total = widths.sum()
        val target = fill.roundToPx()
        if(total in 1 until target) {
            // Room to spare: every column grows in proportion, as a full-width HTML table's do.
            var spare = target - total
            for(c in 0 until columns) {
                val share = if(c == columns - 1) spare else (target - total) * widths[c] / total
                widths[c] += share; spare -= share
            }
        } else if(total > target) {
            // Too wide: wrap the columns that can, in proportion to what each can give; scroll only past that.
            val slack = (0 until columns).sumOf { widest[it] - narrowest[it] }
            if(slack > 0) {
                val need = minOf(total - target, slack)
                for(c in 0 until columns) widths[c] -= ((widest[c] - narrowest[c]).toLong() * need / slack).toInt()
            }
        }
        val heights = IntArray(rows) { r -> (0 until columns).maxOf { c -> cells[r * columns + c].minIntrinsicHeight(widths[c]) } }
        val placeables = cells.mapIndexed { i, cell -> cell.measure(Constraints.fixed(widths[i % columns], heights[i / columns])) }
        layout(widths.sum(), heights.sum()) {
            var y = 0
            for(r in 0 until rows) {
                var x = 0
                for(c in 0 until columns) { placeables[r * columns + c].place(x, y); x += widths[c] }
                y += heights[r]
            }
        }
    }
}
@Composable private fun CodeBlock(code: String, language: String) =
    LiteralCodeBlock(LiteralSection("Code",code,language))

/** The display and explicit copy action share exactly the same literal; never trim tool/file output. */
internal data class LiteralSection(
    val title: String,
    val content: String,
    val language: String = "",
    /** Always wraps, with no toggle (tool output). */
    val wrap: Boolean = false,
    /** Wraps until the reader chooses otherwise with the Wrap toggle (a bash command). */
    val wrapByDefault: Boolean = false,
)
internal fun literalContentForCopy(content: String): String = content
internal fun literalCopyLabel(section: LiteralSection): String = "Copy ${section.title.lowercase()}"

@Composable internal fun LiteralCodeBlock(section: LiteralSection, modifier: Modifier = Modifier) {
    val dark = MaterialTheme.colorScheme.background.luminance() < 0.5f
    val code = section.content
    val highlighted by produceState(AnnotatedString(code),code,section.language,dark) {
        value = ChatHighlighter.highlight(code,section.language,dark)
    }
    val choice = LocalCodeWrap.current
    val togglable = !section.wrap && section.language != "diff"
    val wrapped = section.wrap || (togglable && choice.wraps(section.wrapByDefault))
    val clipboard = LocalContext.current.getSystemService(android.content.ClipboardManager::class.java)
    var copied by remember(code) { mutableStateOf(false) }
    var copyFailed by remember(code) { mutableStateOf(false) }
    LaunchedEffect(copied) { if(copied) { kotlinx.coroutines.delay(1500); copied = false } }
    Surface(modifier.fillMaxWidth(),color = MaterialTheme.colorScheme.surfaceContainerLow,shape = MaterialTheme.shapes.medium) {
        Column(Modifier.fillMaxWidth().padding(horizontal = 12.dp).padding(bottom = 12.dp)) {
            Row(Modifier.fillMaxWidth(),verticalAlignment = Alignment.CenterVertically,horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(section.title + section.language.takeIf { it.isNotBlank() && it != "diff" }?.let { " · $it" }.orEmpty(),modifier = Modifier.weight(1f),style = MaterialTheme.typography.labelSmall,color = MaterialTheme.colorScheme.onSurfaceVariant,maxLines = 2,overflow = TextOverflow.Ellipsis)
                if(togglable) JarvisIconButton(Lucide.WrapText,"Wrap code",onClick = { choice.toggle(section.wrapByDefault) },pressed = wrapped)
                JarvisIconButton(if(copied) Lucide.Check else Lucide.Copy,literalCopyLabel(section),onClick = {
                    runCatching { clipboard.setPrimaryClip(android.content.ClipData.newPlainText(section.title,literalContentForCopy(section.content))) }
                        .onSuccess { copied = true; copyFailed = false }
                        .onFailure { copyFailed = true }
                })
            }
            if(copyFailed) Text("Could not copy. Select a smaller range or retry.",style = MaterialTheme.typography.bodySmall,color = MaterialTheme.colorScheme.error)
            // A diff reads as coloured lines with their numbers; everything else as highlighted text.
            if(section.language == "diff") DiffLines(code)
            else if(wrapped) WrappedCode(highlighted)
            else ScrollingCode(highlighted)
        }
    }
}

private val CodeStyle = TextStyle(fontFamily = FontFamily.Monospace,fontSize = 13.sp,lineHeight = 19.sp)

/**
 * Wrapped code: a hanging indent, and a small muted arrow in the indent of every row that continues a line, so a soft
 * wrap reads differently from a real newline. The arrow is drawn, not text: selecting and copying give the original.
 */
@Composable private fun WrappedCode(highlighted: AnnotatedString) {
    val indent = 16.sp
    val text = remember(highlighted) { buildAnnotatedString { withStyle(ParagraphStyle(textIndent = TextIndent(firstLine = 0.sp,restLine = indent))) { append(highlighted) } } }
    var layout by remember { mutableStateOf<TextLayoutResult?>(null) }
    val tint = Jarvis.colors.fgSubtle
    SelectionContainer {
        Text(text,style = CodeStyle,softWrap = true,onTextLayout = { layout = it },
            modifier = Modifier.fillMaxWidth().drawBehind {
                val result = layout ?: return@drawBehind
                val starts = List(result.lineCount) { result.getLineStart(it) }
                val stroke = Stroke(width = 1.5.dp.toPx(),cap = androidx.compose.ui.graphics.StrokeCap.Round,join = androidx.compose.ui.graphics.StrokeJoin.Round)
                for(line in softWrappedLines(highlighted.text,starts)) {
                    // Corner-down-right: down from the end of the row above, then right with a head.
                    val top = result.getLineTop(line); val bottom = result.getLineBottom(line)
                    val x = 2.dp.toPx(); val middle = (top + bottom) / 2; val head = 3.dp.toPx(); val reach = indent.toPx() - 4.dp.toPx()
                    val path = androidx.compose.ui.graphics.Path().apply {
                        moveTo(x,top); lineTo(x,middle); lineTo(x + reach,middle)
                        moveTo(x + reach - head,middle - head); lineTo(x + reach,middle); lineTo(x + reach - head,middle + head)
                    }
                    drawPath(path,tint,style = stroke)
                }
            })
    }
}

/** Sideways-scrolling code: the edge with more behind it fades out, so it reads as continuing. */
@Composable private fun ScrollingCode(highlighted: AnnotatedString) {
    val scroll = rememberScrollState()
    val fade by remember { derivedStateOf { scrollFade(scroll.value,scroll.maxValue) } }
    val fadeWidth = 28.dp
    SelectionContainer {
        Text(highlighted,style = CodeStyle,softWrap = false,
            modifier = Modifier
                .graphicsLayer { compositingStrategy = androidx.compose.ui.graphics.CompositingStrategy.Offscreen }
                .drawWithContent {
                    drawContent()
                    val width = fadeWidth.toPx().coerceAtMost(size.width / 2)
                    val clear = androidx.compose.ui.graphics.Color.Transparent; val solid = androidx.compose.ui.graphics.Color.Black
                    if(fade.start) drawRect(Brush.horizontalGradient(listOf(clear,solid),startX = 0f,endX = width),size = Size(width,size.height),blendMode = androidx.compose.ui.graphics.BlendMode.DstIn)
                    if(fade.end) drawRect(Brush.horizontalGradient(listOf(solid,clear),startX = size.width - width,endX = size.width),topLeft = Offset(size.width - width,0f),size = Size(width,size.height),blendMode = androidx.compose.ui.graphics.BlendMode.DstIn)
                }
                .horizontalScroll(scroll))
    }
}
