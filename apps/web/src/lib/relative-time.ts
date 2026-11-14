import { formatDateTime } from '#lib/time-format.ts';
/**
 * When something happened, in the reader's words: "just now", "5 min ago", "3 h ago", "2 d ago", then a date. Shared by
 * the deploy release line and the memory panel, so every time in the app reads the same way.
 */

/** A timestamp as a short phrase relative to `now`; an unparseable one says so instead of throwing. */
export function relativeTime(at: string, now: number): string {
	const ms = Date.parse(at);
	if (!Number.isFinite(ms)) return "at an unknown time";
	const seconds = Math.round((now - ms) / 1000);
	if (seconds < 45) return "just now";
	const minutes = Math.round(seconds / 60);
	if (minutes < 60) return `${Math.max(1, minutes)} min ago`;
	const hours = Math.round(minutes / 60);
	if (hours < 24) return `${hours} h ago`;
	const days = Math.round(hours / 24);
	if (days < 30) return `${days} d ago`;
	return new Date(ms).toLocaleDateString();
}

/**
 * `relativeTime` in a narrow column, one unit and no "ago": "now", "5m", "3h", "2d", then a short date. A task row's
 * time; the full phrase goes in its title.
 */
export function compactRelativeTime(at: string, now: number): string {
	const ms = Date.parse(at);
	if (!Number.isFinite(ms)) return "";
	const seconds = Math.round((now - ms) / 1000);
	if (seconds < 45) return "now";
	const minutes = Math.round(seconds / 60);
	if (minutes < 60) return `${Math.max(1, minutes)}m`;
	const hours = Math.round(minutes / 60);
	if (hours < 24) return `${hours}h`;
	const days = Math.round(hours / 24);
	if (days < 30) return `${days}d`;
	return new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/**
 * How long since `at`, compact and without a suffix, for a live duration that ticks as `now` advances: "0s", "45s",
 * "3m", "1h 4m" — for example "Running bash · 3m". An unparseable time is empty, so a caller can omit the whole detail.
 */
export function elapsedFor(at: string, now: number): string {
	const ms = Date.parse(at);
	if (!Number.isFinite(ms)) return "";
	const seconds = Math.max(0, Math.round((now - ms) / 1000));
	if (seconds < 60) return `${seconds}s`;
	const minutes = Math.floor(seconds / 60);
	if (minutes < 60) return `${minutes}m`;
	const hours = Math.floor(minutes / 60);
	const remaining = minutes % 60;
	return remaining === 0 ? `${hours}h` : `${hours}h ${remaining}m`;
}

/** The exact time behind a relative phrase, for a title. */
export function exactTime(at: string): string {
	const ms = Date.parse(at);
	return Number.isFinite(ms) ? formatDateTime(ms) : at;
}

/**
 * A timestamp ahead of `now`, as "in 5 min", "in 3 h", "in 2 d": the other direction of `relativeTime`, for a run that
 * has not happened yet. A time already due reads "due now".
 */
export function relativeTimeAhead(at: string, now: number): string {
	const ms = Date.parse(at);
	if (!Number.isFinite(ms)) return "at an unknown time";
	const seconds = Math.round((ms - now) / 1000);
	if (seconds < 45) return "due now";
	const minutes = Math.round(seconds / 60);
	if (minutes < 60) return `in ${minutes} min`;
	const hours = Math.round(minutes / 60);
	if (hours < 24) return `in ${hours} h`;
	const days = Math.round(hours / 24);
	if (days < 30) return `in ${days} d`;
	return new Date(ms).toLocaleDateString();
}
