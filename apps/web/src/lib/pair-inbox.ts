import { consumePairFragment, type PairPageLink } from './device-auth.ts';
let link: PairPageLink | undefined;
let error = '';
/** Called by the root layout before any startup work. Never persist the invitation secret. */
export function clearPairFragment(): void {
	if (typeof window === 'undefined' || window.location.pathname !== '/pair' || !window.location.hash) return;
	try {
		link = consumePairFragment(window.location, window.history);
	} catch (e) {
		error = e instanceof Error ? e.message : 'Invalid pairing link.';
	}
}
export function takePairLink(): { link?: PairPageLink; error: string } {
	clearPairFragment();
	const result = { link, error };
	link = undefined;
	return result;
}
