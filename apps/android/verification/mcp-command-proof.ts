/** Synthetic command/import UI checks. Own emulator track only; no physical devices. */
import { device, tap, type, tree, find, capture, tapNode } from './native-ui.ts';
const fixture = await Bun.file(process.env.MCP_DEMO_OUTPUT ?? '/tmp/mcp-web-demo.json').json();
if (!process.env.HARNESS_ANDROID_DEVICE) throw new Error('Select an owned emulator track');
const phase = process.env.MCP_ANDROID_PHASE ?? 'setup';
const theme = process.env.MCP_ANDROID_THEME ?? 'dark';
async function input(label: RegExp, text: string, clear = false) {
 const node = await find(label, 'down'); await tapNode(node);
 if (clear) { await device('adb','shell','input','keycombination','113','29'); await device('adb','shell','input','keyevent','KEYCODE_DEL'); }
 await device('adb','shell',`input text '${text.replaceAll("'", "'\\''").replaceAll(' ', '%s')}'`);
 await device('adb','shell','input','keyevent','KEYCODE_BACK');
}
if (phase === 'setup') {
 await input(/^URL, host, or published name$/, fixture.url);
 await input(/^Name \(optional; filled from address\)$/, 'MCP sample');
 await tap(/^Add backend$/, 'down');
 console.log((await tree()).filter(n => n.text || n.desc));
} else if (phase === 'command') {
 await tap(/^Add command$/);
 await input(/^Server name$/, 'Android sample');
 await input(/^Command$/, 'bun');
 await input(/^Arguments \(JSON array\)$/, '["run","/tmp/t142/stdio.ts"]', true);
 await input(/^Working directory \(optional\)$/, '/tmp');
 await input(/^Environment \(secret JSON object\)$/, '{"DEMO_SECRET":"synthetic-android-secret"}', true);
 await tap(/^Review command$/, 'down');
 await find(/^Confirm backend command$/);
 const nodes = await tree(); if (nodes.some(n => n.text.includes('synthetic-android-secret'))) throw new Error('Secret leaked in confirmation');
 await capture(`t142-confirm-phone-${theme}`);
 await tap(/^Confirm and save$/); await find(/^Edit command$/);
 await tap(/^Refresh tools$/,'down'); await find(/^Connected · 2 tools$/);
 await capture(`t142-connected-phone-${theme}`);
} else if (phase === 'import') {
 await tap(/^Import JSON$/);
 await input(/^Server JSON$/, JSON.stringify({mcpServers:{'Android sample':{command:'bun',args:['run','/tmp/t142/stdio.ts'],cwd:'/tmp',env:{DEMO_SECRET:'synthetic-import-secret'}},'Sample remote':{url:'https://mcp.example.test/mcp',type:'http'},'Invalid example':{args:[123]}}}));
 await tap(/^Review import$/,'down'); await find(/^Import selected$/,'down');
 await capture(`t142-import-phone-${theme}`);
 await tap(/^Import selected$/,'down'); await find(/^Confirm backend command$/); await capture(`t142-import-confirm-phone-${theme}`);
 await tap(/^Back$/);
} else {
 console.log((await tree()).filter(n => n.text || n.desc));
}
