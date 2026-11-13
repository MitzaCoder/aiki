/**
 * How workers read in the app: the coordinator's report messages, the link from a
 * `worker_*` tool call to the worker it acted on, and the labels and colours a
 * status gets. Pure functions, so they can be tested without a component.
 */
import { workerSpawnedByCall } from "@kemiri/client";
import {
	CHECK_IN_PREFIX,
	type ModelRef,
	type ThinkingLevel,
	type WorkerModel,
	type WorkerStatus,
	type WorkerSummary,
} from "@kemiri/protocol";
import { sameModel } from "./models.ts";
import type { ToolPart, TranscriptItem } from "./transcript.ts";

/** The tools only the coordinator has; a call to one of them can point at a worker. */
const WORKER_TOOLS = new Set([
	"worker_spawn",
	"worker_send",
	"worker_stop",
	"worker_list",
	"worker_forget",
	"worker_peek",
]);

export function isWorkerTool(name: string): boolean {
	return WORKER_TOOLS.has(name);
}

/**
 * One message a worker posted back to the coordinator. The server writes these as
 * ordinary user inputs, so the transcript has to recognise them to keep them out
 * of the user's own messages.
 */
export type WorkerNotice =
	| { kind: "report"; workerId: string; body: string }
	| { kind: "failure"; workerId: string; failure: string };

const REPORTED = /^\[worker ([^\]\s]+) reported\]\n?/;
const FAILED = /^\[worker ([^\]\s]+) failed: ([\s\S]*)\]$/;

/** Parse `[worker <id> reported]` / `[worker <id> failed: <reason>]`, or undefined for a normal message. */
export function parseWorkerNotice(text: string): WorkerNotice | undefined {
	const trimmed = text.trim();
	// The failure pattern goes first: its reason may itself contain a `]`, and it never ends in "reported]".
	const failed = FAILED.exec(trimmed);
	if (failed !== null) return { kind: "failure", workerId: failed[1], failure: failed[2].trim() };
	const reported = REPORTED.exec(trimmed);
	if (reported !== null) return { kind: "report", workerId: reported[1], body: trimmed.slice(reported[0].length).trim() };
	return undefined;
}

/**
 * The periodic check-in the harness writes about running workers: `[check-in]` and then a digest. The server owns the
 * prefix; the app only needs to keep it out of the user's messages.
 */
export function parseCheckIn(text: string): string | undefined {
	const trimmed = text.trim();
	if (!trimmed.startsWith(CHECK_IN_PREFIX)) return undefined;
	const rest = trimmed.slice(CHECK_IN_PREFIX.length);
	// A check-in always has a line break after the prefix; "[check-in] please" typed by the user is not one.
	if (!/^\s*\n/.test(rest)) return undefined;
	return rest.trim();
}

/**
 * The worker a tool call acted on: the one it spawned (`spawnedByCallId`), else the
 * one its `id` argument names (`worker_send`, `worker_stop`, `worker_forget`).
 */
export function workerForToolCall(
	workers: readonly WorkerSummary[],
	call: { callId: string; name: string; arguments?: unknown },
): WorkerSummary | undefined {
	if (!isWorkerTool(call.name)) return undefined;
	const spawned = workerSpawnedByCall(workers, call.callId);
	if (spawned !== undefined) return spawned;
	const args = call.arguments;
	if (typeof args !== "object" || args === null) return undefined;
	const id = (args as { id?: unknown }).id;
	if (typeof id !== "string" || id.length === 0) return undefined;
	return workers.find((worker) => worker.id === id);
}

/**
 * Workers no board task lists: the coordinator started them without a task. The board shows them, because the
 * task views only reach workers through their task.
 */
export function workersWithoutTask(
	workers: readonly WorkerSummary[],
	tasks: readonly { workerIds: readonly string[] }[],
): WorkerSummary[] {
	const owned = new Set(tasks.flatMap((task) => task.workerIds));
	return sortWorkers(workers.filter((worker) => !owned.has(worker.id) && (worker.taskId ?? null) === null));
}

/** Failed, stopped or forgotten: nothing more will come of the worker. Running and idle ones are still in play. */
export function isFinishedWorker(status: WorkerStatus): boolean {
	return status === "failed" || status === "stopped" || status === "done";
}

/** The loose workers split into the ones in play (running, idle) and the finished ones, each in `workersWithoutTask`'s order. */
export function splitLooseWorkers(loose: readonly WorkerSummary[]): { active: WorkerSummary[]; finished: WorkerSummary[] } {
	return {
		active: loose.filter((worker) => !isFinishedWorker(worker.status)),
		finished: loose.filter((worker) => isFinishedWorker(worker.status)),
	};
}

export function workerStatusLabel(status: WorkerStatus): string {
	switch (status) {
		case "running":
			return "running";
		case "idle":
			return "idle";
		case "failed":
			return "failed";
		case "stopped":
			return "stopped";
		case "done":
			return "done";
	}
}

/** Badge colours per status, in the chat's tokens so a theme carries them. */
export function workerStatusClass(status: WorkerStatus): string {
	switch (status) {
		case "running":
			return "border-transparent bg-(--accent-2)/15 text-(--accent-2)";
		case "idle":
			return "border-(--chat-border) text-(--chat-fg-muted)";
		case "failed":
			return "border-(--chat-danger)/40 bg-(--chat-danger)/10 text-(--chat-danger)";
		case "stopped":
			return "border-(--chat-warning)/40 bg-(--chat-warning)/10 text-(--chat-warning)";
		case "done":
			return "border-(--chat-border) text-(--chat-fg-subtle)";
	}
}

/** Where a worker's tools run: its workspace path, or the shared project checkout. */
export function workerPlace(worker: Pick<WorkerSummary, "isolation" | "workspacePath">): string {
	if (worker.isolation === "shared") return "shared checkout";
	return worker.workspacePath ?? "workspace removed";
}

/** What a tool call did with a worker, for the compact card in the coordinator's transcript. */
export function workerToolAction(name: string): string {
	switch (name) {
		case "worker_spawn":
			return "Started worker";
		case "worker_send":
			return "Sent to worker";
		case "worker_stop":
			return "Stopped worker";
		case "worker_forget":
			return "Forgot worker";
		case "worker_peek":
			return "Peeked at worker";
		default:
			return "Worker";
	}
}

/** A string argument of a tool call, or undefined when it is missing or empty. */
function stringArgument(args: unknown, key: string): string | undefined {
	if (typeof args !== "object" || args === null) return undefined;
	const value = (args as Record<string, unknown>)[key];
	return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

/**
 * The title each worker had just before a `worker_send` that retitled it, by the call's ID. The server's result may
 * name it (`details.previousTitle`); otherwise it is what the transcript last named the worker: its `worker_spawn`
 * title or an earlier `worker_send` title. A call whose worker the transcript never named is left out.
 */
export function workerTitlesBeforeSend(
	items: readonly TranscriptItem[],
	workers: readonly WorkerSummary[],
): Map<string, string> {
	const current = new Map<string, string>();
	const before = new Map<string, string>();
	for (const item of items) {
		if (item.kind !== "turn") continue;
		for (const part of item.parts) {
			if (part.type !== "tool") continue;
			if (part.name === "worker_spawn") {
				const spawned = workerSpawnedByCall(workers, part.callId);
				const id = spawned?.id ?? stringArgument(part.arguments, "id");
				const title = stringArgument(part.arguments, "title");
				if (id !== undefined && title !== undefined) current.set(id, title);
				continue;
			}
			if (part.name !== "worker_send") continue;
			const id = stringArgument(part.arguments, "id");
			const title = stringArgument(part.arguments, "title");
			if (id === undefined || title === undefined) continue;
			const told = stringArgument(part.details, "previousTitle") ?? current.get(id);
			if (told !== undefined) before.set(part.callId, told);
			current.set(id, title);
		}
	}
	return before;
}

/**
 * What a `worker_send` that handed the worker a new title did, in one line; undefined for a send without a title.
 * "Retitled <old> → <new> and sent a message" when the old title is known and differs, else "Sent <new> a new task".
 */
export function workerSendLine(part: Pick<ToolPart, "name" | "arguments">, previousTitle: string | undefined): string | undefined {
	if (part.name !== "worker_send") return undefined;
	const title = stringArgument(part.arguments, "title");
	if (title === undefined) return undefined;
	if (previousTitle !== undefined && previousTitle !== title) return `Retitled ${previousTitle} → ${title} and sent a message`;
	return `Sent ${title} a new task`;
}

/**
 * A worker's report is written line by line ("Outcome: done", "Files changed: …").
 * Markdown joins single newlines into one paragraph, so give each line a hard break
 * outside fenced code, where the line structure is what the coordinator wrote.
 */
export function reportMarkdown(text: string): string {
	let fenced = false;
	return text
		.split("\n")
		.map((line) => {
			if (/^\s*(```|~~~)/.test(line)) {
				fenced = !fenced;
				return line;
			}
			if (fenced || line.trim().length === 0) return line;
			return `${line}  `;
		})
		.join("\n");
}

/** Active workers first, then the forgotten ones, newest first within each group. */
export function sortWorkers(workers: readonly WorkerSummary[]): WorkerSummary[] {
	const active = workers.filter((worker) => worker.status !== "done");
	const done = workers
		.filter((worker) => worker.status === "done")
		.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
	return [...active, ...done];
}

/**
 * A project's default worker models: an ordered preference list, edited in
 * settings. Every operation returns a new list, or the same list when it would
 * change nothing, so a caller can skip a save.
 */
export function hasWorkerModel(models: readonly WorkerModel[], model: ModelRef): boolean {
	return models.some((entry) => sameModel(entry, model));
}

/** Append a model to the preference list; a model already there keeps its place. */
export function addWorkerModel(models: WorkerModel[], model: ModelRef): WorkerModel[] {
	return hasWorkerModel(models, model) ? models : [...models, { provider: model.provider, modelId: model.modelId }];
}

/** Drop a model from the preference list, keeping the order of the rest. */
export function removeWorkerModel(models: WorkerModel[], model: ModelRef): WorkerModel[] {
	const next = models.filter((entry) => !sameModel(entry, model));
	return next.length === models.length ? models : next;
}

/** Add a model that is not in the list, remove one that is: what a click in the catalog does. */
export function toggleWorkerModel(models: WorkerModel[], model: ModelRef): WorkerModel[] {
	return hasWorkerModel(models, model) ? removeWorkerModel(models, model) : addWorkerModel(models, model);
}

/**
 * Set the thinking level that goes with one default worker model. `null` means the model's own default. Returns the
 * same list when the level is already that one, so the caller can skip a save.
 */
export function setWorkerModelThinkingLevel(
	models: WorkerModel[],
	model: ModelRef,
	level: ThinkingLevel | null,
): WorkerModel[] {
	const index = models.findIndex((entry) => sameModel(entry, model));
	const entry = models[index];
	if (entry === undefined || (entry.thinkingLevel ?? null) === level) return models;
	const next = [...models];
	next[index] = { provider: entry.provider, modelId: entry.modelId, thinkingLevel: level };
	return next;
}

/** Move the model at `index` by `delta` places, staying inside the list. */
export function moveWorkerModel(models: WorkerModel[], index: number, delta: number): WorkerModel[] {
	const target = index + delta;
	if (index < 0 || index >= models.length || target < 0 || target >= models.length) return models;
	const next = [...models];
	const [moved] = next.splice(index, 1);
	if (moved === undefined) return models;
	next.splice(target, 0, moved);
	return next;
}
