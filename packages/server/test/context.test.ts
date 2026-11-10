import { afterEach, describe, expect, it } from "bun:test";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { TranscriptContext } from "@earendil-works/pi-ai";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
import type { ConversationContext, ModelRef } from "@aiki/protocol";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { AGENT_DIR_ENV, resolveAgentDir } from "../src/data-dir.ts";
import {
	CLAUDE_IMPORT_MAX_HOPS,
	expandClaudeImports,
	modelNotesMatch,
	readContextFile,
	readModelNotes,
} from "../src/context.ts";
import { parseFrontmatter } from "../src/frontmatter.ts";
import { createSetup, entryText, errorOf, TestClient, type TestSetup } from "./support.ts";

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

async function contextOf(client: TestClient, projectId: string, workerId?: string): Promise<ConversationContext> {
	const response = await client.request({
		type: "conversation.context",
		projectId,
		...(workerId === undefined ? {} : { workerId }),
	});
	if (response.type !== "conversation.context") throw new Error(JSON.stringify(response));
	return response.context;
}

async function until(check: () => Promise<boolean>, timeoutMs = 20_000): Promise<void> {
	const start = Date.now();
	while (Date.now() - start < timeoutMs) {
		if (await check()) return;
		await new Promise((resolve) => setTimeout(resolve, 20));
	}
	throw new Error("timed out waiting for a condition");
}

/** Every `pi.system` entry of a conversation, which is one per prompt change and none for an unchanged turn. */
async function systemEntries(client: TestClient, projectId: string, workerId?: string): Promise<number> {
	const response = await client.request({
		type: "conversation.page",
		projectId,
		order: "ascending",
		limit: 200,
		...(workerId === undefined ? {} : { workerId }),
	});
	if (response.type !== "conversation.page") throw new Error(JSON.stringify(response));
	return response.entries.filter((entry) => entry.kind === "pi.system").length;
}

describe("skill frontmatter", () => {
	it("reads name and description, quoted or folded, and nothing at all without frontmatter", () => {
		expect(parseFrontmatter("---\nname: deploy\ndescription: How to deploy.\n---\n\n# Deploy\n").frontmatter).toEqual({
			name: "deploy",
			description: "How to deploy.",
		});
		expect(parseFrontmatter('---\nname: "quoted"\ndescription: \'single\'\n---\n').frontmatter).toEqual({
			name: "quoted",
			description: "single",
		});
		expect(
			parseFrontmatter("---\ndescription: >\n  How tests are written\n  in this project.\n---\n").frontmatter[
				"description"
			],
		).toBe("How tests are written in this project.");
		expect(
			parseFrontmatter("---\ndescription: |\n  one\n  two\n---\n").frontmatter["description"],
		).toBe("one\ntwo");
		expect(parseFrontmatter("# Just markdown\n").frontmatter).toEqual({});
		expect(parseFrontmatter("---\nname: unterminated\n").frontmatter).toEqual({});
		expect(parseFrontmatter("\uFEFF---\nname: bom\ndescription: d\n---\nbody").body).toBe("body");
	});
});

describe("agent directory", () => {
	it("defaults to ~/.pi/agent of the server's user and takes an override", () => {
		expect(resolveAgentDir({})).toBe(join(homedir(), ".pi", "agent"));
		expect(resolveAgentDir({ [AGENT_DIR_ENV]: "  " })).toBe(join(homedir(), ".pi", "agent"));
		expect(resolveAgentDir({ [AGENT_DIR_ENV]: "/srv/agent" })).toBe("/srv/agent");
		expect(resolveAgentDir({ [AGENT_DIR_ENV]: "~/elsewhere" })).toBe(join(homedir(), "elsewhere"));
	});
});

describe("conversation context", () => {
	it("folds the agent directory's AGENTS.md and the ones from the root down into the prompt", async () => {
		const test = await setup();
		const client = await connect(test.server);
		await greet(client);

		// The global file first, then an ancestor's, then the project's own CLAUDE.md (no AGENTS.md there).
		await writeFile(join(test.agentDir, "AGENTS.md"), "# Global rules\nBe kind.\n");
		await writeFile(join(test.root, "AGENTS.md"), "# Workspace rules\nRun the tests.\n");
		await writeFile(join(test.projectDir, "CLAUDE.md"), "# Project rules\nUse bun.\n");

		const projectId = await addProject(client, test.projectDir);
		await configure(client, projectId);

		const context = await contextOf(client, projectId);
		expect(context.projectId).toBe(projectId);
		expect(context.workerId).toBeNull();
		expect(context.cwd).toBe(test.projectDir);
		expect(context.projectPath).toBe(test.projectDir);

		expect(context.contextFiles.map((file) => [file.path, file.scope])).toEqual([
			[join(test.agentDir, "AGENTS.md"), "global"],
			[join(test.root, "AGENTS.md"), "project"],
			[join(test.projectDir, "CLAUDE.md"), "project"],
		]);
		expect(context.contextFiles.map((file) => file.content.trim())).toEqual([
			"# Global rules\nBe kind.",
			"# Workspace rules\nRun the tests.",
			"# Project rules\nUse bun.",
		]);

		// The prompt carries all three, in that order, and says where each came from.
		const prompt = context.systemPrompt;
		expect(prompt.indexOf("Be kind.")).toBeGreaterThanOrEqual(0);
		expect(prompt.indexOf("Be kind.")).toBeLessThan(prompt.indexOf("Run the tests."));
		expect(prompt.indexOf("Run the tests.")).toBeLessThan(prompt.indexOf("Use bun."));
		expect(prompt).toContain(`<project_instructions path="${join(test.projectDir, "CLAUDE.md")}">`);
		expect(prompt).toContain("<coordinator>");

		// The tools are described with the extension that registered each.
		const names = context.tools.map((tool) => tool.name);
		expect(names).toContain("read");
		expect(names).toContain("worker_spawn");
		expect(context.tools.find((tool) => tool.name === "read")?.extension).toBe("coding-tools");
		expect(context.tools.find((tool) => tool.name === "worker_spawn")?.extension).toBe("worker-tools");
		expect(context.skills).toEqual([]);
	});

	it("offers global and project skills, and marks one read once this conversation has read it", async () => {
		const test = await setup();
		const client = await connect(test.server);
		await greet(client);

		const globalSkill = join(test.agentDir, "skills", "deploy", "SKILL.md");
		await mkdir(join(test.agentDir, "skills", "deploy"), { recursive: true });
		await writeFile(
			globalSkill,
			"---\nname: deploy\ndescription: How to deploy this host.\n---\n\n# Deploy\n\nRun the deploy script.\n",
		);
		const projectSkill = join(test.projectDir, ".pi", "skills", "testing", "SKILL.md");
		await mkdir(join(test.projectDir, ".pi", "skills", "testing"), { recursive: true });
		await writeFile(projectSkill, "---\ndescription: >\n  How tests are written\n  in this project.\n---\n\n# Testing\n");

		const projectId = await addProject(client, test.projectDir);
		await configure(client, projectId);

		const before = await contextOf(client, projectId);
		expect(before.skills.map((skill) => [skill.name, skill.source, skill.scope, skill.read])).toEqual([
			["deploy", "pi", "global", false],
			["testing", "pi", "project", false],
		]);
		expect(before.skills[1]?.description).toBe("How tests are written in this project.");
		expect(before.skills[1]?.path).toBe(projectSkill);
		expect(before.systemPrompt).toContain("<available_skills>");
		expect(before.systemPrompt).toContain(`<location>${globalSkill}</location>`);
		expect(before.systemPrompt).toContain(`<location>${projectSkill}</location>`);
		expect(before.systemPrompt).toContain("Use the read tool to load a skill's file");

		// The context is pushed while the conversation is watched: reading the skill is what the app shows.
		test.faux.setResponses(
			Array.from({ length: 10 }, () => (request: TranscriptContext) => {
				const { role, text } = lastMessage(request);
				if (role === "toolResult") return fauxAssistantMessage("Read the testing skill.");
				if (text.includes("Read the skill")) {
					return fauxAssistantMessage([fauxToolCall("read", { path: projectSkill })], { stopReason: "toolUse" });
				}
				return fauxAssistantMessage("Nothing to do.");
			}),
		);
		const watched = await client.request({ type: "conversation.watch", projectId });
		expect(watched.type).toBe("conversation.watch");
		await client.request({ type: "conversation.submit", projectId, requestId: "read-skill", content: "Read the skill." });

		const pushed = await client.waitFor(
			(message) =>
				message.type === "conversation.context.changed" &&
				message.context.skills.some((skill) => skill.path === projectSkill && skill.read),
		);
		expect(pushed.type).toBe("conversation.context.changed");
		if (pushed.type !== "conversation.context.changed") return;
		expect(pushed.context.skills.find((skill) => skill.path === globalSkill)?.read).toBe(false);

		const after = await contextOf(client, projectId);
		expect(after.skills.find((skill) => skill.path === projectSkill)?.read).toBe(true);
		expect(after.skills.find((skill) => skill.path === globalSkill)?.read).toBe(false);
	});

	it("offers the harness's and Claude Code's skills with their source, and Claude's synced ones not at all", async () => {
		const test = await setup();
		const client = await connect(test.server);
		await greet(client);

		const harnessSkill = join(test.configDir, "skills", "harness-skill", "SKILL.md");
		await mkdir(dirname(harnessSkill), { recursive: true });
		await writeFile(harnessSkill, "---\ndescription: From the harness.\n---\n");
		const claudeSkill = join(test.claudeDir, "skills", "claude-skill", "SKILL.md");
		await mkdir(dirname(claudeSkill), { recursive: true });
		await writeFile(claudeSkill, "---\ndescription: From Claude Code.\n---\n");
		const syncedSkill = join(test.claudeDir, "skills", "synced", "account", "synced-skill", "SKILL.md");
		await mkdir(dirname(syncedSkill), { recursive: true });
		await writeFile(syncedSkill, "---\ndescription: Synced from claude.ai.\n---\n");

		const projectId = await addProject(client, test.projectDir);
		await configure(client, projectId);

		const context = await contextOf(client, projectId);
		expect(context.skills.map((skill) => [skill.name, skill.source, skill.scope])).toEqual([
			["harness-skill", "harness", "global"],
			["claude-skill", "claude", "global"],
		]);
		expect(context.systemPrompt).toContain(`<location>${harnessSkill}</location>`);
		expect(context.systemPrompt).toContain(`<location>${claudeSkill}</location>`);
		expect(context.systemPrompt).not.toContain("synced-skill");
	});

	it("keeps the system prompt byte-identical across turns until a context file changes", async () => {
		const test = await setup();
		const client = await connect(test.server);
		await greet(client);

		const agentsFile = join(test.projectDir, "AGENTS.md");
		await writeFile(agentsFile, "# Rules\nAlways use bun.\n");
		await mkdir(join(test.projectDir, ".pi", "skills", "testing"), { recursive: true });
		await writeFile(
			join(test.projectDir, ".pi", "skills", "testing", "SKILL.md"),
			"---\ndescription: How tests are written here.\n---\n",
		);

		// Every request the model gets, in order, so the prompts of two turns can be compared byte for byte.
		const prompts: string[] = [];
		test.faux.setResponses(
			Array.from({ length: 20 }, () => (request: TranscriptContext) => {
				prompts.push(systemText(request));
				return fauxAssistantMessage("Done.");
			}),
		);

		const projectId = await addProject(client, test.projectDir);
		await configure(client, projectId);
		await client.request({ type: "conversation.submit", projectId, requestId: "t1", content: "First turn." });
		await until(async () => prompts.length === 1);

		// Nothing was touched: the same prompt, and the transcript gained no system entry for it.
		const systemAfterFirst = await systemEntries(client, projectId);
		await client.request({ type: "conversation.submit", projectId, requestId: "t2", content: "Second turn." });
		await until(async () => prompts.length === 2);
		expect(prompts[1]).toBe(prompts[0]!);
		expect(await systemEntries(client, projectId)).toBe(systemAfterFirst);

		// An edit is picked up before the next turn, and the prompt changes with it.
		await writeFile(agentsFile, "# Rules\nAlways use bun.\nNever commit secrets.\n");
		await client.request({ type: "conversation.submit", projectId, requestId: "t3", content: "Third turn." });
		await until(async () => prompts.length === 3);
		expect(prompts[2]).not.toBe(prompts[1]!);
		expect(prompts[2]).toContain("Never commit secrets.");
		expect(await systemEntries(client, projectId)).toBeGreaterThan(systemAfterFirst);

		const context = await contextOf(client, projectId);
		expect(context.contextFiles[0]?.content).toContain("Never commit secrets.");
	});

	it("gives a worker the same files and skills, and none of the worker tools", async () => {
		const test = await setup();
		const client = await connect(test.server);
		await greet(client);

		await writeFile(join(test.projectDir, "AGENTS.md"), "# Project rules\nUse bun.\n");
		await mkdir(join(test.projectDir, ".pi", "skills", "testing"), { recursive: true });
		await writeFile(
			join(test.projectDir, ".pi", "skills", "testing", "SKILL.md"),
			"---\ndescription: How tests are written here.\n---\n",
		);

		const BRIEF = "Summarize the project's README for me.";
		test.faux.setResponses(
			Array.from({ length: 20 }, () => (request: TranscriptContext) => {
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
		const workerList = () => client.request({ type: "workers.list", projectId });
		await until(async () => {
			const list = await workerList();
			return list.type === "workers.list" && list.workers.some((worker) => worker.id === "reader");
		});

		const worker = await contextOf(client, projectId, "reader");
		expect(worker.workerId).toBe("reader");
		expect(worker.cwd).toBe(test.projectDir);
		expect(worker.projectPath).toBe(test.projectDir);
		expect(worker.contextFiles.map((file) => file.path)).toContain(join(test.projectDir, "AGENTS.md"));
		expect(worker.skills.map((skill) => [skill.name, skill.scope])).toEqual([["testing", "project"]]);
		expect(worker.systemPrompt).toContain("Use bun.");
		expect(worker.systemPrompt).toContain('You are the worker "reader"');

		// A worker never gets the delegation tools: its extension is removed from the coordinator's selection.
		const workerTools = worker.tools.map((tool) => tool.name);
		expect(workerTools.filter((name) => name.startsWith("worker_"))).toEqual([]);
		expect(workerTools).toContain("read");
		expect(workerTools).toContain("bash");

		const coordinator = await contextOf(client, projectId);
		expect(coordinator.tools.map((tool) => tool.name)).toContain("worker_spawn");

		const unknown = await client.request({ type: "conversation.context", projectId, workerId: "nobody" });
		expect(errorOf(unknown).code).toBe("unknown_worker");

		// Watching a worker's conversation pushes its context too: a skill added while it runs reaches its next prompt.
		expect((await client.request({ type: "conversation.watch", projectId, workerId: "reader" })).type).toBe(
			"conversation.watch",
		);
		await mkdir(join(test.projectDir, ".pi", "skills", "review"), { recursive: true });
		await writeFile(
			join(test.projectDir, ".pi", "skills", "review", "SKILL.md"),
			"---\ndescription: How reviews are done here.\n---\n",
		);
		const { runtime } = await test.server.manager.open(projectId);
		const workerConversation = await runtime.workers.conversation("reader");
		if (workerConversation === undefined) throw new Error("the worker's conversation is missing");
		await workerConversation.submit({ type: "input", content: "Another look.", requestId: "w2" }, BACKGROUND_CONTEXT);
		const pushed = await client.waitFor(
			(message) =>
				message.type === "conversation.context.changed" &&
				message.context.workerId === "reader" &&
				message.context.skills.some((skill) => skill.name === "review"),
		);
		expect(pushed.type).toBe("conversation.context.changed");
	});

	it("refuses worker_spawn from a conversation that is not the coordinator", async () => {
		const test = await setup();
		const client = await connect(test.server);
		await greet(client);

		const BRIEF = "Summarize the project's README for me.";
		test.faux.setResponses(
			Array.from({ length: 30 }, () => (request: TranscriptContext) => {
				const { role, text } = lastMessage(request);
				if (role === "toolResult") return fauxAssistantMessage("Tool call finished.");
				if (text.includes("Nested work")) {
					return fauxAssistantMessage([fauxToolCall("worker_spawn", { id: "nested", task: "x" })], {
						stopReason: "toolUse",
					});
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

		// Give the worker back the extension that defines worker_spawn: the tool is then in its hands, and refused.
		const { runtime } = await test.server.manager.open(projectId);
		const workerConversation = await runtime.workers.conversation("reader");
		if (workerConversation === undefined) throw new Error("the worker's conversation is missing");
		await workerConversation.configure({ extensions: { add: [runtime.workers.extension] } }, BACKGROUND_CONTEXT);
		const context = await contextOf(client, projectId, "reader");
		expect(context.tools.map((tool) => tool.name)).toContain("worker_spawn");

		await workerConversation.submit(
			{ type: "input", content: "Nested work", requestId: "nested-work" },
			BACKGROUND_CONTEXT,
		);

		await until(async () => {
			const page = await client.request({
				type: "conversation.page",
				projectId,
				workerId: "reader",
				order: "ascending",
				limit: 200,
			});
			if (page.type !== "conversation.page") return false;
			return page.entries.some((entry) => entry.kind === "pi.tool-result");
		});
		const page = await client.request({
			type: "conversation.page",
			projectId,
			workerId: "reader",
			order: "ascending",
			limit: 200,
		});
		if (page.type !== "conversation.page") throw new Error(JSON.stringify(page));
		const result = page.entries.find((entry) => entry.kind === "pi.tool-result");
		expect(entryText(result!)).toContain("coordinator");

		// Nothing nested was started: the list still holds the one worker.
		const list = await client.request({ type: "workers.list", projectId });
		if (list.type !== "workers.list") throw new Error(JSON.stringify(list));
		expect(list.workers.map((worker) => worker.id)).toEqual(["reader"]);
	}, 60_000);
});

describe("system prompt files", () => {
	const SYSTEM_TEXT = "You are a terse assistant. Answer in one line.";
	const APPEND_TEXT = "- Follow the project's conventions.\n- Never force-push.";

	it("loads the harness's SYSTEM.md as the preamble and APPEND_SYSTEM.md after it, ahead of the project's files", async () => {
		const test = await setup();
		const client = await connect(test.server);
		await greet(client);

		await writeFile(join(test.configDir, "SYSTEM.md"), `${SYSTEM_TEXT}\n`);
		await writeFile(join(test.configDir, "APPEND_SYSTEM.md"), `${APPEND_TEXT}\n`);
		// pi's own files are not the harness's: its agent directory and project `.pi` files never reach the prompt.
		await writeFile(join(test.agentDir, "SYSTEM.md"), "You are pi.\n");
		await writeFile(join(test.agentDir, "APPEND_SYSTEM.md"), "pi's additions.\n");
		await mkdir(join(test.projectDir, ".pi"), { recursive: true });
		await writeFile(join(test.projectDir, ".pi", "SYSTEM.md"), "pi's project system prompt.\n");
		await writeFile(join(test.projectDir, ".pi", "APPEND_SYSTEM.md"), "pi's project additions.\n");

		await writeFile(join(test.projectDir, "AGENTS.md"), "# Project rules\nUse bun.\n");
		await mkdir(join(test.projectDir, ".pi", "skills", "testing"), { recursive: true });
		await writeFile(
			join(test.projectDir, ".pi", "skills", "testing", "SKILL.md"),
			"---\ndescription: How tests are written here.\n---\n",
		);

		const projectId = await addProject(client, test.projectDir);
		await configure(client, projectId);

		const context = await contextOf(client, projectId);
		expect(context.contextFiles.map((file) => [file.kind, file.path])).toEqual([
			["system", join(test.configDir, "SYSTEM.md")],
			["append", join(test.configDir, "APPEND_SYSTEM.md")],
			["agents", join(test.projectDir, "AGENTS.md")],
		]);

		// pi's order: the preamble (not wrapped in a tag), the addendum, the project's instructions, the skills.
		const prompt = context.systemPrompt;
		expect(prompt.startsWith(SYSTEM_TEXT)).toBe(true);
		expect(prompt).not.toContain("<preamble>");
		expect(prompt).toContain(`<addendum>\n${APPEND_TEXT}\n</addendum>`);
		expect(prompt.indexOf(SYSTEM_TEXT)).toBeLessThan(prompt.indexOf("<addendum>"));
		expect(prompt.indexOf("<addendum>")).toBeLessThan(prompt.indexOf("<context>"));
		expect(prompt.indexOf("<context>")).toBeLessThan(prompt.indexOf("<available_skills>"));

		// None of pi's own files are read.
		expect(prompt).not.toContain("You are pi.");
		expect(prompt).not.toContain("pi's additions.");
		expect(prompt).not.toContain("pi's project system prompt.");
		expect(prompt).not.toContain("pi's project additions.");

		// SYSTEM.md replaces the base instructions only: the harness's own sections are all still there.
		expect(prompt).toContain("<coordinator>");
		expect(prompt).toContain("You coordinate the project");
		expect(prompt).toContain("Use bun.");
		expect(prompt).toContain("How tests are written here.");
	});

	it("prefers the project's .aiki files over the config directory's and never combines them", async () => {
		const test = await setup();
		const client = await connect(test.server);
		await greet(client);

		await writeFile(join(test.configDir, "SYSTEM.md"), "Config system prompt.\n");
		await writeFile(join(test.configDir, "APPEND_SYSTEM.md"), "Config additions.\n");
		const projectHarnessDir = join(test.projectDir, ".aiki");
		await mkdir(projectHarnessDir, { recursive: true });
		await writeFile(join(projectHarnessDir, "SYSTEM.md"), "Project system prompt.\n");
		await writeFile(join(projectHarnessDir, "APPEND_SYSTEM.md"), "Project additions.\n");

		const projectId = await addProject(client, test.projectDir);
		await configure(client, projectId);

		const context = await contextOf(client, projectId);
		expect(context.contextFiles.map((file) => [file.kind, file.scope, file.path])).toEqual([
			["system", "project", join(projectHarnessDir, "SYSTEM.md")],
			["append", "project", join(projectHarnessDir, "APPEND_SYSTEM.md")],
		]);
		expect(context.systemPrompt.startsWith("Project system prompt.")).toBe(true);
		expect(context.systemPrompt).toContain("Project additions.");
		expect(context.systemPrompt).not.toContain("Config system prompt.");
		expect(context.systemPrompt).not.toContain("Config additions.");

		// Each file is taken on its own: with only the config directory's APPEND_SYSTEM.md left, that one applies again.
		await rm(join(projectHarnessDir, "APPEND_SYSTEM.md"));
		const onlyConfigAppend = await contextOf(client, projectId);
		expect(onlyConfigAppend.contextFiles.map((file) => [file.kind, file.scope])).toEqual([
			["system", "project"],
			["append", "global"],
		]);
		expect(onlyConfigAppend.systemPrompt).toContain("Config additions.");
	});

	it("keeps the prompt byte-identical across turns until a system prompt file changes", async () => {
		const test = await setup();
		const client = await connect(test.server);
		await greet(client);

		const systemFile = join(test.configDir, "SYSTEM.md");
		await writeFile(systemFile, `${SYSTEM_TEXT}\n`);
		await writeFile(join(test.configDir, "APPEND_SYSTEM.md"), `${APPEND_TEXT}\n`);

		// Every request the model gets, in order, so two turns can be compared byte for byte.
		const prompts: string[] = [];
		test.faux.setResponses(
			Array.from({ length: 20 }, () => (request: TranscriptContext) => {
				prompts.push(systemText(request));
				return fauxAssistantMessage("Done.");
			}),
		);

		const projectId = await addProject(client, test.projectDir);
		await configure(client, projectId);
		await client.request({ type: "conversation.submit", projectId, requestId: "s1", content: "First turn." });
		await until(async () => prompts.length === 1);
		const systemAfterFirst = await systemEntries(client, projectId);

		await client.request({ type: "conversation.submit", projectId, requestId: "s2", content: "Second turn." });
		await until(async () => prompts.length === 2);
		expect(prompts[1]).toBe(prompts[0]!);
		expect(await systemEntries(client, projectId)).toBe(systemAfterFirst);

		// An edit reaches the next turn, and only then does the prompt change.
		await writeFile(systemFile, `${SYSTEM_TEXT}\nBe kind.\n`);
		await client.request({ type: "conversation.submit", projectId, requestId: "s3", content: "Third turn." });
		await until(async () => prompts.length === 3);
		expect(prompts[2]).not.toBe(prompts[1]!);
		expect(prompts[2]).toContain("Be kind.");
		expect(await systemEntries(client, projectId)).toBeGreaterThan(systemAfterFirst);
	});

	it("gives the coordinator and its workers the files, and replaces neither one's sections", async () => {
		const test = await setup();
		const client = await connect(test.server);
		await greet(client);

		await mkdir(join(test.projectDir, ".aiki"), { recursive: true });
		await writeFile(join(test.projectDir, ".aiki", "SYSTEM.md"), `${SYSTEM_TEXT}\n`);
		await writeFile(join(test.configDir, "APPEND_SYSTEM.md"), `${APPEND_TEXT}\n`);

		const BRIEF = "Summarize the project's README for me.";
		test.faux.setResponses(
			Array.from({ length: 20 }, () => (request: TranscriptContext) => {
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
		await client.request({ type: "conversation.submit", projectId, requestId: "p1", content: "Delegate the reading." });
		await until(async () => {
			const list = await client.request({ type: "workers.list", projectId });
			return list.type === "workers.list" && list.workers.some((worker) => worker.id === "reader");
		});

		const coordinator = await contextOf(client, projectId);
		const worker = await contextOf(client, projectId, "reader");
		for (const context of [coordinator, worker]) {
			expect(context.contextFiles.map((file) => [file.kind, file.scope])).toEqual([
				["system", "project"],
				["append", "global"],
			]);
			expect(context.systemPrompt.startsWith(SYSTEM_TEXT)).toBe(true);
			expect(context.systemPrompt).toContain("Never force-push.");
		}

		// The harness's own role text survives the override: the coordinator keeps its section, the worker its instructions.
		expect(coordinator.systemPrompt).toContain("<coordinator>");
		expect(worker.systemPrompt).toContain('You are the worker "reader"');
		expect(worker.systemPrompt).not.toContain("<coordinator>");
	});
});

describe("model notes", () => {
	it("matches provider--model names with * as a wildcard and -- for /", () => {
		const codex = { provider: "openai-codex", modelId: "gpt-5.5" };
		expect(modelNotesMatch("openai-codex--gpt-*", codex)).toBe(true);
		expect(modelNotesMatch("openai-codex--gpt-5.5", codex)).toBe(true);
		expect(modelNotesMatch("openai-codex--gpt-5x5", codex)).toBe(false);
		expect(modelNotesMatch("openai--gpt-*", codex)).toBe(false);
		expect(modelNotesMatch("*", codex)).toBe(true);
		expect(modelNotesMatch("openrouter--anthropic--*", { provider: "openrouter", modelId: "anthropic/claude-x" })).toBe(true);
	});

	it("reads every matching file in name order, and other ones for another model", async () => {
		const configDir = await mkdtemp(join(tmpdir(), "model-notes-"));
		cleanups.push(() => rm(configDir, { recursive: true, force: true }));
		await mkdir(join(configDir, "models"), { recursive: true });
		await writeFile(join(configDir, "models", "openai-codex--gpt-*.md"), "GPT family.\n");
		await writeFile(join(configDir, "models", "*.md"), "Everyone.\n");
		await writeFile(join(configDir, "models", "claude-bridge--*.md"), "Claude.\n");
		await writeFile(join(configDir, "models", "notes.txt"), "Not a note.\n");
		const gpt = readModelNotes(configDir, { provider: "openai-codex", modelId: "gpt-5.5" });
		expect(gpt.map((file) => [file.kind, file.content])).toEqual([
			["model", "Everyone.\n"],
			["model", "GPT family.\n"],
		]);
		const claude = readModelNotes(configDir, { provider: "claude-bridge", modelId: "opus" });
		expect(claude.map((file) => file.content)).toEqual(["Everyone.\n", "Claude.\n"]);
		expect(readModelNotes(configDir, undefined)).toEqual([]);
	});

	it("appends the conversation's model notes to the prompt, stable until a file changes", async () => {
		const test = await setup();
		const client = await connect(test.server);
		await greet(client);
		await mkdir(join(test.configDir, "models"), { recursive: true });
		const notes = join(test.configDir, "models", "faux--faux-*.md");
		await writeFile(notes, "Keep answers short.\n");
		await writeFile(join(test.configDir, "models", "other--*.md"), "Not for faux.\n");

		const prompts: string[] = [];
		test.faux.setResponses(
			Array.from({ length: 20 }, () => (request: TranscriptContext) => {
				prompts.push(systemText(request));
				return fauxAssistantMessage("Done.");
			}),
		);
		const projectId = await addProject(client, test.projectDir);
		await configure(client, projectId);

		const context = await contextOf(client, projectId);
		expect(context.contextFiles.filter((file) => file.kind === "model").map((file) => file.path)).toEqual([notes]);
		expect(context.systemPrompt).toContain("Keep answers short.");
		expect(context.systemPrompt).not.toContain("Not for faux.");
		// The writing rule is part of the coordinator's own section.
		expect(context.systemPrompt).toContain("no labels you coined");

		await client.request({ type: "conversation.submit", projectId, requestId: "m1", content: "First turn." });
		await until(async () => prompts.length === 1);
		await client.request({ type: "conversation.submit", projectId, requestId: "m2", content: "Second turn." });
		await until(async () => prompts.length === 2);
		expect(prompts[1]).toBe(prompts[0]!);
		expect(prompts[0]).toContain("Keep answers short.");

		await writeFile(notes, "Keep answers very short.\n");
		await client.request({ type: "conversation.submit", projectId, requestId: "m3", content: "Third turn." });
		await until(async () => prompts.length === 3);
		expect(prompts[2]).toContain("Keep answers very short.");
	});
});

describe("Claude Code @imports", () => {
	async function tempDir(): Promise<string> {
		const dir = await mkdtemp(join(tmpdir(), "aiki-imports-"));
		cleanups.push(() => rm(dir, { recursive: true, force: true }));
		return dir;
	}

	it("expands a relative @import against the importing file's own folder", async () => {
		const dir = await tempDir();
		await mkdir(join(dir, "sub"), { recursive: true });
		await writeFile(join(dir, "sub", "CLAUDE.md"), "Rules.\nSee @README for the overview.\n");
		await writeFile(join(dir, "sub", "README"), "This is the overview.\n");

		const file = readContextFile(join(dir, "sub"));
		expect(file?.content).toContain("This is the overview.");
		expect(file?.content).not.toContain("@README");
	});

	it("resolves ~/ imports against home and leaves a missing import literal", () => {
		const content = expandClaudeImports("/does/not/matter/CLAUDE.md", "@~/nothing-here-xyz and @also-missing.md\n");
		expect(content).toBe("@~/nothing-here-xyz and @also-missing.md\n");
	});

	it("does not expand an import written inside backticks or a fenced code block", async () => {
		const dir = await tempDir();
		await writeFile(join(dir, "README"), "readme text\n");
		const content = expandClaudeImports(
			join(dir, "CLAUDE.md"),
			"Mention `@README` in prose.\n\n```\n@README\n```\n",
		);
		expect(content).not.toContain("readme text");
		expect(content).toContain("`@README`");
	});

	it("only CLAUDE.md carries imports; AGENTS.md's @token is left as text", async () => {
		const dir = await tempDir();
		await writeFile(join(dir, "README"), "readme text\n");
		const content = expandClaudeImports(join(dir, "AGENTS.md"), "See @README.\n");
		expect(content).toBe("See @README.\n");
	});

	it("expands imports recursively, up to four hops, and never revisits a file in its own chain", async () => {
		const dir = await tempDir();
		// A chain of six files, each importing the next: only the first four hops expand (the root plus three), so
		// the fifth file's own @import stays literal in the result.
		for (let index = 0; index <= CLAUDE_IMPORT_MAX_HOPS + 1; index += 1) {
			const next = index === CLAUDE_IMPORT_MAX_HOPS + 1 ? "the end" : `@level-${index + 1}.md`;
			await writeFile(join(dir, index === 0 ? "CLAUDE.md" : `level-${index}.md`), `level ${index}: ${next}\n`);
		}

		const root = readContextFile(dir);
		for (let index = 0; index <= CLAUDE_IMPORT_MAX_HOPS; index += 1) {
			expect(root?.content).toContain(`level ${index}:`);
		}
		// The file reached by the fourth hop is included, but its own import is not expanded further.
		expect(root?.content).toContain(`@level-${CLAUDE_IMPORT_MAX_HOPS + 1}.md`);
		expect(root?.content).not.toContain("the end");
	});

	it("a cycle of imports stops instead of looping", async () => {
		const dir = await tempDir();
		await writeFile(join(dir, "CLAUDE.md"), "root: @a.md\n");
		await writeFile(join(dir, "a.md"), "a: @b.md\n");
		await writeFile(join(dir, "b.md"), "b: @a.md\n");

		const file = readContextFile(dir);
		expect(file?.content).toContain("root:");
		expect(file?.content).toContain("a:");
		expect(file?.content).toContain("b:");
		// b's @a.md is a cycle back to the file already in the chain, so it is left as the literal token.
		expect(file?.content).toContain("@a.md");
	});
});
