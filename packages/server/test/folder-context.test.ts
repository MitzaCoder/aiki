/**
 * `read`/`edit`/`write` attach a folder's AGENTS.md (or CLAUDE.md) to their tool result once per conversation and
 * folder, for folders below the conversation's cwd the system prompt's root-to-cwd chain never carries.
 */
import { afterEach, describe, expect, it } from "bun:test";
import type { FauxResponseFactory } from "@earendil-works/pi-ai/providers/faux";
import type { TranscriptContext } from "@earendil-works/pi-ai";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
import type { ConversationView, ModelRef } from "@mihai-harness/protocol";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSetup, entryText, TestClient, ViewClient, type TestSetup } from "./support.ts";

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

function lastMessage(request: TranscriptContext): { role: string; text: string } {
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

function toolResults(view: ConversationView | undefined): ConversationView["entries"] {
	return view?.entries.filter((entry) => entry.kind === "pi.tool-result") ?? [];
}

/** Runs one tool call and waits for its result, the only tool result in the transcript so far. */
async function runOneCall(
	test: TestSetup,
	client: TestClient,
	projectId: string,
	call: { name: string; arguments: Record<string, string> },
): Promise<{ view: ViewClient; results: ConversationView["entries"] }> {
	const script: FauxResponseFactory = (request) => {
		const { role } = lastMessage(request);
		if (role === "toolResult") return fauxAssistantMessage("Done.");
		return fauxAssistantMessage([fauxToolCall(call.name, call.arguments)], { stopReason: "toolUse" });
	};
	test.faux.setResponses([script, script]);

	const view = new ViewClient(client);
	await view.start(projectId);
	const before = toolResults(view.view).length;
	const submitted = await client.request({
		type: "conversation.submit",
		projectId,
		requestId: `call-${before}`,
		content: `Please run ${call.name}.`,
	});
	expect(submitted.type).toBe("conversation.submit");
	const value = await view.waitForView((current) => toolResults(current).length > before);
	return { view, results: toolResults(value) };
}

describe("folder context attached to tool results", () => {
	it("attaches a subfolder's AGENTS.md to a read below cwd, once", async () => {
		const test = await setup();
		const client = await connect(test.server);
		await greet(client);

		const sub = join(test.projectDir, "services", "python");
		await mkdir(sub, { recursive: true });
		await writeFile(join(sub, "AGENTS.md"), "# Python service rules\nUse uv.\n");
		await writeFile(join(sub, "notes.txt"), "hello\n");

		const projectId = await addProject(client, test.projectDir);
		await configure(client, projectId);

		const first = await runOneCall(test, client, projectId, {
			name: "read",
			arguments: { path: "services/python/notes.txt" },
		});
		const firstText = entryText(first.results.at(-1)!);
		expect(firstText).toContain("hello");
		expect(firstText).toContain(`<folder_instructions path="${join(sub, "AGENTS.md")}">`);
		expect(firstText).toContain("Use uv.");
		expect(firstText).toContain(`Relative paths this file names resolve against ${sub}`);

		// A second read of the same folder does not repeat the block.
		const second = await runOneCall(test, client, projectId, {
			name: "read",
			arguments: { path: "services/python/notes.txt" },
		});
		const secondText = entryText(second.results.at(-1)!);
		expect(secondText).toContain("hello");
		expect(secondText).not.toContain("folder_instructions");
	}, 20_000);

	it("attaches a folder's CLAUDE.md with its @imports expanded", async () => {
		const test = await setup();
		const client = await connect(test.server);
		await greet(client);

		const sub = join(test.projectDir, "docs");
		await mkdir(sub, { recursive: true });
		await writeFile(join(sub, "CLAUDE.md"), "# Docs rules\nSee @testing.md for the test plan.\n");
		await writeFile(join(sub, "testing.md"), "Run `bun test` before every commit.\n");
		await mkdir(join(sub, "guide"), { recursive: true });
		await writeFile(join(sub, "guide", "page.md"), "page\n");

		const projectId = await addProject(client, test.projectDir);
		await configure(client, projectId);

		const result = await runOneCall(test, client, projectId, {
			name: "read",
			arguments: { path: "docs/guide/page.md" },
		});
		const text = entryText(result.results.at(-1)!);
		expect(text).toContain(`<folder_instructions path="${join(sub, "CLAUDE.md")}">`);
		expect(text).toContain("Run `bun test` before every commit.");
	}, 20_000);

	it("attaches nothing for a file directly in cwd, or outside it", async () => {
		const test = await setup();
		const client = await connect(test.server);
		await greet(client);

		await writeFile(join(test.projectDir, "AGENTS.md"), "# Project rules\n");
		await writeFile(join(test.projectDir, "top.txt"), "top\n");

		const projectId = await addProject(client, test.projectDir);
		await configure(client, projectId);

		const result = await runOneCall(test, client, projectId, { name: "read", arguments: { path: "top.txt" } });
		const text = entryText(result.results.at(-1)!);
		expect(text).toContain("top");
		expect(text).not.toContain("folder_instructions");
	}, 20_000);

	it("attaches nothing for a failed read", async () => {
		const test = await setup();
		const client = await connect(test.server);
		await greet(client);

		const sub = join(test.projectDir, "missing-dir");
		await mkdir(sub, { recursive: true });
		await writeFile(join(sub, "AGENTS.md"), "# Rules\n");

		const projectId = await addProject(client, test.projectDir);
		await configure(client, projectId);

		const result = await runOneCall(test, client, projectId, {
			name: "read",
			arguments: { path: "missing-dir/does-not-exist.txt" },
		});
		const text = entryText(result.results.at(-1)!);
		expect(text).not.toContain("hello");
		expect(text).not.toContain("folder_instructions");
	}, 20_000);

	it("attaches a file's own repository root down to its folder, outside cwd, once", async () => {
		const test = await setup();
		const client = await connect(test.server);
		await greet(client);

		const outsideRoot = await mkdtemp(join(tmpdir(), "folder-context-outside-"));
		cleanups.push(() => rm(outsideRoot, { recursive: true, force: true }));
		await mkdir(join(outsideRoot, ".git"), { recursive: true });
		const nested = join(outsideRoot, "services", "python", "harness");
		await mkdir(nested, { recursive: true });
		await writeFile(join(outsideRoot, "AGENTS.md"), "# Outside repo rules\n");
		await writeFile(join(outsideRoot, "services", "python", "AGENTS.md"), "# Python service rules\nUse uv.\n");
		await writeFile(join(nested, "notes.txt"), "hello from outside\n");

		const projectId = await addProject(client, test.projectDir);
		await configure(client, projectId);

		const first = await runOneCall(test, client, projectId, {
			name: "read",
			arguments: { path: join(nested, "notes.txt") },
		});
		const firstText = entryText(first.results.at(-1)!);
		expect(firstText).toContain("hello from outside");
		expect(firstText).toContain(`<folder_instructions path="${join(outsideRoot, "AGENTS.md")}">`);
		expect(firstText).toContain("Outside repo rules");
		expect(firstText).toContain(`<folder_instructions path="${join(outsideRoot, "services", "python", "AGENTS.md")}">`);
		expect(firstText).toContain("Use uv.");

		// A second read of the same folders does not repeat either block.
		const second = await runOneCall(test, client, projectId, {
			name: "read",
			arguments: { path: join(nested, "notes.txt") },
		});
		const secondText = entryText(second.results.at(-1)!);
		expect(secondText).toContain("hello from outside");
		expect(secondText).not.toContain("folder_instructions");
	}, 20_000);

	it("attaches nothing for a file outside cwd with no ancestor repository", async () => {
		const test = await setup();
		const client = await connect(test.server);
		await greet(client);

		const outsideRoot = await mkdtemp(join(tmpdir(), "folder-context-no-repo-"));
		cleanups.push(() => rm(outsideRoot, { recursive: true, force: true }));
		const nested = join(outsideRoot, "lib");
		await mkdir(nested, { recursive: true });
		await writeFile(join(nested, "notes.txt"), "hello\n");

		const projectId = await addProject(client, test.projectDir);
		await configure(client, projectId);

		const result = await runOneCall(test, client, projectId, {
			name: "read",
			arguments: { path: join(nested, "notes.txt") },
		});
		const text = entryText(result.results.at(-1)!);
		expect(text).toContain("hello");
		expect(text).not.toContain("folder_instructions");
	}, 20_000);

	it("skips a repository root already shown by the system prompt's own root-to-cwd chain", async () => {
		const test = await setup();
		const client = await connect(test.server);
		await greet(client);

		const repoRoot = await mkdtemp(join(tmpdir(), "folder-context-repo-"));
		cleanups.push(() => rm(repoRoot, { recursive: true, force: true }));
		await mkdir(join(repoRoot, ".git"), { recursive: true });
		await writeFile(join(repoRoot, "AGENTS.md"), "# Repo root rules\n");

		const appCwd = join(repoRoot, "apps", "web");
		await mkdir(appCwd, { recursive: true });
		const otherService = join(repoRoot, "packages", "server");
		await mkdir(otherService, { recursive: true });
		await writeFile(join(otherService, "AGENTS.md"), "# Server package rules\n");
		await writeFile(join(otherService, "foo.ts"), "export {};\n");

		const projectId = await addProject(client, appCwd);
		await configure(client, projectId);

		const result = await runOneCall(test, client, projectId, {
			name: "read",
			arguments: { path: join(otherService, "foo.ts") },
		});
		const text = entryText(result.results.at(-1)!);
		expect(text).toContain("export {};");
		expect(text).toContain(`<folder_instructions path="${join(otherService, "AGENTS.md")}">`);
		expect(text).toContain("Server package rules");
		// The repo root's own AGENTS.md is already in the system prompt's root-to-cwd chain, so it is not repeated here.
		expect(text).not.toContain(join(repoRoot, "AGENTS.md"));
		expect(text).not.toContain("Repo root rules");
	}, 20_000);
});
