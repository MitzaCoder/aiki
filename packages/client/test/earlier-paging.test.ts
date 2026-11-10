import { expect, test } from 'bun:test';
import { ConversationWatch, type WatchHost } from '../src/watch.ts';
import type { ConversationPageResponse } from '@aiki/protocol';

test('older pages are single-flight and their error survives independently of the live watch until retry', async () => {
	let requests = 0;
	let reject!: (error: Error) => void;
	const host: WatchHost = {
		projectId: 'p', state: () => ({ status: 'ready', attempt: 0 }), subscribe: () => () => {},
		startWatch: async () => ({ type: 'conversation.watch', id: 'attach', watchId: 'w', conversationId: 1, view: {
			conversation: { id: 1 }, entries: [{ id: 10, conversationId: 1, kind: 'pi.user' }], before: 9, docs: {},
		} }),
		pageEarlier: async () => { requests++; return new Promise<ConversationPageResponse>((_, fail) => { reject = fail; }); },
		unwatch: () => {}, remove: () => {},
	};
	const watch = new ConversationWatch(host);
	await Bun.sleep(0);
	const page = watch.loadEarlier();
	expect(await watch.loadEarlier()).toBe(false);
	expect(requests).toBe(1);
	reject(new Error('offline'));
	expect(await page).toBe(false);
	expect(watch.earlierError).toBe('offline');
	expect(watch.error).toBeUndefined();
	expect(watch.canLoadEarlier).toBe(true);
	host.pageEarlier = async () => ({ type: 'conversation.page', id: 'page', entries: [{ id: 1, conversationId: 1, kind: 'pi.user' }] });
	expect(await watch.loadEarlier()).toBe(true);
	expect(watch.earlierError).toBeUndefined();
	expect(watch.canLoadEarlier).toBe(false);
	expect(watch.entries.map(entry => entry.id)).toEqual([1, 10]);
	watch.stop();
});
