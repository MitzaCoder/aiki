/** Real UI proof against self-update-demo's disposable installed backend. */
import { mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { connectChromiumPage } from '../../../apps/web/scripts/chromium-page.ts';
const args = process.argv.slice(2);
const option = (name: string) => args.includes(name) ? args[args.indexOf(name) + 1] : undefined;
if (!args.includes('--fixture') || !args.includes('--out')) throw new Error('Pass --fixture and --out');
const fixture = await Bun.file(resolve(option('--fixture')!)).json();
const out = resolve(option('--out')!); await mkdir(out, { recursive: true });
const page = await connectChromiumPage(option('--cdp') ?? 'http://127.0.0.1:9393');
await page.call('Page.enable'); await page.call('Runtime.enable');
await page.call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
async function navigate() {
 await page.call('Page.navigate', { url: fixture.origin + '/settings/about' });
 await Bun.sleep(1000);
}
async function waitFor(text: string, timeout = 10_000) {
 const deadline = Date.now() + timeout;
 while (Date.now() < deadline) { if (await page.run(text => document.body?.innerText.includes(text), text)) return; await Bun.sleep(100); }
 throw new Error('Missing ' + text + ': ' + await page.run(() => document.body.innerText.slice(-1800)));
}
async function click(text: string, dialog = false) {
 const clicked = await page.run((text, dialog) => {
  const root = dialog ? document.querySelector('[role="dialog"]') : document.querySelector('[data-release-update-about]') ?? document;
  const button = [...(root?.querySelectorAll('button') ?? [])].find(button => button.innerText.trim() === text && !button.disabled);
  button?.click(); return !!button;
 }, text, dialog);
 if (!clicked) throw new Error('No button ' + text);
 await Bun.sleep(150);
}
async function theme(mode: string) {
 await page.call('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: mode }] });
 await page.run(mode => { document.documentElement.classList.toggle('dark', mode === 'dark'); document.documentElement.style.colorScheme = mode; }, mode);
 await Bun.sleep(180);
}
async function shot(name: string) {
 const image = await page.call<{ data: string }>('Page.captureScreenshot', { format: 'png' });
 await Bun.write(join(out, name + '.png'), Buffer.from(image.data, 'base64'));
 console.log(name);
}
await navigate();
await page.run(async fixture => {
 localStorage.setItem('aiki.backends.v1', JSON.stringify([{ id: 'rehearsal', name: 'Sample installed backend', url: fixture.url }]));
 const credential = fixture.credential;
 const db = await new Promise<IDBDatabase>((resolve, reject) => { const request = indexedDB.open('aiki-device-auth', 1); request.onupgradeneeded = () => request.result.createObjectStore('credentials'); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
 await new Promise<void>((resolve, reject) => { const tx = db.transaction('credentials', 'readwrite'); tx.objectStore('credentials').put(credential, JSON.stringify([credential.backendId, credential.origin])); tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); }); db.close();
}, fixture);
await navigate(); await waitFor('Update now');
if (args.includes('--waiting-proof')) {
 await theme('dark');
 const writes: Promise<unknown>[] = []; const timestamps: number[] = []; let count = 0;
 await mkdir(join(out, 'frames'), { recursive: true });
 page.onFrame = frame => { timestamps.push(frame.metadata.timestamp); writes.push(Bun.write(join(out, 'frames', String(count++).padStart(5, '0') + '.jpg'), Buffer.from(frame.data, 'base64'))); void page.call('Page.screencastFrameAck', { sessionId: frame.sessionId }); };
 await page.call('Page.startScreencast', { format: 'jpeg', quality: 75, maxWidth: 1440, maxHeight: 1000 });
 await fetch('http://127.0.0.1:18440/run' + (args.includes('--long') ? '?long' : ''));
 await Bun.sleep(800);
 await click('Update now'); await click('Confirm update', true);
 await waitFor(args.includes('--before') ? 'agents to finish' : 'Waiting for 1 running command (sleep', 30_000);
 for (const mode of ['light','dark']) { await theme(mode); await shot(`web-desktop-${mode}-waiting-${args.includes('--before') ? 'before' : 'after'}`); }
 if (args.includes('--long') || args.includes('--before')) {
  if (!args.includes('--leave-waiting')) { await click('Cancel'); await waitFor('Update cancelled'); }
 } else {
  await waitFor('Updated to v0.1.0-pilot.3-test', 60_000); await shot('web-desktop-dark-success-after');
 }
 await page.call('Page.stopScreencast'); page.onFrame = undefined; await Promise.all(writes);
 await Bun.write(join(out,'frames.ffconcat'), timestamps.map((timestamp,index)=>`file 'frames/${String(index).padStart(5,'0')}.jpg'\nduration ${index+1<timestamps.length ? Math.max(.04,timestamps[index+1]!-timestamp) : 1}\n`).join(''));
 console.log('Recording frames',count); page.close();
} else if (args.includes('--setup')) {
 for (const mode of ['light', 'dark']) {
  await theme(mode); await shot(`web-desktop-${mode}-button`);
  await click('Update now'); await waitFor('Confirm update'); await shot(`web-desktop-${mode}-confirm`);
  await click('Cancel', true);
 }
 await page.call('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
 await shot('web-phone-dark-button');
 await click('Update now'); await waitFor('Confirm update'); await shot('web-phone-dark-confirm');
 await click('Cancel', true); page.close();
} else {
 page.close(); throw new Error('Pass --setup or --waiting-proof (with the command rehearsal fixture)');
}
