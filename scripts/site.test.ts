import { expect, test } from 'bun:test';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { checkSite } from './check-site';

const bootstrap = resolve(import.meta.dir, '../site/install.sh');
const releasePrefix = 'https://github.com/MitzaCoder/kemiri/releases/download/';

test('site links resolve and hero assets stay identical to the README images', async () => {
	expect(await checkSite()).toBeGreaterThan(20);
	for (const theme of ['light', 'dark']) {
		expect(await Bun.file(resolve(import.meta.dir, `../site/assets/graph-${theme}.webp`)).arrayBuffer())
			.toEqual(await Bun.file(resolve(import.meta.dir, `../docs/assets/readme/graph-${theme}.webp`)).arrayBuffer());
	}
	expect(Bun.spawnSync(['sh', '-n', bootstrap]).exitCode).toBe(0);
});

test('site uses canonical Kemiri links and preserves privacy promises', async () => {
	const root = resolve(import.meta.dir, '../site');
	const home = await Bun.file(join(root, 'index.html')).text();
	const privacy = await Bun.file(join(root, 'privacy/index.html')).text();
	expect(home).toContain('curl -fsSL https://kemiri.dev/install.sh | sh');
	for (const [page, path] of [[home, '/'], [privacy, '/privacy/']]) {
		expect(page).toContain(`<link rel="canonical" href="https://kemiri.dev${path}">`);
		expect(page).toContain('mailto:support@kemiri.dev');
		expect(page).not.toContain('https://github.com/MitzaCoder/aiki');
	}
	expect(privacy).toContain('no analytics, tracking cookies, forms or external fonts');
	expect(privacy).toContain('There is no Kemiri-hosted account or central service receiving your conversations in this pilot.');
	expect(privacy).toContain('A future push relay is not active in this pilot.');
});

test('current install guides use the live domain; app help has no retired-domain links', async () => {
	for (const path of ['README.md', 'docs/INSTALL.md', 'docs/AGENT-INSTALL.md', 'docs/SITE.md']) {
		const text = await Bun.file(resolve(import.meta.dir, '../', path)).text();
		expect(text).toContain('https://kemiri.dev/install.sh');
		expect(text).not.toContain('https://aikilabs.dev');
	}
	for (const directory of ['apps/web/src', 'apps/android/app/src/main']) {
		for (const path of new Bun.Glob('**/*.{svelte,ts,kt,xml}').scanSync(resolve(import.meta.dir, '../', directory))) {
			const text = await Bun.file(resolve(import.meta.dir, '../', directory, path)).text();
			expect(text).not.toContain('aikilabs.dev');
		}
	}
});

test('agent install pin matches the site installer default and all fresh install commands use it', async () => {
	const installer = await Bun.file(bootstrap).text();
	const guide = await Bun.file(resolve(import.meta.dir, '../docs/AGENT-INSTALL.md')).text();
	const defaultTag = installer.match(/^version=(v[^\s]+)$/m)?.[1];
	if (!defaultTag) throw new Error('Missing pinned default tag in site/install.sh');
	const guidePins = [...guide.matchAll(/^\s*KEMIRI_VERSION=(v[^\s]+)$/gm)];
	expect(guidePins).toHaveLength(1);
	expect(guidePins[0]?.[1]).toBe(defaultTag);
	expect(guide).toContain('releases/download/$KEMIRI_VERSION');
	expect(guide).toContain('sh install.sh --version "$KEMIRI_VERSION" --dir "$KEMIRI_ROOT" --no-service');
	expect(guide).toContain('sh install.sh --version "$KEMIRI_VERSION" --runtime bun --dir "$KEMIRI_ROOT" --no-service');
	expect(guide).toContain('"refs/tags/$KEMIRI_VERSION^{}"');
	// The bridge is intentionally historical, never a fresh installation pin.
	expect(guide).not.toMatch(/sh (?:install|install-bootstrap)\.sh --version v/);
	expect(guide).not.toContain('aiki-$KEMIRI_VERSION');
	expect(guide).toContain('kemiri-$KEMIRI_VERSION-android-universal.apk');
});

test('site checker rejects the retired bootstrap host with no exception', async () => {
	const scratch = await mkdtemp(join(tmpdir(), 'kemiri-retired-site-'));
	try {
		await writeFile(join(scratch, 'index.html'), '<!doctype html><html lang="en"><title>Kemiri</title><a href="https://kemiri.dev/">Kemiri</a><code>curl https://aikilabs.dev/install.sh</code></html>');
		await expect(checkSite(scratch)).rejects.toThrow('Stale public identity');
	} finally { await rm(scratch, { recursive: true, force: true }); }
});

type Sidecar = 'valid' | 'mismatch' | 'missing' | 'malformed' | 'other-file' | 'multiple';
async function rehearseBootstrap(args: string[], sidecar: Sidecar = 'valid', installerExit = 0) {
	const scratch = await mkdtemp(join(tmpdir(), 'aiki-site-test-'));
	const requests: string[] = [];
	const installer = '#!/bin/sh\nprintf "%s\\n" "$@" > "$KEMIRI_TEST_ARGS"\nexit "$KEMIRI_TEST_EXIT"\n';
	const digest = new Bun.CryptoHasher('sha256').update(installer).digest('hex');
	const server = Bun.serve({
		hostname: '127.0.0.1', port: 0,
		fetch(request) {
			const path = new URL(request.url).pathname;
			requests.push(path);
			if (path.endsWith('/install.sh')) return new Response(installer);
			if (!path.endsWith('/install.sh.sha256') || sidecar === 'missing') return new Response('Not found', { status: 404 });
			const checksum = sidecar === 'mismatch' ? '0'.repeat(64) : digest;
			const contents = sidecar === 'malformed' ? 'not a checksum' : `${checksum}  ${sidecar === 'other-file' ? '/etc/passwd' : 'install.sh'}\n`;
			return new Response(sidecar === 'multiple' ? contents + contents : contents);
		},
	});
	try {
		await mkdir(join(scratch, 'bin'));
		await mkdir(join(scratch, 'tmp'));
		// Only the test process changes curl's destination. Production has no
		// environment variable or flag that can replace its HTTPS installer host.
		await writeFile(join(scratch, 'bin/curl'), `#!/bin/sh
for argument do
 case "$argument" in ${releasePrefix}*) url=$argument ;; esac
done
while [ "$#" -gt 0 ]; do
 case $1 in -o) output=$2; shift 2 ;; *) shift ;; esac
done
exec "$KEMIRI_TEST_CURL" -fsSL "$KEMIRI_TEST_ORIGIN/\${url#${releasePrefix}}" -o "$output"
`, { mode: 0o700 });
		const child = Bun.spawn(['sh', bootstrap, ...args], {
			env: { ...process.env, PATH: `${scratch}/bin:${process.env.PATH}`, TMPDIR: join(scratch, 'tmp'),
				KEMIRI_TEST_CURL: Bun.which('curl')!, KEMIRI_TEST_ORIGIN: server.url.origin,
				KEMIRI_TEST_ARGS: join(scratch, 'args'), KEMIRI_TEST_EXIT: String(installerExit) },
			stdout: 'pipe', stderr: 'pipe',
		});
		const [stdout, stderr, exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
		const executed = await Bun.file(join(scratch, 'args')).exists();
		const forwarded = executed ? (await Bun.file(join(scratch, 'args')).text()).trimEnd().split('\n') : [];
		const leftovers = [...new Bun.Glob('*').scanSync(join(scratch, 'tmp'))];
		return { stdout, stderr, exitCode, executed, forwarded, requests, leftovers };
	} finally {
		server.stop(true);
		await rm(scratch, { recursive: true, force: true });
	}
}

test('bootstrap dry run verifies a pinned default and forwards arguments without word splitting', async () => {
	const run = await rehearseBootstrap(['--no-service', '--dir', '/tmp/example install']);
	expect(run.exitCode).toBe(0);
	expect(run.stdout).toContain('verified GitHub release installer v0.1.0-pilot.5');
	expect(run.forwarded).toEqual(['--version', 'v0.1.0-pilot.5', '--no-service', '--dir', '/tmp/example install']);
	expect(run.requests).toEqual(['/v0.1.0-pilot.5/install.sh', '/v0.1.0-pilot.5/install.sh.sha256']);
	expect(run.leftovers).toEqual([]);
});

test('explicit --version selects both installer assets, preserves args and propagates failure', async () => {
	const args = ['--version', 'v0.0.0-test.150', '--runtime', 'bun', '--no-service'];
	const run = await rehearseBootstrap(args, 'valid', 17);
	expect(run.exitCode).toBe(17);
	expect(run.forwarded).toEqual(args);
	expect(run.requests).toEqual(['/v0.0.0-test.150/install.sh', '/v0.0.0-test.150/install.sh.sha256']);
	expect(run.leftovers).toEqual([]);
});

for (const sidecar of ['mismatch', 'missing', 'malformed', 'other-file', 'multiple'] as const) {
	test(`bootstrap never executes on ${sidecar} checksum and cleans downloads`, async () => {
		const run = await rehearseBootstrap([], sidecar);
		expect(run.exitCode).not.toBe(0);
		expect(run.executed).toBe(false);
		expect(run.leftovers).toEqual([]);
	});
}

for (const args of [['--version'], ['--version', 'latest'], ['--version', '../escape'], ['--version', 'https://example.org/installer']]) {
	test(`bootstrap rejects non-exact version ${JSON.stringify(args)} before downloading`, async () => {
		const run = await rehearseBootstrap(args);
		expect(run.exitCode).not.toBe(0);
		expect(run.requests).toEqual([]);
		expect(run.executed).toBe(false);
	});
}

type PagesJob = { permissions: Record<string, string>; if?: string; needs?: string; environment?: { name: string }; steps: { uses?: string; with?: Record<string, unknown> }[] };
type PagesWorkflow = { on: { push: { branches: string[]; paths: string[] }; workflow_dispatch: unknown }; permissions: Record<string, string>; jobs: { build: PagesJob; deploy: PagesJob } };

test('Pages only publishes main, with immutable actions and separated permissions', async () => {
	const workflow = Bun.YAML.parse(await Bun.file(resolve(import.meta.dir, '../.github/workflows/pages.yml')).text()) as PagesWorkflow;
	expect(workflow.on.push.branches).toEqual(['main']);
	expect(workflow.on.push.paths).toContain('site/**');
	expect(Object.hasOwn(workflow.on, 'workflow_dispatch')).toBe(true);
	expect(workflow.permissions).toEqual({});
	expect(workflow.jobs.build.permissions).toEqual({ contents: 'read' });
	expect(workflow.jobs.deploy.permissions).toEqual({ pages: 'write', 'id-token': 'write' });
	expect(workflow.jobs.deploy.if).toBe("github.ref == 'refs/heads/main'");
	expect(workflow.jobs.deploy.needs).toBe('build');
	expect(workflow.jobs.deploy.environment?.name).toBe('github-pages');
	for (const job of Object.values(workflow.jobs)) {
		for (const step of job.steps) if (step.uses) {
			expect(step.uses).toMatch(/@[a-f0-9]{40}$/);
			if (step.uses.startsWith('actions/checkout@')) expect(step.with?.['persist-credentials']).toBe(false);
		}
	}
});
