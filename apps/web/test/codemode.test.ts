/**
 * Code mode cards: the server's result text and `details.calls` (packages/server/src/codemode.ts, pi-durable's
 * codemode module) are parsed back into a one-line summary, the script, its output and its nested calls.
 */
import { describe, expect, test } from "bun:test";
import { codemodeCallView, isCodemodeTool, singleCallOfScript } from "../src/lib/chat/codemode.ts";
import type { NestedToolSlot, ToolPart } from "../src/lib/transcript.ts";

function part(options: {
	arguments?: Record<string, unknown>;
	output?: string;
	isError?: boolean;
	status?: ToolPart["status"];
	details?: unknown;
	nestedCalls?: NestedToolSlot[];
	live?: boolean;
}): ToolPart {
	return {
		type: "tool",
		key: "p0",
		callId: "call-1",
		name: "codemode",
		arguments: options.arguments ?? { code: "" },
		status: options.status ?? "done",
		diagnostics: [],
		...(options.output === undefined ? {} : { output: options.output }),
		...(options.isError === undefined ? {} : { isError: options.isError }),
		...(options.details === undefined ? {} : { details: options.details }),
		...(options.nestedCalls === undefined ? {} : { nestedCalls: options.nestedCalls }),
		...(options.live === undefined ? {} : { live: options.live }),
	};
}

describe("isCodemodeTool", () => {
	test("only the codemode tool", () => {
		expect(isCodemodeTool("codemode")).toBe(true);
		expect(isCodemodeTool("bash")).toBe(false);
	});
});

describe("codemodeCallView: the script and its output", () => {
	test("a comment's first line, with its marker stripped, is the summary's lead", () => {
		const view = codemodeCallView(
			part({
				arguments: { code: '// List failing tests\nconst r = await tools.bash({ command: "go test ./..." });' },
				output: "Script completed\nWall time 0.4 seconds\nOutput:\n",
				details: { calls: [{ id: 1, name: "bash", args: '{"command":"go test"}', status: "ok", durationMs: 12 }] },
			}),
		);
		expect(view.summary).toBe("List failing tests · 1 bash");
		expect(view.code).toContain("List failing tests");
		expect(view.output).toBe("");
		expect(view.wallSeconds).toBe(0.4);
		expect(view.isError).toBe(false);
		expect(view.live).toBe(false);
	});

	test("a script with no comment uses its first line of code, and reports no tool calls", () => {
		const view = codemodeCallView(
			part({
				arguments: { code: 'return "hi";' },
				output: "Script completed\nWall time 0.0 seconds\nOutput:\nhi",
				details: { calls: [] },
			}),
		);
		expect(view.summary).toBe('return "hi"; · no tool calls');
		expect(view.output).toBe("hi");
	});

	test("counts nested calls by kind, most frequent first, and keeps the rest of the output", () => {
		const view = codemodeCallView(
			part({
				arguments: { code: "// Audit the repo" },
				output: "Script completed\nWall time 1.2 seconds\nOutput:\nAudit done\nTwo lines.",
				details: {
					calls: [
						{ id: 1, name: "read", args: "{}", status: "ok" },
						{ id: 2, name: "bash", args: "{}", status: "ok" },
						{ id: 3, name: "read", args: "{}", status: "ok" },
						{ id: 4, name: "read", args: "{}", status: "ok" },
					],
				},
			}),
		);
		expect(view.summary).toBe("Audit the repo · 3 read, 1 bash");
		expect(view.output).toBe("Audit done\nTwo lines.");
	});

	test("an unrecognised output falls back to showing it whole, with no wall time", () => {
		const view = codemodeCallView(part({ output: "something unexpected", details: { calls: [] } }));
		expect(view.output).toBe("something unexpected");
		expect(view.wallSeconds).toBeUndefined();
	});
});

describe("codemodeCallView: finished nested calls", () => {
	test("a plain failure is 'error'", () => {
		const view = codemodeCallView(
			part({
				isError: true,
				output: "Script failed\nWall time 0.1 seconds\nOutput:\nScript error:\nsomething broke",
				details: {
					calls: [{ id: 1, name: "memory_write", args: "{}", status: "error", error: "memory_conflict" }],
				},
			}),
		);
		expect(view.calls).toEqual([
			{ id: "1", name: "memory_write", argsPreview: "{}", status: "error", error: "memory_conflict" },
		]);
		expect(view.isError).toBe(true);
	});

	test("a bash call that exited non-zero is 'exited', with its exit code, not a plain error", () => {
		const view = codemodeCallView(
			part({
				output: "Script completed\nWall time 0.2 seconds\nOutput:\nok",
				details: {
					calls: [
						{
							id: 1,
							name: "bash",
							args: '{"command":"false"}',
							status: "error",
							error: "Command exited with code 1",
							durationMs: 9,
						},
					],
				},
			}),
		);
		expect(view.calls[0]).toMatchObject({ status: "exited", exitCode: 1, durationMs: 9 });
	});

	test("a call still running when the script ended is 'cancelled'", () => {
		const view = codemodeCallView(
			part({ details: { calls: [{ id: 1, name: "bash", args: "{}", status: "cancelled" }] } }),
		);
		expect(view.calls[0]?.status).toBe("cancelled");
	});
});

describe("codemodeCallView: live nested calls while the script is running", () => {
	function nested(options: Partial<NestedToolSlot> & { callId: string; name: string }): NestedToolSlot {
		return { status: "running", parentCallId: "call-1", ...options };
	}

	test("falls back to pi.live.nestedTools when the result has not settled", () => {
		const view = codemodeCallView(
			part({
				status: "running",
				live: true,
				nestedCalls: [
					nested({ callId: "call-1/c1", name: "read", status: "done", summary: { isError: false, durationMs: 4 } }),
					nested({ callId: "call-1/c2", name: "bash", status: "running", arguments: { command: "go test" } }),
				],
			}),
		);
		expect(view.live).toBe(true);
		expect(view.calls).toEqual([
			{ id: "call-1/c1", name: "read", argsPreview: "", status: "ok", durationMs: 4 },
			{ id: "call-1/c2", name: "bash", argsPreview: '{"command":"go test"}', status: "running" },
		]);
	});

	test("a live bash call that exited non-zero still reads as 'exited'", () => {
		const view = codemodeCallView(
			part({
				status: "running",
				live: true,
				nestedCalls: [
					nested({
						callId: "call-1/c1",
						name: "bash",
						status: "done",
						summary: { isError: true, error: "Command exited with code 2", durationMs: 7 },
					}),
				],
			}),
		);
		expect(view.calls[0]).toMatchObject({ status: "exited", exitCode: 2 });
	});

	test("settled details win over stale live nested calls", () => {
		const view = codemodeCallView(
			part({
				details: { calls: [{ id: 1, name: "bash", args: "{}", status: "ok" }] },
				nestedCalls: [nested({ callId: "call-1/c1", name: "bash", status: "running" })],
			}),
		);
		expect(view.live).toBe(false);
		expect(view.calls).toHaveLength(1);
		expect(view.calls[0]?.id).toBe("1");
	});
});

describe("singleCallOfScript: a one-call script as the call it wraps", () => {
	const header = "Script completed\nWall time 0.1 seconds\nOutput:\n";
	const note = "\n\nThis script made one tool call and returned all of its output; call the tool directly next time.";
	const one = (call: Record<string, unknown>, extra: Parameters<typeof part>[0] = {}) =>
		part({
			arguments: { code: 'text(await tools.bash({ command: "ls" }))' },
			output: `${header}a.ts\nb.ts${note}`,
			details: { calls: [{ id: 1, name: "bash", args: '{"command":"ls"}', status: "ok", durationMs: 7, ...call }] },
			...extra,
		});

	test("becomes the nested call, with the script's output and the script kept", () => {
		const call = singleCallOfScript(one({}));
		expect(call).toMatchObject({
			name: "bash",
			arguments: { command: "ls" },
			status: "done",
			output: "a.ts\nb.ts",
			isError: false,
			durationMs: 7,
			viaScript: { code: 'text(await tools.bash({ command: "ls" }))' },
		});
		expect(call?.key).toBe("p0");
	});

	test("a non-zero exit keeps its exit code, so it reads amber like a direct call", () => {
		const call = singleCallOfScript(one({ status: "error", error: "Command exited with code 2" }));
		expect(call?.isError).toBe(true);
		expect(call?.diagnostics).toEqual([{ severity: "error", message: "Command exited with code 2", code: "exit_code" }]);
	});

	test("two calls, no calls, another tool, cut arguments, a failed script or a live script stay a script", () => {
		const bashCall = { id: 1, name: "bash", args: "{}", status: "ok" };
		expect(singleCallOfScript(one({}, { details: { calls: [bashCall, { ...bashCall, id: 2 }] } }))).toBeUndefined();
		expect(singleCallOfScript(one({}, { details: { calls: [] } }))).toBeUndefined();
		expect(singleCallOfScript(one({ name: "memory_search" }))).toBeUndefined();
		expect(singleCallOfScript(one({ args: '{"command":"echo aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa…' }))).toBeUndefined();
		expect(singleCallOfScript(one({ status: "cancelled" }))).toBeUndefined();
		expect(singleCallOfScript(one({}, { isError: true }))).toBeUndefined();
		expect(singleCallOfScript(one({}, { status: "running", details: undefined }))).toBeUndefined();
	});

	test("an ordinary tool call is left alone", () => {
		expect(singleCallOfScript({ ...one({}), name: "bash" })).toBeUndefined();
	});
});
