/** Small valid PDFs built from synthetic strings for unit and standalone-executable smoke tests. */
export function syntheticPdf(pages: readonly string[], imageOnly = false): Uint8Array {
	const objects = [
		'<< /Type /Catalog /Pages 2 0 R >>',
		`<< /Type /Pages /Kids [${pages.map((_, index) => `${4 + index * 2} 0 R`).join(' ')}] /Count ${pages.length} >>`,
		'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
	];
	for (const [index, text] of pages.entries()) {
		const escapedLines = (text.match(/.{1,60}/g) ?? []).map(line => `(${line.replaceAll('\\', '\\\\').replaceAll('(', '\\(').replaceAll(')', '\\)')}) Tj 0 -14 Td`).join(' ');
		const stream = imageOnly ? 'q 1 0 0 1 0 0 cm BI /W 1 /H 1 /CS /RGB /BPC 8 ID \0\0\0 EI Q' : text ? `BT /F1 12 Tf 50 740 Td ${escapedLines} ET` : '';
		objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + index * 2} 0 R >>`);
		objects.push(`<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream`);
	}
	let pdf = '%PDF-1.4\n';
	const offsets = [0];
	for (const [index, object] of objects.entries()) { offsets.push(Buffer.byteLength(pdf, 'latin1')); pdf += `${index + 1} 0 obj\n${object}\nendobj\n`; }
	const xref = Buffer.byteLength(pdf, 'latin1');
	pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Root 1 0 R /Size ${objects.length + 1} >>\nstartxref\n${xref}\n%%EOF\n`;
	return new Uint8Array(Buffer.from(pdf, 'latin1'));
}
