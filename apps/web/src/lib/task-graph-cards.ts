import { quietGraphAge, graphHoldsUp, graphWaitingDate } from './task-graph-changes.ts';
import type { GraphModel, GraphTaskDetails } from './task-graph-model.ts';
import { GRAPH_REASONS, GRAPH_STATUSES } from './task-graph-model.ts';
import type { FamilyBox, FamilyCamera, FamilyEdge, TaskFamilyLayout } from './task-graph-families.ts';

export function cardProgress(details: GraphTaskDetails, model: GraphModel): string {
	if (!details.children.length) return '';
	let done = 0, total = 0;
	const pending = [...details.children], seen = new Set([details.task.id]);
	while (pending.length) {
		const id = pending.pop()!;
		if (seen.has(id)) continue;
		seen.add(id);
		const child = model.details.get(id);
		if (!child) continue;
		if (child.task.status !== 'dropped') { total++; if (child.task.status === 'done') done++; }
		pending.push(...child.children);
	}
	return `${done} of ${total} subtasks done`;
}

export function familySummary(model: GraphModel, familyId: string) {
	const members = [...model.details.values()].filter(d => !d.task.archived && d.familyId === familyId);
	return {
		title: members[0]?.familyTitle ?? familyId,
		progress: members[0]?.progress ?? '0 of 0 subtasks done',
		needsYou: members.filter(d => d.reasons.length).length,
		count: members.length,
		statuses: GRAPH_STATUSES.map(s => ({ ...s, count: members.filter(d => d.task.status === s.key).length })),
	};
}

export function familyCardLabel(details: GraphTaskDetails, model: GraphModel, now=Date.now()): string {
	const holds=graphHoldsUp([...model.details.values()].map(d=>d.task),details.task.id);
	return [details.task.id, details.task.title, GRAPH_STATUSES.find(s => s.key === details.task.status)!.label,
		...details.reasons.map(reason => GRAPH_REASONS.find(r => r.key === reason)!.label), details.quiet ? quietGraphAge(details.task.updatedAt,now) : '',
		details.task.status==='waiting'?graphWaitingDate(details.task.waiting?.until,now):'',
		holds.direct?`Holds up ${holds.direct} tasks (${holds.total} including indirect)`:'',
		cardProgress(details, model), ...details.workers.map(w => `Worker ${w.title}, ${w.status}`),
		...details.threads.filter(t => !t.main && !t.archived).map(t => `Thread ${t.title}, ${t.status}`)].filter(Boolean).join(', ');
}

/** Parent routes remain visible; other relationships are scoped without changing membership/geometry. */
export function familyRelationships(model: GraphModel, layout: TaskFamilyLayout, selectedId: string | null, matches: ReadonlySet<string> | null): FamilyEdge[] {
	const selectedFamily = selectedId ? layout.cards.get(selectedId)?.familyId : undefined;
	const scoped = (id: string) => !!matches?.has(id) || (!!selectedFamily && layout.cards.get(id)?.familyId === selectedFamily);
	const edges = new Map<string, FamilyEdge>();
	for (const {task} of model.details.values()) {
		for (const [kind, targets] of [['subtask', task.parent ? [task.parent] : []], ['found-while', task.foundWhile ? [task.foundWhile] : []], ['blocked-by', task.blockedBy], ['related', task.related ?? []]] as const) {
			for (const to of targets) {
				if (kind !== 'subtask' && !scoped(task.id) && !scoped(to)) continue;
				if (!layout.cards.has(task.id) || !layout.cards.has(to)) continue;
				const id = `${kind}:${kind === 'related' ? [task.id,to].sort().join(':') : `${task.id}:${to}`}`;
				edges.set(id, {id, from: task.id, to, kind});
			}
		}
	}
	return [...edges.values()];
}

/** Prefer aligned neighbors, then nearest distance, with stable tie-breaking. */
export function spatialFamilyNeighbor(boxes: ReadonlyMap<string, FamilyBox>, from: string, key: string): string | null {
	const origin = boxes.get(from);
	if (!origin) return boxes.keys().next().value ?? null;
	const horizontal = key === 'ArrowLeft' || key === 'ArrowRight';
	const direction = key === 'ArrowLeft' || key === 'ArrowUp' ? -1 : 1;
	let nearest: string | null = null, score = Infinity;
	for (const [id, box] of boxes) {
		if (id === from) continue;
		const dx = box.x + box.width/2 - origin.x - origin.width/2;
		const dy = box.y + box.height/2 - origin.y - origin.height/2;
		const forward = (horizontal ? dx : dy) * direction, sideways = Math.abs(horizontal ? dy : dx);
		if (forward <= 1) continue;
		const distance = Math.hypot(dx,dy) + sideways * 2;
		if (distance < score || distance === score && id < (nearest ?? '')) {score = distance; nearest = id;}
	}
	return nearest;
}

export function fitFamilyCardMatches(layout: TaskFamilyLayout, ids: ReadonlySet<string>, viewport: {width:number;height:number}): FamilyCamera | null {
	const boxes = [...ids].flatMap(id => {const card=layout.cards.get(id);return card?[card.occupiedBox]:[];});
	if (!boxes.length) return null;
	const left=Math.min(...boxes.map(b=>b.x)), top=Math.min(...boxes.map(b=>b.y));
	const width=Math.max(...boxes.map(b=>b.x+b.width))-left, height=Math.max(...boxes.map(b=>b.y+b.height))-top;
	const zoom=Math.max(.03,Math.min(1,(viewport.width-48)/width,(viewport.height-48)/height));
	return {zoom,x:(viewport.width-width*zoom)/2-left*zoom,y:(viewport.height-height*zoom)/2-top*zoom};
}

const cameraKey = (scope: string) => 'task-graph.camera.v2:' + encodeURIComponent(scope);
export function loadFamilyCamera(scope: string, storage?: Pick<Storage,'getItem'>): FamilyCamera | null {
	try {
		const camera = JSON.parse(storage?.getItem(cameraKey(scope)) ?? 'null');
		return camera && [camera.x,camera.y,camera.zoom].every(Number.isFinite) && camera.zoom >= .03 && camera.zoom <= 4 ? camera : null;
	} catch {return null;}
}
export function saveFamilyCamera(scope: string, camera: FamilyCamera, storage?: Pick<Storage,'setItem'>) {
	try {storage?.setItem(cameraKey(scope), JSON.stringify(camera));} catch { /* Private/quota-limited storage is optional. */ }
}
