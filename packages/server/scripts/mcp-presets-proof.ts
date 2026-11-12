/** Headless catalogue / pasted registered-client / CLI-chat proof; synthetic demo only. */
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { ChromiumPage, connectChromiumPage } from '../../../apps/web/scripts/chromium-page.ts';
const origin = process.env.MCP_WEB_ORIGIN ?? 'http://localhost:5189';
const cdp = process.env.MCP_CDP ?? 'http://localhost:9389';
const output = process.env.MCP_PROOF_OUTPUT ?? '/tmp/mcp-presets-proof';
const fixture = await Bun.file(process.env.MCP_DEMO_OUTPUT ?? '/tmp/mcp-presets-demo.json').json();
await mkdir(output, { recursive: true });
const oldTargets = await fetch(cdp + '/json').then(r => r.json()) as {id: string; type: string; url: string}[];
const keep = oldTargets.find(t => t.type === 'page' && t.url.includes('/settings/backends/')) ?? oldTargets.find(t => t.type === 'page');
if (!keep) await fetch(cdp + '/json/new?about:blank', { method: 'PUT' });
for (const target of oldTargets) if (target.type === 'page' && target.id !== keep?.id) await fetch(cdp + '/json/close/' + target.id);
await Bun.sleep(500);
const page = await connectChromiumPage(cdp);
await page.call('Page.enable'); await page.call('Runtime.enable');
await page.call('Page.addScriptToEvaluateOnNewDocument', { source: `localStorage.setItem('aiki.backends.v1',${JSON.stringify(JSON.stringify([{ id: 'demo', name: 'Sample backend', url: fixture.url }]))});` });
const settle = () => Bun.sleep(500);
async function wait(text: string) {
 await page.run(text => new Promise<void>((resolve, reject) => {
  const done = () => { if (document.body?.innerText.includes(text)) { clearTimeout(timer); observer.disconnect(); resolve(); } };
  const observer = new MutationObserver(done); const timer = setTimeout(() => { observer.disconnect(); reject(new Error('Missing text: ' + text)); }, 7000);
  observer.observe(document, { subtree: true, childList: true, characterData: true }); done();
 }), text);
}
async function button(text: string) {
 await page.run(text => { const button = [...document.querySelectorAll('button')].find(b => b.innerText.trim() === text); if (!button) throw new Error('Missing button: ' + text); button.scrollIntoView({ block: 'center' }); button.click(); }, text); await settle();
}
async function click(selector: string) {
 await page.run(selector => { const target = document.querySelector<HTMLElement>(selector); if (!target) throw new Error('Missing ' + selector); target.scrollIntoView({ block: 'center' }); target.click(); }, selector); await settle();
}
async function type(selector: string, text: string) {
 await page.run(selector => { const input = document.querySelector<HTMLInputElement>(selector)!; input.scrollIntoView({ block: 'center' }); input.focus(); input.select(); }, selector);
 await page.call('Input.insertText', { text }); await settle();
}
async function viewport(form: string, mode: string) {
 await page.call('Emulation.setDeviceMetricsOverride', { width: form === 'phone' ? 390 : 1440, height: form === 'phone' ? 844 : 1000, deviceScaleFactor: 1, mobile: form === 'phone' });
 await page.call('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: mode }] });
}
async function shot(name: string) {
 await settle();
 const overflow = await page.run(() => document.documentElement.scrollWidth > innerWidth);
 if (overflow) throw new Error('Horizontal overflow: ' + name);
 const image = await page.call<{data: string}>('Page.captureScreenshot', {format: 'png'});
 await Bun.write(join(output, name + '.png'), Buffer.from(image.data, 'base64')); console.log(name);
}
async function openAdd() {
 await page.call('Page.navigate', { url: origin + '/settings/backends/demo/mcp' }); await Bun.sleep(1200); await wait('Add server'); await settle(); await button('Add server'); await wait('Search presets');
}
// Fixed-rate frames keep human-readable pauses and include the real consent popup.
let recordingPage = page, frame = 0, inCapture = false;
const frames = join(output, 'frames'); await rm(frames, { recursive: true, force: true }); await mkdir(frames);
let captures: Promise<unknown>[] = [];
let timer: ReturnType<typeof setInterval> | undefined;
function record() {
 timer = setInterval(() => {
  if (inCapture) return; inCapture = true;
  captures.push(recordingPage.call<{data: string}>('Page.captureScreenshot', {format: 'jpeg', quality: 80}).then(image => Bun.write(join(frames, String(frame++).padStart(5, '0') + '.jpg'), Buffer.from(image.data, 'base64'))).finally(() => { inCapture = false; }));
 }, 200);
}
for (const form of ['desktop', 'phone']) for (const mode of ['light', 'dark']) {
 await viewport(form, mode); await openAdd(); await shot(`catalogue-${form}-${mode}`);
 await type('[aria-label="Search presets"]', 'browser');
 if (await page.run(() => document.querySelectorAll('[data-mcp-preset]').length) !== 3) throw new Error('Search did not filter browser presets');
 await shot(`search-${form}-${mode}`); await button('Cancel');
}
await viewport('desktop', 'light'); await openAdd(); record();
await click('[data-mcp-preset="slack"]'); await click('[role="dialog"] button[type="submit"]'); await wait('Bring your own OAuth app');
await page.run(() => document.querySelector('[data-mcp-own-app]')?.scrollIntoView({ block: 'center' }));
await shot('own-app-desktop-light');
await type('#mcp-client-id', 'synthetic-pasted-app'); await type('#mcp-client-secret', 'synthetic-app-secret');
await button('Sign in'); await wait('Waiting for sign-in');
const targets = await fetch(cdp + '/json').then(r => r.json()) as {url: string; webSocketDebuggerUrl: string}[];
const target = targets.find(t => t.url.startsWith(fixture.issuer)); if (!target) throw new Error('Missing real consent popup');
const ws = new WebSocket(target.webSocketDebuggerUrl); await new Promise<void>((resolve, reject) => { ws.onopen = () => resolve(); ws.onerror = reject; });
const consent = new ChromiumPage(ws); recordingPage = consent;
await consent.call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
await Bun.sleep(1800); await consent.run(() => document.querySelector<HTMLButtonElement>('#approve-synthetic')!.click());
await Bun.sleep(1600);
const callback = await consent.run(() => { document.querySelector<HTMLButtonElement>('button')?.click(); return document.querySelector<HTMLTextAreaElement>('#callback-url')?.value; });
if (!callback) throw new Error('Missing callback copy-back screen');
await Bun.sleep(900); recordingPage = page; await page.call('Page.bringToFront');
await type('#mcp-callback-url', callback); await button('Complete sign-in'); await wait('Sign-in finished'); await wait('Connected');
await page.run(() => document.querySelector('[data-settings-section]')?.scrollIntoView({block: 'start'}));
await shot('connected-desktop-light'); await Bun.sleep(1200);
if (await page.run(() => document.querySelector<HTMLInputElement>('#mcp-client-id')?.value || document.querySelector<HTMLInputElement>('#mcp-client-secret')?.value)) throw new Error('App credentials left in inputs');
if (timer) clearInterval(timer); await Promise.all(captures); consent.close();
const ffmpeg = Bun.spawn(['ffmpeg', '-y', '-loglevel', 'error', '-framerate', '5', '-i', join(frames, '%05d.jpg'), '-vf', 'pad=ceil(iw/2)*2:ceil(ih/2)*2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', join(output, 'preset-registered-oauth-connected.mp4')], {stdout: 'ignore', stderr: 'pipe'});
if (await ffmpeg.exited) throw new Error(await new Response(ffmpeg.stderr).text());
await rm(frames, {recursive: true, force: true});
await openAdd(); await click('[data-mcp-preset="github"]');
await page.run(projectId => { const select = document.querySelector<HTMLSelectElement>('[aria-label="Project for CLI setup"]')!; select.value = projectId; select.dispatchEvent(new Event('change', {bubbles: true})); }, fixture.projectId);
await page.run(() => document.querySelector('[data-mcp-cli-hint]')?.scrollIntoView({block: 'center'})); await shot('cli-hint-desktop-light');
await button('Ask the coordinator to set up gh'); await wait('Please set up the GitHub CLI (gh)'); await wait('Synthetic coordinator received'); await shot('cli-chat-desktop-light');
await viewport('phone', 'dark'); await openAdd(); await click('[data-mcp-preset="atlassian"]');
await page.run(() => document.querySelector('[data-mcp-cli-hint]')?.scrollIntoView({block: 'center'})); await shot('cli-hint-phone-dark');
page.close();
