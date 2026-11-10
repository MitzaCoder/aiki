package io.github.mitzacoder.aiki.features.chat

import org.commonmark.node.*
import org.commonmark.parser.Parser
import org.commonmark.ext.gfm.tables.TablesExtension
import org.commonmark.ext.gfm.tables.TableCell

private val previewParser = Parser.builder().extensions(listOf(TablesExtension.create())).build()

/** Plain option labels, notification bodies and previews. Parse the whole source before truncating the result. */
fun markdownText(source: String): String = buildString {
    fun visit(node: Node) {
        when (node) {
            is Text -> append(node.literal)
            is Code -> append(node.literal)
            is FencedCodeBlock -> append(node.literal)
            is IndentedCodeBlock -> append(node.literal)
            is HtmlBlock, is HtmlInline -> Unit
            is SoftLineBreak, is HardLineBreak, is ThematicBreak -> append(' ')
            else -> {
                var child = node.firstChild
                while (child != null) { visit(child); child = child.next }
                if (node is Paragraph || node is Heading || node is ListItem || node is TableCell) append(' ')
            }
        }
    }
    visit(previewParser.parse(source))
}.replace(Regex("\\s+"), " ").trim()
