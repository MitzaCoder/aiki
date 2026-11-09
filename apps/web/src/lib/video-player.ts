/**
 * The video player's logic outside the components: the clock, speeds, keyboard shortcuts, taps on a phone, whether a
 * video has sound, where a video stopped and the chosen speed (remembered per browser), and the times in a note that
 * seek the video.
 */

/** The speeds the player offers, slowest first. */
export const PLAYBACK_RATES = [1, 1.25, 1.5, 2, 3] as const;
/** ←/→ move this far. */
export const ARROW_SEEK_SECONDS = 5;
/** J/L, the ±10s buttons and a double tap move this far. */
export const SKIP_SECONDS = 10;
/** `,`/`.` step this far when paused: one frame at 30 fps, what screen recorders mostly write. */
export const FRAME_SECONDS = 1 / 30;
/** The controls hide after this long without movement while the video plays. */
export const CONTROLS_IDLE_MS = 1500;
/** ↑/↓ change the volume by this much. */
export const VOLUME_STEP = 0.05;
/** The centred cue for a key or a double tap stays this long, and a seek pressed again meanwhile adds to it. */
export const CUE_MS = 550;
/** Two taps closer than this are a double tap. */
export const DOUBLE_TAP_MS = 300;

/** A player clock: "0:07", "12:30", "1:02:03". Floors, so the clock never shows a second it has not reached. */
export function formatClock(seconds: number, total = seconds): string {
	const value = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
	const hours = Math.floor(value / 3600);
	const minutes = Math.floor((value % 3600) / 60);
	const rest = String(value % 60).padStart(2, "0");
	const long = hours > 0 || (Number.isFinite(total) && total >= 3600);
	return long ? `${hours}:${String(minutes).padStart(2, "0")}:${rest}` : `${minutes}:${rest}`;
}

/** A speed as the button shows it: "1×", "1.25×". */
export function formatRate(rate: number): string {
	return `${Number(rate.toFixed(2))}×`;
}

/** The next speed up (`step` 1) or down (-1) from `rate`, staying at the ends. */
export function stepRate(rate: number, step: 1 | -1): number {
	if (step > 0) return PLAYBACK_RATES.find((candidate) => candidate > rate + 1e-6) ?? PLAYBACK_RATES[PLAYBACK_RATES.length - 1];
	return [...PLAYBACK_RATES].reverse().find((candidate) => candidate < rate - 1e-6) ?? PLAYBACK_RATES[0];
}

/** A time inside the video; an unknown length only keeps it from going below zero. */
export function clampTime(seconds: number, duration: number): number {
	const floor = Math.max(0, seconds);
	return Number.isFinite(duration) && duration > 0 ? Math.min(floor, duration) : floor;
}

/** The time under a pointer at `x` on a track that starts at `left` and is `width` wide. */
export function timeAtPointer(x: number, left: number, width: number, duration: number): number {
	if (!(width > 0) || !Number.isFinite(duration) || duration <= 0) return 0;
	return Math.min(1, Math.max(0, (x - left) / width)) * duration;
}

export type PlayerAction =
	| { kind: "toggle" }
	| { kind: "seek"; by: number }
	| { kind: "frame"; by: 1 | -1 }
	| { kind: "fullscreen" }
	| { kind: "mute" }
	| { kind: "volume"; by: number }
	| { kind: "rate"; step: 1 | -1 };

export type PlayerKey = { key: string; ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean };

/**
 * What a key does to the player: space/K play or pause, ←/→ move 5s, J/L 10s, `,`/`.` step a frame (when paused), F
 * fullscreen, M mute, ↑/↓ volume, `<`/`>` speed. Undefined for any other key and for any key held with Ctrl, Cmd or Alt, so the
 * browser's own shortcuts keep working.
 */
export function playerKeyAction(event: PlayerKey, paused: boolean): PlayerAction | undefined {
	if (event.ctrlKey || event.metaKey || event.altKey) return undefined;
	switch (event.key) {
		case " ":
		case "k":
		case "K":
			return { kind: "toggle" };
		case "ArrowLeft":
			return { kind: "seek", by: -ARROW_SEEK_SECONDS };
		case "ArrowRight":
			return { kind: "seek", by: ARROW_SEEK_SECONDS };
		case "j":
		case "J":
			return { kind: "seek", by: -SKIP_SECONDS };
		case "l":
		case "L":
			return { kind: "seek", by: SKIP_SECONDS };
		case ",":
			return paused ? { kind: "frame", by: -1 } : undefined;
		case ".":
			return paused ? { kind: "frame", by: 1 } : undefined;
		case "f":
		case "F":
			return { kind: "fullscreen" };
		case "m":
		case "M":
			return { kind: "mute" };
		case "ArrowUp":
			return { kind: "volume", by: VOLUME_STEP };
		case "ArrowDown":
			return { kind: "volume", by: -VOLUME_STEP };
		case "<":
			return { kind: "rate", step: -1 };
		case ">":
			return { kind: "rate", step: 1 };
		default:
			return undefined;
	}
}

/** The seconds a repeated seek adds up to: more presses the same way add, a press the other way starts again. */
export function accumulateSeek(shown: number | undefined, by: number): number {
	return shown !== undefined && Math.sign(shown) === Math.sign(by) ? shown + by : by;
}

/** A seek as the cue shows it: "+10s", "−30s" (a real minus sign). */
export function formatSeekCue(seconds: number): string {
	return `${seconds < 0 ? "−" : "+"}${Math.abs(Number(seconds.toFixed(2)))}s`;
}

/** A volume (0 to 1) as the cue shows it: "65%". */
export function formatVolume(volume: number): string {
	return `${Math.round(Math.min(1, Math.max(0, volume)) * 100)}%`;
}

export type TapZone = "left" | "right";

/** The half of the video a tap at `x` landed on. */
export function tapZone(x: number, left: number, width: number): TapZone {
	return x - left < width / 2 ? "left" : "right";
}

export type Tap = { at: number; zone: TapZone };

/**
 * A tap on a phone: the second of two quick taps on the same half skips (left back, right forward), and so does every
 * quick tap after it; a lone tap shows or hides the controls once no second one came (`DOUBLE_TAP_MS`).
 */
export function classifyTap(previous: Tap | undefined, tap: Tap): "single" | "double" {
	return previous !== undefined && tap.at - previous.at <= DOUBLE_TAP_MS && previous.zone === tap.zone ? "double" : "single";
}

/** What the browser tells about a video's sound; each field only exists in some browsers. */
export type AudioProbe = {
	audioTracks?: { length: number };
	mozHasAudio?: boolean;
	webkitAudioDecodedByteCount?: number;
	webkitVideoDecodedByteCount?: number;
};

/**
 * Whether the video has sound: true or false when the browser can tell, undefined while it cannot yet. Chrome only
 * knows once it decoded some video without any sound, so a silent recording reads as undefined until it played.
 */
export function videoHasAudio(probe: AudioProbe): boolean | undefined {
	if (probe.audioTracks !== undefined) return probe.audioTracks.length > 0;
	if (probe.mozHasAudio !== undefined) return probe.mozHasAudio;
	if (probe.webkitAudioDecodedByteCount !== undefined) {
		if (probe.webkitAudioDecodedByteCount > 0) return true;
		if ((probe.webkitVideoDecodedByteCount ?? 0) > 0) return false;
	}
	return undefined;
}

/** Per browser, like the sidebar. Bumped when the stored shape changes. */
export const VIDEO_STORAGE_KEY = "mihai-harness.video.v1";
/** At most this many videos keep their place; the oldest go first. */
export const VIDEO_POSITIONS_LIMIT = 100;
/** A place this close to the start is not worth resuming. */
export const RESUME_MIN_SECONDS = 5;
/** Nor one this close to the end: the video was watched. */
export const RESUME_END_MARGIN_SECONDS = 5;

export type VideoMemory = {
	rate: number;
	/** Where each video stopped, by `videoKey`, with when (ms since the epoch). */
	positions: Record<string, { time: number; at: number }>;
};

export const DEFAULT_VIDEO_MEMORY: VideoMemory = { rate: 1, positions: {} };

export function videoKey(projectId: string, artifactId: string): string {
	return `${projectId}/${artifactId}`;
}

/** The stored memory, with anything unreadable dropped. */
export function parseVideoMemory(raw: string | null): VideoMemory {
	if (raw === null) return { ...DEFAULT_VIDEO_MEMORY, positions: {} };
	let value: unknown;
	try {
		value = JSON.parse(raw);
	} catch {
		return { ...DEFAULT_VIDEO_MEMORY, positions: {} };
	}
	const record = typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
	const rate = PLAYBACK_RATES.find((candidate) => candidate === record.rate) ?? DEFAULT_VIDEO_MEMORY.rate;
	const positions: VideoMemory["positions"] = {};
	if (typeof record.positions === "object" && record.positions !== null) {
		for (const [key, entry] of Object.entries(record.positions as Record<string, unknown>)) {
			const { time, at } = (entry ?? {}) as Record<string, unknown>;
			if (typeof time === "number" && Number.isFinite(time) && time >= 0 && typeof at === "number" && Number.isFinite(at)) {
				positions[key] = { time, at };
			}
		}
	}
	return { rate, positions };
}

/**
 * The memory with `key`'s place set to `time`, or forgotten when the place is not worth resuming (near the start or the
 * end); only the `VIDEO_POSITIONS_LIMIT` most recent places stay.
 */
export function rememberPosition(memory: VideoMemory, key: string, time: number, duration: number, now: number): VideoMemory {
	const positions = { ...memory.positions };
	delete positions[key];
	if (resumeTime(time, duration) !== undefined) positions[key] = { time, at: now };
	const kept = Object.entries(positions)
		.sort(([, a], [, b]) => b.at - a.at)
		.slice(0, VIDEO_POSITIONS_LIMIT);
	return { ...memory, positions: Object.fromEntries(kept) };
}

/** Where to pick a video up: the stored place, unless it is near the start or the end. */
export function resumeTime(time: number | undefined, duration: number): number | undefined {
	if (time === undefined || !Number.isFinite(time) || time < RESUME_MIN_SECONDS) return undefined;
	if (Number.isFinite(duration) && duration > 0 && time > duration - RESUME_END_MARGIN_SECONDS) return undefined;
	return time;
}

export function loadVideoMemory(storage: Pick<Storage, "getItem"> | undefined = browserStorage()): VideoMemory {
	if (storage === undefined) return parseVideoMemory(null);
	try {
		return parseVideoMemory(storage.getItem(VIDEO_STORAGE_KEY));
	} catch {
		return parseVideoMemory(null);
	}
}

export function saveVideoMemory(memory: VideoMemory, storage: Pick<Storage, "setItem"> | undefined = browserStorage()): void {
	if (storage === undefined) return;
	try {
		storage.setItem(VIDEO_STORAGE_KEY, JSON.stringify(memory));
	} catch {
		// Storage can be full or disabled; the player still works for this session.
	}
}

function browserStorage(): Storage | undefined {
	if (typeof window === "undefined") return undefined;
	try {
		return window.localStorage;
	} catch {
		return undefined;
	}
}

/** "2:15" or "1:02:03" as seconds; undefined when it is not a clock time (minutes or seconds past 59). */
export function parseClock(text: string): number | undefined {
	const match = /^(?:(\d{1,2}):)?(\d{1,2}):(\d{2})$/.exec(text);
	if (match === null) return undefined;
	const hours = match[1] === undefined ? 0 : Number(match[1]);
	const minutes = Number(match[2]);
	const seconds = Number(match[3]);
	if (seconds > 59 || (match[1] !== undefined && minutes > 59)) return undefined;
	return hours * 3600 + minutes * 60 + seconds;
}

/** The fragment a note's time links to; `noteTimeFromHref` reads it back. */
export function noteTimeHref(seconds: number): string {
	return `#t=${seconds}`;
}

export function noteTimeFromHref(href: string | null): number | undefined {
	const match = /^#t=(\d+(?:\.\d+)?)$/.exec(href ?? "");
	return match === null ? undefined : Number(match[1]);
}

// Code fences and spans, links and autolinks, and bare URLs: times inside them stay text.
const SKIPPED = /(```[\s\S]*?(?:```|$)|~~~[\s\S]*?(?:~~~|$)|`[^`\n]*`|!?\[[^\]\n]*\]\([^)\n]*\)|<[^>\s]+>|https?:\/\/\S+)/;
const CLOCK = /(?<![\w:.\/])(?:\d{1,2}:)?\d{1,2}:\d{2}(?!\w|:\d|\.\d)/g;

/**
 * A note's Markdown with each time in it ("at 2:15", "1:02:03") made a link to `noteTimeHref`, for the player to seek
 * to. Times in code, in links and in URLs stay as they are, and so do times past the video's end when its length is
 * known.
 */
export function linkNoteTimes(markdown: string, duration?: number): string {
	return markdown
		.split(SKIPPED)
		.map((part, index) => {
			// `split` with one capture group alternates text and skipped parts.
			if (index % 2 === 1) return part;
			return part.replace(CLOCK, (text) => {
				const seconds = parseClock(text);
				if (seconds === undefined) return text;
				if (duration !== undefined && Number.isFinite(duration) && duration > 0 && seconds > Math.ceil(duration)) return text;
				return `[${text}](${noteTimeHref(seconds)})`;
			});
		})
		.join("");
}

/**
 * Whether a panel `panelWidth` wide beside a video costs it nothing: in a `width` × `height` stage the video of `ratio`
 * is limited by the height even with the panel there. The video dialog opens its details beside the video only then.
 */
export function panelFitsBeside(width: number, height: number, panelWidth: number, ratio: number): boolean {
	if (!(width > 0) || !(height > 0) || !(ratio > 0)) return false;
	return (width - panelWidth) / ratio >= height;
}
