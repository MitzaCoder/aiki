import { TEXT_PREVIEW_BYTES } from './artifacts.js';

export class ArtifactReadError extends Error {
	constructor(readonly status: number) {
		super(`The backend answered ${status}.`);
	}
}

export function artifactReadProblem(error: unknown): string {
	if (error instanceof TypeError) {
		return 'Could not reach the artifact. Check the backend connection and retry. The browser may have blocked the request or the connection was interrupted.';
	}
	return error instanceof Error ? error.message : String(error);
}

/** Small reports use an ordinary GET; larger/unknown files request a bounded preview.
 * Bound the read even when a proxy ignores Range. No text is shown from an interrupted body.
 */
export async function readArtifactText(
	url: string,
	size: number,
	signal: AbortSignal,
	fetcher: typeof fetch = fetch,
): Promise<{ content: string; truncated: boolean }> {
	const response = await fetcher(url, {
		...(size >= 0 && size <= TEXT_PREVIEW_BYTES ? {} : { headers: { Range: `bytes=0-${TEXT_PREVIEW_BYTES - 1}` } }),
		signal,
	});
	if (!response.ok) throw new ArtifactReadError(response.status);
	const total = Number(/\/(\d+)$/.exec(response.headers.get('content-range') ?? '')?.[1] ?? size);
	const reader = response.body?.getReader();
	if (!reader) return { content: '', truncated: false };
	const chunks: Uint8Array[] = [];
	let length = 0;
	try {
		while (length < TEXT_PREVIEW_BYTES) {
			const { done, value } = await reader.read();
			if (done) break;
			const chunk = value.subarray(0, TEXT_PREVIEW_BYTES - length);
			chunks.push(chunk);
			length += chunk.length;
		}
	} finally {
		await reader.cancel().catch(() => {});
	}
	const bytes = new Uint8Array(length);
	let offset = 0;
	for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
	return { content: new TextDecoder().decode(bytes), truncated: length < total || length >= TEXT_PREVIEW_BYTES };
}
