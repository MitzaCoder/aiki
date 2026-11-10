/**
 * Memory maintenance: the nightly run, the run after enough writes, its status and settings.
 */
import { afterEach, describe, expect, it } from "bun:test";
import type { TranscriptContext } from "@earendil-works/pi-ai";
import type { SetTimer } from "@earendil-works/pi-durable";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
import type { MemoryChange, ModelRef } from "@aiki/protocol";
import { maintenanceSlotAtOrBefore, nextMaintenanceSlot } from "../src/memory-maintenance.ts";
import { createSetup, errorOf, TestClient, type TestSetup } from "./support.ts";

const cleanups: (() => Promise<void>)[] = [];
const clients: TestClient[] = [];

const FAUX: ModelRef = { provider: "faux", modelId: "faux-1" };
const START = Date.parse("2026-11-05T02:00:00Z");

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

/** A clock a test moves by hand; nothing fires on its own, so a test calls `wake()` when it wants the clock to look. */
function fakeClock(start = START): { now(): number; setTimer: SetTimer; advance(ms: number): void } {
	let now = start;
	return {
		now: () => now,
		setTimer: ((callback: () => void, delayMs: number) => {
			void callback;
			void delayMs;
			return () => undefined;
		}) as SetTimer,
		advance(ms: number): void {
			now += ms;
		},
	};
}

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

describe("maintenance", () => {
	const maintenanceReply = (request: TranscriptContext) => {
		if (!systemText(request).includes("You maintain a coding assistant")) return fauxAssistantMessage("Noted.");
		if (toolResultCount(request) === 0) {
			return fauxAssistantMessage(
				[
					fauxToolCall("memory_archive", { fileId: "old-ports", reason: "never retrieved" }),
					fauxToolCall("memory_write", {
						fileId: "testing",
						heading: "Suite",
						text: "Use `bun test`.",
						summary: "How this project runs its tests.",
						tags: ["bun", "testing"],
					}),
				],
				{ stopReason: "toolUse" },
			);
		}
		return fauxAssistantMessage("Archived the stale topic and fixed the summary.");
	};

	it("does nothing without a maintenance model, and says so in status", async () => {
		const clock = fakeClock();
		const test = await setup({ now: clock.now, setTimer: clock.setTimer, timezone: "UTC" });
		const client = await connect(test.server);
		await client.hello();
		const projectId = await addProject(client, test.projectDir);
		await seedTopic(test, projectId, { fileId: "testing", text: "Use `bun test`." });

		const status = await client.request({ type: "memory.status", scope: "project", projectId });
		if (status.type !== "memory.status") throw errorOf(status);
		expect(status.maintenance).toEqual({ model: null, thinkingLevel: null, time: "03:00", afterWrites: 20 });
		expect(status.status.nextMaintenanceAt).toBeNull();
		expect(status.status.lastMaintenance).toBeNull();
		expect(status.status.writesSinceMaintenance).toBe(1);
		expect(status.timezone).toBe("UTC");

		// No model: neither the nightly slot nor the write count starts anything.
		clock.advance(24 * 60 * 60_000);
		test.server.maintenanceClock.wake();
		await sleep(600);
		expect((await history(test, "project", projectId)).length).toBe(1);

		const maintain = await client.request({ type: "memory.maintain", scope: "project", projectId });
		expect(errorOf(maintain).code).toBe("bad_request");
	}, 30_000);

	it("maintains a scope after enough writes, one commit with a readable log", async () => {
		const clock = fakeClock();
		const test = await setup({ now: clock.now, setTimer: clock.setTimer, timezone: "UTC" });
		const client = await connect(test.server);
		await client.hello();
		const projectId = await addProject(client, test.projectDir);

		const saved = await client.request({
			type: "memory.settings.set",
			maintenance: { model: FAUX, thinkingLevel: "low", time: "23:59", afterWrites: 2 },
		});
		if (saved.type !== "memory.settings.set") throw errorOf(saved);
		expect(saved.maintenance.afterWrites).toBe(2);

		test.faux.setResponses(Array.from({ length: 20 }, () => maintenanceReply));
		await seedTopic(test, projectId, { fileId: "testing", heading: "Suite", text: "Use `bun test`." });
		await seedTopic(test, projectId, { fileId: "old-ports", title: "Old ports", text: "The server used port 7000." });

		await until(async () => {
			const status = await client.request({ type: "memory.status", scope: "project", projectId });
			return status.type === "memory.status" && status.status.lastMaintenance !== null;
		});
		const status = await client.request({ type: "memory.status", scope: "project", projectId });
		if (status.type !== "memory.status") throw errorOf(status);
		expect(status.status.maintaining).toBe(false);
		expect(status.status.writesSinceMaintenance).toBe(0);
		expect(status.status.lastMaintenance?.outcome).toBe("ok");
		expect(status.status.lastMaintenance?.commit).not.toBeNull();
		expect(status.status.nextMaintenanceAt).toBe(
			new Date(nextMaintenanceSlot("23:59", clock.now(), "UTC")).toISOString(),
		);

		const changes = await history(test, "project", projectId);
		const run = changes.find((change) => change.kind === "maintenance");
		if (run === undefined) throw new Error("no maintenance commit");
		expect(run.commit).toBe(status.status.lastMaintenance?.commit ?? "");
		expect([...run.files].sort()).toEqual(["old-ports", "testing"]);
		expect(run.undoable).toBe(true);
		expect(run.message).toContain("memory: maintenance");
		expect(run.message).toContain("- archive old-ports — never retrieved");
		expect(run.message).toContain("- update testing");

		const old = await test.server.manager.memory.read("project", projectId, "old-ports");
		expect(old.file.status).toBe("archived");
		const testing = await test.server.manager.memory.read("project", projectId, "testing");
		expect(testing.file.tags).toEqual(["bun", "testing"]);

		// The run is undoable as a whole.
		const undone = await client.request({ type: "memory.undo", scope: "project", projectId, commit: run.commit });
		if (undone.type !== "memory.undo") throw errorOf(undone);
		expect((await test.server.manager.memory.read("project", projectId, "old-ports")).file.status).toBe("active");

		// A restart does not run it again: nothing changed since the run.
		const before = (await history(test, "project", projectId)).length;
		await test.restart();
		await test.server.maintenanceClock.start();
		await sleep(600);
		expect((await history(test, "project", projectId)).length).toBe(before);
	}, 30_000);

	it("maintains a changed scope at its nightly time and once per night", async () => {
		const clock = fakeClock();
		const test = await setup({ now: clock.now, setTimer: clock.setTimer, timezone: "UTC" });
		const client = await connect(test.server);
		await client.hello();
		const projectId = await addProject(client, test.projectDir);
		await client.request({
			type: "memory.settings.set",
			maintenance: { model: FAUX, thinkingLevel: null, time: "03:00", afterWrites: 100 },
		});
		test.faux.setResponses(Array.from({ length: 20 }, () => maintenanceReply));
		await seedTopic(test, projectId, { fileId: "testing", text: "Use `bun test`." });

		// Not yet: the slot is far away and the write count is under the threshold.
		test.server.maintenanceClock.wake();
		await sleep(400);
		expect((await history(test, "project", projectId)).length).toBe(1);

		// Past 03:00: the scope changed since its last run, so it is maintained.
		clock.advance(90 * 60_000);
		expect(maintenanceSlotAtOrBefore("03:00", clock.now(), "UTC")).toBe(START + 60 * 60_000);
		test.server.maintenanceClock.wake();
		await until(async () => {
			const status = await client.request({ type: "memory.status", scope: "project", projectId });
			return status.type === "memory.status" && status.status.lastMaintenance !== null;
		});
		expect((await history(test, "project", projectId)).some((change) => change.kind === "maintenance")).toBe(true);
		const status = await client.request({ type: "memory.status", scope: "project", projectId });
		if (status.type !== "memory.status") throw errorOf(status);
		expect(status.status.lastMaintenance?.outcome).toBe("ok");

		// The same night does not run again; the next night with no changes does not either.
		const after = (await history(test, "project", projectId)).length;
		test.server.maintenanceClock.wake();
		await sleep(400);
		clock.advance(24 * 60 * 60_000);
		test.server.maintenanceClock.wake();
		await sleep(600);
		expect((await history(test, "project", projectId)).length).toBe(after);
	}, 30_000);

	it("records a failed run and runs nothing twice", async () => {
		const clock = fakeClock();
		const test = await setup({ now: clock.now, setTimer: clock.setTimer, timezone: "UTC" });
		const client = await connect(test.server);
		await client.hello();
		const projectId = await addProject(client, test.projectDir);
		await client.request({
			type: "memory.settings.set",
			maintenance: { model: FAUX, thinkingLevel: null, time: "03:00", afterWrites: 1 },
		});
		test.faux.setResponses(
			Array.from({ length: 10 }, () => (request: TranscriptContext) => {
				if (!systemText(request).includes("You maintain a coding assistant")) return fauxAssistantMessage("Noted.");
				return fauxAssistantMessage("", { stopReason: "error", errorMessage: "provider is down" });
			}),
		);
		await seedTopic(test, projectId, { fileId: "testing", text: "Use `bun test`." });

		await until(async () => {
			const status = await client.request({ type: "memory.status", scope: "project", projectId });
			return status.type === "memory.status" && status.status.lastMaintenance !== null;
		});
		const status = await client.request({ type: "memory.status", scope: "project", projectId });
		if (status.type !== "memory.status") throw errorOf(status);
		expect(status.status.lastMaintenance?.outcome).toBe("failed");
		expect(status.status.lastMaintenance?.message).toContain("provider is down");
		expect(status.status.lastMaintenance?.commit).toBeNull();
		expect(status.status.writesSinceMaintenance).toBe(0);
		expect((await history(test, "project", projectId)).length).toBe(1);
	}, 30_000);

	it("runs one scope at a time through memory.maintain", async () => {
		const clock = fakeClock();
		const test = await setup({ now: clock.now, setTimer: clock.setTimer, timezone: "UTC" });
		const client = await connect(test.server);
		await client.hello();
		const projectId = await addProject(client, test.projectDir);
		await client.request({
			type: "memory.settings.set",
			maintenance: { model: FAUX, thinkingLevel: null, time: "03:00", afterWrites: 100 },
		});
		let release: (() => void) | undefined;
		let began: () => void = () => undefined;
		const beganPromise = new Promise<void>((resolve) => {
			began = resolve;
		});
		test.faux.setResponses(
			Array.from({ length: 10 }, () => async (request: TranscriptContext) => {
				if (!systemText(request).includes("You maintain a coding assistant")) return fauxAssistantMessage("Noted.");
				began();
				await new Promise<void>((resolve) => {
					release = resolve;
				});
				return fauxAssistantMessage("Nothing to change.");
			}),
		);
		await seedTopic(test, projectId, { fileId: "testing", text: "Use `bun test`." });

		const started = await client.request({ type: "memory.maintain", scope: "project", projectId });
		expect(started.type).toBe("memory.maintain");
		await beganPromise;
		await until(async () => {
			const status = await client.request({ type: "memory.status", scope: "project", projectId });
			return status.type === "memory.status" && status.status.maintaining;
		});
		// A second request while it runs starts nothing and does not fail.
		const second = await client.request({ type: "memory.maintain", scope: "project", projectId });
		expect(second.type).toBe("memory.maintain");
		release?.();
		await until(async () => {
			const status = await client.request({ type: "memory.status", scope: "project", projectId });
			return status.type === "memory.status" && !status.status.maintaining;
		});
		const status = await client.request({ type: "memory.status", scope: "project", projectId });
		if (status.type !== "memory.status") throw errorOf(status);
		expect(status.status.lastMaintenance?.outcome).toBe("nothing_to_do");
	}, 30_000);

	it("refuses an unknown project and an unknown model", async () => {
		const clock = fakeClock();
		const test = await setup({ now: clock.now, setTimer: clock.setTimer, timezone: "UTC" });
		const client = await connect(test.server);
		await client.hello();
		const missing = await client.request({ type: "memory.status", scope: "project", projectId: "nope" });
		expect(errorOf(missing).code).toBe("unknown_project");
		const noProject = await client.request({ type: "memory.status", scope: "project" });
		expect(errorOf(noProject).code).toBe("bad_request");
		const badModel = await client.request({
			type: "memory.settings.set",
			maintenance: { model: { provider: "nope", modelId: "nope-1" }, thinkingLevel: null, time: "03:00", afterWrites: 20 },
		});
		expect(errorOf(badModel).code).toBe("unknown_model");
		const global = await client.request({ type: "memory.status", scope: "global" });
		if (global.type !== "memory.status") throw errorOf(global);
		expect(global.status.scope).toBe("global");
		expect(global.status.projectId).toBeNull();
	});
});
