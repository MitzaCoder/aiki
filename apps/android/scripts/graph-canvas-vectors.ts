import { makeGraphFixture, FIXTURE_NOW, advanceGraphFixture } from '../../web/test/fixtures/task-graph-busy.ts';
import { buildGraphModel } from '../../web/src/lib/task-graph-model.ts';
import { layoutTaskFamilies, type LayoutTask } from '../../web/src/lib/task-graph-families.ts';
import { graphSnapshot, diffGraphSnapshots, batchGraphChanges } from '../../web/src/lib/task-graph-changes.ts';

const fixture = makeGraphFixture(18);
const model = buildGraphModel(fixture.board.tasks, fixture.board.questions, fixture.workers, fixture.threads, Date.parse(FIXTURE_NOW));
const input: LayoutTask[] = fixture.board.tasks.map(t => ({ id: t.id, parent: t.parent ?? null, familyId: model.details.get(t.id)!.familyId, order: t.order, createdAt: t.createdAt }));
const options = { cardWidth: 300, cardHeight: 104, creatureHeight: 32, creaturesAbove: true, gap: 12, indent: 28, padding: 20, headerHeight: 48, familyGap: 56, reserveSlots: 2, reserveDepth: 2, aspect: 1.5, pillWidth: 264, pillHeight: 72 };
let layout: ReturnType<typeof layoutTaskFamilies> | undefined;
const layouts = [input, input.filter(t => t.id !== 'T3'), ...[1, 2, 3].map(n => [...input.filter(t => t.id !== 'T3'), ...Array.from({ length: n }, (_, i) => ({ id: `T${19 + i}`, parent: 'T4', familyId: 'T1', order: 100 + i, createdAt: FIXTURE_NOW }))])].map(tasks => {
	layout = layoutTaskFamilies(tasks, { previous: layout, options });
	return { tasks, cards: [...layout.cards.values()], families: layout.families, bounds: layout.bounds, needsRegroup: layout.needsRegroup, movedFamilyIds: layout.movedFamilyIds };
});
const states = [fixture, advanceGraphFixture(fixture), { ...advanceGraphFixture(fixture), workers: fixture.workers.map(w => w.id === 'fern' ? { ...w, taskId: 'T4', lastReport: 'Checked the lens.\nReady for review.' } : w) }, advanceGraphFixture(fixture, 'arrival'), advanceGraphFixture(fixture, 'complete')];
const snapshots = states.map(f => graphSnapshot(f.board.tasks, f.board.questions, f.workers, f.threads));
const snapshotJSON = (s: typeof snapshots[number]) => ({ tasks: Object.fromEntries(s.tasks), questions: Object.fromEntries(s.questions), crew: Object.fromEntries(s.crew) });
let entries: ReturnType<typeof batchGraphChanges> = [];
const changes = snapshots.map((snapshot, i) => {
	const changes = diffGraphSnapshots(i ? snapshots[i - 1]! : null, snapshot);
	const now = 1000 + i * 300;
	entries = batchGraphChanges(entries, changes, now, Math.max(0, ...entries.map(e => e.serial)));
	return { snapshot: snapshotJSON(snapshot), changes, now, entries };
});
const source = JSON.stringify({ layouts, changes }, null, 2) + '\n';
const path = new URL('../test-vectors/task-graph-canvas-v1.json', import.meta.url);
if (Bun.argv.includes('--check')) {
	if (await Bun.file(path).text() !== source) throw new Error('Canvas vectors differ from the web model');
	console.log('Canvas layout and changes vectors match the web model');
} else await Bun.write(path, source);
