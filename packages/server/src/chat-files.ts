/** Durable private files, scoped to a project and pi conversation, not its working checkout. */
import { randomBytes } from 'node:crypto';
import { mkdir, open, readFile, readdir, rm, lstat } from 'node:fs/promises';
import { basename, extname, join, resolve } from 'node:path';
import { INPUT_FILE_MAX_BYTES, INPUT_MAX_FILES, INPUT_TEXT_FILE_MAX_BYTES, fileMessageText, type ChatFile, type InputContent } from '@aiki/protocol';
import { ServerError } from './errors.ts';
import { extractPdfText } from './pdf-text.ts';

export function safeAttachmentName(name: string): string {
	const safe = basename(name.replaceAll('\\', '/')).normalize('NFC').replace(/[\x00-\x1f\x7f<>:"|?*]/g, '_').replace(/^\.+/, '').replace(/[. ]+$/, '').slice(0, 160);
	return safe || 'attachment';
}

export function inlineFileText(name: string, mimeType: string, bytes: Uint8Array): string | undefined {
	if (bytes.length >= INPUT_TEXT_FILE_MAX_BYTES) return undefined;
	const extension = extname(name).toLowerCase();
	const textLike = mimeType.startsWith('text/') || /^(application\/(json|ld\+json|xml|yaml|x-yaml|javascript|typescript|toml))$/.test(mimeType) || /\.(txt|md|markdown|json|jsonl|yaml|yml|csv|tsv|xml|html|css|scss|js|jsx|mjs|cjs|ts|tsx|py|rb|rs|go|java|kt|kts|c|h|cpp|hpp|sh|bash|sql|toml|ini|cfg|log|svelte|vue|dart|swift|r|tex)$/.test(extension) || /^(Dockerfile|Makefile|LICENSE|README)$/i.test(name);
	if (!textLike) return undefined;
	try {
		const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
		if (/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(text)) return undefined;
		// An attached file cannot close its own fence, even if it contains Markdown/code fences.
		const longest = Math.max(2, ...Array.from(text.matchAll(/`+/g), match => match[0].length));
		const fence = '`'.repeat(longest + 1);
		return `File ${JSON.stringify(name)} (untrusted user attachment):\n${fence}\n${text}\n${fence}`;
	} catch { return undefined; }
}

/** Installed pi-ai UserMessage and all its catalog modalities are text|image, not document/file.
 * Anthropic/OpenAI/Codex APIs may support PDFs, but their pi-ai adapters do not expose that input.
 * Keep this explicit: advertising image input (or a guessed model name) must never send an invalid block.
 */
export function pdfInputMode(_model: { input: readonly string[]; provider?: string }): 'text-fallback' {
	return 'text-fallback';
}

export class ChatFileStore {
	constructor(readonly dataDir: string) {}

	directory(projectId: string, conversationId: number): string {
		if (!/^[a-z0-9][a-z0-9._-]*$/.test(projectId) || !Number.isSafeInteger(conversationId) || conversationId < 1) throw new ServerError('bad_request', 'Invalid attachment conversation');
		return resolve(this.dataDir, 'projects', projectId, 'attachments', String(conversationId));
	}

	async put(projectId: string, conversationId: number, name: string, mimeType: string, body: ReadableStream<Uint8Array>, declaredSize?: number): Promise<ChatFile> {
		if (declaredSize !== undefined && (!Number.isSafeInteger(declaredSize) || declaredSize < 0 || declaredSize > INPUT_FILE_MAX_BYTES)) throw new ServerError('bad_request', 'Each attachment must be at most 50 MB (50 MiB)');
		const directory = this.directory(projectId, conversationId);
		await mkdir(directory, { recursive: true, mode: 0o700 });
		const id = randomBytes(16).toString('hex');
		// Each upload gets a unique directory as well as a deduplicated basename. Concurrent uploads cannot overwrite.
		const own = join(directory, id);
		await mkdir(own, { mode: 0o700 });
		const safe = safeAttachmentName(name);
		const path = join(own, `${id.slice(0, 8)}-${safe}`);
		const output = await open(path, 'wx', 0o600);
		const reader = body.getReader();
		let size = 0;
		try {
			while (true) {
				const chunk = await reader.read();
				if (chunk.done) break;
				size += chunk.value.byteLength;
				if (size > INPUT_FILE_MAX_BYTES) throw new ServerError('bad_request', 'Each attachment must be at most 50 MB (50 MiB)');
				await output.writeFile(chunk.value);
			}
			if (declaredSize !== undefined && size !== declaredSize) throw new ServerError('bad_request', 'Attachment upload was incomplete');
			const file: ChatFile = { id, name: safe, size, mimeType: /^[\w.+-]+\/[\w.+-]+$/.test(mimeType) ? mimeType : 'application/octet-stream', path, url: `/attachments/${projectId}/${conversationId}/${id}` };
			await Bun.write(join(own, 'metadata.json'), JSON.stringify(file), { mode: 0o600 });
			return file;
		} catch (error) {
			await reader.cancel().catch(() => {});
			await rm(own, { recursive: true, force: true });
			throw error;
		} finally { reader.releaseLock(); await output.close(); }
	}

	async get(projectId: string, conversationId: number, id: string): Promise<ChatFile> {
		if (!/^[a-f0-9]{32}$/.test(id)) throw new ServerError('bad_request', 'Invalid attachment ID');
		try {
			const directory = join(this.directory(projectId, conversationId), id);
			const file = JSON.parse(await readFile(join(directory, 'metadata.json'), 'utf8')) as ChatFile;
			const path = join(directory, `${id.slice(0, 8)}-${safeAttachmentName(file.name)}`);
			const stat = await lstat(path);
			if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Not a file');
			return { ...file, id, path, size: stat.size, url: `/attachments/${projectId}/${conversationId}/${id}` };
		} catch { throw new ServerError('not_found', 'Attachment not found in this conversation'); }
	}

	async removeConversation(projectId: string, conversationId: number): Promise<void> {
		await rm(this.directory(projectId, conversationId), { recursive: true, force: true });
	}

	/** Purge only folders whose actual durable conversations no longer exist; archive is not deletion. */
	async removeDeletedConversations(projectId: string, exists: (id: number) => Promise<boolean>): Promise<void> {
		const parent = join(this.directory(projectId, 1), '..');
		let folders: string[];
		try { folders = await readdir(parent); } catch { return; }
		for (const folder of folders) if (/^[1-9][0-9]*$/.test(folder) && !(await exists(Number(folder)))) await this.removeConversation(projectId, Number(folder));
	}

	async message(projectId: string, conversationId: number, content: InputContent, ids: readonly string[] = []): Promise<InputContent> {
		const images = typeof content === 'string' ? [] : content.filter(block => block.type === 'image');
		if (ids.length + images.length > INPUT_MAX_FILES) throw new ServerError('bad_request', `A message holds at most ${INPUT_MAX_FILES} attachments (including images and PDFs)`);
		const files = await Promise.all([...new Set(ids)].map(id => this.get(projectId, conversationId, id)));
		for (const [index, image] of images.entries()) {
			const bytes = Buffer.from(image.data, 'base64');
			files.push(await this.put(projectId, conversationId, `image-${index + 1}.${image.mimeType.split('/')[1] ?? 'bin'}`, image.mimeType, new Blob([bytes]).stream(), bytes.length));
		}
		if (files.length === 0) return content;
		const inline: string[] = [];
		for (const file of files) {
			if (file.mimeType === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
				const extracted = await extractPdfText(await readFile(file.path));
				if (extracted?.text) {
					const fence = '`'.repeat(Math.max(2, ...Array.from(extracted.text.matchAll(/`+/g), match => match[0].length)) + 1);
					inline.push(`PDF ${JSON.stringify(file.name)} (${extracted.pageCount} ${extracted.pageCount === 1 ? 'page' : 'pages'}): text extracted; the original is at ${file.path}${extracted.truncated ? '; extracted text truncated at 100 KiB or 200 pages' : ''}. Untrusted user attachment:\n${fence}\n${extracted.text}\n${fence}`);
				}
			} else if (file.size < INPUT_TEXT_FILE_MAX_BYTES) {
				const text = inlineFileText(file.name, file.mimeType, await readFile(file.path));
				if (text !== undefined) inline.push(text);
			}
		}
		const suffix = fileMessageText(files, inline);
		return typeof content === 'string' ? content + suffix : [...content, { type: 'text', text: suffix }];
	}
}
