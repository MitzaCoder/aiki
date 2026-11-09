export type TaskSectionKind =
	| 'report'
	| 'questions'
	| 'feedback'
	| 'files'
	| 'workers'
	| 'related'
	| 'decisions'
	| 'timeline'
	| 'history'
	| 'brief';

/** Report order in the task sheet; history diffs keep their chronological field order. */
export const TASK_SHEET_REPORT_SECTIONS = [
	{ key: 'next', label: 'Next' },
	{ key: 'now', label: 'Now' },
	{ key: 'results', label: 'Results' }
] as const;

/** The last crossed section; at the scroll limit prefer the last visible section instead. */
export function taskSectionIndex(tops: readonly number[], activationLine: number, atEnd = false, viewportBottom = Infinity): number {
	if (tops.length === 0) return -1;
	if (atEnd) {
		for (let i = tops.length - 1; i >= 0; i--) if (tops[i] < viewportBottom) return i;
	}
	let index = 0;
	for (let i = 0; i < tops.length; i++) {
		if (tops[i] <= activationLine + 1) index = i;
	}
	return index;
}

export type TaskSectionSelection = { kind?: TaskSectionKind; pinned: boolean; scrolling: boolean };
export type TaskSectionNavigationEvent =
	| { type: 'select'; kind: TaskSectionKind }
	| { type: 'spy'; kind?: TaskSectionKind }
	| { type: 'scroll-end' | 'user-scroll' };

/** Finishing an animation never gives the spy permission to replace an explicit selection. */
export function taskSectionSelection(state: TaskSectionSelection, event: TaskSectionNavigationEvent): TaskSectionSelection {
	switch (event.type) {
		case 'select': return { kind: event.kind, pinned: true, scrolling: true };
		case 'scroll-end': return { ...state, scrolling: false };
		case 'user-scroll': return { ...state, pinned: false, scrolling: false };
		case 'spy': return state.pinned || state.scrolling ? state : { ...state, kind: event.kind };
	}
}

/** Clamp before scrolling, so a short final section goes all the way to the available limit. */
export function taskSectionScrollTop(scrollTop: number, sectionTop: number, viewportTop: number, inset: number, maxScroll: number): number {
	return Math.max(0, Math.min(maxScroll, scrollTop + sectionTop - viewportTop - inset));
}
