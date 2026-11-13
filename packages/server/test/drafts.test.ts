/**
 * Chat drafts: get and set with revisions and conflicts, the clear when a message is submitted, expiry, size caps, pushes
 * to the other connections, attachments, persistence across a restart, and the feature flag.
 */
import { afterEach, describe, expect, it } from "bun:test";
import { fauxAssistantMessage } from "@earendil-works/pi-ai/providers/faux";
import { HARNESS_FEATURES, type ChatDraft, type DraftContent, type ServerMessage } from "@kemiri/protocol";
import { mkdtemp, readdir, rm, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DraftStore } from "../src/drafts.ts";
import { createSetup, errorOf, TestClient, type TestSetup } from "./support.ts";

const cleanups: (() => Promise<void>)[] = [];
const clients: TestClient[] = [];
const DAY = 24 * 60 * 60_000;
const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");

afterEach(async () => {
	for (const client of clients.splice(0)) client.close();
	for (const cleanup of cleanups.splice(0)) await cleanup();
});

async function start(options?: Parameters<typeof createSetup>[0]): Promise<{ test: TestSetup; client: TestClient; projectId: string }> {
	const test = await createSetup(options);
	cleanups.push(test.cleanup);
	const client = await connect(test.server);
	const added = await client.request({ type: "projects.add", path: test.projectDir });
	if (added.type !== "projects.add") throw errorOf(added);
	return { test, client, projectId: added.project.id };
}

async function connect(server: TestSetup["server"]): Promise<TestClient> {
	const client = await TestClient.open(server);
	clients.push(client);
	await client.hello();
	return client;
}

const content = (text: string, extra: Partial<DraftContent> = {}): DraftContent => ({ text, quotes: [], ...extra });

async function set(
	client: TestClient,
	projectId: string,
	threadId: string,
	value: DraftContent | null,
	baseRevision: number,
	device?: { deviceId: string; name?: string },
): Promise<{ applied: boolean; draft: ChatDraft | null }> {
	const response = await client.request({
		type: "drafts.set",
		projectId,
		threadId,
		content: value,
		baseRevision,
		...(device === undefined ? {} : { device }),
	});
	if (response.type !== "drafts.set") throw errorOf(response);
	return { applied: response.applied, draft: response.draft };
}

async function get(client: TestClient, projectId: string, threadId?: string): Promise<ChatDraft[]> {
	const response = await client.request({ type: "drafts.get", projectId, ...(threadId === undefined ? {} : { threadId }) });
	if (response.type !== "drafts.get") throw errorOf(response);
	return response.drafts;
}

const changed = (message: ServerMessage, threadId: string, revision: number): boolean =>
	message.type === "drafts.changed" && message.threadId === threadId && message.draft.revision === revision;

describe("chat drafts", () => {
	it("is a feature, and without it every drafts request is unknown", async () => {
		const { test } = await start();
		expect(test.server.features).toContain("chat-drafts");
		expect(HARNESS_FEATURES).toContain("chat-drafts");

		const off = await start({ features: HARNESS_FEATURES.filter((feature) => feature !== "chat-drafts") });
		expect(off.test.server.features).not.toContain("chat-drafts");
		const refused = await off.client.request({ type: "drafts.get", projectId: off.projectId });
		expect(refused).toMatchObject({ type: "error", error: { code: "unknown_request" } });
		const refusedSet = await off.client.request({ type: "drafts.set", projectId: off.projectId, threadId: "main", content: content("x"), baseRevision: 0 });
		expect(refusedSet).toMatchObject({ type: "error", error: { code: "unknown_request" } });
	});

	it("gets and sets a chat's draft, with revisions, the author and no-op rules", async () => {
		const { client, projectId } = await start();
		expect(await get(client, projectId, "main")).toEqual([]);
		expect(await get(client, projectId)).toEqual([]);

		const first = await set(client, projectId, "main", content("hello", { taskId: "T1", quotes: ["a quote"] }), 0, { deviceId: "dev-a", name: "Pixel 8" });
		expect(first.applied).toBe(true);
		expect(first.draft).toMatchObject({
			projectId,
			threadId: "main",
			revision: 1,
			author: { deviceId: "dev-a", name: "Pixel 8" },
			content: { text: "hello", taskId: "T1", quotes: ["a quote"] },
		});
		expect(Number.isNaN(Date.parse(first.draft?.updatedAt ?? ""))).toBe(false);

		const second = await set(client, projectId, "main", content("hello world"), 1);
		expect(second.draft?.revision).toBe(2);
		expect(second.draft?.author).toBeUndefined();
		expect(second.draft?.content).toEqual({ text: "hello world", quotes: [] });

		// The same content again, whatever the base: applied, no new revision.
		expect(await set(client, projectId, "main", content("hello world"), 1)).toMatchObject({ applied: true, draft: { revision: 2 } });
		// A thread is its own chat.
		await set(client, projectId, "thread-1", content("in a thread"), 0);
		expect((await get(client, projectId)).map((entry) => [entry.threadId, entry.revision])).toEqual([
			["main", 2],
			["thread-1", 1],
		]);
		expect(await get(client, projectId, "thread-1")).toHaveLength(1);

		// Nothing to clear on a chat that has nothing: applied, null, and no tombstone.
		expect(await set(client, projectId, "other", null, 0)).toEqual({ applied: true, draft: null });
		expect(await get(client, projectId, "other")).toEqual([]);
		// An empty draft is a clear.
		const cleared = await set(client, projectId, "main", content("  \n"), 2);
		expect(cleared).toMatchObject({ applied: true, draft: { revision: 3, content: null } });
		// The tombstone stays and the next write builds on it.
		expect((await get(client, projectId, "main"))[0]).toMatchObject({ revision: 3, content: null });
		expect(await set(client, projectId, "main", content("again"), 3)).toMatchObject({ applied: true, draft: { revision: 4 } });
	});

	it("refuses a write on an old revision with the current entry, and writes nothing", async () => {
		const { client, projectId } = await start();
		await set(client, projectId, "main", content("one"), 0);
		const fromB = await set(client, projectId, "main", content("two"), 1);
		expect(fromB.draft?.revision).toBe(2);
		const stale = await set(client, projectId, "main", content("three, from a device that missed two"), 1);
		expect(stale.applied).toBe(false);
		expect(stale.draft).toMatchObject({ revision: 2, content: { text: "two" } });
		expect((await get(client, projectId, "main"))[0]?.content?.text).toBe("two");
		// It re-sends on the revision it was told: the last writer wins.
		expect(await set(client, projectId, "main", content("three, from a device that missed two"), 2)).toMatchObject({
			applied: true,
			draft: { revision: 3, content: { text: "three, from a device that missed two" } },
		});
		// A first write to a chat that has an entry is refused as well.
		expect((await set(client, projectId, "main", content("late"), 0)).applied).toBe(false);
	});

	it("pushes drafts.changed to the other connections, not to the writer", async () => {
		const { test, client, projectId } = await start();
		const other = await connect(test.server);
		const third = await connect(test.server);
		await set(client, projectId, "main", content("typed on A"), 0, { deviceId: "dev-a" });
		const pushed = await other.waitFor((message) => changed(message, "main", 1));
		expect(pushed).toMatchObject({ type: "drafts.changed", projectId, draft: { content: { text: "typed on A" }, author: { deviceId: "dev-a" } } });
		await third.waitFor((message) => changed(message, "main", 1));
		// A refused write and a repeat change nothing and push nothing.
		await set(other, projectId, "main", content("stale"), 0);
		await set(client, projectId, "main", content("typed on A"), 1);
		// B writes; A is told, B is not.
		await set(other, projectId, "main", null, 1);
		await client.waitFor((message) => changed(message, "main", 2));
		await set(client, projectId, "main", content("closing"), 2);
		await other.waitFor((message) => changed(message, "main", 3));
		expect(client.messages.filter((message) => message.type === "drafts.changed").map((message) => (message as { draft: ChatDraft }).draft.revision)).toEqual([2]);
		expect(other.messages.filter((message) => message.type === "drafts.changed").map((message) => (message as { draft: ChatDraft }).draft.revision)).toEqual([1, 3]);
	});

	it("clears the chat's draft when a message is submitted from any device, and tells every connection", async () => {
		const { test, client, projectId } = await start();
		const configured = await client.request({ type: "projects.configure", projectId, coordinatorModel: { provider: "faux", modelId: "faux-1" } });
		if (configured.type !== "projects.configure") throw errorOf(configured);
		const other = await connect(test.server);
		await set(client, projectId, "main", content("about to send"), 0);
		await set(client, projectId, "thread-1", content("a thread's draft"), 0);
		await other.waitFor((message) => changed(message, "main", 1));

		test.faux.setResponses([fauxAssistantMessage("ok")]);
		const submitted = await other.request({ type: "conversation.submit", projectId, requestId: "r1", content: "about to send" });
		if (submitted.type !== "conversation.submit") throw errorOf(submitted);
		// Both connections hear it, the submitter's too.
		for (const connection of [client, other]) {
			const pushed = await connection.waitFor((message) => changed(message, "main", 2));
			expect(pushed).toMatchObject({ draft: { content: null } });
		}
		expect(await get(client, projectId, "main")).toMatchObject([{ revision: 2, content: null }]);
		// The thread's draft is its own.
		expect((await get(client, projectId, "thread-1"))[0]?.content?.text).toBe("a thread's draft");
		// A writer that has not heard yet clears too, and that is not a conflict.
		expect(await set(client, projectId, "main", null, 1)).toMatchObject({ applied: true, draft: { revision: 2, content: null } });
	}, 30_000);

	it("leaves a draft written after the message arrived: that is text typed since sending", async () => {
		let now = Date.UTC(2026, 10, 1);
		const root = await mkdtemp(join(tmpdir(), "drafts-store-"));
		cleanups.push(() => rm(root, { recursive: true, force: true }));
		const store = new DraftStore({ dataDir: root, now: () => now });
		await store.set("p", "main", content("sent text"), 0, undefined);
		now += 1;
		const arrived = now;
		now += 5;
		await store.set("p", "main", content("typed after sending"), 1, undefined);
		await store.clear("p", "main", arrived);
		expect((await store.get("p", "main"))[0]).toMatchObject({ revision: 2, content: { text: "typed after sending" } });
		now += 1;
		await store.clear("p", "main", now);
		expect((await store.get("p", "main"))[0]).toMatchObject({ revision: 3, content: null });
	});

	it("keeps the draft when the submit says it is not what the composer holds (a retry)", async () => {
		const { test, client, projectId } = await start();
		const configured = await client.request({ type: "projects.configure", projectId, coordinatorModel: { provider: "faux", modelId: "faux-1" } });
		if (configured.type !== "projects.configure") throw errorOf(configured);
		await set(client, projectId, "main", content("typed after the failed send"), 0);
		test.faux.setResponses([fauxAssistantMessage("ok")]);
		const retried = await client.request({ type: "conversation.submit", projectId, requestId: "r1", content: "the failed text", keepDraft: true });
		if (retried.type !== "conversation.submit") throw errorOf(retried);
		expect((await get(client, projectId, "main"))[0]).toMatchObject({ revision: 1, content: { text: "typed after the failed send" } });
	}, 30_000);

	it("keeps a draft through a failed submit", async () => {
		const { client, projectId } = await start();
		await set(client, projectId, "main", content("no model yet"), 0);
		const refused = await client.request({ type: "conversation.submit", projectId, requestId: "r1", content: "no model yet" });
		expect(refused).toMatchObject({ type: "error", error: { code: "no_coordinator_model" } });
		expect((await get(client, projectId, "main"))[0]).toMatchObject({ revision: 1, content: { text: "no model yet" } });
	});

	it("caps text, quotes and attachments", async () => {
		const { client, projectId } = await start();
		const tooBig = async (value: DraftContent): Promise<ServerMessage> =>
			client.request({ type: "drafts.set", projectId, threadId: "main", content: value, baseRevision: 0 });
		expect(await tooBig(content("x".repeat(100_001)))).toMatchObject({ type: "error", error: { code: "bad_request" } });
		expect(await tooBig(content("", { quotes: Array.from({ length: 21 }, () => "q") }))).toMatchObject({ type: "error", error: { code: "bad_request" } });
		expect(await tooBig(content("", { quotes: ["x".repeat(50_001)] }))).toMatchObject({ type: "error", error: { code: "bad_request" } });
		// Each part is allowed alone, together they are over the total.
		expect(await tooBig(content("x".repeat(100_000), { quotes: ["y".repeat(50_000), "z".repeat(50_000), "w".repeat(1)] }))).toMatchObject({
			type: "error",
			error: { code: "bad_request", message: expect.stringContaining("together") },
		});
		expect(await get(client, projectId)).toEqual([]);
		// At the limit is fine.
		expect((await set(client, projectId, "main", content("x".repeat(100_000), { quotes: ["y".repeat(50_000), "z".repeat(50_000)] }), 0)).applied).toBe(true);
		// An attachment that was never uploaded is refused.
		const missing = await tooBig(content("", { attachments: [{ id: "a".repeat(64), mimeType: "image/png", size: 3 }] }));
		expect(missing).toMatchObject({ type: "error", error: { code: "bad_request" } });
		// An unknown project is an error as for any request.
		expect(await client.request({ type: "drafts.get", projectId: "nope" })).toMatchObject({ type: "error", error: { code: "unknown_project" } });
	});

	it("drops entries not changed for 30 days, tombstones too, and keeps the newest 100", async () => {
		let now = Date.UTC(2026, 10, 1);
		const root = await mkdtemp(join(tmpdir(), "drafts-store-"));
		cleanups.push(() => rm(root, { recursive: true, force: true }));
		const store = new DraftStore({ dataDir: root, now: () => now });
		await store.set("p", "old", content("old"), 0, undefined);
		await store.set("p", "cleared", content("x"), 0, undefined);
		await store.clear("p", "cleared");
		now += 29 * DAY;
		await store.set("p", "fresh", content("fresh"), 0, undefined);
		expect((await store.get("p")).map((entry) => entry.threadId).sort()).toEqual(["cleared", "fresh", "old"]);
		now += 2 * DAY;
		expect((await store.get("p")).map((entry) => entry.threadId)).toEqual(["fresh"]);
		// A write after expiry takes the expired ones out of the file for good.
		await store.set("p", "fresh", content("fresh 2"), 1, undefined);
		expect((await new DraftStore({ dataDir: root, now: () => now - 40 * DAY }).get("p")).map((entry) => entry.threadId)).toEqual(["fresh"]);

		for (let index = 0; index < 102; index += 1) {
			now += 1000;
			await store.set("q", `chat-${index}`, content(`n${index}`), 0, undefined);
		}
		const kept = await store.get("q");
		expect(kept).toHaveLength(100);
		expect(kept.some((entry) => entry.threadId === "chat-0" || entry.threadId === "chat-1")).toBe(false);
		expect(kept.some((entry) => entry.threadId === "chat-101")).toBe(true);
	});

	it("keeps drafts and revisions across a restart", async () => {
		const { test, client, projectId } = await start();
		await set(client, projectId, "main", content("survives", { taskId: "T9", quotes: ["q"] }), 0, { deviceId: "dev-a", name: "Laptop" });
		await set(client, projectId, "thread-1", content("gone"), 0);
		await set(client, projectId, "thread-1", null, 1);
		const server = await test.restart();
		const again = await connect(server);
		expect(await get(again, projectId)).toMatchObject([
			{ threadId: "main", revision: 1, author: { deviceId: "dev-a", name: "Laptop" }, content: { text: "survives", taskId: "T9", quotes: ["q"] } },
			{ threadId: "thread-1", revision: 2, content: null },
		]);
		expect(await set(again, projectId, "main", content("survives, edited"), 1)).toMatchObject({ applied: true, draft: { revision: 2 } });
	}, 30_000);

	it("stores an image once, hands it back, and sweeps what no draft points to", async () => {
		const { test, client, projectId } = await start();
		const upload = async (bytes: Buffer, mimeType = "image/png"): Promise<ServerMessage> =>
			client.request({ type: "drafts.attachment.put", projectId, mimeType, data: bytes.toString("base64"), name: "shot.png" });
		const put = await upload(PNG);
		if (put.type !== "drafts.attachment.put") throw errorOf(put);
		expect(put.attachment).toMatchObject({ mimeType: "image/png", size: PNG.length, name: "shot.png" });
		expect(put.attachment.id).toMatch(/^[0-9a-f]{64}$/);
		// The same bytes again are the same file.
		const again = await upload(PNG);
		if (again.type !== "drafts.attachment.put") throw errorOf(again);
		expect(again.attachment.id).toBe(put.attachment.id);
		const dir = join(test.dataDir, "projects", projectId, "draft-attachments");
		expect(await readdir(dir)).toEqual([`${put.attachment.id}.png`]);

		const fetched = await client.request({ type: "drafts.attachment.get", projectId, attachmentId: put.attachment.id });
		if (fetched.type !== "drafts.attachment.get") throw errorOf(fetched);
		expect(Buffer.from(fetched.data, "base64").equals(PNG)).toBe(true);
		expect(fetched.attachment).toMatchObject({ id: put.attachment.id, mimeType: "image/png", size: PNG.length });

		expect(await upload(PNG, "text/html")).toMatchObject({ type: "error", error: { code: "bad_request" } });
		expect(await upload(Buffer.alloc(0))).toMatchObject({ type: "error", error: { code: "bad_request" } });
		expect(await upload(Buffer.alloc(5 * 1024 * 1024 + 1, 1))).toMatchObject({ type: "error", error: { code: "bad_request" } });
		expect(await client.request({ type: "drafts.attachment.get", projectId, attachmentId: "b".repeat(64) })).toMatchObject({
			type: "error",
			error: { code: "bad_request" },
		});

		// A draft points at it; another device sees the reference, not the bytes.
		const other = await connect(test.server);
		const withImage = await set(client, projectId, "main", content("", { attachments: [put.attachment] }), 0);
		expect(withImage.draft?.content?.attachments).toEqual([put.attachment]);
		const pushed = await other.waitFor((message) => changed(message, "main", 1));
		expect(JSON.stringify(pushed)).not.toContain(PNG.toString("base64"));

		// An old upload nothing points to goes at the next write; a referenced one and a fresh one stay.
		const stray = await upload(Buffer.concat([PNG, Buffer.from("stray")]));
		if (stray.type !== "drafts.attachment.put") throw errorOf(stray);
		const strayPath = join(dir, `${stray.attachment.id}.png`);
		await set(client, projectId, "main", content("", { attachments: [put.attachment], quotes: ["q"] }), 1);
		expect(await readdir(dir)).toHaveLength(2);
		const old = new Date(Date.now() - 20 * 60_000);
		await utimes(strayPath, old, old);
		await set(client, projectId, "main", content("t", { attachments: [put.attachment] }), 2);
		expect((await readdir(dir)).sort()).toEqual([`${put.attachment.id}.png`]);

		// A cleared draft frees its image, once it is past the grace.
		await utimes(join(dir, `${put.attachment.id}.png`), old, old);
		await set(client, projectId, "main", null, 3);
		expect(await readdir(dir)).toEqual([]);
	});
});
