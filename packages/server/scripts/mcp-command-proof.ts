/** Headless synthetic MCP proof. Start mcp-web-demo.ts, Vite and a dedicated Chromium first.
 * MCP_PROOF_PHASE=before captures existing backend/project settings without changing data.
 * The default after phase drives add/token/policy/roles, captures the screen matrix and two recordings.
 */
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { connectChromiumPage } from '../../../apps/web/scripts/chromium-page.ts';
const origin = process.env.MCP_WEB_ORIGIN ?? 'http://localhost:5186';
const cdp = process.env.MCP_CDP ?? 'http://localhost:9386';
const output = process.env.MCP_PROOF_OUTPUT ?? '/tmp/mcp-web-proof';
const phase = process.env.MCP_PROOF_PHASE ?? 'after';
const fixture = await Bun.file(process.env.MCP_DEMO_OUTPUT ?? '/tmp/mcp-web-demo.json').json() as { url: string; projectId: string; mcpUrl: string; token: string };
await mkdir(output, { recursive: true });
const page = await connectChromiumPage(cdp);
await page.call('Page.enable');
await page.call('Runtime.enable');
await page.call('Page.addScriptToEvaluateOnNewDocument', { source: `localStorage.setItem('aiki.backends.v1',${JSON.stringify(JSON.stringify([{ id: 'demo', name: 'Sample backend', url: fixture.url }]))});` });
async function waitFor(text: string) {
  await page.run((text) => new Promise<void>((resolve, reject) => {
    const done = () => { if (document.body?.innerText.includes(text)) { clearTimeout(timer); observer.disconnect(); resolve(); } };
    const observer = new MutationObserver(done);
    const timer = setTimeout(() => { observer.disconnect(); reject(new Error('Missing UI text: ' + text)); }, 6500);
    observer.observe(document, { subtree: true, childList: true, characterData: true }); done();
  }), text);
}
async function settle() {
  // A fixed transition delay, not a readiness poll: theme/dialog fades must finish before captures.
  await new Promise(resolve => setTimeout(resolve, 450));
}
async function navigate(path: string, text: string) {
  await page.call('Page.navigate', { url: origin + path });
  await waitFor(text); await settle();
}
async function click(selector: string) {
  await page.run((selector) => {
    const target = document.querySelector<HTMLElement>(selector);
    if (!target) throw new Error('Missing click target: ' + selector);
    target.scrollIntoView({ block: 'center', behavior: 'instant' }); target.click();
  }, selector);
}
async function button(text: string) {
  const selector = await page.run(text => {
    const button = [...document.querySelectorAll('button')].find(button => button.innerText.trim() === text);
    if (!button) throw new Error('Missing button: ' + text);
    button.dataset.proofClick = 'true'; return '[data-proof-click="true"]';
  }, text);
  await click(selector);
  await page.run(() => document.querySelector('[data-proof-click]')?.removeAttribute('data-proof-click'));
}
async function type(selector: string, text: string) {
  await page.run(selector => {
    const input = document.querySelector<HTMLInputElement>(selector);
    if (!input) throw new Error('Missing input: ' + selector);
    input.scrollIntoView({ block: 'center', behavior: 'instant' }); input.focus();
  }, selector);
  await page.call('Input.insertText', { text });
}
async function viewport(form: string, mode: string) {
  await page.call('Emulation.setDeviceMetricsOverride', { width: form === 'phone' ? 390 : 1440, height: form === 'phone' ? 844 : 1000, deviceScaleFactor: 1, mobile: form === 'phone' });
  await page.call('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: mode }] });
}
async function shot(screen: string, form: string, mode: string) {
  await settle();
  const overflow = await page.run(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth }));
  if (overflow.scroll > overflow.width) throw new Error('Page overflow: ' + JSON.stringify({ screen, form, mode, ...overflow }));
  if (phase !== 'before' && ['servers', 'details', 'tools', 'description', 'project'].includes(screen)) {
    const status = await page.run(() => document.querySelector<HTMLElement>('[data-settings-section] [data-tone]')?.innerText.trim());
    if (!status?.startsWith('Connected')) throw new Error(`Expected connected MCP server in ${screen}/${form}/${mode}: ${status}`);
    console.log('Connected screenshot', screen, form, mode);
  }
  if (screen === 'tools') {
    const rows = await page.run(() => [...document.querySelectorAll<HTMLElement>('[data-mcp-tool-row]')].map(row => row.getBoundingClientRect().height));
    console.log('Collapsed tool row heights', form, mode, { count: rows.length, min: Math.min(...rows), max: Math.max(...rows) });
    if (phase !== 'before' && form === 'desktop' && rows.some(height => height < 56 || height > 72)) throw new Error('Desktop tool rows outside 56–72px target');
  }
  const image = await page.call<{ data: string }>('Page.captureScreenshot', { format: 'png' });
  await Bun.write(join(output, `${phase}-${screen}-${form}-${mode}.png`), Buffer.from(image.data, 'base64'));
}
let frameCount = 0;
let frameDir = '';
let frameWrites: Promise<unknown>[] = [];
async function record(name: string) {
  frameCount = 0; frameWrites = []; frameDir = join(output, name + '-frames');
  await rm(frameDir, { recursive: true, force: true });
  await mkdir(frameDir, { recursive: true });
  page.onFrame = frame => {
    frameWrites.push(Bun.write(join(frameDir, String(frameCount++).padStart(5, '0') + '.jpg'), Buffer.from(frame.data, 'base64')));
    void page.call('Page.screencastFrameAck', { sessionId: frame.sessionId });
  };
  await page.call('Page.startScreencast', { format: 'jpeg', quality: 80, maxWidth: 1440, maxHeight: 1000 });
}
async function finishRecord(name: string) {
  await settle(); await page.call('Page.stopScreencast'); page.onFrame = undefined; await Promise.all(frameWrites);
  const process = Bun.spawn(['ffmpeg', '-y', '-loglevel', 'error', '-framerate', '5', '-i', join(frameDir, '%05d.jpg'), '-vf', 'pad=ceil(iw/2)*2:ceil(ih/2)*2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', join(output, name + '.mp4')], { stdout: 'ignore', stderr: 'pipe' });
  const timeout = setTimeout(() => process.kill(), 30000);
  const code = await process.exited; clearTimeout(timeout);
  if (code !== 0) throw new Error(await new Response(process.stderr).text());
  console.log(`${name}: ${frameCount} frames`);
}


const forms = ['desktop', 'phone']; const modes = ['light', 'dark'];
async function matrix(screen: string) { for (const form of forms) for (const mode of modes) { await viewport(form, mode); await shot(screen, form, mode); } }
async function set(selector: string, value: string) {
 await page.run(({selector, value}) => { const input = document.querySelector<HTMLInputElement>(selector)!; input.value = value; input.dispatchEvent(new Event('input', {bubbles:true})); input.dispatchEvent(new Event('change', {bubbles:true})); }, {selector, value});
}
await viewport('desktop','light');
await navigate('/settings/backends/demo/mcp','MCP servers');
await button('Add server'); await waitFor('Add MCP server');
if (phase === 'before') { await matrix('add'); }
else {
 await set('select', 'command'); await type('input[maxlength="120"]','Sample command');
 await type('#mcp-command','bun'); await set('#mcp-args', JSON.stringify(['run','/tmp/t142/stdio.ts']));
 await type('#mcp-cwd','/tmp'); await set('#mcp-env',JSON.stringify({DEMO_SECRET:'synthetic-proof-secret'}));
 await matrix('add'); await button('Review command'); await waitFor('Confirm backend command');
 if (await page.run(() => document.body.innerText.includes('synthetic-proof-secret'))) throw new Error('Secret in confirm screen');
 await matrix('confirm'); await button('Confirm and save'); await waitFor('Backend command');
 await button('Refresh tools'); await waitFor('2 tools');
 const status = await page.run(() => document.body.innerText);
 if (!status.includes('Connected') || status.includes('synthetic-proof-secret')) throw new Error('Connection/redaction failed');
 await matrix('connected'); await button('Back to servers');
 await viewport('desktop','light'); await record('import-flow-desktop-light');
 await button('Import JSON'); await waitFor('Import MCP servers');
 await type('#mcp-import-json', JSON.stringify({mcpServers:{'Sample command':{command:'bun',args:['run','/tmp/t142/stdio.ts'],cwd:'/tmp',env:{DEMO_SECRET:'synthetic-import-secret'}},'Sample remote':{url:fixture.mcpUrl,type:'streamable-http',headers:{Authorization:'Bearer '+fixture.token}},'Invalid example':{args:[123]}}},null,2));
 await settle(); await button('Review import'); await waitFor('Renamed ID: sample_command_');
 if (await page.run(() => !!document.querySelector('#mcp-import-json'))) throw new Error('Import secret field retained');
 await matrix('import-review'); await viewport('desktop','light'); await button('Import selected'); await waitFor('Confirm backend command'); await settle();
 await button('Confirm and save'); await waitFor('Connect with a token'); await settle();
 await finishRecord('import-flow-desktop-light');
 console.log('Command add, confirmation, refresh, redaction, collision review, invalid entries and import passed');
}
await page.close();
