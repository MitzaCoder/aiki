import type { SubscriptionResetCredit } from '@aiki/protocol';

export type ResetGroup = { credit: SubscriptionResetCredit; remaining: number };
/** Group only interchangeable grants. Keep their opaque IDs for an explicit single-grant spend. */
export function groupResets(credits: SubscriptionResetCredit[]): ResetGroup[] {
	const groups = new Map<string, ResetGroup>();
	for (const credit of credits.filter(c => c.remaining > 0)) {
		const key = JSON.stringify([credit.program, credit.label, credit.expiresAt, [...credit.clears].sort(), credit.givesBackWeekly === true, credit.usable, credit.unavailableReason]);
		const group = groups.get(key);
		if (group) group.remaining += credit.remaining;
		else groups.set(key, { credit, remaining: credit.remaining });
	}
	return [...groups.values()];
}
export function resetExplanation(credit: SubscriptionResetCredit): string {
	const scopes = credit.clears.map(scope => ({ five_hour: 'your 5-hour limit', seven_day: 'your weekly limit', seven_day_fable: 'your Fable allowance', seven_day_overage_included: 'your Fable allowance', seven_day_opus: 'your Opus allowance', seven_day_sonnet: 'your Sonnet allowance' }[scope] ?? scope.replaceAll('_', ' ')));
	return `This refills ${scopes.join(' and ') || 'the provider’s covered limits'}${credit.givesBackWeekly ? ' and gives back what Fable used on your weekly limit' : ''}.`;
}
export function resetExpiry(expiresAt: string | null, remaining: number): string {
	if (!expiresAt) return 'No expiry reported';
	return `${remaining > 1 ? 'all expire' : 'expires'} ${new Date(expiresAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`;
}
export function resetUnavailableReason(credit: SubscriptionResetCredit): string {
	return (credit.unavailableReason || 'Not usable now').replaceAll('_', ' ');
}
