import { searchWords } from './search-fuzzy.js';

/** Mutable postings index. Only changed/removed documents are tokenized on board updates. */
export class SearchBM25 {
	readonly documents = new Map<string, { text: string; length: number; terms: Map<string, number> }>();
	readonly postings = new Map<string, Map<string, number>>();
	#length = 0;
	#vocabulary: string[] = [];
	#dirty = false;

	set(id: string, text: string): void {
		if (this.documents.get(id)?.text === text) return;
		this.delete(id);
		const words = searchWords(text);
		const terms = new Map<string, number>();
		for (const word of words) terms.set(word, (terms.get(word) ?? 0) + 1);
		this.documents.set(id, { text, length: words.length, terms });
		this.#length += words.length;
		for (const [term, count] of terms) {
			let posting = this.postings.get(term);
			if (!posting) { posting = new Map(); this.postings.set(term, posting); this.#dirty = true; }
			posting.set(id, count);
		}
	}

	delete(id: string): void {
		const document = this.documents.get(id);
		if (!document) return;
		this.#length -= document.length;
		for (const term of document.terms.keys()) {
			const posting = this.postings.get(term)!;
			posting.delete(id);
			if (!posting.size) { this.postings.delete(term); this.#dirty = true; }
		}
		this.documents.delete(id);
	}

	/** AND across words; last word expands to a vocabulary prefix unless terminated by whitespace. */
	search(query: string): Map<string, number> {
		if (this.#dirty) { this.#vocabulary = [...this.postings.keys()].sort(); this.#dirty = false; }
		const words = searchWords(query);
		let scores: Map<string, number> | undefined;
		for (const [index, word] of words.entries()) {
			let terms = [word];
			if (index === words.length - 1 && !/\s$/.test(query)) {
				let low = 0, high = this.#vocabulary.length;
				while (low < high) { const mid = (low + high) >>> 1; if (this.#vocabulary[mid]! < word) low = mid + 1; else high = mid; }
				terms = [];
				for (let at = low; at < this.#vocabulary.length && this.#vocabulary[at]!.startsWith(word); at++) terms.push(this.#vocabulary[at]!);
			}
			const matches = new Map<string, number>();
			for (const term of terms) {
				const posting = this.postings.get(term);
				if (!posting) continue;
				const idf = Math.log(1 + (this.documents.size - posting.size + 0.5) / (posting.size + 0.5));
				for (const [id, frequency] of posting) {
					if (scores && !scores.has(id)) continue;
					const length = this.documents.get(id)!.length;
					const score = idf * frequency * 2.2 / (frequency + 1.2 * (0.25 + 0.75 * length / (this.#length / this.documents.size || 1)));
					// Prefix alternatives are one query term, not a reward for having many completions.
					matches.set(id, Math.max(matches.get(id) ?? 0, score));
				}
			}
			for (const [id, score] of matches) matches.set(id, score + (scores?.get(id) ?? 0));
			scores = matches;
		}
		return scores ?? new Map();
	}
}
