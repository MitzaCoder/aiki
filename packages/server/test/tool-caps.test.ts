/** The coordinator's own tool calls are capped; workers keep their own, longer timeouts. */
import { afterEach, describe, expect, it } from "bun:test";
import type { FauxResponseFactory } from "@earendil-works/pi-ai/providers/faux";
import type { TranscriptContext } from "@earendil-works/pi-ai";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
import type { ConversationView, ModelRef } from "@aiki/protocol";
import { toolCapMessage } from "../src/tool-caps.ts";
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

function toolResults(view: ConversationView | undefined): ConversationView["entries"] {
	return view?.entries.filter((entry) => entry.kind === "pi.tool-result") ?? [];
}

describe("the coordinator's tool call cap", () => {
	it("stops a long bash call and tells the coordinator to delegate", async () => {
		const capMs = 200;
		const test = await setup({ toolCallCapMs: capMs });
		const client = await connect(test.server);
		await greet(client);
		const projectId = await addProject(client, test.projectDir);
		await configure(client, projectId);

		const script: FauxResponseFactory = (request) => {
			const { role, text } = lastMessage(request);
			if (role === "toolResult") return fauxAssistantMessage("Noted, I'll delegate next time.");
			if (text.includes("watch CI")) {
				return fauxAssistantMessage([fauxToolCall("bash", { command: "sleep 5 && echo done" })], {
					stopReason: "toolUse",
				});
			}
			return fauxAssistantMessage("Nothing to do.");
		};
		test.faux.setResponses(Array.from({ length: 10 }, () => script));

		const view = new ViewClient(client);
		await view.start(projectId);
		const startedAt = Date.now();
		const submitted = await client.request({
			type: "conversation.submit",
			projectId,
			requestId: "watch-ci-1",
			content: "Please watch CI for me.",
		});
		expect(submitted.type).toBe("conversation.submit");

		const withResult = await view.waitForView((value) => toolResults(value).length > 0);
		const elapsedMs = Date.now() - startedAt;
		// The command sleeps 5s; the cap must stop it in a small multiple of its own 200ms, nowhere near 5s.
		expect(elapsedMs).toBeLessThan(4_000);

		const [result] = toolResults(withResult);
		const text = entryText(result!);
		expect(text).toContain(toolCapMessage("bash", capMs));
		expect(text).toContain("worker_spawn");
		expect(text).toContain("schedule_save");

		await view.waitForView((value) =>
			value.entries.some((entry) => entry.kind === "pi.assistant" && entryText(entry).includes("delegate next time")),
		);
	}, 20_000);

	it("never caps a worker's bash call", async () => {
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
				return fauxAssistantMessage(
					[fauxToolCall("worker_spawn", { id: "runner", task: "sleep slowly, then answer" })],
					{ stopReason: "toolUse" },
				);
			}
			if (text.includes("sleep slowly")) {
				return fauxAssistantMessage([fauxToolCall("bash", { command: `sleep ${workerSleepMs / 1000} && echo slept` })], {
					stopReason: "toolUse",
				});
			}
			if (text.includes("reported]")) return fauxAssistantMessage("Report reviewed.");
			return fauxAssistantMessage("Nothing to do.");
		};
		test.faux.setResponses(Array.from({ length: 20 }, () => script));

		const view = new ViewClient(client);
		await view.start(projectId);
		const submitted = await client.request({
			type: "conversation.submit",
			projectId,
			requestId: "delegate-slow-1",
			content: "Please run a slow worker.",
		});
		expect(submitted.type).toBe("conversation.submit");

		const withReport = await view.waitForView((value) =>
			value.entries.some((entry) => entry.kind === "pi.user" && entryText(entry).startsWith("[worker runner reported]")),
		);
		const report = withReport.entries.find(
			(entry) => entry.kind === "pi.user" && entryText(entry).startsWith("[worker runner reported]"),
		)!;
		// The worker's own bash call ran past the coordinator's cap in full, uncapped: its sleep finished and reported.
		expect(entryText(report)).toContain("marker done");
	}, 20_000);
});
