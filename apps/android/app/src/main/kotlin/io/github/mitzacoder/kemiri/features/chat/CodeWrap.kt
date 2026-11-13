package io.github.mitzacoder.kemiri.features.chat

import androidx.compose.runtime.compositionLocalOf

/**
 * Whether code in the chat wraps or scrolls sideways, as on the web (`lib/code-wrap.ts`): one choice for every block on
 * this device, "wrap" or "scroll", null until the reader chose. Until then a block follows its own default (a bash
 * command wraps, other code scrolls).
 */
internal const val CODE_WRAP = "wrap"
internal const val CODE_SCROLL = "scroll"

internal fun effectiveWrap(preference: String?, defaultWrap: Boolean): Boolean = when (preference) {
    CODE_WRAP -> true
    CODE_SCROLL -> false
    else -> defaultWrap
}

/** The reader's stored choice and how to change it; provided around the app from [io.github.mitzacoder.kemiri.data.DeviceSettings]. */
class CodeWrapChoice(val stored: String?, val choose: (String) -> Unit) {
    internal fun wraps(defaultWrap: Boolean) = effectiveWrap(stored, defaultWrap)
    internal fun toggle(defaultWrap: Boolean) = choose(if (wraps(defaultWrap)) CODE_SCROLL else CODE_WRAP)
}

val LocalCodeWrap = compositionLocalOf { CodeWrapChoice(null) {} }

/** The edges of a sideways scroller that have more behind them; `slack` forgives rounding. */
internal data class ScrollFade(val start: Boolean, val end: Boolean)

internal fun scrollFade(value: Int, max: Int, slack: Int = 1) = ScrollFade(start = value > slack, end = value < max - slack)

/**
 * The lines of a wrapped text that start in the middle of a logical line (the text before them is not a newline), given
 * where each laid-out line starts. These get the continuation arrow.
 */
internal fun softWrappedLines(text: CharSequence, lineStarts: List<Int>): List<Int> =
    lineStarts.indices.filter { index -> lineStarts[index].let { it > 0 && it <= text.length && text[it - 1] != '\n' } }
