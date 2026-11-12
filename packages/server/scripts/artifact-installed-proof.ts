/** Exact installed-origin regression: page localhost, paired backend 127.0.0.1 on the same port (and reverse). */
import { connectChromiumPage } from '../../../apps/web/scripts/chromium-page.ts';
const fixture = await Bun.file('/tmp/t149/fixture.json').json();
const phase = process.env.ARTIFACT_PROOF_PHASE ?? 'before';
const page = await connectChromiumPage('http://localhost:9389');
const events: unknown[] = [];
page.socket.addEventListener('message', event => {
 const message = JSON.parse(String(event.data));
 if (['Network.loadingFailed', 'Network.responseReceived', 'Network.requestWillBeSent'].includes(message.method) && (message.method === 'Network.loadingFailed' || JSON.stringify(message).includes('/artifacts/'))) events.push(message);
});
await page.call('Page.enable'); await page.call('Network.enable'); await page.call('Runtime.enable');
await page.call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
await page.call('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] });
async function navigate(url: string) {
 await page.call('Page.navigate', { url });
 await page.run(() => new Promise<void>(resolve => { if (document.readyState === 'complete') resolve(); else window.addEventListener('load', () => resolve(), { once: true }); }));
}
async function waitFor(text: string) {
 await page.run(text => new Promise<void>((resolve, reject) => {
  const done = () => { if (document.body?.innerText.includes(text)) { clearTimeout(timer); observer.disconnect(); resolve(); } };
  const observer = new MutationObserver(done); const timer = setTimeout(() => { observer.disconnect(); reject(new Error('Missing text: '+text+'; '+document.body.innerText.slice(-1500))); }, 6500);
  observer.observe(document, { subtree: true, childList: true, characterData: true }); done();
 }), text);
}
async function seed(origin: string, backendUrl: string) {
 await navigate(origin + '/settings');
 await page.run(async (fixture, backendUrl) => {
  localStorage.setItem('aiki.backends.v1', JSON.stringify([{ id: 'demo', name: 'Sample backend', url: backendUrl }]));
  const credential = { ...fixture.credential, origin: backendUrl };
  const db = await new Promise<IDBDatabase>((resolve, reject) => { const request = indexedDB.open('aiki-device-auth', 1); request.onupgradeneeded = () => request.result.createObjectStore('credentials'); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
  await new Promise<void>((resolve, reject) => { const tx = db.transaction('credentials', 'readwrite'); tx.objectStore('credentials').put(credential, JSON.stringify([credential.backendId, credential.origin])); tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); }); db.close();
 }, fixture, backendUrl);
}
await seed(fixture.origin, fixture.url);
await navigate(`${fixture.origin}/b/demo/projects/${fixture.projectId}?task=${fixture.taskId}`);
await waitFor('skill-evaluation-exploration.md');
console.log('Origins', { page: fixture.origin, backend: fixture.url });
console.log('Image without CORS', await page.run(url => new Promise((resolve, reject) => {
 const image = new Image(); const timer = setTimeout(() => reject(new Error('Image timeout')), 4000);
 image.onload = () => { clearTimeout(timer); resolve({ loaded: true, width: image.naturalWidth }); };
 image.onerror = () => { clearTimeout(timer); reject(new Error('Image failed')); }; image.src = url;
}), fixture.artifacts.find((artifact: { kind: string }) => artifact.kind === 'image').url));
// Continuous interaction proof: open the report in the real task Files list.
const frames: Promise<unknown>[] = [];
let count = 0;
const timestamps: number[] = [];
if (phase === 'after') {
 page.onFrame = frame => { timestamps.push(frame.metadata.timestamp); frames.push(Bun.write(`/tmp/t149/installed-frames/${String(count++).padStart(5,'0')}.jpg`, Buffer.from(frame.data,'base64'))); void page.call('Page.screencastFrameAck', { sessionId: frame.sessionId }); };
 await page.call('Page.startScreencast', { format: 'jpeg', quality: 80, maxWidth: 1440, maxHeight: 1000 });
}
await page.run(id => document.querySelector<HTMLButtonElement>(`[data-artifact="${id}"]`)?.click(), fixture.artifacts[0].id);
await waitFor(phase === 'before' ? 'Could not read it: Failed to fetch' : 'Sample skill evaluation');
await new Promise(resolve => setTimeout(resolve, 500));
const shot = await page.call<{data:string}>('Page.captureScreenshot', {format:'png'});
await Bun.write(`/tmp/t149/${phase}-installed.png`, Buffer.from(shot.data,'base64'));
console.log('Open report', await page.run(() => document.querySelector('[data-artifact-text]')?.textContent?.slice(0,350)));
if (phase === 'after') {
 await new Promise(resolve => setTimeout(resolve, 1000));
 await page.call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
 await page.call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
 await new Promise(resolve => setTimeout(resolve, 450));
 await page.call('Network.setBlockedURLs', { urls: ['*/artifacts/*'] });
 await page.run(id => document.querySelector<HTMLButtonElement>(`[data-artifact="${id}"]`)?.click(), fixture.artifacts[0].id);
 await waitFor('Could not reach the artifact');
 await new Promise(resolve => setTimeout(resolve, 500));
 const errorShot = await page.call<{data:string}>('Page.captureScreenshot', {format:'png'});
 await Bun.write('/tmp/t149/after-retry.png', Buffer.from(errorShot.data,'base64'));
 await page.call('Network.setBlockedURLs', { urls: [] });
 await page.run(() => [...document.querySelectorAll('button')].find(button => button.innerText.trim() === 'Retry')?.click());
 await waitFor('Sample skill evaluation');
 await new Promise(resolve => setTimeout(resolve, 1200));
 await page.call('Page.stopScreencast'); page.onFrame = undefined; await Promise.all(frames);
 const concat = timestamps.map((timestamp, index) => `file 'installed-frames/${String(index).padStart(5,'0')}.jpg'\nduration ${index + 1 < timestamps.length ? Math.max(0.04, timestamps[index + 1]! - timestamp) : 1.2}\n`).join('');
 await Bun.write('/tmp/t149/installed-frames.ffconcat', concat);
 console.log('Recording frames', count);
}
// Test both loopback spellings over real HTTP with normal and forced-preflight requests.
for (const [origin, backend] of [[fixture.origin, fixture.url], [fixture.url, fixture.origin]]) {
 await seed(origin, backend);
 const answer = fixture.artifacts[0].url.replace(fixture.url, backend);
 console.log('Cross-origin reads', await page.run(async (url) => {
  const results = [];
  for (const headers of [{ Range: 'bytes=0-262143' }, {}, { Range: 'bytes=-5' }] as Record<string, string>[] ) {
   try { const r = await fetch(url, { headers, signal: AbortSignal.timeout(4000) }); results.push({ requestHeaders: headers, status: r.status, headers: [...r.headers], length: (await r.arrayBuffer()).byteLength }); }
   catch (error) { results.push({ requestHeaders: headers, error: String(error) }); }
  }
  return { origin: location.origin, results };
 }, answer));
}
await Bun.write(`/tmp/t149/${phase}-installed-network.json`, JSON.stringify(events,null,2));
page.close();
