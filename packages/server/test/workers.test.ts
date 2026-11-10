import { afterEach, describe, expect, it } from "bun:test";
import type { FauxResponseFactory } from "@earendil-works/pi-ai/providers/faux";
import type { TranscriptContext } from "@earendil-works/pi-ai";
import { fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
import { InboxDoc, type JsonObject } from "@earendil-works/pi-durable";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { NO_NEW_WORKER_REPORT, WorkersDoc } from "../src/workers.ts";
import { openBoard, saveTask } from "../src/board.ts";
import type { ConversationView, ModelRef, WorkerModel, WorkersListResponse } from "@aiki/protocol";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { SetTimer } from "@earendil-works/pi-durable";
import { createSetup, entryText, errorOf, TestClient, ViewClient, type TestSetup } from "./support.ts";

const cleanups: (() => Promise<void>)[] = [];
const clients: TestClient[] = [];

const FAUX: ModelRef = { provider: "faux", modelId: "faux-1" };
const OTHER: ModelRef = { provider: "other", modelId: "other-1" };

const BRIEF = "Summarize the project's README for me.";

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

/** The last non-system message, which tells the coordinator's turns from a worker's. */
function lastMessage(request: { messages: readonly { role: string; content?: unknown }[] }): {
	role: string;
	text: string;
} {
	const last = request.messages.findLast((message) => message.role !== "system");
	return { role: last?.role ?? "", text: messageText(last ?? {}) };
}

/** A system message carries its prompt sections rather than content; the transcript shows them the same way. */
function systemText(message: { role: string; content?: unknown }): string {
	const sections = (message as { sections?: Record<string, string> }).sections;
	if (sections === undefined) return messageText(message);
	return Object.entries(sections)
		.map(([key, text]) => `<${key}>\n${text}`)
		.join("\n");
}

type ScriptOptions = {
	/** What the user asks the coordinator, and the delegate call its answer carries. */
	delegate?: { text: string; call: JsonObject };
	workerAnswer?: string;
	/** The worker calls a tool it should not have, instead of answering. */
	workerCallsWorker?: boolean;
};

/** A model that answers both as the coordinator and as its worker, routed by what it is asked. */
function script(options: ScriptOptions = {}): FauxResponseFactory {
	return (request) => scripted(options, request);
}

/** The script's answer to one request, for tests that need to hold or wrap a single turn. */
function scripted(
	options: ScriptOptions,
	request: TranscriptContext,
): ReturnType<typeof fauxAssistantMessage> {
	const delegate = options.delegate ?? {
		text: "Delegate the reading.",
		call: { id: "reader", task: BRIEF, title: "Read the README" },
	};
	const workerAnswer = options.workerAnswer ?? "## Report\nOutcome: done\nFiles changed: none";
	const brief = delegate.call["task"] as string;
	const { role, text } = lastMessage(request);
	if (role === "toolResult") return fauxAssistantMessage("Tool call finished.");
	if (text.includes(brief)) {
		if (options.workerCallsWorker === true) {
			return fauxAssistantMessage([fauxToolCall("worker_spawn", { id: "nested", task: "x" })], {
				stopReason: "toolUse",
			});
		}
		return fauxAssistantMessage(workerAnswer);
	}
	if (text.includes("reported]") || text.includes("failed:")) return fauxAssistantMessage("Report reviewed.");
	if (text.includes(delegate.text)) {
		return fauxAssistantMessage([fauxToolCall("worker_spawn", delegate.call)], { stopReason: "toolUse" });
	}
	return fauxAssistantMessage("Nothing to do.");
}

async function greet(client: TestClient): Promise<void> {
	expect((await client.hello()).type).toBe("hello");
}

async function addProject(client: TestClient, path: string): Promise<string> {
	const response = await client.request({ type: "projects.add", path });
	if (response.type !== "projects.add") throw new Error(JSON.stringify(response));
	return response.project.id;
}

async function configure(client: TestClient, projectId: string, workerModels: WorkerModel[] = [FAUX]): Promise<void> {
	const response = await client.request({
		type: "projects.configure",
		projectId,
		coordinatorModel: FAUX,
		coordinatorThinkingLevel: "low",
		workerModels,
	});
	expect(response.type).toBe("projects.configure");
}

async function listWorkers(client: TestClient, projectId: string): Promise<WorkersListResponse> {
	const response = await client.request({ type: "workers.list", projectId });
	if (response.type !== "workers.list") throw new Error(JSON.stringify(response));
	return response;
}

async function until(check: () => Promise<boolean>, timeoutMs = 20_000): Promise<void> {
	const start = Date.now();
	while (Date.now() - start < timeoutMs) {
		if (await check()) return;
		await new Promise((resolve) => setTimeout(resolve, 20));
	}
	throw new Error("timed out waiting for a condition");
}

function sawReport(view: ConversationView | undefined, text = ""): boolean {
	return (
		view?.entries.some(
			(entry) =>
				entry.kind === "pi.user" &&
				entryText(entry).startsWith("[worker reader reported]") &&
				entryText(entry).includes(text),
		) ?? false
	);
}

function toolResults(view: ConversationView | undefined): ConversationView["entries"] {
	return view?.entries.filter((entry) => entry.kind === "pi.tool-result") ?? [];
}

/** A delegation crosses several runs (coordinator, worker, coordinator again), so tests get room to breathe. */
function workerTest(name: string, run: () => Promise<void>): void {
	it(name, run, 60_000);
}

/** Run a command and collect its output, for the jj parts. */
async function run(args: string[], cwd: string): Promise<{ code: number; stdout: string; stderr: string }> {
	const child = Bun.spawn(args, { cwd, stdout: "pipe", stderr: "pipe" });
	const [stdout, stderr, code] = await Promise.all([
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
		child.exited,
	]);
	return { code, stdout, stderr };
}

describe("workers", () => {
	workerTest("spawns a worker, reports back, and lists it with its model, isolation and conversation", async () => {
		const test = await setup();
		const client = await connect(test.server);
		await greet(client);
		const projectId = await addProject(client, test.projectDir);
		await configure(client, projectId);
		test.faux.setResponses(Array.from({ length: 40 }, () => script()));

		const view = new ViewClient(client);
		await view.start(projectId);
		const submitted = await client.request({
			type: "conversation.submit",
			projectId,
			requestId: "delegate-1",
			content: "Delegate the reading.",
		});
		expect(submitted.type).toBe("conversation.submit");

		// Only the report reaches the coordinator, as a message; the brief never does.
		const withReport = await view.waitForView((value) => sawReport(value));
		expect(entryText(withReport.entries.find((entry) => entryText(entry).startsWith("[worker reader reported]"))!)).toContain(
			"Outcome: done",
		);
		expect(withReport.entries.some((entry) => entryText(entry) === BRIEF)).toBe(false);

		const list = await listWorkers(client, projectId);
		expect(list.workers).toHaveLength(1);
		const worker = list.workers[0]!;
		expect(worker.id).toBe("reader");
		expect(worker.title).toBe("Read the README");
		expect(worker.model).toEqual(FAUX);
		expect(worker.thinkingLevel).toBeNull();
		expect(worker.isolation).toBe("shared");
		expect(worker.workspacePath).toBeNull();
		expect(worker.conversationId).toBeGreaterThan(1);
		expect(worker.spawnedByCallId).toBeTypeOf("string");
		expect(worker.lastReport).toContain("Outcome: done");
		expect(worker.failure).toBeNull();
		expect(list.defaults).toEqual({ model: null, thinkingLevel: null });

		// Once the answer is out the worker waits for the next message.
		await until(async () => (await listWorkers(client, projectId)).workers[0]?.status === "idle");

		// Its conversation is watchable read-only, exactly like the coordinator's.
		const workerView = new ViewClient(client);
		await workerView.start(projectId, { workerId: "reader" });
		const transcript = workerView.view!;
		expect(transcript.conversation.id).toBe(worker.conversationId);
		expect(transcript.entries.some((entry) => entryText(entry) === BRIEF)).toBe(true);
		expect(transcript.entries.some((entry) => entryText(entry).includes("Outcome: done"))).toBe(true);

		const page = await client.request({
			type: "conversation.page",
			projectId,
			workerId: "reader",
			order: "ascending",
		});
		expect(page.type).toBe("conversation.page");
		if (page.type === "conversation.page") {
			expect(page.entries.length).toBeGreaterThan(0);
			expect(page.entries[0]?.conversationId).toBe(worker.conversationId);
		}

		const unknown = await client.request({ type: "conversation.watch", projectId, workerId: "nobody" });
		expect(errorOf(unknown).code).toBe("unknown_worker");
	});

	workerTest("pushes the worker list, and records the tool call that spawned each worker", async () => {
		const test = await setup();
		const client = await connect(test.server);
		await greet(client);
		const projectId = await addProject(client, test.projectDir);
		await configure(client, projectId);
		test.faux.setResponses(Array.from({ length: 40 }, () => script()));

		const view = new ViewClient(client);
		await view.start(projectId);
		await client.request({ type: "conversation.submit", projectId, requestId: "r1", content: "Delegate the reading." });

		const pushed = await client.waitFor(
			(message) =>
				message.type === "workers.state" && message.projectId === projectId && message.workers.length > 0,
		);
		expect(pushed.type).toBe("workers.state");
		if (pushed.type !== "workers.state") return;
		const worker = pushed.workers[0]!;
		expect(worker.id).toBe("reader");
		expect(pushed.defaults).toEqual({ model: null, thinkingLevel: null });

		// The link from the transcript's tool call to the worker is the call's ID.
		const called = await view.waitForView((value) =>
			value.entries.some((entry) =>
				(entry.model ?? []).some((message) =>
					Array.isArray((message as { content?: unknown }).content)
						? ((message as { content: { type?: string; name?: string }[] }).content).some(
								(block) => block.type === "toolCall" && block.name === "worker_spawn",
							)
						: false,
				),
			),
		);
		const callId = called.entries
			.flatMap((entry) => (entry.model ?? []) as { content?: unknown }[])
			.flatMap((message) => (Array.isArray(message.content) ? message.content : []))
			.filter((block): block is { type: string; id?: string; name?: string } => typeof block === "object" && block !== null)
			.find((block) => block.type === "toolCall" && block.name === "worker_spawn")?.id;
		expect(callId).toBeTypeOf("string");
		expect(worker.spawnedByCallId).toBe(callId ?? "");
	});

	workerTest("runs several workers at once, each reporting back on its own", async () => {
		const test = await setup();
		const client = await connect(test.server);
		await greet(client);
		const projectId = await addProject(client, test.projectDir);
		await configure(client, projectId);

		const FIRST = "Read the first half of the README.";
		const SECOND = "Read the second half of the README.";
		const route = (request: TranscriptContext) => {
			const { role, text } = lastMessage(request);
			if (role === "toolResult") return fauxAssistantMessage("Tool call finished.");
			if (text === FIRST) return fauxAssistantMessage("## Report\nOutcome: done (first half)");
			if (text === SECOND) return fauxAssistantMessage("## Report\nOutcome: done (second half)");
			if (text.includes("reported]")) return fauxAssistantMessage("Report reviewed.");
			if (text.includes("Split the reading")) {
				// Two delegations in one round: nothing limits how many workers run at once.
				return fauxAssistantMessage(
					[
						fauxToolCall("worker_spawn", { id: "first", task: FIRST }, { id: "call-first" }),
						fauxToolCall("worker_spawn", { id: "second", task: SECOND }, { id: "call-second" }),
					],
					{ stopReason: "toolUse" },
				);
			}
			return fauxAssistantMessage("Nothing to do.");
		};
		test.faux.setResponses(Array.from({ length: 60 }, () => route));

		const view = new ViewClient(client);
		await view.start(projectId);
		await client.request({ type: "conversation.submit", projectId, requestId: "r1", content: "Split the reading." });
		await view.waitForView(
			(value) =>
				value.entries.some(
					(entry) => entry.kind === "pi.user" && entryText(entry).startsWith("[worker first reported]"),
				) &&
				value.entries.some(
					(entry) => entry.kind === "pi.user" && entryText(entry).startsWith("[worker second reported]"),
				),
		);
		const list = await listWorkers(client, projectId);
		expect(list.workers.map((worker) => worker.id)).toEqual(["first", "second"]);
		expect(list.workers.every((worker) => worker.spawnedByCallId !== null)).toBe(true);
		expect(new Set(list.workers.map((worker) => worker.conversationId)).size).toBe(2);
	});

	workerTest("tells the coordinator to delegate, and gives workers their own instructions without the worker tools", async () => {
		const test = await setup();
		const client = await connect(test.server);
		await greet(client);
		const projectId = await addProject(client, test.projectDir);
		await configure(client, projectId);

		const prompts: string[] = [];
		test.faux.setResponses(
			Array.from({ length: 40 }, () => (request: TranscriptContext) => {
				prompts.push(
					request.messages
						.filter((message) => message.role === "system")
						.map((message) => systemText(message))
						.join("\n"),
				);
				return scripted({}, request);
			}),
		);

		const view = new ViewClient(client);
		await view.start(projectId);
		await client.request({ type: "conversation.submit", projectId, requestId: "r1", content: "Delegate the reading." });
		await view.waitForView((value) => sawReport(value));

		const coordinatorPrompt = prompts.find((text) => text.includes("You coordinate the project"));
		expect(coordinatorPrompt).toBeTypeOf("string");
		expect(coordinatorPrompt).toContain("worker_spawn");
		expect(coordinatorPrompt).toContain("jj rebase");

		const workerPrompt = prompts.find((text) => text.includes('You are the worker "reader"'));
		expect(workerPrompt).toBeTypeOf("string");
		expect(workerPrompt).not.toContain("You coordinate the project");
		expect(workerPrompt).toContain("Otherwise, end your answer with this report");
	});

	workerTest("keeps working while the coordinator is aborted, then reports", async () => {
		const test = await setup();
		const client = await connect(test.server);
		await greet(client);
		const projectId = await addProject(client, test.projectDir);
		await configure(client, projectId);

		let release: () => void = () => undefined;
		const held = new Promise<void>((resolve) => {
			release = resolve;
		});
		test.faux.setResponses(
			Array.from({ length: 60 }, () => async (request: TranscriptContext) => {
				const { text } = lastMessage(request);
				if (text === BRIEF) {
					await held;
					return fauxAssistantMessage("## Report\nOutcome: done while the coordinator was idle");
				}
				return scripted({}, request);
			}),
		);

		const view = new ViewClient(client);
		await view.start(projectId);
		await client.request({ type: "conversation.submit", projectId, requestId: "r1", content: "Delegate the reading." });
		await until(async () => (await listWorkers(client, projectId)).workers[0]?.status === "running");

		// The coordinator's own work is idle; a conversation abort reaches its turns, never the worker.
		const aborted = await client.request({ type: "conversation.abort", projectId });
		expect(aborted.type).toBe("conversation.abort");
		expect((await listWorkers(client, projectId)).workers[0]?.status).toBe("running");

		release();
		await view.waitForView((value) => sawReport(value, "while the coordinator was idle"));
	});

	workerTest("sends a second message to a living worker, which remembers its conversation and takes a new title", async () => {
		const test = await setup();
		const client = await connect(test.server);
		await greet(client);
		const projectId = await addProject(client, test.projectDir);
		await configure(client, projectId);

		const SECOND = "And now the second half.";
		test.faux.setResponses(
			Array.from({ length: 60 }, () => (request: TranscriptContext) => {
				const { role, text } = lastMessage(request);
				if (role === "toolResult") return fauxAssistantMessage("Tool call finished.");
				if (text === BRIEF) return fauxAssistantMessage("## Report\nOutcome: done (first)");
				if (text === SECOND) return fauxAssistantMessage("## Report\nOutcome: done (second)");
				if (text.includes("Send it more work")) {
					return fauxAssistantMessage([fauxToolCall("worker_send", { id: "reader", message: SECOND, title: "Read the second half" })], {
						stopReason: "toolUse",
					});
				}
				if (text.includes("Delegate the reading")) {
					return fauxAssistantMessage([fauxToolCall("worker_spawn", { id: "reader", task: BRIEF })], {
						stopReason: "toolUse",
					});
				}
				return fauxAssistantMessage("Report reviewed.");
			}),
		);

		const view = new ViewClient(client);
		await view.start(projectId);
		await client.request({ type: "conversation.submit", projectId, requestId: "r1", content: "Delegate the reading." });
		await view.waitForView((value) => sawReport(value, "first"));
		const first = (await listWorkers(client, projectId)).workers[0]!;

		await client.request({ type: "conversation.submit", projectId, requestId: "r2", content: "Send it more work." });
		const retitled = await client.waitFor(
			(message) => message.type === "workers.state" && message.workers[0]?.title === "Read the second half",
		);
		expect(retitled.type).toBe("workers.state");
		await view.waitForView((value) => sawReport(value, "second"));

		const second = (await listWorkers(client, projectId)).workers[0]!;
		expect(second.conversationId).toBe(first.conversationId);
		expect(first.title).not.toBe("Read the second half");
		expect(second.title).toBe("Read the second half");

		const workerView = new ViewClient(client);
		await workerView.start(projectId, { workerId: "reader" });
		const texts = workerView.view!.entries.map(entryText);
		expect(texts).toContain(BRIEF);
		expect(texts).toContain(SECOND);
	});

	workerTest("does not let a worker start workers", async () => {
		const test = await setup();
		const client = await connect(test.server);
		await greet(client);
		const projectId = await addProject(client, test.projectDir);
		await configure(client, projectId);
		test.faux.setResponses(Array.from({ length: 40 }, () => script({ workerCallsWorker: true })));

		const workerList = () => listWorkers(client, projectId);
		const view = new ViewClient(client);
		await view.start(projectId);
		await client.request({ type: "conversation.submit", projectId, requestId: "r1", content: "Delegate the reading." });
		await until(async () => (await workerList()).workers.length === 1);

		const workerView = new ViewClient(client);
		await workerView.start(projectId, { workerId: "reader" });
		await workerView.waitForView((value) => toolResults(value).length > 0);
		const result = toolResults(workerView.view)[0]!;
		expect(entryText(result).toLowerCase()).toContain("worker_spawn");
		// Nothing was started: the extension that provides the tool is not selected in the worker.
		await until(async () => (await workerList()).workers[0]?.status === "idle");
		expect((await workerList()).workers).toHaveLength(1);
	});
});

describe("worker isolation", () => {
	workerTest("gives a worker its own jj workspace in the data directory and removes it on request", async () => {
		const test = await setup();
		const client = await connect(test.server);
		await greet(client);

		const repo = join(test.root, "repo");
		await mkdir(repo, { recursive: true });
		await writeFile(join(repo, "README.md"), "# repo\n");
		expect((await run(["jj", "git", "init"], repo)).code).toBe(0);
		expect((await run(["jj", "describe", "-m", "init"], repo)).code).toBe(0);
		expect((await run(["jj", "new"], repo)).code).toBe(0);

		const projectId = await addProject(client, repo);
		await configure(client, projectId);
		const manager = test.server.manager;
		const { runtime } = await manager.open(projectId);

		const path = await runtime.workers.createWorkspace("reader");
		expect(path.startsWith(join(test.dataDir, "projects", projectId, "workspaces"))).toBe(true);
		expect(path.startsWith(repo)).toBe(false);
		expect(await readdir(path)).toContain("README.md");
		expect((await run(["jj", "workspace", "list"], repo)).stdout).toContain("harness-reader");

		// Repeating it is harmless, so a rerun after a crash does not fail.
		expect(await runtime.workers.createWorkspace("reader")).toBe(path);

		await runtime.workers.removeWorkspace("reader", path);
		expect((await run(["jj", "workspace", "list"], repo)).stdout).not.toContain("harness-reader");
		expect(await readdir(path).catch(() => undefined)).toBeUndefined();

		// A project that is not a jj repository fails clearly instead of silently sharing the checkout.
		const plain = await addProject(client, test.projectDir);
		await configure(client, plain);
		const plainRuntime = await manager.open(plain);
		await expect(plainRuntime.runtime.workers.createWorkspace("reader")).rejects.toThrow(/jj repository/);
	});

	workerTest("runs an isolated worker in its workspace, then forgets it and removes the workspace", async () => {
		const test = await setup();
		const client = await connect(test.server);
		await greet(client);

		const repo = join(test.root, "repo");
		await mkdir(repo, { recursive: true });
		await writeFile(join(repo, "README.md"), "# repo\n");
		expect((await run(["jj", "git", "init"], repo)).code).toBe(0);
		expect((await run(["jj", "describe", "-m", "init"], repo)).code).toBe(0);
		expect((await run(["jj", "new"], repo)).code).toBe(0);

		const projectId = await addProject(client, repo);
		await configure(client, projectId);

		const WORKER_NOTE = "worker-note.txt";
		const route = (request: TranscriptContext) => {
			const { role, text } = lastMessage(request);
			const wroteFile = request.messages.some(
				(message) =>
					Array.isArray(message.content) &&
					(message.content as { type?: string; name?: string }[]).some(
						(block) => block.type === "toolCall" && block.name === "write",
					),
			);
			if (wroteFile && role === "toolResult") return fauxAssistantMessage("## Report\nOutcome: done, note written");
			if (role === "toolResult") return fauxAssistantMessage("Tool call finished.");
			if (text === BRIEF) {
				return fauxAssistantMessage([fauxToolCall("write", { path: WORKER_NOTE, content: "hello from the worker" })], {
					stopReason: "toolUse",
				});
			}
			if (text.includes("reported]")) return fauxAssistantMessage("Report reviewed.");
			if (text.includes("Isolate the work")) {
				return fauxAssistantMessage(
					[fauxToolCall("worker_spawn", { id: "reader", task: BRIEF, isolation: "workspace" })],
					{ stopReason: "toolUse" },
				);
			}
			if (text.includes("Forget the worker")) {
				return fauxAssistantMessage([fauxToolCall("worker_forget", { id: "reader" })], { stopReason: "toolUse" });
			}
			if (text.includes("Send it more work")) {
				return fauxAssistantMessage([fauxToolCall("worker_send", { id: "reader", message: "more" })], {
					stopReason: "toolUse",
				});
			}
			return fauxAssistantMessage("Nothing to do.");
		};
		test.faux.setResponses(Array.from({ length: 60 }, () => route));

		const view = new ViewClient(client);
		await view.start(projectId);
		await client.request({ type: "conversation.submit", projectId, requestId: "r1", content: "Isolate the work." });
		await view.waitForView((value) => sawReport(value, "note written"));

		const worker = (await listWorkers(client, projectId)).workers[0]!;
		expect(worker.isolation).toBe("workspace");
		const workspace = worker.workspacePath!;
		expect(workspace.startsWith(join(test.dataDir, "projects", projectId, "workspaces"))).toBe(true);
		// The worker's tools ran in its workspace, not in the project checkout.
		expect(await Bun.file(join(workspace, WORKER_NOTE)).text()).toBe("hello from the worker");
		expect(await Bun.file(join(repo, WORKER_NOTE)).exists()).toBe(false);

		// Forgetting it after the merge releases the workspace but keeps the worker as history.
		await client.request({ type: "conversation.submit", projectId, requestId: "r2", content: "Forget the worker." });
		const forgotten = await view.waitForView((value) =>
			value.entries.some((entry) => entry.kind === "pi.tool-result" && entryText(entry).includes("Forgot worker")),
		);
		expect(toolResults(forgotten).map(entryText).join("\n")).toContain("workspace");
		expect(await readdir(workspace).catch(() => undefined)).toBeUndefined();
		expect((await run(["jj", "workspace", "list"], repo)).stdout).not.toContain("harness-reader");
		const done = (await listWorkers(client, projectId)).workers[0]!;
		expect(done.status).toBe("done");
		expect(done.workspacePath).toBeNull();

		// A forgotten worker takes no more messages; the tool says so instead of failing silently.
		await client.request({ type: "conversation.submit", projectId, requestId: "r3", content: "Send it more work." });
		const refused = await view.waitForView((value) =>
			value.entries.some(
				(entry) => entry.kind === "pi.tool-result" && entryText(entry).includes("was forgotten after its work was merged"),
			),
		);
		expect(refused.entries.length).toBeGreaterThan(0);
	});

	workerTest("answers a workspace spawn in a project without jj with a clear error and starts nothing", async () => {
		const test = await setup();
		const client = await connect(test.server);
		await greet(client);
		const projectId = await addProject(client, test.projectDir);
		await configure(client, projectId);
		test.faux.setResponses(
			Array.from({ length: 40 }, () =>
				script({
					delegate: {
						text: "Isolate the work.",
						call: { id: "isolated", task: "Rewrite the README in its own workspace.", isolation: "workspace" },
					},
				}),
			),
		);

		const view = new ViewClient(client);
		await view.start(projectId);
		await client.request({ type: "conversation.submit", projectId, requestId: "r1", content: "Isolate the work." });
		const failed = await view.waitForView((value) => toolResults(value).length > 0);
		expect(entryText(toolResults(failed)[0]!)).toContain("Workspace isolation needs a jj repository");
		expect((await listWorkers(client, projectId)).workers).toEqual([]);
	});
});

describe("worker models", () => {
	workerTest("takes the model the user picked with a message over the project default, and errors without either", async () => {
		const other = fauxProvider({ provider: "other", models: [{ id: "other-1" }] });
		const test = await setup({ configureModels: (models) => models.setProvider(other.provider) });
		const client = await connect(test.server);
		await greet(client);
		const projectId = await addProject(client, test.projectDir);
		await configure(client, projectId, [OTHER]);
		other.setResponses(Array.from({ length: 40 }, () => fauxAssistantMessage("## Report\nOutcome: done")));
		test.faux.setResponses(Array.from({ length: 60 }, () => script()));

		const view = new ViewClient(client);
		await view.start(projectId);

		// Nobody picked a worker model, so the project's default answers.
		await client.request({ type: "conversation.submit", projectId, requestId: "r1", content: "Delegate the reading." });
		await view.waitForView((value) => sawReport(value));
		expect((await listWorkers(client, projectId)).workers[0]?.model).toEqual(OTHER);

		// A model picked with the message is remembered for the workers started from now on.
		const asked = await client.request({
			type: "conversation.submit",
			projectId,
			requestId: "r2",
			content: "Nothing to delegate now.",
			workerModel: FAUX,
			workerThinkingLevel: "high",
		});
		expect(asked.type).toBe("conversation.submit");
		await until(async () => (await listWorkers(client, projectId)).defaults.model?.modelId === FAUX.modelId);
		expect((await listWorkers(client, projectId)).defaults).toEqual({ model: FAUX, thinkingLevel: "high" });
	});

	workerTest("keeps the picked worker model across a restart and prefers the one the coordinator names", async () => {
		const other = fauxProvider({ provider: "other", models: [{ id: "other-1" }] });
		const test = await setup({ configureModels: (models) => models.setProvider(other.provider) });
		const client = await connect(test.server);
		await greet(client);
		const projectId = await addProject(client, test.projectDir);
		await configure(client, projectId, [OTHER]);

		const view = new ViewClient(client);
		await view.start(projectId);
		await client.request({
			type: "conversation.submit",
			projectId,
			requestId: "r1",
			content: "Hello.",
			workerModel: OTHER,
			workerThinkingLevel: "low",
		});
		await until(async () => (await listWorkers(client, projectId)).defaults.model !== null);

		const restarted = await test.restart();
		const next = await connect(restarted);
		await greet(next);
		expect((await listWorkers(next, projectId)).defaults).toEqual({ model: OTHER, thinkingLevel: "low" });

		// A model named in the delegate call beats the remembered one.
		test.faux.setResponses(
			Array.from({ length: 40 }, () =>
				script({
					delegate: {
						text: "Delegate with a model.",
						call: { id: "reader", task: BRIEF, model: FAUX, thinkingLevel: "max" },
					},
				}),
			),
		);
		const nextView = new ViewClient(next);
		await nextView.start(projectId);
		await next.request({ type: "conversation.submit", projectId, requestId: "r2", content: "Delegate with a model." });
		await until(async () => (await listWorkers(next, projectId)).workers.length > 0);
		const worker = (await listWorkers(next, projectId)).workers[0]!;
		expect(worker.model).toEqual(FAUX);
		expect(worker.thinkingLevel).toBe("max");
	});

	workerTest("stores a thinking level per default worker model, keeps it across a restart and uses it", async () => {
		const test = await setup();
		const client = await connect(test.server);
		await greet(client);
		const projectId = await addProject(client, test.projectDir);
		await configure(client, projectId, [{ ...FAUX, thinkingLevel: "medium" }]);

		// The level is part of project.json, not just of the answer.
		const file = join(test.dataDir, "projects", projectId, "project.json");
		expect(JSON.parse(await readFile(file, "utf8")).workerModels).toEqual([
			{ provider: FAUX.provider, modelId: FAUX.modelId, thinkingLevel: "medium" },
		]);

		// And a restart still lists it.
		const restarted = await test.restart();
		const next = await connect(restarted);
		await greet(next);
		const listed = await next.request({ type: "projects.list" });
		if (listed.type !== "projects.list") throw new Error(JSON.stringify(listed));
		expect(listed.projects[0]?.workerModels).toEqual([
			{ provider: FAUX.provider, modelId: FAUX.modelId, thinkingLevel: "medium" },
		]);

		test.faux.setResponses(Array.from({ length: 60 }, () => script()));
		const view = new ViewClient(next);
		await view.start(projectId);
		await next.request({ type: "conversation.submit", projectId, requestId: "r1", content: "Delegate the reading." });
		await view.waitForView((value) => sawReport(value));
		expect((await listWorkers(next, projectId)).workers[0]?.thinkingLevel).toBe("medium");
		await until(async () => (await listWorkers(next, projectId)).workers[0]?.status === "idle");

		// A model the coordinator names without a level takes the level stored with that model.
		test.faux.setResponses(
			Array.from({ length: 60 }, () =>
				script({
					delegate: {
						text: "Name the project's model.",
						call: { id: "reader2", task: BRIEF, title: "Read it again", model: FAUX },
					},
				}),
			),
		);
		await next.request({
			type: "conversation.submit",
			projectId,
			requestId: "r2",
			content: "Name the project's model.",
		});
		await until(async () => (await listWorkers(next, projectId)).workers.length === 2);
		const named = (await listWorkers(next, projectId)).workers.find((worker) => worker.id === "reader2");
		expect(named?.model).toEqual(FAUX);
		expect(named?.thinkingLevel).toBe("medium");
	});

	workerTest("reads a project.json written before worker models had thinking levels", async () => {
		const test = await setup();
		const client = await connect(test.server);
		await greet(client);
		const projectId = await addProject(client, test.projectDir);
		await configure(client, projectId, [{ ...FAUX, thinkingLevel: "high" }]);

		// What an older server (or an older client's save) left behind: the same list, without the field.
		const file = join(test.dataDir, "projects", projectId, "project.json");
		const stored = JSON.parse(await readFile(file, "utf8"));
		await writeFile(file, JSON.stringify({ ...stored, workerModels: [FAUX] }));
		const restarted = await test.restart();
		const next = await connect(restarted);
		await greet(next);
		const listed = await next.request({ type: "projects.list" });
		if (listed.type !== "projects.list") throw new Error(JSON.stringify(listed));
		expect(listed.projects[0]?.workerModels).toEqual([FAUX]);

		// With no level stored anywhere, the model's own default applies.
		test.faux.setResponses(Array.from({ length: 40 }, () => script()));
		const view = new ViewClient(next);
		await view.start(projectId);
		await next.request({ type: "conversation.submit", projectId, requestId: "r1", content: "Delegate the reading." });
		await until(async () => (await listWorkers(next, projectId)).workers.length > 0);
		expect((await listWorkers(next, projectId)).workers[0]?.thinkingLevel).toBeNull();
	});

	workerTest("refuses to start a worker when no model resolves", async () => {
		const test = await setup();
		const client = await connect(test.server);
		await greet(client);
		const projectId = await addProject(client, test.projectDir);
		await configure(client, projectId, []);
		test.faux.setResponses(Array.from({ length: 40 }, () => script()));

		const view = new ViewClient(client);
		await view.start(projectId);
		await client.request({ type: "conversation.submit", projectId, requestId: "r1", content: "Delegate the reading." });
		const failed = await view.waitForView((value) => toolResults(value).length > 0);
		expect(entryText(toolResults(failed)[0]!)).toContain("No worker model is set");
		expect((await listWorkers(client, projectId)).workers).toEqual([]);
	});
});

describe("worker defaults without a message", () => {
	workerTest("sets the model and thinking level, pushes workers.state and is used by the next worker", async () => {
		const other = fauxProvider({ provider: "other", models: [{ id: "other-1" }] });
		const test = await setup({ configureModels: (models) => models.setProvider(other.provider) });
		const client = await connect(test.server);
		const watcher = await connect(test.server);
		await greet(client);
		await greet(watcher);
		const projectId = await addProject(client, test.projectDir);
		// No project default, so the value set here is the only one a worker can resolve.
		await configure(client, projectId, []);

		const response = await client.request({
			type: "workers.defaults.set",
			projectId,
			defaults: { model: OTHER, thinkingLevel: "high" },
		});
		if (response.type !== "workers.defaults.set") throw new Error(JSON.stringify(response));
		expect(response.defaults).toEqual({ model: OTHER, thinkingLevel: "high" });
		expect((await listWorkers(client, projectId)).defaults).toEqual({ model: OTHER, thinkingLevel: "high" });

		// Every connection is told through workers.state, not just the one that asked.
		for (const each of [client, watcher]) {
			const pushed = await each.waitFor(
				(message) =>
					message.type === "workers.state" &&
					message.projectId === projectId &&
					message.defaults.model?.modelId === OTHER.modelId,
			);
			expect(pushed.type).toBe("workers.state");
		}

		// A worker started without a model of its own now uses it, exactly as if it had been picked with a message.
		other.setResponses(Array.from({ length: 40 }, () => fauxAssistantMessage("## Report\nOutcome: done")));
		test.faux.setResponses(Array.from({ length: 40 }, () => script()));
		await client.request({ type: "conversation.submit", projectId, requestId: "r1", content: "Delegate the reading." });
		await until(async () => (await listWorkers(client, projectId)).workers.length > 0);
		const worker = (await listWorkers(client, projectId)).workers[0]!;
		expect(worker.model).toEqual(OTHER);
		expect(worker.thinkingLevel).toBe("high");
	});

	workerTest("clears a default with null and refuses an unknown model", async () => {
		const test = await setup();
		const client = await connect(test.server);
		await greet(client);
		const projectId = await addProject(client, test.projectDir);
		await configure(client, projectId);

		const set = await client.request({
			type: "workers.defaults.set",
			projectId,
			defaults: { model: FAUX, thinkingLevel: "low" },
		});
		expect(set.type).toBe("workers.defaults.set");

		const reset = await client.request({
			type: "workers.defaults.set",
			projectId,
			defaults: { model: null, thinkingLevel: null },
		});
		if (reset.type !== "workers.defaults.set") throw new Error(JSON.stringify(reset));
		expect(reset.defaults).toEqual({ model: null, thinkingLevel: null });

		const unknown = await client.request({
			type: "workers.defaults.set",
			projectId,
			defaults: { model: { provider: "nope", modelId: "nope-1" }, thinkingLevel: null },
		});
		expect(errorOf(unknown).code).toBe("unknown_model");
		// A refused change leaves the stored defaults alone.
		expect((await listWorkers(client, projectId)).defaults).toEqual({ model: null, thinkingLevel: null });
	});
});

describe("worker restarts", () => {
	workerTest("reports an answer that arrives after the server restarted", async () => {
		const test = await setup();
		const client = await connect(test.server);
		await greet(client);
		const projectId = await addProject(client, test.projectDir);
		await configure(client, projectId);

		let release: () => void = () => undefined;
		const held = new Promise<void>((resolve) => {
			release = resolve;
		});
		let asked = 0;
		test.faux.setResponses(
			Array.from({ length: 60 }, () => async (request: TranscriptContext, options: { signal?: AbortSignal } | undefined) => {
				const { role, text } = lastMessage(request);
				if (role === "toolResult") return fauxAssistantMessage("Tool call finished.");
				if (text === BRIEF) {
					asked += 1;
					if (asked === 1) {
						// The first attempt is cut off by the restart: it waits until the caller closes, so the process can stop.
						await new Promise<void>((resolve) => {
							options?.signal?.addEventListener("abort", () => resolve(), { once: true });
							held.then(resolve);
						});
						return fauxAssistantMessage("interrupted");
					}
					return fauxAssistantMessage("## Report\nOutcome: done after the restart");
				}
				if (text.includes("reported]")) return fauxAssistantMessage("Report reviewed.");
				if (text.includes("Delegate the reading")) {
					return fauxAssistantMessage([fauxToolCall("worker_spawn", { id: "reader", task: BRIEF })], {
						stopReason: "toolUse",
					});
				}
				return fauxAssistantMessage("Nothing to do.");
			}),
		);

		const view = new ViewClient(client);
		await view.start(projectId);
		await client.request({ type: "conversation.submit", projectId, requestId: "r1", content: "Delegate the reading." });
		await until(async () => (await listWorkers(client, projectId)).workers.length === 1);
		await until(async () => asked > 0);

		// The process dies while the worker is working; its report still arrives afterwards.
		const restarted = await test.restart();
		release();
		const next = await connect(restarted);
		await greet(next);
		const nextView = new ViewClient(next);
		await nextView.start(projectId);
		await nextView.waitForView((value) => sawReport(value, "after the restart"), 30_000);
		const list = await listWorkers(next, projectId);
		expect(list.workers).toHaveLength(1);
		expect(list.workers[0]?.status).toBe("idle");
	});
});

/** A clock a test moves by hand: the Harness reads it and arms its timers from it, and nothing fires on its own. */
function fakeClock(start = Date.UTC(2026, 9, 30, 12, 0, 0)): {
	now(): number;
	setTimer: SetTimer;
	advance(ms: number): void;
} {
	let now = start;
	return {
		now: () => now,
		setTimer: ((callback: () => void, delayMs: number) => {
			// A test wakes due sleeps itself, with `advance()` then `resume()` on the project's Harness.
			void callback;
			void delayMs;
			return () => undefined;
		}) as SetTimer,
		advance(ms: number): void {
			now += ms;
		},
	};
}

/**
 * Wait until the test releases the gate, or until the caller aborts the request (a stop, a restart or a close), so
 * the worker keeps working while the test looks at it.
 */
function holdUntil(held: Promise<void>, options: { signal?: AbortSignal } | undefined): Promise<void> {
	return new Promise<void>((resolve) => {
		options?.signal?.addEventListener("abort", () => resolve(), { once: true });
		held.then(() => resolve());
	});
}

type RouteOptions = { signal?: AbortSignal } | undefined;

function deferredGate(): { promise: Promise<void>; release(): void } {
	let release: () => void = () => undefined;
	const promise = new Promise<void>((resolve) => {
		release = resolve;
	});
	return { promise, release };
}

function hasToolCall(request: TranscriptContext, name: string): boolean {
	return request.messages.some(
		(message) =>
			Array.isArray(message.content) &&
			(message.content as { type?: string; name?: string }[]).some(
				(block) => block.type === "toolCall" && block.name === name,
			),
	);
}

function checkInEntries(view: ConversationView | undefined): ConversationView["entries"] {
	return view?.entries.filter((entry) => entry.kind === "pi.user" && entryText(entry).startsWith("[check-in]")) ?? [];
}

/** Wake the project's Harness the way a host does after its alarm: due sleeps become runnable. */
async function resume(test: TestSetup, projectId: string): Promise<void> {
	const { runtime } = await test.server.manager.open(projectId);
	runtime.harness.resume();
}

describe("worker peek", () => {
	workerTest("shows a running worker's status, staleness and recent tool calls without waiting for its report", async () => {
		const test = await setup();
		const client = await connect(test.server);
		await greet(client);
		const projectId = await addProject(client, test.projectDir);
		await configure(client, projectId);

		const gate = deferredGate();
		const route = async (request: TranscriptContext, options: RouteOptions) => {
			const { role, text } = lastMessage(request);
			// The worker called `read` and is still working; its answer waits.
			if (hasToolCall(request, "read") && role === "toolResult") {
				await holdUntil(gate.promise, options);
				return fauxAssistantMessage("## Report\nOutcome: done");
			}
			if (role === "toolResult") return fauxAssistantMessage("Tool call finished.");
			if (text === BRIEF) {
				return fauxAssistantMessage([fauxToolCall("read", { path: "README.md" })], { stopReason: "toolUse" });
			}
			if (text.includes("How is the reader doing?")) {
				return fauxAssistantMessage([fauxToolCall("worker_peek", { id: "reader" })], { stopReason: "toolUse" });
			}
			if (text.includes("Peek at nobody")) {
				return fauxAssistantMessage([fauxToolCall("worker_peek", { id: "nobody" })], { stopReason: "toolUse" });
			}
			if (text.includes("Delegate the reading")) {
				return fauxAssistantMessage([fauxToolCall("worker_spawn", { id: "reader", task: BRIEF })], {
					stopReason: "toolUse",
				});
			}
			return fauxAssistantMessage("Report reviewed.");
		};
		test.faux.setResponses(Array.from({ length: 40 }, () => route));

		const view = new ViewClient(client);
		await view.start(projectId);
		await client.request({ type: "conversation.submit", projectId, requestId: "r1", content: "Delegate the reading." });
		await until(async () => toolResults(view.view).length >= 1);
		await until(async () => (await listWorkers(client, projectId)).workers[0]?.status === "running");

		await client.request({ type: "conversation.submit", projectId, requestId: "r2", content: "How is the reader doing?" });
		const peeked = await view.waitForView((value) =>
			toolResults(value).some((entry) => entryText(entry).includes("reader —")),
		);
		const digest = entryText(toolResults(peeked).find((entry) => entryText(entry).includes("reader —"))!);
		expect(digest).toContain("status: running, a run is in progress");
		expect(digest).toContain("last activity");
		expect(digest).toContain("call read ");
		expect(digest).toContain("README.md");
		expect(digest).toContain("you: Summarize the project's README");
		expect(digest).not.toContain("Outcome: done");

		// An unknown worker is an ordinary tool error, not a failed run.
		await client.request({ type: "conversation.submit", projectId, requestId: "r3", content: "Peek at nobody." });
		const refused = await view.waitForView((value) =>
			toolResults(value).some((entry) => entryText(entry).includes('No worker named "nobody"')),
		);
		expect(refused.entries.length).toBeGreaterThan(0);
		gate.release();
	});

	workerTest("peeks at an idle worker with its last report", async () => {
		const test = await setup();
		const client = await connect(test.server);
		await greet(client);
		const projectId = await addProject(client, test.projectDir);
		await configure(client, projectId);
		const route = script();
		test.faux.setResponses(
			Array.from({ length: 40 }, () => (request: TranscriptContext) => {
				const { text } = lastMessage(request);
				if (text.includes("What did the reader find?")) {
					return fauxAssistantMessage([fauxToolCall("worker_peek", { id: "reader" })], { stopReason: "toolUse" });
				}
				return route(request, undefined, { callCount: 0, deferredFetchCount: 0, cancelledDeferred: [] }, {} as never) as ReturnType<
					typeof fauxAssistantMessage
				>;
			}),
		);
		const view = new ViewClient(client);
		await view.start(projectId);
		await client.request({ type: "conversation.submit", projectId, requestId: "r1", content: "Delegate the reading." });
		await view.waitForView((value) => sawReport(value));
		await until(async () => (await listWorkers(client, projectId)).workers[0]?.status === "idle");

		await client.request({ type: "conversation.submit", projectId, requestId: "r2", content: "What did the reader find?" });
		const peeked = await view.waitForView((value) =>
			toolResults(value).some((entry) => entryText(entry).includes("last report:")),
		);
		const digest = entryText(toolResults(peeked).find((entry) => entryText(entry).includes("last report:"))!);
		expect(digest).toContain("status: idle, waiting for the next message");
		expect(digest).toContain("last report: ## Report Outcome: done");
		expect(digest).toContain("activity:");
	});
});

describe("worker check-ins", () => {
	workerTest("wakes the coordinator every interval while a worker runs, and stops when none does", async () => {
		const clock = fakeClock();
		// A nearly full disk: main's check-ins say so in one line.
		const disks = { read: async () => ({ device: 1, freeBytes: 1024 ** 3, totalBytes: 100 * 1024 ** 3 }), intervalMs: 60_000 };
		const test = await setup({ now: clock.now, setTimer: clock.setTimer, disks });
		const client = await connect(test.server);
		await greet(client);
		const projectId = await addProject(client, test.projectDir);
		await configure(client, projectId);
		const configured = await client.request({
			type: "projects.configure",
			projectId,
			checkIns: { enabled: true, intervalMinutes: 1 },
		});
		expect(configured.type).toBe("projects.configure");
		if (configured.type === "projects.configure") {
			expect(configured.project.checkIns).toEqual({ enabled: true, intervalMinutes: 1 });
		}

		const gate = deferredGate();
		const route = async (request: TranscriptContext, options: RouteOptions) => {
			const { role, text } = lastMessage(request);
			if (text.startsWith("[check-in]")) return fauxAssistantMessage("All good.");
			if (hasToolCall(request, "read") && role === "toolResult") {
				await holdUntil(gate.promise, options);
				return fauxAssistantMessage("## Report\nOutcome: done");
			}
			if (role === "toolResult") return fauxAssistantMessage("Tool call finished.");
			if (text === BRIEF) {
				return fauxAssistantMessage([fauxToolCall("read", { path: "README.md" })], { stopReason: "toolUse" });
			}
			if (text.includes("Delegate the reading")) {
				return fauxAssistantMessage([fauxToolCall("worker_spawn", { id: "reader", task: BRIEF })], {
					stopReason: "toolUse",
				});
			}
			return fauxAssistantMessage("Report reviewed.");
		};
		test.faux.setResponses(Array.from({ length: 60 }, () => route));

		const view = new ViewClient(client);
		await view.start(projectId);
		await client.request({ type: "conversation.submit", projectId, requestId: "r1", content: "Delegate the reading." });
		await until(async () => (await listWorkers(client, projectId)).workers[0]?.status === "running");

		// Nothing before the interval is up.
		clock.advance(30_000);
		await resume(test, projectId);
		await new Promise((resolve) => setTimeout(resolve, 100));
		expect(checkInEntries(view.view)).toHaveLength(0);

		// One check-in when it is due, carrying the running worker's digest.
		clock.advance(30_000);
		await resume(test, projectId);
		const first = await view.waitForView((value) => checkInEntries(value).length === 1);
		const text = entryText(checkInEntries(first)[0]!);
		expect(text).toContain("[check-in]");
		expect(text).toContain("1 worker is still running");
		expect(text).toContain("reader —");
		expect(text).toContain("status: running");
		expect(text).toContain("worker_stop");
		expect(text).toContain("Weigh what the remaining work would still add against what is already achieved.");
		expect(text).toContain("Disk low: Data");

		// Resuming again at the same time does not repeat it.
		await resume(test, projectId);
		await new Promise((resolve) => setTimeout(resolve, 100));
		expect(checkInEntries(view.view)).toHaveLength(1);

		// The next interval brings the next one, once.
		clock.advance(60_000);
		await resume(test, projectId);
		await view.waitForView((value) => checkInEntries(value).length === 2);

		// The worker answers; with nothing running, the next interval passes silently.
		gate.release();
		await view.waitForView((value) => sawReport(value));
		await until(async () => (await listWorkers(client, projectId)).workers[0]?.status === "idle");
		clock.advance(120_000);
		await resume(test, projectId);
		await new Promise((resolve) => setTimeout(resolve, 200));
		expect(checkInEntries(view.view)).toHaveLength(2);
	});

	workerTest("queues a check-in behind a coordinator run instead of interrupting it", async () => {
		const clock = fakeClock();
		const test = await setup({ now: clock.now, setTimer: clock.setTimer });
		const client = await connect(test.server);
		await greet(client);
		const projectId = await addProject(client, test.projectDir);
		await configure(client, projectId);
		await client.request({
			type: "projects.configure",
			projectId,
			checkIns: { enabled: true, intervalMinutes: 1 },
		});

		const workerGate = deferredGate();
		const coordinatorGate = deferredGate();
		const route = async (request: TranscriptContext, options: RouteOptions) => {
			const { role, text } = lastMessage(request);
			if (text.startsWith("[check-in]")) return fauxAssistantMessage("All good.");
			if (hasToolCall(request, "read") && role === "toolResult") {
				await holdUntil(workerGate.promise, options);
				return fauxAssistantMessage("## Report\nOutcome: done");
			}
			if (role === "toolResult") return fauxAssistantMessage("Tool call finished.");
			if (text === BRIEF) {
				return fauxAssistantMessage([fauxToolCall("read", { path: "README.md" })], { stopReason: "toolUse" });
			}
			if (text.includes("Think about the plan")) {
				await holdUntil(coordinatorGate.promise, options);
				return fauxAssistantMessage("Thought about it.");
			}
			if (text.includes("Delegate the reading")) {
				return fauxAssistantMessage([fauxToolCall("worker_spawn", { id: "reader", task: BRIEF })], {
					stopReason: "toolUse",
				});
			}
			return fauxAssistantMessage("Report reviewed.");
		};
		test.faux.setResponses(Array.from({ length: 60 }, () => route));

		const view = new ViewClient(client);
		await view.start(projectId);
		await client.request({ type: "conversation.submit", projectId, requestId: "r1", content: "Delegate the reading." });
		await until(async () => (await listWorkers(client, projectId)).workers[0]?.status === "running");

		// The coordinator is busy with its own run when the check-in comes due.
		await client.request({ type: "conversation.submit", projectId, requestId: "r2", content: "Think about the plan." });
		await until(async () => (view.view?.docs["pi.live"] as { run?: unknown } | undefined)?.run !== undefined);
		clock.advance(60_000);
		await resume(test, projectId);
		await new Promise((resolve) => setTimeout(resolve, 200));

		// The run was not interrupted: the check-in waits in the inbox.
		expect(checkInEntries(view.view)).toHaveLength(0);
		const inbox = view.view?.docs["pi.inbox"] as { items: { content?: unknown }[] } | undefined;
		expect(
			(inbox?.items ?? []).some((item) => entryText({ model: [{ content: item.content }] } as never).startsWith("[check-in]")),
		).toBe(true);

		// It is handled at the next turn boundary.
		coordinatorGate.release();
		await view.waitForView((value) => checkInEntries(value).length === 1);
		workerGate.release();
	});

	workerTest("does not run check-ins when the project turns them off", async () => {
		const clock = fakeClock();
		const test = await setup({ now: clock.now, setTimer: clock.setTimer });
		const client = await connect(test.server);
		await greet(client);
		const projectId = await addProject(client, test.projectDir);
		await configure(client, projectId);
		await client.request({
			type: "projects.configure",
			projectId,
			checkIns: { enabled: false, intervalMinutes: 1 },
		});

		const gate = deferredGate();
		const route = async (request: TranscriptContext, options: RouteOptions) => {
			const { role, text } = lastMessage(request);
			if (text.startsWith("[check-in]")) return fauxAssistantMessage("All good.");
			if (hasToolCall(request, "read") && role === "toolResult") {
				await holdUntil(gate.promise, options);
				return fauxAssistantMessage("## Report\nOutcome: done");
			}
			if (role === "toolResult") return fauxAssistantMessage("Tool call finished.");
			if (text === BRIEF) {
				return fauxAssistantMessage([fauxToolCall("read", { path: "README.md" })], { stopReason: "toolUse" });
			}
			if (text.includes("Delegate the reading")) {
				return fauxAssistantMessage([fauxToolCall("worker_spawn", { id: "reader", task: BRIEF })], {
					stopReason: "toolUse",
				});
			}
			return fauxAssistantMessage("Report reviewed.");
		};
		test.faux.setResponses(Array.from({ length: 40 }, () => route));

		const view = new ViewClient(client);
		await view.start(projectId);
		await client.request({ type: "conversation.submit", projectId, requestId: "r1", content: "Delegate the reading." });
		await until(async () => (await listWorkers(client, projectId)).workers[0]?.status === "running");
		clock.advance(5 * 60_000);
		await resume(test, projectId);
		await new Promise((resolve) => setTimeout(resolve, 200));
		expect(checkInEntries(view.view)).toHaveLength(0);
		gate.release();
	});
});

describe("check-in timers across restarts", () => {
	workerTest("keeps the timer across a restart and sends one check-in per interval, never a duplicate", async () => {
		const clock = fakeClock();
		const test = await setup({ now: clock.now, setTimer: clock.setTimer });
		const client = await connect(test.server);
		await greet(client);
		const projectId = await addProject(client, test.projectDir);
		await configure(client, projectId);
		await client.request({
			type: "projects.configure",
			projectId,
			checkIns: { enabled: true, intervalMinutes: 1 },
		});

		const gate = deferredGate();
		const route = async (request: TranscriptContext, options: RouteOptions) => {
			const { role, text } = lastMessage(request);
			if (text.startsWith("[check-in]")) return fauxAssistantMessage("All good.");
			if (hasToolCall(request, "read") && role === "toolResult") {
				await holdUntil(gate.promise, options);
				return fauxAssistantMessage("## Report\nOutcome: done");
			}
			if (role === "toolResult") return fauxAssistantMessage("Tool call finished.");
			if (text === BRIEF) {
				return fauxAssistantMessage([fauxToolCall("read", { path: "README.md" })], { stopReason: "toolUse" });
			}
			if (text.includes("Delegate the reading")) {
				return fauxAssistantMessage([fauxToolCall("worker_spawn", { id: "reader", task: BRIEF })], {
					stopReason: "toolUse",
				});
			}
			return fauxAssistantMessage("Report reviewed.");
		};
		test.faux.setResponses(Array.from({ length: 60 }, () => route));

		const view = new ViewClient(client);
		await view.start(projectId);
		await client.request({ type: "conversation.submit", projectId, requestId: "r1", content: "Delegate the reading." });
		await until(async () => (await listWorkers(client, projectId)).workers[0]?.status === "running");
		clock.advance(60_000);
		await resume(test, projectId);
		await view.waitForView((value) => checkInEntries(value).length === 1);

		// A restart does not replay the check-in that already arrived.
		const restarted = await test.restart();
		const next = await connect(restarted);
		await greet(next);
		await resume(test, projectId);
		await new Promise((resolve) => setTimeout(resolve, 200));
		const nextView = new ViewClient(next);
		await nextView.start(projectId);
		await nextView.waitForView((value) => checkInEntries(value).length === 1);
		expect(checkInEntries(nextView.view)).toHaveLength(1);

		// The timer survives the restart: the next interval brings exactly one more.
		clock.advance(60_000);
		await resume(test, projectId);
		await nextView.waitForView((value) => checkInEntries(value).length === 2);
		expect(checkInEntries(nextView.view)).toHaveLength(2);
		gate.release();
	});
});

describe("quiet worker reports", () => {
	async function scenario(options: { held?: boolean; toolBoundary?: boolean; toolBoundaries?: number; answer?: string; changedAnswer?: boolean } = {}) {
		const test = await setup();
		const client = await connect(test.server);
		await greet(client);
		const projectId = await addProject(client, test.projectDir);
		await configure(client, projectId);
		const gate = deferredGate();
		let workerRequests = 0;
		let workerAnswers = 0;
		let reportTurns = 0;
		let reportNotifications = 0;
		let aborted = false;
		const { runtime } = await test.server.manager.open(projectId);
		const { conversation } = runtime;
		await runtime.harness.commit(async (tx) => {
			const board = await openBoard(tx, conversation.id);
			saveTask(board, { task: { title: "Read the README", description: "", acceptance: null, status: "todo", blockedBy: [], blockedReason: null, writeScopes: [] }, author: "coordinator", now: new Date().toISOString() });
		}, BACKGROUND_CONTEXT);
		const busyGate = deferredGate();
		let busyRequests = 0;
		runtime.workers.notifyWorkerReport = () => { reportNotifications++; };
		const route = async (request: TranscriptContext, opts: RouteOptions) => {
			const { role, text } = lastMessage(request);
			const worker = request.messages.some((m) => m.role === "system" && systemText(m).includes('You are the worker "reader"'));
			if (worker) {
				workerRequests++;
				if (workerRequests === 1 && options.held) {
					opts?.signal?.addEventListener("abort", () => { aborted = true; }, { once: true });
					await holdUntil(gate.promise, opts);
				}
				if (workerRequests <= (options.toolBoundaries ?? (options.toolBoundary ? 1 : 0))) {
					return fauxAssistantMessage([fauxToolCall("read", { path: "README.md" })], { stopReason: "toolUse" });
				}
				workerAnswers++;
				return fauxAssistantMessage(options.answer ?? (options.changedAnswer ? `The work is done (${workerRequests}).` : "The work is done."));
			}
			if (role === "toolResult") return fauxAssistantMessage("Tool finished.");
			if (text.startsWith("[worker reader")) { reportTurns++; return fauxAssistantMessage("Reviewed."); }
			if (text === "Busy") {
				busyRequests++;
				await holdUntil(busyGate.promise, opts);
				return fauxAssistantMessage([fauxToolCall("read", { path: "README.md" })], { stopReason: "toolUse" });
			}
			if (text === "Spawn") return fauxAssistantMessage([fauxToolCall("worker_spawn", { id: "reader", task: BRIEF, taskId: "T1" })], { stopReason: "toolUse" });
			if (text === "Forget") return fauxAssistantMessage([fauxToolCall("worker_forget", { id: "reader", removeWorkspace: false })], { stopReason: "toolUse" });
			if (text === "Queue" || text === "Amend") return fauxAssistantMessage([fauxToolCall("worker_send", { id: "reader", message: "Covered request", interrupt: text === "Amend" })], { stopReason: "toolUse" });
			return fauxAssistantMessage("Idle.");
		};
		test.faux.setResponses(Array.from({ length: 100 }, () => route));
		const view = new ViewClient(client);
		await view.start(projectId);
		let sequence = 0;
		const send = async (content: string) => {
			await client.request({ type: "conversation.submit", projectId, requestId: `quiet-${++sequence}`, content });
			await until(async () => {
				const { runtime } = await test.server.manager.open(projectId);
				const { conversation } = runtime;
				await conversation.waitForIdle(BACKGROUND_CONTEXT);
				return !(await runtime.harness.inspect(BACKGROUND_CONTEXT)).tasks.some((t) => t.record.kind === "pi.tool" && !t.record.background);
			});
		};
		await send("Spawn");
		await until(async () => workerRequests > 0);
		const worker = (await listWorkers(client, projectId)).workers[0]!;
		const reports = () => view.view!.entries.filter((e) => entryText(e).startsWith("[worker reader reported]"));
		const settle = async (count: number) => {
			await view.waitForView(() => reports().length === count);
			await until(async () => !(await runtime.harness.inspect(BACKGROUND_CONTEXT)).tasks.some((t) => t.record.kind === "aiki.worker-reporter" && t.record.state.status !== "terminal"));
			await conversation.waitForIdle(BACKGROUND_CONTEXT);
		};
		const timeline = async (reader = client) => {
			const history = await reader.request({ type: "board.task.timeline", projectId, taskId: "T1" });
			if (history.type !== "board.task.timeline") throw errorOf(history);
			return history.entries.filter((event) => event.label === "Worker reader reported");
		};
		return { test, client, projectId, view, runtime, conversation, worker, send, gate, busyGate, reports, settle, timeline, counts: () => ({ workerRequests, workerAnswers, reportTurns, reportNotifications, aborted, busyRequests }) };
	}

	workerTest("records identical answers without starting a second coordinator turn, including after restart", async () => {
		const s = await scenario();
		await s.settle(1);
		expect(s.counts().reportTurns).toBe(1);
		await s.send("Queue");
		await s.settle(2);
		expect(s.counts().workerRequests).toBe(2);
		expect(s.counts().reportTurns).toBe(1);
		expect(s.counts().reportNotifications).toBe(1);
		const restarted = await s.test.restart();
		const client = await connect(restarted);
		await greet(client);
		await client.request({ type: "conversation.submit", projectId: s.projectId, requestId: "quiet-restarted", content: "Queue" });
		const view = new ViewClient(client);
		await view.start(s.projectId);
		await view.waitForView((v) => v.entries.filter((e) => entryText(e).startsWith("[worker reader reported]")).length === 3);
		const { runtime } = await restarted.manager.open(s.projectId);
		const { conversation } = runtime;
		await until(async () => !(await runtime.harness.inspect(BACKGROUND_CONTEXT)).tasks.some((t) => t.record.kind === "aiki.worker-reporter" && t.record.state.status !== "terminal"));
		await conversation.waitForIdle(BACKGROUND_CONTEXT);
		expect(s.counts().reportTurns).toBe(1);
	});

	workerTest("first and worker_send reports each have one message and one timeline entry", async () => {
		const s = await scenario({ changedAnswer: true });
		await s.settle(1);
		expect(s.reports()).toHaveLength(1);
		expect(await s.timeline()).toHaveLength(1);
		await s.send("Queue");
		await s.settle(2);
		expect(s.reports()).toHaveLength(2);
		expect(await s.timeline()).toHaveLength(2);
		expect(s.counts().reportTurns).toBe(2);
	});

	for (const amended of [false, true]) for (const restart of [false, true]) workerTest(`queues one report ${amended ? "from the initial task plus two interrupts " : ""}while the coordinator is busy${restart ? " across restart" : ""}`, async () => {
		const s = await scenario({ held: true, toolBoundaries: amended ? 2 : 0 });
		if (amended) {
			await s.send("Amend");
			await s.send("Amend");
			await until(async () => (await s.runtime.harness.snapshot(InboxDoc, s.worker.conversationId as never, BACKGROUND_CONTEXT))!.items.length === 2);
		}
		await s.client.request({ type: "conversation.submit", projectId: s.projectId, requestId: "busy", content: "Busy" });
		await until(async () => s.counts().busyRequests > 0);
		s.gate.release();
		await until(async () => (await s.runtime.harness.snapshot(InboxDoc, s.conversation.id, BACKGROUND_CONTEXT))!.items.length > 0);
		const inbox = (await s.runtime.harness.snapshot(InboxDoc, s.conversation.id, BACKGROUND_CONTEXT))!;
		expect(inbox.items).toHaveLength(1);
		// Reports deliberately follow up. A real user steer can arrive before the same next boundary.
		await s.client.request({ type: "conversation.submit", projectId: s.projectId, requestId: "busy-steer", content: "Keep working", whenBusy: "steer" });
		expect((await s.runtime.harness.snapshot(InboxDoc, s.conversation.id, BACKGROUND_CONTEXT))!.items.some((item) => item.mode === "steer")).toBe(true);
		expect(s.counts().reportTurns).toBe(0);
		expect(await s.timeline()).toHaveLength(1);
		if (restart) {
			const server = await s.test.restart();
			const client = await connect(server);
			await greet(client);
			const view = new ViewClient(client);
			await view.start(s.projectId);
			s.busyGate.release();
			const { runtime } = await server.manager.open(s.projectId);
			await runtime.conversation.waitForIdle(BACKGROUND_CONTEXT);
			const finished = await view.waitForView((v) => v.entries.some((e) => entryText(e).startsWith("[worker reader reported]")));
			expect(finished.entries.filter((e) => entryText(e).startsWith("[worker reader reported]"))).toHaveLength(1);
			expect(await s.timeline(client)).toHaveLength(1);
		} else {
			s.busyGate.release();
			await s.settle(1);
		}
		expect(s.counts()).toMatchObject({ workerRequests: amended ? 3 : 1, workerAnswers: 1, reportTurns: 1 });
	});

	workerTest("two submissions answered by the same run only wake the coordinator once", async () => {
		const s = await scenario({ held: true, toolBoundary: true });
		await s.send("Amend");
		await until(async () => (await s.runtime.harness.snapshot(InboxDoc, s.worker.conversationId as never, BACKGROUND_CONTEXT))!.items.length === 1);
		s.gate.release();
		await s.settle(1);
		expect(s.counts()).toMatchObject({ workerRequests: 2, reportTurns: 1, reportNotifications: 1 });
		expect(await s.timeline()).toHaveLength(1);
		expect(s.reports()).toHaveLength(1);
	});

	workerTest("the explicit nothing-new line is recorded without a coordinator turn", async () => {
		const s = await scenario({ answer: NO_NEW_WORKER_REPORT });
		await s.settle(1);
		expect(entryText(s.reports()[0]!)).toContain(NO_NEW_WORKER_REPORT);
		expect(s.counts()).toMatchObject({ reportTurns: 0, reportNotifications: 0 });
	});

	workerTest("forget withdraws queued inputs without aborting the answer and records late output quietly", async () => {
		const s = await scenario({ held: true });
		await s.send("Queue");
		await until(async () => (await s.runtime.harness.snapshot(InboxDoc, s.worker.conversationId as never, BACKGROUND_CONTEXT))!.items.length === 1);
		const queued = (await s.runtime.harness.snapshot(InboxDoc, s.worker.conversationId as never, BACKGROUND_CONTEXT))!.items[0]!;
		const workerConversation = (await s.runtime.harness.conversation(s.worker.conversationId as never, BACKGROUND_CONTEXT))!;
		const passive = await workerConversation.submit({ type: "write", entry: { kind: "pi.user", model: [{ role: "user", content: "Keep for history", timestamp: Date.now() }] } }, BACKGROUND_CONTEXT);
		await s.send("Forget");
		expect((await s.runtime.harness.snapshot(InboxDoc, s.worker.conversationId as never, BACKGROUND_CONTEXT))!.items.map((item) => item.mode)).toEqual(["write"]);
		expect(await (await s.runtime.harness.submission(queued.id, BACKGROUND_CONTEXT))!.status(BACKGROUND_CONTEXT)).toMatchObject({ status: "unanswered", reason: "aborted" });
		expect(s.counts().aborted).toBe(false);
		s.gate.release();
		await s.settle(1);
		expect(s.counts()).toMatchObject({ workerRequests: 1, reportTurns: 0, reportNotifications: 0 });
		expect((await listWorkers(s.client, s.projectId)).workers[0]?.status).toBe("done");
		expect((await passive.status(BACKGROUND_CONTEXT)).status).toBe("done");
	});

	workerTest("a reporter not yet admitted when forgotten never submits its message", async () => {
		const s = await scenario({ held: true });
		await s.send("Forget");
		const pending = await s.runtime.harness.commit((tx) => tx.createTask(s.runtime.workers.reporterTask, {
			workerId: "reader", conversationId: s.worker.conversationId, callId: "delayed-send", message: "Must not arrive", followUp: true,
		}, { ownership: { kind: "conversation" }, conversationId: s.conversation.id, background: true }), BACKGROUND_CONTEXT);
		await until(async () => !(await s.runtime.harness.inspect(BACKGROUND_CONTEXT)).tasks.some((t) => t.record.kind === "aiki.worker-reporter" && t.record.id === pending && t.record.state.status !== "terminal"));
		expect(await s.runtime.harness.commit((tx) => tx.submissionByRequest(s.worker.conversationId as never, "worker-message:delayed-send"), BACKGROUND_CONTEXT)).toBeUndefined();
		s.gate.release();
		await s.settle(1);
		expect(s.counts().reportTurns).toBe(0);
	});

	workerTest("an old reporter cannot update a replacement with the same worker ID", async () => {
		const s = await scenario({ held: true });
		await s.send("Forget");
		await s.runtime.harness.commit(async (tx) => {
			const doc = await tx.doc(WorkersDoc, s.conversation.id);
			const replacement = doc.workers["reader"]!;
			replacement.conversationId = 999999;
			replacement.status = "running";
			replacement.lastReport = "replacement report";
		}, BACKGROUND_CONTEXT);
		s.gate.release();
		await s.settle(1);
		expect(s.counts().reportTurns).toBe(0);
		expect((await listWorkers(s.client, s.projectId)).workers[0]).toMatchObject({ status: "running", lastReport: "replacement report" });
	});

	workerTest("late reports from a pruned worker are still recorded without waking", async () => {
		const s = await scenario({ held: true });
		await s.send("Forget");
		await s.runtime.harness.commit(async (tx) => { const doc = await tx.doc(WorkersDoc, s.conversation.id); delete doc.workers["reader"]; }, BACKGROUND_CONTEXT);
		s.gate.release();
		await s.settle(1);
		expect(s.counts().reportTurns).toBe(0);
	});
});
