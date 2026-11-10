// Subset of Lucide (@lucide/svelte 1.47.0), ISC license; see LUCIDE-LICENSE.txt. Rects and lines written as paths.
package io.github.mitzacoder.aiki.navigation

import io.github.mitzacoder.aiki.ui.components.LucideIcon

/** The icons the projects sidebar, its footer and the side panel's expand button draw, beside the shared set. */
object NavGlyphs {
    val Gauge = LucideIcon("gauge", "m12 14 4-4", "M3.34 19a10 10 0 1 1 17.32 0")
    val Server = LucideIcon("server", "M4 2h16a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z", "M4 14h16a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2z", "M6 6h.01", "M6 18h.01")
    val Settings = LucideIcon("settings", "M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915", "M9 12a3 3 0 1 0 6 0a3 3 0 1 0 -6 0")
    val ChevronsLeft = LucideIcon("chevrons-left", "m11 17-5-5 5-5", "m18 17-5-5 5-5")
    val ChevronsRight = LucideIcon("chevrons-right", "m6 17 5-5-5-5", "m13 17 5-5-5-5")
    val Maximize2 = LucideIcon("maximize-2", "M15 3h6v6", "m21 3-7 7", "m3 21 7-7", "M9 21H3v-6")
    val Minimize2 = LucideIcon("minimize-2", "m14 10 7-7", "M20 10h-6V4", "m3 21 7-7", "M4 14h6v6")
}
