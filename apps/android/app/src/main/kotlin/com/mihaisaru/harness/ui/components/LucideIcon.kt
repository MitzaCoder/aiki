package com.mihaisaru.harness.ui.components

import androidx.compose.foundation.layout.size
import androidx.compose.material3.LocalContentColor
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathParser
import androidx.compose.ui.graphics.vector.rememberVectorPainter
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.foundation.Image
import androidx.compose.ui.graphics.ColorFilter

/** A Lucide icon: path data on a 24×24 grid, stroked with round caps and joins. */
@Immutable
class LucideIcon(val name: String, vararg val paths: String) {
    private val cache = HashMap<Long, ImageVector>()

    /** The icon at a stroke width, optionally filled too (Tailwind's `fill-current`). */
    fun vector(strokeWidth: Float = 2f, filled: Boolean = false): ImageVector {
        val key = (strokeWidth.toBits().toLong() shl 1) or (if (filled) 1L else 0L)
        return cache.getOrPut(key) {
            ImageVector.Builder(name, 24.dp, 24.dp, 24f, 24f).apply {
                for (d in paths) {
                    addPath(
                        pathData = PathParser().parsePathString(d).toNodes(),
                        fill = if (filled) SolidColor(Color.Black) else null,
                        stroke = SolidColor(Color.Black),
                        strokeLineWidth = strokeWidth,
                        strokeLineCap = StrokeCap.Round,
                        strokeLineJoin = StrokeJoin.Round,
                    )
                }
            }.build()
        }
    }
}

/**
 * Draws a Lucide icon tinted with [tint]; by default the current content
 * color, like `currentColor` on the web.
 */
@Composable
fun LucideGlyph(
    icon: LucideIcon,
    modifier: Modifier = Modifier,
    size: Dp = 16.dp,
    tint: Color = LocalContentColor.current,
    strokeWidth: Float = 2f,
    filled: Boolean = false,
    contentDescription: String? = null,
) {
    val vector = remember(icon, strokeWidth, filled) { icon.vector(strokeWidth, filled) }
    Image(
        painter = rememberVectorPainter(vector),
        contentDescription = contentDescription,
        modifier = modifier.size(size),
        colorFilter = ColorFilter.tint(tint),
    )
}
