import { SearchBM25 } from './search-bm25.js';
import { fuzzyPrepared, prepareFuzzy, searchFold, searchSnippet, searchWords, type FuzzyField, type SearchRange } from './search-fuzzy.js';

export type TaskSearchDocument = { id: string; title: string; refs: readonly string[]; body: string; parent?: string | null };
export type TaskSearchHit = { id: string; score: number; ranges: SearchRange[]; snippet: string; context: boolean };

function exactKeys(document: TaskSearchDocument): Set<string> {
	const keys = new Set([searchFold(document.id), searchFold(document.id.replace(/^t/i, ''))]);
	for (const ref of document.refs) {
		for (const match of ref.matchAll(/(?:\/pull\/|\/pulls\/|#)(\d+)\b/gi)) keys.add(`#${match[1]}`);
		for (const match of ref.matchAll(/\b[a-z][a-z0-9]*-\d+\b/gi)) keys.add(searchFold(match[0]));
	}
	return keys;
}

/** Same algorithm/constants as Android TaskSearchIndex. Own scorer avoids dissimilar library ports. */
export class TaskSearchIndex {
	readonly body = new SearchBM25();
	#hasParents = false;
	readonly documents = new Map<string, TaskSearchDocument>();
	readonly #keys = new Map<string, Set<string>>();
	readonly #shortFields = new Map<string, FuzzyField[]>();
	readonly #snippets = new Map<string, { text: string; folded: string }>();

	update(documents: readonly TaskSearchDocument[]): void {
		this.#hasParents = documents.some(document => !!document.parent);
		const ids = new Set(documents.map((document) => document.id));
		for (const id of this.documents.keys()) if (!ids.has(id)) {
			this.documents.delete(id); this.body.delete(id); this.#keys.delete(id); this.#shortFields.delete(id); this.#snippets.delete(id);
		}
		for (const document of documents) {
			const old = this.documents.get(document.id);
			if (!old || old.title !== document.title || old.refs.join('\n') !== document.refs.join('\n')) {
				this.#keys.set(document.id, exactKeys(document));
				this.#shortFields.set(document.id, [document.title, ...document.refs].map(prepareFuzzy));
			}
			if (old?.body !== document.body) { const text = document.body.replace(/\s+/g, ' ').trim(); this.#snippets.set(document.id, { text, folded: searchFold(text) }); }
			this.documents.set(document.id, document);
			this.body.set(document.id, document.body);
		}
	}

	search(query: string, eligible?: ReadonlySet<string>): TaskSearchHit[] {
		const trimmed = searchFold(query.trim());
		if (!trimmed) return [];
		const body = this.body.search(query);
		const needle = searchFold(query).replace(/\s/g, '');
		const words = searchWords(query);
		const hits: TaskSearchHit[] = [];
		for (const [id, document] of this.documents) {
			if (eligible && !eligible.has(id)) continue;
			const fields = this.#shortFields.get(id)!;
			const title = fuzzyPrepared(fields[0]!, needle);
			let fuzzy = title?.score ?? 0;
			for (let at = 1; at < fields.length; at++) fuzzy = Math.max(fuzzy, (fuzzyPrepared(fields[at]!, needle, false)?.score ?? 0) * 0.7);
			const bm25 = body.get(id) ?? 0;
			const exact = this.#keys.get(id)!.has(trimmed);
			if (!exact && !fuzzy && !bm25) continue;
			const score = exact ? 4 : fuzzy ? 2 + fuzzy / (fuzzy + 40) : 1 + bm25 / (bm25 + 4);
			hits.push({ id, score, ranges: title?.ranges ?? [], snippet: !exact && !fuzzy ? searchSnippet(this.#snippets.get(id)!.text, words, this.#snippets.get(id)!.folded) : '', context: false });
		}
		// Original board order breaks ties, identically on both clients (stable sort).
		hits.sort((left, right) => right.score - left.score);
		return this.#hasParents ? searchFamilyContext(hits, this.documents, eligible) : hits;
	}
}

/** Insert missing ancestors before their first matching descendant, without changing hit order. */
export function searchFamilyContext(hits: readonly TaskSearchHit[], documents: ReadonlyMap<string, TaskSearchDocument>, eligible?: ReadonlySet<string>): TaskSearchHit[] {
	const matches = new Map(hits.map((hit) => [hit.id, hit]));
	const emitted = new Set<string>();
	const output: TaskSearchHit[] = [];
	const visiting = new Set<string>();
	function emit(hit: TaskSearchHit): void {
		if (emitted.has(hit.id) || visiting.has(hit.id)) return;
		visiting.add(hit.id);
		const parent = documents.get(hit.id)?.parent;
		if (parent && documents.has(parent) && (!eligible || eligible.has(parent))) emit(matches.get(parent) ?? { id: parent, score: 0, ranges: [], snippet: '', context: true });
		visiting.delete(hit.id); emitted.add(hit.id); output.push(hit);
	}
	for (const hit of hits) emit(hit);
	return output;
}
