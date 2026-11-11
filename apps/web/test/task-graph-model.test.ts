import { describe, expect, it } from 'bun:test';
import { Value } from 'typebox/value';
import { PROTOCOL_SCHEMAS } from '@aiki/protocol';
const { Board: BoardSchema, WorkerSummary: WorkerSummarySchema, ThreadSummary: ThreadSummarySchema } = PROTOCOL_SCHEMAS;
import { buildGraphModel, graphSummaryCounters, searchGraph } from '../src/lib/task-graph-model.ts';
import { makeGraphFixture, FIXTURE_NOW, advanceGraphFixture } from './fixtures/task-graph-busy.ts';
const now = Date.parse(FIXTURE_NOW);
const build = (fixture = makeGraphFixture()) => buildGraphModel(fixture.board.tasks, fixture.board.questions, fixture.workers, fixture.threads, now);
describe('graph product model', () => {
	it('uses protocol-valid busy board, worker and thread shapes', () => {
		const fixture = makeGraphFixture();
		expect([...Value.Errors(BoardSchema, fixture.board)]).toEqual([]);
		for (const worker of fixture.workers) expect([...Value.Errors(WorkerSummarySchema, worker)]).toEqual([]);
		for (const thread of fixture.threads) expect([...Value.Errors(ThreadSummarySchema, thread)]).toEqual([]);
		expect(fixture.board.tasks).toHaveLength(90);
	});
	it('keeps nested families through closed and archived parents and missing ancestors', () => {
		const fixture = makeGraphFixture(9);
		fixture.board.tasks[0]!.archived = true;
		fixture.board.tasks[0]!.status = 'done';
		const model = build(fixture);
		expect(model.details.get('T8')?.familyId).toBe('T1');
		expect(model.details.get('T8')?.familyTitle).toBe('Access & identity');
		fixture.board.tasks = fixture.board.tasks.filter(t => t.id !== 'T1');
		expect(build(fixture).details.get('T8')?.familyId).toBe('T1');
	});
	it('resolves cycles deterministically, independent of input order, including their descendants', () => {
		const fixture = makeGraphFixture(9);
		fixture.board.tasks[0]!.parent = 'T7';
		const forward = build(fixture);
		fixture.board.tasks.reverse();
		const backward = build(fixture);
		for (const id of ['T1', 'T5', 'T7', 'T8']) {
			expect(forward.details.get(id)?.familyId).toBe('T1');
			expect(backward.details.get(id)?.familyId).toBe('T1');
		}
	});
	it('shows overlapping reasons, dated waiting, questions and worker failures separately', () => {
		const model = build();
		expect(model.details.get('T2')?.reasons).toEqual(['review', 'question']);
		expect(model.details.get('T6')?.reasons).toEqual(['waiting']);
		expect(model.details.get('T6')?.task.waiting?.until).toBe('2026-06-15T09:00:00Z');
		expect(model.details.get('T39')?.reasons).toContain('failed');
		expect(model.reasonCounts).toEqual({ review: 10, blocked: 20, waiting: 10, question: 5, failed: 1 });
	});
	it('uses the exact 48-hour quiet boundary and never marks closed tasks quiet', () => {
		const fixture = makeGraphFixture(9);
		const task = fixture.board.tasks[0]!;
		task.updatedAt = new Date(now - 48 * 3600000 + 1).toISOString();
		expect(build(fixture).details.get('T1')?.quiet).toBe(false);
		task.updatedAt = new Date(now - 48 * 3600000).toISOString();
		expect(build(fixture).details.get('T1')?.quiet).toBe(true);
		for (const status of ['done', 'dropped'] as const) { task.status = status; expect(build(fixture).details.get('T1')?.quiet).toBe(false); }
	});
	it('counts all-depth non-dropped subtasks, excluding root, and direct dependents once', () => {
		const fixture = makeGraphFixture(9);
		fixture.board.tasks[6]!.status = 'done';
		fixture.board.tasks[7]!.status = 'dropped';
		fixture.board.tasks[3]!.blockedBy = ['T2', 'T2'];
		const model = build(fixture);
		expect(model.details.get('T8')?.progress).toBe('2 of 7 subtasks done');
		expect(model.details.get('T2')?.blocks).toEqual(['T4', 'T7']);
		expect(model.statusCounts.done).toBe(2);
	});
	it('ranks exact ID before prefix, supports family, worker and thread search, and empty results', () => {
		const model = build();
		expect(searchGraph(model, 'T1')[0]?.taskId).toBe('T1');
		expect(searchGraph(model, 'access & identity')).toHaveLength(9);
		expect(searchGraph(model, 'fern')[0]?.taskId).toBe('T3');
		expect(searchGraph(model, 'sync crew').map(r => r.taskId)).toContain('T10');
		expect(searchGraph(model, 'not a task')).toEqual([]);
		expect(searchGraph(model, ' ')).toEqual([]);
	});
	it('shows each summary count once, includes quiet, and hides zero dropped', () => {
		const counters = graphSummaryCounters(build());
		expect(counters.filter(c => c.label === 'Review')).toHaveLength(1);
		expect(counters.filter(c => c.label === 'Blocked')).toHaveLength(1);
		expect(counters.filter(c => c.label === 'Waiting')).toHaveLength(1);
		expect(counters.find(c => c.key === 'quiet')?.count).toBe(10);
		expect(counters.some(c => c.label === 'Dropped')).toBe(false);
		const fixture = makeGraphFixture(); fixture.board.tasks[0]!.status = 'dropped';
		expect(graphSummaryCounters(build(fixture)).find(c => c.label === 'Dropped')?.count).toBe(1);
	});
	it('keeps ID selection on replacement and exposes a disappeared selection as missing', () => {
		const fixture = makeGraphFixture();
		const selectedTaskId = 'T3';
		const before = build(fixture).details.get(selectedTaskId);
		const after = build(advanceGraphFixture(fixture)).details.get(selectedTaskId);
		expect(before?.task.status).toBe('in_progress');
		expect(after?.task.status).toBe('review');
		expect(after?.task.id).toBe(selectedTaskId);
		fixture.board.tasks = fixture.board.tasks.filter(t => t.id !== selectedTaskId);
		expect(build(fixture).details.get(selectedTaskId)).toBeUndefined();
	});
});
