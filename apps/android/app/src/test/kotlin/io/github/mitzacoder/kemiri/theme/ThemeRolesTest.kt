package io.github.mitzacoder.kemiri.theme

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.luminance
import io.github.mitzacoder.kemiri.data.ThemePalette
import io.github.mitzacoder.kemiri.ui.theme.*
import org.junit.Assert.*
import org.junit.Test
import kotlin.math.max
import kotlin.math.min

class ThemeRolesTest {
    private fun contrast(a: Color, b: Color): Double {
        val x = a.luminance().toDouble(); val y = b.luminance().toDouble()
        return (max(x, y) + .05) / (min(x, y) + .05)
    }
    private fun achromatic(color: Color) {
        assertEquals(color.red, color.green, .00001f)
        assertEquals(color.green, color.blue, .00001f)
    }
    @Test fun allCardAndSelectionSurfacesComeFromOurTokens() {
        ThemePalette.entries.forEach { palette -> listOf(false, true).forEach { dark ->
            val c = harnessColors(palette, dark)
            val s = harnessColorScheme(c)
            assertEquals(c.bg, s.surfaceContainerLowest)
            assertEquals(c.surface, s.surfaceContainerLow)
            assertEquals(c.surface, s.surfaceContainer)
            assertEquals(c.surface2, s.surfaceContainerHigh)
            assertEquals(c.surface2, s.surfaceContainerHighest)
            assertEquals(c.surface2, s.secondaryContainer)
            assertEquals(c.fg, s.onSecondaryContainer)
            assertEquals(c.surface2, s.primaryContainer)
            assertEquals(c.fg, s.onPrimaryContainer)
        } }
    }
    @Test fun neutralHasNoNonSemanticLavenderRolesButKeepsStatusColors() {
        listOf(false, true).forEach { dark ->
            val c = harnessColors(ThemePalette.Neutral, dark)
            val s = harnessColorScheme(c)
            listOf(c.bgElev, c.ring, c.shadow, s.primary, s.onPrimary, s.primaryContainer,
                s.secondary, s.secondaryContainer, s.tertiary, s.tertiaryContainer,
                s.background, s.surface, s.surfaceVariant, s.surfaceContainerLowest,
                s.surfaceContainerLow, s.surfaceContainer, s.surfaceContainerHigh,
                s.surfaceContainerHighest, s.surfaceBright, s.surfaceDim, s.surfaceTint,
                s.inverseSurface, s.inverseOnSurface, s.inversePrimary,
                s.primaryFixed, s.primaryFixedDim, s.onPrimaryFixed, s.onPrimaryFixedVariant,
                s.secondaryFixed, s.secondaryFixedDim, s.onSecondaryFixed, s.onSecondaryFixedVariant,
                s.tertiaryFixed, s.tertiaryFixedDim, s.onTertiaryFixed, s.onTertiaryFixedVariant).forEach(::achromatic)
            val jarvis = if (dark) DarkColors else LightColors
            assertEquals(jarvis.danger, c.danger)
            assertEquals(jarvis.success, c.success)
            assertEquals(jarvis.warning, c.warning)
            assertEquals(c.danger, s.error)
        }
    }
    @Test fun darkTextActionsLinksAndFilledButtonLabelsHaveReadablePairs() {
        ThemePalette.entries.forEach { palette ->
            val c = harnessColors(palette, true)
            val s = harnessColorScheme(c)
            // Actual Material3 token bindings: TextButton/OutlinedButton label = primary;
            // FilledButton container = primary, label = onPrimary (not white in dark Jarvis).
            listOf(c.bg, s.surfaceContainerLow, s.surfaceContainerHigh, s.secondaryContainer).forEach { surface ->
                assertTrue("$palette action contrast ${contrast(s.primary, surface)}", contrast(s.primary, surface) >= 4.5)
                assertTrue("$palette link contrast ${contrast(c.link, surface)}", contrast(c.link, surface) >= 4.5)
            }
            assertTrue("$palette filled-button contrast", contrast(s.primary, s.onPrimary) >= 4.5)
            assertTrue("$palette selected-row contrast", contrast(s.secondaryContainer, s.onSecondaryContainer) >= 4.5)
        }
    }
    @Test fun otherFilledRolesAndNeutralPrimaryKeepContrastingLabels() {
        ThemePalette.entries.forEach { palette -> listOf(false, true).forEach { dark ->
            val s = harnessColorScheme(harnessColors(palette, dark))
            listOf(s.secondary to s.onSecondary, s.tertiary to s.onTertiary,
                s.error to s.onError, s.errorContainer to s.onErrorContainer,
                s.primaryContainer to s.onPrimaryContainer).forEach { (fill, foreground) ->
                assertTrue("$palette dark=$dark role contrast ${contrast(fill, foreground)}", contrast(fill, foreground) >= 4.5)
            }
            if (palette == ThemePalette.Neutral) assertTrue(contrast(s.primary, s.onPrimary) >= 4.5)
        } }
    }
    @Test fun darkPrimaryMatchesWebPairWhileLightFillAndGradientRemainUnchanged() {
        val dark = harnessColorScheme(DarkColors)
        assertEquals(Color(0xFF15141F), dark.surfaceContainerLow)
        assertEquals(Color(0xFF1D1B2B), dark.secondaryContainer)
        val neutralLight = harnessColorScheme(harnessColors(ThemePalette.Neutral, false))
        assertEquals(Color(0xFFF5F5F5), neutralLight.surfaceContainerLow)
        assertEquals(Color(0xFFE5E5E5), neutralLight.secondaryContainer)
        assertEquals(Color(0xFF818CF8), dark.primary)
        assertEquals(Color(0xFF0B0B14), dark.onPrimary)
        assertEquals(Accent2, harnessColorScheme(LightColors).primary)
        assertEquals(Color.White, harnessColorScheme(LightColors).onPrimary)
        assertEquals(Accent2, DarkColors.accent2)
    }
}
