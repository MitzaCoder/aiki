/**
 * The terminal's colours as the page has them right now: the active theme's `--tone-*` variables, resolved to `#rrggbb`
 * (a theme may write them as oklch, which xterm cannot read), and whether the dark tones are on. The pure palette is
 * `xtermColors` in `terminal.ts`.
 */
import { xtermColors, type TerminalTones, type XtermColors } from "./terminal.ts";

let canvas: CanvasRenderingContext2D | null | undefined;

/** Any CSS colour as `#rrggbb`, by painting one pixel with it. Falls back to `fallback` for a value the browser rejects. */
export function resolveColor(value: string, fallback: string): string {
	if (canvas === undefined) canvas = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
	if (canvas === null || canvas === undefined) return fallback;
	canvas.canvas.width = 1;
	canvas.canvas.height = 1;
	canvas.clearRect(0, 0, 1, 1);
	canvas.fillStyle = "#000000";
	canvas.fillStyle = value;
	canvas.fillRect(0, 0, 1, 1);
	const [r, g, b, a] = canvas.getImageData(0, 0, 1, 1).data;
	if (r === undefined || g === undefined || b === undefined || a === undefined || a === 0) return fallback;
	return `#${[r, g, b].map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
}

/** The active theme's tones, resolved. */
export function readTerminalTones(root: HTMLElement = document.documentElement): TerminalTones {
	const style = getComputedStyle(root);
	const tone = (name: string, fallback: string): string => {
		const raw = style.getPropertyValue(`--tone-${name}`).trim();
		return raw === "" ? fallback : resolveColor(raw, fallback);
	};
	return {
		bg: tone("bg", "#000000"),
		fg: tone("fg", "#ffffff"),
		fgMuted: tone("fg-muted", "#aaaaaa"),
		fgSubtle: tone("fg-subtle", "#777777"),
		surface2: tone("surface-2", "#222222"),
		primary: tone("primary", "#6366f1"),
		danger: tone("danger", "#e11d48"),
		success: tone("success", "#059669"),
		warning: tone("warning", "#d97706"),
		accent1: tone("accent-1", "#22d3ee"),
		accent2: tone("accent-2", "#6366f1"),
		accent3: tone("accent-3", "#d946ef"),
		accent4: tone("accent-4", "#fb923c"),
	};
}

/** The palette for the page as it looks now. */
export function currentTerminalColors(root: HTMLElement = document.documentElement): XtermColors {
	return xtermColors(readTerminalTones(root), root.classList.contains("dark"));
}
