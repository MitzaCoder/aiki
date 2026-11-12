/** Real settings → fake consent → real callback proof. Use a fresh mcp-oauth-web-demo.ts fixture. */
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { ChromiumPage, connectChromiumPage } from '../../../apps/web/scripts/chromium-page.ts';
const fixture = await Bun.file(process.env.MCP_OAUTH_DEMO_OUTPUT ?? '/tmp/mcp-oauth-web-demo.json').json();
const output = process.env.MCP_OAUTH_PROOF_OUTPUT ?? '/tmp/mcp-oauth-settings-proof';
const cdp = process.env.MCP_CDP ?? 'http://localhost:9386';
await mkdir(output, { recursive: true });
const page = await connectChromiumPage(cdp);
await page.call('Page.enable');
await page.call('Page.navigate', { url: fixture.origin + '/settings' });
await new Promise(resolve => setTimeout(resolve, 1200));
await page.run(async fixture => {
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
const settings = fixture.origin + '/settings/backends/synthetic/mcp';
async function waitText(target: ChromiumPage, text: string) {
  try { await observeText(target, text); }
  catch (error) {
    if (!/navigated or closed|Execution context was destroyed/.test(String(error))) throw error;
    // One navigation can invalidate the observer installed in about:blank or consent.
    await observeText(target, text);
  }
}
async function observeText(target: ChromiumPage, text: string) {
  await target.run(text => new Promise<void>((resolve, reject) => {
    const done = () => { if (document.body?.innerText.includes(text)) { clearTimeout(timer); observer.disconnect(); resolve(); } };
    const observer = new MutationObserver(done);
    const timer = setTimeout(() => { observer.disconnect(); reject(new Error('Missing UI text: ' + text)); }, 7000);
    observer.observe(document, { subtree: true, childList: true, characterData: true }); done();
  }), text);
}
const settle = () => new Promise(resolve => setTimeout(resolve, 450));
async function click(target: ChromiumPage, selector: string, trusted = false) {
  const expression = `(() => {const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw Error('Missing click target');e.scrollIntoView({block:'center',behavior:'instant'});e.click();})()`;
  const response = await target.call<{ exceptionDetails?: unknown }>('Runtime.evaluate', { expression, userGesture: trusted });
  if (response.exceptionDetails) throw new Error(JSON.stringify(response.exceptionDetails));
}
async function button(target: ChromiumPage, text: string) {
  await target.run(text => {
    const button = [...document.querySelectorAll('button')].find(button => button.innerText.trim() === text);
    if (!button) throw new Error('Missing button: ' + text); button.dataset.oauthProofClick = 'true';
  }, text);
  await click(target, '[data-oauth-proof-click]');
  await target.run(() => document.querySelector('[data-oauth-proof-click]')?.removeAttribute('data-oauth-proof-click'));
}
async function type(selector: string, text: string) {
  await page.run(selector => document.querySelector<HTMLInputElement>(selector)?.focus(), selector);
  await page.call('Input.insertText', { text });
}
async function viewport(form: string, mode: string) {
  await page.call('Emulation.setDeviceMetricsOverride', { width: form === 'phone' ? 390 : 1440, height: form === 'phone' ? 844 : 1000, deviceScaleFactor: 1, mobile: form === 'phone' });
  await page.call('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: mode }] });
}
async function shot(state: string, form: string, mode: string) {
  await settle();
  if (await page.run(() => document.documentElement.scrollWidth > innerWidth)) throw new Error('Settings overflow');
  const image = await page.call<{ data: string }>('Page.captureScreenshot', { format: 'png' });
  await Bun.write(join(output, `${state}-${form}-${mode}.png`), Buffer.from(image.data, 'base64'));
}
const { targetInfo: original } = await page.call<{ targetInfo: { targetId: string } }>('Target.getTargetInfo');
async function popup(): Promise<{ page: ChromiumPage; id: string }> {
  const targets = await fetch(cdp + '/json', { signal: AbortSignal.timeout(3000) }).then(response => response.json()) as { id: string; type: string; webSocketDebuggerUrl: string }[];
  const target = targets.find(target => target.type === 'page' && target.id !== original.targetId);
  if (!target) throw new Error('Sign-in popup did not open');
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Popup connection timeout')), 3000);
    socket.onopen = () => { clearTimeout(timer); resolve(); }; socket.onerror = reject;
  });
  const popup = new ChromiumPage(socket);
  await popup.call('Page.enable'); return { page: popup, id: target.id };
}
async function closePopup(popup: { page: ChromiumPage; id: string }) {
  popup.page.close(); await page.call('Target.closeTarget', { targetId: popup.id }); await page.call('Page.bringToFront');
}
const frameDir = join(output, 'oauth-settings-frames');
await rm(frameDir, { recursive: true, force: true }); await mkdir(frameDir, { recursive: true });
let frameCount = 0; const writes: Promise<unknown>[] = [];
async function record(target: ChromiumPage) {
  target.onFrame = frame => {
    writes.push(Bun.write(join(frameDir, String(frameCount++).padStart(5, '0') + '.jpg'), Buffer.from(frame.data, 'base64')));
    void target.call('Page.screencastFrameAck', { sessionId: frame.sessionId });
  };
  await target.call('Page.startScreencast', { format: 'jpeg', quality: 85, maxWidth: 1440, maxHeight: 1000 });
}
async function pauseRecord(target: ChromiumPage) { await settle(); await target.call('Page.stopScreencast'); target.onFrame = undefined; }
async function add(name: string) {
  await button(page, 'Add server'); await waitText(page, 'Add MCP server');
  await page.run(name => {
    document.querySelector<HTMLButtonElement>('[data-mcp-preset="notion"]')!.click();
    const input = document.querySelector<HTMLInputElement>('input[maxlength="120"]')!;
    input.value = name; input.dispatchEvent(new Event('input', { bubbles: true }));
  }, name);
  await settle(); await click(page, '[role="dialog"] button[type="submit"]'); await waitText(page, 'Sign in with OAuth'); await settle();
}
async function connected() {
  await page.run(() => new Promise<void>((resolve, reject) => {
    const done = () => {
      if (document.querySelector<HTMLElement>('[data-settings-section] [data-tone="ok"]')?.innerText.trim() === 'Connected') {
        clearTimeout(timer); observer.disconnect(); resolve();
      }
    };
    const observer = new MutationObserver(done);
    const timer = setTimeout(() => { observer.disconnect(); reject(new Error('Settings did not receive connected event')); }, 7000);
    observer.observe(document, { subtree: true, childList: true, characterData: true }); done();
  }));
}

for (const form of ['desktop', 'phone']) for (const mode of ['light', 'dark']) {
  const recording = form === 'desktop' && mode === 'light';
  const pasted = form === 'phone' && mode === 'dark';
  const name = `Notion ${form} ${mode}`;
  await viewport(form, mode);
  await page.call('Page.navigate', { url: settings }); await waitText(page, 'Add server'); await settle();
  if (recording) await record(page);
  await add(name); await shot('details', form, mode);
  await click(page, '[data-mcp-oauth-sign-in]', true); await waitText(page, 'Waiting for sign-in');
  let consent = await popup(); await waitText(consent.page, 'Synthetic OAuth consent');
  if (pasted) {
    // Session-bound pending flows survive a settings reload, then cancellation stays visible.
    await page.call('Page.reload'); await waitText(page, name); await settle();
    await page.run(name => [...document.querySelectorAll('button')].find(button => button.innerText.includes(name))?.click(), name);
    await waitText(page, 'Paste callback URL');
    console.log('Pending flow restored from mcp.list after reload');
    await click(page, '[data-mcp-oauth-cancel]'); await waitText(page, 'Sign-in cancelled');
    await closePopup(consent);
    console.log('Cancellation event rendered in settings');
    await click(page, '[data-mcp-oauth-sign-in]', true); await waitText(page, 'Waiting for sign-in');
    consent = await popup(); await waitText(consent.page, 'Synthetic OAuth consent');
  }
  await page.call('Page.bringToFront');
  await page.run(() => document.querySelector('[data-mcp-oauth-sign-in]')?.scrollIntoView({ block: 'center', behavior: 'instant' }));
  await shot('waiting', form, mode);
  await page.run(() => document.querySelector('#mcp-callback-url')?.closest('form')?.scrollIntoView({ block: 'start', behavior: 'instant' }));
  await shot('paste', form, mode);
  if (recording) {
    await pauseRecord(page);
    await consent.page.call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
    await consent.page.call('Page.bringToFront'); await record(consent.page); await settle();
  }
  if (pasted) await page.run(() => {
    // Simulate a callback browser without the initiating tab's saved route.
    for (const key of Object.keys(localStorage)) if (key.startsWith('aiki.mcpOAuth.')) localStorage.removeItem(key);
  });
  await click(consent.page, '#approve-synthetic', true);
  await waitText(consent.page, pasted ? 'Sign-in almost done' : 'Sign-in complete');
  if (await consent.page.run(() => Boolean(location.search))) throw new Error('Callback query was not stripped');
  if (pasted) {
    const callback = await consent.page.run(() => document.querySelector<HTMLTextAreaElement>('#callback-url')!.value);
    await page.call('Page.bringToFront'); await type('#mcp-callback-url', callback); await button(page, 'Complete sign-in');
    console.log('Pasted callback completed on the initiating device');
  }
  await connected();
  if (recording) {
    await pauseRecord(consent.page); await page.call('Page.bringToFront'); await record(page);
  }
  await page.run(() => document.querySelector('[data-settings-section]')?.scrollIntoView({ block: 'start', behavior: 'instant' }));
  await shot('connected', form, mode);
  if (recording) await pauseRecord(page);
  await closePopup(consent);
  console.log(`Connected through ${pasted ? 'pasted completion' : 'callback event'}: ${form} ${mode}`);
}
await Promise.all(writes);
const encoder = Bun.spawn(['ffmpeg', '-y', '-loglevel', 'error', '-framerate', '5', '-i', join(frameDir, '%05d.jpg'), '-vf', 'pad=ceil(iw/2)*2:ceil(ih/2)*2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', join(output, 'oauth-settings-flow.mp4')], { stdout: 'ignore', stderr: 'pipe' });
const encoderTimer = setTimeout(() => encoder.kill(), 30000);
const code = await encoder.exited; clearTimeout(encoderTimer);
if (code !== 0) throw new Error(await new Response(encoder.stderr).text());
console.log(`OAuth settings recording: ${frameCount} frames`);
page.close();
