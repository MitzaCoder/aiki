import { expect, test } from 'bun:test';
import { fileMessageText, splitFileMessage, fileSizeLabel, PROTOCOL_VERSION, LEGACY_HARNESS_FEATURES, type ChatFile } from '../src/index.ts';
import { ConversationSubmitRequestSchema } from '../src/conversation.ts';
import { Value } from 'typebox/value';
const file: ChatFile = { id: 'a'.repeat(32), name: 'notes.md', size: 16, mimeType: 'text/markdown', path: '/example/data/attachments/notes.md', url: `/attachments/project/1/${'a'.repeat(32)}` };
test('version 1 accepts legacy string and image submissions and additive file IDs', () => {
	const base = { type: 'conversation.submit', id: '1', projectId: 'project', requestId: 'send' };
	for (const content of ['hello', [{ type: 'image', mimeType: 'image/png', data: 'AAAA' }]]) {
		expect(Value.Check(ConversationSubmitRequestSchema, { ...base, content })).toBe(true);
		expect(Value.Check(ConversationSubmitRequestSchema, { ...base, content, fileIds: [file.id] })).toBe(true);
	}
	expect(PROTOCOL_VERSION).toBe(1);
	expect(LEGACY_HARNESS_FEATURES.includes('chat-files-v1' as never)).toBe(false);
	expect(Value.Check(ConversationSubmitRequestSchema, { ...base, content: '', fileIds: ['../../escape'] })).toBe(false);
	expect(Value.Check(ConversationSubmitRequestSchema, { ...base, content: '', fileIds: Array(9).fill(file.id) })).toBe(false);
});
test('old clients see ordinary readable text and new clients recover safe download metadata', () => {
	const text = 'Please review' + fileMessageText([file], ['File notes.md\n```\n# synthetic\n```']);
	expect(text).toContain(file.path); expect(text).toContain(file.mimeType); expect(text).toContain('notes.md');
	expect(splitFileMessage(text)).toEqual({ text: 'Please review', files: [file] });
	for (const url of ['https://evil.example.test/x', '//evil.example.test/x', '/attachments/../../etc/passwd', 'javascript:alert(1)']) {
		const unsafe = 'Read' + fileMessageText([{ ...file, url }]);
		expect(splitFileMessage(unsafe)).toEqual({ text: unsafe, files: [] });
	}
	for (const raw of ['ordinary text', '\n[aiki-files-v2]\nunknown', '\n[aiki-files-v1]\nnot json\n[/aiki-files-v1]']) expect(splitFileMessage(raw)).toEqual({ text: raw, files: [] });
	expect(fileSizeLabel(1024)).toBe('1.0 KB'); expect(fileSizeLabel(1024 * 1024)).toBe('1.0 MB');
});
