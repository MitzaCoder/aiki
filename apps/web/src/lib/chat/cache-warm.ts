import type { CacheWarmStretch } from '@kemiri/protocol';
/** Last version per stretch; pages and live history may overlap. Never draw an orphan anchor. */
export function cacheWarmByAnchor(stretches: readonly CacheWarmStretch[], entryIds: ReadonlySet<number>): Map<number, CacheWarmStretch[]> {
	const latest = new Map<string, CacheWarmStretch>();
	for (const stretch of stretches) {
		const previous = latest.get(stretch.id);
		if (stretch.attempts > 0 && entryIds.has(stretch.anchorEntryId) &&
			(previous === undefined || stretch.lastAt >= previous.lastAt)) latest.set(stretch.id, stretch);
	}
	const anchors = new Map<number, CacheWarmStretch[]>();
	for (const stretch of [...latest.values()].sort((a,b) => a.startedAt - b.startedAt)) {
		anchors.set(stretch.anchorEntryId, [...(anchors.get(stretch.anchorEntryId) ?? []), stretch]);
	}
	return anchors;
}
export function cacheWarmLabel(stretch: CacheWarmStretch): string {
	const label = stretch.refreshes > 0 ? `Cache kept warm · ${stretch.refreshes} ${stretch.refreshes === 1 ? 'refresh' : 'refreshes'}` : 'Cache refresh stopped';
	return `${label} · ~$${stretch.cost.toFixed(2)}`;
}
export function cacheWarmDetail(stretch: CacheWarmStretch): string {
	return `${new Date(stretch.startedAt).toLocaleString()} – ${new Date(stretch.lastAt).toLocaleString()} · ${stretch.cachedTokens.toLocaleString()} cached-input tokens · $${stretch.cost.toFixed(4)} equivalent. ${stretch.stopped ?? 'Refreshing while idle'}.`;
}
