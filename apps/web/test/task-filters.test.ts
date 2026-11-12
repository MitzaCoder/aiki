import { expect, test } from 'bun:test';
import { createServer } from 'vite';

test('obsolete saved top-level choice is ignored; only linked focus renders a chip', async () => {
	const windowDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'window');
	Object.defineProperty(globalThis, 'window', {
		configurable: true,
		value: { localStorage: { getItem: (key: string) => key === 'aiki.task-filter.v1' ? 'top-level' : null } },
	});
	const vite = await createServer({ root: import.meta.dir + '/..', server: { middlewareMode: true }, logLevel: 'error' });
	try {
		const { taskFilter } = await vite.ssrLoadModule('/src/lib/tasks-view.svelte.ts');
		const { default: TaskFilters } = await vite.ssrLoadModule('/src/lib/components/TaskFilters.svelte');
		const { render } = await vite.ssrLoadModule('svelte/server');
		expect(taskFilter.current).toEqual({ focus: null });
		const empty = render(TaskFilters).body;
		expect(empty).not.toContain('<button');
		expect(empty).not.toContain('<div');
		expect(empty).not.toContain('<span');
		taskFilter.focusOn('T2');
		expect(taskFilter.current).toEqual({ focus: 'T2' });
		const focused = render(TaskFilters).body;
		expect(focused).toContain('Linked to');
		expect(focused).toContain('T2');
		expect(focused).toContain('Show every task again');
		expect(focused).not.toContain('Top-level only');
		taskFilter.clearFocus();
		expect(taskFilter.current).toEqual({ focus: null });
	} finally {
		await vite.close();
		if (windowDescriptor) Object.defineProperty(globalThis, 'window', windowDescriptor);
		else Reflect.deleteProperty(globalThis, 'window');
	}
}, 15000);
