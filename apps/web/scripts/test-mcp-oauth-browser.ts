/** Run against mcp-oauth-fixture.ts + a dedicated Vite/Chromium instance; fake accounts only. */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { connectChromiumPage } from './chromium-page.ts';
const fixture = JSON.parse(await readFile(process.argv[2] ?? '/tmp/aiki-mcp-oauth-fixture.json', 'utf8'));
const output = process.argv[3] ?? '/tmp/aiki-mcp-oauth-proof';
await mkdir(output, { recursive: true });
const page = await connectChromiumPage(process.argv[4] ?? 'http://127.0.0.1:9399');
await page.call('Page.enable'); await page.call('Runtime.enable');
await page.call('Browser.grantPermissions', { origin: fixture.origin, permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'] });
await page.call('Page.bringToFront');
async function navigate(path: string) { await page.call('Page.navigate', { url: fixture.origin + path }); await Bun.sleep(1200); await waitText('Kemiri'); }
async function waitText(text: string) {
 await page.run((text: string) => new Promise<void>((resolve, reject) => {
  const found = () => document.body?.innerText.includes(text);
  if (found()) return resolve();
  const observer = new MutationObserver(() => { if (found()) { observer.disconnect(); clearTimeout(timer); resolve(); } });
  const timer = setTimeout(() => { observer.disconnect(); reject(new Error('UI state timeout: ' + text)); }, 7000);
  observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
 }), text);
}
await navigate('/settings');
await page.run(async (fixture) => {
 localStorage.setItem('aiki.backends.v1', JSON.stringify(fixture.backends));
 const db = await new Promise<IDBDatabase>((resolve, reject) => {
  const request = indexedDB.open('aiki-device-auth', 1);
  request.onupgradeneeded = () => request.result.createObjectStore('credentials');
  request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
 });
 await new Promise<void>((resolve, reject) => {
  const tx = db.transaction('credentials', 'readwrite');
  tx.objectStore('credentials').put(fixture.credential, JSON.stringify([fixture.credential.backendId, fixture.credential.origin]));
  tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error);
 }); db.close();
}, fixture);
await navigate('/settings');
await page.evaluate(`(async () => { const {harness} = await import('/src/lib/harness.svelte.ts'); const b = harness.backend('synthetic'); if (!b) throw Error('no backend'); if (!b.ready) await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('backend timeout')),6000); const stop=b.client.subscribe(s=>{if(s.status==='ready'){clearTimeout(timer);stop();resolve();}})}); return b.ready; })()`);
async function capture(state: string, size: string, mode: string) {
 const shot = await page.call<{ data: string }>('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
 await writeFile(`${output}/${state}-${size}-${mode}.png`, Buffer.from(shot.data, 'base64'));
 console.log(`${state}-${size}-${mode}: query removed=${await page.evaluate('!location.search')}`);
}
async function mode(mode: string) {
 await page.call('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: mode }] });
 await page.run(() => new Promise<void>(resolve => { requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 350))); }));
}
// Record the same-tab fallback for blocked popups, using the shipped start helper and real backend.
await page.call('Emulation.setDeviceMetricsOverride', { width: 1280, height: 850, deviceScaleFactor: 1, mobile: false });
await mode('light');
await page.evaluate(`(async () => { const {harness} = await import('/src/lib/harness.svelte.ts'); await harness.backend('synthetic').client.request({type:'mcp.token.set',serverId:'notion',token:null}); const button=document.createElement('button');button.id='synthetic-connect';button.textContent='Connect synthetic Notion (OAuth demo)';button.style='position:fixed;top:120px;left:360px;padding:24px;background:#293f8d;color:white;border-radius:12px;z-index:9999;font:18px system-ui';button.onclick=async()=>{const {startMcpOAuth}=await import('/src/lib/mcp-oauth.ts');window.open=()=>null;await startMcpOAuth(harness.backend('synthetic'),'notion');};document.body.append(button); })()`);
const frames: { path: string; at: number }[] = [];
let writing: Promise<unknown> = Promise.resolve();
page.onFrame = frame => {
 void page.call('Page.screencastFrameAck', { sessionId: frame.sessionId });
 const path = `${output}/frame-${String(frames.length).padStart(5, '0')}.jpg`;
 frames.push({ path, at: frame.metadata.timestamp });
 writing = writing.then(() => writeFile(path, Buffer.from(frame.data, 'base64')));
};
await page.call('Page.startScreencast', { format: 'jpeg', quality: 85, maxWidth: 1280, maxHeight: 850, everyNthFrame: 1 });
await page.evaluate(`setTimeout(() => document.querySelector('#synthetic-connect').click(), 50)`);
await Bun.sleep(700);
await waitText('Synthetic OAuth consent');
await Bun.sleep(2200);
await waitText('Sign-in complete');
await page.run(() => new Promise<void>(resolve => setTimeout(resolve, 800)));
await page.call('Page.stopScreencast'); await writing;
await writeFile(`${output}/frames.txt`, frames.map((frame, index) => `file '${frame.path}'\nduration ${Math.max(0.05, Math.min(3, (frames[index + 1]?.at ?? frame.at + 1) - frame.at))}`).join('\n') + `\nfile '${frames.at(-1)!.path}'\n`);
console.log(`recording frames=${frames.length}; connected=${await page.evaluate(`(async()=>{const {harness}=await import('/src/lib/harness.svelte.ts');const r=await harness.backend('synthetic').client.request({type:'mcp.list'});return r.servers[0].status})()` )}`);
// Success is a completed real flow, not a forced component state.
for (const [size, width, height] of [['desktop', 1280, 850], ['phone', 390, 844]] as const) {
 await page.call('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: size === 'phone' });
 for (const color of ['light', 'dark']) { await mode(color); await capture('success', size, color); }
}
for (const state of ['error', 'paste']) {
 for (const [size, width, height] of [['desktop', 1280, 850], ['phone', 390, 844]] as const) {
  await page.call('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: size === 'phone' });
  for (const color of ['light', 'dark']) {
   if (state === 'error') await page.evaluate(`localStorage.setItem('aiki.mcpOAuth.synthetic-missing-flow','synthetic')`);
   await navigate(`/mcp/oauth/callback?state=${state === 'error' ? 'synthetic-missing-flow' : 'synthetic-native-flow'}&code=synthetic-one-use-code`);
   await waitText(state === 'error' ? 'Could not sign in' : 'Return to Kemiri');
   await mode(color); await capture(state, size, color);
   if (state === 'paste') { await page.evaluate(`document.querySelector('main button').click()`); await waitText('Copied'); }
  }
 }
}
page.close();
