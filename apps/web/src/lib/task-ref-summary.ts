import type { RefStatus } from '@aiki/protocol';

/** Compact counts plus the most actionable live state; missing status is never treated as done. */
export function taskRefSummary(statuses: readonly (RefStatus | undefined)[]): { counts: string; status: string; attention: boolean } {
	const count = (kind: RefStatus['kind']) => statuses.filter((entry) => entry?.kind === kind).length;
	const unknown = statuses.filter((entry) => entry === undefined).length;
	const pulls = count('pull');
	const issues = count('issue');
	const tickets = count('jira');
	const counts = [pulls && `${pulls} PR${pulls === 1 ? '' : 's'}`, issues && `${issues} issue${issues === 1 ? '' : 's'}`, tickets && `${tickets} ticket${tickets === 1 ? '' : 's'}`, unknown && `${unknown} unknown`].filter(Boolean).join(' · ');
	const openPull = (entry: RefStatus | undefined) => entry?.kind === 'pull' && (entry.state === 'open' || entry.state === 'draft');
	const failing = statuses.filter((entry) => openPull(entry) && entry?.kind === 'pull' && entry.checks === 'failing').length;
	const running = statuses.filter((entry) => openPull(entry) && entry?.kind === 'pull' && entry.checks === 'pending').length;
	const done = statuses.filter((entry) => entry?.kind === 'pull' ? entry.state === 'merged' || entry.state === 'closed' : entry?.kind === 'issue' ? entry.state === 'closed' : entry?.kind === 'jira' && entry.category === 'done').length;
	const open = statuses.length - done - unknown;
	const status = failing || running
		? [failing && `${failing} PR${failing === 1 ? '' : 's'} failing checks`, running && `${running} PR${running === 1 ? '' : 's'} running checks`]
		: [open && `${open} open`, done && `${done} closed`, unknown && `${unknown} status unknown`];
	return { counts: unknown === statuses.length ? `${unknown} ref${unknown === 1 ? '' : 's'}` : counts, status: status.filter(Boolean).join(' · '), attention: failing > 0 };
}
