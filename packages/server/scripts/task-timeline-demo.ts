/** Varied synthetic history for task-sheet UI proof. Uses only createSetup throwaway storage. */
import { createSetup, TestClient, ViewClient } from '../test/support.ts';
import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context';
import { BoardDoc, TaskHistoryDoc } from '../src/board.ts';
import type { BoardTimelineEntry } from '@kemiri/protocol';

const test = await createSetup({ allowedOrigins: [process.env.TIMELINE_WEB_ORIGIN ?? 'http://localhost:5188'], terminals: false });
console.log(JSON.stringify({ dataDir: test.dataDir, configDir: test.configDir, projectDir: test.projectDir, pid: process.pid }));
const client = await TestClient.open(test.server);
await client.hello();
const added = await client.request({ type: 'projects.add', path: test.projectDir });
if (added.type !== 'projects.add') throw new Error('Could not create synthetic project');
const projectId = added.project.id;
await client.request({ type: 'projects.configure', projectId, name: 'Timeline studio', coordinatorModel: { provider: 'faux', modelId: 'faux-1' } });
const view = new ViewClient(client);
await view.start(projectId);
const { runtime } = await test.server.manager.open(projectId);
const task = await runtime.board.saveTask({ task: { title: 'Prepare the miniature observatory', description: 'Synthetic task for timeline reading and scrolling.', acceptance: null, refs: [], status: 'in_progress', blockedBy: [], blockedReason: null, writeScopes: [] } }, 'coordinator');
const samples: Omit<BoardTimelineEntry, 'at'>[] = [
    { kind: 'status', label: 'todo → in_progress', by: { author: 'coordinator', threadId: 'main', workerId: null } },
    { kind: 'worker', label: 'Worker lens started', ref: 'lens', by: { author: 'coordinator', threadId: 'main', workerId: null } },
    { kind: 'question', label: 'Question Q1', detail: 'Which finish should the carrying case use?' },
    { kind: 'question', label: 'Q1 answered', detail: 'Use the soft matte finish.', by: { author: 'user', threadId: null, workerId: null } },
    { kind: 'decision', label: 'Decision D1', detail: 'Choose a matte finish — it avoids reflections during night viewing.' },
    { kind: 'feedback', label: 'Feedback F1', detail: 'Please keep the star labels readable at small sizes.\nCheck the map in both day and night colours.', by: { author: 'user', threadId: null, workerId: null } },
    { kind: 'worker', label: 'Worker lens failed', detail: 'The sample alignment check failed. The fixture needs recalibration.', by: { author: 'worker', threadId: 'main', workerId: 'lens' } },
    { kind: 'link', label: 'Related to T2', ref: 'T2', by: { author: 'coordinator', threadId: 'main', workerId: null } },
    { kind: 'milestone', label: 'First night-colour preview', detail: 'The first miniature star map is ready.\n\nChecked label spacing, the lens outline and all twelve constellation markers.\n\nNext, review contrast and the carrying case before packing.', by: { author: 'coordinator', threadId: 'main', workerId: null } },
    { kind: 'worker', label: 'Worker lens reported', detail: 'Recalibrated the sample fixture. All alignment checks now pass.', by: { author: 'worker', threadId: 'main', workerId: 'lens' } },
    { kind: 'feedback', label: 'F1 → addressed', detail: 'Added larger labels and checked both palettes.', by: { author: 'coordinator', threadId: 'main', workerId: null } },
    { kind: 'status', label: 'in_progress → review', by: { author: 'coordinator', threadId: 'main', workerId: null } },
];
await runtime.harness.commit(async tx => {
    const history = await tx.doc(TaskHistoryDoc, runtime.conversation.id, task.id, null);
    history.events = Array.from({ length: 48 }, (_, index) => ({ ...samples[index % samples.length]!, at: new Date(Date.now() - (47 - index) * 90 * 60_000).toISOString() }));
    history.feedback = [{ id: 'F1', at: new Date().toISOString(), text: 'Keep the star labels readable at small sizes.', threadId: 'main', state: 'open', note: null, updatedAt: new Date().toISOString(), changes: [] }];
    history.revision = 1;
    const board = await tx.doc(BoardDoc, runtime.conversation.id);
    const saved = board.tasks.find(candidate => candidate.id === task.id)!;
    saved.feedback = { open: 1, handling: 0, addressed: 0, dismissed: 0 };
    saved.report.now = 'Reviewing the night-colour preview.';
    saved.report.next = 'Check contrast, then pack the carrying case.';
    saved.timelineRevision = 1;
}, BACKGROUND_CONTEXT);
await Bun.write(process.env.TIMELINE_DEMO_OUTPUT ?? '/tmp/task-timeline-demo.json', JSON.stringify({ url: test.server.url, projectId, taskId: task.id, pid: process.pid }));
process.on('SIGTERM', async () => { client.close(); await test.cleanup(); process.exit(0); });
await new Promise(() => {});
