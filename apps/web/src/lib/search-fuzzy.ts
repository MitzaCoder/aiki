/** UTF-16 offsets, also used by Kotlin/Compose. */
export type SearchRange = [number, number];
export type FuzzyMatch = { score: number; ranges: SearchRange[] };
export type FuzzyField = { text: string; folded: string; bonuses: Float64Array; positions: Map<string, number[]> };
export function searchFold(text: string): string {
	return text.replace(/[A-Z\u0080-\uffff]/g, letter => letter.toLowerCase()[0]!);
}
export function searchWords(text: string): string[] { return searchFold(text).match(/[\p{L}\p{N}]+/gu) ?? []; }
export function prepareFuzzy(text: string): FuzzyField {
	const folded = searchFold(text);
	const bonuses = new Float64Array(text.length);
	for (let at = 0; at < text.length; at++) {
		const boundary = at === 0 || !/[\p{L}\p{N}]/u.test(folded[at - 1]!) || /[a-z]/.test(text[at - 1]!) && /[A-Z]/.test(text[at]!);
		bonuses[at] = 10 + (boundary ? 8 : 0) + 2 / (at + 1);
	}
	const positions = new Map<string, number[]>();
	for (let at = 0; at < folded.length; at++) { const letter = folded[at]!; let indices = positions.get(letter); if (!indices) { indices = []; positions.set(letter, indices); } indices.push(at); }
	return { text, folded, bonuses, positions };
}
// Query execution is synchronous. Reuse scratch storage instead of allocating arrays per field/letter.
let previous = new Float64Array(128), scores = new Float64Array(128), parents = new Int32Array(2048);
export function fuzzyPrepared(field: FuzzyField, needle: string, highlights = true): FuzzyMatch | undefined {
	const { text, folded, bonuses } = field;
	if (!needle || needle.length > text.length) return undefined;
	let found = -1;
	for (let letter = 0; letter < needle.length; letter++) { found = folded.indexOf(needle[letter]!, found + 1); if (found < 0) return undefined; }
	if (previous.length < text.length) { previous = new Float64Array(text.length * 2); scores = new Float64Array(text.length * 2); }
	if (highlights && parents.length < text.length * needle.length) parents = new Int32Array(text.length * needle.length * 2);
	let priorPositions: readonly number[] = [];
	for (let letter = 0; letter < needle.length; letter++) {
		const positions = field.positions.get(needle[letter]!)!;
		let best = -Infinity, bestAt = -1, prior = 0;
		for (const at of positions) {
			while (prior < priorPositions.length && priorPositions[prior]! < at) { const position = priorPositions[prior++]!; if (previous[position]! > best) { best = previous[position]!; bestAt = position; } }
			scores[at] = -Infinity;
			if (letter === 0) scores[at] = bonuses[at]!;
			else if (bestAt >= 0) {
				const consecutive = at > 0 && folded[at - 1] === needle[letter - 1] ? previous[at - 1]! + 6 : -Infinity;
				if (highlights) parents[letter * text.length + at] = consecutive >= best ? at - 1 : bestAt;
				scores[at] = bonuses[at]! + Math.max(best, consecutive);
			}
		}
		priorPositions = positions;
		const swap = previous; previous = scores; scores = swap;
	}
	let end = -1;
	for (const at of priorPositions) if (previous[at]! > (end < 0 ? -Infinity : previous[end]!)) end = at;
	if (end < 0) return undefined;
	const score = previous[end]!;
	const ranges: SearchRange[] = [];
	if (highlights) {
		const positions = new Int32Array(needle.length);
		for (let letter = needle.length - 1; letter >= 0; letter--) { positions[letter] = end; if (letter) end = parents[letter * text.length + end]!; }
		for (const at of positions) { const last = ranges.at(-1); if (last?.[1] === at) last[1]++; else ranges.push([at, at + 1]); }
	}
	return { score, ranges };
}
export function fuzzyMatch(text: string, query: string): FuzzyMatch | undefined { return fuzzyPrepared(prepareFuzzy(text), searchFold(query).replace(/\s/g, '')); }
export function searchSnippet(body: string, words: readonly string[], folded = searchFold(body)): string {
	let first = body.length;
	for (const word of words) { const at = folded.indexOf(word); if (at >= 0) first = Math.min(first, at); }
	const start = Math.max(0, first - 36);
	return `${start ? '…' : ''}${body.slice(start, start + 150).replace(/\s+/g, ' ')}${start + 150 < body.length ? '…' : ''}`;
}
