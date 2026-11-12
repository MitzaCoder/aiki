/** Additive chat-files-v1 HTTP upload and transcript text envelope. */
export const INPUT_FILE_MAX_BYTES = 50 * 1024 * 1024;
export const INPUT_MAX_FILES = 8;
export const INPUT_TEXT_FILE_MAX_BYTES = 100 * 1024;

export interface ChatFile {
	id: string;
	name: string;
	size: number;
	mimeType: string;
	/** Backend-relative, authenticated download endpoint. Never an external URL. */
	url: string;
	/** Absolute backend path, also usable by workers. */
	path: string;
}

const START = '\n[aiki-files-v1]\n';
const END = '\n[/aiki-files-v1]';
export function fileMessageText(files: readonly ChatFile[], inline: readonly string[] = []): string {
	return START + files.map(file => JSON.stringify(file)).join('\n') + '\n' + inline.join('\n\n') + END;
}

/** Unknown/malformed envelopes stay ordinary text for compatibility. Never trust a transcript URL. */
export function splitFileMessage(text: string): { text: string; files: ChatFile[] } {
	const start = text.lastIndexOf(START);
	if (start < 0 || !text.endsWith(END)) return { text, files: [] };
	const body = text.slice(start + START.length, -END.length);
	const files: ChatFile[] = [];
	for (const line of body.split('\n')) {
		if (!line.startsWith('{')) break;
		try {
			const file = JSON.parse(line) as ChatFile;
			if (!file || !/^[a-f0-9]{32}$/.test(file.id) || typeof file.name !== 'string' || typeof file.mimeType !== 'string' || typeof file.path !== 'string' || !Number.isSafeInteger(file.size) || file.size < 0 || file.size > INPUT_FILE_MAX_BYTES || !/^\/attachments\/[a-z0-9][a-z0-9._-]*\/[1-9][0-9]*\/[a-f0-9]{32}$/.test(file.url)) return { text, files: [] };
			files.push(file);
		} catch { return { text, files: [] }; }
	}
	return files.length > 0 && files.length <= INPUT_MAX_FILES ? { text: text.slice(0, start), files } : { text, files: [] };
}

export function fileSizeLabel(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
