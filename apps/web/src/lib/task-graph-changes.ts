import type { BoardQuestion, BoardTask, ThreadSummary, WorkerSummary } from '@aiki/protocol';
import { GRAPH_STATUSES } from './task-graph-model.ts';

export type GraphSnapshot = {
	tasks: ReadonlyMap<string, { status: string; title: string }>;
	questions: ReadonlyMap<string, { taskId: string | null; kind: string; status: string }>;
	crew: ReadonlyMap<string, { taskId: string | null; status: string; report: string; title: string }>;
};
export type GraphChange = { key: string; taskIds: string[]; text: string; plural: string; workerId?: string; kind: string };
export type GraphChangeEntry = GraphChange & { id: number; at: number; count: number; serial: number };

/** Copy the watched fields: a mutable caller cannot rewrite the previous baseline. */
export function graphSnapshot(tasks: readonly BoardTask[], questions: readonly BoardQuestion[], workers: readonly WorkerSummary[], threads: readonly ThreadSummary[]): GraphSnapshot {
	return {
		tasks: new Map(tasks.filter(t=>!t.archived).map(t=>[t.id,{status:t.status,title:t.title}])),
		questions: new Map(questions.map(q=>[q.id,{taskId:q.taskId,kind:q.kind??'question',status:q.status}])),
		crew: new Map([
			...workers.map(w=>['worker:'+w.id,{taskId:w.taskId??tasks.find(t=>t.workerIds.includes(w.id))?.id??null,status:w.status,report:w.lastReport?.trim()??'',title:w.title}] as const),
			...threads.filter(t=>!t.main&&!t.archived).map(t=>['thread:'+t.id,{taskId:t.taskId??t.ownedTasks[0]??null,status:t.status,report:(t.current??t.summary)?.trim()??'',title:t.title}] as const),
		]),
	};
}
/** Explicit reset is used only after all three reconnect reads complete. */
export class GraphChangeBaseline {
	#snapshot:GraphSnapshot|null=null;
	read(snapshot:GraphSnapshot,reset=false):GraphChange[]{
		const changes=diffGraphSnapshots(reset?null:this.#snapshot,snapshot);
		this.#snapshot=snapshot;
		return changes;
	}
}
const terminal = (status: string) => ['done','stopped','failed'].includes(status);
export function diffGraphSnapshots(previous: GraphSnapshot | null, next: GraphSnapshot): GraphChange[] {
	if (!previous) return [];
	const changes: GraphChange[] = [];
	function add(kind:string,key:string,taskIds:(string|null)[],text:string,plural=text,workerId?:string) {
		const ids=[...new Set(taskIds.filter((id):id is string=>!!id))];
		if(ids.length)changes.push({kind,key,taskIds:ids,text,plural,workerId});
	}
	for(const [id,task] of next.tasks){
		const before=previous.tasks.get(id);
		const taskName=`${id} ${task.title.length>48?task.title.slice(0,47)+'…':task.title}`;
		if(!before)add('arrival','arrival',[id],`${taskName} arrived`,'tasks arrived');
		else if(before.status!==task.status){
			const label=GRAPH_STATUSES.find(s=>s.key===task.status)?.label??task.status;
			add('status','status:'+task.status,[id],`${taskName} → ${label}`,`tasks moved to ${label}`);
		}
	}
	for(const [id,q] of next.questions){
		const before=previous.questions.get(id);
		if(q.status==='open'&&before?.status!=='open')add('question',q.kind+':open',[q.taskId],`${q.taskId}: new ${q.kind}`,`new ${q.kind}s`);
		else if(before?.status==='open'&&q.status!=='open')add('answer',q.kind+':'+q.status,[q.taskId],`${q.taskId}: ${q.kind} ${q.status==='answered'?'answered':'closed'}`,`${q.kind}s ${q.status==='answered'?'answered':'closed'}`);
	}
	for(const [id,q] of previous.questions)if(q.status==='open'&&!next.questions.has(id))add('answer',q.kind+':answered',[q.taskId],`${q.taskId}: ${q.kind} closed`,`${q.kind}s closed`);
	for(const [id,crew] of next.crew){
		const before=previous.crew.get(id), worker=id.startsWith('worker:'), subject=worker?'Worker':'Thread';
		if(!before){const action=crew.status==='failed'?'failed':terminal(crew.status)?'finished':'started';add('crew',subject+':'+action,[crew.taskId],`${subject} ${crew.title} ${action}`,`${subject.toLowerCase()}s ${action}`);}
		if(before&&crew.taskId!==before.taskId)add('reassigned',subject+':reassigned',[before.taskId,crew.taskId],`${subject} ${crew.title}: ${before.taskId??'unassigned'} → ${crew.taskId??'unassigned'}`,`${subject.toLowerCase()}s reassigned`);
		if(before&&crew.status!==before.status){
			const action=crew.status==='failed'?'failed':terminal(crew.status)?'finished':crew.status==='running'?'started':'resting';
			add('crew',subject+':'+action,[crew.taskId??before.taskId],`${subject} ${crew.title} ${action}`,`${subject.toLowerCase()}s ${action}`);
		}
		if(before&&crew.report&&crew.report!==before.report)add('report',id+':report',[crew.taskId],`${worker?id.slice(7):crew.title} reported on ${crew.taskId} · ${crew.report.split('\n').filter(Boolean).at(-1)!.slice(0,180)}`,`${subject.toLowerCase()} reports`,worker?id.slice(7):undefined);
	}
	for(const [id,crew] of previous.crew)if(!next.crew.has(id)&&!terminal(crew.status))add('crew',id.split(':')[0]+':removed',[crew.taskId],`${crew.title} finished`,'crew finished');
	return changes;
}

/** Fixed one-second windows, rather than a sliding window that never closes under traffic. */
export function batchGraphChanges(entries: readonly GraphChangeEntry[], changes: readonly GraphChange[], now:number, serial:number): GraphChangeEntry[] {
	const next=entries.map(entry=>({...entry,taskIds:[...entry.taskIds]}));
	for(const change of changes){
		const entry=next.find(e=>e.key===change.key&&now-e.at<1000);
		if(entry){entry.count++;if(change.kind==='report')entry.text=change.text;entry.taskIds=[...new Set([...entry.taskIds,...change.taskIds])];entry.serial=++serial;}
		else next.unshift({...change,id:++serial,serial,at:now,count:1});
	}
	return next.slice(0,50);
}
export const graphChangeText = (entry:GraphChangeEntry) => entry.count===1||entry.kind==='report'?entry.text:`${entry.count} ${entry.plural}`;
export function graphAnnouncement(changes: readonly GraphChange[]):string {
	const counts=new Map<string,number>();
	for(const c of changes)counts.set(c.plural,(counts.get(c.plural)??0)+1);
	return [...counts].map(([text,count])=>`${count} ${count===1?text.replace(/^(tasks|workers|threads|questions|warnings)\b/,word=>word.slice(0,-1)).replace(/^new (questions|warnings)\b/,word=>word.slice(0,-1)):text}`).join('; ');
}

/** Announce once per five-second window. Hidden tabs retain a bounded summary for returning users. */
export class GraphAnnouncementQueue {
	#pending:GraphChange[]=[];
	#lastAt=0;
	add(changes:readonly GraphChange[]){this.#pending.push(...changes);this.#pending=this.#pending.slice(-100);}
	clear(){this.#pending=[];}
	flush(now:number,visible:boolean):string|null {
		if(!visible||!this.#pending.length||now-this.#lastAt<5000)return null;
		const text=graphAnnouncement(this.#pending);this.#pending=[];this.#lastAt=now;return text;
	}
}

/** Only unfinished dependents count; cycles and diamonds must never double count. */
export function graphDependencyIndex(tasks: readonly BoardTask[]) {
	const dependents=new Map<string,string[]>();
	for(const task of tasks)if(!task.archived&&!['done','dropped'].includes(task.status))for(const blocker of task.blockedBy) {
		const children=dependents.get(blocker)??[];children.push(task.id);dependents.set(blocker,children);
	}
	const counts=new Map<string,{direct:number;total:number}>();
	return (id:string) => {
		const cached=counts.get(id);if(cached)return cached;
		const direct=new Set((dependents.get(id)??[]).filter(child=>child!==id)),seen=new Set([id]),pending=[...direct];
		while(pending.length){const child=pending.pop()!;if(seen.has(child))continue;seen.add(child);pending.push(...(dependents.get(child)??[]));}
		const count={direct:direct.size,total:seen.size-1};counts.set(id,count);return count;
	};
}
export function graphHoldsUp(tasks: readonly BoardTask[], id:string):{direct:number;total:number} {
	return graphDependencyIndex(tasks)(id);
}
export function quietGraphAge(updatedAt:string,now:number):string { return `quiet ${Math.floor(Math.max(0,now-Date.parse(updatedAt))/86400000)} d`; }
export function graphWaitingDate(until:string|null|undefined,now:number):string {
	if(!until)return '';
	const at=Date.parse(until);if(!Number.isFinite(at))return '';
	return at<now?'overdue':`until ${new Date(at).toLocaleDateString(undefined,{month:'short',day:'numeric'})}`;
}
