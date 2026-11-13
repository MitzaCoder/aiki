/**
 * Extraction of memories from the parts a coordinator compaction replaces, and undoing an extraction.
 */
import { afterEach, describe, expect, it } from "bun:test";
import type { TranscriptContext } from "@earendil-works/pi-ai";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
import type { MemoryChange, ModelRef } from "@kemiri/protocol";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderCommitMessage } from "../src/memory.ts";
import { MemoryExtractionStore } from "../src/memory-extraction.ts";
import { ProjectStore } from "../src/projects.ts";
import { createSetup, errorOf, TestClient, type TestSetup } from "./support.ts";

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

async function until(check: () => boolean | Promise<boolean>, timeoutMs = 20_000): Promise<void> {
	const start = Date.now();
	while (Date.now() - start < timeoutMs) {
		if (await check()) return;
		await new Promise((resolve) => setTimeout(resolve, 20));
	}
	throw new Error("timed out waiting for a condition");
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
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

function lastMessage(request: { messages: readonly { role: string; content?: unknown }[] }): { role: string; text: string } {
	const last = request.messages.findLast((message) => message.role !== "system");
	return { role: last?.role ?? "", text: messageText(last ?? {}) };
}

/** The system prompt of one request: how a run's own calls are told apart from the conversation's. */
function systemText(request: { messages: readonly { role: string; content?: unknown }[] }): string {
	return request.messages
		.filter((message) => message.role === "system")
		.map((message) => messageText(message))
		.join("\n");
}

function toolResultCount(request: { messages: readonly { role: string }[] }): number {
	return request.messages.filter((message) => message.role === "toolResult").length;
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
	if (response.type !== "projects.configure") throw errorOf(response);
}

/** The coordinator's transcript, oldest first. */
async function entries(client: TestClient, projectId: string): Promise<{ id: number; kind: string }[]> {
	const response = await client.request({ type: "conversation.page", projectId, order: "ascending", limit: 500 });
	if (response.type !== "conversation.page") throw new Error(JSON.stringify(response));
	return response.entries.map((entry) => ({ id: entry.id, kind: entry.kind }));
}

async function history(test: TestSetup, scope: "global" | "project", projectId?: string): Promise<MemoryChange[]> {
	return test.server.manager.memory.history(scope, projectId, 20);
}

/** Write one topic straight through the store, the way the coordinator's tool does. */
async function seedTopic(
	test: TestSetup,
	projectId: string,
	input: { fileId: string; heading?: string; text: string; title?: string; tags?: string[] },
): Promise<void> {
	await test.server.manager.memory.write({
		target: { scope: "project", projectId },
		fileId: input.fileId,
		text: input.text,
		...(input.heading === undefined ? {} : { heading: input.heading }),
		...(input.title === undefined ? {} : { title: input.title }),
		...(input.tags === undefined ? {} : { tags: input.tags }),
	});
}

describe("extraction after a compaction", () => {
	it("saves global and project facts into one commit each, merging into an existing topic", async () => {
		const test = await setup();
		const client = await connect(test.server);
		await client.hello();
		const projectId = await addProject(client, test.projectDir);
		await configure(client, projectId);
		await seedTopic(test, projectId, {
			fileId: "testing",
			title: "Testing",
			heading: "Running the suite",
			text: "Use `bun test`.",
		});

		const prompts: string[] = [];
		test.faux.setResponses(
			Array.from({ length: 40 }, () => (request: TranscriptContext) => {
				const { text } = lastMessage(request);
				if (text.includes("conversation to summarize")) {
					return fauxAssistantMessage("## Goal\nKeep the preferences and the test command.");
				}
				if (systemText(request).includes("You keep the durable memory")) {
					if (toolResultCount(request) === 0) prompts.push(text);
					const results = toolResultCount(request);
					if (results === 0) {
						return fauxAssistantMessage(
							[
								fauxToolCall("memory_write", {
									scope: "global",
									fileId: "workflow",
									title: "How the user works",
									summary: "The user's working preferences.",
									tags: ["preferences"],
									text: "Prefers tabs to spaces and short commit messages.",
								}),
							],
							{ stopReason: "toolUse" },
						);
					}
					if (results === 1) {
						return fauxAssistantMessage(
							[
								fauxToolCall("memory_write", {
									scope: "project",
									fileId: "testing",
									heading: "Running the suite",
									text: "Use `bun test` from the repository root; `bun test --watch` while iterating.",
								}),
							],
							{ stopReason: "toolUse" },
						);
					}
					return fauxAssistantMessage("Saved the user's preferences and the test command.");
				}
				if (text.includes("Say something long.")) return fauxAssistantMessage("Still going. ".repeat(4_000));
				return fauxAssistantMessage("Noted.");
			}),
		);

		await client.request({
			type: "conversation.submit",
			projectId,
			requestId: "prefs",
			content: "I prefer tabs, and this project runs tests with `bun test` from the root.",
		});
		await until(async () => (await entries(client, projectId)).some((entry) => entry.kind === "pi.user"));
		// Enough after the facts that a compaction replaces the part they are in.
		await client.request({ type: "conversation.submit", projectId, requestId: "long", content: "Say something long." });
		await until(async () => (await entries(client, projectId)).some((entry) => entry.kind === "pi.assistant"));
		await client.request({ type: "conversation.compact", projectId });
		await until(async () => (await entries(client, projectId)).some((entry) => entry.kind === "pi.compaction"));
		const compaction = (await entries(client, projectId)).find((entry) => entry.kind === "pi.compaction");

		// The extraction reads the part the compaction replaced, not the summary.
		await until(async () => (await history(test, "project", projectId)).some((change) => change.kind === "extraction"));
		await until(async () => (await history(test, "global")).some((change) => change.kind === "extraction"));
		expect(prompts.length).toBeGreaterThan(0);
		expect(prompts[0]).toContain("I prefer tabs");
		expect(prompts[0]).toContain("was just compacted");

		// Global: one new topic, one commit, sourced from the compaction entry.
		const globalChanges = await history(test, "global");
		expect(globalChanges.map((change) => change.kind)).toEqual(["extraction"]);
		expect(globalChanges[0]?.files).toEqual(["workflow"]);
		expect(globalChanges[0]?.source?.projectId).toBe(projectId);
		expect(globalChanges[0]?.source?.conversationId).toBeGreaterThan(0);
		expect(globalChanges[0]?.source?.entryId).toBe(compaction?.id);
		expect(globalChanges[0]?.undoable).toBe(true);
		const global = await test.server.manager.memory.read("global", projectId, "workflow");
		expect(global.file.title).toBe("How the user works");
		expect(global.file.tags).toEqual(["preferences"]);
		expect(global.file.source?.entryId).toBe(compaction?.id);

		// Project: the existing topic is updated, not duplicated, and both writes are one commit.
		const projectChanges = await history(test, "project", projectId);
		expect(projectChanges[0]?.kind).toBe("extraction");
		expect(projectChanges[0]?.files).toEqual(["testing"]);
		expect(projectChanges[0]?.message).toContain("Saved from the part of conversation");
		expect(projectChanges[0]?.message).toContain('- update testing, section "Running the suite"');
		const topics = await test.server.manager.memory.list("project", projectId, {});
		expect(topics.map((topic) => topic.fileId)).toEqual(["testing"]);
		const testing = await test.server.manager.memory.read("project", projectId, "testing");
		expect(testing.body).toContain("`bun test --watch` while iterating");
		expect(testing.file.headings).toEqual(["Running the suite"]);

		// A restart does not extract the same compaction again.
		const before = (await history(test, "project", projectId)).length;
		await test.restart();
		const again = await connect(test.server);
		await again.hello();
		await test.server.manager.open(projectId);
		await sleep(500);
		expect((await history(test, "project", projectId)).length).toBe(before);
		expect((await history(test, "global")).length).toBe(1);
	}, 30_000);

	it("writes nothing when the extraction finds nothing to keep", async () => {
		const test = await setup();
		const client = await connect(test.server);
		await client.hello();
		const projectId = await addProject(client, test.projectDir);
		await configure(client, projectId);

		test.faux.setResponses(
			Array.from({ length: 20 }, () => (request: TranscriptContext) => {
				const { text } = lastMessage(request);
				if (text.includes("conversation to summarize")) return fauxAssistantMessage("## Goal\nNothing durable.");
				if (systemText(request).includes("You keep the durable memory")) return fauxAssistantMessage("Nothing worth keeping.");
				if (text.includes("Say something long.")) return fauxAssistantMessage("Still going. ".repeat(4_000));
				return fauxAssistantMessage("Noted.");
			}),
		);

		await client.request({ type: "conversation.submit", projectId, requestId: "small", content: "Thanks!" });
		await until(async () => (await entries(client, projectId)).some((entry) => entry.kind === "pi.user"));
		await client.request({ type: "conversation.submit", projectId, requestId: "long", content: "Say something long." });
		await until(async () => (await entries(client, projectId)).some((entry) => entry.kind === "pi.assistant"));
		await client.request({ type: "conversation.compact", projectId });
		await until(async () => (await entries(client, projectId)).some((entry) => entry.kind === "pi.compaction"));
		expect(await history(test, "project", projectId)).toEqual([]);
		expect(await history(test, "global")).toEqual([]);
	}, 30_000);
});

describe("the progress file", () => {
	it("keeps main's and each background thread's last extracted compaction apart, across a restart", async () => {
		const root = await mkdtemp(join(tmpdir(), "extraction-store-"));
		cleanups.push(() => rm(root, { recursive: true, force: true }));
		const projects = new ProjectStore(root);
		const store = new MemoryExtractionStore({ projects });
		await store.markProcessed("p", 40);
		await store.markProcessed("p", 12, 7);
		await store.markProcessed("p", 9, 7);
		expect(await store.lastProcessed("p")).toBe(40);
		expect(await store.lastProcessed("p", 7)).toBe(12);
		expect(await store.lastProcessed("p", 8)).toBeNull();
		const reopened = new MemoryExtractionStore({ projects });
		expect(await reopened.lastProcessed("p")).toBe(40);
		expect(await reopened.lastProcessed("p", 7)).toBe(12);
	});
});

describe("undo", () => {
	it("reverts an extraction, marks it, and refuses a second undo or one after a later write", async () => {
		const test = await setup();
		const client = await connect(test.server);
		await client.hello();
		const projectId = await addProject(client, test.projectDir);
		await configure(client, projectId);
		await seedTopic(test, projectId, { fileId: "testing", title: "Testing", heading: "Suite", text: "Use `bun test`." });

		test.faux.setResponses(
			Array.from({ length: 20 }, () => (request: TranscriptContext) => {
				const { text } = lastMessage(request);
				if (text.includes("conversation to summarize")) return fauxAssistantMessage("## Goal\nKeep the command.");
				if (systemText(request).includes("You keep the durable memory")) {
					if (toolResultCount(request) === 0) {
						return fauxAssistantMessage(
							[
								fauxToolCall("memory_write", {
									scope: "project",
									fileId: "testing",
									heading: "Watching",
									text: "`bun test --watch` while iterating.",
								}),
							],
							{ stopReason: "toolUse" },
						);
					}
					return fauxAssistantMessage("Saved it.");
				}
				if (text.includes("Say something long.")) return fauxAssistantMessage("Still going. ".repeat(4_000));
				return fauxAssistantMessage("Noted.");
			}),
		);
		await client.request({ type: "conversation.submit", projectId, requestId: "t", content: "Tests run with bun test." });
		await until(async () => (await entries(client, projectId)).some((entry) => entry.kind === "pi.user"));
		await client.request({ type: "conversation.submit", projectId, requestId: "long", content: "Say something long." });
		await until(async () => (await entries(client, projectId)).some((entry) => entry.kind === "pi.assistant"));
		await client.request({ type: "conversation.compact", projectId });
		await until(async () => (await history(test, "project", projectId)).some((change) => change.kind === "extraction"));
		const extraction = (await history(test, "project", projectId)).find((change) => change.kind === "extraction");
		if (extraction === undefined) throw new Error("no extraction commit");

		const undone = await client.request({
			type: "memory.undo",
			scope: "project",
			projectId,
			commit: extraction.commit,
		});
		if (undone.type !== "memory.undo") throw errorOf(undone);
		expect(undone.change.kind).toBe("undo");
		expect(undone.change.files).toEqual(["testing"]);
		expect(undone.change.undoable).toBe(false);

		// The extraction's section is gone again, and the history marks the original as undone.
		const reverted = await test.server.manager.memory.read("project", projectId, "testing");
		expect(reverted.file.headings).toEqual(["Suite"]);
		const changes = await history(test, "project", projectId);
		const original = changes.find((change) => change.commit === extraction.commit);
		expect(original?.undoable).toBe(false);
		expect(original?.undoneBy).toBe(undone.change.commit);

		// A second undo of the same change is refused.
		const again = await client.request({ type: "memory.undo", scope: "project", projectId, commit: extraction.commit });
		expect(errorOf(again).code).toBe("memory_conflict");

		// Only extraction and maintenance changes are undoable.
		const toolCommit = changes.find((change) => change.kind === "tool");
		if (toolCommit === undefined) throw new Error("no tool commit");
		const refused = await client.request({ type: "memory.undo", scope: "project", projectId, commit: toolCommit.commit });
		expect(errorOf(refused).code).toBe("bad_request");
	}, 30_000);

	it("refuses an undo when a later commit touched the same file", async () => {
		const test = await setup();
		const client = await connect(test.server);
		await client.hello();
		const projectId = await addProject(client, test.projectDir);
		const scope = test.server.manager.memory.scope({ scope: "project", projectId });
		const target = { scope: "project", projectId } as const;
		const extractionMessage = (entryId: number): string =>
			renderCommitMessage("memory: extraction from conversation 1", null, {
				kind: "extraction",
				source: { projectId, conversationId: 1, entryId },
			});
		await scope.write({ target, fileId: "testing", title: "Testing", heading: "Suite", text: "Use `bun test`." });
		const extraction = await scope.applyBatch(
			[{ type: "write", input: { target, fileId: "testing", heading: "Suite", text: "Use `bun test` from the root." } }],
			() => extractionMessage(5),
		);
		if (extraction.commit === null) throw new Error("no extraction commit");
		// A later change to the same file makes the revert unsafe: undoing would drop it.
		await scope.write({ target, fileId: "testing", heading: "Watch", text: "`bun test --watch`." });
		const refused = await client.request({
			type: "memory.undo",
			scope: "project",
			projectId,
			commit: extraction.commit,
		});
		const error = errorOf(refused);
		expect(error.code).toBe("memory_conflict");
		if (refused.type === "error") expect(refused.error.data).toMatchObject({ files: ["testing"] });
		expect((await scope.read("testing")).file.headings).toEqual(["Suite", "Watch"]);

		// Another extraction with nothing after it reverts cleanly.
		const second = await scope.applyBatch(
			[{ type: "write", input: { target, fileId: "deploy", text: "Moving main deploys the backend.", create: true } }],
			() => extractionMessage(9),
		);
		if (second.commit === null) throw new Error("no second extraction commit");
		const undone = await client.request({ type: "memory.undo", scope: "project", projectId, commit: second.commit });
		if (undone.type !== "memory.undo") throw errorOf(undone);
		expect(undone.change.kind).toBe("undo");
		expect(undone.change.message).toContain(`Reverts ${second.commit.slice(0, 8)}`);
		await expect(scope.read("deploy")).rejects.toMatchObject({ code: "unknown_memory" });
	}, 30_000);
});
