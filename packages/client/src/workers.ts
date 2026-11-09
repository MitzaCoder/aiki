/**
 * Helpers on top of the protocol's worker types: the link from a coordinator tool call to the worker it started, the
 * harness' own inputs in the coordinator's transcript, and small groupings a UI needs.
 */
import { CHECK_IN_PREFIX, WORKER_REPORT_PREFIX } from "@mihai-harness/protocol";
import type { WorkerStatus, WorkerSummary } from "@mihai-harness/protocol";
import { ClientError } from "./errors.ts";

/**
 * The worker an assistant tool call started, if any. `toolCall.id` comes from the call in a `pi.assistant` entry; the
 * server records it on the worker it spawned, so a transcript can link straight to the worker's conversation.
 */
export function workerSpawnedByCall(
	workers: readonly WorkerSummary[],
	callId: string,
): WorkerSummary | undefined {
	return workers.find((worker) => worker.spawnedByCallId === callId);
}

/** Whether a user message is the worker model the harness wrote, rather than the user's own words. */
export function isWorkerReport(text: string): boolean {
	return text.startsWith(WORKER_REPORT_PREFIX);
}

/**
 * A worker report as the harness posts it: `[worker <id> reported]` and the report's text after it. A failure arrives
 * as `[worker <id> failed: <reason>]` with no worker ID to match, so `body` is then the whole text.
 */
export function parseWorkerReport(text: string): { workerId: string; body: string } | undefined {
	const match = /^\[worker (\S+) reported\]\n?([\s\S]*)$/.exec(text);
	return match === null ? undefined : { workerId: match[1] ?? "", body: match[2] ?? "" };
}

/**
 * The periodic check-in on running workers: the harness wakes the coordinator with a message starting with
 * `[check-in]` while at least one worker runs, carrying a digest of each of them. A UI renders it differently from a
 * user message, and from a worker report.
 */
export function isCheckInMessage(text: string): boolean {
	return text.startsWith(CHECK_IN_PREFIX);
}

/** Workers that still do work: running, idle or failed. Forgotten ones are history. */
export function activeWorkers(workers: readonly WorkerSummary[]): WorkerSummary[] {
	return workers.filter((worker) => worker.status !== "done");
}

/** Whether a status means the worker is processing a message right now. */
export function isWorkerRunning(status: WorkerStatus): boolean {
	return status === "running";
}

/** A worker's workspace, or undefined when it works in the shared checkout or its workspace was removed. */
export function workerWorkspace(worker: WorkerSummary): string | undefined {
	return worker.workspacePath ?? undefined;
}

/**
 * How far a backend has got with storing the composer's worker pick: `unknown` before the first attempt, `supported`
 * once it accepted one, `unsupported` when it answered `unknown_request` (a release from before
 * `workers.defaults.set`).
 */
export type WorkerDefaultsSupport = "unknown" | "supported" | "unsupported";

/**
 * Whether the composer's worker pick must still ride on the next message. It does until the backend confirms it stored
 * one, and only once the worker list has loaded: a pick made before that is not sent, so a choice made on another device
 * is never clobbered with this screen's empty state.
 */
export function shouldSendWorkerDefaults(loaded: boolean, support: WorkerDefaultsSupport): boolean {
	return loaded && support !== "supported";
}

/** Whether a failed `workers.defaults.set` only means the backend is older than the request. */
export function defaultsSetUnsupported(error: unknown): boolean {
	return error instanceof ClientError && error.code === "unknown_request";
}
