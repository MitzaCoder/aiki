/**
 * Worker helpers: the coordinator's report messages are ordinary user inputs on
 * the wire, so recognising them (and linking a `worker_*` call to its worker) is
 * logic that lives outside the components and is tested here.
 */
import { describe, expect, test } from "bun:test";
import type { WorkerSummary } from "@mihai-harness/protocol";
import {
	addWorkerModel,
	hasWorkerModel,
	moveWorkerModel,
	parseCheckIn,
	parseWorkerNotice,
	removeWorkerModel,
	reportMarkdown,
	setWorkerModelThinkingLevel,
	sortWorkers,
	toggleWorkerModel,
	workerForToolCall,
	workerPlace,
	workerSendLine,
	workerStatusClass,
	workerStatusLabel,
	workerTitlesBeforeSend,
	workerToolAction,
	isFinishedWorker,
	splitLooseWorkers,
	workersWithoutTask,
} from "../src/lib/workers.ts";
import type { ToolPart, TranscriptItem } from "../src/lib/transcript.ts";

function worker(overrides: Partial<WorkerSummary> & { id: string }): WorkerSummary {
	return {
		id: overrides.id,
		title: `Worker ${overrides.id}`,
		status: "running",
		model: { provider: "anthropic", modelId: "claude" },
		thinkingLevel: null,
		isolation: "shared",
		workspacePath: null,
		conversationId: 7,
		spawnedByCallId: null,
		createdAt: "2026-10-30T10:00:00.000Z",
		updatedAt: "2026-10-30T10:05:00.000Z",
		lastReport: null,
		failure: null,
		...overrides,
	};
}

describe("parseWorkerNotice", () => {
	test("recognises a report and keeps its body", () => {
		expect(parseWorkerNotice("[worker alpha reported]\n## Report\nOutcome: done")).toEqual({
			kind: "report",
			workerId: "alpha",
			body: "## Report\nOutcome: done",
		});
	});

	test("recognises a report with no body and trims it", () => {
		expect(parseWorkerNotice("[worker a-1.b reported]")).toEqual({
			kind: "report",
			workerId: "a-1.b",
			body: "",
		});
		expect(parseWorkerNotice("  [worker alpha reported]  \n\n text \n")).toEqual({
			kind: "report",
			workerId: "alpha",
			body: "text",
		});
	});

	test("recognises a failure, including a reason that contains brackets", () => {
		expect(parseWorkerNotice('[worker alpha failed: Model error: [400] bad request]')).toEqual({
			kind: "failure",
			workerId: "alpha",
			failure: "Model error: [400] bad request",
		});
	});

	test("leaves ordinary messages alone", () => {
		expect(parseWorkerNotice("Hello")).toBeUndefined();
		expect(parseWorkerNotice("Look, [worker alpha reported] this")).toBeUndefined();
		expect(parseWorkerNotice("")).toBeUndefined();
	});
});

describe("parseCheckIn", () => {
	test("recognises the harness' digest and keeps it", () => {
		const text = "[check-in]\n2 workers are still running. Decide whether any is stuck.\n\nalpha — Fix the parser\nstatus: running";
		expect(parseCheckIn(text)).toBe(
			"2 workers are still running. Decide whether any is stuck.\n\nalpha — Fix the parser\nstatus: running",
		);
	});

	test("leaves a message that merely starts with the prefix alone", () => {
		expect(parseCheckIn("[check-in] please")).toBeUndefined();
		expect(parseCheckIn("Hello")).toBeUndefined();
	});
});

describe("workerForToolCall", () => {
	const alpha = worker({ id: "alpha", spawnedByCallId: "call-1" });
	const beta = worker({ id: "beta", spawnedByCallId: "call-2" });
	const workers = [alpha, beta];

	test("links a spawn to the worker it created", () => {
		expect(
			workerForToolCall(workers, { callId: "call-1", name: "worker_spawn", arguments: { id: "other" } }),
		).toBe(alpha);
	});

	test("falls back to the id argument for later calls", () => {
		expect(workerForToolCall(workers, { callId: "call-9", name: "worker_send", arguments: { id: "beta" } })).toBe(
			beta,
		);
	});

	test("ignores calls that are not about one worker", () => {
		expect(workerForToolCall(workers, { callId: "call-9", name: "worker_list", arguments: {} })).toBeUndefined();
		expect(workerForToolCall(workers, { callId: "call-9", name: "bash", arguments: { id: "alpha" } })).toBeUndefined();
		expect(workerForToolCall(workers, { callId: "call-9", name: "worker_send", arguments: { id: "nope" } })).toBeUndefined();
	});
});

describe("reportMarkdown", () => {
	test("keeps the report's lines apart, and leaves code fenced", () => {
		expect(reportMarkdown("## Report\nOutcome: done\nFiles changed: none")).toBe(
			"## Report  \nOutcome: done  \nFiles changed: none  ",
		);
		expect(reportMarkdown("before\n\nafter\n")).toBe("before  \n\nafter  \n");
		expect(reportMarkdown("```\na\nb\n```")).toBe("```\na\nb\n```");
	});
});

describe("worker lists", () => {
	test("puts active workers first and forgotten ones last", () => {
		const done = worker({ id: "old", status: "done", updatedAt: "2026-10-30T12:00:00.000Z" });
		const newerDone = worker({ id: "newer", status: "done", updatedAt: "2026-10-30T13:00:00.000Z" });
		const running = worker({ id: "run" });
		const idle = worker({ id: "wait", status: "idle" });
		expect(sortWorkers([done, running, newerDone, idle]).map((entry) => entry.id)).toEqual([
			"run",
			"wait",
			"newer",
			"old",
		]);
	});

	test("lists the workers no task has", () => {
		const owned = worker({ id: "owned" });
		const tagged = worker({ id: "tagged", taskId: "T3" });
		const loose = worker({ id: "loose" });
		const looseDone = worker({ id: "loose-done", status: "done", taskId: null });
		expect(
			workersWithoutTask([looseDone, owned, tagged, loose], [{ workerIds: ["owned"] }, { workerIds: [] }]).map(
				(entry) => entry.id,
			),
		).toEqual(["loose", "loose-done"]);
		expect(workersWithoutTask([], [])).toEqual([]);
	});

	test("splits the loose workers into the ones in play and the finished ones", () => {
		const all = ["running", "idle", "failed", "stopped", "done"].map((status) =>
			worker({ id: status, status: status as WorkerSummary["status"] }),
		);
		const { active, finished } = splitLooseWorkers(all);
		expect(active.map((entry) => entry.id)).toEqual(["running", "idle"]);
		expect(finished.map((entry) => entry.id)).toEqual(["failed", "stopped", "done"]);
		expect(isFinishedWorker("idle")).toBe(false);
		expect(splitLooseWorkers([])).toEqual({ active: [], finished: [] });
	});

	test("describes status and place", () => {
		expect(workerStatusLabel("failed")).toBe("failed");
		expect(workerStatusClass("failed")).toContain("--chat-danger");
		expect(workerPlace(worker({ id: "a" }))).toBe("shared checkout");
		expect(workerPlace(worker({ id: "a", isolation: "workspace", workspacePath: "/data/ws/a" }))).toBe("/data/ws/a");
		expect(workerPlace(worker({ id: "a", isolation: "workspace" }))).toBe("workspace removed");
		expect(workerToolAction("worker_spawn")).toBe("Started worker");
	});
});

const ANTHROPIC = { provider: "anthropic", modelId: "claude" };
const OPENAI = { provider: "openai", modelId: "gpt" };
const LOCAL = { provider: "local", modelId: "llama" };

describe("default worker models", () => {
	test("adds to the end, once", () => {
		const list = addWorkerModel([ANTHROPIC], OPENAI);
		expect(list).toEqual([ANTHROPIC, OPENAI]);
		expect(hasWorkerModel(list, OPENAI)).toBe(true);
		// A model already in the list keeps its place; nothing changes, so no save is needed.
		expect(addWorkerModel(list, ANTHROPIC)).toBe(list);
	});

	test("removes a model and keeps the order of the rest", () => {
		const list = [ANTHROPIC, OPENAI, LOCAL];
		expect(removeWorkerModel(list, OPENAI)).toEqual([ANTHROPIC, LOCAL]);
		expect(removeWorkerModel(list, { provider: "other", modelId: "x" })).toBe(list);
	});

	test("toggles a catalog click", () => {
		const added = toggleWorkerModel([], OPENAI);
		expect(added).toEqual([OPENAI]);
		expect(toggleWorkerModel(added, OPENAI)).toEqual([]);
	});

	test("moves a model within the list and nowhere else", () => {
		const list = [ANTHROPIC, OPENAI, LOCAL];
		expect(moveWorkerModel(list, 2, -1)).toEqual([ANTHROPIC, LOCAL, OPENAI]);
		expect(moveWorkerModel(list, 0, 1)).toEqual([OPENAI, ANTHROPIC, LOCAL]);
		expect(moveWorkerModel(list, 0, -1)).toBe(list);
		expect(moveWorkerModel(list, 2, 1)).toBe(list);
		expect(moveWorkerModel(list, 3, -1)).toBe(list);
	});

	test("a new model starts on its own default level", () => {
		expect(addWorkerModel([], ANTHROPIC)).toEqual([{ provider: "anthropic", modelId: "claude" }]);
	});

	test("sets one model's thinking level and keeps the rest of the list alone", () => {
		const list = [ANTHROPIC, { ...OPENAI, thinkingLevel: "high" as const }, LOCAL];
		const next = setWorkerModelThinkingLevel(list, ANTHROPIC, "low");
		expect(next).toEqual([
			{ ...ANTHROPIC, thinkingLevel: "low" },
			{ ...OPENAI, thinkingLevel: "high" },
			LOCAL,
		]);
		// Setting the same level again changes nothing, so no save is needed.
		expect(setWorkerModelThinkingLevel(next, ANTHROPIC, "low")).toBe(next);
		// Back to the model's default.
		expect(setWorkerModelThinkingLevel(next, OPENAI, null)[1]).toEqual({
			provider: "openai",
			modelId: "gpt",
			thinkingLevel: null,
		});
		expect(setWorkerModelThinkingLevel(list, LOCAL, "max")).toEqual([
			ANTHROPIC,
			{ ...OPENAI, thinkingLevel: "high" },
			{ ...LOCAL, thinkingLevel: "max" },
		]);
		// A model that is not in the list stays absent.
		expect(setWorkerModelThinkingLevel(list, { provider: "other", modelId: "x" }, "low")).toBe(list);
	});
});

describe("a worker_send that retitles a worker", () => {
	function call(callId: string, name: string, args: unknown, details?: unknown): ToolPart {
		return { type: "tool", key: callId, callId, name, arguments: args, status: "done", diagnostics: [], details };
	}
	function turn(...parts: ToolPart[]): TranscriptItem {
		return { kind: "turn", key: parts[0]?.callId ?? "t", parts } as TranscriptItem;
	}

	test("knows the old title from the spawn, an earlier send, or the server's details", () => {
		const workers = [worker({ id: "w1", title: "Fix the login", spawnedByCallId: "c1" })];
		const items = [
			turn(call("c1", "worker_spawn", { title: "Build the board", brief: "…" })),
			turn(call("c2", "worker_send", { id: "w1", message: "next", title: "Fix the board" })),
			turn(call("c3", "worker_send", { id: "w1", message: "plain" })),
			turn(call("c4", "worker_send", { id: "w1", message: "next", title: "Fix the login" })),
			turn(call("c5", "worker_send", { id: "w9", message: "x", title: "New" })),
			turn(call("c6", "worker_send", { id: "w8", message: "x", title: "Newer" }, { previousTitle: "Older" })),
		];
		const before = workerTitlesBeforeSend(items, workers);
		expect(before.get("c2")).toBe("Build the board");
		expect(before.has("c3")).toBe(false);
		expect(before.get("c4")).toBe("Fix the board");
		expect(before.has("c5")).toBe(false);
		expect(before.get("c6")).toBe("Older");
	});

	test("reads as a retitle when the old title is known, else as a new task", () => {
		const send = call("c2", "worker_send", { id: "w1", message: "m", title: "Fix the board" });
		expect(workerSendLine(send, "Build the board")).toBe("Retitled Build the board → Fix the board and sent a message");
		expect(workerSendLine(send, undefined)).toBe("Sent Fix the board a new task");
		expect(workerSendLine(send, "Fix the board")).toBe("Sent Fix the board a new task");
		expect(workerSendLine(call("c3", "worker_send", { id: "w1", message: "m" }), "x")).toBeUndefined();
		expect(workerSendLine(call("c1", "worker_stop", { id: "w1", title: "x" }), "y")).toBeUndefined();
	});
});
