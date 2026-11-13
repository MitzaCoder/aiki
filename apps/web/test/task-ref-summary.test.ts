import { expect, test } from 'bun:test';
import type { RefStatus } from '@kemiri/protocol';
import { taskRefSummary } from '../src/lib/task-ref-summary.ts';
import { taskSheetViewport } from '../src/lib/task-sheet-viewport.ts';
const base = { ref: '#1', url: 'https://example.com/ref', title: 'Synthetic ref', checkedAt: '2026-01-01T00:00:00Z' };
const pull = (state: 'open' | 'draft' | 'merged' | 'closed', checks: 'failing' | 'passing' | 'pending' | null): RefStatus => ({ ...base, kind: 'pull', state, checks });

test('ref summary counts kinds and prioritizes actionable PR checks', () => {
	expect(taskRefSummary([pull('open', 'failing'), pull('draft', 'pending'), { ...base, kind: 'issue', state: 'closed' }, undefined])).toEqual({ counts: '2 PRs · 1 issue · 1 unknown', status: '1 PR failing checks · 1 PR running checks', attention: true });
});
test('merged/closed checks are historical, not attention', () => {
	expect(taskRefSummary([pull('merged', 'failing'), pull('closed', 'pending')])).toEqual({ counts: '2 PRs', status: '2 closed', attention: false });
});
test('unknown statuses are explicit and never counted as closed', () => {
	expect(taskRefSummary([undefined, undefined])).toEqual({ counts: '2 refs', status: '2 status unknown', attention: false });
	expect(taskRefSummary([pull('open', 'passing'), undefined]).status).toBe('1 open · 1 status unknown');
});
test('Jira category, not free-form name, determines closed count', () => {
	expect(taskRefSummary([{ ...base, kind: 'jira', category: 'done', status: 'Verified' }, { ...base, kind: 'jira', category: 'in_progress', status: 'Review' }])).toEqual({ counts: '2 tickets', status: '1 open · 1 closed', attention: false });
});
test('visual viewport tracks keyboard height and removes listeners on close', () => {
	const previous = Object.getOwnPropertyDescriptor(globalThis, 'window');
	const listeners = new Map<string, () => void>();
	const viewport = { height: 740, offsetTop: 0, scale: 1, addEventListener: (event: string, listener: () => void) => listeners.set(event, listener), removeEventListener: (event: string) => listeners.delete(event) };
	Object.defineProperty(globalThis, 'window', { configurable: true, value: { visualViewport: viewport } });
	try {
		const element = { style: { height: '', top: '', setProperty: (_name: string, _value: string) => {} } };
		const action = taskSheetViewport(element as HTMLElement);
		expect(element.style.height).toBe('740px');
		viewport.height = 390; listeners.get('resize')!();
		expect(element.style.height).toBe('390px');
		viewport.offsetTop = 20; listeners.get('scroll')!();
		expect(element.style.top).toBe('20px');
		viewport.scale = 2; viewport.height = 200; listeners.get('resize')!();
		expect(element.style.height).toBe('390px');
		action.destroy(); expect(listeners.size).toBe(0);
	} finally {
		if (previous) Object.defineProperty(globalThis, 'window', previous); else Reflect.deleteProperty(globalThis, 'window');
	}
});
