import { describe, expect, test } from 'bun:test';
import { loadEarlierPage, shouldPrefetchEarlier } from '../src/lib/chat/earlier-paging.ts';

describe('earlier transcript paging', () => {
	test('prefetches within 1.5 viewport heights, including short content, but not at the distant tail', () => {
		expect(shouldPrefetchEarlier(1200, 800, true, false, false)).toBe(true);
		expect(shouldPrefetchEarlier(1201, 800, true, false, false)).toBe(false);
		expect(shouldPrefetchEarlier(0, 800, true, false, false)).toBe(true);
		expect(shouldPrefetchEarlier(-20, 800, true, false, false)).toBe(true);
	});
	test('stops for exhausted history, an in-flight page, a failure or an unmeasured viewport', () => {
		expect(shouldPrefetchEarlier(0, 800, false, false, false)).toBe(false);
		expect(shouldPrefetchEarlier(0, 800, true, true, false)).toBe(false);
		expect(shouldPrefetchEarlier(0, 800, true, false, true)).toBe(false);
		expect(shouldPrefetchEarlier(0, 0, true, false, false)).toBe(false);
	});
	test('guards repeated triggers synchronously, before loading props propagate', async () => {
		const state = { loading: false, failed: false };
		let finish!: () => void;
		let calls = 0;
		const load = () => { calls++; return new Promise<void>(resolve => { finish = resolve; }); };
		const first = loadEarlierPage(state, load);
		await loadEarlierPage(state, load);
		expect(calls).toBe(1);
		expect(state.loading).toBe(true);
		finish(); await first;
		expect(state.loading).toBe(false);
	});
	test('latches errors, allows explicit retry, then re-arms automatic paging', async () => {
		const state = { loading: false, failed: false };
		await loadEarlierPage(state, async () => { throw new Error('offline'); });
		expect(state).toEqual({ loading: false, failed: true });
		expect(shouldPrefetchEarlier(0, 800, true, state.loading, state.failed)).toBe(false);
		await loadEarlierPage(state, async () => {});
		expect(state).toEqual({ loading: false, failed: false });
		expect(shouldPrefetchEarlier(0, 800, true, state.loading, state.failed)).toBe(true);
	});
});
