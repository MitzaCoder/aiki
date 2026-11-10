/**
 * Thinking levels as a dropdown shows them. Pure, so the order, the labels and the "keep what is stored" rule are
 * tested without a component.
 */
import type { ComboOption } from "./combobox.ts";
import type { ThinkingLevel } from "@aiki/protocol";

/** Increasing effort, as the protocol lists them. */
export const THINKING_ORDER: readonly ThinkingLevel[] = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];

/** How many of four bars a level lights; 0 for "model default" and "off". */
export function thinkingBars(level: ThinkingLevel | null): number {
	if (level === null) return 0;
	return { off: 0, minimal: 1, low: 1, medium: 2, high: 3, xhigh: 4, max: 4 }[level];
}

export function thinkingLabel(level: ThinkingLevel | null): string {
	return level === null ? "Model default" : `${level[0]?.toUpperCase()}${level.slice(1)}`;
}

const HINTS: Record<ThinkingLevel, string> = {
	off: "No extra reasoning",
	minimal: "A moment of thought",
	low: "Light reasoning",
	medium: "Balanced",
	high: "Careful, slower",
	xhigh: "Very thorough",
	max: "As much as the model allows",
};

/**
 * "Model default" first, then the model's levels in increasing effort. A stored level the model does not list stays
 * in the list, so the dropdown shows what is saved instead of going blank.
 */
export function thinkingOptions(levels: readonly ThinkingLevel[], current: ThinkingLevel | null): ComboOption[] {
	const shown = new Set<ThinkingLevel>(levels);
	if (current !== null) shown.add(current);
	const ordered = THINKING_ORDER.filter((level) => shown.has(level));
	return [
		{ value: "", label: thinkingLabel(null), description: "Leave it to the model" },
		...ordered.map((level) => ({
			value: level,
			label: thinkingLabel(level),
			description: levels.includes(level) ? HINTS[level] : `${HINTS[level]} (this model does not list it)`,
		})),
	];
}
