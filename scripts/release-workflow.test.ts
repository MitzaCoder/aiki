import { expect, test } from 'bun:test';

type Step = { name?: string; run?: string; uses?: string; with?: Record<string, string> };
type Job = { if?: string; needs?: string; permissions?: { contents?: string }; steps: Step[] };
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
	expect(release.needs).toBe('checks');
	expect(release.permissions?.contents).toBe('write');
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
