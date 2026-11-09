/** Paging policy shared by scroll, resize and post-page checks (including an underfilled viewport). */
export function shouldPrefetchEarlier(
	scrollTop: number,
	viewportHeight: number,
	canLoadEarlier: boolean,
	loadingEarlier: boolean,
	failed: boolean,
): boolean {
	return viewportHeight > 0 && scrollTop <= viewportHeight * 1.5 && canLoadEarlier && !loadingEarlier && !failed;
}

export type EarlierPageState = { loading: boolean; failed: boolean };

/** The local guard closes the gap before the watch's loading prop reaches the component. Errors latch until Retry. */
export async function loadEarlierPage(state: EarlierPageState, load: () => void | Promise<void>): Promise<void> {
	if (state.loading) return;
	state.loading = true;
	state.failed = false;
	try {
		await load();
	} catch {
		state.failed = true;
	} finally {
		state.loading = false;
	}
}
