/**
 * Compaction of the coordinator.
 *
 * pi-durable does the mechanics: it decides when to compact, cuts the transcript at a turn boundary, places the summary
 * as a `pi.compaction` entry and keeps the replaced entries in storage. This module supplies the two things the harness
 * adds on top:
 *
 * - Thresholds as fractions of the current model's context window: a background summary starts at 35%, the next request
 *   waits for one at 50%. They are installed as `settings.compaction.modelOverrides` for the coordinator's model, which
 *   pi-durable re-reads at every threshold check, so switching the coordinator's model keeps them right. Workers keep
 *   pi-durable's defaults unless they run on that same model (the overrides are keyed by model, not by conversation).
 * - The summary itself, through the `beforeCompact` hook: the model's narrative summary (pi's prompt, plus what must
 *   survive), the user's own messages verbatim, a compact view of the board, and where the older entries can be found again.
 *
 * `ContextUsageReader` reports the same policy back through `ConversationContext.usage`, so the app shows the thresholds
 * that are actually in effect rather than a copy that could drift.
 */
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { Context } from "@earendil-works/chord";
import { contentText } from "@earendil-works/pi-ai";
import type { AssistantMessage, Message, Model, Models } from "@earendil-works/pi-ai";
import { estimateContextTokens, estimateTextTokens } from "@earendil-works/pi-ai/utils/estimate";
import {
	CompactionTask,
	DEFAULT_COMPACTION_POLICY,
	type CompactionHooks,
	type CompactionPolicy,
	type CompactionSettings,
	type Conversation,
	type Cursor,
	type EntryId,
	type EntryRecord,
	type Extension,
	type HookApi,
	type LiveState,
	defineExtension,
	hook,
} from "@earendil-works/pi-durable";
import {
	CacheMissTracker,
	CHECK_IN_PREFIX,
	THREAD_FINISHED_PREFIX,
	THREAD_MESSAGE_PREFIX,
	WORKER_REPORT_PREFIX,
	type CacheMissTotals,
	type ContextUsage,
	type ModelRef,
} from "@mihai-harness/protocol";
import type { Coordinators } from "./coordinators.ts";
import { errorMessage } from "./errors.ts";
import { type BoardState, BoardDoc, summaryBoardView } from "./board.ts";

/** The extension's name; workers remove it, so a worker transcript compacts the way pi-durable does. */
export const COMPACTION_EXTENSION = "coordinator-compaction";

/** Where the coordinator's background summary starts, as a fraction of its model's context window. */
export const COORDINATOR_BACKGROUND_FRACTION = 0.35;
/** Where the next coordinator request waits for a summary, as a fraction of its model's context window. */
export const COORDINATOR_BLOCKING_FRACTION = 0.5;
/** How much recent context the summary leaves verbatim: a tenth of the window, within `KEEP_RECENT_MIN/MAX`. */
export const COORDINATOR_KEEP_RECENT_FRACTION = 0.1;

const KEEP_RECENT_MIN = 2_000;
const KEEP_RECENT_MAX = 20_000;

/** What the user's own messages may take of a summary, in tokens. They are short and carry the most signal. */
export const SUMMARY_USER_MESSAGE_TOKENS = 3_000;
/** The longest narrative summary a compaction asks of the model. */
export const SUMMARY_MAX_TOKENS = 4_000;
/** Longest tool result the summarizer reads of one call, as pi-durable's own summarizer truncates them. */
const SUMMARY_TOOL_RESULT_CHARS = 2_000;

/** How many entries one page of a conversation scan reads, for the compaction count and the `history` tool. */
const COUNT_PAGE_ENTRIES = 200;
/** Older entries than this are not counted; a count is a nicety, not worth reading a whole archive. */
const COUNT_MAX_ENTRIES = 20_000;

/**
 * pi-durable's summarization prompts (`SUMMARIZATION_SYSTEM_PROMPT` and `SUMMARIZATION_PROMPT` in its compaction task,
 * 1.4.0), which it does not export. The harness supplies its own summary through `beforeCompact`, so it has to ask in
 * the same words — with the additions the design asks for appended to the prompt.
 */
const SUMMARY_SYSTEM_PROMPT = `You are a context summarization assistant. Your task is to read a conversation between a user and an AI assistant, then produce a structured summary following the exact format specified.

Do NOT continue the conversation. Do NOT respond to any questions in the conversation. ONLY output the structured summary.`;

const SUMMARY_PROMPT = `The messages above are a conversation to summarize. Create a structured context checkpoint summary that another LLM will use to continue the work. If the conversation starts with an earlier summary, preserve its information and fold the newer messages into it.

Use this EXACT format:

## Goal
[What is the user trying to accomplish? Can be multiple items if the session covers different tasks.]

## Constraints & Preferences
- [Any constraints, preferences, or requirements mentioned by user]
- [Or "(none)" if none were mentioned]

## Progress
### Done
- [x] [Completed tasks/changes]

### In Progress
- [ ] [Current work]

### Blocked
- [Issues preventing progress, if any]

## Key Decisions
- **[Decision]**: [Brief rationale]

## Next Steps
1. [Ordered list of what should happen next]

## Critical Context
- [Any data, examples, or references needed to continue]
- [Or "(none)" if not applicable]

Keep each section concise. Preserve exact file paths, function names, and error messages.`;

/** What the harness adds to pi-durable's prompt: the things a continuation cannot work without. */
const SUMMARY_ADDITIONS = `This conversation is one the user runs through a harness that delegates work to workers. The summary is all the coordinator keeps of it, so besides the format above:

- Keep the user's intent: what they asked for, in their terms, including anything they rejected.
- Keep every decision that was made and the reason for it, so it is not quietly reversed later.
- List anything promised but not done: a task announced, a follow-up the user asked for, a check not yet run.

Do not invent progress. If something is uncertain or unfinished, say so.`;

/** The `pi.compaction` entry kind, so a count reads only summaries. */
const COMPACTION_ENTRY = "pi.compaction";

/** The key pi-durable resolves `modelOverrides` by: the exact `"provider/modelId"`. */
export function compactionModelKey(ref: ModelRef): string {
	return `${ref.provider}/${ref.modelId}`;
}

/** The coordinator's compaction policy for a context window of `contextWindow` tokens. */
export function coordinatorPolicy(contextWindow: number): CompactionPolicy {
	const blockingAt = Math.floor(contextWindow * COORDINATOR_BLOCKING_FRACTION);
	const backgroundAt = Math.floor(contextWindow * COORDINATOR_BACKGROUND_FRACTION);
	const keepRecent = Math.round(contextWindow * COORDINATOR_KEEP_RECENT_FRACTION);
	return {
		enabled: true,
		// pi-durable blocks above `contextWindow - reserveTokens` and starts a background summary `backgroundTokens`
		// below that, so the two fractions become the two distances from the window's top.
		reserveTokens: Math.max(0, contextWindow - blockingAt),
		keepRecentTokens: Math.min(KEEP_RECENT_MAX, Math.max(KEEP_RECENT_MIN, keepRecent)),
		backgroundTokens: Math.max(0, blockingAt - backgroundAt),
	};
}

/**
 * The `compaction` settings a project's Harness opens with: only the coordinator's model is overridden, so every other
 * model — a worker on a different model, and the harness-wide defaults — stays as pi-durable has it. The model is read
 * at each use, so a model change applies without reopening the Harness.
 */
export function coordinatorCompactionSettings(
	coordinatorModel: ModelRef | null,
	models: Models,
): CompactionSettings {
	if (coordinatorModel === null) return {};
	const model = models.getModel(coordinatorModel.provider, coordinatorModel.modelId);
	if (model === undefined) return {};
	return { modelOverrides: { [compactionModelKey(coordinatorModel)]: coordinatorPolicy(model.contextWindow) } };
}

/** The policy pi-durable resolves for `ref` under `settings`: its own default, then the harness-wide fields, then the
 * model's override, field by field. */
export function resolveCompactionPolicy(
	settings: CompactionSettings | undefined,
	ref: ModelRef,
): CompactionPolicy {
	const override = settings?.modelOverrides?.[compactionModelKey(ref)];
	return {
		enabled: override?.enabled ?? settings?.enabled ?? DEFAULT_COMPACTION_POLICY.enabled,
		reserveTokens: override?.reserveTokens ?? settings?.reserveTokens ?? DEFAULT_COMPACTION_POLICY.reserveTokens,
		keepRecentTokens:
			override?.keepRecentTokens ?? settings?.keepRecentTokens ?? DEFAULT_COMPACTION_POLICY.keepRecentTokens,
		backgroundTokens:
			override?.backgroundTokens ?? settings?.backgroundTokens ?? DEFAULT_COMPACTION_POLICY.backgroundTokens,
	};
}

/** Where `policy` puts the two thresholds in a window of `contextWindow` tokens. */
export function compactionThresholds(
	policy: CompactionPolicy,
	contextWindow: number,
): { backgroundAt: number; blockingAt: number } {
	const blockingAt = Math.max(0, Math.round(contextWindow - policy.reserveTokens));
	const backgroundAt = policy.backgroundTokens > 0 ? Math.max(0, Math.round(blockingAt - policy.backgroundTokens)) : blockingAt;
	return { backgroundAt, blockingAt };
}

/**
 * Whether one user input is the harness talking to itself rather than the user: a worker report, a check-in, or what
 * another thread posted (a finish, a failure, a message).
 */
export function isHarnessInput(text: string): boolean {
	return (
		text.startsWith(WORKER_REPORT_PREFIX) ||
		text.startsWith(CHECK_IN_PREFIX) ||
		text.startsWith(THREAD_FINISHED_PREFIX) ||
		text.startsWith(THREAD_MESSAGE_PREFIX)
	);
}

/**
 * The user's own messages of the entries a summary replaces, newest first, within `budgetTokens`. A message that would
 * not fit ends the list (older ones are smaller only by accident); one too long for the whole budget is cut, and says so.
 * Harness-injected inputs — worker reports and check-ins — are not the user's and never appear.
 */
export function userMessagesOf(
	entries: readonly EntryRecord[],
	budgetTokens = SUMMARY_USER_MESSAGE_TOKENS,
): { messages: string[]; omitted: number } {
	const texts: string[] = [];
	for (const entry of entries) {
		if (entry.kind !== "pi.user") continue;
		const message = entry.model?.[0];
		if (message === undefined || message.role !== "user") continue;
		const text = contentText(message.content).trim();
		if (text.length === 0 || isHarnessInput(text)) continue;
		texts.push(text);
	}
	const kept: string[] = [];
	let tokens = 0;
	let omitted = 0;
	for (let index = texts.length - 1; index >= 0; index--) {
		const text = texts[index] ?? "";
		const size = estimateTextTokens(text);
		if (kept.length === 0 && size > budgetTokens) {
			// The newest message is bigger than the whole budget: keep its beginning, which is where the ask is.
			kept.push(cutToTokens(text, budgetTokens));
			omitted = index;
			break;
		}
		if (tokens + size > budgetTokens) {
			omitted = index + 1;
			break;
		}
		tokens += size;
		kept.push(text);
	}
	return { messages: kept, omitted };
}

/** The longest prefix of `text` that stays within `tokens`, with a marker that the rest is gone. */
function cutToTokens(text: string, tokens: number): string {
	let low = 0;
	let high = text.length;
	while (low < high) {
		const middle = Math.ceil((low + high) / 2);
		if (estimateTextTokens(text.slice(0, middle)) <= tokens) low = middle;
		else high = middle - 1;
	}
	return low >= text.length ? text : `${text.slice(0, low)}\n[the rest of this message is in the earlier entries]`;
}

/**
 * The summary the coordinator gets: the model's narrative summary, then what has to survive exactly — the user's own
 * words, the board — and where everything older can be read again.
 */
export function coordinatorSummary(parts: {
	narrative: string;
	userMessages: readonly string[];
	omittedUserMessages: number;
	/** The compact board view, `summaryBoardView`. */
	board: string;
}): string {
	const notes: string[] = [];
	if (parts.omittedUserMessages > 0) {
		notes.push(
			`${parts.omittedUserMessages} older message${parts.omittedUserMessages === 1 ? " is" : "s are"} not repeated here; find them with the \`history\` tool.`,
		);
	}
	const messages =
		parts.userMessages.length === 0
			? "The user sent no messages of their own in this part."
			: parts.userMessages.map((text, index) => `${index + 1}. ${text}`).join("\n\n");
	return [
		parts.narrative.trim(),
		"## The user's own messages",
		["Verbatim, newest first, from the part this summary replaces.", ...notes].join(" "),
		"",
		messages,
		"",
		"## Board",
		"The project's board as it stands, never summarized:",
		"",
		parts.board,
		"",
		"## Older entries",
		`Everything before this summary is still in storage. Use the \`history\` tool to search it by words or to read a range of entry IDs when you need what this summary left out.`,
	].join("\n");
}

/** Model messages as plain text for the summarizer: no thinking, tool results clipped, as pi-durable serializes them. */
export function serializeTranscript(messages: readonly Message[]): string {
	const parts: string[] = [];
	for (const message of messages) {
		if (message.role === "user") {
			const text = contentText(message.content).trim();
			if (text.length > 0) parts.push(`[User]: ${text}`);
		} else if (message.role === "assistant") {
			const text = contentText(message.content).trim();
			if (text.length > 0) parts.push(`[Assistant]: ${text}`);
			const calls = message.content.flatMap((block) =>
				block.type === "toolCall"
					? [
							`${block.name}(${Object.entries(block.arguments)
								.map(([key, value]) => `${key}=${JSON.stringify(value)}`)
								.join(", ")})`,
						]
					: [],
			);
			if (calls.length > 0) parts.push(`[Assistant tool calls]: ${calls.join("; ")}`);
		} else if (message.role === "toolResult") {
			const text = contentText(message.content).trim();
			if (text.length === 0) continue;
			const clipped =
				text.length <= SUMMARY_TOOL_RESULT_CHARS
					? text
					: `${text.slice(0, SUMMARY_TOOL_RESULT_CHARS)}\n\n[... ${text.length - SUMMARY_TOOL_RESULT_CHARS} more characters truncated]`;
			parts.push(`[Tool result]: ${clipped}`);
		}
	}
	return parts.join("\n\n");
}

/** The summarizer's one user message: the serialized conversation, the prompt, and any manual instructions. */
export function summaryRequest(messages: readonly Message[], instructions: string | undefined): string {
	const focus = instructions === undefined ? "" : `\n\nAdditional focus: ${instructions}`;
	return `<conversation>\n${serializeTranscript(messages)}\n</conversation>\n\n${SUMMARY_PROMPT}\n\n${SUMMARY_ADDITIONS}${focus}`;
}

export type CompactionServiceOptions = {
	/** The coordinator conversation: only its compactions get this summary. */
	conversation: Conversation;
	/** Every coordinator conversation (main and its background threads); default: main only. */
	coordinators?: Coordinators;
	models: Models;
	/** The harness clock, for the board's archive. Default: `Date.now`. */
	now?: () => number;
	log?: (message: string) => void;
};

type BeforeCompact = Parameters<CompactionHooks["beforeCompact"]>;

/**
 * The coordinator's `beforeCompact` hook. The summary is built in the hook because pi-durable accepts one whole summary
 * from it (`{ summary }`) instead of running its own; returning nothing leaves the compaction to pi-durable, which is
 * what happens when the model call fails or the conversation is not the coordinator's.
 */
export class CompactionService {
	readonly #conversation: Conversation;
	readonly #coordinators: Coordinators | undefined;
	readonly #models: Models;
	readonly #log: (message: string) => void;
	readonly #now: () => number;
	#extension: Extension | undefined;

	constructor(options: CompactionServiceOptions) {
		this.#conversation = options.conversation;
		this.#coordinators = options.coordinators;
		this.#models = options.models;
		this.#log = options.log ?? (() => undefined);
		this.#now = options.now ?? Date.now;
	}

	get extension(): Extension {
		this.#extension ??= defineExtension({
			name: COMPACTION_EXTENSION,
			hooks: [
				hook(CompactionTask, {
					beforeCompact: (compaction, api, context) => this.#beforeCompact(compaction, api, context),
				}),
			],
		});
		return this.#extension;
	}

	async #beforeCompact(
		compaction: BeforeCompact[0],
		api: HookApi,
		context: Context,
	): Promise<{ summary: string } | undefined> {
		// Workers remove this extension; this is the second line of defense, as the worker and memory tools have.
		const coordinators = this.#coordinators;
		const isCoordinator =
			coordinators === undefined ? api.conversationId === this.#conversation.id : coordinators.isCoordinator(api.conversationId);
		if (!isCoordinator) return undefined;
		const conversation =
			api.conversationId === this.#conversation.id
				? this.#conversation
				: ((await coordinators?.conversation(api.conversationId, context)) ?? this.#conversation);
		const narrative = await this.#narrate(compaction, conversation, context);
		if (narrative === undefined) return undefined;
		// The board is the project's, on main's conversation, whichever thread compacts.
		const board = (await api.snapshot(BoardDoc, this.#conversation.id, context)) as BoardState | undefined;
		const users = userMessagesOf(compaction.entries);
		// The part being replaced starts where the last summary left off, so its first message dates that summary.
		const stamps = compaction.messages.map((message) => message.timestamp).filter((stamp) => Number.isFinite(stamp));
		const since = stamps.length === 0 ? null : Math.min(...stamps);
		return {
			summary: coordinatorSummary({
				narrative,
				userMessages: users.messages,
				omittedUserMessages: users.omitted,
				board: summaryBoardView(board, { now: this.#now(), since }),
			}),
		};
	}

	/** The model's narrative summary of the part being replaced, or undefined to let pi-durable summarize instead. */
	async #narrate(compaction: BeforeCompact[0], conversation: Conversation, context: Context): Promise<string | undefined> {
		const agent = await conversation.agent(context);
		const ref = agent.model;
		if (ref === undefined) return undefined;
		const model = this.#models.getModel(ref.provider, ref.modelId);
		if (model === undefined) return undefined;
		const now = Date.now();
		const messages: Message[] = [
			{ role: "system", content: SUMMARY_SYSTEM_PROMPT, timestamp: now },
			{
				role: "user",
				content: [{ type: "text", text: summaryRequest(compaction.messages, compaction.instructions) }],
				timestamp: now,
			},
		];
		let answer: AssistantMessage;
		try {
			answer = await this.#models.completeSimple(model, { messages }, {
				// A summary is asked once: it is not worth warming a provider cache with it.
				cacheRetention: "none",
				maxTokens: summaryMaxTokens(model),
				...(agent.thinkingLevel === "off" ? {} : { reasoning: agent.thinkingLevel }),
				...(context.abortSignal === undefined ? {} : { signal: context.abortSignal }),
			});
		} catch (error) {
			this.#log(`compaction summary request failed: ${errorMessage(error)}`);
			return undefined;
		}
		if (answer.stopReason === "error" || answer.stopReason === "aborted") {
			this.#log(`compaction summary failed (${answer.errorMessage ?? answer.stopReason}); using pi-durable's own`);
			return undefined;
		}
		const text = contentText(answer.content).trim();
		if (text.length === 0) {
			this.#log("compaction summary was empty; using pi-durable's own");
			return undefined;
		}
		return text;
	}
}

function summaryMaxTokens(model: Model<string>): number {
	return model.maxTokens > 0 ? Math.min(SUMMARY_MAX_TOKENS, model.maxTokens) : SUMMARY_MAX_TOKENS;
}

type CompactionCount = {
	/** Summaries in this conversation so far. */
	compactions: number;
	/** The newest entry the count has seen, so only entries after it are read next time. */
	newestEntryId: number;
	lastCompactionAt: string | null;
	cacheMisses: CacheMissTotals;
	/** Where the cache miss count stands: the previous request, so the next page goes on from it. */
	cacheTracker: CacheMissTracker;
};

/** The timestamp an entry's first message carries; a `pi.compaction`'s summary was stamped with the Harness clock. */
function entryTime(entry: EntryRecord): string | null {
	const timestamp = (entry.model?.[0] as { timestamp?: unknown } | undefined)?.timestamp;
	return typeof timestamp === "number" && Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

/**
 * `ConversationContext.usage`: how full a conversation's context is, where its model's thresholds sit, and how many
 * summaries and prompt cache misses it has had. The counts are read from the durable entries (compaction hides them
 * from the model, not from storage) and kept per conversation, so a context push reads only entries appended since the
 * last one.
 */
export class ContextUsageReader {
	readonly #models: Models;
	readonly #settings: () => CompactionSettings | undefined;
	readonly #counts = new Map<number, CompactionCount>();

	constructor(options: { models: Models; settings: () => CompactionSettings | undefined }) {
		this.#models = options.models;
		this.#settings = options.settings;
	}

	async read(options: {
		conversation: Conversation;
		model: ModelRef | undefined;
		messages: readonly Message[];
		live: LiveState | undefined;
		/** The newest entry of the view the usage is read with: when it has not moved, there is nothing to count. */
		newestEntryId: number | undefined;
		context?: Context;
	}): Promise<ContextUsage> {
		const policy = options.model === undefined ? undefined : resolveCompactionPolicy(this.#settings(), options.model);
		const model = options.model === undefined ? undefined : this.#models.getModel(options.model.provider, options.model.modelId);
		const thresholds =
			policy !== undefined && model !== undefined
				? compactionThresholds(policy, model.contextWindow)
				: { backgroundAt: null, blockingAt: null };
		const estimate = estimateContextTokens(options.messages);
		const count = await this.#count(options.conversation, options.newestEntryId, options.context ?? BACKGROUND_CONTEXT);
		return {
			// Null until an answer reports usage: before that the estimate is mostly the system prompt.
			contextTokens: estimate.lastUsageIndex === null ? null : Math.round(estimate.tokens),
			contextWindow: model?.contextWindow ?? null,
			backgroundAt: thresholds.backgroundAt,
			blockingAt: thresholds.blockingAt,
			compactions: count.compactions,
			lastCompactionAt: count.lastCompactionAt,
			compacting: (options.live?.compactions?.length ?? 0) > 0,
			cacheMisses: { ...count.cacheMisses },
		};
	}

	/** The conversation's summary count, reading only entries appended since the last look. */
	async #count(conversation: Conversation, newestEntryId: number | undefined, context: Context): Promise<CompactionCount> {
		const cached = this.#counts.get(conversation.id);
		if (cached !== undefined && (newestEntryId === undefined || newestEntryId <= cached.newestEntryId)) return cached;
		let count: CompactionCount = cached ?? {
			compactions: 0,
			newestEntryId: 0,
			lastCompactionAt: null,
			cacheMisses: {
				misses: 0,
				missedTokens: 0,
				missedCost: 0,
				unexplained: 0,
				unexplainedTokens: 0,
				unexplainedCost: 0,
				lastUnexplainedAt: null,
			},
			cacheTracker: new CacheMissTracker({
				cacheReadPerToken: (provider, modelId) => {
					const perMillion = this.#models.getModel(provider, modelId)?.cost.cacheRead;
					return perMillion === undefined ? undefined : perMillion / 1_000_000;
				},
			}),
		};
		let cursor: Cursor | undefined;
		let scanned = 0;
		// Entries are immutable and IDs ascend, so a scan that starts above the last seen ID never reads one twice.
		while (scanned < COUNT_MAX_ENTRIES) {
			const page = await conversation.entries(
				{ minEntryId: (count.newestEntryId + 1) as EntryId, order: "ascending" },
				COUNT_PAGE_ENTRIES,
				cursor,
				context,
			);
			for (const entry of page.items) {
				scanned += 1;
				if (entry.id > count.newestEntryId) count.newestEntryId = entry.id;
				for (const miss of count.cacheTracker.observeEntry(entry)) {
					const totals = count.cacheMisses;
					totals.misses += 1;
					totals.missedTokens += miss.missedTokens;
					totals.missedCost += miss.missedCost;
					if (miss.reason !== "unexplained") continue;
					totals.unexplained += 1;
					totals.unexplainedTokens += miss.missedTokens;
					totals.unexplainedCost += miss.missedCost;
					totals.lastUnexplainedAt = entryTime(entry) ?? totals.lastUnexplainedAt;
				}
				if (entry.kind !== COMPACTION_ENTRY) continue;
				count = { ...count, compactions: count.compactions + 1, lastCompactionAt: entryTime(entry) ?? count.lastCompactionAt };
			}
			if (page.next === undefined) break;
			cursor = page.next;
		}
		this.#counts.set(conversation.id, count);
		return count;
	}
}
