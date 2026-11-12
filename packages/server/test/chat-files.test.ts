import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, readdir, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ChatFileStore, inlineFileText, pdfInputMode, safeAttachmentName } from '../src/chat-files.ts';
import { INPUT_FILE_MAX_BYTES, INPUT_TEXT_FILE_MAX_BYTES, splitFileMessage } from '@aiki/protocol';
import { createSetup, TestClient, ViewClient } from './support.ts';
import { httpEnroll } from './device-auth-test-support.ts';
import { fauxAssistantMessage } from '@earendil-works/pi-ai/providers/faux';
import { syntheticPdf } from '../scripts/pdf-fixture.ts';

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
async function store() { const root = await mkdtemp(join(tmpdir(), 'aiki-files-test-')); roots.push(root); return new ChatFileStore(root); }
function stream(bytes: string | Uint8Array) { return new Blob([bytes as BlobPart]).stream(); }

describe('private attachment storage', () => {
	test('safe names, duplicate names and metadata.json cannot overwrite; survives restart', async () => {
		const files = await store();
		for (const name of ['../../secret.md', '..\\..\\secret.md', '/etc/secret.md', '\0bad\n.md', 'metadata.json', '.', '']) {
			const file = await files.put('project', 1, name, 'text/plain', stream('hello'));
			expect(file.path.startsWith(files.directory('project', 1) + '/')).toBe(true);
			expect(await readFile(file.path, 'utf8')).toBe('hello');
			expect((await new ChatFileStore(files.dataDir).get('project', 1, file.id)).path).toBe(file.path);
		}
		const pair = await Promise.all([1, 2].map(n => files.put('project', 1, 'same.zip', 'application/zip', stream(String(n)))));
		expect(pair[0]!.path).not.toBe(pair[1]!.path);
		expect(await readFile(pair[0]!.path, 'utf8')).toBe('1');
		expect(safeAttachmentName('..\\nested\\note.md')).toBe('note.md');
	});
	test('caps declared and streamed bytes and removes partial uploads', async () => {
		const files = await store();
		await expect(files.put('project', 1, 'huge.zip', 'application/zip', stream('x'), INPUT_FILE_MAX_BYTES + 1)).rejects.toThrow('50 MB');
		let count = 0;
		const body = new ReadableStream<Uint8Array>({ pull(controller) { if (count++ < 51) controller.enqueue(new Uint8Array(1024 * 1024)); else controller.close(); } });
		await expect(files.put('project', 1, 'huge.zip', 'application/zip', body)).rejects.toThrow('50 MB');
		await expect(files.put('project', 1, 'partial', 'text/plain', stream('x'), 9)).rejects.toThrow('incomplete');
		expect(await readdir(files.directory('project', 1))).toEqual([]);
		let sent = 0;
		const exact = new ReadableStream<Uint8Array>({ pull(controller) { if (sent++ < 50) controller.enqueue(new Uint8Array(1024 * 1024)); else controller.close(); } });
		const saved = await files.put('project', 1, 'boundary.zip', 'application/zip', exact, INPUT_FILE_MAX_BYTES);
		expect(saved.size).toBe(INPUT_FILE_MAX_BYTES);
	});
	test('rejects invalid IDs, cross-conversation references and symlinks; cleans only deleted conversations', async () => {
		const files = await store();
		const file = await files.put('project', 1, 'notes.md', 'text/markdown', stream('notes'));
		await expect(files.get('project', 2, file.id)).rejects.toThrow('not found');
		await expect(files.get('project', 1, '../escape')).rejects.toThrow('Invalid');
		expect(() => files.directory('../escape', 1)).toThrow('Invalid');
		await files.removeDeletedConversations('project', async id => id === 1);
		expect((await files.get('project', 1, file.id)).id).toBe(file.id);
		await rm(file.path); await symlink('/etc/hosts', file.path);
		await expect(files.get('project', 1, file.id)).rejects.toThrow('not found');
		await files.removeDeletedConversations('project', async () => false);
		await expect(files.get('project', 1, file.id)).rejects.toThrow('not found');
	});
});

describe('inline files and PDF fallback', () => {
	test('MIME or extension plus valid UTF-8, bounded size and no binary controls', () => {
		const utf8 = (s: string) => new TextEncoder().encode(s);
		for (const name of ['notes.md', 'a.json', 'a.yaml', 'a.csv', 'a.ts', 'Dockerfile']) expect(inlineFileText(name, 'application/octet-stream', utf8('héllo'))).toContain('héllo');
		expect(inlineFileText('a.unknown', 'text/plain', utf8('hello'))).toContain('hello');
		expect(inlineFileText('a.zip', 'application/zip', utf8('hello'))).toBeUndefined();
		expect(inlineFileText('a.md', 'text/plain', utf8('hello\0binary'))).toBeUndefined();
		expect(inlineFileText('a.md', 'text/plain', new Uint8Array([0xff]))).toBeUndefined();
		expect(inlineFileText('a.md', 'text/plain', new Uint8Array(INPUT_TEXT_FILE_MAX_BYTES).fill(65))).toBeUndefined();
		expect(inlineFileText('a.md', 'text/plain', utf8('```\ncontent\n```'))).toContain('````');
	});
	test('existing image clients retain native image blocks and also get a saved tool path', async () => {
		const files = await store();
		const image = { type: 'image' as const, data: Buffer.from('synthetic image bytes').toString('base64'), mimeType: 'image/png' };
		const content = await files.message('project', 1, [{ type: 'text', text: 'Look' }, image]);
		expect(Array.isArray(content) && content[1]).toEqual(image);
		const suffix = (content as { type: string; text?: string }[]).at(-1)!.text!;
		const saved = splitFileMessage(suffix).files[0]!;
		expect(await readFile(saved.path, 'utf8')).toBe('synthetic image bytes');
	});
	test('Anthropic, OpenAI and Codex never mistake image support for native PDF input', () => {
		for (const provider of ['anthropic', 'openai', 'openai-codex', 'faux']) for (const input of [['text'], ['text', 'image'], ['text', 'document']]) expect(pdfInputMode({ provider, input })).toBe('text-fallback');
	});
	test('one path line per file, text inlined, PDF explains fallback, zip stays untouched', async () => {
		const files = await store();
		const uploaded = await Promise.all([['notes.md', 'text/markdown', '# notes'], ['paper.pdf', 'application/pdf', syntheticPdf(['Synthetic PDF text'])], ['bundle.zip', 'application/zip', 'zip bytes']].map(([name, type, text]) => files.put('project', 1, name as string, type as string, stream(text as string | Uint8Array))));
		const content = await files.message('project', 1, 'Review these', uploaded.map(f => f.id));
		expect(typeof content).toBe('string');
		const parsed = splitFileMessage(content as string);
		expect(parsed.text).toBe('Review these'); expect(parsed.files).toHaveLength(3);
		expect(content).toContain('# notes'); expect(content).toContain('text extracted; the original is at'); expect(content).toContain('Synthetic PDF text'); expect(content).toContain('(1 page)');
		for (const file of uploaded) expect(content).toContain(file.path);
		await expect(files.message('project', 1, '', Array(9).fill(uploaded[0]!.id))).rejects.toThrow('8 attachments');
	});
});

test('real HTTP upload/download and additive submit; old text/image clients remain valid', async () => {
	const s = await createSetup();
	try {
		const seen = Promise.withResolvers<string>();
		s.faux.setResponses([context => { seen.resolve(JSON.stringify(context)); return fauxAssistantMessage('Read the saved file.'); }]);
		const c = await TestClient.open(s.server); await c.hello();
		const p = await s.server.manager.store.add(s.projectDir);
		await c.request({ type: 'projects.configure', projectId: p.id, coordinatorModel: { provider: 'faux', modelId: 'faux-1' } });
		const upload = await fetch(`${s.server.url}/attachments/${p.id}?name=notes.md`, { method: 'POST', headers: { 'content-type': 'text/markdown' }, body: '# synthetic notes' });
		expect(upload.status).toBe(200); const file = await upload.json();
		const download = await fetch(s.server.url + file.url);
		expect(download.headers.get('content-disposition')).toContain('attachment'); expect(download.headers.get('x-content-type-options')).toBe('nosniff'); expect(await download.text()).toBe('# synthetic notes');
		const view = new ViewClient(c); await view.start(p.id);
		const answer = await c.request({ type: 'conversation.submit', projectId: p.id, requestId: 'with-file', content: 'Read this', fileIds: [file.id] });
		expect(answer.type).toBe('conversation.submit');
		const modelInput = await seen.promise;
		expect(modelInput).toContain(file.path); expect(modelInput).toContain('# synthetic notes');
		expect(modelInput).toContain('text/markdown'); expect(modelInput).toContain('untrusted user attachment');
		const { runtime } = await s.server.manager.open(p.id);
		const task = await runtime.board.saveTask({ task: { title: 'Review attachments', description: '', acceptance: null, status: 'in_progress', blockedBy: [], blockedReason: null, writeScopes: [] } }, 'harness');
		expect((await c.request({ type: 'conversation.submit', projectId: p.id, requestId: 'file-only-feedback', content: '', fileIds: [file.id], taskId: task.id })).type).toBe('conversation.submit');
		expect((await runtime.board.timeline(task.id)).feedback[0]?.text).toBe('Attached files: notes.md');
		const bad = await c.request({ type: 'conversation.submit', projectId: p.id, requestId: 'bad-file', content: 'Read this', fileIds: ['b'.repeat(32)] });
		expect(bad.type).toBe('error');
		await s.restart();
		expect(await (await fetch(s.server.url + file.url)).text()).toBe('# synthetic notes');
		c.close();
	} finally { await s.cleanup(); }
}, 20_000);

test('uploads and downloads require a current device bearer and reject untrusted origins', async () => {
	const s = await createSetup({ auth: { mode: 'required' }, allowedOrigins: ['https://app.example.test'] });
	try {
		const project = await s.server.manager.store.add(s.projectDir);
		const url = `${s.server.url}/attachments/${project.id}?name=notes.md`;
		expect((await fetch(url, { method: 'POST', body: 'hello' })).status).toBe(401);
		const credentials = await httpEnroll(s);
		const headers = { authorization: `Bearer ${credentials.accessToken}`, 'content-type': 'text/plain' };
		const response = await fetch(url, { method: 'POST', body: 'hello', headers });
		expect(response.status).toBe(200); const file = await response.json();
		expect((await fetch(s.server.url + file.url)).status).toBe(401);
		expect((await fetch(s.server.url + file.url, { headers: { ...headers, origin: 'https://evil.example.test' } })).status).toBe(403);
		expect(await (await fetch(s.server.url + file.url, { headers })).text()).toBe('hello');
		const preflight = await fetch(url, { method: 'OPTIONS', headers: { origin: 'https://app.example.test' } });
		expect(preflight.headers.get('access-control-allow-headers')).toContain('Authorization');
	} finally { await s.cleanup(); }
}, 20_000);
