import { expect, test } from 'bun:test';

type Step = { name?: string; run?: string; uses?: string; with?: Record<string, string> };
type Job = { if?: string; needs?: string | string[]; permissions?: { contents?: string }; steps: Step[]; strategy?: { matrix: { include: { runner: string; target: string; platform: string }[] } } };
type Workflow = { on: { push: { branches: string[]; tags: string[] }; workflow_dispatch: unknown }; permissions: { contents: string }; jobs: Record<string, Job> };
const workflow = Bun.YAML.parse(await Bun.file(new URL('../.github/workflows/release.yml', import.meta.url)).text()) as Workflow;

test('branch and manual release checks share the real test job without release permissions or publishing', () => {
	expect(Object.hasOwn(workflow.on, 'workflow_dispatch')).toBe(true);
	expect(workflow.on.push.branches).toContain('ci/release-check');
	expect(workflow.on.push.tags).toEqual(['v[0-9]*.[0-9]*.[0-9]*']);
	expect(workflow.permissions.contents).toBe('read');
	const checks = workflow.jobs.checks!;
	expect(checks.permissions?.contents ?? workflow.permissions.contents).toBe('read');
	expect(checks.steps.some(step => step.run === 'bun install --frozen-lockfile')).toBe(true);
	expect(checks.steps.some(step => step.run === 'bun test && bun run typecheck')).toBe(true);
	expect(checks.steps.some(step => step.run === 'bun run check && bun run build && bun test')).toBe(true);
	expect(checks.steps.some(step => /gh release (create|upload|edit)/.test(step.run ?? ''))).toBe(false);
	const release = workflow.jobs.release!;
	expect(release.if).toBe("github.event_name == 'push' && startsWith(github.ref, 'refs/tags/')");
	expect(release.needs).toEqual(['checks', 'binaries']);
	expect(release.permissions?.contents).toBe('write');
});

test('native binary builds use standard runners, clean smoke tests and production-only artifacts', () => {
	const binaries = workflow.jobs.binaries!;
	expect(binaries.needs).toBe('checks');
	expect(binaries.permissions?.contents ?? workflow.permissions.contents).toBe('read');
	expect(binaries.strategy?.matrix.include.map(row => [row.runner, row.target])).toEqual([
		['ubuntu-24.04', 'bun-linux-x64-baseline'],
		['ubuntu-24.04-arm', 'bun-linux-arm64'],
		['macos-15', 'bun-darwin-arm64'],
	]);
	const commands = binaries.steps.map(step => step.run ?? '').join('\n');
	expect(commands).toContain('uname -m');
	expect(commands).toContain('scripts/build-binary.ts');
	expect(commands).toContain('--smoke');
	expect(commands).toContain('scripts/smoke-binary.py');
	expect(commands).toContain('/lib64/ld-linux-x86-64.so.2');
	expect(commands).toContain('/lib/ld-linux-aarch64.so.1');
	const upload = binaries.steps.find(step => step.name === 'Keep only production executable and checksum')!;
	expect(upload.with?.path).not.toContain('*');
	expect(upload.with?.path).not.toContain('-smoke');
	expect(upload.with?.['if-no-files-found']).toBe('error');
	const releaseCommands = workflow.jobs.release!.steps.map(step => step.run ?? '').join('\n');
	expect(releaseCommands).toContain('sha256sum --check');
	expect(releaseCommands).toContain('cat ./*.sha256 > SHA256SUMS');
	expect(releaseCommands).toContain('for platform in linux-x64 linux-arm64 darwin-arm64');
	for (const line of releaseCommands.split('\n').filter(line => line.includes('gh release create'))) expect(line).toContain('--draft');
	expect(releaseCommands).not.toMatch(/gh release (edit|publish)/);
});

test('all release actions are immutable and only the tag release job can write', () => {
	for (const [name, job] of Object.entries(workflow.jobs)) {
		for (const step of job.steps) if (step.uses) expect(step.uses).toMatch(/@[a-f0-9]{40}$/);
		if (name !== 'release') expect(job.permissions?.contents ?? workflow.permissions.contents).toBe('read');
	}
});

test('the pinned dedicated browser is installed before root/browser tests and its archive is hash-checked', async () => {
	const steps = workflow.jobs.checks!.steps;
	const browser = steps.findIndex(step => step.name === 'Install pinned headless shell');
	const tests = steps.findIndex(step => step.run === 'bun test && bun run typecheck');
	expect(browser).toBeGreaterThanOrEqual(0);
	expect(browser).toBeLessThan(tests);
	const setup = await Bun.file(new URL('./setup-test-browser.sh', import.meta.url)).text();
	const version = setup.match(/^version=(.+)$/m)![1]!;
	const digest = setup.match(/^digest=([a-f0-9]{64})$/m)![1]!;
	const cache = steps.find(step => step.name === 'Cache pinned headless shell archive')!;
	expect(cache.with?.key).toContain(version);
	expect(cache.with?.key).toContain(digest);
	expect(setup).toContain('sha256sum --check');
	expect(setup).toContain('chrome-for-testing-public');
});
