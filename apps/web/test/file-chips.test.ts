import { expect, test } from 'bun:test';
import { createServer } from 'vite';
import type { ChatFile } from '@kemiri/protocol';

test('file chip component renders name, size, type, accessible removal and download link', async () => {
	const previousStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
	const stored = new Map<string, string>();
	Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: (key: string) => stored.get(key) ?? null, setItem: (key: string, value: string) => stored.set(key, value), removeItem: (key: string) => stored.delete(key) } });
	const vite = await createServer({ root: import.meta.dir + '/..', server: { middlewareMode: true }, logLevel: 'error' });
	try {
		const { default: FileChips } = await vite.ssrLoadModule('/src/lib/components/chat/FileChips.svelte');
		const { render } = await vite.ssrLoadModule('svelte/server');
		const file: ChatFile = { id: 'a'.repeat(32), name: '<notes>.md', size: 1024, mimeType: 'text/markdown', path: '/example/notes.md', url: `/attachments/project/1/${'a'.repeat(32)}` };
		const draft = render(FileChips, { props: { files: [file], onremove() {} } }).body;
		expect(draft).toContain('&lt;notes>.md'); expect(draft).toContain('1.0 KB'); expect(draft).toContain('text/markdown'); expect(draft).toContain('Remove'); expect(draft).toContain('size-12');
		const sent = render(FileChips, { props: { files: [file] } }).body;
		expect(sent).toContain(`href="${file.url}"`); expect(sent).toContain('Download'); expect(sent).toContain('download=');
		const { default: TaskReply } = await vite.ssrLoadModule('/src/lib/components/TaskReply.svelte');
		const backend = { id: 'synthetic', ready: true, client: {}, supports: () => true };
		const reply = render(TaskReply, { props: { backend, projectId: 'project', taskId: 'T1' } }).body;
		expect(reply).toContain('aria-label="Attach files"'); expect(reply).not.toContain('accept="image/*"');
		const legacy = render(TaskReply, { props: { backend: { ...backend, supports: () => false }, projectId: 'project', taskId: 'T1' } }).body;
		expect(legacy).toContain('accept="image/*"');
	} finally {
		await vite.close();
		if (previousStorage) Object.defineProperty(globalThis, 'localStorage', previousStorage);
		else Reflect.deleteProperty(globalThis, 'localStorage');
	}
}, 20_000);
