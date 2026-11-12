import { expect, test } from 'bun:test';
import { fileMessageText, splitFileMessage, fileSizeLabel, type ChatFile } from '@aiki/protocol';
import { imageDrop } from '../src/lib/chat/image-drop.ts';
import { buildTranscript } from '../src/lib/transcript.ts';
import { waitingMessages, withWaiting } from '../src/lib/waiting.ts';

const file: ChatFile = { id: 'a'.repeat(32), name: 'notes.md', size: 1234, mimeType: 'text/markdown', url: `/attachments/project/1/${'a'.repeat(32)}`, path: '/example/backend/notes.md' };
test('file history works in string and multi-block image messages, old text unchanged', () => {
	const text = 'Review these' + fileMessageText([file]);
	for (const content of [text, [{ type: 'text', text }]]) {
		const rows = buildTranscript([{ id: 1, kind: 'pi.user', model: [{ role: 'user', content, timestamp: 1 }] }] as any, null);
		expect(rows[0]?.kind).toBe('user');
		expect(splitFileMessage((rows[0] as any).text).files).toEqual([file]);
	}
	expect(splitFileMessage('old client message')).toEqual({ text: 'old client message', files: [] });
	expect(fileSizeLabel(file.size)).toBe('1.2 KB');
});
test('queued and failed sends retain file chips without duplicating server metadata', () => {
	const sends = [{ requestId: 'files', text: 'Read these', files: [file], state: 'failed' as const, at: 1, wasBusy: true }];
	const failed = withWaiting([], waitingMessages({ queued: [], sends, lost: [] }));
	expect(splitFileMessage((failed[0] as any).text).files).toEqual([file]);
	const queued = withWaiting([], waitingMessages({ queued: [{ id: 1, requestId: 'files', text: 'Read these' + fileMessageText([file]), mode: 'steer' }], sends, lost: [] }));
	expect(splitFileMessage((queued[0] as any).text)).toEqual({ text: 'Read these', files: [file] });
});

test('drop/paste intake takes arbitrary files without taking ordinary pasted text', async () => {
	const node = new EventTarget();
	const added: File[][] = [];
	const images = { add: async () => { throw new Error('must use file intake'); } } as any;
	const action = imageDrop(node as HTMLElement, { images, onfiles: async files => { added.push(files); } });
	const files = [new File(['# notes'], 'notes.md', { type: 'text/markdown' }), new File(['%PDF'], 'paper.pdf', { type: 'application/pdf' }), new File(['zip'], 'bundle.zip', { type: 'application/zip' })];
	for (const name of ['drop', 'paste']) {
		const event = new Event(name, { cancelable: true });
		Object.defineProperty(event, name === 'paste' ? 'clipboardData' : 'dataTransfer', { value: { files, types: ['Files'] } });
		node.dispatchEvent(event); expect(event.defaultPrevented).toBe(true);
	}
	expect(added).toEqual([files, files]);
	const textPaste = new Event('paste', { cancelable: true });
	Object.defineProperty(textPaste, 'clipboardData', { value: { files: [], items: [], types: ['text/plain'], getData: () => 'typed text' } });
	node.dispatchEvent(textPaste); expect(textPaste.defaultPrevented).toBe(false);
	action.destroy();
});
