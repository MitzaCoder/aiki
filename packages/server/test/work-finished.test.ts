import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { NotificationEvent } from "../src/notifications.ts";
import { WorkFinishedWatch, resolveWorkFinishedMs } from "../src/work-finished.ts";

const cleanups: (() => Promise<void>)[] = [];

afterEach(async () => {
	for (const cleanup of cleanups.splice(0)) await cleanup();
});

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function watchIn(dir: string, clock: { now: number }, sent: NotificationEvent[]): Promise<WorkFinishedWatch> {
	const watch = new WorkFinishedWatch({
		projectDir: dir,
		projectId: "p",
		projectName: () => "Project",
		minWorkMs: 10 * 60_000,
		quietMs: 30,
		now: () => clock.now,
		notify: (event) => sent.push(event),
		log: () => undefined,
	});
	await watch.start();
	cleanups.push(() => watch.stop());
	return watch;
}

describe("work finished", () => {
	it("reads the minimum work from the environment, 10 minutes by default", () => {
		expect(resolveWorkFinishedMs({})).toBe(600_000);
		expect(resolveWorkFinishedMs({ KEMIRI_WORK_FINISHED_MINUTES: "2" })).toBe(120_000);
		expect(resolveWorkFinishedMs({ KEMIRI_WORK_FINISHED_MINUTES: "soon" })).toBe(600_000);
	});

	it("announces once after long work, ignores short work and a short pause, and survives a restart", async () => {
		const dir = await mkdtemp(join(tmpdir(), "work-finished-"));
		cleanups.push(() => rm(dir, { recursive: true, force: true }));
		const clock = { now: Date.parse("2026-11-05T12:00:00.000Z") };
		const sent: NotificationEvent[] = [];
		const watch = await watchIn(dir, clock, sent);

		// Five minutes of work is not worth a push.
		watch.update({ coordinatorWorking: true });
		clock.now += 5 * 60_000;
		watch.update({ coordinatorWorking: false });
		await sleep(80);
		expect(sent).toEqual([]);

		// A worker keeps the project busy; a reply then does not count as the end, and a short pause neither.
		watch.update({ coordinatorWorking: true });
		watch.update({ runningWorkers: 1, coordinatorWorking: false });
		expect(watch.othersRunning).toBe(true);
		clock.now += 8 * 60_000;
		watch.update({ runningWorkers: 0 });
		watch.update({ coordinatorWorking: true });
		await sleep(80);
		expect(sent).toEqual([]);
		clock.now += 4 * 60_000;
		watch.reply("All checks pass.\nDetails below.");
		watch.update({ coordinatorWorking: false });
		await sleep(80);
		expect(sent.map((event) => [event.kind, event.title, event.body])).toEqual([
			["work_finished", "Project finished", "All checks pass."],
		]);

		// The process dies mid-work: the next one still knows when the work started, and announces it with the same key.
		watch.update({ runningThreads: 1 });
		await watch.stop();
		const restarted = await watchIn(dir, clock, sent);
		clock.now += 20 * 60_000;
		restarted.update({ runningThreads: 0 });
		await sleep(80);
		expect(sent).toHaveLength(2);
		expect(sent[1]?.key).toBe(`work_finished:p:${new Date(clock.now - 20 * 60_000).toISOString()}`);
		expect(sent[1]?.body).toBe("All checks pass.");
		expect(sent[1]?.key).not.toBe(sent[0]?.key);
	});
});
