package com.mihaisaru.harness.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.text.selection.LocalTextSelectionColors
import androidx.compose.foundation.text.selection.TextSelectionColors
import androidx.compose.material3.ColorScheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.ReadOnlyComposable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.lerp

/**
 * The web app's design tokens (`apps/web/src/lib/themes/{jarvis,neutral}.css`), so
 * both apps look the same: a violet-tinted neutral scale, four accents and
 * the gradient running through them.
 */
@Immutable
data class JarvisColors(
    val dark: Boolean,
    val neutral: Boolean = false,
    val bg: Color,
    /** Glass surfaces: `bg` at 80%, over a blur of what is behind. */
    val bgElev: Color,
    val surface: Color,
    val surface2: Color,
    val border: Color,
    val borderStrong: Color,
    val fg: Color,
    val fgMuted: Color,
    val fgSubtle: Color,
    val userBubbleFrom: Color,
    val userBubbleTo: Color,
    val userBorder: Color,
    val ring: Color,
    val danger: Color,
    val success: Color,
    val warning: Color,
    /** The color of `--shadow-lg`'s large, soft layer. */
    val shadow: Color,
    /** Links in markdown: `accent2`, lighter in the dark. */
    val link: Color,
) {
    val accent1 get() = if (neutral) fgMuted else Accent1
    val accent2 get() = if (neutral) fg else Accent2
    val accent3 get() = if (neutral) fgSubtle else Accent3
    val accent4 get() = if (neutral) borderStrong else Accent4

    /** `--grad`: cyan, indigo, fuchsia, orange. */
    val gradStops get() = arrayOf(0f to accent1, 0.4f to accent2, 0.75f to accent3, 1f to accent4)

    fun grad(): Brush = Brush.linearGradient(colorStops = gradStops)

    fun userBubble(): Brush = Brush.linearGradient(listOf(userBubbleFrom, userBubbleTo))

    /** A task status' colour (web `--task-status-<tone>`): the theme's own tones, to-do and dropped faded toward the background. */
    fun taskStatus(tone: TaskStatusTone): Color = when (tone) {
        TaskStatusTone.Todo -> fgSubtle.mix(bg, 80f)
        TaskStatusTone.Working -> accent2
        TaskStatusTone.Review -> warning
        TaskStatusTone.Waiting -> accent2
        TaskStatusTone.Blocked -> danger
        TaskStatusTone.Done -> success
        TaskStatusTone.Dropped -> fgSubtle.mix(bg, 55f)
    }
}

/** One colour per task status, named for what it means (`in_progress` reads "working"); web `taskStatusTone`. */
enum class TaskStatusTone { Todo, Working, Review, Waiting, Blocked, Done, Dropped }

val Accent1 = Color(0xFF22D3EE)
val Accent2 = Color(0xFF6366F1)
val Accent3 = Color(0xFFD946EF)
val Accent4 = Color(0xFFFB923C)

val GradStops = arrayOf(0f to Accent1, 0.4f to Accent2, 0.75f to Accent3, 1f to Accent4)

val LightColors = JarvisColors(
    dark = false,
    bg = Color(0xFFFBFAFF),
    bgElev = Color(0xCCFFFFFF),
    surface = Color(0xFFF3F1FB),
    surface2 = Color(0xFFEAE7F6),
    border = Color(0xFFE3DFF0),
    borderStrong = Color(0xFFD2CCE6),
    fg = Color(0xFF1A1830),
    fgMuted = Color(0xFF5D5A78),
    fgSubtle = Color(0xFF8C89A6),
    userBubbleFrom = Color(0xFFEEF2FF),
    userBubbleTo = Color(0xFFFAE8FF),
    userBorder = Color(0xFFDDD6FE),
    ring = Color(0xFF8B5CF6),
    danger = Color(0xFFE11D48),
    success = Color(0xFF059669),
    warning = Color(0xFFD97706),
    shadow = Color(76, 29, 149).copy(alpha = 0.25f),
    link = Accent2,
)

val DarkColors = JarvisColors(
    dark = true,
    bg = Color(0xFF09090F),
    bgElev = Color(0xCC13121D),
    surface = Color(0xFF15141F),
    surface2 = Color(0xFF1D1B2B),
    border = Color(0xFF262437),
    borderStrong = Color(0xFF34314B),
    fg = Color(0xFFECEBF5),
    fgMuted = Color(0xFFA3A0BD),
    fgSubtle = Color(0xFF6E6B88),
    userBubbleFrom = Color(0xFF1E1B4B),
    userBubbleTo = Color(0xFF3B0F4A),
    userBorder = Color(0xFF3F3470),
    ring = Color(0xFFA78BFA),
    danger = Color(0xFFFB7185),
    success = Color(0xFF34D399),
    warning = Color(0xFFFBBF24),
    shadow = Color.Black.copy(alpha = 0.7f),
    link = Color(0xFFA5B4FC),
)

/** `color-mix(in oklab, this p%, other)`; Compose's `lerp` works in Oklab too. */
fun Color.mix(other: Color, percent: Float): Color = lerp(other, this, percent / 100f)

/** `color-mix(in oklab, this p%, transparent)`. */
fun Color.fade(percent: Float): Color = copy(alpha = alpha * percent / 100f)

val LocalJarvisColors = staticCompositionLocalOf { LightColors }

object Jarvis {
    val colors: JarvisColors
        @Composable @ReadOnlyComposable get() = LocalJarvisColors.current
}

@Composable
fun HarnessTheme(
    palette: com.mihaisaru.harness.data.ThemePalette = com.mihaisaru.harness.data.ThemePalette.Jarvis,
    mode: com.mihaisaru.harness.data.ThemeMode = com.mihaisaru.harness.data.ThemeMode.System,
    content: @Composable () -> Unit,
) {
    val darkTheme = when (mode) {
        com.mihaisaru.harness.data.ThemeMode.System -> isSystemInDarkTheme()
        com.mihaisaru.harness.data.ThemeMode.Light -> false
        com.mihaisaru.harness.data.ThemeMode.Dark -> true
    }
    val colors = harnessColors(palette, darkTheme)
    val scheme = harnessColorScheme(colors)
    CompositionLocalProvider(
        LocalJarvisColors provides colors,
        // `::selection`: indigo at 30%.
        LocalTextSelectionColors provides TextSelectionColors(colors.accent2, colors.accent2.fade(30f)),
    ) {
        MaterialTheme(colorScheme = scheme, typography = HarnessTypography, content = content)
    }
}

/** Pure token selection shared by production and JVM role regression tests. */
internal fun harnessColors(palette: com.mihaisaru.harness.data.ThemePalette, darkTheme: Boolean): JarvisColors {
    val base = if (darkTheme) DarkColors else LightColors
    return if (palette == com.mihaisaru.harness.data.ThemePalette.Neutral) {
        if (darkTheme) base.copy(neutral = true, bgElev = Color(0xCC171717), ring = Color(0xFF808080), bg = Color(0xFF0A0A0A), surface = Color(0xFF171717), surface2 = Color(0xFF262626),
            fg = Color(0xFFFAFAFA), fgMuted = Color(0xFFA3A3A3), fgSubtle = Color(0xFF808080), border = Color.White.copy(alpha = .12f),
            borderStrong = Color.White.copy(alpha = .22f), userBubbleFrom = Color(0xFF262626), userBubbleTo = Color(0xFF262626),
            userBorder = Color.White.copy(alpha = .14f), link = Color(0xFFD4D4D4))
        else base.copy(neutral = true, bgElev = Color(0xCCFFFFFF), ring = Color(0xFF929292), shadow = Color.Black.copy(alpha = .16f), bg = Color.White, surface = Color(0xFFF5F5F5), surface2 = Color(0xFFE5E5E5),
            fg = Color(0xFF0A0A0A), fgMuted = Color(0xFF737373), fgSubtle = Color(0xFF929292), border = Color(0xFFE5E5E5),
            borderStrong = Color(0xFFD4D4D4), userBubbleFrom = Color(0xFFF5F5F5), userBubbleTo = Color(0xFFF5F5F5),
            userBorder = Color(0xFFE5E5E5), link = Color(0xFF262626))
    } else base
}

/** Complete Material mapping: factories otherwise inject lavender/warm Material defaults.
 * Material3 1.4 TextButton/OutlinedButton labels AND FilledButton containers use primary.
 * Match the web's dark primary/primary-fg pair together, not a lighter fill with white text.
 * Gradient accents stay untouched; container and fixed roles deliberately use surface tokens.
 */
internal fun harnessColorScheme(colors: JarvisColors): ColorScheme {
    val darkPrimary = Color(0xFF818CF8)
    val darkPrimaryForeground = Color(0xFF0B0B14)
    val palette = if (colors.neutral) com.mihaisaru.harness.data.ThemePalette.Neutral else com.mihaisaru.harness.data.ThemePalette.Jarvis
    val inverse = harnessColors(palette, !colors.dark)
    val fixed = harnessColors(palette, false)
    return ColorScheme(
        primary = if (colors.dark && !colors.neutral) darkPrimary else colors.accent2,
        onPrimary = if (colors.dark) { if (colors.neutral) colors.bg else darkPrimaryForeground } else Color.White,
        primaryContainer = colors.surface2, onPrimaryContainer = colors.fg,
        inversePrimary = inverse.fg,
        secondary = colors.accent3, onSecondary = Color.Black,
        secondaryContainer = colors.surface2, onSecondaryContainer = colors.fg,
        tertiary = colors.accent1, onTertiary = if (colors.neutral && !colors.dark) Color.White else Color.Black,
        tertiaryContainer = colors.surface2, onTertiaryContainer = colors.fg,
        background = colors.bg, onBackground = colors.fg,
        surface = colors.bg, onSurface = colors.fg,
        surfaceVariant = colors.surface, onSurfaceVariant = colors.fgMuted,
        surfaceTint = colors.surface,
        inverseSurface = inverse.surface, inverseOnSurface = inverse.fg,
        error = colors.danger, onError = if (colors.dark) darkPrimaryForeground else Color.White,
        errorContainer = colors.danger.mix(colors.surface, 12f), onErrorContainer = colors.fg,
        outline = colors.border, outlineVariant = colors.border,
        scrim = Color.Black,
        surfaceBright = if (colors.dark) colors.surface2 else colors.bg,
        surfaceDim = if (colors.dark) colors.bg else colors.surface2,
        surfaceContainerLowest = colors.bg,
        surfaceContainerLow = colors.surface,
        surfaceContainer = colors.surface,
        surfaceContainerHigh = colors.surface2,
        surfaceContainerHighest = colors.surface2,
        primaryFixed = fixed.surface2, primaryFixedDim = fixed.borderStrong,
        onPrimaryFixed = fixed.fg, onPrimaryFixedVariant = fixed.fgMuted,
        secondaryFixed = fixed.surface2, secondaryFixedDim = fixed.borderStrong,
        onSecondaryFixed = fixed.fg, onSecondaryFixedVariant = fixed.fgMuted,
        tertiaryFixed = fixed.surface2, tertiaryFixedDim = fixed.borderStrong,
        onTertiaryFixed = fixed.fg, onTertiaryFixedVariant = fixed.fgMuted,
    )
}
