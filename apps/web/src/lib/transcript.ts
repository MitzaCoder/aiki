import type { CacheWarmStretch } from "@aiki/protocol";
import { cacheWarmByAnchor } from "./chat/cache-warm.js";
/**
 * Turns protocol entries and the `pi.live` document into what the chat renders.
 * It knows only the message shapes the server puts on the wire, not pi-durable
 * itself.
 *
 * Output is a list of items: a user message, a worker's report, a notice, or a
 * *turn*. A turn is everything the coordinator did between two user messages
 * (thinking, text, tool calls and their output, and how a message ended), so the
 * chat can show one orb, one column and one timestamp per turn.
 */
import {
	CacheMissTracker,
	isNotableCacheMiss,
	type CacheMiss,
	type ConversationView,
	type EntryRecord,
} from "@aiki/protocol";
import { parseBoardNotice } from "./board.ts";
import { parseCheckIn, parseWorkerNotice } from "./workers.ts";
import { parseThreadNotice, threadIdOfNotice, type ThreadNotice } from "./threads.ts";
import { singleCallOfScript } from "./chat/codemode.ts";

type TextBlock = { type: "text"; text: string };
type ThinkingBlock = { type: "thinking"; thinking: string; redacted?: boolean };
type ToolCallBlock = { type: "toolCall"; id: string; name: string; arguments?: unknown; argumentsError?: string };
type ImageBlock = { type: "image"; data: string; mimeType: string };
type ContentBlock = TextBlock | ThinkingBlock | ToolCallBlock | ImageBlock | { type: string };

type MessageLike = {
	role?: string;
	content?: unknown;
	stopReason?: string;
	errorMessage?: string;
	toolCallId?: string;
	toolName?: string;
	isError?: boolean;
	/** Milliseconds, from pi-ai. Used for the turn's time and duration. */
	timestamp?: number;
	model?: string;
	usage?: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number; cost?: { total?: number } };
	/** Milliseconds a tool's execution took, measured by pi for a tool result. */
	durationMs?: number;
	/** A tool result's own details (pi-durable's `ToolExecutionResult.details`), carried on the message, not `entry.data`. */
	details?: unknown;
};

export type LiveToolSlot = {
	callId: string;
	name: string;
	status: "pending" | "running" | "done";
	output?: string;
	droppedBytes?: number;
	droppedLines?: number;
	diagnostics?: Diagnostic[];
	taskId?: number;
	entry?: number;
};

/**
 * A call a running tool made through `executeTool()` (a code mode script above all), while it is still in flight:
 * `pi.live.nestedTools`, matched to its caller by `parentCallId === call.id`. Removed from `pi.live` once the caller
 * settles, so a finished call reads its nested calls from its own result `details` instead (`codemode.ts`).
 */
export type NestedToolSlot = {
	callId: string;
	name: string;
	status: "pending" | "running" | "done";
	parentCallId: string;
	arguments?: unknown;
	/** Once done: how the call ended. Absent while it still runs. */
	summary?: { isError: boolean; durationMs?: number; error?: string };
};

export type Diagnostic = { severity?: string; message?: string; code?: string };

/** The subset of pi-durable's `LiveState` a transcript renders. */
export type LiveState = {
	run?: { taskId: number; inputs: number[] };
	generation?: {
		attempt: number;
		message?: MessageLike;
		retry?: { at: number; error: string };
		deferred?: { pollAt: number };
	};
	tools?: LiveToolSlot[];
	/** Nested calls of the tool calls above, in creation order; a call's nested slots vanish once it settles. */
	nestedTools?: NestedToolSlot[];
	/** Compactions running now; each summary lands as a `pi.compaction` entry when it finishes. */
	compactions?: { taskId?: number; reason?: string; blocking?: boolean; attempt?: number }[];
	compactionFailure?: { reason?: string; error?: string };
	/** Added upstream after 1.4.0; rendered when a newer server sends it. */
	runFailure?: { reason?: string; detail?: string };
};

export type TranscriptImage = { data: string; mimeType: string };

export type ToolStatus = "pending" | "running" | "done";

/** One tool call in a turn, with its output once the result has landed. */
export type ToolPart = {
	type: "tool";
	key: string;
	callId: string;
	name: string;
	arguments?: unknown;
	output?: string;
	isError?: boolean;
	status: ToolStatus;
	diagnostics: Diagnostic[];
	/** The tool's own result details (pi's display diff, among others), when the server sends them. */
	details?: unknown;
	/** Still being produced by the run the server is working on. */
	live?: boolean;
	/** Milliseconds the call took, once its result has landed. */
	durationMs?: number;
	/** Calls this one is making right now through `executeTool()` (a code mode script's tool calls); empty once done. */
	nestedCalls?: NestedToolSlot[];
	/** The call was made by a code mode script that made only this call; the script's source. */
	viaScript?: { code: string };
};

/** A piece of a turn, in the order the model produced it. */
export type TurnPart =
	| { type: "thinking"; key: string; text: string; streaming?: boolean }
	| { type: "text"; key: string; text: string }
	| ToolPart
	| { type: "error"; key: string; message: string }
	| { type: "stopped"; key: string };

/** A thinking part, as one step of a run of reasoning. */
export type ThinkingStep = { key: string; text: string; streaming?: boolean };

/** The tools whose calls fold into one transcript card. Any other tool breaks the group. */
export const CODING_TOOL_NAMES = ["bash", "read", "write", "edit"] as const;
export type CodingToolName = (typeof CODING_TOOL_NAMES)[number];

export function isCodingTool(name: string): name is CodingToolName {
	return (CODING_TOOL_NAMES as readonly string[]).includes(name);
}

/** One line inside a coding group, in the order the model produced it. */
export type CodingItem =
	| { kind: "call"; key: string; part: ToolPart }
	| { kind: "thinking"; key: string; text: string; streaming?: boolean };

/**
 * Rows a turn renders as. Consecutive thinking parts are one row with several
 * steps, a run of coding calls (with thinking between them) is one row of
 * items, a run of the other tool calls is one row of calls ("5 steps");
 * anything else stands alone. The row keeps the key of its first part, so a row
 * that grows while the model streams is the same row to Svelte and keeps its
 * open state.
 */
export type TurnRow =
	| { kind: "thinking"; key: string; steps: ThinkingStep[] }
	| { kind: "coding"; key: string; items: CodingItem[] }
	| { kind: "steps"; key: string; calls: ToolPart[] }
	| { kind: "part"; key: string; part: TurnPart };

/** Whether the next non-thinking part after `from` is another coding call. */
function codingCallFollowsThinking(parts: readonly TurnPart[], from: number): boolean {
	for (let index = from; index < parts.length; index += 1) {
		const part = parts[index];
		if (part === undefined) return false;
		if (part.type === "thinking") continue;
		return part.type === "tool" && isCodingTool(part.name);
	}
	return false;
}

/**
 * Fold a turn's parts into rows. A coding run starts at a coding call, takes the
 * coding calls and thinking steps that follow it, and ends at its last call, so
 * thinking before the first call or after the last one stays in its own block;
 * text and any other tool break the run. A lone call is still a coding row, so
 * the card it renders does not remount when the model appends another call.
 */
export function groupTurnParts(parts: readonly TurnPart[]): TurnRow[] {
	const rows: TurnRow[] = [];
	let index = 0;
	while (index < parts.length) {
		const part = parts[index];
		if (part === undefined) break;
		if (part.type === "thinking") {
			const last = rows.at(-1);
			const step: ThinkingStep = {
				key: part.key,
				text: part.text,
				...(part.streaming === true ? { streaming: true } : {})
			};
			if (last?.kind === "thinking") last.steps.push(step);
			else rows.push({ kind: "thinking", key: part.key, steps: [step] });
			index += 1;
			continue;
		}
		if (part.type === "tool" && isCodingTool(part.name)) {
			const items: CodingItem[] = [{ kind: "call", key: part.key, part }];
			index += 1;
			while (index < parts.length) {
				const next = parts[index];
				if (next === undefined) break;
				if (next.type === "tool" && isCodingTool(next.name)) {
					items.push({ kind: "call", key: next.key, part: next });
					index += 1;
					continue;
				}
				if (next.type === "thinking" && codingCallFollowsThinking(parts, index + 1)) {
					items.push({
						kind: "thinking",
						key: next.key,
						text: next.text,
						...(next.streaming === true ? { streaming: true } : {})
					});
					index += 1;
					continue;
				}
				break;
			}
			rows.push({ kind: "coding", key: part.key, items });
			continue;
		}
		if (part.type === "tool") {
			// The calls pi-durable's own tools and this app's make (board, workers, threads, memory, schedules, anything else)
			// come in stacks between two sentences; a run of them folds into one row. A lone call keeps its own card, so a
			// turn with a single call reads as it always did.
			const calls: ToolPart[] = [part];
			index += 1;
			while (index < parts.length) {
				const next = parts[index];
				if (next?.type !== "tool" || isCodingTool(next.name)) break;
				calls.push(next);
				index += 1;
			}
			rows.push(calls.length === 1 ? { kind: "part", key: part.key, part } : { kind: "steps", key: part.key, calls });
			continue;
		}
		rows.push({ kind: "part", key: part.key, part });
		index += 1;
	}
	return rows;
}

/**
 * The structured `code: "exit_code"` diagnostic a non-zero `bash` exit carries (pi-durable's `createBashTool`), with
 * the code itself parsed from its fixed-format message (`"Command exited with code N"`) — the diagnostic has no
 * separate numeric field. `undefined` for any other error: a timeout, an interruption, or a tool error that is not a
 * shell exit.
 */
export function exitCodeOf(part: ToolPart): number | undefined {
	const diagnostic = part.diagnostics.find((candidate) => candidate.code === "exit_code");
	if (diagnostic === undefined) return undefined;
	const match = /-?\d+/.exec(diagnostic.message ?? "");
	return match === null ? undefined : Number(match[0]);
}

/** A non-zero exit whose command still printed something: worth noticing, not worth reading as a failure. */
function isExitedNonZero(part: ToolPart): boolean {
	return part.isError === true && exitCodeOf(part) !== undefined && (part.output ?? "").length > 0;
}

/** How a single card shows a call, including a live slot that has not started yet. */
export type ToolCardStatus = "preparing" | "running" | "done" | "error" | "exited" | "interrupted";

export function toolCardStatus(part: ToolPart): ToolCardStatus {
	if (part.isError === true) return isExitedNonZero(part) ? "exited" : "error";
	if (part.status === "done") return "done";
	if (part.status === "running") return "running";
	// A live slot that is still pending is queued behind the call in front of it, so it is on its way.
	return part.live === true ? "preparing" : "interrupted";
}

/** How a tool call ended, for its status icon and colour. `exited`: a non-zero exit that still printed output. */
export type ToolCallState = "running" | "failed" | "exited" | "done" | "stopped";

export function toolCallState(part: ToolPart): ToolCallState {
	const status = toolCardStatus(part);
	if (status === "error") return "failed";
	if (status === "exited") return "exited";
	if (status === "done") return "done";
	if (status === "interrupted") return "stopped";
	return "running";
}

export type CodingGroupSummary = {
	status: ToolCallState;
	/** "Ran 2 commands, read 3 files, edited 1 file", plus "· 2 thoughts" when thinking sits inside. */
	label: string;
	/** The counts that matter beside the label: "1 failed", "2 running". */
	detail?: string;
};

function plural(count: number, singular: string): string {
	return count === 1 ? singular : singular + "s";
}

/** The one-line status of a run of coding calls, for the collapsed group header. */
export function codingGroupSummary(items: readonly CodingItem[]): CodingGroupSummary {
	const calls = items.filter((item): item is Extract<CodingItem, { kind: "call" }> => item.kind === "call");
	const thoughtCount = items.length - calls.length;
	const counts: Record<CodingToolName, { total: number; running: number }> = {
		bash: { total: 0, running: 0 },
		read: { total: 0, running: 0 },
		write: { total: 0, running: 0 },
		edit: { total: 0, running: 0 }
	};
	let running = 0;
	let failed = 0;
	let exited = 0;
	let stopped = 0;
	for (const item of calls) {
		const call = item.part;
		const state = toolCallState(call);
		if (state === "running") running += 1;
		else if (state === "failed") failed += 1;
		else if (state === "exited") exited += 1;
		else if (state === "stopped") stopped += 1;
		if (isCodingTool(call.name)) {
			counts[call.name].total += 1;
			if (state === "running") counts[call.name].running += 1;
		}
	}
	const status: ToolCallState =
		running > 0 ? "running" : failed > 0 ? "failed" : exited > 0 ? "exited" : stopped > 0 ? "stopped" : "done";
	const clauses: string[] = [];
	const clause = (total: number, runningCount: number, done: string, doing: string, noun: string): void => {
		if (total === 0) return;
		clauses.push((runningCount > 0 ? doing : done) + " " + total + " " + plural(total, noun));
	};
	clause(counts.bash.total, counts.bash.running, "Ran", "Running", "command");
	clause(counts.read.total, counts.read.running, "read", "reading", "file");
	clause(counts.write.total, counts.write.running, "wrote", "writing", "file");
	clause(counts.edit.total, counts.edit.running, "edited", "editing", "file");
	const summary = clauses.join(", ");
	const thoughts = thoughtCount === 0 ? "" : " · " + thoughtCount + " " + plural(thoughtCount, "thought");
	const label = summary.charAt(0).toUpperCase() + summary.slice(1) + thoughts;
	const detail = [
		...(running > 0 ? [running + " running"] : []),
		...(failed > 0 ? [failed + " failed"] : []),
		...(exited > 0 ? [exited + " exited non-zero"] : []),
		...(stopped > 0 ? [stopped + " stopped"] : [])
	].join(" · ");
	return { status, label, ...(detail.length === 0 ? {} : { detail }) };
}

/**
 * The one-line status of a run of calls that are not coding tools, for the row
 * they fold into: "5 steps", and what went wrong beside it.
 */
export function stepsGroupSummary(calls: readonly ToolPart[]): CodingGroupSummary {
	let running = 0;
	let failed = 0;
	let exited = 0;
	let stopped = 0;
	for (const call of calls) {
		const state = toolCallState(call);
		if (state === "running") running += 1;
		else if (state === "failed") failed += 1;
		else if (state === "exited") exited += 1;
		else if (state === "stopped") stopped += 1;
	}
	const status: ToolCallState =
		running > 0 ? "running" : failed > 0 ? "failed" : exited > 0 ? "exited" : stopped > 0 ? "stopped" : "done";
	const detail = [
		...(running > 0 ? [running + " running"] : []),
		...(failed > 0 ? [failed + " failed"] : []),
		...(exited > 0 ? [exited + " exited non-zero"] : []),
		...(stopped > 0 ? [stopped + " stopped"] : [])
	].join(" · ");
	return {
		status,
		label: calls.length + " " + plural(calls.length, "step"),
		...(detail.length === 0 ? {} : { detail })
	};
}

/** The collapsed header of a thinking run: "Thought", or "Thought for a while · 3 steps". */
export function thinkingHeaderText(stepCount: number, active: boolean): string {
	if (stepCount <= 1) return active ? "Thinking" : "Thought";
	return (active ? "Thinking" : "Thought for a while") + " · " + stepCount + " steps";
}

/** Where a message the user sent is in its way to the conversation, until the run places it as an entry. */
export type WaitingInfo = {
	/** `sending`: the request is out. `waiting`: queued, the run has not taken it. `failed`: never admitted. `withdrawn`: taken out of the queue before the run read it. */
	state: "sending" | "waiting" | "failed" | "withdrawn";
	/** A steer reaches the run at its next tool boundary, a follow-up when its turn ends. */
	mode?: "steer" | "followUp";
	/** Why it failed. */
	error?: string;
	/** An action (cancel, edit) is in flight. */
	pending?: boolean;
};

export type TranscriptItem =
	| { kind: "cacheWarm"; key: string; stretch: CacheWarmStretch }
	| {
			kind: "user";
			key: string;
			text: string;
			images: TranscriptImage[];
			/** Images the bubble cannot show (a waiting message from another device is only known by how many). */
			imageCount?: number;
			timestamp?: number;
			waiting?: WaitingInfo;
	  }
	| {
			kind: "turn";
			key: string;
			parts: TurnPart[];
			streaming?: boolean;
			live?: boolean;
			/** Start and end of the turn, and what it cost, for the footer. */
			timestamp?: number;
			ended?: number;
			model?: string;
			usage?: TurnUsage;
			/** Requests of this turn that re-billed a notable part of the prompt the provider had cached. */
			cacheMisses?: CacheMiss[];
	  }
	| {
			/**
			 * A message a worker posted back to the coordinator. The server admits it as a user input, so it is recognised by
			 * its `[worker <id> reported]` / `[worker <id> failed: …]` prefix and drawn as a report rather than typed text.
			 */
			kind: "report";
			key: string;
			workerId: string;
			/** False for a failure report, whose text is in `failure` and has no body. */
			ok: boolean;
			body: string;
			failure?: string;
			timestamp?: number;
	  }
	| {
			/** The harness' periodic check-in on running workers, admitted as a user input like a report. */
			kind: "checkin";
			key: string;
			body: string;
			timestamp?: number;
	  }
	| {
			/** A note the harness posted about the board (`[board]` and what changed), admitted as a user input. */
			kind: "board";
			key: string;
			/** The note's first line. */
			summary: string;
			body: string;
			timestamp?: number;
	  }
	| {
			/**
			 * What another thread posted here, admitted as a user input: a background thread finished (`[thread <id>
			 * finished] <summary>`) or failed, a message from another thread (`[from <thread>] …`), or a thread note in a
			 * shape this app does not know yet (`other`). Never typed text.
			 */
			kind: "thread";
			key: string;
			notice: ThreadNotice;
			/** The thread it is about: the one that finished or failed, or the sender. */
			threadId: string | null;
			timestamp?: number;
	  }
	| {
			/**
			 * A compaction: the summary pi-durable wrote (`pi.compaction`), or the one running now. The summary is the user
			 * message the entry wraps, so it renders as markdown; a running compaction has none yet.
			 */
			kind: "compaction";
			key: string;
			/** The `pi.compaction` entry, for a link to this spot; a running compaction has none yet. */
			entryId?: number;
			summary?: string;
			timestamp?: number;
			running?: boolean;
			reason?: string;
	  }
	| { kind: "notice"; key: string; tone: "info" | "warning" | "error"; text: string; detail?: string };

function blocksOf(content: unknown): ContentBlock[] {
	if (typeof content === "string") return [{ type: "text", text: content }];
	if (!Array.isArray(content)) return [];
	return content.filter((block): block is ContentBlock => typeof block === "object" && block !== null);
}

function textOf(content: unknown): string {
	return blocksOf(content)
		.map((block) => (block.type === "text" ? (block as TextBlock).text : ""))
		.filter((text) => text.length > 0)
		.join("\n");
}

function imagesOf(content: unknown): TranscriptImage[] {
	return blocksOf(content)
		.filter((block): block is ImageBlock => block.type === "image" && typeof (block as ImageBlock).data === "string")
		.map((block) => ({ data: block.data, mimeType: block.mimeType }));
}

function toolCallsOf(content: unknown): ToolCallBlock[] {
	return blocksOf(content).filter((block): block is ToolCallBlock => block.type === "toolCall");
}

function diagnosticsOf(value: unknown): Diagnostic[] {
	if (typeof value !== "object" || value === null) return [];
	const diagnostics = (value as { diagnostics?: unknown }).diagnostics;
	if (!Array.isArray(diagnostics)) return [];
	return diagnostics.filter((item): item is Diagnostic => typeof item === "object" && item !== null);
}

export function liveState(view: ConversationView | undefined): LiveState | undefined {
	const value = view?.docs["pi.live"];
	return typeof value === "object" && value !== null ? (value as LiveState) : undefined;
}

/** Messages of an entry, tolerant of the entry kind carrying none. */
function messagesOf(entry: EntryRecord): MessageLike[] {
	return (entry.model ?? []).filter(
		(message): message is MessageLike => typeof message === "object" && message !== null,
	);
}

type ToolResult = {
	entryId: number;
	output: string;
	isError: boolean;
	diagnostics: Diagnostic[];
	details?: unknown;
	durationMs?: number;
};

function collectToolResults(entries: readonly EntryRecord[]): Map<string, ToolResult> {
	const results = new Map<string, ToolResult>();
	for (const entry of entries) {
		if (entry.kind !== "pi.tool-result") continue;
		for (const message of messagesOf(entry)) {
			if (message.role !== "toolResult" || typeof message.toolCallId !== "string") continue;
			results.set(message.toolCallId, {
				entryId: entry.id,
				output: textOf(message.content),
				isError: message.isError === true,
				diagnostics: diagnosticsOf(entry.data),
				...(message.details === undefined ? {} : { details: message.details }),
				...(message.durationMs === undefined ? {} : { durationMs: message.durationMs }),
			});
		}
	}
	return results;
}

/** What a turn's requests sent and got back, summed; `input` is the part of the prompt the cache did not cover. */
export type TurnUsage = { input: number; output: number; cacheRead: number; cacheWrite: number; cost: number };

type TurnBuilder = {
	key: string;
	parts: TurnPart[];
	streaming?: boolean;
	live?: boolean;
	timestamp?: number;
	ended?: number;
	model?: string;
	usage?: TurnUsage;
	cacheMisses?: CacheMiss[];
};

/** Fold a message's time, model and usage into its turn. */
function absorb(turn: TurnBuilder, message: MessageLike): void {
	if (typeof message.timestamp === "number") {
		turn.timestamp ??= message.timestamp;
		turn.ended = Math.max(turn.ended ?? message.timestamp, message.timestamp);
	}
	if (typeof message.model === "string" && message.model.length > 0) turn.model = message.model;
	const usage = message.usage;
	if (usage !== undefined) {
		const current = turn.usage ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 };
		turn.usage = {
			input: current.input + (usage.input ?? 0),
			output: current.output + (usage.output ?? 0),
			cacheRead: current.cacheRead + (usage.cacheRead ?? 0),
			cacheWrite: current.cacheWrite + (usage.cacheWrite ?? 0),
			cost: current.cost + (usage.cost?.total ?? 0),
		};
	}
}

/**
 * Build the render list: committed entries first, then the in-flight generation
 * and tool slots. Tool results belonging to a visible call are folded into it, so
 * a call and its output read as one block; the rest of a turn keeps the order the
 * model produced it in. A request that re-billed much of the cached prompt puts a cache miss on its turn; the first
 * request of the loaded entries has no previous one to compare with, so paging back can add a miss there.
 */
/** Whether an input's text is something the user typed, not a note the harness or another thread posted. */
export function isTypedInput(text: string): boolean {
	return (
		parseWorkerNotice(text) === undefined &&
		parseCheckIn(text) === undefined &&
		parseBoardNotice(text) === undefined &&
		parseThreadNotice(text) === undefined
	);
}

export type BuildOptions = {
	keepWarm?: readonly CacheWarmStretch[];
	/**
	 * The key a message sent from this screen keeps from waiting to placed, by the submission it was: with it the
	 * waiting bubble and the entry it becomes are one element. Without one, an entry a watch saw placed from a queue
	 * is keyed by its submission (`input-<id>`).
	 */
	inputKeys?: ReadonlyMap<number, string>;
};

export function buildTranscript(
	entries: readonly EntryRecord[],
	live: LiveState | undefined,
	options: BuildOptions = {},
): TranscriptItem[] {
	const items: TranscriptItem[] = [];
	const warmByAnchor = cacheWarmByAnchor(options.keepWarm ?? [], new Set(entries.map(entry => entry.id)));
	const cache = new CacheMissTracker();
	const results = collectToolResults(entries);
	const renderedCalls = new Set<string>();
	const renderedResults = new Set<number>();
	let turn: TurnBuilder | undefined;

	function ensureTurn(key?: string): TurnBuilder {
		// Keyed by the entry the turn starts at, so paging older entries in does not re-key the ones already drawn.
		turn ??= { key: key ?? `turn-${items.length}`, parts: [] };
		return turn;
	}

	function part(): string {
		return `p${ensureTurn().parts.length}`;
	}

	function flush(): void {
		if (turn !== undefined && turn.parts.length > 0) {
			items.push({ kind: "turn", ...turn });
		}
		turn = undefined;
	}

	function nestedCallsOf(callId: string): NestedToolSlot[] | undefined {
		const slots = (live?.nestedTools ?? []).filter((slot) => slot.parentCallId === callId);
		return slots.length === 0 ? undefined : slots;
	}

	function pushTool(call: ToolCallBlock, options: { live?: boolean; status?: ToolStatus } = {}): void {
		renderedCalls.add(call.id);
		const result = results.get(call.id);
		if (result !== undefined) renderedResults.add(result.entryId);
		const diagnostics: Diagnostic[] = [
			...(result?.diagnostics ?? []),
			...(call.argumentsError === undefined ? [] : [{ severity: "error" as const, message: call.argumentsError }]),
		];
		const nestedCalls = result === undefined ? nestedCallsOf(call.id) : undefined;
		const tool: ToolPart = {
			type: "tool",
			key: part(),
			callId: call.id,
			name: call.name,
			arguments: call.arguments,
			status: options.status ?? (result === undefined ? "pending" : "done"),
			diagnostics,
			...(result === undefined ? {} : { output: result.output, isError: result.isError }),
			...(result?.details === undefined ? {} : { details: result.details }),
			...(result?.durationMs === undefined ? {} : { durationMs: result.durationMs }),
			...(options.live === true ? { live: true } : {}),
			...(nestedCalls === undefined ? {} : { nestedCalls }),
		};
		ensureTurn().parts.push(singleCallOfScript(tool) ?? tool);
	}

	for (const entry of entries) {
		// Compactions, resets and instruction changes move the cache tracker; assistant messages are fed below.
		if (entry.kind !== "pi.assistant") cache.observeEntry(entry);
		switch (entry.kind) {
			case "pi.user": {
				flush();
				const messages = messagesOf(entry).filter((message) => message.role === "user");
				const text = messages.map((message) => textOf(message.content)).filter((value) => value.length > 0).join("\n");
				const images = messages.flatMap((message) => imagesOf(message.content));
				const timestamp = messages.find((message) => typeof message.timestamp === "number")?.timestamp;
				const notice = images.length === 0 ? parseWorkerNotice(text) : undefined;
				const checkIn =
					notice === undefined && images.length === 0 ? parseCheckIn(text) : undefined;
				const boardNotice =
					notice === undefined && checkIn === undefined && images.length === 0 ? parseBoardNotice(text) : undefined;
				const threadNotice =
					notice === undefined && checkIn === undefined && boardNotice === undefined && images.length === 0
						? parseThreadNotice(text)
						: undefined;
				if (notice !== undefined) {
					items.push(
						notice.kind === "report"
							? {
									kind: "report",
									key: `entry-${entry.id}`,
									workerId: notice.workerId,
									ok: true,
									body: notice.body,
									...(timestamp === undefined ? {} : { timestamp }),
								}
							: {
									kind: "report",
									key: `entry-${entry.id}`,
									workerId: notice.workerId,
									ok: false,
									body: "",
									failure: notice.failure,
									...(timestamp === undefined ? {} : { timestamp }),
								},
					);
				} else if (checkIn !== undefined) {
					items.push({
						kind: "checkin",
						key: `entry-${entry.id}`,
						body: checkIn,
						...(timestamp === undefined ? {} : { timestamp }),
					});
				} else if (threadNotice !== undefined) {
					items.push({
						kind: "thread",
						key: `entry-${entry.id}`,
						notice: threadNotice,
						threadId: threadIdOfNotice(threadNotice),
						...(timestamp === undefined ? {} : { timestamp }),
					});
				} else if (boardNotice !== undefined) {
					items.push({
						kind: "board",
						key: `entry-${entry.id}`,
						summary: boardNotice.summary,
						body: boardNotice.body,
						...(timestamp === undefined ? {} : { timestamp }),
					});
				} else if (text.length > 0 || images.length > 0) {
					items.push({
						kind: "user",
						key:
							entry.submissionId === undefined
								? `entry-${entry.id}`
								: (options.inputKeys?.get(entry.submissionId) ?? `input-${entry.submissionId}`),
						text,
						images,
						...(timestamp === undefined ? {} : { timestamp }),
					});
				}
				break;
			}
			case "pi.assistant": {
				const messages = messagesOf(entry).filter((message) => message.role === "assistant");
				for (const message of messages) {
					const builder = ensureTurn(`turn-${entry.id}`);
					absorb(builder, message);
					const miss = cache.observe(message);
					if (miss !== undefined && isNotableCacheMiss(miss)) (builder.cacheMisses ??= []).push(miss);
					for (const block of blocksOf(message.content)) {
						if (block.type === "thinking") {
							const thinking = (block as ThinkingBlock).thinking.trim();
							if (thinking.length > 0 && (block as ThinkingBlock).redacted !== true) {
								ensureTurn().parts.push({ type: "thinking", key: part(), text: thinking });
							}
						} else if (block.type === "text") {
							const text = (block as TextBlock).text;
							if (text.trim().length > 0) {
								ensureTurn().parts.push({ type: "text", key: part(), text });
							}
						} else if (block.type === "toolCall") {
							pushTool(block as ToolCallBlock);
						}
					}
					if (message.stopReason === "error") {
						ensureTurn().parts.push({
							type: "error",
							key: part(),
							message: message.errorMessage ?? "The model response failed.",
						});
					} else if (message.stopReason === "aborted") {
						ensureTurn().parts.push({ type: "stopped", key: part() });
					}
				}
				break;
			}
			case "pi.tool-result": {
				// Already folded into the call that produced it.
				if (renderedResults.has(entry.id)) break;
				for (const message of messagesOf(entry)) {
					if (message.role !== "toolResult" || typeof message.toolCallId !== "string") continue;
					renderedCalls.add(message.toolCallId);
					ensureTurn(`turn-${entry.id}`).parts.push({
						type: "tool",
						key: part(),
						callId: message.toolCallId,
						name: message.toolName ?? "tool",
						status: "done",
						output: textOf(message.content),
						isError: message.isError === true,
						diagnostics: diagnosticsOf(entry.data),
					});
				}
				break;
			}
			case "pi.reset": {
				flush();
				items.push({
					kind: "notice",
					key: `entry-${entry.id}`,
					tone: "info",
					text: "Context reset. Earlier messages are still in the transcript.",
				});
				break;
			}
			case "pi.compaction": {
				flush();
				const messages = messagesOf(entry);
				const summary = messages
					.map((message) => textOf(message.content))
					.filter((text) => text.trim().length > 0)
					.join("\n");
				const timestamp = messages.find((message) => typeof message.timestamp === "number")?.timestamp;
				const reason =
					typeof entry.data === "object" && entry.data !== null
						? (entry.data as { reason?: unknown }).reason
						: undefined;
				items.push({
					kind: "compaction",
					key: `entry-${entry.id}`,
					entryId: entry.id,
					...(summary.length === 0 ? {} : { summary }),
					...(timestamp === undefined ? {} : { timestamp }),
					...(typeof reason === "string" ? { reason } : {}),
				});
				break;
			}
			default:
				break;
		}
        for (const stretch of warmByAnchor.get(entry.id) ?? []) {
            flush();
            items.push({ kind: "cacheWarm", key: `cache-warm-${stretch.id}`, stretch });
            if (stretch.lastReadAt !== undefined) cache.touch(stretch.lastReadAt);
        }
	}

	const generation = live?.generation?.message;
	if (generation !== undefined) {
		const builder = ensureTurn("turn-live");
		builder.streaming = true;
		builder.live = true;
		absorb(builder, generation);
		const blocks = blocksOf(generation.content);
		for (const [blockIndex, block] of blocks.entries()) {
			if (block.type === "thinking") {
				const thinking = (block as ThinkingBlock).thinking;
				if (thinking.trim().length > 0 && (block as ThinkingBlock).redacted !== true) {
					builder.parts.push({
						type: "thinking",
						key: part(),
						text: thinking,
						// The live message's last block is the one still being written.
						...(blockIndex === blocks.length - 1 ? { streaming: true } : {}),
					});
				}
			} else if (block.type === "text") {
				const text = (block as TextBlock).text;
				if (text.length > 0) builder.parts.push({ type: "text", key: part(), text });
			} else if (block.type === "toolCall") {
				const call = block as ToolCallBlock;
				if (!renderedCalls.has(call.id)) pushTool(call, { live: true });
			}
		}
	}

	const slots = (live?.tools ?? []).filter((slot) => !renderedCalls.has(slot.callId));
	if (slots.length > 0) {
		const builder = ensureTurn("turn-live");
		builder.live = true;
		for (const slot of slots) {
			renderedCalls.add(slot.callId);
			const nestedCalls = nestedCallsOf(slot.callId);
			builder.parts.push({
				type: "tool",
				key: part(),
				callId: slot.callId,
				name: slot.name,
				status: slot.status,
				diagnostics: slot.diagnostics ?? [],
				live: true,
				...(slot.output === undefined ? {} : { output: slot.output }),
				...(nestedCalls === undefined ? {} : { nestedCalls }),
			});
		}
	}

	flush();

	for (const compaction of live?.compactions ?? []) {
		items.push({
			kind: "compaction",
			key: `live-compaction-${compaction.taskId ?? items.length}`,
			running: true,
			...(compaction.reason === undefined ? {} : { reason: compaction.reason }),
		});
	}

	if (live?.generation?.retry !== undefined) {
		items.push({
			kind: "notice",
			key: "live-retry",
			tone: "warning",
			text: "The model request failed; retrying.",
			detail: live.generation.retry.error,
		});
	}

	if (live?.runFailure !== undefined) {
		items.push({
			kind: "notice",
			key: "live-run-failure",
			tone: "error",
			text: `The last run failed${live.runFailure.reason === undefined ? "" : ` (${live.runFailure.reason})`}.`,
			...(live.runFailure.detail === undefined ? {} : { detail: live.runFailure.detail }),
		});
	}

	if (live?.compactionFailure !== undefined) {
		items.push({
			kind: "notice",
			key: "live-compaction-failure",
			tone: "error",
			text: "Compaction failed.",
			...(live.compactionFailure.error === undefined ? {} : { detail: live.compactionFailure.error }),
		});
	}

	return items;
}

/** The text of a turn, for its copy button. */
export function turnText(parts: readonly TurnPart[]): string {
	return parts
		.filter((part): part is Extract<TurnPart, { type: "text" }> => part.type === "text")
		.map((part) => part.text)
		.join("\n\n");
}

/** Format tool arguments compactly for a `<pre>` block. */
export function formatArguments(value: unknown): string {
	if (value === undefined) return "";
	try {
		return JSON.stringify(value, null, 2) ?? "";
	} catch {
		return String(value);
	}
}