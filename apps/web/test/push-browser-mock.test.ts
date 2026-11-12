import { expect, test } from 'bun:test';
import { installPushBrowser } from './push-browser-mock.ts';

test('push browser shim restores a throwing Svelte rune getter without reading it', () => {
	const previous = Object.getOwnPropertyDescriptor(globalThis, '$state');
	let reads = 0;
	const get = () => {
		reads++;
		throw new Error('rune_outside_svelte');
	};
	Object.defineProperty(globalThis, '$state', { configurable: true, get });
	try {
		const restoreBrowser = installPushBrowser(null);
		try {
			const state = Object.getOwnPropertyDescriptor(globalThis, '$state')!.value;
			const settings = { deviceId: 'synthetic-browser' };
			expect(state(settings)).toBe(settings);
		} finally {
			restoreBrowser();
		}
		expect(Object.getOwnPropertyDescriptor(globalThis, '$state')!.get).toBe(get);
		expect(reads).toBe(0);
	} finally {
		if (previous) Object.defineProperty(globalThis, '$state', previous);
		else Reflect.deleteProperty(globalThis, '$state');
	}
});
