import { afterEach, expect, it } from 'bun:test';
import type { JsonObject } from '@earendil-works/pi-durable';
import { fauxAssistantMessage, fauxToolCall } from '@earendil-works/pi-ai/providers/faux';
import type { BoardTaskInput } from '@aiki/protocol';
import { addSnapshot, buildTimeline, describeTask, emptyBoardState, normalizeBoard, saveTask, USER_WRITER, type TaskHistoryState } from '../src/board.ts';
import { createSetup, TestClient, ViewClient, type TestSetup } from './support.ts';
const NOW='2026-11-10T12:00:00.000Z';
const input=(extra:Partial<BoardTaskInput>={}):BoardTaskInput=>({title:'Ship auth',description:'',acceptance:null,status:'review',blockedBy:[],blockedReason:null,writeScopes:[],...extra});
const cleanups:(()=>Promise<void>)[]=[];afterEach(async()=>{for(const f of cleanups.splice(0))await f()});
it('requires a nonblank waiting note and a valid ISO date',()=>{for(const extra of [{},{waitingFor:'  '},{waitingFor:'Ana',waitUntil:'not a date'}]) expect(()=>saveTask(emptyBoardState(),{task:input({status:'waiting',...extra}),author:'user',now:NOW})).toThrow();});
it('stores provenance, clears waiting on exit, and retains it in history and timeline',()=>{
 const state=emptyBoardState();const first=saveTask(state,{task:input({status:'waiting',waitingFor:' PR #312 approval from Ana ',waitUntil:'2026-11-14'}),author:'user',now:NOW}).after;
 expect(first.waiting).toEqual({note:'PR #312 approval from Ana',since:NOW,until:'2026-11-14T00:00:00.000Z',by:'user'});
 const history:TaskHistoryState={snapshots:[],keys:[]};addSnapshot(history,state.tasks[0]!,{label:'review → waiting',at:NOW,by:USER_WRITER});
 const done=saveTask(state,{taskId:first.id,expectedRevision:first.revision,task:input({status:'done'}),author:'user',now:NOW}).after;
 expect(done.waiting).toBeUndefined();expect(history.snapshots[0]?.waiting).toEqual(first.waiting);expect(buildTimeline({id:first.id},state,history).entries[0]?.detail).toContain('approval from Ana');
});
it('keeps undated waits and their note in list/show output, and old boards still load',()=>{
 const state=emptyBoardState();const task=saveTask(state,{task:input({status:'waiting',waitingFor:'a release'}),author:'coordinator',now:NOW}).after;
 expect(task.waiting?.until).toBeUndefined();expect(describeTask(task)).toContain('a release');delete state.tasks[0]!.waiting;state.tasks[0]!.status='review';expect(normalizeBoard(state).tasks[0]?.status).toBe('review');
});
async function connect(t:TestSetup){const c=await TestClient.open(t.server);cleanups.push(async()=>c.close());await c.hello();return c;}
it('returns overdue waits after restart, sends follow-up, and keeps undated waits',async()=>{
 let now=Date.parse(NOW);const t=await createSetup({now:()=>now,boardEditDebounceMs:5});cleanups.push(t.cleanup);t.faux.setResponses(Array.from({length:30},()=>fauxAssistantMessage('Noted.')));
 let c=await connect(t);const added=await c.request({type:'projects.add',path:t.projectDir});if(added.type!=='projects.add')throw Error(JSON.stringify(added));const projectId=added.project.id;
 await c.request({type:'projects.configure',projectId,coordinatorModel:{provider:'faux',modelId:'faux-1'}});
 const a=await c.request({type:'board.task.save',projectId,task:input({status:'waiting',waitingFor:'PR #312 approval from Ana',waitUntil:'2026-11-11'})});expect(a.type).toBe('board.task.save');
 await c.request({type:'board.task.save',projectId,task:input({status:'waiting',waitingFor:'the release'})});await Bun.sleep(50);c.close();await t.restart();now+=2*86400000;c=await connect(t);
 const b=await c.request({type:'board.get',projectId});if(b.type!=='board.get')throw Error(JSON.stringify(b));expect(b.board.tasks[0]).toMatchObject({status:'review'});expect(b.board.tasks[0]?.waiting).toBeUndefined();expect(b.board.tasks[1]?.status).toBe('waiting');
 const h=await c.request({type:'board.task.history',projectId,taskId:'T1'});expect(JSON.stringify(h)).toContain('waiting → review');
 await Bun.sleep(100);const v=new ViewClient(c);await v.start(projectId);expect(JSON.stringify(v.view)).toContain('is back for review: waiting for PR #312 approval from Ana');
},20000);
it('the coordinator tool refuses waiting without waitingFor',async()=>{
 const t=await createSetup();cleanups.push(t.cleanup);t.faux.setResponses([fauxAssistantMessage([fauxToolCall('board',{action:'add_task',title:'Auth'})],{stopReason:'toolUse'}),fauxAssistantMessage([fauxToolCall('board',{action:'update_task',id:'T1',expectedRevision:1,status:'waiting'})],{stopReason:'toolUse'}),fauxAssistantMessage('Done')]);
 const c=await connect(t);const a=await c.request({type:'projects.add',path:t.projectDir});if(a.type!=='projects.add')throw Error();const projectId=a.project.id;await c.request({type:'projects.configure',projectId,coordinatorModel:{provider:'faux',modelId:'faux-1'}});await c.request({type:'conversation.submit',projectId,content:'Do it',requestId:'waiting-test'});
 await Bun.sleep(500);const v=new ViewClient(c);await v.start(projectId);expect(JSON.stringify(v.view)).toContain('Waiting requires a waitingFor note');
},20000);

it('the coordinator tool accepts waiting and prints its note in list and show_task', async () => {
 const t = await createSetup(); cleanups.push(t.cleanup);
 const call = (args: JsonObject) => fauxAssistantMessage([fauxToolCall('board', args)], {stopReason:'toolUse'});
 t.faux.setResponses([
  call({action:'add_task',title:'Auth'}),
  call({action:'update_task',id:'T1',expectedRevision:1,status:'waiting',waitingFor:'Ana approval',waitUntil:'2026-12-01'}),
  call({action:'list'}), call({action:'show_task',id:'T1'}), fauxAssistantMessage('Done'),
 ]);
 const c = await connect(t); const a = await c.request({type:'projects.add',path:t.projectDir}); if(a.type!=='projects.add')throw Error();
 const projectId=a.project.id;await c.request({type:'projects.configure',projectId,coordinatorModel:{provider:'faux',modelId:'faux-1'}});
 const v=new ViewClient(c);await v.start(projectId);
 await c.request({type:'conversation.submit',projectId,content:'Track Ana approval',requestId:'waiting-output-test'});
 await v.waitForView(view=>view.entries.filter(e=>e.kind==='pi.tool-result').length>=4);
 const output=JSON.stringify(v.view);expect(output.match(/Ana approval/g)!.length).toBeGreaterThanOrEqual(2);
 const b=await c.request({type:'board.get',projectId});if(b.type!=='board.get')throw Error();expect(b.board.tasks[0]?.waiting?.by).toBe('coordinator');
},20000);
