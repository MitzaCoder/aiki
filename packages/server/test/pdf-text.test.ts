import { expect, test } from 'bun:test';
import { INPUT_TEXT_FILE_MAX_BYTES } from '@kemiri/protocol';
import { syntheticPdf } from '../scripts/pdf-fixture.ts';
import { extractPdfText, PDF_TEXT_MAX_PAGES, truncateUtf8 } from '../src/pdf-text.ts';

test('extracts actual PDF text and page count without a native renderer', async () => {
	expect(await extractPdfText(syntheticPdf(['First synthetic page.', 'Second synthetic page.']))).toEqual({ text: 'First synthetic page.\n\nSecond synthetic page.', pageCount: 2, truncated: false });
});
test('scanned image-only PDFs have no extracted text; malformed/encrypted inputs retain only their original path', async () => {
	expect((await extractPdfText(syntheticPdf([''], true)))?.text).toBe('');
	expect(await extractPdfText(new TextEncoder().encode('%PDF-1.4 invalid'))).toBeUndefined();
});
test('PDF extraction bounds UTF-8 text and pages, not just the uploaded file size', async () => {
	const extracted = await extractPdfText(syntheticPdf(Array(50).fill('A'.repeat(3000))));
	expect(new TextEncoder().encode(extracted?.text).length).toBeLessThanOrEqual(INPUT_TEXT_FILE_MAX_BYTES);
	expect(extracted?.text.length).toBeGreaterThan(INPUT_TEXT_FILE_MAX_BYTES - 10);
	expect(extracted?.truncated).toBe(true);
	const many = await extractPdfText(syntheticPdf([...Array(PDF_TEXT_MAX_PAGES).fill(''), 'Not processed']));
	expect(many?.pageCount).toBe(PDF_TEXT_MAX_PAGES + 1);
	expect(many?.text).toBe(''); expect(many?.truncated).toBe(true);
});
test('UTF-8 truncation never splits a multi-byte character', () => {
	expect(truncateUtf8('a😀b', 4)).toEqual({ text: 'a', bytes: 1, truncated: true });
	expect(truncateUtf8('a😀b', 5)).toEqual({ text: 'a😀', bytes: 5, truncated: true });
	expect(truncateUtf8('é', 9)).toEqual({ text: 'é', bytes: 2, truncated: false });
});
