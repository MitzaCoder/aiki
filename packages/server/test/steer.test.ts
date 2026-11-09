/**
 * A message to a busy coordinator reaches the model at its next tool boundary (`whenBusy: "steer"`), instead of
 * waiting for the whole turn to end (`"followUp"`), so the user is never stuck behind a long-running tool call.
 */
import { afterEach, describe, expect, it } from "bun:test";
import type { FauxResponseFactory } from "@earendil-works/pi-ai/providers/faux";
import type { TranscriptContext } from "@earendil-works/pi-ai";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
import type { ModelRef } from "@mihai-harness/protocol";
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

/** Every non-system message's text joined, so a request's whole context can be searched for a steered message. */
function allText(request: TranscriptContext): string {
	return request.messages
		.filter((message) => message.role !== "system")
		.map(messageText)
		.join("\n");
}

function lastRole(request: TranscriptContext): string {
	return request.messages.findLast((message) => message.role !== "system")?.role ?? "";
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
	});
	expect(response.type).toBe("projects.configure");
}

describe("steering a busy coordinator", () => {
	it("places a steered message before the turn's next model request, not after it ends", async () => {
		const test = await setup();
		const client = await connect(test.server);
		await greet(client);
		const projectId = await addProject(client, test.projectDir);
		await configure(client, projectId);

		const STEERED = "by the way, also check the staging environment";
		let sawSteeredInRound2 = false;
		const script: FauxResponseFactory = (request) => {
			const role = lastRole(request);
			if (role === "user") {
				// Round 1: a tool call slow enough that the steered message is submitted while it still runs.
				return fauxAssistantMessage([fauxToolCall("bash", { command: "sleep 0.4 && echo first" })], {
					stopReason: "toolUse",
				});
			}
			if (role === "toolResult") {
				sawSteeredInRound2 = allText(request).includes(STEERED);
				return fauxAssistantMessage(sawSteeredInRound2 ? "saw the steered message" : "did not see it");
			}
			return fauxAssistantMessage("unexpected");
		};
		test.faux.setResponses(Array.from({ length: 10 }, () => script));

		const view = new ViewClient(client);
		await view.start(projectId);
		const submitted = await client.request({
			type: "conversation.submit",
			projectId,
			requestId: "start-task",
			content: "start the slow task",
		});
		expect(submitted.type).toBe("conversation.submit");

		// Give round 1's bash call time to start before steering in, so the steered message is queued while it runs.
		await new Promise((resolve) => setTimeout(resolve, 100));
		const steered = await client.request({
			type: "conversation.submit",
			projectId,
			requestId: "steer-1",
			content: STEERED,
			whenBusy: "steer",
		});
		expect(steered.type).toBe("conversation.submit");

		const withAnswer = await view.waitForView((value) =>
			value.entries.some((entry) => entry.kind === "pi.assistant" && entryText(entry).includes("saw the steered message")),
		);
		expect(sawSteeredInRound2).toBe(true);

		// It landed mid-turn, between the bash result and the final answer, as its own user entry — not merged or dropped.
		const kinds = withAnswer.entries.map((entry) => entry.kind);
		const toolResultIndex = kinds.indexOf("pi.tool-result");
		const steeredIndex = withAnswer.entries.findIndex(
			(entry) => entry.kind === "pi.user" && entryText(entry) === STEERED,
		);
		const finalIndex = withAnswer.entries.findIndex(
			(entry) => entry.kind === "pi.assistant" && entryText(entry).includes("saw the steered message"),
		);
		expect(toolResultIndex).toBeGreaterThanOrEqual(0);
		expect(steeredIndex).toBeGreaterThan(toolResultIndex);
		expect(finalIndex).toBeGreaterThan(steeredIndex);
	}, 20_000);
});
