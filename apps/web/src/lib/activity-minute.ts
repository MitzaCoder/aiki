import { readable } from 'svelte/store';

/** Shared only by activity lines: one timer, no board/list-level per-second invalidation. */
export const activityMinute = readable(Date.now(), set => {
	set(Date.now());
	const timer = setInterval(() => set(Date.now()), 60_000);
	return () => clearInterval(timer);
});
