/** Synthetic installed-release rehearsal. Never point this at an existing user's installation.
 * Build v0.1.0-pilot.2-test (source) and v0.1.0-pilot.3-test (binary) first.
 * --home must be below the OS temporary directory and contain the published pilot.2 install.
 * Uses only fake models; serves local assets, never changes a host service.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { TestClient } from '../test/support.ts';
import type { HarnessServer } from '../src/server.ts';
const args = process.argv.slice(2);
const option = (name: string) => args.includes(name) ? args[args.indexOf(name) + 1] : undefined;
const home = resolve(option('--home') ?? '');
const assets = resolve(option('--assets') ?? '');
if (!home.startsWith(resolve(tmpdir()) + '/') || !args.includes('--home') || !args.includes('--assets')) throw new Error('Pass an owned temporary --home and --assets directory');
const root = join(home, 'install');
const launcher = join(home, '.local/bin/aiki');
const baseline = 'v0.1.0-pilot.2-test', target = 'v0.1.0-pilot.3-test', broken = 'v0.1.0-pilot.4-broken';
const url = 'http://127.0.0.1:18439';
const env = { HOME: home, PATH: process.env.PATH!, AIKI_PORT: '18439' };
const digest = (body: Uint8Array | string) => new Bun.CryptoHasher('sha256').update(body).digest('hex');
const bad = `#!/bin/sh\nif [ "$1" = --version ]; then echo 'Aiki ${broken}'; exit 0; fi\necho 'Synthetic startup failure' >&2\nexit 42\n`;
let supervisor: ReturnType<typeof Bun.spawn> | undefined;
async function run(command: string[]) {
 const child = Bun.spawn(command, { env, stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' });
 const [code, out, err] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
 if (code) throw new Error(out + err);
 return out;
}
async function owner(command: string[]) {
 const response = await fetch('http://localhost/', { unix: join(root, 'data/auth.sock'), method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ args: command }), signal: AbortSignal.timeout(2000) });
 if (!response.ok) throw new Error('Owner request failed');
 return response.json();
}
async function stop() {
 if (!supervisor || supervisor.exitCode !== null) return;
 supervisor.kill('SIGTERM'); await supervisor.exited;
}
function seed(version: string) {
 writeFileSync(join(root, 'data/release-updates.json'), JSON.stringify({ enabled: true, dismissedVersion: null, nextCheckAt: Date.now() + 86_400_000, etag: null, stable: null, pilot: { version, notesUrl: `https://github.com/MitzaCoder/aiki/releases/tag/${version}` } }), { mode: 0o600 });
}
async function start() {
 supervisor = Bun.spawn([launcher, 'start'], { env, stdin: 'ignore', stdout: Bun.file(join(home, 'rehearsal-server.log')), stderr: Bun.file(join(home, 'rehearsal-server-error.log')) });
 for (let i = 0; i < 100; i++) {
  try { await owner(['health-check', JSON.stringify({ type: 'server.status', id: 'demo-health' })]); return; } catch { await Bun.sleep(100); }
 }
 throw new Error('Rehearsal server did not start');
}
let client: TestClient | undefined;
const feed = Bun.serve({ hostname: '127.0.0.1', port: 18440, async fetch(request) {
 const path = new URL(request.url).pathname;
 if (path === '/idle') { writeFileSync(join(home, 'release-agents'), 'done'); return new Response('Synthetic agents released'); }
 if (path === '/prepare-broken') {
  client?.close(); await stop(); seed(broken); await start(); return new Response('Broken candidate available');
 }
 if (path.startsWith(`/releases/${broken}/`)) {
  const name = `aiki-${broken}-linux-x64`;
  if (path.endsWith('/' + name)) return new Response(bad);
  if (path.endsWith('/' + name + '.sha256') || path.endsWith('/SHA256SUMS')) return new Response(`${digest(bad)}  ${name}\n`);
 }
 if (path.startsWith(`/releases/${target}/`)) {
  const name = `aiki-${target}-linux-x64`;
  const file = Bun.file(join(assets, name));
  if (path.endsWith('/' + name)) return new Response(file);
  if (path.endsWith('/' + name + '.sha256') || path.endsWith('/SHA256SUMS')) return new Response(`${digest(new Uint8Array(await file.arrayBuffer()))}  ${name}\n`);
 }
 return new Response('No synthetic asset', { status: 404 });
} });
try {
 const installed = JSON.parse(readFileSync(join(root, '.aiki-install.json'), 'utf8'));
 if (installed.version !== baseline) await run([launcher, 'update', '--version', baseline, '--archive', join(assets, `aiki-${baseline}.tar.gz`), '--runtime', 'bun']);
 // Only this explicitly synthetic source baseline is modified to install the held faux model.
 // The target is the unmodified checksum-verified production binary built from the workspace.
 const entry = join(root, 'current/packages/server/src/main.ts');
 let source = readFileSync(entry, 'utf8');
 if (!source.includes('syntheticSelfUpdateFaux')) {
  source = source.replace('const server = await startServer({', `const { fauxProvider, fauxAssistantMessage } = await import('@earendil-works/pi-ai/providers/faux');
  const { createModels } = await import('@earendil-works/pi-ai');
  const { FileCredentialStore } = await import('./credentials.ts');
  const syntheticSelfUpdateFaux = fauxProvider();
  syntheticSelfUpdateFaux.setResponses(Array.from({length:30},()=>async (_request: unknown, options?: {signal?: AbortSignal}) => {
   while (!options?.signal?.aborted && !await Bun.file(${JSON.stringify(join(home, 'release-agents'))}).exists()) await Bun.sleep(100);
   return fauxAssistantMessage('Synthetic session finished.');
  }));
  const syntheticModels = createModels({credentials:new FileCredentialStore(resolveDataDir() + '/credentials.json')});
  syntheticModels.setProvider(syntheticSelfUpdateFaux.provider);
  const server = await startServer({ models:syntheticModels,`);
  writeFileSync(entry, source);
 }
 await mkdir(join(home, 'agent'), { recursive: true }); await mkdir(join(home, 'claude'), { recursive: true });
 writeFileSync(join(root, 'config/server.env'), `AIKI_PORT=18439\nAIKI_TIMEZONE=UTC\nAIKI_AGENT_DIR=${join(home, 'agent')}\nAIKI_CLAUDE_DIR=${join(home, 'claude')}\nAIKI_ALLOWED_ORIGINS=${url},http://localhost:18439\nAIKI_RELEASE_BASE_URL=http://127.0.0.1:18440/releases\n`, { mode: 0o600 });
 seed(target); await rm(join(home, 'release-agents'), { force: true }); await start();
 const grant = await owner(['pair', '--local']) as { code: string; url: string };
 const code = new URL(grant.url).hash.slice('#bootstrap='.length);
 const redeemed = await fetch(url + '/auth/bootstrap/redeem', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ requestId: 'local', code, claimId: crypto.randomUUID(), claimSecret: 'aiki_c1.' + Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url'), label: 'Synthetic rehearsal browser', platform: 'web' }) }).then(response => response.json()) as { credentials: Record<string, string> };
 const session = redeemed.credentials;
 if (!session?.sessionToken) throw new Error('Synthetic enrollment failed');
 const fixture = { url, origin: url, credential: { backendId: session.backendId, origin: url, advertised: true, session: { sessionId: session.sessionId, sessionToken: session.sessionToken, sessionExpiresAt: session.sessionExpiresAt, rotateAfter: session.rotateAfter } } };
 writeFileSync(join(home, 'fixture.json'), JSON.stringify(fixture), { mode: 0o600 });
 client = await TestClient.open({ url } as HarnessServer);
 await client.request({ type: 'hello', protocolVersion: 1, auth: { accessToken: session.accessToken } });
 for (const name of ['Paper garden', 'Tiny observatory']) {
  const path = join(home, name.toLowerCase().replaceAll(' ', '-')); await mkdir(path, { recursive: true });
  writeFileSync(join(path, 'README.md'), '# Synthetic project\n');
  const added = await client.request({ type: 'projects.add', path });
  if (added.type !== 'projects.add') throw new Error(JSON.stringify(added));
  const projectId = added.project.id;
  await client.request({ type: 'projects.configure', projectId, name, coordinatorModel: { provider: 'faux', modelId: 'faux-1' } });
  const submitted = await client.request({ type: 'conversation.submit', projectId, requestId: crypto.randomUUID(), content: [{ type: 'text', text: 'Wait quietly for the synthetic rehearsal to finish.' }] });
  if (submitted.type === 'error') throw new Error(JSON.stringify(submitted));
 }
 console.log(JSON.stringify({ home, root, url, fixture: join(home, 'fixture.json'), controls: 'http://127.0.0.1:18440', pid: process.pid }));
 let closing = false;
 const close = async () => { if (closing) return; closing = true; client?.close(); await stop(); await feed.stop(true); process.exit(0); };
 process.on('SIGTERM', () => void close()); process.on('SIGINT', () => void close());
} catch (error) { client?.close(); await stop(); await feed.stop(true); throw error; }
