import type { BoardQuestion, BoardTask, BoardTaskStatus, ThreadSummary, WorkerSummary } from '@kemiri/protocol';

export const GRAPH_STATUSES: { key: BoardTaskStatus; label: string; mark: string; tone: string }[] = [
	{ key: 'todo', label: 'Planned', mark: '○', tone: 'var(--graph-muted)' },
	{ key: 'in_progress', label: 'Working', mark: '▶', tone: 'var(--graph-working)' },
	{ key: 'review', label: 'Review', mark: '◇', tone: 'var(--graph-review)' },
	{ key: 'blocked', label: 'Blocked', mark: '⊣', tone: 'var(--graph-blocked)' },
	{ key: 'waiting', label: 'Waiting', mark: '◷', tone: 'var(--graph-waiting)' },
	{ key: 'done', label: 'Done', mark: '✓', tone: 'var(--graph-done)' },
	{ key: 'dropped', label: 'Dropped', mark: '−', tone: 'var(--graph-muted)' },
];
export const GRAPH_REASONS = [
	{ key: 'review', label: 'Review', mark: '◇', tone: 'var(--graph-review)' },
	{ key: 'blocked', label: 'Blocked', mark: '⊣', tone: 'var(--graph-blocked)' },
	{ key: 'waiting', label: 'Waiting', mark: '◷', tone: 'var(--graph-waiting)' },
	{ key: 'question', label: 'Question / warning', mark: '?', tone: 'var(--graph-working)' },
	{ key: 'failed', label: 'Worker failed', mark: '!', tone: 'var(--graph-blocked)' },
] as const;
export type GraphReason = typeof GRAPH_REASONS[number]['key'];
export type GraphTaskDetails = {
	task: BoardTask; familyId: string; familyTitle: string; progress: string;
	reasons: GraphReason[]; questions: BoardQuestion[]; quiet: boolean;
	blocks: string[]; children: string[]; workers: WorkerSummary[]; threads: ThreadSummary[];
};
export type GraphModel = ReturnType<typeof buildGraphModel>;

/** Includes hidden/closed ancestors when resolving families. Cycles share their lowest ID as a stable root. */
export function buildGraphModel(tasks: readonly BoardTask[], questions: readonly BoardQuestion[], workers: readonly WorkerSummary[], threads: readonly ThreadSummary[], now: number) {
	const byId = new Map(tasks.map(task => [task.id, task]));
	const familyById = new Map<string, string>();
	for (const task of tasks) {
		if (familyById.has(task.id)) continue;
		const path: string[] = [], seen = new Map<string, number>();
		let id = task.id, root: string;
		while (true) {
			const cached = familyById.get(id);
			if (cached) { root = cached; break; }
			const cycle = seen.get(id);
			if (cycle !== undefined) { root = path.slice(cycle).sort()[0]!; break; }
			seen.set(id, path.length); path.push(id);
			const parent = byId.get(id)?.parent;
			if (!parent) { root = id; break; }
			id = parent;
		}
		for (const member of path) familyById.set(member, root);
	}
	const progress = new Map<string, { done: number; total: number }>();
	const blocks = new Map<string, string[]>(), children = new Map<string, string[]>();
	for (const task of tasks) {
		if (task.parent) children.set(task.parent, [...(children.get(task.parent) ?? []), task.id]);
		for (const blocker of new Set(task.blockedBy)) blocks.set(blocker, [...(blocks.get(blocker) ?? []), task.id]);
		const root = familyById.get(task.id)!;
		const count = progress.get(root) ?? { done: 0, total: 0 };
		if (task.id !== root && task.status !== 'dropped') { count.total++; if (task.status === 'done') count.done++; }
		progress.set(root, count);
	}
	// Index associations once. In particular main.ownedTasks can contain the entire board;
	// filtering threads with includes per card is quadratic (and costly on watched proxies).
	const questionsByTask = new Map<string, BoardQuestion[]>();
	for (const q of questions) if (q.status === 'open' && q.taskId) {
		const group = questionsByTask.get(q.taskId) ?? []; group.push(q); questionsByTask.set(q.taskId,group);
	}
	const workerTasks = new Map<string,string[]>(), ownerTasks = new Map<string,string[]>();
	for (const task of tasks) {
		for (const id of task.workerIds) { const group=workerTasks.get(id)??[];group.push(task.id);workerTasks.set(id,group); }
		if (task.ownerThreadId) { const group=ownerTasks.get(task.ownerThreadId)??[];group.push(task.id);ownerTasks.set(task.ownerThreadId,group); }
	}
	const workersByTask = new Map<string,WorkerSummary[]>(), threadsByTask = new Map<string,ThreadSummary[]>();
	for (const worker of workers) for (const id of worker.taskId?[worker.taskId]:workerTasks.get(worker.id)??[]) {
		const group=workersByTask.get(id)??[];group.push(worker);workersByTask.set(id,group);
	}
	for (const thread of threads) for (const id of new Set([...(thread.taskId?[thread.taskId]:[]),...thread.ownedTasks,...(ownerTasks.get(thread.id)??[])])) {
		const group=threadsByTask.get(id)??[];group.push(thread);threadsByTask.set(id,group);
	}
	const details = new Map<string, GraphTaskDetails>();
	for (const task of tasks) {
		const familyId = familyById.get(task.id)!;
		const count = progress.get(familyId)!;
		const taskQuestions = questionsByTask.get(task.id) ?? [];
		const taskWorkers = workersByTask.get(task.id) ?? [];
		const reasons: GraphReason[] = [];
		if (task.status === 'review' || task.status === 'blocked' || task.status === 'waiting') reasons.push(task.status);
		if (taskQuestions.length) reasons.push('question');
		if (taskWorkers.some(w => w.status === 'failed')) reasons.push('failed');
		details.set(task.id, { task, familyId, familyTitle: byId.get(familyId)?.title ?? familyId,
			progress: `${count.done} of ${count.total} subtasks done`, reasons, questions: taskQuestions,
			quiet: !['done', 'dropped'].includes(task.status) && now - Date.parse(task.updatedAt) >= 48 * 3600000,
			blocks: blocks.get(task.id) ?? [], children: children.get(task.id) ?? [], workers: taskWorkers,
			threads: threadsByTask.get(task.id) ?? [],
		});
	}
	const counted = [...details.values()].filter(d => !d.task.archived);
	const statusCounts = Object.fromEntries(GRAPH_STATUSES.map(s => [s.key, counted.filter(d => d.task.status === s.key).length])) as Record<BoardTaskStatus, number>;
	const reasonCounts = Object.fromEntries(GRAPH_REASONS.map(r => [r.key, counted.filter(d => d.reasons.includes(r.key)).length])) as Record<GraphReason, number>;
	return { details, statusCounts, reasonCounts, quietCount: counted.filter(d => d.quiet).length, unassignedQuestions: questions.filter(q => q.status === 'open' && !q.taskId) };
}

/** One compact strip: each status/reason appears once; quiet remains distinct from failure. */
export function graphSummaryCounters(model: GraphModel) {
	return [
		...GRAPH_REASONS.map(reason => ({...reason, key: `reason:${reason.key}`, count: model.reasonCounts[reason.key]})),
		{key: 'quiet', label: 'Quiet', mark: '◴', tone: 'var(--graph-quiet)', count: model.quietCount},
		...['in_progress', 'todo', 'done', 'dropped'].flatMap(key => {
			const status = GRAPH_STATUSES.find(status => status.key === key)!;
			return key === 'dropped' && !model.statusCounts.dropped ? [] : [{...status, key: `status:${key}`, count: model.statusCounts[status.key]}];
		}),
	];
}

export type GraphSearchResult = { taskId: string; score: number; matched: string };
/** Ranked task results; a family-title match expands to every member, a worker/thread match to its tasks. */
export function searchGraph(model: GraphModel, query: string): GraphSearchResult[] {
	const needle = query.trim().toLocaleLowerCase();
	if (!needle) return [];
	const results: GraphSearchResult[] = [];
	for (const d of model.details.values()) {
		if (d.task.archived) continue;
		const candidates: [string, number, string][] = [[d.task.id, 100, 'Task ID'], [d.task.title, 80, 'Title'], [d.familyTitle, 50, 'Family'],
			...d.workers.flatMap(w => [[w.id, 70, 'Worker'], [w.title, 60, 'Worker']] as [string, number, string][]),
			...d.threads.map(t => [t.title, 40, 'Thread'] as [string, number, string])];
		let score = 0, matched = '';
		for (const [text, weight, kind] of candidates) {
			const value = text.toLocaleLowerCase();
			const rank = value === needle ? weight + 20 : value.startsWith(needle) ? weight + 10 : value.includes(needle) ? weight : 0;
			if (rank > score) { score = rank; matched = kind; }
		}
		if (score) results.push({ taskId: d.task.id, score, matched });
	}
	return results.sort((a, b) => b.score - a.score || a.taskId.localeCompare(b.taskId, undefined, { numeric: true }));
}
