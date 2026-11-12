/** The harness uses plain user inputs for injected notices; no structured marker is stored. */
export type ReportNoticeSection = { taskId: string; section: 'Results' | 'Next'; reason: string };
export type ReportNotice = { raw: string; sections: ReportNoticeSection[] };

/** Parse on read so persisted history needs no migration. Unknown bodies still disclose the complete original. */
export function parseReportNotice(text: string): ReportNotice | undefined {
	const prefix = /^\s*\[reports\](?:\s|$)/.exec(text);
	if (!prefix) return undefined;
	const body = text.slice(prefix[0].length).replace(/\. Read tasks; rewrite stale sections with evidence\.\s*$/, '').trim();
	const sections: ReportNoticeSection[] = [];
	const entries = body.split(/;\s*(?=T\d+ (?:Results|Next)(?:\/(?:Results|Next))* stale:)/);
	for (const entry of entries) {
		const match = /^(T\d+) ((?:Results|Next)(?:\/(?:Results|Next))*) stale:\s*([\s\S]*)$/.exec(entry);
		if (!match) continue;
		for (const section of match[2]!.split('/') as ('Results' | 'Next')[]) {
			if (!sections.some(existing => existing.taskId === match[1] && existing.section === section)) {
				sections.push({ taskId: match[1]!, section, reason: match[3]!.trim() });
			}
		}
	}
	return { raw: text, sections };
}
