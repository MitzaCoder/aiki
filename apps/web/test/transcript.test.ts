/**
 * Transcript building: worker reports arrive as user inputs and must render as
 * reports, and a `worker_*` call must stay a tool call a component can link to
 * its worker. Both are checked here, away from the components.
 */
import { describe, expect, test } from "bun:test";
import type { EntryRecord } from "@aiki/protocol";
import {
	codingGroupSummary,
	buildTranscript,
	exitCodeOf,
	groupTurnParts,
	stepsGroupSummary,
	thinkingHeaderText,
	toolCallState,
	toolCardStatus,
	type CodingItem,
	type ToolPart,
} from "../src/lib/transcript.ts";
import { workerForToolCall } from "../src/lib/workers.ts";
import type { WorkerSummary } from "@aiki/protocol";

function userEntry(id: number, content: unknown, timestamp = 1_000): EntryRecord {
	return {
		id,
		conversationId: 1,
		kind: "pi.user",
		model: [{ role: "user", content, timestamp }],
	};
}

function assistantEntry(id: number, content: unknown, timestamp = 2_000): EntryRecord {
	return {
		id,
		conversationId: 1,
		kind: "pi.assistant",
		model: [{ role: "assistant", content, timestamp }],
	};
}

describe("worker reports in the transcript", () => {
	test("a report renders as a report, not as a user message", () => {
		const items = buildTranscript(
			[userEntry(1, [{ type: "text", text: "[worker alpha reported]\n## Report\nOutcome: done" }])],
			undefined,
		);
		expect(items).toHaveLength(1);
		expect(items[0]).toMatchObject({
			kind: "report",
			workerId: "alpha",
			ok: true,
			body: "## Report\nOutcome: done",
			timestamp: 1_000,
		});
	});

	test("a failure renders as a failed report", () => {
		const items = buildTranscript(
			[userEntry(2, [{ type: "text", text: "[worker beta failed: the model gave up]" }])],
			undefined,
		);
		expect(items[0]).toMatchObject({
			kind: "report",
			workerId: "beta",
			ok: false,
			body: "",
			failure: "the model gave up",
		});
	});

	test("a check-in renders as a check-in, not as a user message", () => {
		const items = buildTranscript(
			[
				userEntry(
					3,
					[{ type: "text", text: "[check-in]\n1 worker is still running. Decide whether it is stuck." }],
					3_000,
				),
			],
			undefined,
		);
		expect(items[0]).toMatchObject({
			kind: "checkin",
			body: "1 worker is still running. Decide whether it is stuck.",
			timestamp: 3_000,
		});
	});

	test("the user's own messages stay user messages", () => {
		const items = buildTranscript(
			[
				userEntry(1, [{ type: "text", text: "What is worker alpha doing?" }]),
				userEntry(2, [{ type: "text", text: "Thanks" }]),
			],
			undefined,
		);
		expect(items.map((item) => item.kind)).toEqual(["user", "user"]);
	});

	test("a report with an attachment is still treated as something the user wrote", () => {
		const items = buildTranscript(
			[
				userEntry(1, [
					{ type: "text", text: "[worker alpha reported]\nlook" },
					{ type: "image", data: "AAAA", mimeType: "image/png" },
				]),
			],
			undefined,
		);
		expect(items[0]?.kind).toBe("user");
	});
});

describe("worker tool calls in the transcript", () => {
	const alpha: WorkerSummary = {
		id: "alpha",
		title: "Fix the parser",
		status: "running",
		model: { provider: "anthropic", modelId: "claude" },
		thinkingLevel: null,
		isolation: "workspace",
		workspacePath: "/data/ws/alpha",
		conversationId: 3,
		spawnedByCallId: "call-1",
		createdAt: "2026-10-30T10:00:00.000Z",
		updatedAt: "2026-10-30T10:05:00.000Z",
		lastReport: null,
		failure: null,
	};

	test("keeps the call's id so a component can find the worker it spawned", () => {
		const items = buildTranscript(
			[
				assistantEntry(2, [
					{
						type: "toolCall",
						id: "call-1",
						name: "worker_spawn",
						arguments: { id: "alpha", task: "Fix the parser" },
					},
				]),
			],
			undefined,
		);
		const turn = items[0];
		expect(turn?.kind).toBe("turn");
		if (turn?.kind !== "turn") return;
		const part = turn.parts[0];
		expect(part?.type).toBe("tool");
		if (part?.type !== "tool") return;
		expect(part.status).toBe("pending");
		expect(workerForToolCall([alpha], part)?.title).toBe("Fix the parser");
	});
});

describe("compactions in the transcript", () => {
	test("a pi.compaction entry reads as a compaction with its summary and when it happened", () => {
		const entry: EntryRecord = {
			id: 7,
			conversationId: 1,
			kind: "pi.compaction",
			head: 5,
			data: { reason: "threshold" },
			model: [{ role: "user", content: "## Summary\n\nWe decided to ship on Friday.", timestamp: 3_000 }],
		};
		const items = buildTranscript([entry], undefined);
		expect(items).toHaveLength(1);
		expect(items[0]).toMatchObject({
			kind: "compaction",
			key: "entry-7",
			summary: "## Summary\n\nWe decided to ship on Friday.",
			timestamp: 3_000,
			reason: "threshold",
		});
	});

	test("an empty compaction still marks the place without a summary to open", () => {
		const items = buildTranscript(
			[{ id: 8, conversationId: 1, kind: "pi.compaction", data: { reason: "manual" } }],
			undefined,
		);
		expect(items[0]).toMatchObject({ kind: "compaction", key: "entry-8", reason: "manual" });
		expect(items[0] !== undefined && "summary" in items[0]).toBe(false);
	});

	test("running compactions show unobtrusively, one per task", () => {
		const items = buildTranscript([], {
			compactions: [
				{ taskId: 4, reason: "manual", blocking: false },
				{ taskId: 5, reason: "threshold", blocking: true },
			],
		});
		expect(items).toHaveLength(2);
		expect(items[0]).toMatchObject({ kind: "compaction", key: "live-compaction-4", running: true });
		expect(items[1]).toMatchObject({ kind: "compaction", key: "live-compaction-5", running: true });
	});

	test("a compaction failure keeps its notice", () => {
		const items = buildTranscript([], { compactionFailure: { reason: "threshold", error: "provider gave up" } });
		expect(items[0]).toMatchObject({ kind: "notice", key: "live-compaction-failure", tone: "error" });
	});
});

function toolPart(overrides: Partial<ToolPart> & { key: string; name?: string }): ToolPart {
	return {
		type: "tool",
		callId: overrides.key,
		name: overrides.name ?? "bash",
		status: "done",
		diagnostics: [],
		...overrides,
	} as ToolPart;
}

function callItem(part: ToolPart): CodingItem {
	return { kind: "call", key: part.key, part };
}

function thoughtItem(key: string, text: string, streaming = false): CodingItem {
	return { kind: "thinking", key, text, ...(streaming ? { streaming: true } : {}) };
}

describe("grouping a turn's parts", () => {
	test("consecutive thinking parts are one row of steps, keyed by the first", () => {
		const rows = groupTurnParts([
			{ type: "thinking", key: "p0", text: "first" },
			{ type: "thinking", key: "p1", text: "second" },
			{ type: "thinking", key: "p2", text: "third" },
		]);
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({ kind: "thinking", key: "p0" });
		if (rows[0]?.kind !== "thinking") return;
		expect(rows[0].steps.map((step) => step.text)).toEqual(["first", "second", "third"]);
	});

	test("thinking separated by anything else stays apart", () => {
		const rows = groupTurnParts([
			{ type: "thinking", key: "p0", text: "before" },
			{ type: "text", key: "p1", text: "an answer" },
			{ type: "thinking", key: "p2", text: "after" },
		]);
		expect(rows.map((row) => row.kind)).toEqual(["thinking", "part", "thinking"]);
		expect(rows[0]?.key).toBe("p0");
		expect(rows[2]?.key).toBe("p2");
	});

	test("a run of bash, read, write and edit calls is one row, in order", () => {
		const rows = groupTurnParts([
			toolPart({ key: "p0" }),
			toolPart({ key: "p1", name: "read" }),
			toolPart({ key: "p2", name: "write" }),
			toolPart({ key: "p3", name: "edit" }),
		]);
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({ kind: "coding", key: "p0" });
		if (rows[0]?.kind !== "coding") return;
		expect(rows[0].items.map((item) => (item.kind === "call" ? item.part.name : "thinking"))).toEqual([
			"bash",
			"read",
			"write",
			"edit",
		]);
	});

	test("other tools, text and errors break the run", () => {
		const rows = groupTurnParts([
			toolPart({ key: "p0" }),
			toolPart({ key: "p1", name: "read" }),
			toolPart({ key: "p2", name: "worker_spawn" }),
			toolPart({ key: "p3", name: "edit" }),
			{ type: "text", key: "p4", text: "A sentence." },
			toolPart({ key: "p5", name: "history" }),
		]);
		expect(rows.map((row) => row.kind)).toEqual(["coding", "part", "coding", "part", "part"]);
		if (rows[0]?.kind !== "coding" || rows[2]?.kind !== "coding") return;
		expect(rows[0].items.map((item) => (item.kind === "call" ? item.part.name : "thinking"))).toEqual([
			"bash",
			"read",
		]);
		expect(rows[2].items.map((item) => (item.kind === "call" ? item.part.name : "thinking"))).toEqual(["edit"]);
	});

	test("thinking between calls joins the row as its own items, in order", () => {
		const rows = groupTurnParts([
			toolPart({ key: "p0" }),
			{ type: "thinking", key: "p1", text: "Let me read it." },
			toolPart({ key: "p2", name: "read" }),
			{ type: "thinking", key: "p3", text: "Now fix it.", streaming: true },
			toolPart({ key: "p4", name: "edit" }),
		]);
		expect(rows).toHaveLength(1);
		if (rows[0]?.kind !== "coding") throw new Error("expected a coding row");
		expect(rows[0].items.map((item) => item.kind)).toEqual(["call", "thinking", "call", "thinking", "call"]);
		expect(rows[0].items[1]).toMatchObject({ key: "p1", text: "Let me read it." });
		expect(rows[0].items[3]).toMatchObject({ key: "p3", streaming: true });
	});

	test("memory calls break a coding run", () => {
		const rows = groupTurnParts([
			toolPart({ key: "p0" }),
			toolPart({ key: "p1", name: "memory_search" }),
			toolPart({ key: "p2", name: "edit" }),
		]);
		expect(rows.map((row) => row.kind)).toEqual(["coding", "part", "coding"]);
	});

	test("thinking before the first call and after the last stays outside", () => {
		const rows = groupTurnParts([
			{ type: "thinking", key: "p0", text: "before" },
			toolPart({ key: "p1" }),
			{ type: "thinking", key: "p2", text: "between" },
			toolPart({ key: "p3", name: "read" }),
			{ type: "thinking", key: "p4", text: "after" },
		]);
		expect(rows.map((row) => row.kind)).toEqual(["thinking", "coding", "thinking"]);
		if (rows[1]?.kind !== "coding") return;
		expect(rows[1].key).toBe("p1");
		expect(rows[1].items.map((item) => item.key)).toEqual(["p1", "p2", "p3"]);
	});

	test("thinking before a text answer stays out of the row", () => {
		const rows = groupTurnParts([
			toolPart({ key: "p0" }),
			{ type: "thinking", key: "p1", text: "done thinking" },
			{ type: "text", key: "p2", text: "Here is the answer." },
			toolPart({ key: "p3", name: "read" }),
		]);
		expect(rows.map((row) => row.kind)).toEqual(["coding", "thinking", "part", "coding"]);
	});

	test("a new call or thought joins the open row without changing its key", () => {
		const first = groupTurnParts([toolPart({ key: "p0", status: "running", live: true })]);
		const next = groupTurnParts([
			toolPart({ key: "p0", status: "running", live: true }),
			{ type: "thinking", key: "p1", text: "next" },
			toolPart({ key: "p2", name: "read", status: "pending", live: true }),
		]);
		expect(first[0]?.key).toBe("p0");
		expect(next[0]?.key).toBe("p0");
		if (next[0]?.kind !== "coding") return;
		expect(next[0].items.map((item) => item.key)).toEqual(["p0", "p1", "p2"]);
	});

	test("a lone coding call is still a coding row, so it keeps its row identity", () => {
		const rows = groupTurnParts([toolPart({ key: "p0", name: "read" })]);
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({ kind: "coding", key: "p0" });
	});
});

describe("a run of calls that are not coding calls", () => {
	test("folds into one row of steps, keyed by its first call", () => {
		const rows = groupTurnParts([
			toolPart({ key: "p0", name: "board" }),
			toolPart({ key: "p1", name: "schedule_save" }),
			toolPart({ key: "p2", name: "schedule_list" }),
		]);
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({ kind: "steps", key: "p0" });
		if (rows[0]?.kind !== "steps") return;
		expect(rows[0].calls.map((call) => call.name)).toEqual(["board", "schedule_save", "schedule_list"]);
	});

	test("a lone call keeps its own card, so a turn with one call reads as it did", () => {
		const rows = groupTurnParts([toolPart({ key: "p0", name: "board" })]);
		expect(rows.map((row) => row.kind)).toEqual(["part"]);
	});

	test("thinking, text, coding calls and errors break the run", () => {
		const rows = groupTurnParts([
			toolPart({ key: "p0", name: "board" }),
			toolPart({ key: "p1", name: "worker_spawn" }),
			{ type: "thinking", key: "p2", text: "which one next" },
			toolPart({ key: "p3", name: "board" }),
			toolPart({ key: "p4", name: "read" }),
			toolPart({ key: "p5", name: "memory_search" }),
			{ type: "text", key: "p6", text: "Done." },
			toolPart({ key: "p7", name: "board" }),
		]);
		expect(rows.map((row) => row.kind)).toEqual(["steps", "thinking", "part", "coding", "part", "part", "part"]);
	});

	test("a call that arrives while the model works joins the open row, keeping its key", () => {
		const first = groupTurnParts([
			toolPart({ key: "p0", name: "board", status: "running", live: true }),
			toolPart({ key: "p1", name: "schedule_list", status: "pending", live: true }),
		]);
		const next = groupTurnParts([
			toolPart({ key: "p0", name: "board" }),
			toolPart({ key: "p1", name: "schedule_list" }),
			toolPart({ key: "p2", name: "schedule_save", status: "running", live: true }),
		]);
		expect(first[0]?.key).toBe("p0");
		expect(next[0]?.key).toBe("p0");
		if (next[0]?.kind !== "steps") return;
		expect(next[0].calls.map((call) => call.key)).toEqual(["p0", "p1", "p2"]);
	});
});

describe("steps row status", () => {
	test("counts the calls, and says nothing when they all went well", () => {
		expect(
			stepsGroupSummary([
				toolPart({ key: "p0", name: "board" }),
				toolPart({ key: "p1", name: "schedule_save" }),
				toolPart({ key: "p2", name: "schedule_list" }),
			])
		).toEqual({ status: "done", label: "3 steps" });
	});

	test("names what runs and what failed beside the count", () => {
		const summary = stepsGroupSummary([
			toolPart({ key: "p0", name: "board" }),
			toolPart({ key: "p1", name: "schedule_save", status: "running" }),
			toolPart({ key: "p2", name: "schedule_list", isError: true, output: "boom" }),
		]);
		expect(summary).toEqual({ status: "running", label: "3 steps", detail: "1 running · 1 failed" });
	});

	test("a finished run with a failure is failed, and a call that never ran is stopped", () => {
		expect(
			stepsGroupSummary([
				toolPart({ key: "p0", name: "board" }),
				toolPart({ key: "p1", name: "thread_stop", isError: true, output: "boom" }),
			])
		).toEqual({ status: "failed", label: "2 steps", detail: "1 failed" });
		expect(
			stepsGroupSummary([
				toolPart({ key: "p0", name: "board" }),
				toolPart({ key: "p1", name: "thread_stop", status: "pending" }),
			])
		).toEqual({ status: "stopped", label: "2 steps", detail: "1 stopped" });
	});
});

describe("coding group status", () => {
	test("a mixed run counts each kind, in the example's words", () => {
		const summary = codingGroupSummary([
			callItem(toolPart({ key: "p0" })),
			callItem(toolPart({ key: "p1" })),
			callItem(toolPart({ key: "p2", name: "read" })),
			callItem(toolPart({ key: "p3", name: "read" })),
			callItem(toolPart({ key: "p4", name: "read" })),
			callItem(toolPart({ key: "p5", name: "edit" })),
		]);
		expect(summary).toEqual({
			status: "done",
			label: "Ran 2 commands, read 3 files, edited 1 file",
		});
	});

	test("write is its own kind, and only the kinds present are named", () => {
		expect(
			codingGroupSummary([callItem(toolPart({ key: "p0", name: "write" }))])
		).toEqual({ status: "done", label: "Wrote 1 file" });
		expect(codingGroupSummary([callItem(toolPart({ key: "p0", name: "read" }))])).toEqual({
			status: "done",
			label: "Read 1 file",
		});
		expect(codingGroupSummary([callItem(toolPart({ key: "p0", name: "edit" }))])).toEqual({
			status: "done",
			label: "Edited 1 file",
		});
	});

	test("thinking inside adds its count to the header", () => {
		const summary = codingGroupSummary([
			callItem(toolPart({ key: "p0" })),
			thoughtItem("p1", "one"),
			callItem(toolPart({ key: "p2", name: "read" })),
			thoughtItem("p3", "two"),
			callItem(toolPart({ key: "p4", name: "read" })),
		]);
		expect(summary.label).toBe("Ran 1 command, read 2 files · 2 thoughts");
		const single = codingGroupSummary([
			callItem(toolPart({ key: "p0" })),
			thoughtItem("p1", "one"),
			callItem(toolPart({ key: "p2", name: "edit" })),
		]);
		expect(single.label).toBe("Ran 1 command, edited 1 file · 1 thought");
	});

	test("while a kind still runs its clause is in the present tense, and counts failed calls", () => {
		const summary = codingGroupSummary([
			callItem(toolPart({ key: "p0", status: "running" })),
			callItem(toolPart({ key: "p1", name: "read", isError: true })),
			callItem(toolPart({ key: "p2", name: "read" })),
		]);
		expect(summary.status).toBe("running");
		expect(summary.label).toBe("Running 1 command, read 2 files");
		expect(summary.detail).toBe("1 running · 1 failed");
	});

	test("a finished run with a failure is failed, not done", () => {
		const summary = codingGroupSummary([
			callItem(toolPart({ key: "p0" })),
			callItem(toolPart({ key: "p1", isError: true, output: "boom" })),
		]);
		expect(summary).toEqual({ status: "failed", label: "Ran 2 commands", detail: "1 failed" });
	});

	test("a call that never ran is stopped", () => {
		const summary = codingGroupSummary([
			callItem(toolPart({ key: "p0", status: "done" })),
			callItem(toolPart({ key: "p1", status: "pending" })),
		]);
		expect(summary).toEqual({ status: "stopped", label: "Ran 2 commands", detail: "1 stopped" });
	});

	test("a done call with an error is failed even if its status says done", () => {
		expect(toolCallState(toolPart({ key: "p0", status: "done", isError: true }))).toBe("failed");
		expect(toolCallState(toolPart({ key: "p1", status: "running" }))).toBe("running");
		expect(toolCallState(toolPart({ key: "p2", status: "pending", live: true }))).toBe("running");
		expect(toolCallState(toolPart({ key: "p3", status: "pending" }))).toBe("stopped");
	});
});

function exitedPart(overrides: Partial<ToolPart> & { key: string } = { key: "p0" }): ToolPart {
	return toolPart({
		output: "some useful output",
		isError: true,
		diagnostics: [{ severity: "error", code: "exit_code", message: "Command exited with code 1" }],
		...overrides,
	});
}

describe("a non-zero exit vs. a real failure", () => {
	test("a non-zero exit that printed output reads as exited, not failed", () => {
		const part = exitedPart();
		expect(toolCardStatus(part)).toBe("exited");
		expect(toolCallState(part)).toBe("exited");
		expect(exitCodeOf(part)).toBe(1);
	});

	test("the exit code comes from the diagnostic's own code, not by guessing from the message", () => {
		const part = exitedPart({
			key: "p0",
			diagnostics: [{ severity: "warn", code: "not_exit_code", message: "exited with code 1, allegedly" }],
		});
		expect(exitCodeOf(part)).toBeUndefined();
		// Without the structured code, this is an ordinary failure, not an "exited" one.
		expect(toolCallState(part)).toBe("failed");
	});

	test("a non-zero exit with no output stays a failure", () => {
		const part = exitedPart({ key: "p0", output: "" });
		expect(toolCardStatus(part)).toBe("error");
		expect(toolCallState(part)).toBe("failed");
	});

	test("a non-zero exit with no output field at all stays a failure", () => {
		const part = exitedPart({ key: "p0", output: undefined });
		expect(toolCallState(part)).toBe("failed");
	});

	test("a timeout or any other tool error, which carries no exit_code diagnostic, stays red", () => {
		const part = toolPart({
			key: "p0",
			isError: true,
			output: "partial output before the timeout",
			diagnostics: [{ severity: "error", code: "tool_call_capped", message: "stopped after running past its cap" }],
		});
		expect(toolCardStatus(part)).toBe("error");
		expect(toolCallState(part)).toBe("failed");
	});

	test("a group with one exited and one failed call reports failed, with both counts in the detail", () => {
		const summary = codingGroupSummary([
			callItem(exitedPart({ key: "p0" })),
			callItem(toolPart({ key: "p1", isError: true, output: "boom" })),
		]);
		expect(summary.status).toBe("failed");
		expect(summary.detail).toBe("1 failed · 1 exited non-zero");
	});

	test("a group with only an exited call reports exited, not failed", () => {
		const summary = codingGroupSummary([callItem(exitedPart({ key: "p0" })), callItem(toolPart({ key: "p1" }))]);
		expect(summary.status).toBe("exited");
		expect(summary.detail).toBe("1 exited non-zero");
	});
});

describe("thinking header", () => {
	test("one step keeps the old wording", () => {
		expect(thinkingHeaderText(1, false)).toBe("Thought");
		expect(thinkingHeaderText(1, true)).toBe("Thinking");
	});

	test("several steps say how many", () => {
		expect(thinkingHeaderText(3, false)).toBe("Thought for a while · 3 steps");
		expect(thinkingHeaderText(2, true)).toBe("Thinking · 2 steps");
	});
});

describe("tool durations in the transcript", () => {
	test("a tool result's measured duration lands on its call", () => {
		const items = buildTranscript(
			[
				assistantEntry(2, [{ type: "toolCall", id: "call-1", name: "bash", arguments: { command: "bun test" } }]),
				{
					id: 3,
					conversationId: 1,
					kind: "pi.tool-result",
					model: [
						{
							role: "toolResult",
							toolCallId: "call-1",
							toolName: "bash",
							content: [{ type: "text", text: "ok" }],
							isError: false,
							timestamp: 3_000,
							durationMs: 12_400,
						},
					],
				},
			],
			undefined,
		);
		const turn = items[0];
		if (turn?.kind !== "turn") throw new Error("expected a turn");
		const part = turn.parts[0];
		if (part?.type !== "tool") throw new Error("expected a tool part");
		expect(part.durationMs).toBe(12_400);
		expect(part.status).toBe("done");
	});
});

describe("a tool result's details", () => {
	test("come from the message itself, not entry.data (pi-durable's pi.tool-result data carries only diagnostics)", () => {
		const items = buildTranscript(
			[
				assistantEntry(2, [{ type: "toolCall", id: "call-1", name: "codemode", arguments: { code: "return 1;" } }]),
				{
					id: 3,
					conversationId: 1,
					kind: "pi.tool-result",
					// What pi-durable actually sends: `data` carries only diagnostics; `details` rides on the message.
					data: { diagnostics: [] },
					model: [
						{
							role: "toolResult",
							toolCallId: "call-1",
							toolName: "codemode",
							content: [{ type: "text", text: "Script completed\nWall time 0.0 seconds\nOutput:\n1" }],
							isError: false,
							details: { calls: [{ id: 1, name: "worker_list", args: "{}", status: "ok" }] },
						},
					],
				},
			],
			undefined,
		);
		const turn = items[0];
		if (turn?.kind !== "turn") throw new Error("expected a turn");
		const part = turn.parts[0];
		if (part?.type !== "tool") throw new Error("expected a tool part");
		expect(part.details).toEqual({ calls: [{ id: 1, name: "worker_list", args: "{}", status: "ok" }] });
	});
});

describe("live thinking", () => {
	test("only the live generation's last block is marked streaming", () => {
		const items = buildTranscript([], {
			generation: {
				attempt: 1,
				message: {
					role: "assistant",
					content: [
						{ type: "thinking", thinking: "first" },
						{ type: "thinking", thinking: "second" },
					],
				},
			},
		});
		const turn = items[0];
		if (turn?.kind !== "turn") throw new Error("expected a turn");
		const thinking = turn.parts.filter((part) => part.type === "thinking");
		expect(thinking.map((part) => part.type === "thinking" && part.streaming)).toEqual([undefined, true]);
	});

	test("a thinking block before streamed text is not streaming", () => {
		const items = buildTranscript([], {
			generation: {
				attempt: 1,
				message: {
					role: "assistant",
					content: [
						{ type: "thinking", thinking: "already done" },
						{ type: "text", text: "writing" },
					],
				},
			},
		});
		const turn = items[0];
		if (turn?.kind !== "turn") throw new Error("expected a turn");
		const thinking = turn.parts[0];
		expect(thinking?.type).toBe("thinking");
		if (thinking?.type !== "thinking") return;
		expect(thinking.streaming).toBeUndefined();
	});
});
describe("a one-call code mode script", () => {
	test("renders as the call it wraps and joins the coding group around it", () => {
		const result = (id: number, callId: string, toolName: string, text: string, details?: unknown): EntryRecord => ({
			id,
			conversationId: 1,
			kind: "pi.tool-result",
			model: [
				{
					role: "toolResult",
					toolCallId: callId,
					toolName,
					content: [{ type: "text", text }],
					isError: false,
					timestamp: 3_000,
					...(details === undefined ? {} : { details }),
				},
			],
		});
		const items = buildTranscript(
			[
				assistantEntry(2, [
					{ type: "toolCall", id: "c1", name: "read", arguments: { path: "a.ts" } },
					{ type: "toolCall", id: "c2", name: "codemode", arguments: { code: 'text(await tools.bash({ command: "ls" }))' } },
					{ type: "toolCall", id: "c3", name: "codemode", arguments: { code: "await Promise.all([])" } },
				]),
				result(3, "c1", "read", "x"),
				result(4, "c2", "codemode", "Script completed\nWall time 0.1 seconds\nOutput:\nfiles", {
					calls: [{ id: 1, name: "bash", args: '{"command":"ls"}', status: "ok" }],
				}),
				result(5, "c3", "codemode", "Script completed\nWall time 0.1 seconds\nOutput:\n", { calls: [] }),
			],
			undefined,
		);
		const turn = items[0];
		if (turn?.kind !== "turn") throw new Error("expected a turn");
		expect(turn.parts.map((part) => (part.type === "tool" ? part.name : part.type))).toEqual(["read", "bash", "codemode"]);
		const rows = groupTurnParts(turn.parts);
		expect(rows.map((row) => row.kind)).toEqual(["coding", "part"]);
		const group = rows[0];
		if (group?.kind !== "coding") throw new Error("expected a coding group");
		expect(group.items).toHaveLength(2);
	});
});
