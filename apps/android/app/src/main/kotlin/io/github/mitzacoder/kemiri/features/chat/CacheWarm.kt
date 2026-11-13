package io.github.mitzacoder.kemiri.features.chat

import io.github.mitzacoder.kemiri.protocol.CacheWarmStretch
import java.text.DateFormat
import java.util.Date
import java.util.Locale

/** Same grouping as web: stable stretch identity, newest version, loaded anchors only. */
fun cacheWarmByAnchor(stretches: List<CacheWarmStretch>, entryIds: Set<Long>): Map<Long, List<CacheWarmStretch>> =
    stretches.filter { it.attempts > 0 && it.anchorEntryId in entryIds }
        .groupBy { it.id }.values.mapNotNull { versions -> versions.maxByOrNull { it.lastAt } }
        .sortedBy { it.startedAt }.groupBy { it.anchorEntryId }

fun cacheWarmLabel(stretch: CacheWarmStretch): String {
    val label = if (stretch.refreshes > 0) "Cache kept warm · ${stretch.refreshes} ${if (stretch.refreshes == 1L) "refresh" else "refreshes"}" else "Cache refresh stopped"
    return "$label · ~${String.format(Locale.US, "$%.2f", stretch.cost)}"
}
fun cacheWarmDetail(stretch: CacheWarmStretch): String {
    val format = DateFormat.getDateTimeInstance(DateFormat.SHORT, DateFormat.SHORT)
    return "${format.format(Date(stretch.startedAt.toLong()))} – ${format.format(Date(stretch.lastAt.toLong()))} · ${String.format(Locale.US, "%,.0f", stretch.cachedTokens)} cached-input tokens · ${String.format(Locale.US, "$%.4f", stretch.cost)} equivalent. ${stretch.stopped ?: "Refreshing while idle"}."
}
