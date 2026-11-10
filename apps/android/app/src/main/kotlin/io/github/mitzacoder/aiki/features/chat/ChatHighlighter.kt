package io.github.mitzacoder.aiki.features.chat

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.*
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.eclipse.tm4e.core.grammar.IStateStack
import org.eclipse.tm4e.core.registry.IGrammarSource
import org.eclipse.tm4e.core.registry.Registry
import java.time.Duration

/** Small bounded TextMate grammar: no webview, downloaded grammars or unbounded token cache. */
internal object ChatHighlighter {
    private val grammar by lazy {
        val source = """{"scopeName":"source.harness","patterns":[
            {"name":"comment.line","match":"//.*$|#.*$"},
            {"name":"string.quoted.double","begin":"\"","end":"\"","patterns":[{"name":"constant.character.escape","match":"\\\\."}]},
            {"name":"string.quoted.single","begin":"'","end":"'"},
            {"name":"constant.numeric","match":"\\b[0-9]+(?:\\.[0-9]+)?\\b"},
            {"name":"keyword.control","match":"\\b(?:fun|val|var|const|let|function|return|if|else|for|while|class|interface|import|from|export|async|await|def|try|catch|throw|new|public|private|suspend|when|in|is|true|false|null|None|True|False)\\b"}
        ]}"""
        Registry().addGrammar(IGrammarSource.fromInputStream(source.byteInputStream(),"harness.json",null))
    }
    suspend fun highlight(code: String, language: String, dark: Boolean): AnnotatedString = withContext(Dispatchers.Default) {
        if(code.length > 50000 || language.trim().lowercase() in setOf("","text","plaintext","txt")) return@withContext AnnotatedString(code)
        runCatching { synchronized(this@ChatHighlighter) {
            buildAnnotatedString {
                var state: IStateStack? = null
                val lines = code.split('\n')
                lines.forEachIndexed { index,line ->
                    val lineStart = length
                    append(line)
                    val result = grammar.tokenizeLine(line,state,Duration.ofMillis(20))
                    result.tokens.forEach { token ->
                        val scopes = token.scopes.joinToString(" ")
                        val color = when {
                            "comment" in scopes -> if(dark) Color(0xFF9399B2) else Color(0xFF6C6F85)
                            "string" in scopes -> if(dark) Color(0xFFA6E3A1) else Color(0xFF40A02B)
                            "numeric" in scopes -> if(dark) Color(0xFFFAB387) else Color(0xFFFE640B)
                            "keyword" in scopes -> if(dark) Color(0xFFCBA6F7) else Color(0xFF8839EF)
                            else -> Color.Unspecified
                        }
                        addStyle(SpanStyle(color = color),lineStart + token.startIndex.coerceIn(0,line.length),lineStart + token.endIndex.coerceIn(0,line.length))
                    }
                    state = result.ruleStack
                    if(index < lines.lastIndex) append('\n')
                }
            }
        } }.getOrDefault(AnnotatedString(code))
    }
}
