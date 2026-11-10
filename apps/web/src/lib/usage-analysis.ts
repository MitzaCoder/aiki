import type { UsageGroup } from '@aiki/protocol';
export const USAGE_TABS = ['Overview', 'By role', 'By model', 'Projects & tasks', 'Waste'] as const;
export type UsageTab = (typeof USAGE_TABS)[number];
export function usageTabKey(tab: UsageTab): string {
	return tab.toLowerCase().replaceAll(/[^a-z]+/g, '-');
}
export function usageTabAfterKey(tab: UsageTab, key: string): UsageTab | undefined {
	const index = USAGE_TABS.indexOf(tab);
	if (key === 'Home') return USAGE_TABS[0];
	if (key === 'End') return USAGE_TABS.at(-1);
	if (key === 'ArrowRight') return USAGE_TABS[(index + 1) % USAGE_TABS.length];
	if (key === 'ArrowLeft') return USAGE_TABS[(index + USAGE_TABS.length - 1) % USAGE_TABS.length];
	return undefined;
}
export function usageTokenTotal(group: UsageGroup): number {
	return group.inputTokens + group.cacheReadTokens + group.cacheWriteTokens + group.outputTokens;
}
export function usageCostShare(group: UsageGroup, total: number): number {
	return total > 0 ? (100 * group.cost) / total : 0;
}
export function promptReuse(group: UsageGroup): number | null {
	const prompt = group.inputTokens + group.cacheReadTokens + group.cacheWriteTokens;
	return prompt > 0 ? (100 * group.cacheReadTokens) / prompt : null;
}
