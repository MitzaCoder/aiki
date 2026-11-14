/** Dedicated Chromium + skills-web-demo.ts + Vite. Phase before captures the unchanged settings list. */
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { connectChromiumPage } from '../../../apps/web/scripts/chromium-page.ts';
const origin = process.env.SKILLS_WEB_ORIGIN ?? 'http://localhost:5291';
const cdp = process.env.SKILLS_CDP ?? 'http://localhost:9491';
const output = process.env.SKILLS_PROOF_OUTPUT ?? '/tmp/skills-web-proof';
const phase = process.env.SKILLS_PROOF_PHASE ?? 'after';
const fixture = await Bun.file(process.env.SKILLS_DEMO_OUTPUT ?? '/tmp/skills-web-demo.json').json() as { url: string; projectId: string };
await mkdir(output, { recursive: true });
const page = await connectChromiumPage(cdp);
await page.call('Page.enable');
await page.call('Runtime.enable');
await page.call('Page.addScriptToEvaluateOnNewDocument', { source: `localStorage.setItem('aiki.backends.v1',${JSON.stringify(JSON.stringify([{ id: 'demo', name: 'Skills demo', url: fixture.url }]))});` });
async function waitFor(text: string) {
  const deadline = Date.now() + 25000;
  while (Date.now() < deadline) {
    // Re-evaluate after navigation; a MutationObserver in the old document can survive in bfcache.
    if (await page.run(text => document.body?.innerText.includes(text), text)) return;
    await Bun.sleep(150);
  }
  throw new Error('Missing UI text: ' + text);
}
const settle = () => Bun.sleep(450);
const path = `/b/demo/projects/${fixture.projectId}/settings`;
for (const form of ['desktop', 'phone']) for (const mode of ['light', 'dark']) {
  await page.call('Emulation.setDeviceMetricsOverride', { width: form === 'phone' ? 390 : 1440, height: form === 'phone' ? 844 : 1100, deviceScaleFactor: 1, mobile: form === 'phone' });
  await page.call('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: mode }] });
  await page.call('Page.navigate', { url: origin + path + (phase === 'before' ? '' : '/skills') });
  await waitFor(phase === 'before' ? 'General' : 'seed-garden');
  await page.run(mode => document.documentElement.classList.toggle('dark', mode === 'dark'), mode);
  await settle();
  const overflow = await page.run(() => document.documentElement.scrollWidth > innerWidth);
  if (overflow) throw new Error('Horizontal overflow: ' + form + '/' + mode);
  const hasEntry = await page.run(() => !!document.querySelector('a[href$="/settings/skills"]'));
  if (phase === 'before' && hasEntry) throw new Error('Before screen already has Skills');
  const shot = await page.call<{ data: string }>('Page.captureScreenshot', { format: 'png' });
  await Bun.write(join(output, `${phase}-skills-${form}-${mode}.png`), Buffer.from(shot.data, 'base64'));
}
if (phase !== 'before') {
  await page.run(() => {
    const target = document.querySelector<HTMLElement>('[role="switch"][aria-label="Offer seed-garden"]');
    if (!target) throw new Error('Missing switch');
    target.scrollIntoView({ block: 'center' });
  });
  const frames = join(output, 'toggle-frames');
  await mkdir(frames, { recursive: true });
  let count = 0;
  const writes: Promise<unknown>[] = [];
  page.onFrame = frame => {
    writes.push(Bun.write(join(frames, String(count++).padStart(5, '0') + '.jpg'), Buffer.from(frame.data, 'base64')));
    void page.call('Page.screencastFrameAck', { sessionId: frame.sessionId });
  };
  await page.call('Page.startScreencast', { format: 'jpeg', quality: 85, maxWidth: 1440, maxHeight: 1100 });
  // Fixed sample cadence preserves real interaction timing even when the screen is still.
  const capture = async () => {
    const frame = await page.call<{ data: string }>('Page.captureScreenshot', { format: 'jpeg' });
    writes.push(Bun.write(join(frames, String(count++).padStart(5, '0') + '.jpg'), Buffer.from(frame.data, 'base64')));
  };
  for (let sample = 0; sample < 4; sample++) { await Bun.sleep(250); await capture(); }
  for (const offered of [false, true]) {
    await page.run(() => document.querySelector<HTMLElement>('[role="switch"][aria-label="Offer seed-garden"]')!.click());
    for (let sample = 0; sample < 8; sample++) { await Bun.sleep(250); await capture(); }
    const state = await page.run(() => {
      const row = document.querySelector('[data-skill="seed-garden"]');
      return { checked: row?.querySelector('[role="switch"]')?.getAttribute('aria-checked'), isNew: row?.textContent?.includes('New') };
    });
    if (state.checked !== String(offered) || state.isNew) throw new Error('Toggle/New failed: ' + JSON.stringify(state));
  }
  await page.call('Page.stopScreencast'); page.onFrame = undefined; await Promise.all(writes);
  const encoder = Bun.spawn(['ffmpeg', '-y', '-loglevel', 'error', '-framerate', String(count / 5), '-i', join(frames, '%05d.jpg'), '-vf', 'pad=ceil(iw/2)*2:ceil(ih/2)*2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', join(output, 'skills-toggle-phone-dark.mp4')], { stdout: 'ignore', stderr: 'pipe' });
  const timeout = setTimeout(() => encoder.kill(), 30000);
  const code = await encoder.exited; clearTimeout(timeout);
  if (code !== 0) throw new Error(await new Response(encoder.stderr).text());
  await rm(frames, { recursive: true, force: true });
  // Read-only details, the hidden duplicate, the pre-decided Off row and footer.
  await page.run(() => {
    const row = document.querySelector('[data-skill="cloud-notes"]');
    const details = row?.querySelector('details');
    if (!details) throw new Error('Missing hidden-path details');
    details.open = true;
    row!.scrollIntoView({ block: 'start' });
  });
  await settle();
  const detailsShot = await page.call<{ data: string }>('Page.captureScreenshot', { format: 'png' });
  await Bun.write(join(output, 'after-skills-details-phone-dark.png'), Buffer.from(detailsShot.data, 'base64'));
  await page.call('Page.navigate', { url: origin + `/b/demo/projects/${fixture.projectId}?tab=info` });
  await Bun.sleep(1500);
  await waitFor('Send a message to start the coordinator.');
  await page.run(() => document.querySelector<HTMLElement>('[aria-label="More actions"]')?.click());
  await waitFor('Info');
  await page.run(() => {
    const info = document.querySelector<HTMLElement>('[aria-label="Conversation info"]');
    if (!info) throw new Error('Missing Info button');
    info.click();
  });
  await waitFor("1 skills held back by this project's settings");
  await page.run(() => document.querySelector('[data-context-section="skills"]')?.scrollIntoView({ block: 'center' }));
  await settle();
  const infoShot = await page.call<{ data: string }>('Page.captureScreenshot', { format: 'png' });
  await Bun.write(join(output, 'after-skills-info-phone-dark.png'), Buffer.from(infoShot.data, 'base64'));
  console.log('Verified off/on persistence, New removed, hidden paths and Info count');
}
page.close();
console.log('Captured ' + phase + ' matrix: ' + output);
