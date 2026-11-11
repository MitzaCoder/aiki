import { afterEach, expect, test } from 'bun:test';
import { chmod, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CHROMIUM_TIMEOUT_MS, chromiumArguments, renderChromiumDocument } from './support/chromium';

const directories: string[] = [];
afterEach(async () => { for (const dir of directories.splice(0)) await rm(dir, { recursive: true, force: true }); });
async function executable(script: string): Promise<{ binary: string; dir: string }> {
	const dir = await mkdtemp(join(tmpdir(), 'aiki-browser-test-')); directories.push(dir);
	const binary = join(dir, 'browser');
	await Bun.write(binary, `#!/usr/bin/env bash\nexec ${JSON.stringify(process.execPath)} -e ${JSON.stringify(script)}\n`);
	await chmod(binary, 0o755);
	return { binary, dir };
}

test('browser arguments bound CI resources and preserve sandboxing unless explicitly required', () => {
	const args = chromiumArguments('/tmp/fixture with spaces.html', '/tmp/profile', false);
	expect(args).toContain('--headless');
	expect(args).toContain('--disable-dev-shm-usage');
	expect(args).toContain('--disable-background-networking');
	expect(args).not.toContain('--no-sandbox');
	expect(args.at(-1)).toBe('file:///tmp/fixture%20with%20spaces.html');
	expect(chromiumArguments('/tmp/page.html', '/tmp/profile', true)).toContain('--no-sandbox');
	expect(CHROMIUM_TIMEOUT_MS).toBe(90_000);
});

test('drains stderr concurrently with stdout rather than deadlocking on a full pipe', async () => {
	const { binary, dir } = await executable('process.stderr.write("x".repeat(256 * 1024)); console.log("<html>actual output</html>");');
	expect(await renderChromiumDocument('/tmp/page.html', dir, { binary, timeoutMs: 5000 })).toContain('actual output');
});

test('browser errors include the exit code and diagnostic tail, never an availability skip', async () => {
	const { binary, dir } = await executable('console.error("browser startup failure"); process.exit(7);');
	await expect(renderChromiumDocument('/tmp/page.html', dir, { binary })).rejects.toThrow('exited 7');
	await expect(renderChromiumDocument('/tmp/page.html', dir, { binary })).rejects.toThrow('browser startup failure');
	await expect(renderChromiumDocument('/tmp/page.html', dir, { binary: join(dir, 'missing') })).rejects.toThrow();
});

test('startup timeout terminates the owned process group and reports the bound', async () => {
	const { binary, dir } = await executable('setInterval(() => {}, 1000);');
	await expect(renderChromiumDocument('/tmp/page.html', dir, { binary, timeoutMs: 200 })).rejects.toThrow('timed out after 200ms');
}, 5000);
