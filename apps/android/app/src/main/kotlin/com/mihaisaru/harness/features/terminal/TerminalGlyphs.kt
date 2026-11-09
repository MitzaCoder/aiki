// Subset of Lucide (@lucide/svelte 1.64.0), ISC license; see LUCIDE-LICENSE.txt.
package com.mihaisaru.harness.features.terminal

import com.mihaisaru.harness.ui.components.LucideIcon

/** The icons the terminal screen draws beside the shared set. */
object TerminalGlyphs {
    val List = LucideIcon("list", "M3 5h.01", "M3 12h.01", "M3 19h.01", "M8 5h13", "M8 12h13", "M8 19h13")
    val ClipboardPaste = LucideIcon("clipboard-paste", "M11 14h10", "M16 4h2a2 2 0 0 1 2 2v1.344", "m17 18 4-4-4-4", "M8 4H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 1.793-1.113",
        "M9 2h6a1 1 0 0 1 1 1v2a1 1 0 0 1 -1 1h-6a1 1 0 0 1 -1 -1v-2a1 1 0 0 1 1 -1Z")
    val RotateCw = LucideIcon("rotate-cw", "M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8", "M21 3v5h-5")
}
