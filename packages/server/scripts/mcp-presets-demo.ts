/** Synthetic T157 proof fixture: registered client, no DCR, faux coordinator. */
import { MCP_PRESETS } from '@aiki/protocol';
import { fauxAssistantMessage } from '@earendil-works/pi-ai/providers/faux';
import { createSetup, TestClient } from '../test/support.ts';
import { startServer } from '../src/server.ts';
import { fakeMcpOAuth } from '../test/mcp-oauth-support.ts';
const origin = process.env.MCP_WEB_ORIGIN ?? 'http://localhost:5189';
const output = process.env.MCP_DEMO_OUTPUT ?? '/tmp/mcp-presets-demo.json';
const setup = await createSetup({ allowedOrigins: [origin], terminals: false });
let server = setup.server;
if (process.env.MCP_DEMO_PORT) {
 await server.stop();
 server = await startServer({ dataDir: setup.dataDir, port: Number(process.env.MCP_DEMO_PORT), models: setup.models, credentials: setup.credentials, agentDir: setup.agentDir, configDir: setup.configDir, claudeDir: setup.claudeDir, allowedOrigins: [origin], terminals: false, images: null, auth: { mode: 'off' }, notifications: { fcmKeyFile: null, relayEndpoint: null }, log: () => {} });
}
const peer = fakeMcpOAuth(true, { manualConsent: true, registeredClient: { id: 'synthetic-pasted-app', secret: 'synthetic-app-secret' } });
peer.noRegistration();
Object.assign(MCP_PRESETS.find(p => p.id === 'slack')!, { url: peer.url, description: 'Synthetic Slack fixture: paste a registered app ID and optional secret. No real account or service is contacted.' });
const client = await TestClient.open(server); await client.hello();
const added = await client.request({ type: 'projects.add', path: setup.projectDir });
if (added.type !== 'projects.add') throw new Error('Missing synthetic project');
await client.request({ type: 'projects.configure', projectId: added.project.id, name: 'MCP sample project', coordinatorModel: { provider: 'faux', modelId: 'faux-1' } });
setup.faux.setResponses(Array.from({ length: 8 }, () => fauxAssistantMessage('Synthetic coordinator received the CLI setup request. No software or account was changed.')));
await Bun.write(output, JSON.stringify({ url: server.url, projectId: added.project.id, mcpUrl: peer.url, issuer: peer.issuer, pid: process.pid }));
console.log(JSON.stringify({ pid: process.pid, root: setup.root, output }));
let closing = false;
async function close() { if (closing) return; closing = true; client.close(); await peer.close(); await server.stop(); await setup.cleanup(); process.exit(0); }
process.on('SIGTERM', () => void close()); process.on('SIGINT', () => void close());
await new Promise(() => {});
