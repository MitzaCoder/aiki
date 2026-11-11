import { makeGraphFixture, FIXTURE_NOW } from '../../web/test/fixtures/task-graph-busy.ts';
import { buildGraphModel, graphSummaryCounters, searchGraph } from '../../web/src/lib/task-graph-model.ts';
import { graphHoldsUp } from '../../web/src/lib/task-graph-changes.ts';

// The web model is the executable oracle. JVM tests consume the same synthetic input and expected results.
const fixture = makeGraphFixture(18);
const tasks = fixture.board.tasks;
tasks[0] = { ...tasks[0]!, archived: true };
tasks[4] = { ...tasks[4]!, status: 'dropped' };
tasks[12] = { ...tasks[12]!, parent: 'T14', blockedBy: ['T2', 'T4'] };
tasks[13] = { ...tasks[13]!, parent: 'T13', blockedBy: ['T2', 'T13'] };
tasks[14] = { ...tasks[14]!, parent: 'T13', blockedBy: ['T14'] };
fixture.workers[0] = { ...fixture.workers[0]!, status: 'failed', lastReport: 'Checked reconnect safety.', failure: 'Synthetic interrupted check' };
const model = buildGraphModel(tasks, fixture.board.questions, fixture.workers, fixture.threads, Date.parse(FIXTURE_NOW));
const queries = ['T2', 'access', 'fern', 'Sync crew', 'reconnect', 'absent'];
const vector = {
	now: FIXTURE_NOW, tasks, questions: fixture.board.questions, workers: fixture.workers, threads: fixture.threads,
	details: [...model.details.values()].map(d => ({
		id: d.task.id, familyId: d.familyId, progress: d.progress, reasons: d.reasons, quiet: d.quiet,
		children: d.children, blocks: d.blocks, workers: d.workers.map(w => w.id), threads: d.threads.map(t => t.id),
		holdsUp: graphHoldsUp(tasks, d.task.id),
	})),
	counters: graphSummaryCounters(model).map(c => ({ key: c.key, count: c.count })),
	search: queries.map(query => ({ query, results: searchGraph(model, query) })),
};
const path = new URL('../test-vectors/task-graph-v1.json', import.meta.url);
const source = JSON.stringify(vector, null, 2) + '\n';
if (Bun.argv.includes('--check')) {
	if (await Bun.file(path).text() !== source) throw new Error('Graph vectors differ from the web model');
	console.log('Graph vectors match the web model');
} else await Bun.write(path, source);
