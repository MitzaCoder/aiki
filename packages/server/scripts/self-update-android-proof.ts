/** Emulator-only UI evidence for the disposable installed rehearsal. Set HARNESS_ANDROID_DEVICE explicitly. */
import { cp, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { artifacts, capture, device, find, tap, tree, type } from '../../../apps/android/verification/native-ui.ts';
const args = process.argv.slice(2);
const option = (name: string) => args.includes(name) ? args[args.indexOf(name) + 1] : undefined;
if (!process.env.HARNESS_ANDROID_DEVICE || !option('--home') || !option('--out')) throw new Error('Select an owned emulator and pass temporary --home and --out');
const home = resolve(option('--home')!); const out = resolve(option('--out')!);
if (!home.startsWith(resolve(tmpdir()) + '/')) throw new Error('Only a temporary rehearsal HOME is allowed');
await mkdir(out, { recursive: true });
const origin = 'http://127.0.0.1:18439';
async function owner(args: string[]) {
 const response = await fetch('http://localhost/', { unix: join(home, 'install/data/auth.sock'), method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ args }) });
 if (!response.ok) throw new Error('Temporary owner request failed');
 return response.json();
}
if (args.includes('--pair')) {
 await device('adb', 'reverse', 'tcp:18439', 'tcp:18439');
 await owner(['hosts', 'allow', origin]);
 const grant = await owner(['pair', '--backend', origin, '--web-app', origin]) as { url: string; code: string };
 await device('adb', 'shell', 'am', 'start', '-n', 'io.github.mitzacoder.aiki/.MainActivity', '-a', 'android.intent.action.VIEW', '-d', "'" + grant.url + "'");
 await type(/^Backend name$/, 'Sample installed backend', false, true);
 await type(/^12-character code from the CLI$/, grant.code);
 await tap(/^Pair and add backend$/);
 await Bun.sleep(1500);
 console.log('Paired synthetic backend; visible labels:', (await tree()).map(node => node.text || node.desc).filter(Boolean));
} else {
 async function shot(name: string) { await capture(name); await cp(join(artifacts, name + '.png'), join(out, name + '.png')); }
 for (const mode of ['light', 'dark']) {
  await device('adb', 'shell', 'cmd', 'uimode', 'night', mode === 'dark' ? 'yes' : 'no');
  await find(/^Update now$/, 'down'); await shot(`android-phone-${mode}-button`);
  await tap(/^Update now$/); await find(/^Confirm update$/); await shot(`android-phone-${mode}-confirm`); await tap(/^Cancel$/);
 }
}
