import { describe, expect, test } from 'bun:test';
import { deliverySettingsSupport, integrationBranchMode, parseDeployFeedPath, parseIntegrationBranch } from '../src/lib/delivery-settings.js';

describe('delivery settings', () => {
	test('requires explicit, independent feature advertisements', () => {
		expect(deliverySettingsSupport(undefined)).toEqual({ integration: false, deploy: false });
		expect(deliverySettingsSupport([])).toEqual({ integration: false, deploy: false });
		expect(deliverySettingsSupport(['task-changes'])).toEqual({ integration: true, deploy: false });
		expect(deliverySettingsSupport(['task-deploys'])).toEqual({ integration: false, deploy: true });
		expect(deliverySettingsSupport(['task-changes', 'task-deploys'])).toEqual({ integration: true, deploy: true });
	});
	test('maps stored refs to modes without losing off or custom values', () => {
		expect(integrationBranchMode(undefined)).toBe('auto');
		expect(integrationBranchMode('auto')).toBe('auto');
		expect(integrationBranchMode(null)).toBe('off');
		expect(integrationBranchMode('refs/heads/trunk')).toBe('custom');
	});
	test('normalizes plain branch names and preserves full local refs', () => {
		expect(parseIntegrationBranch('trunk')).toBe('refs/heads/trunk');
		expect(parseIntegrationBranch(' release/next ')).toBe('refs/heads/release/next');
		expect(parseIntegrationBranch('refs/heads/feature/card-view')).toBe('refs/heads/feature/card-view');
		expect(parseIntegrationBranch('auto')).toBe('refs/heads/auto');
	});
	test('rejects invalid Git heads and nonlocal refs', () => {
		for (const ref of ['', 'refs/heads/', 'refs/tags/v1', 'refs/remotes/origin/main', '../trunk', 'feature..next', 'a//b', '/trunk', 'trunk/', 'trunk.', 'trunk.lock', '.hidden/name', 'a/.hidden', '-trunk', 'two words', 'x@{1}', 'x~1', 'x\0y']) expect(parseIntegrationBranch(ref)).toBeUndefined();
	});
	test('accepts absolute backend paths without interpreting or executing them', () => {
		expect(parseDeployFeedPath('/tmp/synthetic-deploy-journal.json')).toBe('/tmp/synthetic-deploy-journal.json');
		expect(parseDeployFeedPath(' /tmp/sample journal.json ')).toBe('/tmp/sample journal.json');
		expect(parseDeployFeedPath('/' + 'x'.repeat(4095))).toBeDefined();
	});
	test('rejects relative, command-like, NUL and oversized paths', () => {
		for (const path of ['', 'tmp/journal.json', '~/journal.json', 'run-deploy --status', 'file:///tmp/journal.json', '/tmp/x\0y', '/' + 'x'.repeat(4096)]) expect(parseDeployFeedPath(path)).toBeUndefined();
	});
});
