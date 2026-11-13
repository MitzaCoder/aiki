import { afterEach, describe, expect, it } from "bun:test";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { TranscriptContext } from "@earendil-works/pi-ai";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
import type { ModelRef } from "@kemiri/protocol";
import { mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	isMemoryFileId,
	MemoryStore,
	parseHistory,
	parseMemoryFile,
	renderTopic,
	splitSections,
} from "../src/memory.ts";
import { MemoryService, memorySectionMarker, renderMemorySection } from "../src/memory-tools.ts";
import { createSetup, entryText, errorOf, TestClient, type TestSetup } from "./support.ts";
import type { Conversation } from "@earendil-works/pi-durable";

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

const PROJECT_TARGET = { scope: "project", projectId: "proj-1" } as const;

async function storeAt(): Promise<{ store: MemoryStore; root: string; changes: string[] }> {
	const root = await mkdtemp(join(tmpdir(), "aiki-memory-"));
	const changes: string[] = [];
	const store = new MemoryStore({
		dataDir: root,
		onChange: (scope, projectId) => changes.push(`${scope}:${projectId ?? ""}`),
	});
	cleanups.push(async () => {
		await store.close();
		await rm(root, { recursive: true, force: true });
	});
	return { store, root, changes };
}

async function until(check: () => boolean | Promise<boolean>, timeoutMs = 10_000): Promise<void> {
	const start = Date.now();
	while (Date.now() - start < timeoutMs) {
		if (await check()) return;
		await new Promise((resolve) => setTimeout(resolve, 20));
	}
	throw new Error("timed out waiting for a condition");
}

async function commitCount(dir: string): Promise<number> {
	const result = Bun.spawnSync(["git", "-C", dir, "rev-list", "--count", "HEAD"], { stdout: "pipe", stderr: "pipe" });
	if (result.exitCode !== 0) return 0;
	return Number(new TextDecoder().decode(result.stdout).trim());
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

type PromptMessage = { role: string; content?: unknown; sections?: Record<string, string | null> };

/** The system message of one request, as it is sent: `content` plus every section, in order. */
function systemText(request: { messages: readonly PromptMessage[] }): string {
	return request.messages
		.filter((message) => message.role === "system")
		.map((message) => {
			const sections = message.sections;
			if (sections === undefined) return messageText(message);
			return [messageText(message), ...Object.values(sections).filter((part) => part !== null)]
				.filter((part) => part.length > 0)
				.join("\n\n");
		})
		.join("\n\n");
}

async function systemEntries(client: TestClient, projectId: string): Promise<number> {
	const response = await client.request({ type: "conversation.page", projectId, order: "ascending", limit: 300 });
	if (response.type !== "conversation.page") throw new Error(JSON.stringify(response));
	return response.entries.filter((entry) => entry.kind === "pi.system").length;
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

describe("memory files", () => {
	it("splits sections, keeping fenced headings as text", () => {
		expect(splitSections("Intro.\n\n## One\ntext one\n\n```\n## not a heading\n```\n\n## Two\ntext two\n")).toEqual({
			intro: "Intro.",
			sections: [
				{ heading: "One", text: "text one\n\n```\n## not a heading\n```" },
				{ heading: "Two", text: "text two" },
			],
		});
		expect(splitSections("Only intro.\n")).toEqual({ intro: "Only intro.", sections: [] });
		expect(splitSections("")).toEqual({ intro: "", sections: [] });
	});

	it("round-trips front matter and body, and reads a file without front matter from its name", () => {
		const topic = parseMemoryFile(
			"testing",
			[
				"---",
				"title: Testing",
				"summary: How tests are run here.",
				"tags: [testing, bun]",
				"links: [global:user-preferences]",
				"created: 2026-11-01T00:00:00.000Z",
				"updated: 2026-11-02T00:00:00.000Z",
				`source: {"projectId":"p","conversationId":3,"entryId":null}`,
				"status: active",
				"---",
				"",
				"Intro.",
				"",
				"## Running the suite",
				"",
				"Use `bun test`.",
				"",
			].join("\n"),
			"2026-11-03T00:00:00.000Z",
		);
		expect(topic.title).toBe("Testing");
		expect(topic.tags).toEqual(["testing", "bun"]);
		expect(topic.links).toEqual(["global:user-preferences"]);
		expect(topic.source).toEqual({ projectId: "p", conversationId: 3, entryId: null });
		expect(topic.intro).toBe("Intro.");
		expect(topic.sections).toEqual([{ heading: "Running the suite", text: "Use `bun test`." }]);
		expect(renderTopic(topic)).toContain("title: Testing");
		expect(renderTopic(topic)).toContain("source: {\"projectId\":\"p\",\"conversationId\":3,\"entryId\":null}");

		const bare = parseMemoryFile("user-preferences", "I like short answers.\n", "2026-11-03T00:00:00.000Z");
		expect(bare.title).toBe("User preferences");
		expect(bare.summary).toBe("I like short answers.");
		expect(bare.status).toBe("active");
		expect(bare.updated).toBe("2026-11-03T00:00:00.000Z");
	});

	it("rejects every file ID that is not a short name", () => {
		expect(isMemoryFileId("testing")).toBe(true);
		expect(isMemoryFileId("user-preferences")).toBe(true);
		expect(isMemoryFileId("bun.testing_2")).toBe(true);
		for (const value of ["", "../etc/passwd", "a/b", "..", ".hidden", "Upper", "has space", "notes.md", `${"a".repeat(65)}`]) {
			expect(isMemoryFileId(value)).toBe(false);
		}
	});

	it("parses a git log into commits with their files, kind, source and undo", () => {
		const extraction = "0123123489012312348901231234890123123489";
		const undo = "fedcbafedcbafedcbafedcbafedcbafedcbafedc";
		const tool = "abcdefabcdefabcdefabcdefabcdefabcdefabcd";
		/** One `git log` record as `MEMORY_LOG_FORMAT` writes it: header fields, then the files it touched. */
		const record = (
			commit: string,
			at: string,
			subject: string,
			kind: string,
			body: string,
			files: string,
			source = "",
			undoOf = "",
		): string =>
			["\x1e", commit, "\x1f", at, "\x1f", subject, "\x1f", kind, "\x1f", source, "\x1f", undoOf, "\x1f", body, "\x1f", files].join("");
		const output = [
			record(
				extraction,
				"2026-11-04T00:00:00+00:00",
				"memory: extraction from conversation 1",
				"extraction",
				"Saved from the compacted part.\n\n- create testing\n\nMemory-Kind: extraction\nMemory-Source: {\"projectId\":\"proj-1\",\"conversationId\":1,\"entryId\":9}",
				"\n\ntesting.md\n",
				'{"projectId":"proj-1","conversationId":1,"entryId":9}\n',
			),
			record(
				undo,
				"2026-11-05T00:00:00+00:00",
				`memory: undo ${extraction.slice(0, 8)}`,
				"undo",
				`Reverts ${extraction.slice(0, 8)}: memory: extraction from conversation 1\n\nMemory-Kind: undo\nMemory-Undo-Of: ${extraction}`,
				"\n\ntesting.md\n",
				"",
				`${extraction}\n`,
			),
			record(tool, "2026-11-03T00:00:00+00:00", "memory: create testing", "tool", "", "\n\ntesting.md\nREADME.md\n"),
		].join("");
		expect(parseHistory(output, 10)).toEqual([
			{
				commit: extraction,
				message: "memory: extraction from conversation 1\n\nSaved from the compacted part.\n\n- create testing",
				at: "2026-11-04T00:00:00+00:00",
				files: ["testing"],
				kind: "extraction",
				source: { projectId: "proj-1", conversationId: 1, entryId: 9 },
				undoable: false,
				undoneBy: undo,
			},
			{
				commit: undo,
				message: `memory: undo ${extraction.slice(0, 8)}\n\nReverts ${extraction.slice(0, 8)}: memory: extraction from conversation 1`,
				at: "2026-11-05T00:00:00+00:00",
				files: ["testing"],
				kind: "undo",
				undoable: false,
			},
			{
				commit: tool,
				message: "memory: create testing",
				at: "2026-11-03T00:00:00+00:00",
				files: ["testing"],
				kind: "tool",
				undoable: false,
			},
		]);
	});

});

describe("memory store", () => {
	it("creates, updates, searches and reads a topic, one git commit per write", async () => {
		const { store } = await storeAt();
		const created = await store.write({
			target: PROJECT_TARGET,
			fileId: "testing",
			title: "Testing",
			summary: "How tests are run here.",
			tags: ["testing", "bun"],
			heading: "Running the suite",
			text: "Use `bun test` from the root.",
			source: { projectId: "proj-1", conversationId: 1, entryId: null },
		});
		expect(created.kind).toBe("created");
		if (created.kind !== "created") throw new Error("unreachable");
		expect(created.commit).toMatch(/^[0-9a-f]{40}$/);

		const dir = store.projectDir("proj-1");
		expect(await readdir(dir)).toContain("testing.md");
		const text = await readFile(join(dir, "testing.md"), "utf8");
		expect(text).toContain("tags: [testing, bun]");
		expect(text).toContain("## Running the suite");
		expect(await commitCount(dir)).toBe(1);

		const hits = await store.search({ query: "bun tests", scope: "project", projectId: "proj-1", limit: 5 });
		expect(hits.map((hit) => [hit.scope, hit.fileId, hit.heading])).toContainEqual([
			"project",
			"testing",
			"Running the suite",
		]);
		const rootHits = await store.search({ query: "from the root", scope: "project", projectId: "proj-1", limit: 5 });
		expect(rootHits.some((hit) => hit.heading === "Running the suite" && hit.snippet.includes("root"))).toBe(true);

		const updated = await store.write({
			target: PROJECT_TARGET,
			fileId: "testing",
			heading: "Watching tests",
			text: "`bun test --watch` while iterating.",
		});
		expect(updated.kind).toBe("updated");
		expect(await commitCount(dir)).toBe(2);
		const file = await store.read("project", "proj-1", "testing");
		expect(file.file.headings).toEqual(["Running the suite", "Watching tests"]);
		expect(file.body).toContain("bun test --watch");

		const history = await store.history("project", "proj-1", 10);
		expect(history.map((change) => change.message)).toEqual([
			'memory: update section "Watching tests" in testing',
			"memory: create testing",
		]);
		expect(history[0]?.files).toEqual(["testing"]);
	});

	it("returns close matches before creating a topic, and creates it with create: true", async () => {
		const { store } = await storeAt();
		await store.write({
			target: PROJECT_TARGET,
			fileId: "deploy",
			title: "Deploy",
			summary: "How a release is deployed.",
			heading: "Moving main",
			text: "Moving main deploys all three services.",
		});
		const dir = store.projectDir("proj-1");
		const before = await commitCount(dir);

		const suggested = await store.write({
			target: PROJECT_TARGET,
			fileId: "deployment",
			title: "Deployment notes",
			text: "Notes about deploying the release.",
		});
		expect(suggested.kind).toBe("suggest");
		if (suggested.kind !== "suggest") throw new Error("unreachable");
		expect(suggested.matches.map((match) => match.fileId)).toEqual(["deploy"]);
		expect(await readdir(dir)).not.toContain("deployment.md");
		expect(await commitCount(dir)).toBe(before);

		const created = await store.write({
			target: PROJECT_TARGET,
			fileId: "deployment",
			title: "Deployment notes",
			text: "Notes about deploying the release.",
			create: true,
		});
		expect(created.kind).toBe("created");
		expect(await commitCount(dir)).toBe(before + 1);
	});

	it("archives a topic out of search and the catalog, and still finds it on request", async () => {
		const { store } = await storeAt();
		await store.write({
			target: PROJECT_TARGET,
			fileId: "old-ports",
			title: "Old ports",
			text: "The service used to listen on 7000.",
			tags: ["network"],
		});
		expect((await store.stats("proj-1")).project).toEqual({ scope: "project", files: 1, archived: 0, tags: { network: 1 } });

		const archived = await store.archive(PROJECT_TARGET, "old-ports", { reason: "the port changed" });
		expect(archived.kind).toBe("updated");
		expect((await store.stats("proj-1")).project).toEqual({ scope: "project", files: 0, archived: 1, tags: {} });
		expect((await store.list("project", "proj-1", {})).length).toBe(0);
		expect((await store.list("project", "proj-1", { includeArchived: true })).length).toBe(1);
		expect((await store.search({ query: "7000", scope: "project", projectId: "proj-1", limit: 5 })).length).toBe(0);
		expect(
			(
				await store.search({
					query: "7000",
					scope: "project",
					projectId: "proj-1",
					includeArchived: true,
					limit: 5,
				})
			).length,
		).toBe(1);
		expect((await store.read("project", "proj-1", "old-ports")).file.status).toBe("archived");
		expect((await store.history("project", "proj-1", 5))[0]?.message).toBe(
			"memory: archive old-ports — the port changed",
		);
	});

	it("keeps the global and project scopes apart and searches both", async () => {
		const { store } = await storeAt();
		await store.write({
			target: { scope: "global" },
			fileId: "user-preferences",
			title: "User preferences",
			text: "The user prefers short answers and bun.",
		});
		await store.write({
			target: PROJECT_TARGET,
			fileId: "testing",
			title: "Testing",
			text: "Tests run with bun test.",
		});
		const hits = await store.search({ query: "bun", scope: "both", projectId: "proj-1", limit: 10 });
		expect(hits.map((hit) => `${hit.scope}:${hit.fileId}`).sort()).toEqual([
			"global:user-preferences",
			"project:testing",
		]);
		expect((await store.stats("proj-1")).global.files).toBe(1);
		expect((await store.stats("proj-1")).project.files).toBe(1);
	});

	it("reindexes a file edited by hand and reports the change", async () => {
		const { store, changes } = await storeAt();
		await store.write({
			target: PROJECT_TARGET,
			fileId: "testing",
			title: "Testing",
			heading: "Running the suite",
			text: "Use `bun test`.",
		});
		const path = join(store.projectDir("proj-1"), "testing.md");
		const text = await readFile(path, "utf8");
		await writeFile(path, text.replace("Use `bun test`.", "Use `bun test` from the repository root."));
		await until(async () => (await store.search({ query: "repository root", scope: "project", projectId: "proj-1", limit: 5 })).length > 0);
		expect(changes).toContain("project:proj-1");
		// The edit is indexed, not committed: history still has only the tool's write.
		expect((await store.history("project", "proj-1", 10)).length).toBe(1);
	});

	it("commits hand edits on their own before a tool write, so a tool commit holds only its change", async () => {
		const { store } = await storeAt();
		await store.write({
			target: PROJECT_TARGET,
			fileId: "testing",
			title: "Testing",
			heading: "Running the suite",
			text: "Use `bun test`.",
		});
		const dir = store.projectDir("proj-1");
		const path = join(dir, "testing.md");
		await writeFile(path, (await readFile(path, "utf8")).replace("Use `bun test`.", "Use `bun test --watch`."));
		await writeFile(join(dir, "notes.md"), "---\ntitle: Notes\nsummary: Written by hand.\n---\n\nHand written.\n");

		const updated = await store.write({
			target: PROJECT_TARGET,
			fileId: "testing",
			heading: "Watching",
			text: "`bun test --watch` while iterating.",
		});
		expect(updated.kind).toBe("updated");

		const changes = await store.history("project", "proj-1", 10);
		expect(changes.map((change) => change.message)).toEqual([
			'memory: update section "Watching" in testing',
			"memory: edits made by hand",
			"memory: create testing",
		]);
		// The tool's commit holds only the tool's file; the hand edit and the hand-written topic are their own commit.
		expect(changes[0]?.files).toEqual(["testing"]);
		expect([...changes[1]!.files].sort()).toEqual(["notes", "testing"]);

		const text = await readFile(path, "utf8");
		expect(text).toContain("Use `bun test --watch`.");
		expect(text).toContain("## Watching");
		expect((await store.read("project", "proj-1", "notes")).file.title).toBe("Notes");
	});

	it("records when and how often a file and its sections were retrieved", async () => {
		const { store } = await storeAt();
		await store.write({
			target: PROJECT_TARGET,
			fileId: "testing",
			title: "Testing",
			heading: "Running the suite",
			text: "Use `bun test`.",
		});
		await store.read("project", "proj-1", "testing");
		await store.read("project", "proj-1", "testing");
		await store.search({ query: "bun", scope: "project", projectId: "proj-1", limit: 5 });
		const retrievals = await store.scope(PROJECT_TARGET).retrievals();
		const whole = retrievals.find((entry) => entry.heading === null);
		const section = retrievals.find((entry) => entry.heading === "Running the suite");
		expect(whole?.hits).toBeGreaterThanOrEqual(2);
		expect(section?.hits).toBeGreaterThanOrEqual(1);
		expect(whole?.lastAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
	});

	it("serializes concurrent writes, so both land and neither loses the other", async () => {
		const { store } = await storeAt();
		await store.write({ target: PROJECT_TARGET, fileId: "one", title: "One", text: "First topic." });
		await Promise.all([
			store.write({ target: PROJECT_TARGET, fileId: "one", heading: "A", text: "Section A." }),
			store.write({ target: PROJECT_TARGET, fileId: "one", heading: "B", text: "Section B." }),
			store.write({ target: PROJECT_TARGET, fileId: "two", title: "Two", text: "Second topic.", create: true }),
		]);
		expect((await store.read("project", "proj-1", "one")).file.headings).toEqual(["A", "B"]);
		expect((await store.read("project", "proj-1", "two")).file.title).toBe("Two");
		expect(await commitCount(store.projectDir("proj-1"))).toBe(4);
	});

	it("finds the same topics after a restart", async () => {
		const { store, root } = await storeAt();
		await store.write({
			target: PROJECT_TARGET,
			fileId: "testing",
			title: "Testing",
			tags: ["bun"],
			text: "Use `bun test`.",
		});
		await store.close();
		const reopened = new MemoryStore({ dataDir: root });
		cleanups.push(() => reopened.close());
		expect((await reopened.list("project", "proj-1", {})).map((file) => file.fileId)).toEqual(["testing"]);
		expect((await reopened.search({ query: "bun", scope: "project", projectId: "proj-1", limit: 5 })).length).toBeGreaterThan(0);
		expect((await reopened.history("project", "proj-1", 5)).map((change) => change.message)).toEqual([
			"memory: create testing",
		]);
	});

	it("refuses traversal and symlinked topics", async () => {
		const { store } = await storeAt();
		await store.write({ target: PROJECT_TARGET, fileId: "testing", title: "Testing", text: "Safe." });
		await expect(store.read("project", "proj-1", "../../etc/passwd")).rejects.toMatchObject({ code: "unknown_memory" });
		await expect(
			store.write({ target: PROJECT_TARGET, fileId: "../escape", text: "nope" }),
		).rejects.toMatchObject({ code: "unknown_memory" });
		expect(await readdir(store.dataDir)).toEqual(["projects"]);

		const dir = store.projectDir("proj-1");
		await symlink("/etc/hostname", join(dir, "outside.md"));
		await expect(store.write({ target: PROJECT_TARGET, fileId: "outside", text: "nope" })).rejects.toMatchObject({
			code: "unknown_memory",
		});
	});
});

describe("memory prompt section", () => {
	it("keeps the catalog text until the transcript key changes at a compaction", async () => {
		const { store } = await storeAt();
		await store.write({
			target: PROJECT_TARGET,
			fileId: "testing",
			title: "Testing",
			text: "Use `bun test`.",
			tags: ["bun"],
		});
		const head = { value: undefined as { id: number } | undefined };
		const conversation = {
			id: 7,
			context: async () => ({ head: head.value }),
		} as unknown as Conversation;
		const service = new MemoryService({
			store,
			project: () => ({ id: "proj-1" }) as never,
			conversation,
		});
		const input = (shown: Record<string, string>) =>
			({ conversationId: 7, shown, agent: {}, env: undefined, read: {} }) as never;

		const first = await service.renderSection(input({}), BACKGROUND_CONTEXT);
		expect(first).toContain(memorySectionMarker("start"));
		expect(first).toContain("- project: 1 topic; tags: bun 1");

		// A memory write does not change the key, so the text in effect is returned verbatim.
		await store.write({ target: PROJECT_TARGET, fileId: "deploy", title: "Deploy", text: "Moving main deploys." });
		const again = await service.renderSection(input({ memory: first! }), BACKGROUND_CONTEXT);
		expect(again).toBe(first);
		expect(again).not.toContain("deploy");

		// A compaction moves the key, so the next render is fresh even though the shown text is still there.
		head.value = { id: 42 };
		const compacted = await service.renderSection(input({ memory: first! }), BACKGROUND_CONTEXT);
		expect(compacted).toContain(memorySectionMarker("context-42"));
		expect(compacted).toContain("- project: 2 topics");
		expect(compacted).not.toBe(first);

		// Another write after the compaction stays stable again.
		await store.write({ target: PROJECT_TARGET, fileId: "third", title: "Third", text: "Another topic." });
		expect(await service.renderSection(input({ memory: compacted! }), BACKGROUND_CONTEXT)).toBe(compacted);

		// A different conversation has no memory section at all.
		expect(await service.renderSection({ ...(input({}) as object), conversationId: 8 } as never, BACKGROUND_CONTEXT)).toBeUndefined();
	});

	it("renders the instructions and both scopes", () => {
		const text = renderMemorySection(
			{
				global: { scope: "global", files: 0, archived: 0, tags: {} },
				project: { scope: "project", files: 2, archived: 0, tags: { bun: 2, testing: 1 } },
			},
			"start",
		);
		expect(text).toContain("search memory before planning a task".replace("search", "Search"));
		expect(text).toContain("- global: 0 topics, no tags");
		expect(text).toContain("- project: 2 topics; tags: bun 2, testing 1");
		expect(text).toContain(memorySectionMarker("start"));
	});
});

async function writeMemoryThroughCoordinator(client: TestClient, projectId: string): Promise<void> {
	const response = await client.request({
		type: "conversation.submit",
		projectId,
		requestId: "remember",
		content: "Remember how this project runs tests.",
	});
	expect(response.type).toBe("conversation.submit");
}

describe("memory protocol and tools", () => {
	it("serves list, read, search and history, and reports unknown memories", async () => {
		const test = await setup();
		const client = await connect(test.server);
		const hello = await client.hello();
		expect(hello.type).toBe("hello");
		if (hello.type === "hello") expect(hello.features).toContain("memory");

		const projectId = await addProject(client, test.projectDir);
		await configure(client, projectId);

		// The coordinator writes through its tool; the file and the commit are the result the client reads.
		const { runtime } = await test.server.manager.open(projectId);
		const written = await runtime.memory.store.write({
			target: { scope: "project", projectId },
			fileId: "testing",
			title: "Testing",
			summary: "How tests are run here.",
			tags: ["bun"],
			heading: "Running the suite",
			text: "Use `bun test`.",
			source: { projectId, conversationId: 1, entryId: null },
		});
		expect(written.kind).toBe("created");

		const list = await client.request({ type: "memory.list", scope: "project", projectId });
		if (list.type !== "memory.list") throw new Error(JSON.stringify(list));
		expect(list.files.map((file) => [file.scope, file.fileId, file.title, file.headings])).toEqual([
			["project", "testing", "Testing", ["Running the suite"]],
		]);

		const read = await client.request({ type: "memory.read", scope: "project", projectId, fileId: "testing" });
		if (read.type !== "memory.read") throw new Error(JSON.stringify(read));
		expect(read.file.body).toBe("## Running the suite\n\nUse `bun test`.");

		const search = await client.request({
			type: "memory.search",
			query: "bun test",
			scope: "both",
			projectId,
			limit: 5,
		});
		if (search.type !== "memory.search") throw new Error(JSON.stringify(search));
		expect(search.hits.map((hit) => [hit.scope, hit.fileId])).toEqual([
			["project", "testing"],
			["project", "testing"],
		]);
		expect(search.hits.map((hit) => hit.heading)).toContain("Running the suite");
		expect(search.hits.some((hit) => hit.heading === "Running the suite" && hit.snippet.includes("bun"))).toBe(true);

		const history = await client.request({ type: "memory.history", scope: "project", projectId });
		if (history.type !== "memory.history") throw new Error(JSON.stringify(history));
		expect(history.changes.map((change) => change.message)).toEqual(["memory: create testing"]);

		const missing = await client.request({
			type: "memory.read",
			scope: "project",
			projectId,
			fileId: "missing",
		});
		expect(errorOf(missing).code).toBe("unknown_memory");

		const traversal = await client.request({
			type: "memory.read",
			scope: "project",
			projectId,
			fileId: "../../etc/passwd",
		});
		expect(errorOf(traversal).code).toBe("unknown_memory");

		// A project scope without a project is a bad request; an unknown project is unknown_project.
		expect(errorOf(await client.request({ type: "memory.list", scope: "project" })).code).toBe("bad_request");
		expect(
			errorOf(await client.request({ type: "memory.list", scope: "project", projectId: "nope" })).code,
		).toBe("unknown_project");
	});

	it("pushes memory.changed to every connection on a tool write and on an edit by hand", async () => {
		const test = await setup();
		const one = await connect(test.server);
		const two = await connect(test.server);
		await one.hello();
		await two.hello();
		const projectId = await addProject(one, test.projectDir);
		await configure(one, projectId);

		const { runtime } = await test.server.manager.open(projectId);
		await runtime.memory.store.write({
			target: { scope: "project", projectId },
			fileId: "testing",
			title: "Testing",
			text: "Use `bun test`.",
		});
		for (const client of [one, two]) {
			const event = await client.waitFor(
				(message) => message.type === "memory.changed" && message.scope === "project" && message.projectId === projectId,
			);
			expect(event.type).toBe("memory.changed");
		}

		// A hand edit outside the harness reaches the index and is pushed too.
		const path = join(test.dataDir, "projects", projectId, "memory", "testing.md");
		await writeFile(path, (await readFile(path, "utf8")).replace("bun test", "bun test --watch"));
		const edited = await two.waitFor(
			(message) =>
				message.type === "memory.changed" &&
				message.scope === "project" &&
				message.projectId === projectId &&
				message !== undefined,
		);
		expect(edited.type).toBe("memory.changed");
		await until(async () => {
			const search = await one.request({ type: "memory.search", query: "watch", scope: "project", projectId });
			return search.type === "memory.search" && search.hits.length > 0;
		});
	});

	it("gives the coordinator the memory tools, and workers neither the tools nor the section", async () => {
		const test = await setup();
		const client = await connect(test.server);
		await client.hello();

		const BRIEF = "Summarize the project's README for me.";
		test.faux.setResponses(
			Array.from({ length: 30 }, () => (request: TranscriptContext) => {
				const { role, text } = lastMessage(request);
				if (role === "toolResult") return fauxAssistantMessage("Tool call finished.");
				if (text.includes(BRIEF)) return fauxAssistantMessage("## Report\nOutcome: done");
				if (text.includes("reported]")) return fauxAssistantMessage("Report reviewed.");
				if (text.includes("Delegate the reading.")) {
					return fauxAssistantMessage([fauxToolCall("worker_spawn", { id: "reader", task: BRIEF })], {
						stopReason: "toolUse",
					});
				}
				return fauxAssistantMessage("Nothing to do.");
			}),
		);

		const projectId = await addProject(client, test.projectDir);
		await configure(client, projectId);
		await client.request({ type: "conversation.submit", projectId, requestId: "r1", content: "Delegate the reading." });
		await until(async () => {
			const list = await client.request({ type: "workers.list", projectId });
			return list.type === "workers.list" && list.workers.some((worker) => worker.id === "reader");
		});

		const coordinatorContext = await client.request({ type: "conversation.context", projectId });
		if (coordinatorContext.type !== "conversation.context") throw new Error(JSON.stringify(coordinatorContext));
		expect(coordinatorContext.context.tools.map((tool) => tool.name)).toContain("memory_write");
		expect(coordinatorContext.context.systemPrompt).toContain("<memory>");
		expect(coordinatorContext.context.systemPrompt).toContain("memory_search");

		const workerContext = await client.request({ type: "conversation.context", projectId, workerId: "reader" });
		if (workerContext.type !== "conversation.context") throw new Error(JSON.stringify(workerContext));
		expect(workerContext.context.tools.map((tool) => tool.name).filter((name) => name.startsWith("memory_"))).toEqual([]);
		expect(workerContext.context.systemPrompt).not.toContain("<memory>");
		expect(workerContext.context.systemPrompt).toContain('You are the worker "reader"');
	});

	it("lets the coordinator write memory, and keeps the system prompt byte-identical across that write", async () => {
		const test = await setup();
		const client = await connect(test.server);
		await client.hello();

		const prompts: string[] = [];
		test.faux.setResponses(
			Array.from({ length: 30 }, () => (request: TranscriptContext) => {
				prompts.push(systemText(request));
				const { role, text } = lastMessage(request);
				if (role === "toolResult") return fauxAssistantMessage("Tool call finished.");
				if (text.includes("Remember how this project runs tests.")) {
					return fauxAssistantMessage(
						[
							fauxToolCall("memory_write", {
								fileId: "testing",
								title: "Testing",
								summary: "How tests are run here.",
								tags: ["bun"],
								heading: "Running the suite",
								text: "Use `bun test` from the root.",
							}),
						],
						{ stopReason: "toolUse" },
					);
				}
				return fauxAssistantMessage("Done.");
			}),
		);

		const projectId = await addProject(client, test.projectDir);
		await configure(client, projectId);
		await writeMemoryThroughCoordinator(client, projectId);
		await client.waitFor(
			(message) => message.type === "memory.changed" && message.scope === "project" && message.projectId === projectId,
		);
		const afterWritePrompts = prompts.length;
		await until(() => prompts.length >= 2);
		expect(prompts.length).toBeGreaterThanOrEqual(2);
		// The catalog is stale on purpose: it was rendered when this conversation started.
		expect(prompts[0]).toContain("- project: 0 topics");
		expect(prompts.at(-1)).toBe(prompts[0]!);

		const file = await readFile(join(test.dataDir, "projects", projectId, "memory", "testing.md"), "utf8");
		expect(file).toContain("Use `bun test` from the root.");
		const systemAfterFirst = await systemEntries(client, projectId);

		// The next turn renders the same prompt, and adds no system entry for it.
		await client.request({ type: "conversation.submit", projectId, requestId: "t2", content: "Second turn." });
		await until(() => prompts.length > afterWritePrompts);
		expect(prompts.at(-1)).toBe(prompts[0]!);
		expect(await systemEntries(client, projectId)).toBe(systemAfterFirst);

		// The tools answered with the write, so the transcript shows the memory as written.
		const page = await client.request({ type: "conversation.page", projectId, order: "ascending", limit: 300 });
		if (page.type !== "conversation.page") throw new Error(JSON.stringify(page));
		const toolTexts = page.entries
			.filter((entry) => entry.kind === "pi.tool-result")
			.flatMap((entry) => (entry.model ?? []).map((message) => messageText(message as { content?: unknown })));
		expect(toolTexts.join("\n")).toContain("Created project:testing");
		// The transcript's user message is unchanged too.
		expect(
			page.entries
				.filter((entry) => entry.kind === "pi.user")
				.map((entry) => entryText(entry))
				.join("\n"),
		).toContain("Remember how this project runs tests.");
	});

	it("refuses memory tools from a conversation that is not the coordinator", async () => {
		const test = await setup();
		const client = await connect(test.server);
		await client.hello();

		const BRIEF = "Summarize the project's README for me.";
		test.faux.setResponses(
			Array.from({ length: 40 }, () => (request: TranscriptContext) => {
				const { role, text } = lastMessage(request);
				if (role === "toolResult") return fauxAssistantMessage("Tool call finished.");
				if (text.includes("Nested memory")) {
					return fauxAssistantMessage(
						[fauxToolCall("memory_write", { fileId: "nested", text: "A nested write." })],
						{ stopReason: "toolUse" },
					);
				}
				if (text.includes(BRIEF)) return fauxAssistantMessage("## Report\nOutcome: done");
				if (text.includes("reported]")) return fauxAssistantMessage("Report reviewed.");
				if (text.includes("Delegate the reading.")) {
					return fauxAssistantMessage([fauxToolCall("worker_spawn", { id: "reader", task: BRIEF })], {
						stopReason: "toolUse",
					});
				}
				return fauxAssistantMessage("Nothing to do.");
			}),
		);

		const projectId = await addProject(client, test.projectDir);
		await configure(client, projectId);
		await client.request({ type: "conversation.submit", projectId, requestId: "r1", content: "Delegate the reading." });
		await until(async () => {
			const list = await client.request({ type: "workers.list", projectId });
			return list.type === "workers.list" && list.workers.some((worker) => worker.id === "reader");
		});

		// Deliberately hand the worker the memory extension: the tools are refused, not silently absent.
		const { runtime } = await test.server.manager.open(projectId);
		const workerConversation = await runtime.workers.conversation("reader");
		if (workerConversation === undefined) throw new Error("the worker's conversation is missing");
		await workerConversation.configure({ extensions: { add: [runtime.memory.extension] } }, BACKGROUND_CONTEXT);
		await workerConversation.submit({ type: "input", content: "Nested memory", requestId: "nested" }, BACKGROUND_CONTEXT);

		await until(async () => {
			const page = await client.request({
				type: "conversation.page",
				projectId,
				workerId: "reader",
				order: "ascending",
				limit: 300,
			});
			if (page.type !== "conversation.page") return false;
			return page.entries.some((entry) =>
				(entry.model ?? []).some((message) =>
					messageText(message as { content?: unknown }).includes("answers only the project's coordinator"),
				),
			);
		});
		const dir = join(test.dataDir, "projects", projectId, "memory");
		expect(await readdir(dir)).not.toContain("nested.md");
	});

	it("refreshes the catalog after a compaction", async () => {
		const test = await setup();
		const client = await connect(test.server);
		await client.hello();

		const prompts: string[] = [];
		test.faux.setResponses(
			Array.from({ length: 200 }, () => (request: TranscriptContext) => {
				prompts.push(systemText(request));
				const { role, text } = lastMessage(request);
				if (role === "toolResult") return fauxAssistantMessage("Tool call finished.");
				// The summarizer's own request carries the compacted messages, including the one that asked for the write.
				if (text.includes("conversation to summarize")) return fauxAssistantMessage("## Goal\nKeep going.");
				if (text.includes("Write the testing topic.")) {
					return fauxAssistantMessage(
						[fauxToolCall("memory_write", { fileId: "testing", title: "Testing", text: "Use `bun test`." })],
						{ stopReason: "toolUse" },
					);
				}
				return fauxAssistantMessage("Done.");
			}),
		);

		const projectId = await addProject(client, test.projectDir);
		await configure(client, projectId);
		await client.request({
			type: "conversation.submit",
			projectId,
			requestId: "write",
			content: "Write the testing topic.",
		});
		await client.waitFor(
			(message) => message.type === "memory.changed" && message.scope === "project" && message.projectId === projectId,
		);
		expect(prompts.at(-1)).toContain("- project: 0 topics");

		// Enough transcript for the compaction to have something to replace (it keeps about 20k tokens verbatim).
		for (let index = 0; index < 4; index++) {
			const before = prompts.length;
			await client.request({
				type: "conversation.submit",
				projectId,
				requestId: `filler-${index}`,
				content: `Filler turn ${index}. ${"x".repeat(40_000)}`,
			});
			await until(() => prompts.length > before);
		}

		const { runtime, conversation } = await test.server.manager.conversation(projectId);
		const task = await conversation.compact(undefined, BACKGROUND_CONTEXT);
		await runtime.harness.waitForTask(task, BACKGROUND_CONTEXT);
		expect((await conversation.context(BACKGROUND_CONTEXT)).head).toBeDefined();

		const before = prompts.length;
		await client.request({ type: "conversation.submit", projectId, requestId: "after", content: "After compaction." });
		// The memory extraction that follows a compaction sends its own request (with its own system prompt) and can land
		// before or after the coordinator's: look for the coordinator's prompt, the one that carries the catalog.
		const coordinatorPrompt = () => prompts.slice(before).find((prompt) => prompt.includes("memory-catalog:"));
		await until(() => coordinatorPrompt() !== undefined);
		expect(coordinatorPrompt()).toContain("- project: 1 topic");
		expect(coordinatorPrompt()).toContain("memory-catalog: context-");
	});
});
