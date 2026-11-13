/**
 * The request log: a row per model request with what woke the agent and what changed in its prompt, read back from the
 * transcripts for requests made before the log, summed by `cache.stats`; and the pure parts (wakes, fingerprints, the
 * one-hour cache what-if).
 */
import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Models, TranscriptContext } from "@earendil-works/pi-ai";
import { fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
import { CHECK_IN_PREFIX, type ModelRef } from "@kemiri/protocol";
import { cacheStats, longCacheWhatIf, wakeGroups } from "../src/cache-stats.ts";
import { createHarnessModels } from "../src/models.ts";
import { diffFingerprints, fingerprintRequest } from "../src/prompt-fingerprint.ts";
import { RequestLog, requestTail, wakeOf } from "../src/request-log.ts";
import { REQUEST_LOG_FILE, RequestLogStore, type RequestRow } from "../src/request-log-store.ts";
import { createSetup, errorOf, TestClient, type TestSetup } from "./support.ts";

const cleanups: (() => Promise<void>)[] = [];
const clients: TestClient[] = [];
const FAUX: ModelRef = { provider: "faux", modelId: "faux-1" };
const SMALL: ModelRef = { provider: "small", modelId: "small-1" };

async function setup(options?: Parameters<typeof createSetup>[0]): Promise<TestSetup> {
	const created = await createSetup(options);
	cleanups.push(created.cleanup);
	return created;
}

async function connect(test: TestSetup): Promise<TestClient> {
	const client = await TestClient.open(test.server);
	clients.push(client);
	await client.hello();
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

async function addProject(client: TestClient, path: string, model: ModelRef = FAUX): Promise<string> {
	const added = await client.request({ type: "projects.add", path });
	if (added.type !== "projects.add") throw errorOf(added);
	await configure(client, added.project.id, model);
	return added.project.id;
}

async function configure(client: TestClient, projectId: string, model: ModelRef): Promise<void> {
	const response = await client.request({
		type: "projects.configure",
		projectId,
		coordinatorModel: model,
		coordinatorThinkingLevel: "low",
		workerModels: [FAUX],
	});
	if (response.type !== "projects.configure") throw errorOf(response);
}

async function answers(client: TestClient, projectId: string): Promise<number> {
	const response = await client.request({ type: "conversation.page", projectId, order: "ascending", limit: 500 });
	if (response.type !== "conversation.page") throw errorOf(response);
	return response.entries.filter((entry) => entry.kind === "pi.assistant").length;
}

async function ask(client: TestClient, projectId: string, content: string): Promise<void> {
	const before = await answers(client, projectId);
	await client.request({ type: "conversation.submit", projectId, requestId: `ask-${crypto.randomUUID()}`, content });
	await until(async () => (await answers(client, projectId)) > before);
}

async function logged(test: TestSetup, count: number): Promise<RequestRow[]> {
	const log = test.server.requestLog;
	if (log === undefined) throw new Error("no request log");
	await until(async () => {
		await log.flush();
		return log.store.rows({ from: 0, to: Date.now() + 1 }).length >= count;
	});
	return log.store.rows({ from: 0, to: Date.now() + 1 });
}

function lastText(request: TranscriptContext): string {
	const last = request.messages.findLast((message) => message.role !== "system");
	const content = last?.content;
	if (typeof content === "string") return content;
	return Array.isArray(content) ? content.map((block) => ("text" in block ? block.text : "")).join("") : "";
}

describe("request log", () => {
	it("logs each turn's request with what woke it and what changed in its prompt", async () => {
		// A window large enough that the switch below does not compact first, which would start the context over.
		const small = fauxProvider({ provider: "small", api: "small", models: [{ id: "small-1", contextWindow: 400_000 }] });
		const test = await setup({ configureModels: (models) => models.setProvider(small.provider) });
		const client = await connect(test);
		test.faux.setResponses(Array.from({ length: 10 }, () => () => fauxAssistantMessage("Noted.")));
		small.setResponses(Array.from({ length: 10 }, () => () => fauxAssistantMessage("Noted.")));
		const projectId = await addProject(client, test.projectDir);

		await ask(client, projectId, "First.");
		await ask(client, projectId, "Second.");
		let rows = await logged(test, 2);
		// Coordinators ask for the one-hour cache by default (`longPromptCache: "coordinators"`).
		expect(rows.map((row) => [row.kind, row.threadId, row.wake, row.source, row.retention])).toEqual([
			["main", "main", "user", "live", "long"],
			["main", "main", "user", "live", "long"],
		]);
		// The first request has nothing to compare with; the second only added messages after the first's.
		expect(rows[0]?.changes).toBeNull();
		expect(rows[1]?.changes).toEqual([]);
		expect(rows[1]?.idleMs).toBeGreaterThanOrEqual(0);
		expect(rows[1]?.cacheRead).toBeGreaterThan(0);

		// An AGENTS.md written now reaches the next request as an instruction update.
		await writeFile(join(test.projectDir, "AGENTS.md"), "# Rules\n\nAnswer briefly.\n");
		await ask(client, projectId, "Third.");
		rows = await logged(test, 3);
		expect(rows[2]?.changes?.some((change) => change.startsWith("update:"))).toBe(true);

		// Another model has nothing cached: a miss, put down to the switch.
		await configure(client, projectId, SMALL);
		await ask(client, projectId, "Fourth.");
		rows = await logged(test, 4);
		expect(rows[3]).toMatchObject({ provider: "small", model: "small-1", missReason: "model_switch" });
		expect(rows[3]?.missTokens).toBeGreaterThan(1024);

		const stats = await client.request({ type: "cache.stats", id: "stats", days: 1 } as never);
		if (stats.type !== "cache.stats") throw errorOf(stats);
		expect(stats.stats.totals.requests).toBe(4);
		expect(stats.stats.totals.misses).toBe(1);
		expect(stats.stats.byReason.map((group) => group.key)).toEqual(["model_switch"]);
		expect(stats.stats.byKind.map((group) => group.key)).toEqual(["main"]);
		expect(stats.stats.byWake).toMatchObject([{ wake: "user", wakes: 4 }]);
		expect(stats.stats.misses).toHaveLength(1);
		expect(stats.stats.misses[0]).toMatchObject({ reason: "model_switch", wake: "user", source: "live" });
	}, 30_000);

	it("names a worker's requests and the turn going on after a tool call", async () => {
		const test = await setup();
		const client = await connect(test);
		const BRIEF = "Write a short note about the release.";
		test.faux.setResponses(
			Array.from({ length: 20 }, () => (request: TranscriptContext) => {
				const text = lastText(request);
				if (text.includes(BRIEF)) return fauxAssistantMessage("## Report\nOutcome: done");
				if (text.includes("Delegate the note.")) {
					return fauxAssistantMessage([fauxToolCall("worker_spawn", { id: "writer", task: BRIEF })], { stopReason: "toolUse" });
				}
				return fauxAssistantMessage("Noted.");
			}),
		);
		const projectId = await addProject(client, test.projectDir);
		await ask(client, projectId, "Delegate the note.");
		await until(async () => {
			const rows = await logged(test, 1);
			return rows.some((row) => row.kind === "worker") && rows.filter((row) => row.kind === "main").length >= 2;
		});
		const rows = await logged(test, 3);
		expect(rows.find((row) => row.kind === "worker")).toMatchObject({ workerId: "writer", threadId: "main", wake: "brief" });
		expect(rows.filter((row) => row.kind === "main").map((row) => row.wake).slice(0, 2)).toEqual(["user", "continue"]);
		// By default only coordinators ask for the one-hour cache.
		expect(rows.find((row) => row.kind === "worker")?.retention).toBe("short");
		expect(rows.filter((row) => row.kind === "main").every((row) => row.retention === "long")).toBe(true);
	}, 30_000);

	it("asks for the one-hour cache as the project's setting says, from the next request on", async () => {
		const test = await setup();
		const client = await connect(test);
		const BRIEF = "Write a short note about the release.";
		test.faux.setResponses(
			Array.from({ length: 20 }, () => (request: TranscriptContext) => {
				const text = lastText(request);
				if (text.includes(BRIEF)) return fauxAssistantMessage("## Report\nOutcome: done");
				if (text.includes("Delegate the note.")) {
					return fauxAssistantMessage([fauxToolCall("worker_spawn", { id: "writer", task: BRIEF })], { stopReason: "toolUse" });
				}
				return fauxAssistantMessage("Noted.");
			}),
		);
		const projectId = await addProject(client, test.projectDir);
		const set = async (longPromptCache: "off" | "coordinators" | "all" | null) => {
			const response = await client.request({ type: "projects.configure", projectId, longPromptCache });
			if (response.type !== "projects.configure") throw errorOf(response);
			return response.project.longPromptCache;
		};
		expect(await set("all")).toBe("all");
		await ask(client, projectId, "Delegate the note.");
		await until(async () => (await logged(test, 1)).some((row) => row.kind === "worker"));
		let rows = await logged(test, 2);
		expect(rows.find((row) => row.kind === "worker")?.retention).toBe("long");

		expect(await set("off")).toBe("off");
		const before = rows.filter((row) => row.kind === "main").length;
		await ask(client, projectId, "Anything else?");
		await until(async () => (await logged(test, 1)).filter((row) => row.kind === "main").length > before);
		rows = await logged(test, 1);
		expect(rows.filter((row) => row.kind === "main").at(-1)?.retention).toBe("short");
		expect(await set(null)).toBe("coordinators");
	}, 30_000);

	it("reads the requests made before the log back from the transcripts, and the live log goes on from them", async () => {
		const test = await setup();
		const client = await connect(test);
		test.faux.setResponses(Array.from({ length: 10 }, () => () => fauxAssistantMessage("Noted.")));
		const projectId = await addProject(client, test.projectDir);
		await ask(client, projectId, "First.");
		await ask(client, projectId, "Second.");
		const live = await logged(test, 2);
		client.close();

		// As if the log had never been there: the next start reads both requests back.
		await test.server.stop();
		await rm(join(test.dataDir, REQUEST_LOG_FILE), { force: true });
		await test.restart();
		await test.server.requestLogBackfill;
		const back = await logged(test, 2);
		const comparable = (row: RequestRow): RequestRow => ({ ...row, changes: null, retention: null, source: "backfill" });
		expect(back).toEqual(live.map(comparable));

		// Read once: another restart reads nothing again, and a new request follows on from the last row.
		await test.restart();
		await test.server.requestLogBackfill;
		const again = await connect(test);
		await ask(again, projectId, "Third.");
		const rows = await logged(test, 3);
		expect(rows).toHaveLength(3);
		expect(rows[2]).toMatchObject({ source: "live", wake: "user" });
		expect(rows[2]?.idleMs).toBeGreaterThanOrEqual(0);
	}, 30_000);

	it("keeps answering when the log cannot write", async () => {
		const logs: string[] = [];
		const test = await setup({ log: (message) => logs.push(message) });
		const client = await connect(test);
		test.faux.setResponses(Array.from({ length: 10 }, () => () => fauxAssistantMessage("Noted.")));
		const projectId = await addProject(client, test.projectDir);
		test.server.requestLog?.store.close();
		await ask(client, projectId, "Still there?");
		await test.server.requestLog?.flush();
		expect(logs.some((line) => line.startsWith("request log: could not record a request"))).toBe(true);
	}, 30_000);
});

describe("observing requests", () => {
	it("sees the provider payload of a tagged request, keeps the caller's own hook, and leaves other requests alone", async () => {
		const dir = await mkdtemp(join(tmpdir(), "request-log-"));
		cleanups.push(() => rm(dir, { recursive: true, force: true }));
		const log = new RequestLog({ store: RequestLogStore.open(join(dir, REQUEST_LOG_FILE)), log: () => undefined });
		const extension = log.extension("p", async () => ({ kind: "main", threadId: "main", workerId: null, taskId: null, scheduleId: null }));
		const beforeRequest = (extension.hooks?.[0] as { handlers: { beforeRequest: (request: unknown, api: unknown) => unknown } })
			.handlers.beforeRequest;
		const answer = (at: number) => ({
			role: "assistant",
			provider: "anthropic",
			model: "m",
			timestamp: at,
			stopReason: "stop",
			content: [],
			usage: { input: 10, output: 1, cacheRead: 0, cacheWrite: 50_000, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
		});
		const sent: unknown[] = [];
		let calls = 0;
		const models = {
			streamSimple: (_model: unknown, _context: unknown, options?: { onPayload?: (payload: unknown, model: unknown) => unknown }) => {
				calls += 1;
				const payload = { system: [{ type: "text", text: calls === 1 ? "one" : "two" }], messages: [] };
				const result = Promise.resolve(options?.onPayload?.(payload, {})).then(() => answer(calls * 1000));
				return { result: () => result };
			},
		} as unknown as Models;
		const observed = log.observeModels(models);
		const request = async (tagged: boolean) => {
			const messages = [{ role: "user", content: "Hi", timestamp: 1 }];
			if (tagged) beforeRequest({ messages }, { conversationId: 1 });
			const stream = (observed.streamSimple as unknown as (...args: unknown[]) => { result(): Promise<unknown> })({}, { messages }, {
				onPayload: (payload: unknown) => {
					sent.push(payload);
					return undefined;
				},
			});
			await stream.result();
		};
		await request(true);
		await request(false);
		await request(true);
		await log.flush();
		expect(sent).toHaveLength(3);
		const rows = log.store.rows({ from: 0, to: 10_000 });
		expect(rows.map((row) => row.at)).toEqual([1000, 3000]);
		expect(rows[1]?.changes).toEqual(["wire:system[0]"]);
		await log.close();
	});
});

describe("wakes", () => {
	const main = { kind: "main", scheduleId: null } as const;
	const worker = { kind: "worker", scheduleId: null } as const;
	const tail = (userTexts: string[], extra: Partial<Parameters<typeof wakeOf>[0]> = {}) => ({
		toolResults: 0,
		userTexts,
		firstTurn: false,
		repeated: false,
		...extra,
	});

	it("tells what woke the agent from the input's prefix and the conversation", () => {
		expect(wakeOf(tail(["Hello"]), main)).toBe("user");
		expect(wakeOf(tail([`${CHECK_IN_PREFIX}\n1 worker`]), main)).toBe("check_in");
		expect(wakeOf(tail(["[worker writer reported]\ndone"]), main)).toBe("worker_report");
		expect(wakeOf(tail(['[thread t1 finished] "x"']), main)).toBe("thread_finished");
		expect(wakeOf(tail(["[from main] hi"]), { kind: "thread", scheduleId: null })).toBe("thread_message");
		expect(wakeOf(tail(["[board] The user changed the board:"]), main)).toBe("board");
		expect(wakeOf(tail(["Do it"], { firstTurn: true }), worker)).toBe("brief");
		expect(wakeOf(tail(["Do it"], { firstTurn: true }), { kind: "worker", scheduleId: "nightly" })).toBe("schedule");
		expect(wakeOf(tail(["Also this"]), worker)).toBe("coordinator");
		expect(wakeOf(tail(["Hi"], { toolResults: 2 }), main)).toBe("continue");
		expect(wakeOf(tail([]), main)).toBe("retry");
		expect(wakeOf(tail(["Hello"], { repeated: true }), main)).toBe("retry");
	});

	it("reads what came in after the last answer", () => {
		const messages = [
			{ role: "system", content: "", sections: { context: "x" } },
			{ role: "user", content: "Hello" },
			{ role: "assistant", content: [] },
			{ role: "system", content: "", sections: { skills: "y" } },
			{ role: "user", content: [{ type: "text", text: "[check-in]\nall fine" }] },
		];
		expect(requestTail(messages)).toMatchObject({
			toolResults: 0,
			userTexts: ["[check-in]\nall fine"],
			firstTurn: false,
			updates: ["skills"],
			systemUpdates: 1,
		});
		expect(requestTail(messages.slice(0, 2))).toMatchObject({ firstTurn: true, systemUpdates: 0, userTexts: ["Hello"] });
	});
});

describe("prompt fingerprints", () => {
	const system = (sections: Record<string, string>, tools: string[]) => ({
		role: "system",
		content: "",
		sections,
		toolsAdded: tools.map((name) => ({ name, description: `${name} tool`, parameters: {} })),
		timestamp: 1,
	});
	const user = (text: string, timestamp = 2) => ({ role: "user", content: text, timestamp });

	it("names the section, tool and message that changed, and ignores what only moves", () => {
		const before = fingerprintRequest([system({ context: "a", skills: "b" }, ["read", "bash"]), user("Hi"), user("Next")]);
		// Timestamps are not sent, so a new one changes nothing.
		const same = fingerprintRequest([system({ context: "a", skills: "b" }, ["read", "bash"]), user("Hi", 99), user("Next"), user("More")]);
		expect(diffFingerprints(before, same)).toEqual([]);

		const changed = fingerprintRequest([system({ context: "A", memory: "m" }, ["bash", "write"]), user("Hi"), user("Edited")]);
		expect(diffFingerprints(before, changed, ["skills"])).toEqual([
			"section:context",
			"section+:memory",
			"section-:skills",
			"tool+:write",
			"tool-:read",
			"history:2/2",
			"update:skills",
		]);
		const reordered = fingerprintRequest([system({ context: "a", skills: "b" }, ["bash", "read"]), user("Hi"), user("Next")]);
		expect(diffFingerprints(before, reordered)).toEqual(["tools-order"]);
		const summarized = fingerprintRequest([system({ context: "a", skills: "b" }, ["read", "bash"]), user("The summary")]);
		expect(diffFingerprints(before, summarized)).toEqual(["restart"]);
	});

	it("compares the provider payload part by part without the moving cache markers", () => {
		const payload = (messages: unknown[], system = "S") => ({
			model: "m",
			system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
			messages,
		});
		const one = { role: "user", content: [{ type: "text", text: "a", cache_control: { type: "ephemeral" } }] };
		const oneClean = { role: "user", content: [{ type: "text", text: "a" }] };
		const two = { role: "user", content: "b" };
		const before = fingerprintRequest([user("a")], payload([one]));
		expect(diffFingerprints(before, fingerprintRequest([user("a"), user("b")], payload([oneClean, two])))).toEqual([]);
		expect(diffFingerprints(before, fingerprintRequest([user("a"), user("b")], payload([oneClean, two], "T")))).toEqual([
			"wire:system[0]",
		]);
	});
});

describe("cache stats", () => {
	const row = (overrides: Partial<RequestRow>): RequestRow => ({
		at: 0,
		projectId: "p",
		conversationId: 1,
		kind: "main",
		threadId: "main",
		workerId: null,
		taskId: null,
		scheduleId: null,
		provider: "anthropic",
		model: "claude-opus-4-5",
		stopReason: "stop",
		input: 10,
		cacheRead: 0,
		cacheWrite: 0,
		cacheWrite1h: 0,
		output: 100,
		cost: 0.01,
		costInput: 0,
		costCacheRead: 0,
		costCacheWrite: 0,
		costOutput: 0,
		promptTokens: 0,
		idleMs: null,
		missTokens: 0,
		missCost: 0,
		missReason: null,
		wake: "user",
		retention: "short",
		changes: [],
		source: "live",
		durationMs: null,
		...overrides,
	});

	it("prices a one-hour cache with pi-ai's rates: idle misses within the hour saved, every write dearer", () => {
		const models = createHarnessModels({ credentials: { read: async () => undefined } as never });
		const rows = [
			row({ at: 0, cacheWrite: 100_000 }),
			// Ten minutes idle: 100k re-billed; a one-hour cache reads them instead and writes only the new 1k.
			row({ at: 600_000, cacheWrite: 101_000, idleMs: 600_000, missTokens: 100_000, missCost: 0.575, missReason: "idle" }),
			// Two hours idle: missed either way.
			row({ at: 7_800_000, cacheWrite: 102_000, idleMs: 7_200_000, missTokens: 101_000, missCost: 0.58, missReason: "idle" }),
			// Not a model with the longer cache.
			row({ provider: "openai-codex", model: "gpt-6.1-sol", cacheWrite: 0, cacheRead: 50_000 }),
		];
		const whatIf = longCacheWhatIf(rows, models);
		expect(whatIf).toMatchObject({ requests: 3, missesAvoided: 1, stillMissed: 1 });
		expect(whatIf.saved).toBeCloseTo(0.575, 6);
		// claude-opus-4-5 writes at $6.25/M for five minutes and twice the $5/M input for an hour: $3.75/M more.
		expect(whatIf.extraWriteCost).toBeCloseTo((3.75 * (100_000 + 1_000 + 102_000)) / 1_000_000, 6);
		expect(whatIf.net).toBeCloseTo(whatIf.saved - whatIf.extraWriteCost, 9);
	});

	it("leaves requests that had the one-hour cache out of its what-if, and only counts them", () => {
		const models = createHarnessModels({ credentials: { read: async () => undefined } as never });
		const rows = [
			// Asked for it (live), or wrote to it (read back, no retention): already on.
			row({ at: 0, cacheWrite: 100_000, cacheWrite1h: 100_000, retention: "long" }),
			row({ at: 1_200_000, cacheWrite: 101_000, cacheWrite1h: 101_000, retention: null, idleMs: 1_200_000, missTokens: 100_000, missCost: 0.5, missReason: "unexplained" }),
			// A worker still on five minutes, idle for ten.
			row({ conversationId: 2, kind: "worker", at: 0, cacheWrite: 50_000 }),
			row({ conversationId: 2, kind: "worker", at: 600_000, cacheWrite: 50_500, idleMs: 600_000, missTokens: 50_000, missCost: 0.3, missReason: "idle" }),
			// Codex asked for it too, but has no such cache: neither counted nor priced.
			row({ provider: "openai-codex", model: "gpt-6.1-sol", retention: "long", cacheRead: 50_000 }),
		];
		const whatIf = longCacheWhatIf(rows, models);
		expect(whatIf).toMatchObject({ alreadyLong: 2, requests: 2, missesAvoided: 1 });
		expect(whatIf.saved).toBeCloseTo(0.3, 6);
	});

	it("puts every request of a turn on the wake that started it", () => {
		const rows = [
			row({ at: 1, wake: "check_in", cost: 1, missTokens: 5000, missCost: 0.8, missReason: "idle" }),
			row({ at: 2, wake: "continue", cost: 0.5 }),
			row({ at: 3, wake: "user", cost: 0.25 }),
			row({ at: 4, wake: "continue", cost: 0.25 }),
			row({ at: 5, wake: "check_in", cost: 1 }),
		];
		expect(wakeGroups(rows)).toEqual([
			{ wake: "check_in", wakes: 2, turnCost: 2.5, misses: 1, missedCost: 0.8 },
			{ wake: "user", wakes: 1, turnCost: 0.5, misses: 0, missedCost: 0 },
		]);
		const stats = cacheStats({ rows, from: 0, to: 10, liveSince: null, projectNames: new Map([["p", "Project"]]) });
		expect(stats.totals).toMatchObject({ requests: 5, misses: 1, missedTokens: 5000 });
		expect(stats.byProject).toMatchObject([{ key: "p", label: "Project", requests: 5 }]);
		expect(stats.conversations).toHaveLength(1);
		expect(stats.days).toHaveLength(1);
	});
});
