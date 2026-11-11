import { batchGraphChanges, GraphChangeBaseline, GraphAnnouncementQueue, type GraphChangeEntry, type GraphSnapshot } from './task-graph-changes.ts';

/** Session-only, project/backend scoped. Responsive sidebar remounts are not new sessions. */
export class TaskGraphSession {
	selectedTaskId=$state<string|null>(null);
	changes=$state.raw<GraphChangeEntry[]>([]);
	changesOpen=$state(false);
	seenSerial=$state(0);
	updatedUntil=$state.raw<Record<string,number>>({});
	closedUntil=$state.raw<Record<string,number>>({});
	reports=$state.raw<Record<string,number>>({});
	offscreenTaskIds=$state.raw<string[]>([]);
	announcement=$state('');
	lastReceivedAt=$state(0);
	#baseline=new GraphChangeBaseline();
	#announcements=new GraphAnnouncementQueue();
	#serial=0;
	resetBaseline(snapshot:GraphSnapshot,receivedAt:number){this.#baseline.read(snapshot,true);this.lastReceivedAt=receivedAt;this.#announcements.clear();this.reports={};}
	receive(snapshot:GraphSnapshot,now:number,receivedAt:number){
		const changes=this.#baseline.read(snapshot);
		this.lastReceivedAt=receivedAt;
		if(!changes.length)return;
		this.changes=batchGraphChanges(this.changes,changes,now,this.#serial);
		this.#serial+=changes.length;
		if(this.changesOpen)this.seenSerial=this.#serial;
		const updated={...this.updatedUntil},closed={...this.closedUntil},reports={...this.reports};
		for(const change of changes){
			for(const id of change.taskIds){updated[id]=now+1800;if(change.kind==='status'&&['done','dropped'].includes(snapshot.tasks.get(id)?.status??''))closed[id]=now+4500;}
			if(change.workerId)reports[change.workerId]=now+1600;
		}
		this.updatedUntil=updated;this.closedUntil=closed;this.reports=reports;
		this.offscreenTaskIds=[...new Set([...this.offscreenTaskIds,...changes.flatMap(c=>c.taskIds)])];
		this.#announcements.add(changes);
	}
	get unseen(){return this.changes.filter(c=>c.serial>this.seenSerial).length;}
	toggleChanges(){this.changesOpen=!this.changesOpen;if(this.changesOpen)this.seenSerial=this.#serial;}
	announce(now:number,visible:boolean){
		const text=this.#announcements.flush(now,visible);this.announcement=text??'';
		this.updatedUntil=Object.fromEntries(Object.entries(this.updatedUntil).filter(([,until])=>until>now));
		this.reports=Object.fromEntries(Object.entries(this.reports).filter(([,until])=>until>now));
		this.closedUntil=Object.fromEntries(Object.entries(this.closedUntil).filter(([id,until])=>until>now||id===this.selectedTaskId));
	}
}
const sessions=new Map<string,TaskGraphSession>();
export function taskGraphSession(scope:string):TaskGraphSession {
	let session=sessions.get(scope);
	if(!session){session=new TaskGraphSession();sessions.set(scope,session);}
	return session;
}
