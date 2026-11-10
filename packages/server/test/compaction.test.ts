/**
 * Compaction of the coordinator: thresholds from the model's context window, the summary the `beforeCompact` hook
 * supplies, and the `history` tool that reaches the entries a summary replaced.
 */
import { afterEach, describe, expect, it } from "bun:test";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { TranscriptContext } from "@earendil-works/pi-ai";
import { DEFAULT_COMPACTION_POLICY } from "@earendil-works/pi-durable";
import { fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
import type { ModelRef } from "@aiki/protocol";
import {
	COMPACTION_EXTENSION,
	compactionThresholds,
	ContextUsageReader,
	coordinatorCompactionSettings,
	coordinatorPolicy,
	coordinatorSummary,
	isHarnessInput,
	resolveCompactionPolicy,
	SUMMARY_USER_MESSAGE_TOKENS,
	userMessagesOf,
} from "../src/compaction.ts";
import { HISTORY_EXTENSION } from "../src/history.ts";
import { createSetup, entryText, errorOf, TestClient, type TestSetup } from "./support.ts";

const cleanups: (() => Promise<void>)[] = [];
const clients: TestClient[] = [];

const FAUX: ModelRef = { provider: "faux", modelId: "faux-1" };
const SMALL: ModelRef = { provider: "small", modelId: "small-1" };

async function setup(options?: Parameters<typeof createSetup>[0]): Promise<TestSetup> {
	const created = await createSetup(options);
	cleanups.push(created.cleanup);
	return created;
}

async function connect(server: TestSetup["server"]): Promise<TestClient> {
	const client = await TestClient.open(server);
	clients.push(client);
	return client;
}

afterEach(async () => {
	for (const client of clients.splice(0)) client.close();
	for (const cleanup of cleanups.splice(0)) await cleanup();
});

async function until(check: () => boolean | Promise<boolean>, timeoutMs = 20_000): Promise<void> {
	const start = Date.now();
	while (Date.now() - start < timeoutMs) {
		if (await check()) return;
		await new Promise((resolve) => setTimeout(resolve, 20));
	}
	throw new Error("timed out waiting for a condition");
}

function messageText(message: { content?: unknown }): string {
	const content = message.content;
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.map((part) => {
			if (typeof part !== "object" || part === null) return "";
			const block = part as { type?: string; text?: string };
			return block.type === "text" ? (block.text ?? "") : "";
		})
		.join("");
}

function lastMessage(request: { messages: readonly { role: string; content?: unknown }[] }): {
	role: string;
	text: string;
} {
	const last = request.messages.findLast((message) => message.role !== "system");
	return { role: last?.role ?? "", text: messageText(last ?? {}) };
}

function systemText(request: { messages: readonly { role: string; content?: unknown }[] }): string {
	return request.messages
		.filter((message) => message.role === "system")
		.map((message) => messageText(message))
		.join("\n\n");
}

/** An answer that reports usage, the way a real provider does, so `usage.contextTokens` has something to measure from. */
function answerWithUsage(text: string, input = 4_000): ReturnType<typeof fauxAssistantMessage> {
	const message = fauxAssistantMessage(text);
	return { ...message, usage: { ...message.usage, input, totalTokens: input + message.usage.output } };
}

async function addProject(client: TestClient, path: string): Promise<string> {
	const response = await client.request({ type: "projects.add", path });
	if (response.type !== "projects.add") throw new Error(JSON.stringify(response));
	return response.project.id;
}

async function configureProject(
	client: TestClient,
	projectId: string,
	coordinatorModel: ModelRef,
	workerModels: ModelRef[],
): Promise<void> {
	const response = await client.request({
		type: "projects.configure",
		projectId,
		coordinatorModel,
		coordinatorThinkingLevel: "low",
		workerModels,
	});
	if (response.type !== "projects.configure") throw errorOf(response);
}

/** All entries of the coordinator's transcript, oldest first. */
async function entries(client: TestClient, projectId: string): Promise<{ id: number; kind: string; text: string }[]> {
	const response = await client.request({ type: "conversation.page", projectId, order: "ascending", limit: 500 });
	if (response.type !== "conversation.page") throw new Error(JSON.stringify(response));
	return response.entries.map((entry) => ({ id: entry.id, kind: entry.kind, text: entryText(entry) }));
}

describe("compaction policy", () => {
	it("puts the coordinator's thresholds at fractions of its model's context window", () => {
		const policy = coordinatorPolicy(128_000);
		expect(policy.reserveTokens).toBe(64_000);
		expect(policy.backgroundTokens).toBe(19_200);
		expect(policy.keepRecentTokens).toBe(12_800);
		expect(compactionThresholds(policy, 128_000)).toEqual({ backgroundAt: 44_800, blockingAt: 64_000 });

		expect(compactionThresholds(coordinatorPolicy(32_000), 32_000)).toEqual({
			backgroundAt: 11_200,
			blockingAt: 16_000,
		});
		// Recent context kept verbatim has pi-durable's 20k feel on a large window, and room to compact on a small one.
		expect(coordinatorPolicy(1_000_000).keepRecentTokens).toBe(20_000);
		expect(coordinatorPolicy(4_000).keepRecentTokens).toBe(2_000);
	});

	it("leaves every model the coordinator does not use on pi-durable's defaults", async () => {
		const small = fauxProvider({
			provider: "small",
			api: "small",
			models: [{ id: "small-1", contextWindow: 32_000 }],
		});
		const test = await setup({ configureModels: (models) => models.setProvider(small.provider) });
		const settings = coordinatorCompactionSettings(FAUX, test.models);
		expect(Object.keys(settings.modelOverrides ?? {})).toEqual(["faux/faux-1"]);

		const coordinator = resolveCompactionPolicy(settings, FAUX);
		expect(compactionThresholds(coordinator, 128_000)).toEqual({ backgroundAt: 44_800, blockingAt: 64_000 });

		// A worker spawned on another model gets pi-durable's own reserve and background distance, not the fractions.
		const worker = resolveCompactionPolicy(settings, SMALL);
		expect(worker).toEqual(DEFAULT_COMPACTION_POLICY);
		expect(compactionThresholds(worker, 128_000)).toEqual({
			backgroundAt: 128_000 - 16_384 - 32_768,
			blockingAt: 128_000 - 16_384,
		});

		// No coordinator model: no overrides at all, so nothing is compacted differently.
		expect(coordinatorCompactionSettings(null, test.models)).toEqual({});
	});

	it("keeps the user's own words, newest first, and drops what the harness wrote", () => {
		const entries = [
			{ id: 1, kind: "pi.user", model: [{ role: "user", content: "First ask." }] },
			{ id: 2, kind: "pi.assistant", model: [{ role: "assistant", content: [{ type: "text", text: "Done." }] }] },
			{ id: 3, kind: "pi.user", model: [{ role: "user", content: "[worker reader reported] all good" }] },
			{ id: 4, kind: "pi.user", model: [{ role: "user", content: "[check-in] reader is running" }] },
			{ id: 5, kind: "pi.user", model: [{ role: "user", content: [{ type: "text", text: "Second ask." }] }] },
			{ id: 6, kind: "pi.compaction", model: [{ role: "user", content: "an older summary" }], head: 1 },
		] as never;
		expect(userMessagesOf(entries)).toEqual({ messages: ["Second ask.", "First ask."], omitted: 0 });
		expect(isHarnessInput("[worker reader reported]")).toBe(true);
		expect(isHarnessInput("[check-in]")).toBe(true);
		expect(isHarnessInput("First ask.")).toBe(false);
	});

	it("keeps the newest messages within the token budget and says how many it left out", () => {
		const long = "x".repeat(SUMMARY_USER_MESSAGE_TOKENS * 4 * 4);
		const entries = [
			{ id: 1, kind: "pi.user", model: [{ role: "user", content: "Oldest." }] },
			{ id: 2, kind: "pi.user", model: [{ role: "user", content: long }] },
			{ id: 3, kind: "pi.user", model: [{ role: "user", content: "Newest." }] },
		] as never;
		const { messages, omitted } = userMessagesOf(entries);
		expect(messages[0]).toBe("Newest.");
		// The one that would overflow the budget and the older one behind it are left out.
		expect(omitted).toBe(2);
		// The one message bigger than the whole budget is cut, not dropped.
		expect(userMessagesOf(entries, 10).messages).toHaveLength(1);
	});

	it("assembles the summary in the order the coordinator reads it", () => {
		const summary = coordinatorSummary({
			narrative: "## Goal\nShip it.",
			userMessages: ["Newer ask.", "Older ask."],
			omittedUserMessages: 2,
			board: "Active tasks:\nT1 r2 [in_progress] Read the release notes",
		});
		expect(summary.indexOf("## Goal")).toBeLessThan(summary.indexOf("## The user's own messages"));
		expect(summary.indexOf("Newer ask.")).toBeLessThan(summary.indexOf("Older ask."));
		expect(summary).toContain("2 older messages are not repeated here");
		expect(summary.indexOf("## Board")).toBeGreaterThan(summary.indexOf("Older ask."));
		expect(summary).toContain("T1 r2 [in_progress] Read the release notes");
		expect(summary).toContain("`history` tool");
	});
});

describe("context usage", () => {
	it("reports the coordinator's window and thresholds, follows a model change, and keeps a worker's defaults", async () => {
		const small = fauxProvider({
			provider: "small",
			api: "small",
			models: [{ id: "small-1", contextWindow: 32_000 }],
		});
		const test = await setup({ configureModels: (models) => models.setProvider(small.provider) });
		const client = await connect(test.server);
		await client.hello();

		const BRIEF = "Write a short note about the release.";
		small.setResponses(
			Array.from({ length: 40 }, () => (request: TranscriptContext) => {
				const { role, text } = lastMessage(request);
				if (role === "toolResult") return answerWithUsage("Report reviewed.");
				if (text.includes(BRIEF)) return fauxAssistantMessage("## Report\nOutcome: done");
				if (text.includes("Delegate the note.")) {
					return fauxAssistantMessage([fauxToolCall("worker_spawn", { id: "writer", task: BRIEF })], {
						stopReason: "toolUse",
					});
				}
				return answerWithUsage("Hello back.");
			}),
		);
		test.faux.setResponses(
			Array.from({ length: 20 }, () => (request: TranscriptContext) => {
				const { text } = lastMessage(request);
				if (text.includes(BRIEF)) return answerWithUsage("## Report\nOutcome: done");
				return answerWithUsage("Noted.");
			}),
		);

		const projectId = await addProject(client, test.projectDir);
		await configureProject(client, projectId, SMALL, [FAUX]);
		await client.request({ type: "conversation.submit", projectId, requestId: "hello", content: "Hello." });

		const coordinator = await client.request({ type: "conversation.context", projectId });
		if (coordinator.type !== "conversation.context") throw errorOf(coordinator);
		expect(coordinator.context.usage).toMatchObject({
			contextWindow: 32_000,
			backgroundAt: 11_200,
			blockingAt: 16_000,
			compactions: 0,
			lastCompactionAt: null,
			compacting: false,
		});
		expect(coordinator.context.usage?.contextTokens).toBeGreaterThan(4_000);

		// A worker on the project's worker model keeps pi-durable's own thresholds.
		await client.request({ type: "conversation.submit", projectId, requestId: "delegate", content: "Delegate the note." });
		await until(async () => {
			const list = await client.request({ type: "workers.list", projectId });
			return list.type === "workers.list" && list.workers.some((worker) => worker.id === "writer");
		});
		const worker = await client.request({ type: "conversation.context", projectId, workerId: "writer" });
		if (worker.type !== "conversation.context") throw errorOf(worker);
		expect(worker.context.usage).toMatchObject({
			contextWindow: 128_000,
			backgroundAt: 128_000 - 16_384 - 32_768,
			blockingAt: 128_000 - 16_384,
		});

		// Switching the coordinator's model moves the thresholds with it.
		await configureProject(client, projectId, FAUX, [FAUX]);
		const moved = await client.request({ type: "conversation.context", projectId });
		if (moved.type !== "conversation.context") throw errorOf(moved);
		expect(moved.context.usage).toMatchObject({
			contextWindow: 128_000,
			backgroundAt: 44_800,
			blockingAt: 64_000,
		});

		// Workers drop both coordinator-only extensions, and the coordinator is offered the tool.
		const { runtime } = await test.server.manager.open(projectId);
		const removed = runtime.workers.removedExtensions.map((extension) => extension.name);
		expect(removed).toContain(COMPACTION_EXTENSION);
		expect(removed).toContain(HISTORY_EXTENSION);
		const snapshot = runtime.registry.snapshot();
		expect(snapshot.extension(COMPACTION_EXTENSION)).toBeDefined();
		expect(snapshot.extension(HISTORY_EXTENSION)).toBeDefined();
		const coordinatorAgent = await runtime.conversation.agent(BACKGROUND_CONTEXT);
		expect(coordinatorAgent.extensions.map((extension) => extension.name)).toContain(COMPACTION_EXTENSION);
		expect(coordinatorAgent.tools.map((tool) => tool.name)).toContain("history");
		const writerConversation = await runtime.workers.conversation("writer");
		if (writerConversation === undefined) throw new Error("the worker's conversation is missing");
		const workerAgent = await writerConversation.agent(BACKGROUND_CONTEXT);
		expect(workerAgent.extensions.map((extension) => extension.name)).not.toContain(COMPACTION_EXTENSION);
		expect(workerAgent.tools.map((tool) => tool.name)).not.toContain("history");
	});

	it("pushes the usage with the context when a turn changes it", async () => {
		const test = await setup();
		const client = await connect(test.server);
		await client.hello();
		test.faux.setResponses(
			Array.from({ length: 40 }, () => () => fauxAssistantMessage("An answer that is long enough to move the count.")),
		);

		const projectId = await addProject(client, test.projectDir);
		await configureProject(client, projectId, FAUX, [FAUX]);
		await client.request({ type: "conversation.watch", projectId });
		await client.request({ type: "conversation.submit", projectId, requestId: "one", content: "First." });
		await until(async () => (await entries(client, projectId)).some((entry) => entry.kind === "pi.assistant"));

		const first = await client.request({ type: "conversation.context", projectId });
		if (first.type !== "conversation.context") throw errorOf(first);
		const before = first.context.usage?.contextTokens ?? null;
		expect(before).toBeGreaterThan(0);

		await client.request({ type: "conversation.submit", projectId, requestId: "two", content: "Second." });
		await until(async () => (await entries(client, projectId)).filter((entry) => entry.kind === "pi.assistant").length >= 2);
		const second = await client.request({ type: "conversation.context", projectId });
		if (second.type !== "conversation.context") throw errorOf(second);
		const after = second.context.usage?.contextTokens ?? null;
		expect(after).not.toBe(before);

		// The watch pushes the same context the request answers with, not a stale copy.
		const pushed = await client.waitFor(
			(message) =>
				message.type === "conversation.context.changed" &&
				message.context.projectId === projectId &&
				message.context.usage?.contextTokens === after,
		);
		expect(pushed.type).toBe("conversation.context.changed");
	}, 30_000);

	it("counts prompt cache misses over the whole conversation", async () => {
		const small = fauxProvider({ provider: "small", api: "small", models: [{ id: "small-1", contextWindow: 32_000 }] });
		const test = await setup({ configureModels: (models) => models.setProvider(small.provider) });
		const client = await connect(test.server);
		await client.hello();
		// Both faux providers cache each session's prompt prefix, the way a real one does; a new provider has none of it.
		test.faux.setResponses(Array.from({ length: 10 }, () => () => fauxAssistantMessage("Noted.")));
		small.setResponses(Array.from({ length: 10 }, () => () => fauxAssistantMessage("Noted.")));

		const projectId = await addProject(client, test.projectDir);
		await configureProject(client, projectId, FAUX, [FAUX]);
		const ask = async (index: number): Promise<void> => {
			await client.request({ type: "conversation.submit", projectId, requestId: `ask-${index}`, content: `Ask ${index}.` });
			await until(
				async () => (await entries(client, projectId)).filter((entry) => entry.kind === "pi.assistant").length > index,
			);
		};
		const misses = async () => {
			const response = await client.request({ type: "conversation.context", projectId });
			if (response.type !== "conversation.context") throw errorOf(response);
			return response.context.usage?.cacheMisses;
		};
		await ask(0);
		await ask(1);
		expect(await misses()).toMatchObject({ misses: 0, unexplained: 0, lastUnexplainedAt: null });

		// Another model has nothing cached: a miss, and an explained one.
		await configureProject(client, projectId, SMALL, [FAUX]);
		await ask(2);
		const counted = await misses();
		expect(counted).toMatchObject({ misses: 1, unexplained: 0, unexplainedTokens: 0 });
		expect(counted?.missedTokens).toBeGreaterThan(1_024);
	}, 30_000);

	it("counts misses from the entries appended since the last read, and tells the unexplained ones apart", async () => {
		const reply = (at: number, cacheRead: number, cacheWrite: number) => ({
			role: "assistant",
			provider: "faux",
			model: "faux-1",
			timestamp: at,
			content: [],
			usage: { input: 10, output: 5, cacheRead, cacheWrite, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
		});
		const stored = [
			{ id: 1, kind: "pi.assistant", model: [reply(0, 0, 40_000)] },
			{ id: 2, kind: "pi.assistant", model: [reply(60_000, 0, 40_100)] },
		];
		const conversation = {
			id: 7,
			entries: async (query: { minEntryId: number }) => ({
				items: stored.filter((entry) => entry.id >= query.minEntryId),
				next: undefined,
			}),
		} as unknown as Parameters<ContextUsageReader["read"]>[0]["conversation"];
		const reader = new ContextUsageReader({ models: (await setup()).models, settings: () => undefined });
		const read = (newestEntryId: number) =>
			reader.read({ conversation, model: undefined, messages: [], live: undefined, newestEntryId });

		expect((await read(2)).cacheMisses).toMatchObject({ misses: 1, unexplained: 1, unexplainedTokens: 40_010 });
		// Twenty minutes later the cache is gone: an idle miss, read without going over the first two entries again.
		stored.push({ id: 3, kind: "pi.assistant", model: [reply(21 * 60_000, 0, 40_200)] });
		expect((await read(3)).cacheMisses).toMatchObject({ misses: 2, missedTokens: 80_120, unexplained: 1 });
	});
});

describe("coordinator summary", () => {
	it("compacts through the hook, keeping the narrative, the user's words, the workers and the way back", async () => {
		const test = await setup();
		const client = await connect(test.server);
		await client.hello();

		// The last answer is bigger than the recent context a summary keeps, so everything before it is compacted.
		const LONG = "The release notes are long. ".repeat(2_500);
		const summarised: string[] = [];
		// The summary request waits until the test lets it answer, so the running compaction is observable.
		let release: (() => void) | undefined;
		test.faux.setResponses(
			Array.from({ length: 60 }, () => (request: TranscriptContext) => {
				const { text } = lastMessage(request);
				if (text.includes("conversation to summarize")) {
					summarised.push(text);
					return new Promise((resolve) => {
						release = () => resolve(fauxAssistantMessage("## Goal\nShip the release and keep the harness honest."));
					});
				}
				if (text.includes("Say something long.")) return fauxAssistantMessage(LONG);
				if (text.includes("reported]") || text.includes("[check-in]")) return fauxAssistantMessage("Noted.");
				return fauxAssistantMessage("Understood.");
			}),
		);

		const projectId = await addProject(client, test.projectDir);
		await configureProject(client, projectId, FAUX, [FAUX]);
		await client.request({
			type: "conversation.submit",
			projectId,
			requestId: "ask-1",
			content: "First ask: keep the changelog short.",
		});
		await client.request({
			type: "conversation.submit",
			projectId,
			requestId: "report",
			content: "[worker reader reported] The notes are drafted.",
		});
		await client.request({
			type: "conversation.submit",
			projectId,
			requestId: "check-in",
			content: "[check-in] reader is still running.",
		});
		await client.request({
			type: "conversation.submit",
			projectId,
			requestId: "ask-2",
			content: "Second ask: name the release after the commit.",
		});
		await client.request({ type: "conversation.submit", projectId, requestId: "long", content: "Say something long." });

		// The coordinator's board, as the board tool would leave it.
		const { runtime } = await test.server.manager.open(projectId);
		const task = { description: "", acceptance: null, blockedBy: [], blockedReason: null, writeScopes: [] };
		await runtime.board.saveTask({ task: { ...task, title: "Read the release notes", status: "in_progress" } }, "coordinator");
		await runtime.board.saveTask({ task: { ...task, title: "Write the changelog", status: "todo" } }, "coordinator");

		await client.request({ type: "conversation.watch", projectId });
		const compacted = await client.request({
			type: "conversation.compact",
			projectId,
			instructions: "Focus on the release.",
		});
		if (compacted.type !== "conversation.compact") throw errorOf(compacted);

		// The compaction is visible while it runs: `usage.compacting` is true, and the watch pushes that with the context
		// even though no entry changed yet.
		await until(async () => {
			const context = await client.request({ type: "conversation.context", projectId });
			return context.type === "conversation.context" && context.context.usage?.compacting === true;
		});
		await client.waitFor(
			(message) => message.type === "conversation.context.changed" && message.context.usage?.compacting === true,
		);
		release?.();
		await until(async () => (await entries(client, projectId)).some((entry) => entry.kind === "pi.compaction"));
		const all = await entries(client, projectId);
		const summary = all.find((entry) => entry.kind === "pi.compaction")?.text ?? "";

		// (1) The model's narrative summary, asked with pi-durable's prompt plus what has to survive.
		expect(summary).toContain("## Goal\nShip the release and keep the harness honest.");
		expect(summarised).toHaveLength(1);
		expect(summarised[0]).toContain("a conversation to summarize");
		expect(summarised[0]).toContain("promised but not done");
		expect(summarised[0]).toContain("Additional focus: Focus on the release.");
		expect(summarised[0]).toContain("First ask: keep the changelog short.");

		// (2) The user's own messages verbatim, newest first; the harness's inputs are not the user's.
		expect(summary).toContain("First ask: keep the changelog short.");
		expect(summary).toContain("Second ask: name the release after the commit.");
		expect(summary.indexOf("Second ask")).toBeLessThan(summary.indexOf("First ask"));
		expect(summary).not.toContain("[worker reader reported]");
		expect(summary).not.toContain("[check-in]");

		// (3) The compact board view from the document.
		expect(summary).toContain("## Board");
		expect(summary).toContain("T1 r1 [in_progress] Read the release notes");
		expect(summary).toContain("To do, newest first:\nT2 Write the changelog");
		expect(summary).toContain("through the `board` tool");

		// (4) Where the rest went.
		expect(summary).toContain("`history` tool");

		// The compacted entries are out of the model's context but still in storage.
		expect((await runtime.conversation.context(BACKGROUND_CONTEXT)).entries.length).toBeLessThan(all.length);
		expect(all.filter((entry) => entry.kind === "pi.user").map((entry) => entry.text)).toContain(
			"First ask: keep the changelog short.",
		);
	});

	it("leaves the compaction to pi-durable when the summary request fails", async () => {
		const test = await setup();
		const client = await connect(test.server);
		await client.hello();

		const LONG = "Still going. ".repeat(6_000);
		let summariseCalls = 0;
		test.faux.setResponses(
			Array.from({ length: 60 }, () => (request: TranscriptContext) => {
				const { text } = lastMessage(request);
				if (text.includes("conversation to summarize")) {
					summariseCalls += 1;
					// The hook's own request fails, so it returns nothing and pi-durable asks in its own words.
					if (summariseCalls === 1) {
						return fauxAssistantMessage("", { stopReason: "error", errorMessage: "provider is down" });
					}
					return fauxAssistantMessage("## Goal\npi-durable's own summary.");
				}
				if (text.includes("Say something long.")) return fauxAssistantMessage(LONG);
				return fauxAssistantMessage("Understood.");
			}),
		);

		const projectId = await addProject(client, test.projectDir);
		await configureProject(client, projectId, FAUX, [FAUX]);
		await client.request({ type: "conversation.submit", projectId, requestId: "ask", content: "An ask." });
		await client.request({ type: "conversation.submit", projectId, requestId: "long", content: "Say something long." });

		await client.request({ type: "conversation.compact", projectId });
		await until(async () => (await entries(client, projectId)).some((entry) => entry.kind === "pi.compaction"));
		const all = await entries(client, projectId);
		const summary = all.find((entry) => entry.kind === "pi.compaction")?.text ?? "";
		expect(summariseCalls).toBe(2);
		expect(summary).toContain("pi-durable's own summary.");
		// Nothing of the harness's summary: no user messages section, no board, no history note.
		expect(summary).not.toContain("## The user's own messages");
		expect(summary).not.toContain("`history` tool");
	});

	it("refuses a compaction in a project without a coordinator model", async () => {
		const test = await setup();
		const client = await connect(test.server);
		await client.hello();
		const projectId = await addProject(client, test.projectDir);
		const response = await client.request({ type: "conversation.compact", projectId });
		expect(errorOf(response).code).toBe("no_coordinator_model");
	});
});

describe("history tool", () => {
	it("searches and reads the entries a compaction replaced", async () => {
		const test = await setup();
		const client = await connect(test.server);
		await client.hello();

		const LONG = "Filler in the kept part. ".repeat(3_000);
		const toolResults: string[] = [];
		const systemPrompts: string[] = [];
		let range: { from: number; to: number } | undefined;
		test.faux.setResponses(
			Array.from({ length: 80 }, () => (request: TranscriptContext) => {
				const { role, text } = lastMessage(request);
				if (text.includes("conversation to summarize")) return fauxAssistantMessage("## Goal\nKeep the secret.");
				// The memory extraction after the compaction is its own conversation, with its own prompt.
				if (text.includes("was just compacted") || systemText(request).includes("was just compacted")) return fauxAssistantMessage("Nothing worth keeping.");
				systemPrompts.push(systemText(request));
				if (role === "toolResult") {
					toolResults.push(text);
					if (range === undefined) {
						// The range read comes second, over the entries the first search found.
						const ids = [...text.matchAll(/#(\d+) /g)].map((match) => Number(match[1]));
						range = { from: Math.min(...ids), to: Math.max(...ids) };
						return fauxAssistantMessage([fauxToolCall("history", { from: range.from, to: range.to })], {
							stopReason: "toolUse",
						});
					}
					return fauxAssistantMessage("Found it.");
				}
				if (text.includes("Search the transcript for the secret word.")) {
					return fauxAssistantMessage([fauxToolCall("history", { query: "xylophone" })], { stopReason: "toolUse" });
				}
				if (text.includes("Say something long.")) return fauxAssistantMessage(LONG);
				return fauxAssistantMessage("Noted.");
			}),
		);

		const projectId = await addProject(client, test.projectDir);
		await configureProject(client, projectId, FAUX, [FAUX]);
		await client.request({
			type: "conversation.submit",
			projectId,
			requestId: "secret",
			content: "Remember the secret word: xylophone.",
		});
		await client.request({ type: "conversation.submit", projectId, requestId: "long", content: "Say something long." });

		const before = await entries(client, projectId);
		const secret = before.find((entry) => entry.text.includes("xylophone"));
		if (secret === undefined) throw new Error("the secret entry is missing");

		await client.request({ type: "conversation.compact", projectId });
		await until(async () => (await entries(client, projectId)).some((entry) => entry.kind === "pi.compaction"));
		// The entry the search has to find is no longer in the model's context.
		const { runtime } = await test.server.manager.open(projectId);
		const active = await runtime.conversation.context(BACKGROUND_CONTEXT);
		expect(active.entries.some((entry) => entry.id === secret.id)).toBe(false);

		await client.request({
			type: "conversation.submit",
			projectId,
			requestId: "search",
			content: "Search the transcript for the secret word.",
		});
		await until(() => toolResults.length >= 2);

		expect(toolResults[0]).toContain(`#${secret.id} user`);
		expect(toolResults[0]).toContain("xylophone");
		expect(toolResults[1]).toContain("Remember the secret word: xylophone.");
		expect(toolResults[1]).toContain(`pi.user`);

		// The two history calls left ordinary tool results, and the prompt stayed byte-identical across them: the tool
		// adds no section, so a search cannot cost a prompt-cache miss.
		expect(toolResults[0]).toContain("Matches for");
		expect(systemPrompts.at(-1)).toBe(systemPrompts.at(-2) ?? "");
	});

	it("answers a worker that somehow gets the tool with a refusal", async () => {
		const test = await setup();
		const client = await connect(test.server);
		await client.hello();

		const BRIEF = "Look something up.";
		test.faux.setResponses(
			Array.from({ length: 40 }, () => (request: TranscriptContext) => {
				const { role, text } = lastMessage(request);
				if (role === "toolResult") return fauxAssistantMessage("Done.");
				if (text.includes("Nested history")) {
					return fauxAssistantMessage([fauxToolCall("history", { query: "anything" })], { stopReason: "toolUse" });
				}
				if (text.includes(BRIEF)) return fauxAssistantMessage("## Report\nOutcome: done");
				if (text.includes("reported]")) return fauxAssistantMessage("Report reviewed.");
				if (text.includes("Delegate the lookup.")) {
					return fauxAssistantMessage([fauxToolCall("worker_spawn", { id: "looker", task: BRIEF })], {
						stopReason: "toolUse",
					});
				}
				return fauxAssistantMessage("Nothing to do.");
			}),
		);

		const projectId = await addProject(client, test.projectDir);
		await configureProject(client, projectId, FAUX, [FAUX]);
		await client.request({
			type: "conversation.submit",
			projectId,
			requestId: "delegate",
			content: "Delegate the lookup.",
		});
		await until(async () => {
			const list = await client.request({ type: "workers.list", projectId });
			return list.type === "workers.list" && list.workers.some((worker) => worker.id === "looker");
		});

		// Deliberately hand the worker the history extension: the tool refuses instead of searching the coordinator's past.
		const { runtime } = await test.server.manager.open(projectId);
		const workerConversation = await runtime.workers.conversation("looker");
		if (workerConversation === undefined) throw new Error("the worker's conversation is missing");
		await workerConversation.configure({ extensions: { add: [runtime.history.extension] } }, BACKGROUND_CONTEXT);
		await workerConversation.submit({ type: "input", content: "Nested history", requestId: "nested" }, BACKGROUND_CONTEXT);

		await until(async () => {
			const page = await client.request({
				type: "conversation.page",
				projectId,
				workerId: "looker",
				order: "ascending",
				limit: 300,
			});
			if (page.type !== "conversation.page") return false;
			return page.entries.some((entry) =>
				(entry.model ?? []).some((message) => messageText(message as { content?: unknown }).includes("belongs to the project's coordinator")),
			);
		});
	});
});
