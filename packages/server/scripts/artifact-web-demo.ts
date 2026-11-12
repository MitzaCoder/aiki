/** Isolated synthetic artifact fixture: symlinked temporary sources, no accounts or installed data. */
import { mkdir, symlink, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createSetup, TestClient } from '../test/support.ts';
import { resolveArtifactSource } from '../src/artifact-tools.ts';
import { authSecret } from '../src/device-auth.ts';

const origin = 'http://localhost:5189';
const installed = process.env.ARTIFACT_DEMO_INSTALLED === '1';
const setup = await createSetup({ allowedOrigins: installed ? [] : [origin], ...(installed ? { webDir: join(import.meta.dir, '../../../apps/web/build'), auth: { mode: 'required' as const } } : {}), terminals: false, log: console.log });
console.log(JSON.stringify({ pid: process.pid, root: setup.root, dataDir: setup.dataDir, projectDir: setup.projectDir, agentDir: setup.agentDir, configDir: setup.configDir, claudeDir: setup.claudeDir, tmpdir: tmpdir() }));
const client = await TestClient.open(setup.server);
let credential;
if (installed) {
  const grant = setup.server.auth.bootstrap();
  const result = await setup.server.auth.redeem({ grantId: grant.requestId, secret: grant.secret, claimId: crypto.randomUUID(), claimSecret: authSecret('aiki_c1'), label: 'Synthetic browser', platform: 'web' }, 'loopback', true);
  const session = result.credentials!;
  credential = { backendId: session.backendId, origin: setup.server.url, advertised: true, session: { sessionId: session.sessionId, sessionToken: session.sessionToken, sessionExpiresAt: session.sessionExpiresAt, rotateAfter: session.rotateAfter } };
  await client.request({ type: 'hello', protocolVersion: 1, auth: { accessToken: session.accessToken } });
} else await client.hello();
const added = await client.request({ type: 'projects.add', path: setup.projectDir });
if (added.type !== 'projects.add') throw new Error(JSON.stringify(added));
const projectId = added.project.id;
await client.request({ type: 'projects.configure', projectId, name: 'Artifact sample project' });
const task = await client.request({ type: 'board.task.save', projectId, task: { title: 'Read the sample report', description: '', acceptance: null, status: 'todo', blockedBy: [], blockedReason: null, writeScopes: [] } });
if (task.type !== 'board.task.save') throw new Error(JSON.stringify(task));
const real = join(setup.root, 'private', 'var', 'folders', 'sample', 'T');
await mkdir(real, { recursive: true });
await symlink(join(setup.root, 'private', 'var'), join(setup.root, 'var'));
const sources = join(setup.root, 'var', 'folders', 'sample', 'T');
const text = '# Sample skill evaluation\n\nSynthetic report for artifact transport testing.\n\n' + '## Findings\n\nThe temporary source is copied into the artifact store. Unicode: café ✓.\n\n'.repeat(160);
const artifacts = [];
for (const extension of ['md', 'txt', 'html', 'png']) {
  const path = join(sources, 'skill-evaluation-exploration.' + extension);
  await Bun.write(path, extension === 'png' ? Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aDR8AAAAASUVORK5CYII=', 'base64') : text);
  const source = await resolveArtifactSource({ path, cwd: setup.projectDir, projectPath: setup.projectDir, dataDir: setup.dataDir, workspaceDirs: [] });
  if (!source.ok) throw new Error(source.message);
  const artifact = await setup.server.artifacts.save({ projectId, sourcePath: source.path, title: null, note: 'Synthetic transport sample.', threadId: 'main', workerId: null, taskId: task.task.id });
  const answer = await client.request({ type: 'artifacts.url', projectId, artifactId: artifact.id });
  if (answer.type !== 'artifacts.url') throw new Error(JSON.stringify(answer));
  artifacts.push({ ...artifact, url: answer.url });
}
// Prove the viewer reads the durable copy, not the symlinked temporary source.
await rm(join(setup.root, 'private'), { recursive: true });
await Bun.write('/tmp/t149/fixture.json', JSON.stringify({ url: setup.server.url, origin: installed ? setup.server.url.replace('127.0.0.1', 'localhost') : origin, credential, projectId, taskId: task.task.id, artifacts, pid: process.pid }));
console.log('Artifact fixture ready: /tmp/t149/fixture.json');
let closing = false;
async function close() { if (closing) return; closing = true; client.close(); await setup.cleanup(); process.exit(0); }
process.on('SIGTERM', close); process.on('SIGINT', close);
await new Promise(() => {});
