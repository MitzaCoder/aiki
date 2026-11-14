/** Synthetic Skills web fixture. Run with Bun in an isolated HOME; never reads installed accounts. */
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createSetup, TestClient } from '../test/support.ts';

const origin = process.env.SKILLS_WEB_ORIGIN ?? 'http://localhost:5291';
const output = process.env.SKILLS_DEMO_OUTPUT ?? '/tmp/skills-web-demo.json';
const setup = await createSetup({ allowedOrigins: [origin], terminals: false });
async function skill(folder: string, name: string, description: string) {
  const directory = join(folder, name);
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, 'SKILL.md'), `---\nname: ${name}\ndescription: ${description}\n---\n\nSynthetic instructions for ${name}.\n`);
}
for (const [folder, name, description] of [
  [join(setup.agentDir, 'skills'), 'paper-kites', 'Plan a colourful paper kite workshop with a small checklist.'],
  [join(setup.agentDir, 'skills'), 'cloud-notes', 'Collect imaginary cloud observations into a short field notebook.'],
  [join(setup.agentDir, 'skills'), 'tiny-orchard', 'Lay out a miniature orchard using synthetic planting records.'],
  [join(setup.claudeDir, 'skills'), 'cloud-notes', 'A second copy of the cloud notebook instructions.'],
  [join(setup.claudeDir, 'skills'), 'lantern-stories', 'Write a short story about a lantern festival.'],
  [join(setup.root, 'home', '.agents', 'skills'), 'river-maps', 'Draw a fictional river map with made-up place names.'],
  [join(setup.projectDir, '.pi', 'skills'), 'seed-garden', 'Load synthetic seed records into a scratch garden notebook.'],
  [join(setup.projectDir, '.claude', 'skills'), 'ribbon-checks', 'Check the sample ribbon patterns before sharing the collection.'],
  [join(setup.projectDir, '.agents', 'skills'), 'fold-cranes', 'Fold a paper crane with simple step-by-step instructions.'],
]) await skill(folder!, name!, description!);
const client = await TestClient.open(setup.server);
await client.hello();
const added = await client.request({ type: 'projects.add', path: setup.projectDir });
if (added.type !== 'projects.add') throw new Error(JSON.stringify(added));
const projectId = added.project.id;
await client.request({ type: 'projects.configure', projectId, name: 'Paper garden' });
const saved = await client.request({ type: 'skills.project.set', projectId, changes: [{ name: 'tiny-orchard', roles: [] }] });
if (saved.type !== 'skills.project.set') throw new Error(JSON.stringify(saved));
await Bun.write(output, JSON.stringify({ url: setup.server.url, projectId, pid: process.pid, root: setup.root }));
console.log(`Synthetic Skills fixture ready: ${output}`);
let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  client.close();
  await setup.cleanup();
  process.exit(0);
}
process.on('SIGTERM', close);
process.on('SIGINT', close);
await new Promise(() => {});
