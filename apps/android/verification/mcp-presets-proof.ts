/** T157 synthetic catalogue and CLI proof. Select a free emulator track explicitly. */
import { device, tap, type, tree, find, capture, swipe } from './native-ui.ts';
if (!process.env.HARNESS_ANDROID_DEVICE) throw new Error('Select an owned emulator track');
const fixture = await Bun.file(process.env.MCP_DEMO_OUTPUT ?? '/tmp/mcp-presets-demo.json').json();
const phase = process.env.MCP_ANDROID_PHASE ?? 'inspect';
const theme = process.env.MCP_ANDROID_THEME ?? 'dark';
if (phase === 'setup') {
 await device('adb', 'reverse', `tcp:${new URL(fixture.url).port}`, `tcp:${new URL(fixture.url).port}`);
 await type(/^URL, host, or published name$/, fixture.url);
 await type(/^Name \(optional\)$/, 'MCP sample'); await tap(/^Add backend$/);
 await find(/^MCP sample project$/, 'down');
} else if (phase === 'catalogue') {
 await tap(/^Add server$/, 'down'); await find(/^Search presets$/);
 await capture(`t157-catalogue-phone-${theme}`);
 await tap(/^GitHub$/, 'down');
 await tap(/^Choose a project for CLI setup$/, 'down'); await tap(/^MCP sample project$/);
 await find(/^Ask the coordinator to set up gh$/, 'down');
 await swipe('down'); await capture(`t157-cli-phone-${theme}`);
} else if (phase === 'command') {
 await type(/^Search presets$/, 'Playwright'); await tap(/^Playwright$/, 'down');
 await tap(/^Review Playwright command$/, 'down'); await tap(/^Review command$/, 'down');
 await find(/^Confirm backend command$/); await capture(`t157-command-phone-${theme}`);
} else console.log((await tree()).filter(n => n.text || n.desc).map(n => ({text: n.text, desc: n.desc})));
