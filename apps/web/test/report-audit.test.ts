import { describe, expect, test } from 'bun:test';
import type { ModelInfo, ProviderInfo, ReportAuditStatus } from '@kemiri/protocol';
import { parseReportAuditBudget, reportAuditStatusLines, reportAuditSupported } from '../src/lib/report-audit.js';
const now = Date.parse('2026-01-01T12:00:00Z');
const status: ReportAuditStatus = { effectiveModel: null, day: '2026-01-01', tokensUsed: 1240, lastRunAt: '2026-01-01T10:00:00Z', state: 'unavailable', reason: 'no signed-in provider offers a small model' };
const lines = (change: Partial<ReportAuditStatus> = {}) => reportAuditStatusLines({ ...status, ...change }, 65000, [], [], now);
describe('report check settings', () => {
	test('requires an explicitly advertised feature', () => {
		expect(reportAuditSupported(undefined)).toBe(false);
		expect(reportAuditSupported([])).toBe(false);
		expect(reportAuditSupported(['task-freshness'])).toBe(false);
		expect(reportAuditSupported(['report-audit'])).toBe(true);
	});
	test('accepts only whole token budgets in the protocol range', () => {
		for (const text of ['0', '65000', '10000000', ' 42 ']) expect(parseReportAuditBudget(text)).toBe(Number(text));
		for (const text of ['', '1.5', '-1', '10000001', 'Infinity', '1e3', '65,000', 'no']) expect(parseReportAuditBudget(text)).toBeUndefined();
	});
	test('formats usage, local age and unavailable reason without guessing a model', () => {
		expect(lines()).toEqual(['1,240 of 65,000 tokens today', 'Last run 2 h ago · No signed-in provider offers a small model']);
		expect(lines({ state: 'off', reason: null, lastRunAt: null })).toEqual(['1,240 of 65,000 tokens today', 'No checks run yet · Off']);
		expect(reportAuditStatusLines(undefined, 65000, [], [], now)).toEqual(['Reading report check status…']);
	});
	test('uses server-selected model and provider display names with safe fallbacks', () => {
		const effectiveModel = { provider: 'anthropic', modelId: 'claude-haiku-5-5' };
		const named = reportAuditStatusLines({ ...status, effectiveModel, state: 'checked', reason: null }, 65000, [{ ...effectiveModel, name: 'Claude Haiku 5.5' } as ModelInfo], [{ id: 'anthropic', name: 'Anthropic' } as ProviderInfo], now);
		expect(named[0]).toBe('Using Claude Haiku 5.5 via Anthropic · 1,240 of 65,000 tokens today');
		expect(named.at(-1)).toBe('Last run 2 h ago · Reports checked');
		expect(lines({ effectiveModel })[0]).toBe('Using claude-haiku-5-5 via anthropic · 1,240 of 65,000 tokens today');
	});
	test('keeps budget/error/idle reasons and ticks age without writes', () => {
		for (const state of ['budget', 'error', 'idle']) expect(lines({ state, reason: 'new evidence required' }).at(-1)).toContain('New evidence required');
		expect(reportAuditStatusLines(status, 65000, [], [], now + 3_600_000)[1]).toBe('Last run 3 h ago · No signed-in provider offers a small model');
		expect(lines({ state: 'running', reason: null }).at(-1)).toBe('Last run 2 h ago · Checking reports…');
	});
});
