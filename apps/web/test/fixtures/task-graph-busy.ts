import type { Board, BoardQuestion, BoardTask, ThreadSummary, WorkerSummary } from '@kemiri/protocol';

export const FIXTURE_NOW = '2026-06-12T12:00:00Z';
export const FAMILY_NAMES = ['Access & identity', 'Reliable sync', 'Search & discovery', 'Release readiness', 'Usage insights', 'Workspace setup', 'Notifications', 'File review', 'Team handoff', 'Mobile polish'];
const OUTCOMES = ['Ship the first release', 'Agree on the access rules', 'Build the happy path', 'Handle reconnect safely', 'Test concurrent changes', 'Review keyboard navigation', 'Resolve slow network failures', 'Check the last edge cases', 'Write the release notes'];

export function makeGraphFixture(count = 90): { board: Board; workers: WorkerSummary[]; threads: ThreadSummary[] } {
	const tasks: BoardTask[] = Array.from({ length: count }, (_, index): BoardTask => {
		const family = Math.floor(index / 9);
		const slot = index % 9;
		const status: BoardTask['status'] = (['in_progress', 'review', 'in_progress', 'blocked', 'todo', 'waiting', 'blocked', 'todo', 'done'] as const)[slot]!;
		const id = `T${index + 1}`;
		const updatedAt = new Date(Date.parse(FIXTURE_NOW) - (slot === 6 ? 72 : slot * 3) * 3600000).toISOString();
		return {
			id, revision: 1, title: slot === 0 ? FAMILY_NAMES[family]! : `${OUTCOMES[slot]} · ${FAMILY_NAMES[family]}`,
			description: 'Synthetic product release fixture. No real project content.', acceptance: null, refs: [],
			status, blockedBy: slot === 3 || slot === 6 ? [`T${family * 9 + 2}`, ...(family ? [`T${(family - 1) * 9 + 3}`] : [])] : [],
			blockedReason: slot === 6 ? 'Needs reconnect contract' : null,
			parent: slot === 0 ? null : `T${family * 9 + (slot === 7 ? 7 : slot === 6 ? 5 : 1)}`,
			foundWhile: slot === 7 ? `T${family * 9 + 3}` : null,
			related: slot === 4 && family ? [`T${(family - 1) * 9 + 5}`] : [],
			waiting: slot === 5 ? { note: 'Waiting for the test window', since: updatedAt, until: '2026-06-15T09:00:00Z', by: 'coordinator' } : undefined,
			writeScopes: [], workerIds: [], scheduleId: null, ownerThreadId: family === 1 ? 'sync-team' : 'main',
			report: { now: status === 'blocked' ? 'Waiting for the access contract' : 'Checking acceptance criteria', results: '', next: '', revision: 0, updatedAt, updatedBy: { author: 'coordinator', threadId: 'main', workerId: null } },
			snapshots: 1, order: index, createdBy: 'coordinator', updatedBy: 'coordinator',
			createdAt: '2026-06-08T09:00:00Z', updatedAt, settledAt: status === 'done' ? updatedAt : null, archived: false,
		};
	});
	for (const task of tasks) {
		const children = tasks.filter(child => child.parent === task.id);
		if (children.length) task.subtaskCount = { total: children.length, done: children.filter(child => child.status === 'done').length };
	}
	const questions: BoardQuestion[] = tasks.filter((_, i) => i % 18 === 1).map((task, i) => ({
		id: `Q${i + 1}`, revision: 1, kind: 'question', text: 'Keep the stricter access rule?', options: ['Keep it', 'Relax it'],
		taskId: task.id, status: 'open', answer: null, askedAt: task.updatedAt, answeredAt: null,
	}));
	const workers: WorkerSummary[] = Array.from({ length: Math.min(9, Math.floor(count / 5)) }, (_, i) => ({
		id: ['fern', 'moss', 'pip', 'clover', 'reed', 'sage', 'basil', 'lark', 'robin'][i]!,
		title: 'Check reconnect and recovery', status: i < 6 ? 'running' : i === 8 ? 'failed' : 'idle',
		model: { provider: 'synthetic', modelId: 'fixture' }, thinkingLevel: null, isolation: 'shared',
		workspacePath: null, conversationId: i + 2, spawnedByCallId: null, threadId: i < 3 ? 'sync-team' : 'main',
		taskId: tasks[Math.min(count - 1, Math.floor(i / 2) * 9 + 2)]!.id,
		createdAt: '2026-06-12T09:00:00Z', updatedAt: FIXTURE_NOW, lastReport: null, failure: i === 8 ? 'Synthetic interrupted check' : null,
	}));
	const threads: ThreadSummary[] = count ? [{
		id: 'sync-team', title: 'Sync crew', status: 'running', main: false, startedBy: 'main', scheduleId: null,
		conversationId: 20, model: null, thinkingLevel: null, onFinish: 'review', runningWorkers: Math.min(3, workers.length),
		taskId: count > 9 ? 'T10' : 'T1', ownedTasks: tasks.slice(9, 18).map(task => task.id), openQuestions: 1,
		current: 'Checking reconnect safety', summary: null, failure: null, createdAt: FIXTURE_NOW, updatedAt: FIXTURE_NOW,
		finishedAt: null, archived: false,
	}] : [];
	return { board: { tasks, questions, decisions: [], updatedAt: FIXTURE_NOW }, workers, threads };
}

export type GraphFixtureEvent = 'review' | 'arrival' | 'reassign' | 'complete';

/** Deterministic replacements, like board.state plus workers.list updates. */
export function advanceGraphFixture(fixture: ReturnType<typeof makeGraphFixture>, event: GraphFixtureEvent = 'review') {
	if (event === 'arrival' && fixture.board.tasks.length) {
		const task = fixture.board.tasks[0]!;
		const id = `T${Math.max(...fixture.board.tasks.map(task => Number(task.id.slice(1)))) + 1}`;
		return { ...fixture, board: { ...fixture.board, tasks: [...fixture.board.tasks, { ...task, id, title: 'Verify invite expiry recovery', parent: 'T1', status: 'todo' as const, subtaskCount: undefined }] } };
	}
	if (event === 'reassign') return { ...fixture, workers: fixture.workers.map(worker => worker.id === 'fern' ? { ...worker, taskId: 'T20' } : worker) };
	if (event === 'complete') return { ...fixture, board: { ...fixture.board, tasks: fixture.board.tasks.map(task => task.id === 'T3' ? { ...task, status: 'done' as const, settledAt: FIXTURE_NOW } : task) } };
	return {
		...fixture,
		board: { ...fixture.board, tasks: fixture.board.tasks.map(task => task.id === 'T3' ? { ...task, status: 'review' as const, updatedAt: FIXTURE_NOW } : task) },
		workers: fixture.workers.map(worker => worker.id === 'lark' ? { ...worker, status: 'running' as const, lastReport: 'Reconnect checks passed.', updatedAt: FIXTURE_NOW } : worker),
	};
}
