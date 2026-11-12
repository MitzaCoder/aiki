import { expect, test } from 'bun:test';
import { parseReportNotice } from '../src/lib/report-notice';
import { buildTranscript, isTypedInput } from '../src/lib/transcript';

const raw = '[reports] T132 Next stale: audit: Q140 pending; awaiting human review; T7 Results/Next stale: new activity. Read tasks; rewrite stale sections with evidence.';
test('report nudges split task sections, not semicolons inside reasons', () => {
	expect(parseReportNotice(raw)).toEqual({ raw, sections: [
		{ taskId: 'T132', section: 'Next', reason: 'audit: Q140 pending; awaiting human review' },
		{ taskId: 'T7', section: 'Results', reason: 'new activity' },
		{ taskId: 'T7', section: 'Next', reason: 'new activity' },
	] });
});
test('prefix boundaries, future bodies and duplicates preserve raw text', () => {
	for (const text of ['[reports]please', 'please [reports] T1 Next stale: old', 'ordinary text']) {
		expect(parseReportNotice(text)).toBeUndefined(); expect(isTypedInput(text)).toBe(true);
	}
	for (const text of ['[reports]', '  [reports]\nFuture shape']) {
		expect(parseReportNotice(text)).toEqual({ raw: text, sections: [] }); expect(isTypedInput(text)).toBe(false);
	}
	expect(parseReportNotice('[reports] T1 Next/Next stale: old')?.sections).toHaveLength(1);
});
test('stored text and text-block history use the widget, mixed image messages stay user inputs', () => {
	for (const content of [raw, [{ type: 'text', text: raw }]]) {
		const entries = [{ id: 1, kind: 'pi.user', model: [{ role: 'user', content, timestamp: 123 }] }];
		const rows = buildTranscript(entries as any, null);
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({ kind: 'reports', key: 'entry-1', timestamp: 123, notice: { raw } });
	}
	const entries = [{ id: 1, kind: 'pi.user', model: [{ role: 'user', content: [{ type: 'text', text: raw }, { type: 'image', data: 'abc', mimeType: 'image/png' }] }] }];
	expect(buildTranscript(entries as any, null)[0]?.kind).toBe('user');
});
