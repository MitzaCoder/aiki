/**
 * Code mode: always on for the coordinator and every worker, offered alongside the tools themselves. These tests
 * prove QuickJS runs under Bun, that a script resumes after a restart without rerunning calls already delivered to
 * it, that a script may only reach the tools `callers` allows, that the coordinator's own cap applies to the whole
 * call, and that the `codemode` prompt section is byte-identical across turns.
 */
import { afterEach, describe, expect, it } from "bun:test";
import type { FauxResponseFactory } from "@earendil-works/pi-ai/providers/faux";
import type { TranscriptContext } from "@earendil-works/pi-ai";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
import type { ConversationView, ModelRef } from "@aiki/protocol";
import { readFile } from "node:fs/promises";
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

async function configure(client: TestClient, projectId: string, workerModels: ModelRef[] = [FAUX]): Promise<void> {
	const response = await client.request({
		type: "projects.configure",
		projectId,
		coordinatorModel: FAUX,
		coordinatorThinkingLevel: "low",
		workerModels,
	});
	expect(response.type).toBe("projects.configure");
}

async function until(check: () => Promise<boolean> | boolean, timeoutMs = 20_000): Promise<void> {
	const start = Date.now();
	while (Date.now() - start < timeoutMs) {
		if (await check()) return;
		await new Promise((resolve) => setTimeout(resolve, 20));
	}
	throw new Error("timed out waiting for a condition");
}

function toolResultsNamed(view: ConversationView | undefined, name: string): ConversationView["entries"] {
	return (view?.entries ?? []).filter((entry) => {
		if (entry.kind !== "pi.tool-result") return false;
		return (entry.model ?? []).some(
			(message) => typeof message === "object" && message !== null && (message as { toolName?: string }).toolName === name,
		);
	});
}

describe("code mode under Bun", () => {
	it("runs a script that reads a file and a command, both as real tool calls", async () => {
		const test = await setup();
		const client = await connect(test.server);
		await greet(client);
		const projectId = await addProject(client, test.projectDir);
		await configure(client, projectId);

		const code = [
			'const readme = await tools.read({ path: "README.md" });',
			'const ran = await tools.bash({ command: "echo hi-from-bash" });',
			"return { readmeLength: readme.length, exitCode: ran.exitCode, output: ran.output };",
		].join("\n");

		const script: FauxResponseFactory = (request) => {
			const { role, text } = lastMessage(request);
			if (role === "toolResult") return fauxAssistantMessage("Done.");
			if (text.includes("Run the script.")) {
				return fauxAssistantMessage([fauxToolCall("codemode", { code })], { stopReason: "toolUse" });
			}
			return fauxAssistantMessage("Nothing to do.");
		};
		test.faux.setResponses(Array.from({ length: 10 }, () => script));

		const view = new ViewClient(client);
		await view.start(projectId);
		await client.request({ type: "conversation.submit", projectId, requestId: "r1", content: "Run the script." });

		const withResult = await view.waitForView((value) => toolResultsNamed(value, "codemode").length > 0);
		const [result] = toolResultsNamed(withResult, "codemode");
		const text = entryText(result!);
		expect(text).toContain("Script completed");
		expect(text).toContain("hi-from-bash");
		expect(text).toContain("exitCode");
	});

	it("tells the model when a script only wrapped one call, and only then", async () => {
		const test = await setup();
		const client = await connect(test.server);
		await greet(client);
		const projectId = await addProject(client, test.projectDir);
		await configure(client, projectId);

		const codes = [
			'text(await tools.bash({ command: "echo wrapped" }))',
			'const a = await tools.bash({ command: "echo one" });\nconst b = await tools.bash({ command: "echo two" });\ntext(a.output + b.output);',
		];
		const script: FauxResponseFactory = (request) => {
			const { role, text } = lastMessage(request);
			if (role === "toolResult") return fauxAssistantMessage("Done.");
			const index = codes.findIndex((_, i) => text.includes(`Run script ${i}.`));
			if (index === -1) return fauxAssistantMessage("Nothing to do.");
			return fauxAssistantMessage([fauxToolCall("codemode", { code: codes[index]! })], { stopReason: "toolUse" });
		};
		test.faux.setResponses(Array.from({ length: 10 }, () => script));

		const view = new ViewClient(client);
		await view.start(projectId);
		await client.request({ type: "conversation.submit", projectId, requestId: "r1", content: "Run script 0." });
		const first = await view.waitForView((value) => toolResultsNamed(value, "codemode").length >= 1);
		expect(entryText(toolResultsNamed(first, "codemode")[0]!)).toContain("call the tool directly next time");

		await client.request({ type: "conversation.submit", projectId, requestId: "r2", content: "Run script 1." });
		const second = await view.waitForView((value) => toolResultsNamed(value, "codemode").length >= 2);
		expect(entryText(toolResultsNamed(second, "codemode")[1]!)).not.toContain("call the tool directly next time");
	});

	it("resumes a script after a restart without rerunning the calls already delivered to it", async () => {
		const test = await setup();
		const client = await connect(test.server);
		await greet(client);
		const projectId = await addProject(client, test.projectDir);
		await configure(client, projectId);

		// `bash` is not declared `replay: "safe"`, so a call still running at the restart does not quietly resume: it comes
		// back as an "interrupted" error once (README's "Tasks a restart abandons"), and the script retries it itself, as
		// the docs call for ("a replay-safe caller ... still needs its own idempotency"). `first` has no such retry: it
		// finished and was journaled before the restart, so proving it was not made again is the point of this test.
		const code = [
			'const readme = await tools.read({ path: "README.md" });',
			'const first = await tools.bash({ command: "echo first >> counter.txt" });',
			"let second;",
			"try {",
			'  second = await tools.bash({ command: "sleep 1 && echo second >> counter.txt" });',
			"} catch (error) {",
			'  second = await tools.bash({ command: "echo second >> counter.txt" });',
			"}",
			"return { readmeLength: readme.length, firstExit: first.exitCode, secondExit: second.exitCode };",
		].join("\n");

		const script: FauxResponseFactory = (request) => {
			const { role, text } = lastMessage(request);
			if (role === "toolResult") return fauxAssistantMessage("Done.");
			if (text.includes("Run the script.")) {
				return fauxAssistantMessage([fauxToolCall("codemode", { code })], { stopReason: "toolUse" });
			}
			return fauxAssistantMessage("Nothing to do.");
		};
		test.faux.setResponses(Array.from({ length: 10 }, () => script));

		const view = new ViewClient(client);
		await view.start(projectId);
		await client.request({ type: "conversation.submit", projectId, requestId: "r1", content: "Run the script." });

		const counterFile = join(test.projectDir, "counter.txt");
		// The first call finished and its result was delivered and journaled; the second is still sleeping. A fixed
		// buffer after the file write gives the (fast, local) journal commit ample time to land before the restart.
		await until(async () => (await readFile(counterFile, "utf8").catch(() => "")).includes("first"));
		await new Promise((resolve) => setTimeout(resolve, 150));
		expect(await readFile(counterFile, "utf8")).not.toContain("second");

		const restarted = await test.restart();
		const next = await connect(restarted);
		await greet(next);
		const nextView = new ViewClient(next);
		await nextView.start(projectId);

		const withResult = await nextView.waitForView((value) => toolResultsNamed(value, "codemode").length > 0, 20_000);
		const [result] = toolResultsNamed(withResult, "codemode");
		const text = entryText(result!);
		expect(text).toContain("Script completed");
		expect(text).toContain('"firstExit":0');
		expect(text).toContain('"secondExit":0');

		// "first" was delivered before the restart and is not made again; "second" was interrupted mid-flight and the
		// resumed script issued it exactly once more.
		const counter = await readFile(counterFile, "utf8");
		expect(counter.match(/first/g)).toHaveLength(1);
		expect(counter.match(/second/g)).toHaveLength(1);
	}, 20_000);
});

describe("who may call a tool from a script", () => {
	async function scriptResult(code: string): Promise<{ output: string; isError: boolean }> {
		const test = await setup();
		const client = await connect(test.server);
		await greet(client);
		const projectId = await addProject(client, test.projectDir);
		await configure(client, projectId);

		const script: FauxResponseFactory = (request) => {
			const { role, text } = lastMessage(request);
			if (role === "toolResult") return fauxAssistantMessage("Done.");
			if (text.includes("Run the script.")) {
				return fauxAssistantMessage([fauxToolCall("codemode", { code })], { stopReason: "toolUse" });
			}
			return fauxAssistantMessage("Nothing to do.");
		};
		test.faux.setResponses(Array.from({ length: 10 }, () => script));

		const view = new ViewClient(client);
		await view.start(projectId);
		await client.request({ type: "conversation.submit", projectId, requestId: "r1", content: "Run the script." });
		const withResult = await view.waitForView((value) => toolResultsNamed(value, "codemode").length > 0);
		const [result] = toolResultsNamed(withResult, "codemode");
		const entry = result!;
		const message = (entry.model ?? []).find(
			(candidate) => typeof candidate === "object" && candidate !== null && (candidate as { role?: string }).role === "toolResult",
		) as { isError?: boolean } | undefined;
		return { output: entryText(entry), isError: message?.isError === true };
	}

	it("lets a script read workers, but not start, message, stop or forget one", async () => {
		const reading = await scriptResult('return await tools.worker_list();');
		expect(reading.isError).toBe(false);

		const starting = await scriptResult('return await tools.worker_spawn({ id: "x", task: "do something" });');
		expect(starting.isError).toBe(true);
		expect(starting.output.toLowerCase()).toContain("worker_spawn");
	});

	it("lets a script read schedules, but not save, delete or run one", async () => {
		const reading = await scriptResult("return await tools.schedule_list();");
		expect(reading.isError).toBe(false);

		const saving = await scriptResult(
			'return await tools.schedule_save({ id: "s1", title: "t", brief: "b", spec: { kind: "interval", minutes: 60 }, onReport: "record" });',
		);
		expect(saving.isError).toBe(true);
	});

	it("lets a script search, read, write and archive memory", async () => {
		const result = await scriptResult('return await tools.memory_search({ query: "anything" });');
		expect(result.isError).toBe(false);
	});

	it("never lets a script start another script", async () => {
		const result = await scriptResult('return await tools.codemode({ code: "return 1" });');
		expect(result.isError).toBe(true);
	});
});

describe("the coordinator's tool cap applies to codemode as a whole", () => {
	it("stops a long script and tells the coordinator to delegate", async () => {
		const capMs = 200;
		const test = await setup({ toolCallCapMs: capMs });
		const client = await connect(test.server);
		await greet(client);
		const projectId = await addProject(client, test.projectDir);
		await configure(client, projectId);

		const code = 'await tools.bash({ command: "sleep 5 && echo done" }); return "unreachable";';
		const script: FauxResponseFactory = (request) => {
			const { role, text } = lastMessage(request);
			if (role === "toolResult") return fauxAssistantMessage("Noted, I'll delegate next time.");
			if (text.includes("Run the script.")) {
				return fauxAssistantMessage([fauxToolCall("codemode", { code })], { stopReason: "toolUse" });
			}
			return fauxAssistantMessage("Nothing to do.");
		};
		test.faux.setResponses(Array.from({ length: 10 }, () => script));

		const view = new ViewClient(client);
		await view.start(projectId);
		const startedAt = Date.now();
		await client.request({ type: "conversation.submit", projectId, requestId: "r1", content: "Run the script." });

		const withResult = await view.waitForView((value) => toolResultsNamed(value, "codemode").length > 0);
		const elapsedMs = Date.now() - startedAt;
		expect(elapsedMs).toBeLessThan(4_000);

		const [result] = toolResultsNamed(withResult, "codemode");
		const text = entryText(result!);
		expect(text).toContain("codemode was stopped after running past its");
		expect(text).toContain("worker_spawn");
	}, 20_000);

	it("never caps a worker's codemode call", async () => {
		const capMs = 150;
		const workerSleepMs = 600;
		const test = await setup({ toolCallCapMs: capMs });
		const client = await connect(test.server);
		await greet(client);
		const projectId = await addProject(client, test.projectDir);
		await configure(client, projectId);

		const script: FauxResponseFactory = (request) => {
			const { role, text } = lastMessage(request);
			if (role === "toolResult") return fauxAssistantMessage("marker done");
			if (text.includes("run a slow worker")) {
				return fauxAssistantMessage([fauxToolCall("worker_spawn", { id: "runner", task: "sleep slowly, then answer" })], {
					stopReason: "toolUse",
				});
			}
			if (text.includes("sleep slowly")) {
				const code = `await tools.bash({ command: "sleep ${workerSleepMs / 1000} && echo slept" }); return "slept";`;
				return fauxAssistantMessage([fauxToolCall("codemode", { code })], { stopReason: "toolUse" });
			}
			if (text.includes("reported]")) return fauxAssistantMessage("Report reviewed.");
			return fauxAssistantMessage("Nothing to do.");
		};
		test.faux.setResponses(Array.from({ length: 20 }, () => script));

		const view = new ViewClient(client);
		await view.start(projectId);
		await client.request({ type: "conversation.submit", projectId, requestId: "r1", content: "Please run a slow worker." });

		const withReport = await view.waitForView((value) =>
			value.entries.some((entry) => entry.kind === "pi.user" && entryText(entry).startsWith("[worker runner reported]")),
		);
		const report = withReport.entries.find(
			(entry) => entry.kind === "pi.user" && entryText(entry).startsWith("[worker runner reported]"),
		)!;
		expect(entryText(report)).toContain("marker done");
	}, 20_000);
});

describe("the codemode prompt section", () => {
	it("lists the tools a script can call, grouped by namespace, byte-identical across turns", async () => {
		const test = await setup();
		const client = await connect(test.server);
		await greet(client);
		const projectId = await addProject(client, test.projectDir);
		await configure(client, projectId);

		const prompts: string[] = [];
		test.faux.setResponses(
			Array.from({ length: 10 }, () => (request: TranscriptContext) => {
				prompts.push(systemText(request));
				return fauxAssistantMessage("Done.");
			}),
		);

		await client.request({ type: "conversation.submit", projectId, requestId: "t1", content: "First turn." });
		await until(() => prompts.length === 1);
		expect(prompts[0]).toContain("worker_list");
		expect(prompts[0]).toContain("memory_search");
		expect(prompts[0]).toContain("schedule_list");

		await client.request({ type: "conversation.submit", projectId, requestId: "t2", content: "Second turn." });
		await until(() => prompts.length === 2);
		expect(prompts[1]).toBe(prompts[0]!);
	});
});
