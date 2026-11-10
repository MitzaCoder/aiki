import { stateKind } from "./state-identity.ts";
import { cacheWarmAuthFingerprint, cacheWarmHeaders, supportsCacheWarm } from "./cache-warm-transport.ts";
import { CoordinatorCacheWarm, type WarmRequest } from "./cache-keep-warm.ts";
/**
 * The request log: one row per model request of every conversation (main, threads, workers), with its tokens and cost,
 * the prompt cache miss it paid for (the protocol's `CacheMissTracker` rules), what woke the agent, the cache retention,
 * and what changed in the prompt since the conversation's previous request (`prompt-fingerprint.ts`). Rows go to
 * `request-log.sqlite` in the data directory (`request-log-store.ts`); `cache.stats` and `bun run cache-report` read it.
 *
 * What it sees, and how:
 * - pi-durable's generation task runs a `beforeRequest` hook (this module's extension) with the conversation and task,
 *   right before it calls `Models.streamSimple` with the same message objects. The hook tags the last message; the
 *   wrapped `Models` finds the tag, so it knows the request is a turn of that conversation. Requests without a tag
 *   (compaction summaries, the memory agent) ask for no cache and are not logged.
 * - The wrapped `streamSimple` sees the messages (instructions as named sections, tool definitions, the transcript),
 *   the options (`cacheRetention`), the provider payload through `onPayload`, and the final message with its usage.
 * - Everything is worked out after the response, one request at a time, off the request's path: a failure is logged and
 *   dropped, and never reaches the request.
 */
import {
	BOARD_PREFIX,
	CacheMissTracker,
	CHECK_IN_PREFIX,
	type ConversationKind,
	type PreviousRequest,
	THREAD_FINISHED_PREFIX,
	THREAD_MESSAGE_PREFIX,
	type WakeReason,
	WORKER_REPORT_PREFIX,
} from "@aiki/protocol";
import type { Models } from "@earendil-works/pi-ai";
import { defineExtension, type Extension, GenerationTask, hook } from "@earendil-works/pi-durable";
import { errorMessage } from "./errors.ts";
import {
	diffFingerprints,
	fingerprintRequest,
	messageText,
	type PromptFingerprint,
	startsOver,
} from "./prompt-fingerprint.ts";
import { type ConversationIdentity, REQUEST_LOG_KEEP_DAYS, type RequestLogStore, type RequestRow } from "./request-log-store.ts";

export const REQUEST_LOG_EXTENSION_NAME = stateKind("request-log");

const UNKNOWN_IDENTITY: ConversationIdentity = {
	kind: "other",
	threadId: null,
	workerId: null,
	taskId: null,
	scheduleId: null,
};

/** What came into a conversation since its previous request, as far as the wake goes. */
export type RequestTail = {
	/** Tool results: the turn going on after its tool calls. */
	toolResults: number;
	/** The text of each user message, oldest first. */
	userTexts: string[];
	/** The conversation had no answer before: this is its first turn. */
	firstTurn: boolean;
	/** The previous request sent the very same messages: this one asks again after it failed. */
	repeated: boolean;
};

/**
 * What woke the agent for a request, from what came in since the previous one and which conversation it is. Nothing new
 * after an answer is a retry too: the failed answer is in the transcript, and the model is asked again after it.
 */
export function wakeOf(tail: RequestTail, identity: Pick<ConversationIdentity, "kind" | "scheduleId">): WakeReason {
	if (tail.repeated) return "retry";
	if (tail.toolResults > 0) return "continue";
	const text = tail.userTexts.at(-1);
	if (text === undefined) return tail.firstTurn ? "unknown" : "retry";
	if (text.startsWith(CHECK_IN_PREFIX)) return "check_in";
	if (text.startsWith(WORKER_REPORT_PREFIX)) return "worker_report";
	if (text.startsWith(THREAD_FINISHED_PREFIX)) return "thread_finished";
	if (text.startsWith(THREAD_MESSAGE_PREFIX)) return "thread_message";
	if (text.startsWith(BOARD_PREFIX)) return "board";
	const started = identity.scheduleId !== null ? "schedule" : "brief";
	if (identity.kind === "worker") return tail.firstTurn ? started : "coordinator";
	if (identity.kind === "thread" && tail.firstTurn) return started;
	return "user";
}

type AssistantLike = {
	provider?: unknown;
	model?: unknown;
	timestamp?: unknown;
	stopReason?: unknown;
	durationMs?: unknown;
	usage?: {
		input?: unknown;
		output?: unknown;
		cacheRead?: unknown;
		cacheWrite?: unknown;
		cacheWrite1h?: unknown;
		cost?: { input?: unknown; output?: unknown; cacheRead?: unknown; cacheWrite?: unknown; total?: unknown };
	};
};

function count(value: unknown): number {
	return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/**
 * One conversation's requests in order, turned into rows: the cache miss tracker, the previous request's time, and
 * who the conversation is. The live log and the read-back from transcripts both feed one.
 */
export class ConversationRequests {
	readonly projectId: string;
	readonly conversationId: number;
	identity: ConversationIdentity;
	readonly #tracker: CacheMissTracker;
	#lastAt: number | undefined;

	constructor(options: {
		projectId: string;
		conversationId: number;
		identity: ConversationIdentity;
		cacheReadPerToken?: (provider: string, model: string) => number | undefined;
	}) {
		this.projectId = options.projectId;
		this.conversationId = options.conversationId;
		this.identity = options.identity;
		this.#tracker = new CacheMissTracker(
			options.cacheReadPerToken === undefined ? {} : { cacheReadPerToken: options.cacheReadPerToken },
		);
	}

	/** Go on from a request logged earlier (by another process). */
	seed(previous: PreviousRequest | undefined, lastAt: number | undefined): void {
		if (previous !== undefined) this.#tracker.seed(previous);
		this.#lastAt = lastAt;
	}

	get hasPrevious(): boolean {
		return this.#lastAt !== undefined;
	}

	/** A summary or a reset: the next request starts a new context. */
	restart(): void {
		this.#tracker.reset();
	}

	touch(at: number): void { this.#tracker.touch(at); }
	instructionsChanged(): void {
		this.#tracker.instructionsChanged();
	}

	/** One response: its row, and it becomes the previous request. */
	request(
		message: AssistantLike,
		extra: Pick<RequestRow, "wake" | "retention" | "changes" | "source">,
	): RequestRow {
		const miss = this.#tracker.observe({ role: "assistant", ...message });
		const usage = message.usage ?? {};
		const cost = usage.cost ?? {};
		const at = count(message.timestamp);
		const input = count(usage.input);
		const cacheRead = count(usage.cacheRead);
		const cacheWrite = count(usage.cacheWrite);
		const row: RequestRow = {
			...this.identity,
			at,
			projectId: this.projectId,
			conversationId: this.conversationId,
			provider: typeof message.provider === "string" ? message.provider : "",
			model: typeof message.model === "string" ? message.model : "",
			stopReason: typeof message.stopReason === "string" ? message.stopReason : null,
			input,
			cacheRead,
			cacheWrite,
			cacheWrite1h: typeof usage.cacheWrite1h === "number" ? usage.cacheWrite1h : null,
			output: count(usage.output),
			cost: count(cost.total),
			costInput: count(cost.input),
			costCacheRead: count(cost.cacheRead),
			costCacheWrite: count(cost.cacheWrite),
			costOutput: count(cost.output),
			promptTokens: input + cacheRead + cacheWrite,
			idleMs: this.#lastAt === undefined ? null : Math.max(0, at - this.#lastAt),
			missTokens: miss?.missedTokens ?? 0,
			missCost: miss?.missedCost ?? 0,
			missReason: miss?.reason ?? null,
			wake: extra.wake,
			retention: extra.retention,
			changes: extra.changes,
			source: extra.source,
			durationMs: typeof message.durationMs === "number" ? Math.round(message.durationMs) : null,
		};
		this.#lastAt = at;
		return row;
	}
}

type RequestTag = { projectId: string; conversationId: number; prefixRevision?: string };

type PendingRequest = {
	warm: Omit<WarmRequest, "row" | "payload">;
	tag: RequestTag;
	messages: readonly unknown[];
	payload: unknown;
	message: AssistantLike;
	retention: string;
};

type LiveConversation = {
	requests: ConversationRequests;
	fingerprint: PromptFingerprint | undefined;
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** What came in since the last answer in the messages a request sends, and the instruction updates among them. */
export function requestTail(messages: readonly unknown[]): RequestTail & { updates: string[]; systemUpdates: number } {
	let lastAssistant = -1;
	for (let index = messages.length - 1; index >= 0; index -= 1) {
		const message = messages[index];
		if (isRecord(message) && message.role === "assistant") {
			lastAssistant = index;
			break;
		}
	}
	const tail = { toolResults: 0, userTexts: [] as string[], firstTurn: lastAssistant < 0, repeated: false, updates: [] as string[], systemUpdates: 0 };
	// Before the first answer, the leading system message is the prompt itself, not an update.
	const start = lastAssistant < 0 ? 1 : lastAssistant + 1;
	for (let index = start; index < messages.length; index += 1) {
		const message = messages[index];
		if (!isRecord(message)) continue;
		if (message.role === "toolResult") tail.toolResults += 1;
		else if (message.role === "user") tail.userTexts.push(messageText(message.content));
		else if (message.role === "system") {
			tail.systemUpdates += 1;
			if (isRecord(message.sections)) tail.updates.push(...Object.keys(message.sections));
			if (Array.isArray(message.toolsAdded) || Array.isArray(message.toolsRemoved)) tail.updates.push("tools");
		}
	}
	tail.updates = [...new Set(tail.updates)];
	return tail;
}

export type RequestLogOptions = {
	store: RequestLogStore;
	log?: (message: string) => void;
	now?: () => number;
	/** The cache-read price per token of a model, for a request that read nothing. */
	cacheReadPerToken?: (provider: string, model: string) => number | undefined;
};

/** Conversations whose fingerprint stays in memory; others are read back from the store when they send again. */
const LIVE_CONVERSATIONS = 64;

export class RequestLog {
	readonly store: RequestLogStore;
	readonly warming: CoordinatorCacheWarm;
	readonly #log: (message: string) => void;
	readonly #now: () => number;
	readonly #cacheReadPerToken: RequestLogOptions["cacheReadPerToken"];
	/** The last message object of each request the hook saw, to the conversation that sends it. */
	readonly #tags = new WeakMap<object, RequestTag>();
	readonly #identify = new Map<string, (conversationId: number) => Promise<ConversationIdentity>>();
	readonly #identities = new Map<string, ConversationIdentity>();
	readonly #conversations = new Map<string, LiveConversation>();
	/** Each project's read-back from its transcripts; live rows wait for it so they go on from its last row. */
	readonly #backfills = new Map<string, Promise<unknown>>();
	#queue: Promise<void> = Promise.resolve();
	#failures = 0;
	#closed = false;

	constructor(options: RequestLogOptions) {
		this.store = options.store;
		this.store.markWarmRestarted();
		this.warming = new CoordinatorCacheWarm(options.store);
		this.#log = options.log ?? ((message) => console.log(message));
		this.#now = options.now ?? Date.now;
		this.#cacheReadPerToken = options.cacheReadPerToken;
	}

	/** The extension that tags each turn's request with its conversation; one per project, installed in its registry. */
	extension(projectId: string, identify: (conversationId: number) => Promise<ConversationIdentity>): Extension {
		this.#identify.set(projectId, identify);
		return defineExtension({
			name: REQUEST_LOG_EXTENSION_NAME,
			hooks: [
				hook(GenerationTask, {
					beforeRequest: async (request, api) => {
						try {
							const last = request.messages.at(-1);
							if (typeof last === "object" && last !== null) {
								this.#tags.set(last, { projectId, conversationId: Number(api.conversationId) });
								this.warming.invalidate(projectId, "Conversation resumed", Number(api.conversationId));
								const prefixRevision = await this.warming.prefixRevision(projectId, Number(api.conversationId));
								if (prefixRevision !== undefined) this.#tags.set(last, { projectId, conversationId: Number(api.conversationId), prefixRevision });
							}
						} catch {
							// Never in the way of the request.
						}
						return undefined;
					},
				}),
			],
		});
	}

	/** Live rows of `projectId` wait for this (its read-back from transcripts) before they are written. */
	waitFor(projectId: string, backfill: Promise<unknown>): void {
		this.#backfills.set(
			projectId,
			backfill.catch(() => undefined),
		);
	}

	/** The same models, with every tagged turn request logged once it ends. */
	observeModels(models: Models): Models {
		this.warming.useModels(models);
		const wrapStream = (value: (...args: unknown[]) => unknown) =>
			(model: unknown, context: unknown, options?: Record<string, unknown>) => {
				let tag: RequestTag | undefined;
				let messages: readonly unknown[] | undefined;
				try {
					messages = (context as { messages?: unknown[] } | undefined)?.messages;
					const last = messages?.at(-1);
					tag = typeof last === "object" && last !== null ? this.#tags.get(last) : undefined;
				} catch {
					tag = undefined;
				}
				if (tag === undefined || messages === undefined || this.#closed) return value.call(models, model, context, options);
				// The list as sent: a later change to the caller's array is not this request's.
				const sent = [...messages];
				let payload: unknown;
				let authFingerprint: string | undefined;
				let cacheHeaders: Record<string, string> | undefined;
				const contextSnapshot = structuredClone(context) as WarmRequest["context"];
				const transport = (options?.fetch as typeof fetch | undefined) ?? globalThis.fetch;
				const captureFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
					const request = new Request(input instanceof Request ? input.clone() : input, init);
					if (supportsCacheWarm(model as WarmRequest["model"])) {
						payload = JSON.parse(await request.clone().text());
						authFingerprint = cacheWarmAuthFingerprint(request.headers);
						cacheHeaders = cacheWarmHeaders(request.headers);
					}
					return transport(input, init);
				}) as typeof fetch;
				const given = options?.onPayload as ((payload: unknown, model: unknown) => unknown) | undefined;
				const observed = {
					...options,
					fetch: captureFetch,
					onPayload: async (body: unknown, bodyModel: unknown) => {
						const replaced = await given?.(body, bodyModel);
						payload = replaced ?? body;
						return replaced;
					},
				};
				const stream = value.call(models, model, context, observed) as { result?: () => Promise<unknown> };
				const retention = typeof options?.cacheRetention === "string" ? options.cacheRetention : "short";
				const by = tag;
				try {
					void stream
						.result?.()
						.then((message) => this.#enqueue({ tag: by, messages: sent, payload, message: message as AssistantLike, retention, warm: { models, ...(by.prefixRevision === undefined ? {} : { prefixRevision: by.prefixRevision }), model: model as WarmRequest["model"], context: contextSnapshot, ...(authFingerprint === undefined ? {} : { authFingerprint }), ...(cacheHeaders === undefined ? {} : { cacheHeaders }), options: { ...options } as WarmRequest["options"] } }))
						.catch(() => undefined);
				} catch {
					// A stream without a result is not logged.
				}
				return stream;
			};
		return new Proxy(models, {
			get(target, property, receiver) {
				const value = Reflect.get(target, property, receiver) as unknown;
				if (typeof value !== "function") return value;
				if (property === "streamSimple") return wrapStream(value as (...args: unknown[]) => unknown);
				return (value as (...args: unknown[]) => unknown).bind(target);
			},
		});
	}

	warmStretches(projectId: string, conversationId: number) {
		try { return this.store.warmStretches(projectId, conversationId); } catch { return []; }
	}

	/** Resolves once every request handed over so far is written (tests, shutdown). */
	async flush(): Promise<void> {
		await this.#queue;
	}

	async close(): Promise<void> {
		this.#closed = true;
		this.warming.close();
		await this.flush();
		this.store.close();
	}

	/** Forget rows older than the kept days. */
	prune(): void {
		try {
			const removed = this.store.prune(this.#now(), REQUEST_LOG_KEEP_DAYS);
			if (removed > 0) this.#log(`request log: removed ${removed} rows older than ${REQUEST_LOG_KEEP_DAYS} days`);
		} catch (error) {
			this.#log(`request log: prune failed: ${errorMessage(error)}`);
		}
	}

	#enqueue(request: PendingRequest): void {
		this.#queue = this.#queue.then(async () => {
			// Yield first: the request's own bookkeeping goes before the log's hashing.
			await new Promise((resolve) => setTimeout(resolve, 0));
			try {
				await this.#record(request);
			} catch (error) {
				this.#failures += 1;
				// One line per failure would flood the journal if the database broke; the first few say enough.
				if (this.#failures <= 5 || this.#failures % 100 === 0) {
					this.#log(`request log: could not record a request (${this.#failures} so far): ${errorMessage(error)}`);
				}
			}
		});
	}

	async #identity(projectId: string, conversationId: number): Promise<ConversationIdentity> {
		const key = `${projectId}:${conversationId}`;
		const known = this.#identities.get(key);
		if (known !== undefined) return known;
		const identify = this.#identify.get(projectId);
		let identity = UNKNOWN_IDENTITY;
		if (identify !== undefined) {
			try {
				identity = await identify(conversationId);
			} catch (error) {
				this.#log(`request log: could not tell which conversation ${projectId}/${conversationId} is: ${errorMessage(error)}`);
			}
		}
		// A worker not yet in the list right after its spawn reads as unknown; ask again next time.
		if (identity.kind !== "other") this.#identities.set(key, identity);
		return identity;
	}

	#conversation(projectId: string, conversationId: number, identity: ConversationIdentity): LiveConversation {
		const key = `${projectId}:${conversationId}`;
		let live = this.#conversations.get(key);
		if (live !== undefined) {
			// Most recently used last, so the oldest goes first.
			this.#conversations.delete(key);
			this.#conversations.set(key, live);
			live.requests.identity = identity;
			return live;
		}
		const requests = new ConversationRequests({
			projectId,
			conversationId,
			identity,
			...(this.#cacheReadPerToken === undefined ? {} : { cacheReadPerToken: this.#cacheReadPerToken }),
		});
		requests.seed(this.store.previousRequest(projectId, conversationId), this.store.lastRequestAt(projectId, conversationId));
		live = { requests, fingerprint: this.store.promptState(projectId, conversationId) };
		this.#conversations.set(key, live);
		while (this.#conversations.size > LIVE_CONVERSATIONS) {
			const oldest = this.#conversations.keys().next().value;
			if (oldest === undefined) break;
			this.#conversations.delete(oldest);
		}
		return live;
	}

	async #record(request: PendingRequest): Promise<void> {
		const { projectId, conversationId } = request.tag;
		await this.#backfills.get(projectId);
		const identity = await this.#identity(projectId, conversationId);
		const live = this.#conversation(projectId, conversationId, identity);
		const fingerprint = fingerprintRequest(request.messages, request.payload);
		const previous = live.fingerprint;
		const tail = requestTail(request.messages);
		const restarted = previous !== undefined && startsOver(previous, fingerprint);
		if (restarted) live.requests.restart();
		if (tail.systemUpdates > 0) live.requests.instructionsChanged();
		const sameMessages =
			previous !== undefined &&
			!restarted &&
			previous.messages.length === fingerprint.messages.length &&
			previous.messages.every((hash, index) => hash === fingerprint.messages[index]);
		const wake = wakeOf({ ...tail, repeated: sameMessages }, identity);
		for (const stretch of this.store.warmStretches(projectId, conversationId)) {
			if (stretch.lastReadAt !== undefined && stretch.lastReadAt < count(request.message.timestamp)) live.requests.touch(stretch.lastReadAt);
		}
		const row = live.requests.request(request.message, {
			wake,
			retention: request.retention,
			changes: previous === undefined ? null : diffFingerprints(previous, fingerprint, tail.updates),
			source: "live",
		});
		this.store.insert(row);
		live.fingerprint = fingerprint;
		this.store.savePromptState(projectId, conversationId, fingerprint, row.at);
		await this.warming.real({ ...request.warm, row, payload: request.payload });
	}
}

export type { ConversationIdentity, RequestRow } from "./request-log-store.ts";
export type { ConversationKind };
