/**
 * The video player's logic: the clock, speeds, shortcuts, taps, sound detection, the remembered place and speed, and
 * the times in a note that seek the video.
 */
import { describe, expect, test } from "bun:test";
import {
	DOUBLE_TAP_MS,
	VIDEO_POSITIONS_LIMIT,
	VIDEO_STORAGE_KEY,
	clampTime,
	classifyTap,
	formatClock,
	formatRate,
	linkNoteTimes,
	loadVideoMemory,
	noteTimeFromHref,
	noteTimeHref,
	parseClock,
	panelFitsBeside,
	parseVideoMemory,
	accumulateSeek,
	formatSeekCue,
	formatVolume,
	playerKeyAction,
	rememberPosition,
	resumeTime,
	saveVideoMemory,
	stepRate,
	tapZone,
	timeAtPointer,
	videoHasAudio,
	videoKey,
} from "../src/lib/video-player.ts";

describe("formatClock", () => {
	test("floors to whole seconds", () => {
		expect(formatClock(0)).toBe("0:00");
		expect(formatClock(7.9)).toBe("0:07");
		expect(formatClock(750)).toBe("12:30");
		expect(formatClock(3723)).toBe("1:02:03");
	});
	test("shows hours when the whole video runs that long", () => {
		expect(formatClock(65, 3700)).toBe("0:01:05");
	});
	test("treats unknown and negative times as zero", () => {
		expect(formatClock(Number.NaN)).toBe("0:00");
		expect(formatClock(-3)).toBe("0:00");
	});
});

describe("speeds", () => {
	test("step through the offered speeds and stop at the ends", () => {
		expect(stepRate(1, 1)).toBe(1.25);
		expect(stepRate(2, 1)).toBe(3);
		expect(stepRate(3, 1)).toBe(3);
		expect(stepRate(1.5, -1)).toBe(1.25);
		expect(stepRate(1, -1)).toBe(1);
	});
	test("step from a speed between two offered ones", () => {
		expect(stepRate(1.75, 1)).toBe(2);
		expect(stepRate(1.75, -1)).toBe(1.5);
	});
	test("read as the button shows them", () => {
		expect(formatRate(1)).toBe("1×");
		expect(formatRate(1.25)).toBe("1.25×");
	});
});

describe("times", () => {
	test("clampTime keeps a time inside the video", () => {
		expect(clampTime(-4, 100)).toBe(0);
		expect(clampTime(120, 100)).toBe(100);
		expect(clampTime(120, Number.NaN)).toBe(120);
	});
	test("timeAtPointer maps a pointer on the track to a time", () => {
		expect(timeAtPointer(150, 100, 200, 300)).toBe(75);
		expect(timeAtPointer(50, 100, 200, 300)).toBe(0);
		expect(timeAtPointer(400, 100, 200, 300)).toBe(300);
		expect(timeAtPointer(150, 100, 0, 300)).toBe(0);
		expect(timeAtPointer(150, 100, 200, Number.NaN)).toBe(0);
	});
});

describe("playerKeyAction", () => {
	test("maps the shortcuts", () => {
		expect(playerKeyAction({ key: " " }, false)).toEqual({ kind: "toggle" });
		expect(playerKeyAction({ key: "k" }, false)).toEqual({ kind: "toggle" });
		expect(playerKeyAction({ key: "ArrowLeft" }, false)).toEqual({ kind: "seek", by: -5 });
		expect(playerKeyAction({ key: "ArrowRight" }, false)).toEqual({ kind: "seek", by: 5 });
		expect(playerKeyAction({ key: "j" }, false)).toEqual({ kind: "seek", by: -10 });
		expect(playerKeyAction({ key: "L" }, false)).toEqual({ kind: "seek", by: 10 });
		expect(playerKeyAction({ key: "f" }, false)).toEqual({ kind: "fullscreen" });
		expect(playerKeyAction({ key: "m" }, false)).toEqual({ kind: "mute" });
		expect(playerKeyAction({ key: "ArrowUp" }, false)).toEqual({ kind: "volume", by: 0.05 });
		expect(playerKeyAction({ key: "ArrowDown" }, false)).toEqual({ kind: "volume", by: -0.05 });
		expect(playerKeyAction({ key: "<" }, false)).toEqual({ kind: "rate", step: -1 });
		expect(playerKeyAction({ key: ">" }, false)).toEqual({ kind: "rate", step: 1 });
	});
	test("steps frames only when paused", () => {
		expect(playerKeyAction({ key: "." }, true)).toEqual({ kind: "frame", by: 1 });
		expect(playerKeyAction({ key: "," }, true)).toEqual({ kind: "frame", by: -1 });
		expect(playerKeyAction({ key: "." }, false)).toBeUndefined();
	});
	test("leaves modified and other keys to the browser", () => {
		expect(playerKeyAction({ key: "f", ctrlKey: true }, false)).toBeUndefined();
		expect(playerKeyAction({ key: "ArrowLeft", metaKey: true }, false)).toBeUndefined();
		expect(playerKeyAction({ key: "l", altKey: true }, false)).toBeUndefined();
		expect(playerKeyAction({ key: "x" }, false)).toBeUndefined();
	});
});

describe("taps", () => {
	test("tapZone splits the video in halves", () => {
		expect(tapZone(10, 0, 390)).toBe("left");
		expect(tapZone(300, 0, 390)).toBe("right");
	});
	test("two quick taps on the same half are a double tap", () => {
		expect(classifyTap(undefined, { at: 0, zone: "left" })).toBe("single");
		expect(classifyTap({ at: 0, zone: "left" }, { at: DOUBLE_TAP_MS - 1, zone: "left" })).toBe("double");
		expect(classifyTap({ at: 0, zone: "left" }, { at: DOUBLE_TAP_MS + 1, zone: "left" })).toBe("single");
		expect(classifyTap({ at: 0, zone: "left" }, { at: 100, zone: "right" })).toBe("single");
	});
});

describe("videoHasAudio", () => {
	test("believes the browser's track list first", () => {
		expect(videoHasAudio({ audioTracks: { length: 0 }, webkitAudioDecodedByteCount: 10 })).toBe(false);
		expect(videoHasAudio({ audioTracks: { length: 1 } })).toBe(true);
		expect(videoHasAudio({ mozHasAudio: false })).toBe(false);
	});
	test("reads Chrome's decoded bytes once some video was decoded", () => {
		expect(videoHasAudio({ webkitAudioDecodedByteCount: 0, webkitVideoDecodedByteCount: 0 })).toBeUndefined();
		expect(videoHasAudio({ webkitAudioDecodedByteCount: 0, webkitVideoDecodedByteCount: 5000 })).toBe(false);
		expect(videoHasAudio({ webkitAudioDecodedByteCount: 800, webkitVideoDecodedByteCount: 5000 })).toBe(true);
	});
	test("is unknown when the browser says nothing", () => {
		expect(videoHasAudio({})).toBeUndefined();
	});
});

describe("video memory", () => {
	const key = videoKey("p1", "a1");

	test("parses what it stored and drops the rest", () => {
		expect(parseVideoMemory(null)).toEqual({ rate: 1, positions: {} });
		expect(parseVideoMemory("{not json")).toEqual({ rate: 1, positions: {} });
		expect(parseVideoMemory(JSON.stringify({ rate: 7, positions: { a: { time: "x", at: 1 } } }))).toEqual({ rate: 1, positions: {} });
		expect(parseVideoMemory(JSON.stringify({ rate: 1.5, positions: { [key]: { time: 42, at: 9 } } }))).toEqual({
			rate: 1.5,
			positions: { [key]: { time: 42, at: 9 } },
		});
	});

	test("remembers a place worth resuming and forgets one near the start or the end", () => {
		const memory = parseVideoMemory(null);
		expect(rememberPosition(memory, key, 60, 300, 1).positions[key]).toEqual({ time: 60, at: 1 });
		const remembered = rememberPosition(memory, key, 60, 300, 1);
		expect(rememberPosition(remembered, key, 2, 300, 2).positions[key]).toBeUndefined();
		expect(rememberPosition(remembered, key, 298, 300, 2).positions[key]).toBeUndefined();
	});

	test("keeps only the most recent places", () => {
		let memory = parseVideoMemory(null);
		for (let index = 0; index <= VIDEO_POSITIONS_LIMIT; index += 1) memory = rememberPosition(memory, `p/${index}`, 30, 300, index);
		expect(Object.keys(memory.positions)).toHaveLength(VIDEO_POSITIONS_LIMIT);
		expect(memory.positions["p/0"]).toBeUndefined();
		expect(memory.positions[`p/${VIDEO_POSITIONS_LIMIT}`]).toBeDefined();
	});

	test("resumeTime skips the start and the end", () => {
		expect(resumeTime(undefined, 300)).toBeUndefined();
		expect(resumeTime(3, 300)).toBeUndefined();
		expect(resumeTime(120, 300)).toBe(120);
		expect(resumeTime(297, 300)).toBeUndefined();
		expect(resumeTime(120, Number.NaN)).toBe(120);
	});

	test("round-trips through storage and survives a broken one", () => {
		const items = new Map<string, string>();
		const storage = { getItem: (name: string) => items.get(name) ?? null, setItem: (name: string, value: string) => void items.set(name, value) };
		saveVideoMemory({ rate: 2, positions: { [key]: { time: 50, at: 3 } } }, storage);
		expect(items.has(VIDEO_STORAGE_KEY)).toBe(true);
		expect(loadVideoMemory(storage)).toEqual({ rate: 2, positions: { [key]: { time: 50, at: 3 } } });
		const broken = {
			getItem: () => {
				throw new Error("denied");
			},
			setItem: () => {
				throw new Error("full");
			},
		};
		expect(loadVideoMemory(broken)).toEqual({ rate: 1, positions: {} });
		expect(() => saveVideoMemory({ rate: 1, positions: {} }, broken)).not.toThrow();
	});
});

describe("note times", () => {
	test("parseClock reads clock times", () => {
		expect(parseClock("2:15")).toBe(135);
		expect(parseClock("1:02:03")).toBe(3723);
		expect(parseClock("0:61")).toBeUndefined();
		expect(parseClock("1:60:00")).toBeUndefined();
		expect(parseClock("215")).toBeUndefined();
	});

	test("hrefs round-trip", () => {
		expect(noteTimeFromHref(noteTimeHref(135))).toBe(135);
		expect(noteTimeFromHref("#top")).toBeUndefined();
		expect(noteTimeFromHref(null)).toBeUndefined();
	});

	test("links times in text", () => {
		expect(linkNoteTimes("The dialog opens at 2:15 and closes at 1:02:03.")).toBe(
			"The dialog opens at [2:15](#t=135) and closes at [1:02:03](#t=3723).",
		);
		expect(linkNoteTimes("- 0:05 login\n- 0:42: error")).toBe("- [0:05](#t=5) login\n- [0:42](#t=42): error");
	});

	test("leaves code, links, URLs and non-times alone", () => {
		expect(linkNoteTimes("`at 2:15` and\n```\n3:00\n```")).toBe("`at 2:15` and\n```\n3:00\n```");
		expect(linkNoteTimes("[see 2:15](https://x.test/a) and https://x.test:8080/b?t=1:00")).toBe(
			"[see 2:15](https://x.test/a) and https://x.test:8080/b?t=1:00",
		);
		expect(linkNoteTimes("ratio 16:9, version 1.2:30, 12:345, a2:15, 2:15.5")).toBe("ratio 16:9, version 1.2:30, 12:345, a2:15, 2:15.5");
	});

	test("leaves times past the end when the length is known", () => {
		expect(linkNoteTimes("at 0:30 and 9:00", 120)).toBe("at [0:30](#t=30) and 9:00");
	});
});

describe("panelFitsBeside", () => {
	test("only when the video is limited by the height anyway", () => {
		expect(panelFitsBeside(1400, 800, 320, 16 / 9)).toBe(false);
		expect(panelFitsBeside(2500, 1000, 320, 16 / 9)).toBe(true);
		expect(panelFitsBeside(0, 800, 320, 16 / 9)).toBe(false);
	});
});

describe("key cue", () => {
	test("seeks pressed again add up and a turn starts over", () => {
		expect(accumulateSeek(undefined, 5)).toBe(5);
		expect(accumulateSeek(5, 5)).toBe(10);
		expect(accumulateSeek(10, 10)).toBe(20);
		expect(accumulateSeek(-10, -5)).toBe(-15);
		expect(accumulateSeek(15, -5)).toBe(-5);
	});
	test("formats seconds and volume", () => {
		expect(formatSeekCue(10)).toBe("+10s");
		expect(formatSeekCue(-30)).toBe("−30s");
		expect(formatVolume(0.65)).toBe("65%");
		expect(formatVolume(1.2)).toBe("100%");
		expect(formatVolume(-1)).toBe("0%");
	});
});
