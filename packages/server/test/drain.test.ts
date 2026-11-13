/**
 * `server.drain`: new tool calls wait while it lasts, `busy.toolCalls` counts the executing ones, and a call held when
 * the server restarts runs after the restart instead of being reported interrupted.
 */
import { afterEach, describe, expect, it } from "bun:test";
import { BACKGROUND_CONTEXT, withCancel } from "@earendil-works/chord/context";
import type { TranscriptContext } from "@earendil-works/pi-ai";
import type { FauxResponseFactory } from "@earendil-works/pi-ai/providers/faux";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
import type { ConversationView, ModelRef, ServerStatus } from "@kemiri/protocol";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ToolCallDrain } from "../src/drain.ts";
import { createSetup, entryText, TestClient, ViewClient, type TestSetup } from "./support.ts";

const cleanups: (() => Promise<void>)[] = [];
const clients: TestClient[] = [];

const FAUX: ModelRef = { provider: "faux", modelId: "faux-1" };

afterEach(async () => {
	for (const client of clients.splice(0)) client.close();
	for (const cleanup of cleanups.splice(0)) await cleanup();
});

async function setup(): Promise<TestSetup> {
	const created = await createSetup();
	cleanups.push(created.cleanup);
	return created;
}

async function connect(server: TestSetup["server"]): Promise<TestClient> {
	const client = await TestClient.open(server);
	clients.push(client);
	expect((await client.hello()).type).toBe("hello");
	return client;
}

async function addProject(client: TestClient, path: string): Promise<string> {
	const response = await client.request({ type: "projects.add", path });
	if (response.type !== "projects.add") throw new Error(JSON.stringify(response));
	const configured = await client.request({
		type: "projects.configure",
		projectId: response.project.id,
		coordinatorModel: FAUX,
		coordinatorThinkingLevel: "low",
		workerModels: [FAUX],
	});
	expect(configured.type).toBe("projects.configure");
	return response.project.id;
}

async function status(client: TestClient): Promise<ServerStatus> {
	const response = await client.request({ type: "server.status" });
	if (response.type !== "server.status") throw new Error(JSON.stringify(response));
	return response.status;
}

async function drain(client: TestClient, timeoutMs?: number): Promise<{ drainingUntil: string | null; toolCalls: number }> {
	const response = await client.request({ type: "server.drain", ...(timeoutMs === undefined ? {} : { timeoutMs }) });
	if (response.type !== "server.drain") throw new Error(JSON.stringify(response));
	return { drainingUntil: response.drainingUntil, toolCalls: response.toolCalls };
}

function lastUserText(request: TranscriptContext): { role: string; text: string } {
	const last = request.messages.findLast((message) => message.role !== "system");
	const content = last?.content;
	const text = typeof content === "string" ? content : Array.isArray(content) ? content.map((part) => ("text" in part ? part.text : "")).join("") : "";
	return { role: last?.role ?? "", text };
}

/** The model runs `command` once for a message containing `trigger`, then answers "done". */
function runOnce(trigger: string, command: string): FauxResponseFactory {
	return (request) => {
		const { role, text } = lastUserText(request);
		if (role === "toolResult") return fauxAssistantMessage("done");
		if (text.includes(trigger)) return fauxAssistantMessage([fauxToolCall("bash", { command })], { stopReason: "toolUse" });
		return fauxAssistantMessage("Nothing to do.");
	};
}

function toolResults(view: ConversationView | undefined): ConversationView["entries"] {
	return view?.entries.filter((entry) => entry.kind === "pi.tool-result") ?? [];
}

async function waitFor(predicate: () => boolean | Promise<boolean>, timeoutMs = 5_000): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (!(await predicate())) {
		if (Date.now() > deadline) throw new Error("timed out waiting");
		await Bun.sleep(20);
	}
}

describe("ToolCallDrain", () => {
	it("holds until the drain ends, by request or by its timeout, and lets an abort through", async () => {
		const drain = new ToolCallDrain({ log: () => undefined });
		await drain.hold(BACKGROUND_CONTEXT);

		drain.drain(60_000);
		let released = false;
		const held = drain.hold(BACKGROUND_CONTEXT).then(() => (released = true));
		await Bun.sleep(20);
		expect(released).toBe(false);
		drain.drain(0);
		await held;
		expect(drain.drainingUntil).toBeUndefined();

		drain.drain(50);
		const startedAt = Date.now();
		await drain.hold(BACKGROUND_CONTEXT);
		expect(Date.now() - startedAt).toBeGreaterThanOrEqual(40);

		drain.drain(60_000);
		const { context, cancel } = withCancel(BACKGROUND_CONTEXT);
		const aborted = drain.hold(context);
		cancel(new Error("conversation aborted"));
		await expect(aborted).rejects.toThrow("conversation aborted");
		drain.end();
	});
});

it("an explicit update hold survives deploy timeout/end and releases independently", async () => {
	const drain = new ToolCallDrain({ log: () => {} });
	const release = drain.acquire();
	drain.drain(10);
	let ran = false;
	const held = drain.hold(BACKGROUND_CONTEXT).then(() => { ran = true; });
	await Bun.sleep(30); drain.end(); expect(ran).toBe(false);
	release(); release(); await held; expect(ran).toBe(true);
});

describe("server.drain", () => {
	it("holds new tool calls until the drain ends and counts the executing ones", async () => {
		const test = await setup();
		const client = await connect(test.server);
		const projectId = await addProject(client, test.projectDir);
		const view = new ViewClient(client);
		await view.start(projectId);

		// Counted while executing.
		test.faux.setResponses(Array.from({ length: 6 }, () => runOnce("slow", "sleep 0.6 && echo slept")));
		expect((await status(client)).busy.toolCalls).toBe(0);
		await client.request({ type: "conversation.submit", projectId, requestId: "slow-1", content: "run something slow" });
		await waitFor(async () => (await status(client)).busy.toolCalls === 1);
		await view.waitForView((value) => toolResults(value).length === 1);
		expect((await status(client)).busy.toolCalls).toBe(0);

		// Held while draining: no result and nothing executing, then it runs once the drain ends.
		const started = await drain(client, 60_000);
		expect(started.drainingUntil).not.toBeNull();
		expect(started.toolCalls).toBe(0);
		test.faux.setResponses(Array.from({ length: 6 }, () => runOnce("held", "echo held-ran")));
		await client.request({ type: "conversation.submit", projectId, requestId: "held-1", content: "run the held command" });
		await waitFor(() => test.faux.state.callCount >= 3);
		await Bun.sleep(300);
		expect(toolResults(view.view).length).toBe(1);
		expect((await status(client)).busy.toolCalls).toBe(0);

		expect((await drain(client, 0)).drainingUntil).toBeNull();
		const after = await view.waitForView((value) => toolResults(value).length === 2);
		expect(entryText(toolResults(after)[1]!)).toContain("held-ran");
	}, 20_000);

	it("runs a call held at a restart after the restart, once, instead of reporting it interrupted", async () => {
		const test = await setup();
		const client = await connect(test.server);
		const projectId = await addProject(client, test.projectDir);
		const view = new ViewClient(client);
		await view.start(projectId);
		const marker = join(test.projectDir, "marker.txt");

		await drain(client, 60_000);
		test.faux.setResponses(Array.from({ length: 10 }, () => runOnce("mark", `echo ran >> ${marker}`)));
		await client.request({ type: "conversation.submit", projectId, requestId: "mark-1", content: "mark the file" });
		await waitFor(() => test.faux.state.callCount >= 1);
		await Bun.sleep(300);
		expect(existsSync(marker)).toBe(false);

		const restarted = await test.restart();
		const next = await connect(restarted);
		const nextView = new ViewClient(next);
		await nextView.start(projectId);
		const done = await nextView.waitForView((value) => toolResults(value).length === 1);
		expect(readFileSync(marker, "utf8")).toBe("ran\n");
		const result = entryText(toolResults(done)[0]!);
		expect(result).not.toContain("interrupted");
		await nextView.waitForView((value) =>
			value.entries.some((entry) => entry.kind === "pi.assistant" && entryText(entry).includes("done")),
		);
	}, 20_000);
});
