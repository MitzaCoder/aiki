import { afterEach, describe, expect, it } from "bun:test";
import type { ConversationView, EntryRecord } from "@earendil-works/pi-durable";
import type { TranscriptContext } from "@earendil-works/pi-ai";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
import type { ModelRef, ProjectActivity } from "@kemiri/protocol";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	activityFromView,
	activitySignal,
	coordinatorState,
	DEFAULT_ACTIVITY,
	idleActivity,
	ProjectActivityStore,
	ProjectActivityService,
} from "../src/activity.ts";
import { ProjectStore } from "../src/projects.ts";
import { createSetup, entryText, TestClient, type TestSetup } from "./support.ts";

const cleanups: (() => Promise<void>)[] = [];
const clients: TestClient[] = [];

const FAUX: ModelRef = { provider: "faux", modelId: "faux-1" };

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

async function greet(client: TestClient): Promise<void> {
	expect((await client.hello()).type).toBe("hello");
}

async function addProject(client: TestClient, path: string): Promise<string> {
	const response = await client.request({ type: "projects.add", path });
	if (response.type !== "projects.add") throw new Error(JSON.stringify(response));
	return response.project.id;
}

async function configure(client: TestClient, projectId: string): Promise<void> {
	const response = await client.request({
		type: "projects.configure",
		projectId,
		coordinatorModel: FAUX,
		coordinatorThinkingLevel: "low",
		workerModels: [FAUX],
	});
	expect(response.type).toBe("projects.configure");
}

async function until(check: () => boolean | Promise<boolean>, timeoutMs = 10_000): Promise<void> {
	const start = Date.now();
	while (Date.now() - start < timeoutMs) {
		if (await check()) return;
		await new Promise((resolve) => setTimeout(resolve, 20));
	}
	throw new Error("timed out waiting for a condition");
}

/** A one-shot promise, to hold a faux response in flight while the test looks at the activity. */
function deferred(): { promise: Promise<void>; resolve: () => void } {
	let resolve: () => void = () => undefined;
	const promise = new Promise<void>((settle) => {
		resolve = () => settle();
	});
	return { promise, resolve };
}

function assistantEntry(id: number, stopReason: string, timestamp = 1_700_000_000_000): EntryRecord {
	return {
		id,
		conversationId: 1,
		kind: "pi.assistant",
		model: [{ role: "assistant", content: [{ type: "text", text: `answer ${id}` }], stopReason, timestamp }],
	} as unknown as EntryRecord;
}

function userEntry(id: number): EntryRecord {
	return {
		id,
		conversationId: 1,
		kind: "pi.user",
		model: [{ role: "user", content: "hello", timestamp: 1_700_000_000_000 }],
	} as unknown as EntryRecord;
}

function viewOf(entries: EntryRecord[], live: Record<string, unknown> = {}): ConversationView {
	return {
		conversation: { id: 1 },
		entries,
		docs: { "pi.live": live },
	} as unknown as ConversationView;
}

describe("activity values", () => {
	it("takes the coordinator's state from a live run and otherwise from the newest assistant entry", () => {
		expect(coordinatorState(viewOf([userEntry(1)], { run: { taskId: 1, inputs: [] } }))).toBe("working");
		expect(coordinatorState(viewOf([userEntry(1), assistantEntry(2, "toolUse")]))).toBe("idle");
		expect(coordinatorState(viewOf([userEntry(1), assistantEntry(2, "stop")]))).toBe("idle");
		expect(coordinatorState(viewOf([userEntry(1), assistantEntry(2, "aborted")]))).toBe("idle");
		expect(coordinatorState(viewOf([userEntry(1), assistantEntry(2, "error")]))).toBe("failed");
		expect(coordinatorState(viewOf([assistantEntry(2, "error"), userEntry(3)]))).toBe("failed");
		expect(coordinatorState(viewOf([userEntry(1)]))).toBe("idle");
		expect(coordinatorState(viewOf([]))).toBe("idle");
	});

	it("does not move the signal for a streamed partial", () => {
		const entries = [userEntry(1), assistantEntry(2, "stop")];
		const idle = viewOf(entries);
		const streaming = viewOf(entries, {
			run: { taskId: 1, inputs: [] },
			generation: { attempt: 1, message: { content: [{ type: "text", text: "half" }] } },
		});
		const streamingMore = viewOf(entries, {
			run: { taskId: 1, inputs: [] },
			generation: { attempt: 1, message: { content: [{ type: "text", text: "half an answer" }] } },
		});
		expect(activitySignal(streamingMore)).toBe(activitySignal(streaming));
		expect(activitySignal(streaming)).not.toBe(activitySignal(idle));
		expect(activitySignal(viewOf([...entries, assistantEntry(3, "stop")]))).not.toBe(activitySignal(idle));
	});

	it("moves the signal when a tool call starts or ends, never for its streamed output", () => {
		const entries = [userEntry(1)];
		const noTool = viewOf(entries, { run: { taskId: 1, inputs: [] } });
		const pending = viewOf(entries, {
			run: { taskId: 1, inputs: [] },
			tools: [{ callId: "c1", name: "bash", status: "pending" }],
		});
		const runningFirstByte = viewOf(entries, {
			run: { taskId: 1, inputs: [] },
			tools: [{ callId: "c1", name: "bash", status: "running", output: "h" }],
		});
		const runningMoreOutput = viewOf(entries, {
			run: { taskId: 1, inputs: [] },
			tools: [{ callId: "c1", name: "bash", status: "running", output: "hello world, still going" }],
		});
		const done = viewOf(entries, {
			run: { taskId: 1, inputs: [] },
			tools: [{ callId: "c1", name: "bash", status: "done", output: "hello world, still going" }],
		});
		expect(activitySignal(pending)).not.toBe(activitySignal(noTool));
		expect(activitySignal(runningFirstByte)).not.toBe(activitySignal(pending));
		// More streamed output, same status: the signal does not move.
		expect(activitySignal(runningMoreOutput)).toBe(activitySignal(runningFirstByte));
		expect(activitySignal(done)).not.toBe(activitySignal(runningMoreOutput));
	});

	it("keeps the last reply when a compaction drops it from the active transcript, and takes a newer one", () => {
		const previous: ProjectActivity = {
			coordinator: "idle",
			runningWorkers: 0,
			lastReplyAt: "2026-11-01T00:00:00.000Z",
			lastReplyEntryId: 5,
			runningTool: null,
		};
		// The kept part has an older final answer; the previous reply stays.
		expect(activityFromView(viewOf([userEntry(1), assistantEntry(3, "stop")]), previous)).toEqual(previous);
		// Nothing but the compaction summary survives.
		expect(
			activityFromView(
				viewOf([{ id: 8, conversationId: 1, kind: "pi.compaction", head: 4 } as unknown as EntryRecord]),
				previous,
			),
		).toEqual(previous);
		// A newer answer wins.
		const newer = activityFromView(viewOf([userEntry(6), assistantEntry(7, "stop", 1_700_000_001_000)]), previous);
		expect(newer.lastReplyEntryId).toBe(7);
		expect(newer.lastReplyAt).toBe(new Date(1_700_000_001_000).toISOString());
		// A run in progress is working, whatever was last answered.
		expect(activityFromView(viewOf([assistantEntry(7, "stop")], { run: { taskId: 1, inputs: [] } }), previous).coordinator).toBe(
			"working",
		);
	});

	it("makes a project that is not open idle with no running workers, and leaves a failure", () => {
		expect(idleActivity({ ...DEFAULT_ACTIVITY, coordinator: "working", runningWorkers: 2 })).toEqual(DEFAULT_ACTIVITY);
		const failed: ProjectActivity = { ...DEFAULT_ACTIVITY, coordinator: "failed", runningWorkers: 1 };
		expect(idleActivity(failed)).toEqual({ ...failed, runningWorkers: 0 });
		expect(idleActivity(DEFAULT_ACTIVITY)).toBe(DEFAULT_ACTIVITY);
	});

	it("stores the activity beside project.json and ignores a corrupt file", async () => {
		const root = await mkdtemp(join(tmpdir(), "aiki-activity-"));
		cleanups.push(async () => rm(root, { recursive: true, force: true }));
		const store = new ProjectActivityStore(new ProjectStore(root));
		expect(await store.read("proj-1")).toBeUndefined();

		const activity: ProjectActivity = {
			coordinator: "failed",
			runningWorkers: 2,
			lastReplyAt: "2026-11-04T00:00:00.000Z",
			lastReplyEntryId: 9,
			runningTool: null,
			openQuestions: 0,
		};
		await store.write("proj-1", activity);
		expect(store.file("proj-1")).toBe(join(root, "projects", "proj-1", "activity.json"));
		expect(await store.read("proj-1")).toEqual(activity);

		await writeFile(store.file("proj-1"), "{ not json");
		expect(await store.read("proj-1")).toBeUndefined();
	});
});

describe("project activity", () => {
	it("pushes working while the coordinator runs, then idle with the answer's entry", async () => {
		const test = await setup();
		const client = await connect(test.server);
		await greet(client);
		const projectId = await addProject(client, test.projectDir);
		await configure(client, projectId);

		// project.state also carries attention, links and runtime state. Those can change with identical activity.
		// Check activity deduplication at its publisher, not by projecting unrelated summary pushes onto activity.
		const published: ProjectActivity[] = [];
		const { runtime } = await test.server.manager.open(projectId);
		const observer = new ProjectActivityService({
			conversation: runtime.conversation,
			initial: DEFAULT_ACTIVITY,
			onChange: (activity) => published.push(activity),
		});
		cleanups.unshift(() => observer.stop());
		await observer.start();

		const gate = deferred();
		test.faux.setResponses([
			async () => {
				await gate.promise;
				return fauxAssistantMessage("First answer.");
			},
		]);
		await client.request({ type: "conversation.submit", projectId, requestId: "first", content: "Hello" });

		const working = await client.waitFor(
			(message) =>
				message.type === "project.state" &&
				message.project.id === projectId &&
				message.project.activity?.coordinator === "working",
		);
		expect(working.type).toBe("project.state");

		gate.resolve();
		const idle = await client.waitFor(
			(message) =>
				message.type === "project.state" &&
				message.project.id === projectId &&
				message.project.activity?.coordinator === "idle" &&
				message.project.activity.lastReplyEntryId !== null,
		);
		if (idle.type !== "project.state") throw new Error("unreachable");
		const activity = idle.project.activity;
		expect(activity?.runningWorkers).toBe(0);
		expect(activity?.lastReplyAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);

		const page = await client.request({ type: "conversation.page", projectId, order: "ascending", limit: 100 });
		if (page.type !== "conversation.page") throw new Error(JSON.stringify(page));
		const answer = page.entries.find(
			(entry) => entry.kind === "pi.assistant" && entryText(entry as never) === "First answer.",
		);
		expect(answer?.id ?? null).toBe(activity?.lastReplyEntryId ?? null);

		await until(() => observer.current.coordinator === "idle" && observer.current.lastReplyEntryId === answer?.id);
		// The publisher never repeats unchanged activity, whichever summary pushes interleave on the socket.
		const start = published.findIndex((value) => value.coordinator === "working");
		expect(start).toBeGreaterThanOrEqual(0);
		const duringRun = published.slice(start).map((value) => JSON.stringify(value));
		for (let index = 1; index < duringRun.length; index++) {
			expect(duringRun[index]).not.toBe(duringRun[index - 1]);
		}
	});

	it("reports a failed coordinator run and keeps the last successful reply", async () => {
		const test = await setup();
		const client = await connect(test.server);
		await greet(client);
		const projectId = await addProject(client, test.projectDir);
		await configure(client, projectId);

		test.faux.setResponses([fauxAssistantMessage("Fine.")]);
		await client.request({ type: "conversation.submit", projectId, requestId: "ok", content: "First" });
		const idle = await client.waitFor(
			(message) =>
				message.type === "project.state" &&
				message.project.id === projectId &&
				message.project.activity?.coordinator === "idle" &&
				message.project.activity.lastReplyEntryId !== null,
		);
		if (idle.type !== "project.state") throw new Error("unreachable");
		const lastReplyEntryId = idle.project.activity?.lastReplyEntryId;

		test.faux.setResponses([
			fauxAssistantMessage("boom", { stopReason: "error", errorMessage: "ModelDeprecated: gone" }),
		]);
		await client.request({ type: "conversation.submit", projectId, requestId: "bad", content: "Second" });
		const failed = await client.waitFor(
			(message) =>
				message.type === "project.state" &&
				message.project.id === projectId &&
				message.project.activity?.coordinator === "failed",
		);
		if (failed.type !== "project.state") throw new Error("unreachable");
		expect(failed.project.activity?.lastReplyEntryId).toBe(lastReplyEntryId);

		// A later successful run clears the failure.
		test.faux.setResponses([fauxAssistantMessage("Recovered.")]);
		await client.request({ type: "conversation.submit", projectId, requestId: "again", content: "Third" });
		await client.waitFor(
			(message) =>
				message.type === "project.state" &&
				message.project.id === projectId &&
				message.project.activity?.coordinator === "idle" &&
				(message.project.activity.lastReplyEntryId ?? 0) > (lastReplyEntryId ?? 0),
		);
	});

	it("counts the running workers", async () => {
		const test = await setup();
		const client = await connect(test.server);
		await greet(client);
		const projectId = await addProject(client, test.projectDir);
		await configure(client, projectId);

		const BRIEF = "Summarize the project's README.";
		const hold = deferred();
		test.faux.setResponses(
			Array.from({ length: 30 }, () => async (request: TranscriptContext) => {
				const { role, text } = lastMessage(request);
				if (role === "toolResult") return fauxAssistantMessage("Tool call finished.");
				if (text.includes(BRIEF)) {
					await hold.promise;
					return fauxAssistantMessage("## Report\nOutcome: done");
				}
				if (text.includes("reported]")) return fauxAssistantMessage("Report reviewed.");
				if (text.includes("Delegate the reading.")) {
					return fauxAssistantMessage([fauxToolCall("worker_spawn", { id: "reader", task: BRIEF })], {
						stopReason: "toolUse",
					});
				}
				return fauxAssistantMessage("Nothing to do.");
			}),
		);

		await client.request({ type: "conversation.submit", projectId, requestId: "delegate", content: "Delegate the reading." });
		const running = await client.waitFor(
			(message) =>
				message.type === "project.state" &&
				message.project.id === projectId &&
				message.project.activity?.runningWorkers === 1,
		);
		expect(running.type).toBe("project.state");

		hold.resolve();
		await client.waitFor(
			(message) =>
				message.type === "project.state" &&
				message.project.id === projectId &&
				message.project.activity?.runningWorkers === 0 &&
				message.project.activity.coordinator === "idle",
		);
	});

	it("shows the coordinator's running tool, with a start time, and clears it once the call ends", async () => {
		const test = await setup();
		const client = await connect(test.server);
		await greet(client);
		const projectId = await addProject(client, test.projectDir);
		await configure(client, projectId);

		test.faux.setResponses(
			Array.from({ length: 10 }, () => (request: TranscriptContext) => {
				const { role } = lastMessage(request);
				if (role === "toolResult") return fauxAssistantMessage("Done.");
				return fauxAssistantMessage([fauxToolCall("bash", { command: "sleep 0.2 && echo hi" })], {
					stopReason: "toolUse",
				});
			}),
		);

		await client.request({ type: "conversation.submit", projectId, requestId: "run-bash", content: "Run it" });
		const running = await client.waitFor(
			(message) =>
				message.type === "project.state" &&
				message.project.id === projectId &&
				message.project.activity?.runningTool?.name === "bash",
		);
		if (running.type !== "project.state") throw new Error("unreachable");
		const runningTool = running.project.activity?.runningTool;
		expect(runningTool?.name).toBe("bash");
		expect(runningTool?.startedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);

		const idle = await client.waitFor(
			(message) =>
				message.type === "project.state" &&
				message.project.id === projectId &&
				message.project.activity?.coordinator === "idle",
		);
		if (idle.type !== "project.state") throw new Error("unreachable");
		expect(idle.project.activity?.runningTool).toBeNull();
	});

	it("serves the persisted activity for closed projects after a restart, without opening them", async () => {
		const test = await setup();
		let client = await connect(test.server);
		await greet(client);
		const projectId = await addProject(client, test.projectDir);
		await configure(client, projectId);

		test.faux.setResponses([fauxAssistantMessage("An answer.")]);
		await client.request({ type: "conversation.submit", projectId, requestId: "reply", content: "Hello" });
		const idle = await client.waitFor(
			(message) =>
				message.type === "project.state" &&
				message.project.id === projectId &&
				message.project.activity?.coordinator === "idle" &&
				message.project.activity.lastReplyEntryId !== null,
		);
		if (idle.type !== "project.state") throw new Error("unreachable");
		const answered = idle.project.activity!;
		// The file write follows the push.
		await until(async () => JSON.stringify(await test.server.manager.activityStore.read(projectId)) === JSON.stringify(answered));

		// Another project, plus a value a crash could have left behind.
		const otherDir = join(test.root, "other");
		await mkdir(otherDir, { recursive: true });
		const otherId = await addProject(client, otherDir);
		await test.server.manager.activityStore.write(projectId, {
			...answered,
			coordinator: "working",
			runningWorkers: 3,
		});
		await test.server.manager.activityStore.write(otherId, {
			coordinator: "failed",
			runningWorkers: 4,
			lastReplyAt: null,
			lastReplyEntryId: null,
		});
		await test.restart();

		client = await connect(test.server);
		await greet(client);
		const list = await client.request({ type: "projects.list" });
		if (list.type !== "projects.list") throw new Error(JSON.stringify(list));
		const first = list.projects.find((project) => project.id === projectId);
		const other = list.projects.find((project) => project.id === otherId);
		expect(first?.state).toBe("closed");
		expect(first?.activity).toEqual({ ...answered, coordinator: "idle", runningWorkers: 0 });
		expect(other?.activity).toEqual({
			coordinator: "failed",
			runningWorkers: 0,
			lastReplyAt: null,
			lastReplyEntryId: null,
			runningTool: null,
			openQuestions: 0,
		});
	});
});
