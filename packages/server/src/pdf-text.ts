/** Text-only PDF fallback. unpdf's serverless PDF.js bundle needs no canvas, native module or external worker file. */
import { INPUT_TEXT_FILE_MAX_BYTES } from '@kemiri/protocol';

export interface PdfText {
	text: string;
	pageCount: number;
	truncated: boolean;
}

/** Keep page work and output bounded, including scanned/blank documents with no text budget to consume. */
export const PDF_TEXT_MAX_PAGES = 200;

export function truncateUtf8(text: string, budget: number): { text: string; bytes: number; truncated: boolean } {
	const encoded = new TextEncoder().encode(text);
	if (encoded.length <= budget) return { text, bytes: encoded.length, truncated: false };
	const decoded = new TextDecoder().decode(encoded.subarray(0, Math.max(0, budget)), { stream: true });
	return { text: decoded, bytes: new TextEncoder().encode(decoded).length, truncated: true };
}

export async function extractPdfText(bytes: Uint8Array): Promise<PdfText | undefined> {
	// Literal dynamic import stays embedded by Bun --compile but avoids loading PDF.js for non-PDF messages.
	const { getDocumentProxy } = await import('unpdf');
	let document: Awaited<ReturnType<typeof getDocumentProxy>> | undefined;
	try {
		document = await getDocumentProxy(new Uint8Array(bytes), {
			useWasm: false, disableFontFace: true,
			isOffscreenCanvasSupported: false,
			maxImageSize: 0, verbosity: 0,
		});
		const pageCount = document.numPages;
		let remaining = INPUT_TEXT_FILE_MAX_BYTES;
		const pages: string[] = [];
		let truncated = pageCount > PDF_TEXT_MAX_PAGES;
		for (let pageNumber = 1; pageNumber <= Math.min(pageCount, PDF_TEXT_MAX_PAGES); pageNumber++) {
			const page = await document.getPage(pageNumber);
			try {
				const content = await page.getTextContent();
				const raw = content.items.map(item => 'str' in item ? item.str + (item.hasEOL ? '\n' : ' ') : '').join('').trim();
				const limited = truncateUtf8((pages.length > 0 && raw ? '\n\n' : '') + raw, remaining);
				if (limited.text) pages.push(limited.text);
				remaining -= limited.bytes;
				if (limited.truncated || remaining === 0) { truncated = limited.truncated || pageNumber < pageCount; break; }
			} finally { page.cleanup(); }
		}
		return { text: pages.join('').trim(), pageCount, truncated };
	} catch {
		// Encrypted, malformed or unsupported PDFs still keep their original attachment and tool path.
		return undefined;
	} finally { await document?.loadingTask.destroy().catch(() => {}); }
}
