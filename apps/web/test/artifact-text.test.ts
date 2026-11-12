import { expect, test } from 'bun:test';
import { ArtifactReadError, artifactReadProblem, readArtifactText } from '../src/lib/artifact-text.ts';
import { TEXT_PREVIEW_BYTES } from '../src/lib/artifacts.ts';

const signal = () => new AbortController().signal;
function fetchResponse(response: Response, inspect?: (init?: RequestInit) => void): typeof fetch {
	return (async (_url: unknown, init?: RequestInit) => { inspect?.(init); return response; }) as typeof fetch;
}

test('small Markdown and empty files avoid Range; UTF-8 bytes decode intact', async () => {
	const content = '# Report\nCafé ✓';
	const result = await readArtifactText('https://backend.example/artifacts/p/a', new TextEncoder().encode(content).length, signal(), fetchResponse(new Response(content), init => {
		expect(init?.headers).toBeUndefined();
	}));
	expect(result).toEqual({ content, truncated: false });
	expect(await readArtifactText('https://backend.example/a', 0, signal(), fetchResponse(new Response('')))).toEqual({ content: '', truncated: false });
});

test('large previews request a single range and bound even a server that ignores it', async () => {
	let cancelled = false;
	const response = new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(TEXT_PREVIEW_BYTES + 100).fill(65)); }, cancel() { cancelled = true; } }));
	const result = await readArtifactText('https://backend.example/a', TEXT_PREVIEW_BYTES + 100, signal(), fetchResponse(response, init => {
		expect(init?.headers).toEqual({ Range: `bytes=0-${TEXT_PREVIEW_BYTES - 1}` });
	}));
	expect(result.content.length).toBe(TEXT_PREVIEW_BYTES);
	expect(result.truncated).toBe(true);
	expect(cancelled).toBe(true);
});

test('HTTP errors retain status for token renewal; transport errors explain retry', async () => {
	try { await readArtifactText('https://backend.example/a', 2, signal(), fetchResponse(new Response('', { status: 403 }))); throw new Error('expected rejection'); }
	catch (error) { expect(error).toBeInstanceOf(ArtifactReadError); expect((error as ArtifactReadError).status).toBe(403); }
	expect(artifactReadProblem(new TypeError('Failed to fetch'))).toContain('Check the backend connection and retry');
	expect(artifactReadProblem(new ArtifactReadError(500))).toBe('The backend answered 500.');
});

test('an interrupted response body rejects instead of showing partial text', async () => {
	const response = new Response(new ReadableStream({ start(controller) { controller.error(new TypeError('terminated')); } }));
	await expect(readArtifactText('https://backend.example/a', 2, signal(), fetchResponse(response))).rejects.toThrow('terminated');
});
