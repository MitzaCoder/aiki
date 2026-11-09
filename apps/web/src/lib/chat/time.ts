/** Times and durations for the transcript, in the reader's locale. */

const clock = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" });
const full = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "medium" });

export function clockTime(ms: number): string {
	return clock.format(new Date(ms));
}

export function fullTime(ms: number): string {
	return full.format(new Date(ms));
}

/** A short duration: 8s, 1m 20s. */
export function duration(ms: number): string {
	const seconds = Math.max(0, Math.round(ms / 1000));
	if (seconds < 60) return `${seconds}s`;
	const minutes = Math.floor(seconds / 60);
	const rest = seconds % 60;
	return rest === 0 ? `${minutes}m` : `${minutes}m ${rest}s`;
}

const compact = new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 });

export function compactNumber(value: number): string {
	return compact.format(value);
}
