import { describe, expect, it } from 'bun:test';
import type { UsageGroup } from '@aiki/protocol';
import {
	promptReuse,
	usageCostShare,
	usageTabAfterKey,
	usageTabKey,
	usageTokenTotal,
	USAGE_TABS
} from '../src/lib/usage-analysis.ts';
const group: UsageGroup = {
	key: 'worker',
	label: 'Workers',
	requests: 1,
	cost: 2,
	inputTokens: 10,
	cacheReadTokens: 60,
	cacheWriteTokens: 30,
	outputTokens: 20,
	maxPromptTokens: 100
};
describe('usage analysis presentation', () => {
	it('counts every token category without counting catalog cost as quota', () => {
		expect(usageTokenTotal(group)).toBe(120);
		expect(usageCostShare(group, 8)).toBe(25);
	});
	it('handles free models and empty totals', () => {
		expect(usageCostShare(group, 0)).toBe(0);
		expect(promptReuse({ ...group, inputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 })).toBeNull();
	});
	it('measures reuse over prompt tokens, not output', () => {
		expect(promptReuse(group)).toBe(60);
	});
	it('wraps keyboard tab navigation and supports Home and End', () => {
		expect(usageTabAfterKey('Overview', 'ArrowLeft')).toBe('Waste');
		expect(usageTabAfterKey('Waste', 'ArrowRight')).toBe('Overview');
		expect(usageTabAfterKey('By role', 'End')).toBe('Waste');
		expect(usageTabAfterKey('By model', 'Home')).toBe('Overview');
	});
	it('does not intercept unrelated keys and gives tabs stable accessible IDs', () => {
		expect(usageTabAfterKey('Overview', 'Enter')).toBeUndefined();
		expect(new Set(USAGE_TABS.map(usageTabKey)).size).toBe(5);
		expect(usageTabKey('Projects & tasks')).toBe('projects-tasks');
	});
});
