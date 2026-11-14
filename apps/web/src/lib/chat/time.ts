/** Times and durations for the transcript, in the reader's locale. */

import { formatTime } from '../time-format.ts';

export function clockTime(ms: number): string {
	return formatTime(ms);
}

export function fullTime(ms: number): string {
	return formatTime(ms, { dateStyle: 'medium', timeStyle: 'medium' });
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
