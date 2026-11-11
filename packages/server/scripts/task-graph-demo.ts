/** Throwaway synthetic backend for T79. Run with Bun from the repository root. Never opens installed data. */
import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context';
import { fauxAssistantMessage } from '@earendil-works/pi-ai/providers/faux';
import { createSetup, TestClient, ViewClient } from '../test/support.ts';
import { BoardDoc } from '../src/board.ts';
import { WorkersDoc, type WorkerRecord } from '../src/workers.ts';
import type { BoardTaskInput } from '@aiki/protocol';
import { FIXTURE_NOW, makeGraphFixture } from '../../../apps/web/test/fixtures/task-graph-busy.ts';

const origin = process.env.GRAPH_WEB_ORIGIN ?? 'http://localhost:5173';
const output = process.env.GRAPH_DEMO_OUTPUT ?? '/tmp/task-graph-demo.json';
const test = await createSetup({ allowedOrigins:[origin], terminals:false });
console.log(JSON.stringify({dataDir:test.dataDir,configDir:test.configDir,pid:process.pid}));
const busy = process.env.GRAPH_DEMO_SCENARIO === 'busy' ? makeGraphFixture() : null;
if(busy) {
	// Keep old task activity without letting the real waiting/archive timers consume the demo on start.
	const offset=Date.now()-Date.parse(FIXTURE_NOW);
	const shift=(iso:string)=>new Date(Date.parse(iso)+offset).toISOString();
	for(const task of busy.board.tasks) {
		task.createdAt=shift(task.createdAt);task.updatedAt=shift(task.updatedAt);
		if(task.settledAt)task.settledAt=shift(task.settledAt);
		if(task.report.updatedAt)task.report.updatedAt=shift(task.report.updatedAt);
		if(task.waiting){task.waiting.since=shift(task.waiting.since);if(task.waiting.until)task.waiting.until=shift(task.waiting.until);}
	}
}
// The faux provider never talks to a model service or runs tools.
const held = async (_request:unknown, options?:{signal?:AbortSignal}) => {
	await new Promise<void>(resolve => options?.signal?.addEventListener('abort',()=>resolve(),{once:true}));
	return fauxAssistantMessage('Synthetic session ended.');
};
test.faux.setResponses(Array.from({length:30},()=>held));
const client=await TestClient.open(test.server);await client.hello();
const added=await client.request({type:'projects.add',path:test.projectDir});
if(added.type!=='projects.add')throw new Error(JSON.stringify(added));
const projectId=added.project.id;
await client.request({type:'projects.configure',projectId,name:'Little things studio',coordinatorModel:{provider:'faux',modelId:'faux-1'}});
const view=new ViewClient(client);await view.start(projectId);
const {runtime}=await test.server.manager.open(projectId);
const titles=['Build a tiny observatory','Create a pocket garden','Sketch the dome','Polish the lens','Tune the star map','Test night colours','Pack the telescope','Draw the seedlings','Shape the paths','Water the fern','Check the soil','Label the pots','Round the lens cap','Fix a sleepy compass','Catch a missing leaf','Prepare the launch','Unwrap the palette','Choose a ribbon','Write a welcome note','Check the contrast','Fold the paper guide','Wait for the parcel','Sort the stickers','Archive the sketch','Celebrate small wins'];
const states:BoardTaskInput['status'][]=['in_progress','in_progress','done','in_progress','review','blocked','todo','in_progress','todo','waiting','done','review','todo','blocked','todo','blocked','todo','review','todo','review','todo','waiting','todo','done','todo'];
for(let i=0;i<(busy ? 0 : titles.length);i++) {
	const parent=i>=2&&i<=6?'T1':i>=7&&i<=11?'T2':i===12?'T4':null;
	await runtime.board.saveTask({task:{title:titles[i]!,description:'An invented task for the graph look study.',acceptance:null,refs:[],status:states[i]!,blockedBy:i===5?['T5']:i===13?['T6']:i===15?['T14']:[],blockedReason:null,writeScopes:[],parent,foundWhile:i===13?'T4':i===14?'T8':null,related:i===18?['T17']:[],...(states[i]==='waiting'?{waitingFor:'A sample parcel'}:{})}},'coordinator');
}
if(busy) await runtime.harness.commit(async tx=>{
	const doc=await tx.doc(BoardDoc,runtime.conversation.id);
	doc.tasks=JSON.parse(JSON.stringify(busy.board.tasks.map(task=>({...task,ownerThreadId:'main'}))));
	doc.counters.task=90;
	doc.questions=busy.board.questions.map(q=>({...q,askedAt:new Date().toISOString()}));
	doc.counters.question=doc.questions.length;
	doc.updatedAt=new Date().toISOString();
},BACKGROUND_CONTEXT);
if(!busy) await runtime.harness.commit(async tx=>{
	const doc=await tx.doc(BoardDoc,runtime.conversation.id);const now=new Date().toISOString();
	doc.questions.push({id:'Q1',revision:1,kind:'question',text:'Which ribbon colour should we try?',options:['Mint','Lilac'],taskId:'T18',status:'open',answer:null,askedAt:now,answeredAt:null,threadId:'main'}, {id:'Q2',revision:1,kind:'warning',text:'The sample contrast needs another look.',options:[],taskId:'T20',status:'open',answer:null,askedAt:now,answeredAt:null,threadId:'main'});
	doc.counters.question=2;
},BACKGROUND_CONTEXT);
const started=await runtime.threads.start({id:busy?'sync-team':'garden',title:busy?'Sync crew':'Garden crew',brief:'Synthetic held session.',model:null,thinkingLevel:null,onFinish:'record',startedBy:'main',scheduleId:null,taskId:busy?'T10':'T2',key:'graph-demo'});
if(!started.ok)throw new Error(started.message);
const threadId=started.record.conversationId;
const workerFixture=(id:string,taskId:string,status:WorkerRecord['status']):WorkerRecord=>({id,title:`Care for ${taskId}`,conversationId:runtime.conversation.id,anchorTaskId:0,isolation:'shared',workspacePath:null,model:{provider:'faux',modelId:'faux-1'},thinkingLevel:null,status,taskId,spawnedByCallId:null,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),lastReport:null,failure:null});
// Durable fixture records drive the same workers.state/threads.state watches as real runs.
await runtime.harness.commit(async tx=>{
	const main=await tx.doc(WorkersDoc,runtime.conversation.id);const garden=await tx.doc(WorkersDoc,threadId as never);
	for(const [id,task,status] of [['pip','T4','running'],['dot','T5','running'],['moss','T19','running'],['nap','T7','idle']] as const)main.workers[id]=workerFixture(id,task,status);
	garden.workers['bud']=workerFixture('bud','T8','running');garden.workers['dew']=workerFixture('dew','T9','running');
	if(busy) {
		main.workers={};garden.workers={};
		for(const worker of busy.workers) main.workers[worker.id]={...workerFixture(worker.id,worker.taskId!,worker.status),title:worker.title,lastReport:worker.lastReport,failure:worker.failure};
		// Keep a stable, known report control in both scenarios.
		main.workers.pip!.taskId='T3';
	}
},BACKGROUND_CONTEXT);
let sequence=0;
let stressSeeded=false;
const controls=Bun.serve({port:0,hostname:'127.0.0.1',async fetch(request){
	const path=new URL(request.url).pathname;
	if(path==='/empty' || path==='/restore' || path==='/close-all') {
		if(!busy) return new Response('busy scenario required',{status:400});
		await runtime.harness.commit(async tx=>{const doc=await tx.doc(BoardDoc,runtime.conversation.id);doc.tasks=path==='/empty'?[]:JSON.parse(JSON.stringify(busy.board.tasks.map(task=>path==='/close-all'?{...task,status:'done' as const}:task)));},BACKGROUND_CONTEXT);
		return new Response('board changed');
	}
	if(path==='/review') {
		await runtime.harness.commit(async tx=>{const doc=await tx.doc(BoardDoc,runtime.conversation.id);const task=doc.tasks.find(t=>t.id==='T3')!;task.status='review';task.updatedAt=new Date().toISOString();},BACKGROUND_CONTEXT);
		return new Response('review');
	}
	if(path==='/complete' || path==='/offscreen' || path==='/reviews' || path==='/question' || path==='/answer') {
		await runtime.harness.commit(async tx=>{
			const doc=await tx.doc(BoardDoc,runtime.conversation.id);const now=new Date().toISOString();
			if(path==='/question')doc.questions.push({id:`Q${++doc.counters.question}`,revision:1,kind:'warning',text:'Check the sample carrying case.',options:[],taskId:'T3',status:'open',answer:null,askedAt:now,answeredAt:null,threadId:'main'});
			else if(path==='/answer'){const q=doc.questions.find(q=>q.taskId==='T3'&&q.status==='open');if(q){q.status='answered';q.answer='Checked';q.answeredAt=now;}}
			else for(const id of path==='/complete'?['T4']:path==='/offscreen'?['T84','T85']:['T3','T12','T21']){const task=doc.tasks.find(t=>t.id===id);if(task){task.status=path==='/complete'?'done':'review';task.updatedAt=now;}}
		},BACKGROUND_CONTEXT);
		return new Response('board changed');
	}
	if(path==='/fail' || path==='/worker-arrive') {
		await runtime.harness.commit(async tx=>{const doc=await tx.doc(WorkersDoc,runtime.conversation.id);if(path==='/fail'){doc.workers.pip!.status='failed';doc.workers.pip!.failure='Synthetic sample check failed.';}else doc.workers['new-sprout']=workerFixture('new-sprout','T3','running');},BACKGROUND_CONTEXT);
		return new Response('worker changed');
	}
	if(path==='/report') {
		await runtime.harness.commit(async tx=>{const doc=await tx.doc(WorkersDoc,runtime.conversation.id);doc.workers.pip!.lastReport=`Checked the lens, sample ${++sequence}.`;doc.workers.pip!.updatedAt=new Date().toISOString();},BACKGROUND_CONTEXT);
		return new Response('reported');
	}
	if(path==='/move' || path==='/move-near' || path==='/rest' || path==='/finish') {
		await runtime.harness.commit(async tx=>{
			const doc=await tx.doc(WorkersDoc,runtime.conversation.id);
			const worker=doc.workers[path==='/finish'?(busy?'moss':'dot'):'pip']!;
			if(path==='/move'||path==='/move-near')worker.taskId=path==='/move-near'?'T4':'T8';
			else worker.status=path==='/rest'?'idle':'done';
			worker.updatedAt=new Date().toISOString();
		},BACKGROUND_CONTEXT);
		return new Response('worker changed');
	}
	if(path==='/arrive') {
		const task=await runtime.board.saveTask({task:{title:'Check the miniature telescope carrying case and its soft lining',description:'Synthetic live arrival.',acceptance:null,status:'todo',blockedBy:[],blockedReason:null,writeScopes:[],parent:'T4'}},'coordinator');
		return Response.json({id:task.id});
	}
	if(path==='/stress') {
		if(busy) return new Response('90 tasks and 9 workers already seeded');
		if(stressSeeded) return new Response('80 tasks and 10 workers already seeded');
		stressSeeded=true;
		for(let i=(await runtime.board.state()).tasks.length+1;i<=80;i++)await runtime.board.saveTask({task:{title:`Sample task ${i}`,description:'Synthetic load fixture.',acceptance:null,status:'todo',blockedBy:[],blockedReason:null,writeScopes:[],parent:(i-26)%8 ? `T${Math.floor((i-26)/8)*8+26}`:null}},'coordinator');
		await runtime.harness.commit(async tx=>{const doc=await tx.doc(WorkersDoc,runtime.conversation.id);doc.workers.dot!.status='running';for(let i=0;i<4;i++)doc.workers[`extra-${i}`]=workerFixture(`extra-${i}`,`T${i+30}`,'running');},BACKGROUND_CONTEXT);
		return new Response('80 tasks and 10 workers');
	}
	return new Response('synthetic demo controls');
}});
await Bun.write(output,JSON.stringify({url:test.server.url,projectId,controls:`http://127.0.0.1:${controls.port}`,pid:process.pid}));
console.log(`Synthetic graph backend ready; connection details in ${output}`);
process.on('SIGTERM',async()=>{controls.stop();client.close();await test.cleanup();process.exit(0);});
await new Promise(()=>{});
