/** Fake-only callback proof backend. All paths are createSetup temp dirs; no host credentials. */
import { writeFile } from 'node:fs/promises';
import { createSetup } from '../../../packages/server/test/support.ts';
import { fakeMcpOAuth } from '../../../packages/server/test/mcp-oauth-support.ts';
import { authSecret } from '../../../packages/server/src/device-auth.ts';
const origin = process.argv[2] ?? 'http://127.0.0.1:4199';
const test = await createSetup({ auth: { mode: 'required' }, allowedOrigins: [origin], terminals: false });
const fake = fakeMcpOAuth(true);
await test.server.manager.mcp!.add({ serverId: 'notion', name: 'Synthetic Notion', url: fake.url });
const grant = test.server.auth.bootstrap();
const result = await test.server.auth.redeem({ grantId: grant.requestId, secret: grant.secret,
 claimId: crypto.randomUUID(), claimSecret: authSecret('aiki_c1'), label: 'Synthetic browser', platform: 'web' }, 'loopback', true);
const session = result.credentials!;
const fixture = {
 pid: process.pid, root: test.root, dataDir: test.dataDir, projectDir: test.projectDir, origin,
 backends: [{ id: 'synthetic', name: 'Synthetic OAuth backend', url: test.server.url }],
 credential: { backendId: session.backendId, origin: test.server.url, advertised: true, session: {
  sessionId: session.sessionId, sessionToken: session.sessionToken, sessionExpiresAt: session.sessionExpiresAt, rotateAfter: session.rotateAfter,
 } },
};
const file = process.argv[3] ?? '/tmp/aiki-mcp-oauth-fixture.json';
await writeFile(file, JSON.stringify(fixture), { mode: 0o600 });
console.log(`pid=${process.pid}; root=${test.root}; data=${test.dataDir}; project=${test.projectDir}; fixture=${file}`);
let closing = false;
async function close() { if (closing) return; closing = true; await fake.close(); await test.cleanup(); process.exit(0); }
process.on('SIGTERM', () => void close()); process.on('SIGINT', () => void close());
setTimeout(() => void close(), 20 * 60_000);
