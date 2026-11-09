/**
 * How a code mode call reads in the transcript. The tool is defined in
 * `@earendil-works/pi-durable/codemode` (installed by packages/server/src/codemode.ts): its single argument is the
 * script source, its result's `output` is "Script completed|failed\nWall time N seconds\nOutput:\n<the script's own
 * output>", and its `details.calls` is the nested calls it made, in order, once it has settled. While it still runs,
 * the same calls come from `pi.live.nestedTools` (`ToolPart.nestedCalls`, matched by the server already) instead:
 * `live` tells the two apart. Parsing is pure so the card can stay a dumb renderer.
 */
import type { Diagnostic, NestedToolSlot, ToolPart } from "#lib/transcript.js";

export const CODEMODE_TOOL_NAME = "codemode";

export function isCodemodeTool(name: string): name is typeof CODEMODE_TOOL_NAME {
	return name === CODEMODE_TOOL_NAME;
}

/**
 * `exited`: a nested `bash`/`powershell` call that exited non-zero — the call still resolved in the script (`{
 * output, exitCode }`), so it is not a plain failure, matching how a single `bash` card reads it (amber, not red).
 * `cancelled`: still running when the script ended (an error elsewhere, or a timeout).
 */
export type CodemodeCallStatus = "running" | "ok" | "error" | "exited" | "cancelled";

export type CodemodeCallLine = {
	id: string;
	name: string;
	/** Compact JSON of the call's arguments, already cut for display by the server once the call has settled. */
	argsPreview: string;
	status: CodemodeCallStatus;
	durationMs?: number;
	/** Cut error text; for `exited`, the same "Command exited with code N" diagnostic a single `bash` card parses. */
	error?: string;
	exitCode?: number;
};

export type CodemodeCallView = {
	/** The raw script source, for the collapsed, highlighted code block. */
	code: string;
	/** One line: the script's first comment or line of code, then its nested calls by kind. */
	summary: string;
	/** The script's own output, with the "Script completed/failed · Wall time …" header stripped. */
	output: string;
	wallSeconds?: number;
	isError: boolean;
	calls: CodemodeCallLine[];
	/** `calls` comes from `pi.live.nestedTools` (the call has not settled) rather than the result's `details.calls`. */
	live: boolean;
};

function detailsOf(part: ToolPart): { calls?: unknown } {
	return typeof part.details === "object" && part.details !== null ? (part.details as { calls?: unknown }) : {};
}

type RawFinishedCall = {
	id: number;
	name: string;
	args: string;
	status: "ok" | "error" | "cancelled";
	durationMs?: number;
	error?: string;
};

function isRawFinishedCall(value: unknown): value is RawFinishedCall {
	if (typeof value !== "object" || value === null) return false;
	const call = value as Record<string, unknown>;
	return (
		typeof call.id === "number" &&
		typeof call.name === "string" &&
		typeof call.args === "string" &&
		(call.status === "ok" || call.status === "error" || call.status === "cancelled")
	);
}

/**
 * The exact diagnostic message pi-durable's `createBashTool` gives a non-zero exit (`exitCodeOf()` in transcript.ts
 * parses the same text from a single call's own diagnostics; a nested call only keeps it as cut error text).
 */
const EXIT_CODE_PATTERN = /^Command exited with code (-?\d+)/;

function classify(
	status: "ok" | "error" | "cancelled" | "running",
	error: string | undefined,
): { status: CodemodeCallStatus; exitCode?: number } {
	if (status !== "error") return { status };
	const match = error === undefined ? null : EXIT_CODE_PATTERN.exec(error);
	return match === null ? { status: "error" } : { status: "exited", exitCode: Number(match[1]) };
}

function finishedLine(raw: RawFinishedCall): CodemodeCallLine {
	const { status, exitCode } = classify(raw.status, raw.error);
	return {
		id: String(raw.id),
		name: raw.name,
		argsPreview: raw.args,
		status,
		...(raw.durationMs === undefined ? {} : { durationMs: raw.durationMs }),
		...(raw.error === undefined ? {} : { error: raw.error }),
		...(exitCode === undefined ? {} : { exitCode }),
	};
}

function compactArgs(value: unknown): string {
	if (value === undefined) return "";
	try {
		return JSON.stringify(value) ?? "";
	} catch {
		return "";
	}
}

function liveLine(slot: NestedToolSlot): CodemodeCallLine {
	const argsPreview = compactArgs(slot.arguments);
	if (slot.summary === undefined) {
		return { id: slot.callId, name: slot.name, argsPreview, status: "running" };
	}
	const { status, exitCode } = classify(slot.summary.isError ? "error" : "ok", slot.summary.error);
	return {
		id: slot.callId,
		name: slot.name,
		argsPreview,
		status,
		...(slot.summary.durationMs === undefined ? {} : { durationMs: slot.summary.durationMs }),
		...(slot.summary.error === undefined ? {} : { error: slot.summary.error }),
		...(exitCode === undefined ? {} : { exitCode }),
	};
}

const OUTPUT_HEADER = /^Script (?:completed|failed)\nWall time ([\d.]+) seconds\nOutput:\n?/;

/** Strips the fixed header `formatResult()` (pi-durable's codemode) puts in front of the script's own output. */
function splitOutput(text: string): { body: string; wallSeconds?: number } {
	const match = OUTPUT_HEADER.exec(text);
	if (match === null) return { body: text };
	return { body: text.slice(match[0].length), wallSeconds: Number(match[1]) };
}

const SUMMARY_LINE_CHARS = 90;

/** The script's first comment (stripped of its marker) or line of code, cut for the collapsed header. */
function scriptLine(code: string): string {
	const line = code
		.split("\n")
		.map((candidate) => candidate.trim())
		.find((candidate) => candidate.length > 0);
	if (line === undefined) return "Script";
	const comment = /^\/\/+\s*(.*)$/.exec(line);
	const text = (comment === null ? line : comment[1]) ?? "";
	if (text.length === 0) return "Script";
	return text.length > SUMMARY_LINE_CHARS ? `${text.slice(0, SUMMARY_LINE_CHARS - 1)}…` : text;
}

/** Nested calls grouped by tool name, most frequent first: "2 bash, 1 read". */
function callCounts(calls: readonly CodemodeCallLine[]): string {
	if (calls.length === 0) return "no tool calls";
	const counts = new Map<string, number>();
	for (const call of calls) counts.set(call.name, (counts.get(call.name) ?? 0) + 1);
	return [...counts.entries()]
		.sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
		.map(([name, count]) => `${count} ${name}`)
		.join(", ");
}

export function codemodeCallView(part: ToolPart): CodemodeCallView {
	const args = (part.arguments ?? {}) as Record<string, unknown>;
	const code = typeof args.code === "string" ? args.code : "";
	const details = detailsOf(part);
	const finished = Array.isArray(details.calls) ? details.calls.filter(isRawFinishedCall).map(finishedLine) : undefined;
	const live = finished === undefined;
	const calls = finished ?? (part.nestedCalls ?? []).map(liveLine);
	const { body, wallSeconds } = splitOutput(part.output ?? "");
	return {
		code,
		summary: `${scriptLine(code)} · ${callCounts(calls)}`,
		output: body,
		...(wallSeconds === undefined ? {} : { wallSeconds }),
		isError: part.isError === true,
		calls,
		live,
	};
}

/** The sentence the server appends to a result when a script only wrapped one call (packages/server codemode-wrap.ts). */
const ONE_CALL_NOTE = /\n*This script made one tool call and returned all of its output; call the tool directly next time\.\s*$/;

/** The tools a one-call script is shown as; any other tool keeps its script card. */
const UNWRAPPED_TOOLS = ["bash", "read", "write", "edit"];

function parseObject(text: string): Record<string, unknown> | undefined {
	try {
		const value: unknown = JSON.parse(text);
		return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
	} catch {
		return undefined;
	}
}

/**
 * A settled script that made exactly one `bash`/`read`/`write`/`edit` call, as that call: its arguments, its status,
 * the script's output as the call's output, and `viaScript` carrying the source. `undefined` when the script failed,
 * made another number of calls, made a different tool's call, or the server cut the call's arguments (they are a
 * 200-character preview, so a long command or file content does not parse); the script card shows those instead.
 */
export function singleCallOfScript(part: ToolPart): ToolPart | undefined {
	if (!isCodemodeTool(part.name) || part.status !== "done" || part.isError === true || part.output === undefined) return undefined;
	const raw = detailsOf(part).calls;
	if (!Array.isArray(raw) || raw.length !== 1 || !isRawFinishedCall(raw[0])) return undefined;
	const call = raw[0];
	if (call.status === "cancelled" || !UNWRAPPED_TOOLS.includes(call.name)) return undefined;
	const callArguments = parseObject(call.args);
	const code = (part.arguments as { code?: unknown } | undefined)?.code;
	if (callArguments === undefined || typeof code !== "string") return undefined;

	const line = finishedLine(call);
	const diagnostics: Diagnostic[] =
		call.error === undefined
			? []
			: [{ severity: "error", message: call.error, ...(line.status === "exited" ? { code: "exit_code" } : {}) }];
	const { body } = splitOutput(part.output);
	return {
		type: "tool",
		key: part.key,
		callId: part.callId,
		name: call.name,
		arguments: callArguments,
		status: "done",
		diagnostics: [...part.diagnostics, ...diagnostics],
		output: body.replace(ONE_CALL_NOTE, ""),
		isError: call.status === "error",
		...(call.durationMs === undefined && part.durationMs === undefined ? {} : { durationMs: call.durationMs ?? part.durationMs }),
		viaScript: { code },
	};
}
