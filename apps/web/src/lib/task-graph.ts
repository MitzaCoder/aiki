import type { BoardLinkKind, BoardQuestion, BoardTask, ThreadSummary, WorkerSummary } from '@kemiri/protocol';

export type GraphNode = {
	id: string; kind: 'task' | 'worker' | 'thread'; title: string; status: string;
	task?: BoardTask; worker?: WorkerSummary; thread?: ThreadSummary;
	parent: string | null; attention: boolean; radius: number;
};
export type GraphEdge = { id: string; from: string; to: string; kind: BoardLinkKind | 'working' | 'owns' };
export type TaskGraph = { nodes: GraphNode[]; edges: GraphEdge[] };
const taskKey = (id: string) => `task:${id}`;
export function buildTaskGraph(tasks: readonly BoardTask[], questions: readonly BoardQuestion[], workers: readonly WorkerSummary[], threads: readonly ThreadSummary[], showClosed = false): TaskGraph {
	const shown = tasks.filter(task => !task.archived && (showClosed || !['done', 'dropped'].includes(task.status)));
	const attention = new Set(questions.filter(q => q.status === 'open').flatMap(q => q.taskId ? [q.taskId] : []));
	for (const worker of workers) if (worker.status === 'failed' && worker.taskId) attention.add(worker.taskId);
	const nodes: GraphNode[] = shown.map(task => ({ id: taskKey(task.id), kind: 'task', title: task.title, status: task.status, task,
		parent: task.parent ? taskKey(task.parent) : null, attention: task.status === 'review' || attention.has(task.id), radius: (task.subtaskCount?.total ?? tasks.filter(t => t.parent === task.id).length) > 0 ? 47 : 29 }));
	const edges: GraphEdge[] = [];
	const add = (from: string, to: string, kind: GraphEdge['kind']) => {
		if (from === to) return;
		const id = kind === 'related' ? `${kind}:${[from,to].sort().join(':')}` : `${kind}:${from}:${to}`;
		if (!edges.some(e => e.id === id)) edges.push({id, from, to, kind});
	};
	for (const task of shown) {
		for (const [kind, targets] of [['parent', task.parent ? [task.parent] : []], ['foundWhile', task.foundWhile ? [task.foundWhile] : []], ['blockedBy', task.blockedBy], ['related', task.related ?? []]] as const)
			for (const target of targets) add(taskKey(task.id), taskKey(target), kind);
	}
	for (const thread of threads.filter(t => !t.main && !t.archived && t.status !== 'done')) {
		const parent = thread.taskId ?? thread.ownedTasks.find(id => shown.some(t => t.id === id));
		nodes.push({id:`thread:${thread.id}`, kind:'thread', title:thread.title, status:thread.status, thread, parent:parent ? taskKey(parent) : null, attention:thread.status === 'failed', radius:32});
		for (const id of new Set([...(thread.taskId ? [thread.taskId] : []), ...thread.ownedTasks])) add(`thread:${thread.id}`, taskKey(id), 'owns');
	}
	for (const worker of workers.filter(w => !['done','stopped'].includes(w.status))) {
		const task = worker.taskId ?? shown.find(t => t.workerIds.includes(worker.id))?.id;
		const thread = nodes.find(n => n.id === `thread:${worker.threadId}`);
		if (!task && !thread && worker.status !== 'running' && worker.status !== 'idle' && worker.status !== 'failed') continue;
		nodes.push({id:`worker:${worker.id}`, kind:'worker', title:worker.title, status:worker.status, worker, parent:task && shown.some(t => t.id === task) ? taskKey(task) : thread?.id ?? null, attention:worker.status === 'failed', radius:21});
		if (task) add(`worker:${worker.id}`, taskKey(task), 'working');
		if (thread) add(`worker:${worker.id}`, thread.id, 'owns');
	}
	const ids = new Set(nodes.map(n => n.id));
	return {nodes, edges:edges.filter(e => ids.has(e.from) && ids.has(e.to))};
}

/** Family to any depth, plus blockers in either direction. No unrelated found-while expansion. */
export function graphNeighborhood(graph: TaskGraph, id: string | null): Set<string> {
	if (!id) return new Set(graph.nodes.map(n => n.id));
	const family = new Set([id]);
	let changed = true;
	while (changed) {
		changed = false;
		for (const edge of graph.edges.filter(e => e.kind === 'parent')) {
			if (family.has(edge.from) || family.has(edge.to)) for (const key of [edge.from, edge.to]) if (!family.has(key)) { family.add(key); changed = true; }
		}
	}
	const highlighted = new Set(family);
	for (const edge of graph.edges) if ((edge.kind === 'blockedBy' || edge.kind === 'working' || edge.kind === 'owns') && (family.has(edge.from) || family.has(edge.to))) { highlighted.add(edge.from); highlighted.add(edge.to); }
	return highlighted;
}
export function graphLabel(node: GraphNode): string {
	return `${node.kind === 'task' ? node.task?.id : node.kind}: ${node.title}, ${node.status.replaceAll('_',' ')}${node.attention ? ', needs attention' : ''}${node.task?.subtaskCount ? `, ${node.task.subtaskCount.done} of ${node.task.subtaskCount.total} subtasks done` : ''}`;
}

export type GraphPosition = { x:number; y:number; anchorX:number; anchorY:number; vx:number; vy:number; radius:number; parentId:string | null };
function seed(id: string): number {
	let hash = 2166136261;
	for (const char of id) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
	return (hash >>> 0) / 4294967296;
}

/** Retained by ID, independent of board array order. Existing anchors never move on a watch update. */
export function reconcileGraphPositions(graph: TaskGraph, previous = new Map<string, GraphPosition>(), aspect = 1): Map<string, GraphPosition> {
	const positions = new Map<string, GraphPosition>();
	const roots = graph.nodes.filter(n => n.kind === 'task' && !graph.nodes.some(p => p.id === n.parent));
	const families = roots.filter(n => graph.nodes.some(child => child.kind === 'task' && child.parent === n.id));
	const singles = roots.filter(n => !families.includes(n));
	const columns = aspect < 1 ? 2 : Math.max(2,Math.min(5,Math.ceil(Math.sqrt(families.length*aspect*.8))));
	const familyRows = Math.ceil(families.length/columns);
	for (const node of graph.nodes) {
		const retained = previous.get(node.id);
		if (retained && (node.kind === 'task' || retained.parentId === node.parent)) positions.set(node.id, {...retained, radius:node.radius});
	}
	const place = (node: GraphNode, visited = new Set<string>()): GraphPosition => {
		const retained = positions.get(node.id); if (retained) return retained;
		visited.add(node.id);
		const parent = graph.nodes.find(n => n.id === node.parent && !visited.has(n.id));
		let x: number, y:number;
		if (parent) {
			const center = place(parent, visited);
			const siblings = graph.nodes.filter(n => n.parent === parent.id && n.kind === node.kind).sort((a,b) => a.id.localeCompare(b.id));
			const angle = node.kind === 'thread' ? -0.75 : node.kind === 'worker' ? (parent.kind === 'thread' ? -Math.PI/2 + siblings.indexOf(node)*1.6 : -0.45) : parent.parent ? -Math.PI*0.8 : siblings.indexOf(node) / Math.max(1, siblings.length) * Math.PI*2 - Math.PI/2;
			const distance = node.kind === 'task' ? (parent.parent ? 180 : 190) : node.kind === 'thread' ? 235 : parent.kind === 'thread' ? 88 : 100;
			x = center.x + Math.cos(angle)*distance; y = center.y + Math.sin(angle)*distance;
		} else if (families.includes(node)) {
			const index = families.indexOf(node); x = 300 + index%columns*680; y = 280 + Math.floor(index/columns)*540;
		} else {
			const index = Math.max(0, singles.indexOf(node)); x = 135 + index%6*220; y = familyRows*540 + 180 + Math.floor(index/6)*175;
			if (node.kind !== 'task') { x = 1140; y = 170 + graph.nodes.filter(n => n.kind !== 'task').indexOf(node)*90; }
		}
		const angle = seed(node.id + ':position')*Math.PI*2;
		const position = {x:x+Math.cos(angle)*18,y:y+Math.sin(angle)*18,anchorX:x,anchorY:y,vx:0,vy:0,radius:node.radius,parentId:node.parent};
		positions.set(node.id, position); return position;
	};
	for (const node of graph.nodes) place(node);
	return positions;
}

/** Bounded O(n²) collision relaxation. Dormant after settling; no perpetual force timer. */
export function stepGraphLayout(positions: Map<string, GraphPosition>, pinned: string | ReadonlySet<string> | null = null): number {
	const entries = [...positions.entries()];
	for (let i=0;i<entries.length;i++) for(let j=i+1;j<entries.length;j++) {
		const [,a] = entries[i]!, [,b] = entries[j]!;
		const dx = b.x-a.x || 0.01, dy=b.y-a.y || 0.01, distance=Math.hypot(dx,dy);
		const minimum = a.radius+b.radius+72;
		if(distance >= minimum) continue;
		const force=(minimum-distance)*0.09;
		a.vx-=dx/distance*force; a.vy-=dy/distance*force; b.vx+=dx/distance*force; b.vy+=dy/distance*force;
	}
	let energy=0;
	for(const [id,p] of entries) {
		if(id===pinned || (typeof pinned === 'object' && pinned?.has(id))) {p.vx=0;p.vy=0;continue;}
		p.vx=(p.vx+(p.anchorX-p.x)*0.025)*0.72; p.vy=(p.vy+(p.anchorY-p.y)*0.025)*0.72;
		p.x+=p.vx; p.y+=p.vy; energy+=Math.abs(p.vx)+Math.abs(p.vy);
	}
	return energy;
}
