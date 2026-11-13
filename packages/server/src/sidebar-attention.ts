/** Compact summaries from the watches the runtime already owns, not a board watch per client/project. */
import { ProjectAttentionSchema, type ProjectAttention, type Board, type WorkerSummary, type ThreadSummary } from "@kemiri/protocol";
import { Value } from "typebox/value";
import { join } from "node:path";
import { readJsonFile, writeJsonFile } from "./fs-json.ts";

export const EMPTY_ATTENTION: ProjectAttention = {
	questions: 0, warnings: 0, reviewTasks: 0, waitingTasks: 0, nextReturnAt: null,
	failedWorkers: 0, failedThreads: 0, runningWorkers: 0,
	questionTaskId: null, warningTaskId: null, reviewTaskId: null, failedWorkerTaskId: null, failedThreadId: null,
};

export function boardAttention(board: Pick<Board, "questions" | "tasks">): Pick<ProjectAttention, "questions" | "warnings" | "reviewTasks" | "waitingTasks" | "nextReturnAt" | "questionTaskId" | "warningTaskId" | "reviewTaskId"> {
	const questions = board.questions.filter((question) => question.status === "open" && question.kind !== "warning");
	const warnings = board.questions.filter((question) => question.status === "open" && question.kind === "warning");
	const reviews = board.tasks.filter((task) => task.status === "review");
	const waiting = board.tasks.filter((task) => task.status === "waiting");
	const dates = waiting.flatMap((task) => task.waiting?.until && Number.isFinite(Date.parse(task.waiting.until)) ? [task.waiting.until] : []);
	dates.sort((left, right) => Date.parse(left) - Date.parse(right));
	return {
		questions: questions.length, warnings: warnings.length, reviewTasks: reviews.length, waitingTasks: waiting.length,
		nextReturnAt: dates[0] ?? null, questionTaskId: questions[0]?.taskId ?? null,
		warningTaskId: warnings[0]?.taskId ?? null, reviewTaskId: reviews[0]?.id ?? null,
	};
}

export function workerAttention(workers: readonly Pick<WorkerSummary, "status" | "taskId">[]): Pick<ProjectAttention, "runningWorkers" | "failedWorkers" | "failedWorkerTaskId"> {
	const failed = workers.filter((worker) => worker.status === "failed");
	return { runningWorkers: workers.filter((worker) => worker.status === "running").length, failedWorkers: failed.length, failedWorkerTaskId: failed[0]?.taskId ?? null };
}

export function threadAttention(threads: readonly Pick<ThreadSummary, "main" | "archived" | "status" | "id">[]): Pick<ProjectAttention, "failedThreads" | "failedThreadId"> {
	const failed = threads.filter((thread) => !thread.main && !thread.archived && thread.status === "failed");
	return { failedThreads: failed.length, failedThreadId: failed[0]?.id ?? null };
}

/** Small independent file: lists can read it without starting a Harness; writes serialize per project. */
export class ProjectAttentionStore {
	readonly #cache = new Map<string, ProjectAttention | undefined>();
	readonly #writes = new Map<string, Promise<void>>();
	constructor(readonly projectDir: (id: string) => string, readonly onError: (error: unknown) => void = () => undefined) {}
	async read(id: string): Promise<ProjectAttention | undefined> {
		if (this.#cache.has(id)) return this.#cache.get(id);
		let attention: ProjectAttention | undefined;
		try {
			const stored = await readJsonFile(join(this.projectDir(id), "attention.json"));
			if (Value.Check(ProjectAttentionSchema, stored)) attention = { ...stored, runningWorkers: 0 };
		} catch { /* Missing/corrupt summaries fall back to activity, not a broken project list. */ }
		// A watch may have published while the file was being read.
		if (!this.#cache.has(id)) this.#cache.set(id, attention);
		return this.#cache.get(id);
	}
	update(id: string, patch: Partial<ProjectAttention>): boolean {
		const previous = this.#cache.get(id);
		const next = { ...(previous ?? EMPTY_ATTENTION), ...patch };
		if (JSON.stringify(previous) === JSON.stringify(next)) return false;
		this.#cache.set(id, next);
		const write = (this.#writes.get(id) ?? Promise.resolve()).catch(() => undefined)
			.then(() => writeJsonFile(join(this.projectDir(id), "attention.json"), next, 0o600))
			.catch(this.onError);
		this.#writes.set(id, write);
		return true;
	}
	async flush(): Promise<void> { await Promise.all(this.#writes.values()); }
}
