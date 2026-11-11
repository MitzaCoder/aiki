/** Delivery observation requires explicit advertised capabilities, never legacy assumed support. */
export function deliverySettingsSupport(features: readonly string[] | undefined): { integration: boolean; deploy: boolean } {
	return { integration: features?.includes('task-changes') ?? false, deploy: features?.includes('task-deploys') ?? false };
}

export function integrationBranchMode(ref: string | null | undefined): 'auto' | 'custom' | 'off' {
	return ref === null ? 'off' : ref === undefined || ref === 'auto' ? 'auto' : 'custom';
}

/** The branch picker accepts local heads only. Observation never creates or moves this ref. */
export function parseIntegrationBranch(text: string): string | undefined {
	const input = text.trim();
	const branch = input.startsWith('refs/heads/') ? input.slice('refs/heads/'.length) : input;
	if (input.startsWith('refs/') && !input.startsWith('refs/heads/')) return undefined;
	if (!branch || branch.startsWith('-') || !/^[A-Za-z0-9_./-]+$/.test(branch) || branch.includes('..')) return undefined;
	if (branch.split('/').some(part => !part || part.startsWith('.') || part.endsWith('.') || part.endsWith('.lock'))) return undefined;
	return `refs/heads/${branch}`;
}

export function parseDeployFeedPath(text: string): string | undefined {
	const path = text.trim();
	return path.startsWith('/') && path.length <= 4096 && !path.includes('\0') ? path : undefined;
}
