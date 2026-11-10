package io.github.mitzacoder.aiki.ui.theme

import androidx.compose.material3.Typography
import androidx.compose.ui.text.ExperimentalTextApi
import androidx.compose.ui.text.PlatformTextStyle
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontVariation
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.LineHeightStyle
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import io.github.mitzacoder.aiki.R

/** Every weight the web uses, including in-between ones like 550 and 650. */
private val WEIGHTS = listOf(100, 200, 250, 300, 400, 500, 550, 600, 650, 700, 750, 800, 900)

@OptIn(ExperimentalTextApi::class)
private fun variable(res: Int, weights: List<Int>) = FontFamily(
    weights.map { w ->
        Font(res, FontWeight(w), variationSettings = FontVariation.Settings(FontVariation.weight(w)))
    },
)

/** Atkinson Hyperlegible Next, as the web's `Atkinson Hyperlegible Next Variable` (200–800; others clamp). */
val Sans = variable(R.font.atkinson_hyperlegible_next, WEIGHTS)

/** JetBrains Mono, as the web's `JetBrains Mono Variable` (100–800). */
val JetBrainsMono = variable(R.font.jetbrains_mono, WEIGHTS.filter { it <= 800 })

/** `font-feature-settings: 'cv11', 'ss01', 'ss03'` on the body. */
const val SANS_FEATURES = "cv11, ss01, ss03"

private val Trim = LineHeightStyle(LineHeightStyle.Alignment.Center, LineHeightStyle.Trim.None)

/** A text style in the web's terms: size in rem, unitless line height. */
fun textStyle(
    rem: Float,
    lineHeight: Float = 1.5f,
    weight: Int = 400,
    mono: Boolean = false,
    letterSpacing: Float = 0f,
): TextStyle = TextStyle(
    fontFamily = if (mono) JetBrainsMono else Sans,
    fontFeatureSettings = if (mono) null else SANS_FEATURES,
    fontSize = (rem * 16).sp,
    lineHeight = (rem * 16 * lineHeight).sp,
    fontWeight = FontWeight(weight),
    letterSpacing = letterSpacing.em,
    lineHeightStyle = Trim,
    platformStyle = PlatformTextStyle(includeFontPadding = false),
)

/** Tailwind's text-* scale: size and its paired line height. */
object Text {
    val xs = textStyle(0.75f, 1f / 0.75f)
    val sm = textStyle(0.875f, 1.25f / 0.875f)
    val base = textStyle(1f, 1.5f)
    val lg = textStyle(1.125f, 1.75f / 1.125f)
    val xl = textStyle(1.25f, 1.75f / 1.25f)
    val xl3 = textStyle(1.875f, 2.25f / 1.875f)
    val xl4 = textStyle(2.25f, 2.5f / 2.25f)
    /** A task's title and report text (web `--text-task`): a step above `sm`, so tasks read first. */
    val task = textStyle(0.9375f, 1.5f / 0.9375f)
    /** A task's secondary lines (web `--text-task-sm`). */
    val taskSm = textStyle(0.8125f, 1.25f / 0.8125f)
}

val HarnessTypography = Typography(
    bodyLarge = Text.base,
    bodyMedium = Text.sm,
    bodySmall = Text.xs,
    labelLarge = Text.sm.copy(fontWeight = FontWeight(500)),
    labelMedium = Text.xs.copy(fontWeight = FontWeight(500)),
    titleMedium = Text.base.copy(fontWeight = FontWeight(600)),
)
