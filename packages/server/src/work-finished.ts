/**
 * The `work_finished` notification: one push when a project goes quiet after a stretch of work, instead of one per
 * reply and report while workers and threads still run.
 *
 * A project is busy while main's coordinator runs, any worker (main's or a thread's) runs, or a background thread runs.
 * The watch records when the project became busy (`busySince`) and the coordinator's last reply. When the project has
 * stayed quiet for `quietMs` (a worker's report and the coordinator's turn that reviews it leave a short gap that is not
 * the end of the work) after at least `minWorkMs` of work, it sends one notification whose body is the first line of
 * that reply. Both values live in `work.json` next to `project.json`, and the notification's dedupe key derives from
 * `busySince`, so a restart neither forgets a stretch of work nor announces it twice.
 */
import { join } from "node:path";
import { errorMessage } from "./errors.ts";
import { readJsonFile, writeJsonFile } from "./fs-json.ts";
import { type NotificationEvent, notificationLine } from "./notifications.ts";

export const WORK_FILE = "work.json";
/** Minutes of continuous work a quiet project must follow before `work_finished` is sent. */
export const WORK_FINISHED_MINUTES_ENV = "AIKI_WORK_FINISHED_MINUTES";
export const DEFAULT_WORK_FINISHED_MINUTES = 10;
/** How long the project must stay quiet before it counts as finished. */
export const DEFAULT_WORK_QUIET_MS = 30_000;

type WorkFile = { version: 1; busySince: string | null; lastReply: string | null };

export function resolveWorkFinishedMs(env: Record<string, string | undefined> = process.env): number {
	const raw = env[WORK_FINISHED_MINUTES_ENV];
	const minutes = raw === undefined || raw.trim() === "" ? Number.NaN : Number(raw);
	return (Number.isFinite(minutes) && minutes >= 0 ? minutes : DEFAULT_WORK_FINISHED_MINUTES) * 60_000;
}

/** What makes a project busy. */
export type ProjectWork = { coordinatorWorking: boolean; runningWorkers: number; runningThreads: number };

export function workFinishedNotification(input: {
	projectId: string;
	projectName: string;
	busySince: string;
	lastReply: string | null;
}): NotificationEvent {
	return {
		kind: "work_finished",
		title: `${input.projectName} finished`,
		body: notificationLine(input.lastReply) || "Nothing is running any more.",
		projectId: input.projectId,
		tag: `work_finished:${input.projectId}`,
		key: `work_finished:${input.projectId}:${input.busySince}`,
	};
}

export class WorkFinishedWatch {
	readonly #file: string;
	readonly #options: {
		projectId: string;
		projectName: () => string;
		minWorkMs: number;
		quietMs: number;
		now: () => number;
		notify: (event: NotificationEvent) => void;
		log: (message: string) => void;
	};
	#work: ProjectWork = { coordinatorWorking: false, runningWorkers: 0, runningThreads: 0 };
	#busySince: string | null = null;
	#lastReply: string | null = null;
	#quietTimer: ReturnType<typeof setTimeout> | undefined;
	#stopped = false;
	#writes: Promise<void> = Promise.resolve();

	constructor(options: {
		projectDir: string;
		projectId: string;
		projectName: () => string;
		minWorkMs: number;
		quietMs: number;
		now: () => number;
		notify: (event: NotificationEvent) => void;
		log: (message: string) => void;
	}) {
		this.#file = join(options.projectDir, WORK_FILE);
		this.#options = options;
	}

	/** Reads what the last process knew; call before the first `update`. */
	async start(): Promise<void> {
		const stored = (await readJsonFile(this.#file).catch(() => undefined)) as Partial<WorkFile> | undefined;
		this.#busySince = typeof stored?.busySince === "string" ? stored.busySince : null;
		this.#lastReply = typeof stored?.lastReply === "string" ? stored.lastReply : null;
	}

	/** Whether workers or background threads still run: a reply then is not the end of the work, so it is not pushed. */
	get othersRunning(): boolean {
		return this.#work.runningWorkers > 0 || this.#work.runningThreads > 0;
	}

	update(change: Partial<ProjectWork>): void {
		if (this.#stopped) return;
		this.#work = { ...this.#work, ...change };
		const busy = this.#work.coordinatorWorking || this.othersRunning;
		if (busy) {
			this.#cancelQuiet();
			if (this.#busySince === null) {
				this.#busySince = new Date(this.#options.now()).toISOString();
				this.#persist();
			}
			return;
		}
		if (this.#busySince === null || this.#quietTimer !== undefined) return;
		const quietAt = this.#options.now();
		this.#quietTimer = setTimeout(() => {
			this.#quietTimer = undefined;
			this.#finish(quietAt);
		}, this.#options.quietMs);
	}

	/** The coordinator's newest final answer, the body of the next `work_finished`. */
	reply(text: string): void {
		this.#lastReply = text;
		this.#persist();
	}

	async stop(): Promise<void> {
		this.#stopped = true;
		this.#cancelQuiet();
		await this.#writes;
	}

	#finish(quietAt: number): void {
		const busySince = this.#busySince;
		if (this.#stopped || busySince === null) return;
		if (quietAt - Date.parse(busySince) >= this.#options.minWorkMs) {
			this.#options.notify(
				workFinishedNotification({
					projectId: this.#options.projectId,
					projectName: this.#options.projectName(),
					busySince,
					lastReply: this.#lastReply,
				}),
			);
		}
		this.#busySince = null;
		this.#persist();
	}

	#cancelQuiet(): void {
		if (this.#quietTimer === undefined) return;
		clearTimeout(this.#quietTimer);
		this.#quietTimer = undefined;
	}

	#persist(): void {
		const file: WorkFile = { version: 1, busySince: this.#busySince, lastReply: this.#lastReply };
		this.#writes = this.#writes
			.then(() => writeJsonFile(this.#file, file))
			.catch((error: unknown) => this.#options.log(`could not save ${WORK_FILE}: ${errorMessage(error)}`));
	}
}
