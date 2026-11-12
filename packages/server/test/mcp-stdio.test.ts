import { expect, it } from 'bun:test';
import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context';
import type { ToolExecutionApi } from '@earendil-works/pi-durable';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fauxAssistantMessage, fauxToolCall } from '@earendil-works/pi-ai/providers/faux';
import { createSetup, TestClient, ViewClient, entryText } from './support.ts';

it('requires confirmation, starts lazily, redacts env, stops idle, restarts crashes and closes children', async () => {
 let now = Date.now(); const logs: string[] = [];
 const test = await createSetup({ now: () => now, log: line => logs.push(line) });
 const client = await TestClient.open(test.server);
 const secret = 'synthetic-stdio-secret'; const spawnFile = join(test.root, 'spawns');
 const command = { command: process.execPath, args: [join(import.meta.dir, 'fixtures/mcp-stdio.ts')], cwd: test.projectDir };
 try {
 await client.hello(); const mcp = test.server.manager.mcp!;
 const input = { type: 'mcp.add' as const, serverId: 'stdio', name: 'Synthetic command', command, env: { DEMO_SECRET: secret, SPAWN_FILE: spawnFile, COUNT: '1' } };
 expect((await client.request(input)).type).toBe('error');
 expect(await mcp.list()).toEqual([]);
 const added = await client.request({ ...input, confirmed: true }); expect(added.type).toBe('mcp.add');
 expect(await Bun.file(spawnFile).exists()).toBe(false);
 expect((await mcp.refresh('stdio')).status).toBe('connected');
 const view = await mcp.view('stdio');
 expect(view.tools[0]?.inputSchema.properties).toEqual({ page: { type: 'string', minLength: 1 } });
 expect(view.command).toEqual(command); expect(view.envNames).toContain('DEMO_SECRET');
 expect(view.stderrTail).toContain('[redacted]'); expect(JSON.stringify(view)).not.toContain(secret);
 expect(await readFile(mcp.path, 'utf8')).not.toContain(secret);
 expect(await readFile(join(test.dataDir, 'credentials.json'), 'utf8')).toContain(secret);
 const project = await client.request({ type: 'projects.add', path: test.projectDir });
 if (project.type !== 'projects.add') throw new Error('project');
 const { runtime } = await test.server.manager.open(project.project.id);
 await mcp.setProject(project.project.id, [{ serverId: 'stdio', enabled: true, roles: ['coordinator'] }]);
 const agent = await runtime.conversation.agent(BACKGROUND_CONTEXT);
 const echo = agent.callable.find(tool => tool.name === 'mcp__stdio__echo')!;
 const crash = agent.callable.find(tool => tool.name === 'mcp__stdio__crash')!;
 expect(echo.deferred).toBe(true);
 const api = { conversationId: runtime.conversation.id, callId: 'stdio-test' } as ToolExecutionApi;
 const call = async (tool: typeof echo) => JSON.stringify(await tool.execute({}, api, BACKGROUND_CONTEXT));
 expect(await call(echo)).toContain('synthetic result [redacted]');
 expect(await call(echo)).toContain('PATH=true');
 expect(await call(echo)).toContain('AIKI_DATA_DIR=absent');
 now += 6 * 60_000; await mcp.stopIdle();
 expect((await mcp.view('stdio')).status).toBe('disconnected');
 expect(await call(echo)).toContain('synthetic result');
 expect((await readFile(spawnFile, 'utf8')).trim().split('\n')).toHaveLength(2);
 expect(await call(crash)).toContain('Do not automatically retry writes');
 await new Promise(resolve => setTimeout(resolve, 1100));
 expect((await mcp.view('stdio')).status).toBe('connected');
 const pids = (await readFile(spawnFile, 'utf8')).trim().split('\n').map(Number);
 expect(pids).toHaveLength(3);
 expect(logs.join('\n')).not.toContain(secret);
 await mcp.disconnect('stdio');
 await new Promise(resolve => setTimeout(resolve, 600));
 expect((await readFile(spawnFile, 'utf8')).trim().split('\n')).toHaveLength(3);
 expect((await client.request({ ...input, replace: true })).type).toBe('error');
 await mcp.refresh('stdio');
 await mcp.setPolicy('stdio', 'echo', 'ask');
 expect(await call(echo)).toContain('approval requested');
 const question = (await runtime.board.state()).questions.find(question => question.status === 'open')!;
 await runtime.board.answer({ questionId: question.id, expectedRevision: question.revision, answer: 'Approve once' });
 await mcp.add({ serverId: 'stdio', name: 'Updated synthetic command', command, env: { DEMO_SECRET: 'synthetic-replaced-secret', SPAWN_FILE: spawnFile }, confirmed: true, replace: true });
 expect((await mcp.view('stdio')).envNames).toContain('DEMO_SECRET');
 expect((await mcp.view('stdio')).stderrTail).toBe('');
 await mcp.refresh('stdio'); await mcp.setPolicy('stdio', 'echo', 'ask');
 const replacementEcho = (await runtime.conversation.agent(BACKGROUND_CONTEXT)).callable.find(tool => tool.name === 'mcp__stdio__echo')!;
 expect(await call(replacementEcho)).toContain('approval requested');
 const lastPid = Number((await readFile(spawnFile, 'utf8')).trim().split('\n').at(-1));
 await mcp.close(); expect(() => process.kill(lastPid, 0)).toThrow();
 } finally { client.close(); await test.cleanup(); }
}, 20_000);

it('discovers command tools lazily via codemode searchTools and describeTool without exposing env in prompts', async () => {
 const test = await createSetup(); const client = await TestClient.open(test.server);
 try {
 await client.hello();
 const added = await client.request({type:'projects.add',path:test.projectDir}); if (added.type !== 'projects.add') throw new Error('project');
 const id = added.project.id;
 await client.request({type:'projects.configure',projectId:id,coordinatorModel:{provider:'faux',modelId:'faux-1'}});
 const mcp = test.server.manager.mcp!;
 await mcp.add({serverId:'lazy',name:'Lazy',command:{command:process.execPath,args:[join(import.meta.dir,'fixtures/mcp-stdio.ts')]},env:{DEMO_SECRET:'synthetic-lazy-secret'},confirmed:true});
 await mcp.setProject(id,[{serverId:'lazy',enabled:true,roles:['coordinator']}]);
 test.faux.setResponses([
 request => { expect(JSON.stringify(request)).not.toContain('synthetic-lazy-secret'); return fauxAssistantMessage([fauxToolCall('codemode',{code:'const found = await searchTools("echo",{namespace:"lazy",limit:1}); const description = await describeTool(found[0].name); return {description, called:await tools[found[0].name]({})};'})],{stopReason:'toolUse'}); },
 fauxAssistantMessage('lazy done')
 ]);
 const view = new ViewClient(client); await view.start(id);
 await client.request({type:'conversation.submit',projectId:id,requestId:'lazy-test',content:'Discover and call synthetic tools'});
 const result = await view.waitForView(value=>value.entries.some(entry=>entry.kind==='pi.tool-result' && entryText(entry).includes('synthetic result')));
 expect(JSON.stringify(result)).not.toContain('synthetic-lazy-secret');
 expect((await mcp.view('lazy')).status).toBe('connected');
 } finally {client.close();await test.cleanup();}
},20_000);

it('backs off repeated startup crashes and cancels restart timers when idle', async () => {
 let now = Date.now(); const test = await createSetup({ now: () => now });
 const mcp = test.server.manager.mcp!; const spawnFile = join(test.root, 'crash-spawns');
 try {
 await mcp.add({ serverId: 'crashing', name: 'Crashing synthetic', command: { command: process.execPath, args: [join(import.meta.dir, 'fixtures/mcp-stdio.ts'), '--crash-on-start'] }, env: { SPAWN_FILE: spawnFile }, confirmed: true });
 expect((await mcp.refresh('crashing')).status).toBe('error');
 await new Promise(resolve => setTimeout(resolve, 1850));
 expect((await readFile(spawnFile, 'utf8')).trim().split('\n')).toHaveLength(3);
 now += 6 * 60_000; await mcp.stopIdle();
 await new Promise(resolve => setTimeout(resolve, 2200));
 expect((await readFile(spawnFile, 'utf8')).trim().split('\n')).toHaveLength(3);
 expect((await mcp.view('crashing')).status).toBe('disconnected');
 } finally { await test.cleanup(); }
}, 10_000);

it('keeps disconnect intent across backend restart and rejects NUL process settings', async () => {
 const test = await createSetup(); let mcp = test.server.manager.mcp!;
 try {
 const input = { serverId: 'saved', name: 'Saved command', command: { command: process.execPath, args: [join(import.meta.dir, 'fixtures/mcp-stdio.ts')] }, confirmed: true };
 await expect(mcp.add({ ...input, command: { command: 'bun\0bad', args: [] } })).rejects.toThrow('Invalid MCP command');
 await expect(mcp.add({ ...input, env: { KEY: 'bad\0value' } })).rejects.toThrow('Invalid MCP environment');
 await mcp.add(input); await mcp.refresh('saved'); await mcp.disconnect('saved');
 await test.restart(); mcp = test.server.manager.mcp!; await mcp.list();
 expect(JSON.parse(await readFile(mcp.path, 'utf8')).servers[0].active).toBe(false);
 } finally { await test.cleanup(); }
}, 10_000);
