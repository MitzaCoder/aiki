/** Synthetic OAuth settings fixture. No installed credentials, real issuer or Notion requests. */
import { writeFile } from 'node:fs/promises';
import { MCP_PRESETS } from '@kemiri/protocol';
import { createSetup } from '../test/support.ts';
import { fakeMcpOAuth } from '../test/mcp-oauth-support.ts';
import { authSecret } from '../src/device-auth.ts';
const origin = process.env.MCP_WEB_ORIGIN ?? 'http://localhost:5186';
const output = process.env.MCP_OAUTH_DEMO_OUTPUT ?? '/tmp/mcp-oauth-web-demo.json';
const test = await createSetup({ auth: { mode: 'required' }, allowedOrigins: [origin], terminals: false });
const fake = fakeMcpOAuth(true, { manualConsent: true });
// Override the preset only inside this throwaway process: the actual settings Add flow
// reads backend-provided metadata and can never contact real Notion during the demo.
Object.assign(MCP_PRESETS.find(p => p.id === 'notion')!, { name: 'Synthetic Notion', url: fake.url });
const grant = test.server.auth.bootstrap();
const result = await test.server.auth.redeem({ grantId: grant.requestId, secret: grant.secret,
  claimId: crypto.randomUUID(), claimSecret: authSecret('aiki_c1'), label: 'Synthetic browser', platform: 'web' }, 'loopback', true);
const session = result.credentials!;
const fixture = { pid: process.pid, origin, url: test.server.url, issuer: fake.issuer,
  backends: [{ id: 'synthetic', name: 'Synthetic OAuth backend', url: test.server.url }],
  credential: { backendId: session.backendId, origin: test.server.url, advertised: true, session: {
    sessionId: session.sessionId, sessionToken: session.sessionToken, sessionExpiresAt: session.sessionExpiresAt, rotateAfter: session.rotateAfter,
  } },
};
await writeFile(output, JSON.stringify(fixture), { mode: 0o600 });
console.log(JSON.stringify({ pid: process.pid, root: test.root, dataDir: test.dataDir, projectDir: test.projectDir,
  agentDir: test.agentDir, configDir: test.configDir, claudeDir: test.claudeDir, fixture: output }));
let closing = false;
async function close() {
  if (closing) return; closing = true;
  await fake.close(); await test.cleanup(); process.exit(0);
}
process.on('SIGTERM', () => void close()); process.on('SIGINT', () => void close());
setTimeout(() => void close(), 20 * 60_000);
