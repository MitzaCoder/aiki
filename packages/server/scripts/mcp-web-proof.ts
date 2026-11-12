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
const backendPath = '/settings/backends/demo';
const mcpPath = backendPath + '/mcp';
const projectPath = `/b/demo/projects/${fixture.projectId}`;
async function approval(form: string, mode: string) {
  await navigate(projectPath, '1 question waiting for you');
  if (form === 'phone') { await click('[aria-label="Show the questions waiting"]'); await waitFor('Exact arguments:'); }
  else await waitFor('Exact arguments:');
  const bounds = await page.run(() => [...document.querySelectorAll('.md')].filter(element => element.textContent?.includes('Exact arguments:')).map(element => ({ width: element.clientWidth, scroll: element.scrollWidth, wrap: getComputedStyle(element).overflowWrap })));
  if (!bounds.length || bounds.some(bound => bound.scroll > bound.width + 1)) throw new Error('Approval overflow: ' + JSON.stringify(bounds));
  console.log('Approval bounds', form, mode, bounds);
  await shot('approval', form, mode);
}
if (phase !== 'before' && process.env.MCP_PROOF_ONLY !== 'approval') {
  await viewport('desktop', 'light');
  await navigate(mcpPath, 'No MCP servers yet.');
  await record('server-flow-desktop-light');
  await button('Add server'); await waitFor('Add MCP server'); await settle();
  await type('input[maxlength="120"]', 'Sample catalogue');
  await type('input[type="url"]', fixture.mcpUrl);
  await click('[role="dialog"] button[type="submit"]');
  await waitFor('Connect with a token'); await settle();
  await type('#mcp-token', fixture.token); await settle();
  await button('Connect'); await waitFor('Token saved on the backend. Connection checked.');
  await waitFor('71 tools'); await settle();
  const tokenEmpty = await page.run(() => (document.querySelector<HTMLInputElement>('#mcp-token')?.value ?? '') === '' && !document.body.innerText.includes('synthetic-mcp-demo-token'));
  if (!tokenEmpty) throw new Error('Token was echoed');
  await page.run(() => document.querySelector('[role="radiogroup"]')?.scrollIntoView({ block: 'center' }));
  await click('[role="radiogroup"] [role="radio"]'); await waitFor('Saved');
  await settle();
  await click('[data-mcp-tool-row] button[aria-expanded]');
  const disclosure = await page.run(() => {
    const button = document.querySelector<HTMLButtonElement>('[data-mcp-tool-row] button[aria-expanded]')!;
    const full = document.getElementById(button.getAttribute('aria-controls')!)!;
    return { expanded: button.getAttribute('aria-expanded'), visible: !full.hidden, length: full.textContent!.length, markup: !!full.querySelector('a,script') };
  });
  if (disclosure.expanded !== 'true' || !disclosure.visible || disclosure.length <= 600 || disclosure.markup) throw new Error('Full plain-text disclosure failed: ' + JSON.stringify(disclosure));
  console.log('Full plain-text description expanded', disclosure);
  await settle();
  // Enter is the same disclosure action for keyboard users.
  await page.run(() => document.querySelector<HTMLButtonElement>('[data-mcp-tool-row] button[aria-expanded]')?.focus());
  await page.call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', text: '\r', unmodifiedText: '\r', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
  await page.call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  await settle();
  if (await page.run(() => document.querySelector('[data-mcp-tool-row] button[aria-expanded]')?.getAttribute('aria-expanded')) !== 'false') throw new Error('Keyboard disclosure collapse failed');
  for (const [key, code, policy] of [['ArrowRight', 39, 'Ask'], ['ArrowLeft', 37, 'Off']] as const) {
    await page.run(() => document.querySelector<HTMLButtonElement>('[data-mcp-tool-row] [role="radio"][aria-checked="true"]')?.focus());
    await page.call('Input.dispatchKeyEvent', { type: 'keyDown', key, code: key, windowsVirtualKeyCode: code });
    await page.call('Input.dispatchKeyEvent', { type: 'keyUp', key, code: key, windowsVirtualKeyCode: code });
    await page.run(policy => new Promise<void>((resolve, reject) => {
      const row = document.querySelector('[data-mcp-tool-row]')!;
      const done = () => {
        const checked = row.querySelector('[role="radio"][aria-checked="true"]');
        if (row.getAttribute('aria-busy') === 'false' && checked?.textContent?.trim() === policy) {
          clearTimeout(timer); observer.disconnect();
          if (document.activeElement !== checked) reject(new Error('Policy keyboard focus did not follow selection'));
          else resolve();
        }
      };
      const observer = new MutationObserver(done);
      const timer = setTimeout(() => { observer.disconnect(); reject(new Error('Policy keyboard save failed')); }, 6500);
      observer.observe(row, { subtree: true, childList: true, attributes: true }); done();
    }), policy);
  }
  console.log('ArrowRight/ArrowLeft policy saves keep keyboard focus');
  await finishRecord('server-flow-desktop-light');
  // Plain-text metadata must never become a link or executable markup.
  if (await page.run(() => !!document.querySelector('[data-mcp-description] a, [data-mcp-description] script'))) throw new Error('Rendered server markup');
  await type('#mcp-tool-filter', 'notion_tool_70'); await waitFor('1 of 71 tools.');
  console.log('Filtering: exactly one of 71 tools');
  await viewport('phone', 'dark');
  await navigate(projectPath + '/settings/mcp', 'Enable Sample catalogue');
  await record('project-flow-phone-dark');
  await click('[role="switch"][aria-label="Enable Sample catalogue"]'); await waitFor('Saved'); await settle();
  await click('[role="switch"][aria-label="Sample catalogue: Coordinator"]'); await waitFor('Saved'); await settle();
  await click('[role="switch"][aria-label="Sample catalogue: Workers"]'); await waitFor('Saved'); await settle();
  await finishRecord('project-flow-phone-dark');
  // Beyond both the backend's 15s header deadline and the fake peer's 30s idle cap.
  // This is one fixed regression wait, not a readiness polling loop.
  await new Promise(resolve => setTimeout(resolve, 32_000));
  await navigate(projectPath + '/settings/mcp', 'Enable Sample catalogue');
  const idleStatus = await page.run(() => document.querySelector<HTMLElement>('[data-settings-section] [data-tone]')?.innerText.trim());
  if (!idleStatus?.startsWith('Connected')) throw new Error('MCP idle stream failed: ' + idleStatus);
  console.log('MCP remains connected after 32 idle seconds');
}
for (const form of ['desktop', 'phone']) for (const mode of ['light', 'dark']) {
  await viewport(form, mode);
  if (process.env.MCP_PROOF_ONLY === 'approval') { await approval(form, mode); continue; }
  await navigate(backendPath, 'Accounts and API keys');
  if (phase !== 'before') await page.run(() => document.querySelector('[data-link="mcp"]')?.scrollIntoView({ block: 'center' }));
  await shot('backend', form, mode);
  if (phase === 'before') {
    await navigate(projectPath + '/settings', 'General');
    await shot('project', form, mode);
  } else {
    await navigate(mcpPath, 'Sample catalogue'); await shot('servers', form, mode);
    await button('Add server'); await waitFor('Add MCP server');
    // Preset comes from mcp.list, not a client-maintained list.
    await page.run(() => { const select = document.querySelector<HTMLSelectElement>('select'); if (!select) throw new Error('Missing presets'); select.value = 'notion'; select.dispatchEvent(new Event('change', { bubbles: true })); });
    await shot('add', form, mode); await button('Cancel'); await settle();
    await page.run(() => [...document.querySelectorAll('button')].find(button => button.innerText.includes('Sample catalogue'))?.click());
    await waitFor('Connect with a token'); await shot('details', form, mode);
    await page.run(() => document.querySelector('#mcp-tool-filter')?.scrollIntoView({ block: 'start' }));
    await shot('tools', form, mode);
    await click('[data-mcp-tool-row] button[aria-expanded]');
    await shot('description', form, mode);
    await navigate(projectPath + '/settings/mcp', 'Enable Sample catalogue');
    await shot('project', form, mode);
  }
  await approval(form, mode);
}
page.close();
