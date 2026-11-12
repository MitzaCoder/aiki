/** Synthetic MCP web fixture. Run from the repository root with Bun; no installed data or accounts. */
import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context';
import { BoardDoc } from '../src/board.ts';
import { createSetup, TestClient } from '../test/support.ts';
import { fakeMcpServer, notionSizedTools } from '../test/mcp-support.ts';

const origin = process.env.MCP_WEB_ORIGIN ?? 'http://localhost:5186';
const output = process.env.MCP_DEMO_OUTPUT ?? '/tmp/mcp-web-demo.json';
const setup = await createSetup({ allowedOrigins: [origin], terminals: false });
console.log(JSON.stringify({ pid: process.pid, root: setup.root, dataDir: setup.dataDir,
  projectDir: setup.projectDir, agentDir: setup.agentDir, configDir: setup.configDir, claudeDir: setup.claudeDir }));
const token = 'synthetic-mcp-demo-token';
const peer = fakeMcpServer(token);
const tools = notionSizedTools();
tools[1]!.annotations = { readOnlyHint: false };
tools[2]!.annotations = { destructiveHint: true };
tools[0]!.description = 'Synthetic page search. <a href="https://example.test">Untrusted plain text</a> ' + 'Catalogue metadata. '.repeat(80);
peer.setTools(tools);
const client = await TestClient.open(setup.server);
await client.hello();
const added = await client.request({ type: 'projects.add', path: setup.projectDir });
if (added.type !== 'projects.add') throw new Error(JSON.stringify(added));
const projectId = added.project.id;
await client.request({ type: 'projects.configure', projectId, name: 'MCP sample project' });
const { runtime } = await setup.server.manager.open(projectId);
await runtime.harness.commit(async tx => {
  const board = await tx.doc(BoardDoc, runtime.conversation.id);
  board.questions.push({ id: 'Q1', revision: 1, kind: 'question',
    text: 'MCP approval: sample / notion_tool_1\nExact arguments:\n' + JSON.stringify({ page: 'synthetic-page', content: 'LongExactArgument'.repeat(45) }),
    options: ['Approve once', 'Always allow this tool', 'Deny'], taskId: null, status: 'open', answer: null,
    askedAt: new Date().toISOString(), answeredAt: null, threadId: 'main' });
  board.counters.question = 1;
}, BACKGROUND_CONTEXT);
await Bun.write(output, JSON.stringify({ url: setup.server.url, projectId, mcpUrl: peer.url, token, pid: process.pid }));
console.log(`Synthetic MCP fixture ready: ${output}`);
let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  client.close();
  await peer.close();
  await setup.cleanup();
  process.exit(0);
}
process.on('SIGTERM', close);
process.on('SIGINT', close);
await new Promise(() => {});
