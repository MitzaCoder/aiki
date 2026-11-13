import { afterEach, describe, expect, it } from "bun:test";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { TranscriptContext } from "@earendil-works/pi-ai";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
import type { JsonObject, SetTimer } from "@earendil-works/pi-durable";
import { DEFAULT_CHECK_INS, DEFAULT_LONG_PROMPT_CACHE, DEFAULT_UI_PROOF } from "@kemiri/protocol";
import type {
	BoardTask,
	ConversationContext,
	ConversationView,
	ModelRef,
	ThreadSummary,
	WorkersListResponse,
} from "@kemiri/protocol";
import { stat } from "node:fs/promises";
import { join } from "node:path";
import { type BoardState, changeOwner, emptyBoardState, saveTask } from "../src/board.ts";
import { THREAD_ARCHIVE_AFTER_MS, THREAD_MESSAGES_PER_HOUR, MAIN_THREADS_SECTION, threadInstructions } from "../src/threads.ts";
import { createSetup, entryText, errorOf, TestClient, ViewClient, type TestSetup } from "./support.ts";

it("asks jj background threads to use the namespaced task trailer", () => {
	const instructions = threadInstructions({
		id: "fixture", title: "Fixture", checkout: "/tmp/aiki-fixture-workspace", checkoutKind: "jj", startedBy: "main",
		project: {
			version: 1, id: "fixture", name: "Fixture", path: "/tmp/aiki-fixture-project", createdAt: "2026-01-01T00:00:00Z",
			coordinator: { model: null, thinkingLevel: null }, workerModels: [], checkIns: { ...DEFAULT_CHECK_INS },
			longPromptCache: DEFAULT_LONG_PROMPT_CACHE, keepPromptCacheWarm: true, promptCacheWarmHours: 8,
			uiProof: DEFAULT_UI_PROOF, links: null,
		},
	});
	expect(instructions).toContain("Add an `Kemiri-Task: T…` trailer to commit descriptions.");
});

const cleanups: (() => Promise<void>)[] = [];
const clients: TestClient[] = [];

const FAUX: ModelRef = { provider: "faux", modelId: "faux-1" };
const THREAD_BRIEF = "Triage every open ticket of the Jira project.";
const WORKER_BRIEF = "Read the README and report.";
const SUMMARY = "All tickets triaged: 3 closed, 2 need the user.";

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

function threadTest(name: string, run: () => Promise<void>): void {
	it(name, run, 90_000);
}

// --- a model that answers as main, as a background thread and as a worker ------------------------------------------

function textOf(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.map((part) => {
			const block = part as { type?: string; text?: string };
			return block.type === "text" ? (block.text ?? "") : "";
		})
		.join("");
}

function systemOf(request: TranscriptContext): string {
	return request.messages
		.filter((message) => message.role === "system")
		.map((message) => {
			const sections = (message as { sections?: Record<string, string> }).sections;
			return sections === undefined ? textOf((message as { content?: unknown }).content) : Object.values(sections).join("\n");
		})
		.join("\n");
}

type Turn = {
	who: "main" | "thread" | "worker";
	/** The background thread's ID, for a thread's turn. */
	threadId: string | undefined;
	role: string;
	text: string;
	/** The tool whose result is the last message, when it is one. */
	toolName: string | undefined;
	request: TranscriptContext;
	signal: AbortSignal | undefined;
};

type Reply = ReturnType<typeof fauxAssistantMessage>;
type Route = (turn: Turn) => Reply | undefined | Promise<Reply | undefined>;

function turnOf(request: TranscriptContext, signal: AbortSignal | undefined): Turn {
	const system = systemOf(request);
	const thread = /You are the background thread "([^"]+)"/.exec(system);
	const who = thread !== null ? "thread" : system.includes("You are the worker \"") ? "worker" : "main";
	const last = request.messages.findLast((message) => message.role !== "system") as
		| { role: string; content?: unknown; toolName?: string }
		| undefined;
	return {
		who,
		threadId: thread?.[1],
		role: last?.role ?? "",
		text: textOf(last?.content),
		toolName: last?.role === "toolResult" ? last.toolName : undefined,
		request,
		signal,
	};
}

function call(name: string, args: JsonObject): Reply {
	return fauxAssistantMessage([fauxToolCall(name, args)], { stopReason: "toolUse" });
}

/**
 * The default script: main adds a task and starts a thread for it on "Start the thread.", the thread finishes at once,
 * main reviews.
 */
function defaults(turn: Turn, start: JsonObject = {}): Reply {
	if (turn.who === "main") {
		const added = turn.toolName === "board" ? /^Added (T\d+) /.exec(turn.text) : null;
		if (added !== null) return call("thread_start", { title: "Jira run", brief: THREAD_BRIEF, taskId: added[1] as string, ...start });
		if (turn.role === "toolResult") return fauxAssistantMessage("Noted.");
		if (turn.text === "Start the thread.") return call("board", { action: "add_task", title: "Jira run" });
		if (turn.text.startsWith("[thread ")) return fauxAssistantMessage("Reviewed the thread.");
		if (turn.text.startsWith("[from ")) return fauxAssistantMessage("Read the message.");
		return fauxAssistantMessage("Nothing to do.");
	}
	if (turn.who === "thread") {
		if (turn.role === "toolResult") return fauxAssistantMessage("Done.");
		if (turn.text === THREAD_BRIEF) return call("thread_finish", { summary: SUMMARY });
		return fauxAssistantMessage("Thread: nothing to do.");
	}
	if (turn.role === "toolResult") return fauxAssistantMessage("Worker: tool done.");
	return fauxAssistantMessage("## Report\nOutcome: done");
}

function script(test: TestSetup, route: Route = () => undefined, start: JsonObject = {}): void {
	const factory = async (request: TranscriptContext, options: { signal?: AbortSignal } | undefined) => {
		const turn = turnOf(request, options?.signal);
		return (await route(turn)) ?? defaults(turn, start);
	};
	test.faux.setResponses(Array.from({ length: 300 }, () => factory));
}

// --- protocol helpers ------------------------------------------------------------------------------------------------

async function openProject(test: TestSetup): Promise<{ client: TestClient; projectId: string; view: ViewClient }> {
	const client = await connect(test.server);
	expect((await client.hello()).type).toBe("hello");
	const added = await client.request({ type: "projects.add", path: test.projectDir });
	if (added.type !== "projects.add") throw new Error(JSON.stringify(added));
	const projectId = added.project.id;
	const configured = await client.request({
		type: "projects.configure",
		projectId,
		coordinatorModel: FAUX,
		coordinatorThinkingLevel: "low",
		workerModels: [FAUX],
	});
	expect(configured.type).toBe("projects.configure");
	const view = new ViewClient(client);
	await view.start(projectId);
	return { client, projectId, view };
}

async function submit(client: TestClient, projectId: string, content: string, threadId?: string): Promise<void> {
	const response = await client.request({
		type: "conversation.submit",
		projectId,
		requestId: `r-${Math.random().toString(36).slice(2)}`,
		content,
		...(threadId === undefined ? {} : { threadId }),
	});
	if (response.type !== "conversation.submit") throw new Error(JSON.stringify(response));
}

async function threads(client: TestClient, projectId: string, includeArchived = false): Promise<ThreadSummary[]> {
	const response = await client.request({ type: "threads.list", projectId, includeArchived });
	if (response.type !== "threads.list") throw new Error(JSON.stringify(response));
	return response.threads;
}

async function thread(client: TestClient, projectId: string, id: string): Promise<ThreadSummary | undefined> {
	return (await threads(client, projectId, true)).find((candidate) => candidate.id === id);
}

async function context(client: TestClient, projectId: string, options: { threadId?: string; workerId?: string }): Promise<ConversationContext> {
	const response = await client.request({ type: "conversation.context", projectId, ...options });
	if (response.type !== "conversation.context") throw new Error(JSON.stringify(response));
	return response.context;
}

async function workers(client: TestClient, projectId: string, threadId?: string): Promise<WorkersListResponse> {
	const response = await client.request({ type: "workers.list", projectId, ...(threadId === undefined ? {} : { threadId }) });
	if (response.type !== "workers.list") throw new Error(JSON.stringify(response));
	return response;
}

async function until(check: () => Promise<boolean> | boolean, timeoutMs = 30_000): Promise<void> {
	const start = Date.now();
	while (Date.now() - start < timeoutMs) {
		if (await check()) return;
		await new Promise((resolve) => setTimeout(resolve, 25));
	}
	throw new Error("timed out waiting for a condition");
}

function userEntries(view: ConversationView | undefined, prefix: string): ConversationView["entries"] {
	return view?.entries.filter((entry) => entry.kind === "pi.user" && entryText(entry).startsWith(prefix)) ?? [];
}

/** Whether an assistant answer follows the first user entry starting with `prefix`. */
function answeredAfter(view: ConversationView | undefined, prefix: string): boolean {
	const entries = view?.entries ?? [];
	const index = entries.findIndex((entry) => entry.kind === "pi.user" && entryText(entry).startsWith(prefix));
	return index !== -1 && entries.slice(index + 1).some((entry) => entry.kind === "pi.assistant");
}

function toolResultTexts(view: ConversationView | undefined, toolName: string): { text: string; isError: boolean }[] {
	return (view?.entries ?? [])
		.filter((entry) => entry.kind === "pi.tool-result")
		.flatMap((entry) => (entry.model ?? []) as { toolName?: string; content?: unknown; isError?: boolean }[])
		.filter((message) => message.toolName === toolName)
		.map((message) => ({ text: textOf(message.content), isError: message.isError === true }));
}

function deferredGate(): { promise: Promise<void>; release(): void } {
	let release: () => void = () => undefined;
	const promise = new Promise<void>((resolve) => {
		release = resolve;
	});
	return { promise, release };
}

/** Hold a model request until the gate opens or the request is aborted (a stop, a restart). */
function hold(gate: Promise<void>, signal: AbortSignal | undefined): Promise<void> {
	return new Promise<void>((resolve) => {
		signal?.addEventListener("abort", () => resolve(), { once: true });
		void gate.then(() => resolve());
	});
}

function fakeClock(start = Date.UTC(2026, 9, 30, 12, 0, 0)): { now(): number; setTimer: SetTimer; advance(ms: number): void } {
	let now = start;
	return {
		now: () => now,
		setTimer: (() => () => undefined) as unknown as SetTimer,
		advance(ms: number): void {
			now += ms;
		},
	};
}

async function resume(test: TestSetup, projectId: string): Promise<void> {
	const { runtime } = await test.server.manager.open(projectId);
	runtime.harness.resume();
}

// --- tests -----------------------------------------------------------------------------------------------------------

describe("background threads", () => {
	threadTest("main starts a thread, which works in its own workspace and finishes with a summary main reviews", async () => {
		const test = await setup();
		script(test);
		const { client, projectId, view } = await openProject(test);
		await submit(client, projectId, "Start the thread.");

		const finished = await view.waitForView((value) => answeredAfter(value, "[thread jira-run finished]"));
		expect(entryText(userEntries(finished, "[thread jira-run finished]")[0]!)).toBe(`[thread jira-run finished]\n${SUMMARY}`);

		const list = await threads(client, projectId);
		expect(list.map((entry) => entry.id)).toEqual(["main", "jira-run"]);
		expect(list[0]).toMatchObject({ main: true, startedBy: null, status: "idle" });
		const record = list[1]!;
		expect(record).toMatchObject({
			title: "Jira run",
			status: "done",
			main: false,
			startedBy: "main",
			scheduleId: null,
			model: FAUX,
			thinkingLevel: "low",
			onFinish: "review",
			summary: SUMMARY,
			failure: null,
			archived: false,
		});
		expect(record.finishedAt).not.toBeNull();
		expect(record.conversationId).toBeGreaterThan(1);

		// It never works in the project checkout: its own directory under the data directory (no jj here).
		const threadContext = await context(client, projectId, { threadId: "jira-run" });
		expect(threadContext.threadId).toBe("jira-run");
		expect(threadContext.cwd).toBe(join(test.dataDir, "projects", projectId, "threads", "jira-run", "checkout"));
		expect((await stat(threadContext.cwd)).isDirectory()).toBe(true);
		expect(threadContext.systemPrompt).toContain('You are the background thread "jira-run"');
		expect(threadContext.systemPrompt).toContain("worktree add");
		expect(threadContext.systemPrompt).toContain("You are a background thread of the project");
		expect(threadContext.systemPrompt).not.toContain(MAIN_THREADS_SECTION.slice(0, 60));

		// A full coordinator without the tools that start threads or schedules; main without thread_finish.
		const threadTools = threadContext.tools.map((tool) => tool.name);
		for (const name of ["worker_spawn", "board", "history", "codemode", "thread_list", "thread_peek", "thread_send", "thread_finish"]) {
			expect(threadTools).toContain(name);
		}
		expect(threadTools.some((name) => name.startsWith("memory_"))).toBe(true);
		for (const name of ["thread_start", "thread_stop", "thread_archive", "schedule_save"]) expect(threadTools).not.toContain(name);
		const mainContext = await context(client, projectId, {});
		expect(mainContext.threadId).toBe("main");
		const mainTools = mainContext.tools.map((tool) => tool.name);
		for (const name of ["thread_start", "thread_stop", "thread_archive", "thread_send", "schedule_save"]) expect(mainTools).toContain(name);
		expect(mainTools).not.toContain("thread_finish");
		expect(mainContext.systemPrompt).toContain(MAIN_THREADS_SECTION);

		// The thread's transcript can be watched and paged on its own.
		const threadView = new ViewClient(client);
		await threadView.start(projectId, { threadId: "jira-run" });
		expect(threadView.view?.conversation.id).toBe(record.conversationId);
		expect(threadView.view?.entries.some((entry) => entryText(entry) === THREAD_BRIEF)).toBe(true);
		const page = await client.request({ type: "conversation.page", projectId, threadId: "jira-run", order: "ascending" });
		if (page.type !== "conversation.page") throw new Error(JSON.stringify(page));
		expect(page.entries[0]?.conversationId).toBe(record.conversationId);

		// The list was pushed as it changed.
		const pushed = await client.waitFor(
			(message) =>
				message.type === "threads.state" &&
				message.projectId === projectId &&
				message.threads.some((entry) => entry.id === "jira-run" && entry.status === "done"),
		);
		expect(pushed.type).toBe("threads.state");
	});

	threadTest("files what a thread's worker saves with artifact_save under that thread and worker", async () => {
		const test = await setup();
		script(test, (turn) => {
			if (turn.who === "thread" && turn.text === THREAD_BRIEF) return call("worker_spawn", { id: "maker", task: WORKER_BRIEF });
			if (turn.who === "thread" && turn.toolName === "worker_spawn") return fauxAssistantMessage("Waiting for the maker.");
			if (turn.who === "thread" && turn.text.startsWith("[worker maker reported]")) return call("thread_finish", { summary: SUMMARY });
			if (turn.who === "worker" && turn.text === WORKER_BRIEF) return call("bash", { command: "printf clip > clip.txt" });
			if (turn.who === "worker" && turn.toolName === "bash") return call("artifact_save", { path: "clip.txt", title: "Clip" });
			return undefined;
		});
		const { client, projectId, view } = await openProject(test);
		await submit(client, projectId, "Start the thread.");
		await view.waitForView((value) => answeredAfter(value, "[thread jira-run finished]"));

		const response = await client.request({ type: "artifacts.list", projectId, threadId: "jira-run" });
		if (response.type !== "artifacts.list") throw new Error(JSON.stringify(response));
		expect(response.artifacts.map((artifact) => [artifact.title, artifact.threadId, artifact.workerId])).toEqual([["Clip", "jira-run", "maker"]]);
	});

	threadTest("refuses thread_finish while the thread's own question is open", async () => {
		const test = await setup();
		let refusal: string | undefined;
		script(test, (turn) => {
			if (turn.who === "thread" && turn.text === THREAD_BRIEF) return call("board", { action: "ask", text: "Sunrise or sunset?" });
			if (turn.who === "thread" && turn.toolName === "board") return call("thread_finish", { summary: "Asked; waiting." });
			if (turn.who === "thread" && turn.toolName === "thread_finish") {
				refusal = turn.text;
				return fauxAssistantMessage("Waiting for the answer.");
			}
			return undefined;
		});
		const { client, projectId } = await openProject(test);
		await submit(client, projectId, "Start the thread.");
		await until(() => refusal !== undefined);
		expect(refusal).toContain("Q1 is still open");
		await until(async () => (await thread(client, projectId, "jira-run"))?.status === "idle");
	});

	threadTest("a task handed to a finished thread brings it back", async () => {
		const test = await setup();
		let handed = false;
		script(test, (turn) => {
			if (turn.who === "main" && turn.text === "Hand it over.") return call("board", { action: "add_task", title: "Follow-up" });
			if (turn.who === "main" && turn.toolName === "board" && turn.text.startsWith("Added T2")) {
				return call("board", { action: "claim", id: "T2", expectedRevision: 1 });
			}
			if (turn.who === "main" && turn.toolName === "board" && turn.text.includes("is yours")) {
				return call("board", { action: "handoff", id: "T2", expectedRevision: 2, toThread: "jira-run" });
			}
			if (turn.who === "thread" && turn.text.startsWith('[board] Thread "main" handed T2')) {
				handed = true;
				return fauxAssistantMessage("Taking T2 on.");
			}
			return undefined;
		});
		const { client, projectId } = await openProject(test);
		await submit(client, projectId, "Start the thread.");
		await until(async () => (await thread(client, projectId, "jira-run"))?.status === "done");
		await submit(client, projectId, "Hand it over.");
		await until(() => handed);
		await until(async () => (await thread(client, projectId, "jira-run"))?.status === "idle");
		// The thread released T1, the task it was started for, when it finished.
		expect((await thread(client, projectId, "jira-run"))?.ownedTasks).toEqual(["T2"]);
	});

	threadTest("extracts memories from a background thread's compaction, tracked apart from main's", async () => {
		const test = await setup();
		let extracted = "";
		script(test, (turn) => {
			if (turn.text.includes("conversation to summarize")) return fauxAssistantMessage("## Goal\nTriage.");
			if (turn.text.includes("was just compacted")) {
				extracted = turn.text;
				return fauxAssistantMessage("Nothing worth keeping.");
			}
			if (turn.who === "thread" && turn.text === THREAD_BRIEF) return fauxAssistantMessage("Triaging. ".repeat(4_000));
			return undefined;
		});
		const { client, projectId } = await openProject(test);
		await submit(client, projectId, "Start the thread.");
		await until(async () => (await thread(client, projectId, "jira-run"))?.status === "idle");
		const compacted = await client.request({ type: "conversation.compact", projectId, threadId: "jira-run" });
		expect(compacted.type).toBe("conversation.compact");
		await until(() => extracted.length > 0);
		// The thread's own transcript, not main's.
		expect(extracted).toContain(THREAD_BRIEF);
		const record = await thread(client, projectId, "jira-run");
		await until(async () => {
			const file = Bun.file(join(test.dataDir, "projects", projectId, "memory-extraction.json"));
			if (!(await file.exists())) return false;
			const progress = (await file.json()) as { lastProcessedEntryId: number | null; threads?: Record<string, number> };
			return progress.lastProcessedEntryId === null && progress.threads?.[String(record?.conversationId)] !== undefined;
		});
	});

	for (const onFinish of ["review", "record"] as const) threadTest(`deduplicates a replayed ${onFinish} finish call across restart`, async () => {
		const test = await setup();
		const callId = "synthetic-thread-finish";
		script(test, (turn) => turn.who === "thread" && turn.text === THREAD_BRIEF
			? fauxAssistantMessage([fauxToolCall("thread_finish", { summary: SUMMARY }, { id: callId })], { stopReason: "toolUse" })
			: undefined, { onFinish });
		const { client, projectId, view } = await openProject(test);
		await submit(client, projectId, "Start the thread.");
		await view.waitForView((value) => userEntries(value, "[thread jira-run finished]").length === 1);
		const { runtime } = await test.server.manager.open(projectId);
		await runtime.conversation.waitForIdle(BACKGROUND_CONTEXT);
		expect(await runtime.harness.commit((tx) => tx.submissionByRequest(runtime.conversation.id, `thread-finished:jira-run:${callId}`), BACKGROUND_CONTEXT)).toBeDefined();
		const record = (await runtime.threads.record("jira-run"))!;
		await runtime.threads.finish(record, SUMMARY, callId);
		const server = await test.restart();
		const next = await connect(server);
		await next.hello();
		const { runtime: reopened } = await server.manager.open(projectId);
		await reopened.threads.finish((await reopened.threads.record("jira-run"))!, SUMMARY, callId);
		await reopened.conversation.waitForIdle(BACKGROUND_CONTEXT);
		const nextView = new ViewClient(next);
		await nextView.start(projectId);
		expect(userEntries(nextView.view, "[thread jira-run finished]")).toHaveLength(1);
	});

	threadTest("records a summary without waking main when onFinish is record", async () => {
		const test = await setup();
		script(test, () => undefined, { onFinish: "record" });
		const { client, projectId, view } = await openProject(test);
		await submit(client, projectId, "Start the thread.");
		await view.waitForView((value) => userEntries(value, "[thread jira-run finished]").length === 1);
		await until(async () => (await thread(client, projectId, "jira-run"))?.status === "done");
		await new Promise((resolve) => setTimeout(resolve, 300));
		expect(answeredAfter(view.view, "[thread jira-run finished]")).toBe(false);
	});

	threadTest("posts a failed turn to main once, and the thread recovers with the next message", async () => {
		const test = await setup();
		let fail = true;
		script(test, (turn) => {
			if (turn.who === "thread" && turn.text === THREAD_BRIEF && fail) {
				return fauxAssistantMessage("", { stopReason: "error", errorMessage: "provider is down" });
			}
			if (turn.who === "thread" && turn.text.startsWith("[from main]")) return call("thread_finish", { summary: SUMMARY });
			return undefined;
		});
		const { client, projectId, view } = await openProject(test);
		await submit(client, projectId, "Start the thread.");
		const failed = await view.waitForView((value) => userEntries(value, "[thread jira-run failed:").length > 0);
		expect(entryText(userEntries(failed, "[thread jira-run failed:")[0]!)).toBe("[thread jira-run failed: provider is down]");
		await until(async () => (await thread(client, projectId, "jira-run"))?.status === "failed");
		expect((await thread(client, projectId, "jira-run"))?.failure).toBe("provider is down");
		await new Promise((resolve) => setTimeout(resolve, 300));
		expect(userEntries(view.view, "[thread jira-run failed:")).toHaveLength(1);

		// A message wakes it again; it finishes this time.
		fail = false;
		await submit(client, projectId, "[from main] try again", "jira-run");
		await view.waitForView((value) => userEntries(value, "[thread jira-run finished]").length === 1);
		await until(async () => (await thread(client, projectId, "jira-run"))?.status === "done");
	});

	threadTest("keeps one level: a thread cannot start threads", async () => {
		const test = await setup();
		script(test, (turn) => {
			if (turn.who === "thread" && turn.text === THREAD_BRIEF) {
				return call("thread_start", { title: "Nested", brief: "Do something nested." });
			}
			if (turn.who === "thread" && turn.toolName === "thread_start") return call("thread_finish", { summary: "Could not nest." });
			return undefined;
		});
		const { client, projectId, view } = await openProject(test);
		await submit(client, projectId, "Start the thread.");
		await view.waitForView((value) => userEntries(value, "[thread jira-run finished]").length === 1);
		const threadView = new ViewClient(client);
		await threadView.start(projectId, { threadId: "jira-run" });
		const results = toolResultTexts(threadView.view, "thread_start");
		expect(results).toHaveLength(1);
		expect(results[0]?.isError).toBe(true);
		expect((await threads(client, projectId, true)).map((entry) => entry.id)).toEqual(["main", "jira-run"]);
	});

	threadTest("delivers messages between threads: a request wakes, a reply never wakes an idle thread, and a cap holds", async () => {
		const test = await setup();
		let mainReplies = false;
		script(test, (turn) => {
			if (turn.who === "thread" && turn.text === THREAD_BRIEF) {
				return call("thread_send", { id: "main", message: "Which Jira project?" });
			}
			if (turn.who === "thread" && turn.toolName === "thread_send") return fauxAssistantMessage("Asked main; waiting.");
			if (turn.who === "thread" && turn.text.startsWith("[from main]")) return fauxAssistantMessage("Thread woke up.");
			if (turn.who === "main" && turn.text.startsWith("[from jira-run]")) {
				mainReplies = true;
				return fauxAssistantMessage("Will answer later.");
			}
			if (turn.who === "main" && turn.text === "Answer the thread.") {
				return call("thread_send", { id: "jira-run", message: "Project ABC.", reply: true });
			}
			if (turn.who === "main" && turn.text === "Flood the thread.") {
				return fauxAssistantMessage(
					Array.from({ length: THREAD_MESSAGES_PER_HOUR }, (_, index) =>
						fauxToolCall("thread_send", { id: "jira-run", message: `ping ${index}`, reply: true }),
					),
					{ stopReason: "toolUse" },
				);
			}
			return undefined;
		});
		const { client, projectId, view } = await openProject(test);
		await submit(client, projectId, "Start the thread.");

		// The request wakes main, marked as coming from the thread.
		await view.waitForView((value) => answeredAfter(value, "[from jira-run] Which Jira project?"));
		expect(mainReplies).toBe(true);
		await until(async () => (await thread(client, projectId, "jira-run"))?.status === "idle");

		// Main's reply lands in the idle thread without starting a turn there.
		await submit(client, projectId, "Answer the thread.");
		const threadView = new ViewClient(client);
		await threadView.start(projectId, { threadId: "jira-run" });
		await threadView.waitForView((value) => userEntries(value, "[from main] Project ABC.").length === 1);
		await new Promise((resolve) => setTimeout(resolve, 400));
		expect(answeredAfter(threadView.view, "[from main] Project ABC.")).toBe(false);
		expect((await thread(client, projectId, "jira-run"))?.status).toBe("idle");

		// With the reply above, one more than the hourly cap: one is refused.
		await submit(client, projectId, "Flood the thread.");
		await view.waitForView((value) => toolResultTexts(value, "thread_send").length === THREAD_MESSAGES_PER_HOUR + 1);
		const flood = toolResultTexts(view.view, "thread_send").slice(1);
		expect(flood.filter((result) => result.isError)).toHaveLength(1);
		expect(flood.find((result) => result.isError)?.text).toContain("in the last hour");
	});

	threadTest("resumes a thread and its workers after a restart, and lists the thread's workers", async () => {
		const test = await setup();
		const gate = deferredGate();
		let attempts = 0;
		script(test, async (turn) => {
			if (turn.who === "thread" && turn.text === THREAD_BRIEF) {
				return call("worker_spawn", { id: "reader", task: WORKER_BRIEF, title: "Read" });
			}
			if (turn.who === "thread" && turn.text.startsWith("[worker reader reported]")) {
				return call("thread_finish", { summary: turn.text });
			}
			if (turn.who === "thread" && turn.toolName === "worker_spawn") return fauxAssistantMessage("Waiting for the reader.");
			if (turn.who === "worker" && turn.text === WORKER_BRIEF) {
				attempts += 1;
				if (attempts === 1) {
					await hold(gate.promise, turn.signal);
					return fauxAssistantMessage("interrupted");
				}
				return fauxAssistantMessage("## Report\nOutcome: done after the restart");
			}
			return undefined;
		});
		const { client, projectId } = await openProject(test);
		await submit(client, projectId, "Start the thread.");
		await until(() => attempts === 1);

		// The thread's worker works in the thread's workspace and is listed under the thread.
		const listed = await workers(client, projectId, "jira-run");
		expect(listed.workers.map((worker) => [worker.id, worker.threadId, worker.status])).toEqual([["reader", "jira-run", "running"]]);
		expect((await workers(client, projectId, "main")).workers).toHaveLength(0);
		expect((await workers(client, projectId)).workers.map((worker) => worker.threadId)).toEqual(["jira-run"]);
		const workerContext = await context(client, projectId, { threadId: "jira-run", workerId: "reader" });
		expect(workerContext.cwd).toBe(join(test.dataDir, "projects", projectId, "threads", "jira-run", "checkout"));
		expect(workerContext.systemPrompt).toContain('workspace of the background thread "jira-run"');
		expect(workerContext.tools.map((tool) => tool.name).filter((name) => name.startsWith("thread_"))).toEqual([]);
		expect(errorOf(await client.request({ type: "workers.list", projectId, threadId: "nope" })).code).toBe("unknown_thread");
		const pushed = await client.waitFor(
			(message) => message.type === "workers.state" && message.workers.some((worker) => worker.threadId === "jira-run"),
		);
		expect(pushed.type).toBe("workers.state");

		const restarted = await test.restart();
		gate.release();
		const next = await connect(restarted);
		expect((await next.hello()).type).toBe("hello");
		const nextView = new ViewClient(next);
		await nextView.start(projectId);
		await nextView.waitForView((value) => userEntries(value, "[thread jira-run finished]").length === 1, 45_000);
		expect(entryText(userEntries(nextView.view, "[thread jira-run finished]")[0]!)).toContain("Outcome: done after the restart");
		await new Promise((resolve) => setTimeout(resolve, 300));
		expect(userEntries(nextView.view, "[thread jira-run finished]")).toHaveLength(1);
		expect((await thread(next, projectId, "jira-run"))?.status).toBe("done");
		expect((await workers(next, projectId, "jira-run")).workers[0]?.status).toBe("idle");
	});

	threadTest("lets threads claim tasks with a revision check and routes a question's answer to the thread that asked", async () => {
		const test = await setup({ boardEditDebounceMs: 60_000 });
		let taskRevision = 0;
		script(test, (turn) => {
			if (turn.who === "thread" && turn.text === THREAD_BRIEF) {
				return call("board", { action: "claim", id: "T1", expectedRevision: taskRevision });
			}
			if (turn.who === "thread" && turn.toolName === "board" && turn.text.includes("is yours")) {
				return call("board", { action: "ask", text: "Close stale tickets?", taskId: "T1" });
			}
			if (turn.who === "thread" && turn.toolName === "board") return fauxAssistantMessage("Asked; carrying on.");
			if (turn.who === "thread" && turn.text.startsWith("[board] The user answered")) return fauxAssistantMessage("Got the answer.");
			if (turn.who === "main" && turn.text === "Claim T1.") {
				return call("board", { action: "claim", id: "T1", expectedRevision: taskRevision + 1 });
			}
			return undefined;
		});
		const { client, projectId, view } = await openProject(test);
		const saved = await client.request({
			type: "board.task.save",
			projectId,
			task: { title: "Triage", description: "", acceptance: null, status: "todo", blockedBy: [], blockedReason: null, writeScopes: [] },
		});
		if (saved.type !== "board.task.save") throw new Error(JSON.stringify(saved));
		taskRevision = saved.task.revision;

		await submit(client, projectId, "Start the thread.");
		const board = async () => {
			const response = await client.request({ type: "board.get", projectId });
			if (response.type !== "board.get") throw new Error(JSON.stringify(response));
			return response.board;
		};
		await until(async () => (await board()).questions.length === 1);
		const current = await board();
		expect(current.tasks[0]?.ownerThreadId).toBe("jira-run");
		const question = current.questions[0]!;
		expect(question.threadId).toBe("jira-run");
		// T2 is the task main started it for; it claimed T1 itself.
		expect((await thread(client, projectId, "jira-run"))?.ownedTasks).toEqual(["T1", "T2"]);
		expect((await thread(client, projectId, "jira-run"))?.openQuestions).toBe(1);

		// Main cannot take a task another thread holds.
		await submit(client, projectId, "Claim T1.");
		// The first board result is main's add_task for the thread's own task.
		await view.waitForView((value) => toolResultTexts(value, "board").length === 2);
		const refused = toolResultTexts(view.view, "board")[1]!;
		expect(refused.isError).toBe(true);
		expect(refused.text).toContain('claimed by thread "jira-run"');

		// The user's answer goes to the thread that asked, not to main.
		const answered = await client.request({
			type: "board.question.answer",
			projectId,
			questionId: question.id,
			expectedRevision: question.revision,
			answer: "Yes, close them.",
		});
		expect(answered.type).toBe("board.question.answer");
		const threadView = new ViewClient(client);
		await threadView.start(projectId, { threadId: "jira-run" });
		await threadView.waitForView((value) => answeredAfter(value, "[board] The user answered Q1"));
		expect(userEntries(view.view, "[board] The user answered")).toHaveLength(0);
	});

	threadTest("stops a thread with its workers and releases its tasks; archives only what no longer works", async () => {
		const test = await setup();
		const gate = deferredGate();
		script(test, async (turn) => {
			if (turn.who === "thread" && turn.text === THREAD_BRIEF) return call("board", { action: "claim", id: "T1", expectedRevision: 1 });
			if (turn.who === "thread" && turn.toolName === "board") return call("worker_spawn", { id: "reader", task: WORKER_BRIEF });
			if (turn.who === "thread" && turn.toolName === "worker_spawn") return fauxAssistantMessage("Waiting.");
			if (turn.who === "worker" && turn.text === WORKER_BRIEF) {
				await hold(gate.promise, turn.signal);
				return fauxAssistantMessage("late");
			}
			return undefined;
		});
		const { client, projectId } = await openProject(test);
		await client.request({
			type: "board.task.save",
			projectId,
			task: { title: "Triage", description: "", acceptance: null, status: "todo", blockedBy: [], blockedReason: null, writeScopes: [] },
		});
		await submit(client, projectId, "Start the thread.");
		await until(async () => (await thread(client, projectId, "jira-run")) !== undefined);
		await until(async () => (await workers(client, projectId, "jira-run")).workers[0]?.status === "running");

		const refused = await client.request({ type: "threads.archive", projectId, threadId: "jira-run", archived: true });
		expect(errorOf(refused).code).toBe("bad_request");
		// A running thread's checkout is listed but cannot be cleaned.
		const storage = await client.request({ type: "projects.storage", projectId });
		if (storage.type !== "projects.storage") throw new Error(JSON.stringify(storage));
		const checkout = storage.items.find((item) => item.id === "thread:jira-run");
		expect(checkout).toMatchObject({ kind: "thread", label: "Jira run", removable: false });
		const notCleaned = await client.request({ type: "projects.storage.clean", projectId, itemIds: ["thread:jira-run"] });
		if (notCleaned.type !== "projects.storage.clean") throw new Error(JSON.stringify(notCleaned));
		expect(notCleaned.removed).toEqual([]);
		expect(notCleaned.refused[0]?.id).toBe("thread:jira-run");
		expect(errorOf(await client.request({ type: "threads.stop", projectId, threadId: "main" })).code).toBe("bad_request");
		expect(errorOf(await client.request({ type: "threads.stop", projectId, threadId: "nope" })).code).toBe("unknown_thread");

		const stopped = await client.request({ type: "threads.stop", projectId, threadId: "jira-run" });
		if (stopped.type !== "threads.stop") throw new Error(JSON.stringify(stopped));
		expect(stopped.thread.status).toBe("stopped");
		expect((await workers(client, projectId, "jira-run")).workers[0]?.status).toBe("stopped");
		const board = await client.request({ type: "board.get", projectId });
		if (board.type !== "board.get") throw new Error(JSON.stringify(board));
		expect(board.board.tasks[0]?.ownerThreadId).toBeNull();
		gate.release();

		const archived = await client.request({ type: "threads.archive", projectId, threadId: "jira-run", archived: true });
		if (archived.type !== "threads.archive") throw new Error(JSON.stringify(archived));
		expect(archived.thread.archived).toBe(true);
		// Archiving removes the thread's checkout.
		await until(async () => (await stat(checkout!.path).catch(() => undefined)) === undefined);
		expect((await threads(client, projectId)).map((entry) => entry.id)).toEqual(["main"]);
		expect((await threads(client, projectId, true)).map((entry) => entry.id)).toEqual(["main", "jira-run"]);
	});

	threadTest("routes the conversation requests by threadId and refuses an unknown thread", async () => {
		const test = await setup();
		script(test, (turn) => {
			if (turn.who === "thread" && turn.text === "Anything else?") return fauxAssistantMessage("Thread answers the user.");
			return undefined;
		});
		const { client, projectId, view } = await openProject(test);
		await submit(client, projectId, "Start the thread.");
		await view.waitForView((value) => answeredAfter(value, "[thread jira-run finished]"));

		for (const request of [
			{ type: "conversation.watch" },
			{ type: "conversation.page" },
			{ type: "conversation.context" },
			{ type: "conversation.abort" },
			{ type: "conversation.compact" },
			{ type: "conversation.submit", requestId: "x", content: "hello" },
		]) {
			const response = await client.request({ ...request, projectId, threadId: "nope" });
			expect(errorOf(response).code).toBe("unknown_thread");
		}

		// The user types into a finished thread: it works again and answers there, not in main.
		await submit(client, projectId, "Anything else?", "jira-run");
		const threadView = new ViewClient(client);
		await threadView.start(projectId, { threadId: "jira-run" });
		await threadView.waitForView((value) => value.entries.some((entry) => entryText(entry) === "Thread answers the user."));
		expect(view.view?.entries.some((entry) => entryText(entry) === "Anything else?")).toBe(false);
		await until(async () => (await thread(client, projectId, "jira-run"))?.status === "idle");
		expect((await client.request({ type: "conversation.abort", projectId, threadId: "jira-run" })).type).toBe("conversation.abort");

		// The project's activity counts background threads at work or waiting.
		const listed = await client.request({ type: "projects.list" });
		if (listed.type !== "projects.list") throw new Error(JSON.stringify(listed));
		expect(listed.projects.find((project) => project.id === projectId)?.activity?.backgroundThreads).toBe(1);
	});

	threadTest("main's check-ins digest its running background threads", async () => {
		const clock = fakeClock();
		const test = await setup({ now: clock.now, setTimer: clock.setTimer });
		const gate = deferredGate();
		script(test, async (turn) => {
			if (turn.who === "main" && turn.text.startsWith("[check-in]")) return fauxAssistantMessage("All good.");
			if (turn.who === "thread" && turn.text === THREAD_BRIEF) return call("read", { path: "README.md" });
			if (turn.who === "thread" && turn.toolName === "read") {
				await hold(gate.promise, turn.signal);
				return call("thread_finish", { summary: SUMMARY });
			}
			return undefined;
		});
		const { client, projectId, view } = await openProject(test);
		await client.request({ type: "projects.configure", projectId, checkIns: { enabled: true, intervalMinutes: 1 } });
		await submit(client, projectId, "Start the thread.");
		await until(async () => (await thread(client, projectId, "jira-run"))?.current === "Thinking");

		clock.advance(61_000);
		await resume(test, projectId);
		const checked = await view.waitForView((value) => userEntries(value, "[check-in]").length === 1);
		const text = entryText(userEntries(checked, "[check-in]")[0]!);
		expect(text).toContain("1 background thread is still running");
		expect(text).toContain("thread jira-run — Jira run");
		expect(text).toContain("thread_send");
		gate.release();
		await view.waitForView((value) => userEntries(value, "[thread jira-run finished]").length === 1);
	});
});

describe("scheduled threads", () => {
	async function saveThreadSchedule(client: TestClient, projectId: string, onReport: "review" | "record" = "review"): Promise<string> {
		const saved = await client.request({
			type: "schedules.save",
			projectId,
			schedule: {
				title: "Nightly triage",
				brief: THREAD_BRIEF,
				spec: { kind: "interval", everyMinutes: 60 },
				model: null,
				thinkingLevel: "high",
				isolation: "shared",
				onReport,
				enabled: false,
				kind: "thread",
			},
		});
		if (saved.type !== "schedules.save") throw new Error(JSON.stringify(saved));
		return saved.schedule.id;
	}

	threadTest("starts a thread with the user's prompt, skips while it works, and archives it 7 days after it finishes", async () => {
		const clock = fakeClock();
		const test = await setup({ now: clock.now, setTimer: clock.setTimer });
		const gate = deferredGate();
		script(test, async (turn) => {
			if (turn.who === "thread" && turn.text === THREAD_BRIEF) {
				await hold(gate.promise, turn.signal);
				return call("thread_finish", { summary: SUMMARY });
			}
			return undefined;
		});
		const { client, projectId, view } = await openProject(test);
		const scheduleId = await saveThreadSchedule(client, projectId);

		const first = await client.request({ type: "schedules.run", projectId, scheduleId });
		if (first.type !== "schedules.run") throw new Error(JSON.stringify(first));
		expect(first.run.outcome).toBe("started");
		expect(first.run.workerId).toBeNull();
		const threadId = first.run.threadId!;
		expect(threadId.startsWith(`${scheduleId}-`)).toBe(true);
		const started = (await thread(client, projectId, threadId))!;
		expect(started).toMatchObject({ startedBy: "schedule", scheduleId, model: FAUX, thinkingLevel: "high", onFinish: "review" });

		// Its previous thread is not done: the next run is skipped.
		clock.advance(60_000);
		const second = await client.request({ type: "schedules.run", projectId, scheduleId });
		if (second.type !== "schedules.run") throw new Error(JSON.stringify(second));
		expect(second.run.outcome).toBe("skipped");
		expect(second.run.message).toContain("not done");

		gate.release();
		await view.waitForView((value) => userEntries(value, `[thread ${threadId} finished]`).length === 1);
		await until(async () => (await thread(client, projectId, threadId))?.status === "done");

		// Seven days after it finished it leaves the list; it is still there when asked for archived ones.
		clock.advance(THREAD_ARCHIVE_AFTER_MS - 60_000);
		expect((await threads(client, projectId)).map((entry) => entry.id)).toContain(threadId);
		clock.advance(120_000);
		expect((await threads(client, projectId)).map((entry) => entry.id)).not.toContain(threadId);
		expect((await thread(client, projectId, threadId))?.archived).toBe(true);
	});
});

describe("board ownership", () => {
	function boardWithTask(): { state: BoardState; task: BoardTask } {
		const state = emptyBoardState();
		const { after } = saveTask(state, {
			task: { title: "T", description: "", acceptance: null, status: "todo", blockedBy: [], blockedReason: null, writeScopes: [] },
			author: "user",
			now: "2026-11-04T00:00:00.000Z",
		});
		return { state, task: after };
	}
	const now = "2026-11-04T01:00:00.000Z";

	it("claims with a revision check and refuses a task another thread holds", () => {
		const { state, task } = boardWithTask();
		const claimed = changeOwner(state, { taskId: task.id, expectedRevision: task.revision, change: { kind: "claim", threadId: "a" }, now });
		expect(claimed.after.ownerThreadId).toBe("a");
		expect(claimed.after.revision).toBe(task.revision + 1);
		expect(() =>
			changeOwner(state, { taskId: task.id, expectedRevision: task.revision, change: { kind: "claim", threadId: "a" }, now }),
		).toThrow(/revision/);
		expect(() =>
			changeOwner(state, { taskId: task.id, expectedRevision: claimed.after.revision, change: { kind: "claim", threadId: "b" }, now }),
		).toThrow(/claimed by thread "a"/);
	});

	it("lets only the owner or main release or hand a task over", () => {
		const { state, task } = boardWithTask();
		const claimed = changeOwner(state, { taskId: task.id, expectedRevision: task.revision, change: { kind: "claim", threadId: "a" }, now }).after;
		expect(() =>
			changeOwner(state, { taskId: task.id, expectedRevision: claimed.revision, change: { kind: "release", threadId: "b" }, now }),
		).toThrow(/only its owner or main/);
		const handed = changeOwner(state, {
			taskId: task.id,
			expectedRevision: claimed.revision,
			change: { kind: "handoff", threadId: "a", to: "b" },
			now,
		}).after;
		expect(handed.ownerThreadId).toBe("b");
		const taken = changeOwner(state, {
			taskId: task.id,
			expectedRevision: handed.revision,
			change: { kind: "handoff", threadId: "main", to: "main" },
			now,
		}).after;
		expect(taken.ownerThreadId).toBe("main");
		const released = changeOwner(state, { taskId: task.id, expectedRevision: taken.revision, change: { kind: "release", threadId: "main" }, now }).after;
		expect(released.ownerThreadId).toBeNull();
	});
});

