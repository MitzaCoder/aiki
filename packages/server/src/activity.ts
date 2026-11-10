/**
 * Project activity: what a project is doing, for `ProjectSummary.activity` and its `project.state` pushes.
 *
 * The coordinator's part comes from the transcript: a run in progress (`pi.live.run`) is `working`; otherwise the newest
 * assistant entry decides — an error is `failed`, anything else `idle`. `lastReplyAt`/`lastReplyEntryId` name the newest
 * final answer. `runningTool` is the coordinator's current tool call, from `pi.live.tools`: its name and when it started
 * (a start time this service keeps itself, keyed by call ID, since `pi.live` carries none) or `null` while none runs.
 * The worker count comes from the durable worker list. The service recomputes only when the run starts or ends, a tool
 * call starts or ends (its status, never its streamed output), an entry is appended or a worker's status changes, and
 * `onChange` runs only when the whole value differs.
 *
 * A closed project runs nothing, and a process that died cannot have written its last value: the activity is persisted
 * beside `project.json` (outside the config, which changes rarely) and read back normalized — `working` becomes `idle`
 * and no worker is running — so a list after a restart is right without opening every project. `failed` is a fact about
 * the last run and survives.
 */
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { Context } from "@earendil-works/chord/context";
import type { Conversation, ConversationView, EntryRecord } from "@earendil-works/pi-durable";
import type { ProjectActivity, ProjectRunningTool } from "@aiki/protocol";

type LiveToolSlot = { callId: string; name: string; status: string };

function liveToolSlots(view: ConversationView): readonly LiveToolSlot[] {
	const live = view.docs["pi.live"] as { tools?: LiveToolSlot[] } | undefined;
	return live?.tools ?? [];
}

/**
 * The coordinator's current tool call from a view, approximated without call-ID memory: a running tool's `startedAt` is
 * always "now", since this pure helper keeps no state across calls. `ProjectActivityService` tracks the real start per
 * call ID instead, which is what the app shows.
 */
export function runningToolFrom(view: ConversationView, now: () => number = Date.now): ProjectRunningTool | null {
	const running = liveToolSlots(view).find((tool) => tool.status === "running");
	return running === undefined ? null : { name: running.name, startedAt: new Date(now()).toISOString() };
}
import { join } from "node:path";
import { readJsonFile, writeJsonFile } from "./fs-json.ts";
import type { ProjectStore } from "./projects.ts";

/** Stored next to `project.json`: the last activity values this backend knows for the project. */
export const ACTIVITY_FILE = "activity.json";

/** A project that never ran anything. */
export const DEFAULT_ACTIVITY: ProjectActivity = {
	coordinator: "idle",
	runningWorkers: 0,
	lastReplyAt: null,
	lastReplyEntryId: null,
	runningTool: null,
	openQuestions: 0,
};

export function sameActivity(left: ProjectActivity, right: ProjectActivity): boolean {
	return (
		left.coordinator === right.coordinator &&
		left.runningWorkers === right.runningWorkers &&
		left.lastReplyAt === right.lastReplyAt &&
		left.lastReplyEntryId === right.lastReplyEntryId &&
		(left.openQuestions ?? 0) === (right.openQuestions ?? 0) &&
		(left.backgroundThreads ?? 0) === (right.backgroundThreads ?? 0) &&
		(left.runningTool?.name ?? null) === (right.runningTool?.name ?? null) &&
		(left.runningTool?.startedAt ?? null) === (right.runningTool?.startedAt ?? null)
	);
}

/**
 * The activity a project that is not open can have: nothing runs, so a stale `working` or worker count from a crash
 * becomes `idle`, zero and no running tool. A failure is about the last run and stays.
 */
export function idleActivity(activity: ProjectActivity): ProjectActivity {
	if (activity.coordinator !== "working" && activity.runningWorkers === 0 && (activity.runningTool ?? null) === null) {
		return activity;
	}
	return {
		...activity,
		coordinator: activity.coordinator === "working" ? "idle" : activity.coordinator,
		runningWorkers: 0,
		runningTool: null,
	};
}

/**
 * The stored `runningTool` is never trusted: a tool call cannot survive a restart, and even within one process it is
 * only meaningful while `ProjectActivityService` watches the live transcript. A persisted file always reads `null`;
 * the service recomputes the real value as soon as the project opens.
 */
function parseActivity(value: unknown): ProjectActivity | undefined {
	if (typeof value !== "object" || value === null) return undefined;
	const record = value as Partial<ProjectActivity>;
	const coordinator =
		record.coordinator === "idle" || record.coordinator === "working" || record.coordinator === "failed"
			? record.coordinator
			: undefined;
	if (coordinator === undefined) return undefined;
	if (typeof record.runningWorkers !== "number" || !Number.isInteger(record.runningWorkers) || record.runningWorkers < 0) {
		return undefined;
	}
	const lastReplyAt = typeof record.lastReplyAt === "string" ? record.lastReplyAt : null;
	const lastReplyEntryId =
		typeof record.lastReplyEntryId === "number" && Number.isInteger(record.lastReplyEntryId) && record.lastReplyEntryId > 0
			? record.lastReplyEntryId
			: null;
	const openQuestions =
		typeof record.openQuestions === "number" && Number.isInteger(record.openQuestions) && record.openQuestions >= 0
			? record.openQuestions
			: 0;
	// Absent in files written before background threads, and then left out, as such a file said nothing about them.
	const backgroundThreads =
		typeof record.backgroundThreads === "number" && Number.isInteger(record.backgroundThreads) && record.backgroundThreads >= 0
			? record.backgroundThreads
			: undefined;
	return {
		coordinator,
		runningWorkers: record.runningWorkers,
		lastReplyAt,
		lastReplyEntryId,
		runningTool: null,
		openQuestions,
		...(backgroundThreads === undefined ? {} : { backgroundThreads }),
	};
}

/** Reads and writes the per-project activity file, serialized per project so two changes cannot interleave. */
export class ProjectActivityStore {
	readonly store: ProjectStore;
	readonly #writes = new Map<string, Promise<unknown>>();

	constructor(store: ProjectStore) {
		this.store = store;
	}

	file(projectId: string): string {
		return join(this.store.projectDir(projectId), ACTIVITY_FILE);
	}

	/** The stored activity, or undefined when the project never wrote one (a fresh project, or one from before this). */
	async read(projectId: string): Promise<ProjectActivity | undefined> {
		try {
			const value = await readJsonFile(this.file(projectId));
			return value === undefined ? undefined : parseActivity(value);
		} catch {
			// A corrupt activity file must not make a project list fail; the defaults are the answer until it is rewritten.
			return undefined;
		}
	}

	async write(projectId: string, activity: ProjectActivity): Promise<void> {
		const previous = this.#writes.get(projectId) ?? Promise.resolve();
		const run = previous.then(() => writeJsonFile(this.file(projectId), activity, 0o600));
		this.#writes.set(
			projectId,
			run.catch(() => undefined),
		);
		await run;
	}
}

type AssistantView = { stopReason?: string; timestamp?: number; content?: unknown };

/** The plain text of a message's content blocks. */
function textOfContent(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	const parts: string[] = [];
	for (const part of content) {
		if (typeof part !== "object" || part === null) continue;
		const block = part as { type?: string; text?: string };
		if (block.type === "text") parts.push(block.text ?? "");
	}
	return parts.join("");
}

/** The assistant messages an entry contributes, which is at most one for `pi.assistant`. */
function assistantOf(entry: EntryRecord): AssistantView | undefined {
	const messages = entry.model ?? [];
	for (const message of messages) {
		if (typeof message !== "object" || message === null) continue;
		const record = message as { role?: string } & AssistantView;
		if (record.role === "assistant") return record;
	}
	return undefined;
}

/** The text of a final answer, for the notification that says a reply came. */
export function finalAnswerText(entry: EntryRecord): string {
	return textOfContent(assistantOf(entry)?.content);
}

/** A final answer: the run ended with `stop` or `length`, not with a tool call, an error or an abort. */
function finalAnswer(entry: EntryRecord): { at: string; id: number } | undefined {
	if (entry.kind !== "pi.assistant") return undefined;
	const message = assistantOf(entry);
	if (message?.stopReason !== "stop" && message?.stopReason !== "length") return undefined;
	const at =
		typeof message.timestamp === "number" && Number.isFinite(message.timestamp)
			? new Date(message.timestamp).toISOString()
			: new Date().toISOString();
	return { at, id: entry.id };
}

function newestFinalAnswer(entries: readonly EntryRecord[]): { at: string; id: number } | undefined {
	for (let index = entries.length - 1; index >= 0; index--) {
		const reply = finalAnswer(entries[index]!);
		if (reply !== undefined) return reply;
	}
	return undefined;
}

/** The coordinator's state from a view: a live run wins; otherwise the newest assistant entry decides. */
export function coordinatorState(view: ConversationView): ProjectActivity["coordinator"] {
	const live = view.docs["pi.live"] as { run?: unknown } | undefined;
	if (live !== undefined && live !== null && live.run !== undefined) return "working";
	for (let index = view.entries.length - 1; index >= 0; index--) {
		const entry = view.entries[index]!;
		if (entry.kind !== "pi.assistant") continue;
		const message = assistantOf(entry);
		if (message === undefined) continue;
		return message.stopReason === "error" ? "failed" : "idle";
	}
	return "idle";
}

/**
 * What a view must change in before the activity can: a run starting or ending, a tool call starting or ending (its
 * status, never its streamed output or details), or a finished entry. A token or a growing tool output never costs a
 * recomputation.
 */
export function activitySignal(view: ConversationView): string {
	const live = view.docs["pi.live"] as { run?: unknown } | undefined;
	const tools = liveToolSlots(view)
		.map((tool) => `${tool.callId}:${tool.status}`)
		.join(",");
	return `${view.entries.length}:${view.entries.at(-1)?.id ?? ""}:${live?.run !== undefined}:${tools}`;
}

/** The full activity for a view and a worker count, keeping a reply that compaction dropped from the active transcript. */
export function activityFromView(view: ConversationView, previously: ProjectActivity): ProjectActivity {
	let lastReplyAt = previously.lastReplyAt;
	let lastReplyEntryId = previously.lastReplyEntryId;
	const reply = newestFinalAnswer(view.entries);
	if (reply !== undefined && reply.id > (previously.lastReplyEntryId ?? 0)) {
		lastReplyAt = reply.at;
		lastReplyEntryId = reply.id;
	}
	return {
		coordinator: coordinatorState(view),
		runningWorkers: previously.runningWorkers,
		lastReplyAt,
		lastReplyEntryId,
		runningTool: runningToolFrom(view),
	};
}

/** A coordinator answer the project had not published yet, so it is new since the last value. */
export type ReplyNotice = { entryId: number; at: string; text: string };

/** `pi.live.n`: the newest compaction that failed, kept until a compaction produces a summary again. */
export type CompactionFailureNotice = { taskId: number; reason?: string; error: string };

export type ProjectActivityOptions = {
	/** The project's coordinator conversation. */
	conversation: Conversation;
	/** What the persisted record says; corrected by the first recomputation. */
	initial: ProjectActivity;
	/** Called with the whole value whenever it differs from the last one. */
	onChange(activity: ProjectActivity): void;
	/**
	 * Called once for a final answer the persisted record did not know yet. The watch replays the transcript on restart,
	 * so a value the activity file already held is not a new reply.
	 */
	onReply?: (reply: ReplyNotice) => void;
	/** Called for each compaction failure that appears in `pi.live.n`, once per failed task. */
	onCompactionFailure?: (failure: CompactionFailureNotice) => void;
	/** The Harness clock, for a running tool's `startedAt` and for tests with a fake one. Default: `Date.now`. */
	now?: () => number;
	log?: (message: string) => void;
};

/** One project's activity, kept current while its Harness is open. */
export class ProjectActivityService {
	readonly #conversation: Conversation;
	readonly #onChange: (activity: ProjectActivity) => void;
	readonly #log: (message: string) => void;
	#current: ProjectActivity;
	#runningWorkers: number;
	#openQuestions: number;
	#backgroundThreads: number;
	#view: ConversationView | undefined;
	#signal = "";
	#recovered: { at: string; id: number; entry: EntryRecord } | undefined;
	#compactionTaskId: number | undefined;
	#onReply: ((reply: ReplyNotice) => void) | undefined;
	#onCompactionFailure: ((failure: CompactionFailureNotice) => void) | undefined;
	#now: () => number;
	/** The current round's running tool call's start time, by call ID; `pi.live` carries no timestamp of its own. */
	#toolStarts = new Map<string, number>();
	#stop: (() => Promise<void>) | undefined;
	#started = false;
	#stopped = false;

	constructor(options: ProjectActivityOptions) {
		this.#conversation = options.conversation;
		this.#onChange = options.onChange;
		this.#log = options.log ?? (() => undefined);
		this.#onReply = options.onReply;
		this.#onCompactionFailure = options.onCompactionFailure;
		this.#now = options.now ?? Date.now;
		this.#current = options.initial;
		this.#runningWorkers = options.initial.runningWorkers;
		this.#openQuestions = options.initial.openQuestions ?? 0;
		this.#backgroundThreads = options.initial.backgroundThreads ?? 0;
	}

	get current(): ProjectActivity {
		return this.#current;
	}

	/** Watch the transcript and publish the first value. Idempotent. */
	async start(context: Context = BACKGROUND_CONTEXT): Promise<void> {
		if (this.#started || this.#stopped) return;
		this.#started = true;
		if (this.#current.lastReplyEntryId === null) {
			// The active view no longer holds the last answer after a compaction; the durable history still does.
			this.#recovered = await this.#findLastReply(context);
		}
		let watch;
		try {
			watch = await this.#conversation.watch(context);
		} catch (error) {
			this.#log(`activity watch failed: ${error instanceof Error ? error.message : String(error)}`);
			this.#publish();
			return;
		}
		this.#view = watch.value;
		this.#signal = activitySignal(watch.value);
		this.#stop = async () => {
			await watch.stop().catch(() => undefined);
		};
		// A compaction failure changes nothing the activity reports, so it is read from the same view on every update.
		this.#watchCompaction(watch.value);
		this.#publish();
		watch.start(async (call) => {
			if (call.kind === "failed") throw call.error;
			const value = call.value;
			if (this.#stopped) return;
			this.#watchCompaction(value);
			const signal = activitySignal(value);
			if (signal === this.#signal) return;
			this.#signal = signal;
			this.#view = value;
			this.#publish();
		});
	}

	/** The worker list changed: `runningWorkers` is part of the activity. */
	setRunningWorkers(count: number): void {
		if (this.#stopped || count === this.#runningWorkers) return;
		this.#runningWorkers = count;
		this.#publish();
	}

	/** The board's open question count changed: it is part of the activity. */
	setOpenQuestions(count: number): void {
		if (this.#stopped || count === this.#openQuestions) return;
		this.#openQuestions = count;
		this.#publish();
	}

	/** The background threads at work or waiting changed: their count is part of the activity. */
	setBackgroundThreads(count: number): void {
		if (this.#stopped || count === this.#backgroundThreads) return;
		this.#backgroundThreads = count;
		this.#publish();
	}

	async stop(): Promise<void> {
		if (this.#stopped) return;
		this.#stopped = true;
		const stop = this.#stop;
		this.#stop = undefined;
		await stop?.();
	}

	/** What the view and the worker count say now, without publishing it. */
	next(): ProjectActivity {
		let lastReplyAt = this.#current.lastReplyAt;
		let lastReplyEntryId = this.#current.lastReplyEntryId;
		const fromView = this.#view === undefined ? undefined : newestFinalAnswer(this.#view.entries);
		for (const candidate of [this.#recovered, fromView]) {
			if (candidate !== undefined && candidate.id > (lastReplyEntryId ?? 0)) {
				lastReplyAt = candidate.at;
				lastReplyEntryId = candidate.id;
			}
		}
		const coordinator = this.#view === undefined ? this.#current.coordinator : coordinatorState(this.#view);
		const runningTool = this.#view === undefined ? null : this.#runningTool(this.#view);
		return {
			coordinator,
			runningWorkers: this.#runningWorkers,
			lastReplyAt,
			lastReplyEntryId,
			runningTool,
			openQuestions: this.#openQuestions,
			backgroundThreads: this.#backgroundThreads,
		};
	}

	/**
	 * The coordinator's current tool call, with its real start time: `pi.live` carries none, so this keeps one per call ID,
	 * set the first time a call is seen running and dropped once it leaves `pi.live.tools` (the round ends or it settles).
	 */
	#runningTool(view: ConversationView): ReturnType<typeof runningToolFrom> {
		const tools = liveToolSlots(view);
		const liveIds = new Set(tools.map((tool) => tool.callId));
		for (const callId of this.#toolStarts.keys()) if (!liveIds.has(callId)) this.#toolStarts.delete(callId);
		const running = tools.find((tool) => tool.status === "running");
		if (running === undefined) return null;
		let startedAt = this.#toolStarts.get(running.callId);
		if (startedAt === undefined) {
			startedAt = this.#now();
			this.#toolStarts.set(running.callId, startedAt);
		}
		return { name: running.name, startedAt: new Date(startedAt).toISOString() };
	}

	#publish(): void {
		if (this.#stopped) return;
		const previous = this.#current;
		const next = this.next();
		if (sameActivity(next, previous)) return;
		this.#current = next;
		try {
			this.#onChange(next);
		} catch (error) {
			this.#log(`activity listener failed: ${error instanceof Error ? error.message : String(error)}`);
		}
		// An answer the value never held is new: a replay of what the activity file already recorded is not.
		if (next.lastReplyEntryId !== null && next.lastReplyEntryId !== previous.lastReplyEntryId) {
			this.#notifyReply(next.lastReplyEntryId, next.lastReplyAt);
		}
	}

	#notifyReply(entryId: number, at: string | null): void {
		if (this.#onReply === undefined) return;
		const entry = this.#entryById(entryId);
		try {
			this.#onReply({
				entryId,
				at: at ?? new Date().toISOString(),
				text: entry === undefined ? "" : finalAnswerText(entry),
			});
		} catch (error) {
			this.#log(`reply listener failed: ${error instanceof Error ? error.message : String(error)}`);
		}
	}

	#entryById(entryId: number): EntryRecord | undefined {
		const recovered = this.#recovered;
		if (recovered !== undefined && recovered.id === entryId) return recovered.entry;
		return this.#view?.entries.find((entry) => entry.id === entryId);
	}

	/** Report a failed compaction once, however often the view is replayed. */
	#watchCompaction(view: ConversationView): void {
		const live = view.docs["pi.live"] as { compactionFailure?: { taskId?: unknown; trigger?: unknown; error?: unknown } } | undefined;
		const failure = live?.compactionFailure;
		if (failure === undefined || typeof failure.taskId !== "number") return;
		if (failure.taskId === this.#compactionTaskId) return;
		this.#compactionTaskId = failure.taskId;
		try {
			this.#onCompactionFailure?.({
				taskId: failure.taskId,
				...(typeof failure.trigger === "string" ? { reason: failure.trigger } : {}),
				error: typeof failure.error === "string" ? failure.error : "",
			});
		} catch (error) {
			this.#log(`compaction failure listener failed: ${error instanceof Error ? error.message : String(error)}`);
		}
	}

	async #findLastReply(context: Context): Promise<{ at: string; id: number; entry: EntryRecord } | undefined> {
		try {
			const page = await this.#conversation.entries({ order: "descending" }, 100, undefined, context);
			for (const entry of page.items) {
				const reply = finalAnswer(entry);
				if (reply !== undefined) return { ...reply, entry };
			}
			return undefined;
		} catch (error) {
			this.#log(`activity could not read the last reply: ${error instanceof Error ? error.message : String(error)}`);
			return undefined;
		}
	}
}
