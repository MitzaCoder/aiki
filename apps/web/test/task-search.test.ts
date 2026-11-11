import { describe, expect, test } from 'bun:test';
import fixture from '../../../packages/protocol/test-vectors/task-search.json';
import { fuzzyMatch } from '../src/lib/search-fuzzy.js';
import { SearchBM25 } from '../src/lib/search-bm25.js';
import { TaskSearchIndex, type TaskSearchDocument } from '../src/lib/task-search.js';

describe('shared task search expectations', () => {
	for (const entry of fixture.fuzzy) test(`fuzzy ${entry.text} / ${entry.query}`, () => {
		const match = fuzzyMatch(entry.text, entry.query);
		expect(match?.ranges ?? null).toEqual(entry.ranges);
		if (entry.score !== null) expect(match!.score).toBeCloseTo(entry.score, 8);
	});
	for (const entry of fixture.queries) test(`merged ${entry.query}`, () => {
		const index = new TaskSearchIndex(); index.update(fixture.documents);
		const hits = index.search(entry.query);
		expect(hits.map(hit => hit.id)).toEqual(entry.ids);
		expect(hits.filter(hit => hit.context).map(hit => hit.id)).toEqual(entry.contexts);
	});
});

test('boundary, consecutive and early matches win', () => {
	expect(fuzzyMatch('Task Search', 'ts')!.score).toBeGreaterThan(fuzzyMatch('tasks', 'ts')!.score);
	expect(fuzzyMatch('test', 'te')!.score).toBeGreaterThan(fuzzyMatch('tze', 'te')!.score);
	expect(fuzzyMatch('search', 'sea')!.score).toBeGreaterThan(fuzzyMatch('long search', 'sea')!.score);
});

test('BM25 update, deletion, AND terms, prefix, short document weighting', () => {
	const index = new SearchBM25();
	index.set('a', 'chromatic calibration'); index.set('b', 'chromatic calibration with many other extra words');
	expect(index.search('chromatic cal').get('a')!).toBeGreaterThan(index.search('chromatic cal').get('b')!);
	expect(index.search('chromatic absent').size).toBe(0);
	const same = index.documents.get('a'); index.set('a', 'chromatic calibration'); expect(index.documents.get('a')).toBe(same);
	index.set('a', 'replacement'); expect(index.search('chromatic').has('a')).toBe(false);
	index.delete('b'); expect(index.search('chromatic').size).toBe(0);
});

test('eligible tasks keep closed/archive/top-level filters authoritative', () => {
	const index = new TaskSearchIndex(); index.update(fixture.documents);
	expect(index.search('telescope', new Set(['T112'])).map(hit => hit.id)).toEqual(['T112']);
});

test('family cycles terminate and removed tasks leave the index', () => {
	const index = new TaskSearchIndex();
	index.update([{id:'T1',title:'one',body:'',refs:[],parent:'T2'},{id:'T2',title:'two',body:'',refs:[],parent:'T1'}]);
	expect(index.search('one').map(hit => hit.id)).toEqual(['T2','T1']);
	index.update([]); expect(index.search('one')).toEqual([]);
});

test('body snippet includes last-word prefix, never markup', () => {
	const index = new TaskSearchIndex(); index.update(fixture.documents);
	expect(index.search('chromatic ab')[0]!.snippet).toContain('aberration');
});

export function syntheticSearchDocuments(): TaskSearchDocument[] {
	return Array.from({length:5000}, (_, at) => ({ id:`T${at + 1}`, title:`${['Polish telescope lens','Write the field guide','Review night colours','Pack the sample case'][at % 4]} ${at}`, refs: at % 17 ? [] : [`https://github.com/example/studio/pull/${4000 + at}`], body:`Synthetic task ${at}. ${at % 5 ? 'Inspect sample packaging and update documentation.' : 'Explain chromatic aberration and calibration in the field guide.'}` }));
}
