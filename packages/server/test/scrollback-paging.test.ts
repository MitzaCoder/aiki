/**
 * T163: a long conversation must tell the client that older entries exist, and page them.
 *
 * pi-durable 1.5.1 windows a conversation view itself (newest 50 by default) and names the entry outside that window in
 * `before`. The server used to re-window the already windowed view, which dropped `before`: no client was offered older
 * history, so scrolling to the top of a long chat stopped at the first entry of the window instead of paging.
 */
import { afterEach, expect, it } from "bun:test";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createSetup, TestClient, type TestSetup } from "./support.ts";

const cleanups: (() => Promise<void>)[] = [];
const clients: TestClient[] = [];

afterEach(async () => {
	for (const client of clients.splice(0)) client.close();
	for (const cleanup of cleanups.splice(0)) await cleanup();
});

async function setup(): Promise<TestSetup> {
	const created = await createSetup({ terminals: false });
	cleanups.push(created.cleanup);
	return created;
}

/** `count` passive entries, so the transcript is longer than one watch window without running a model. */
async function seed(test: TestSetup, projectId: string, count: number): Promise<number[]> {
	const { conversation } = await test.server.manager.conversation(projectId);
	const ids: number[] = [];
	for (let index = 1; index <= count; index += 1) {
		const submission = await conversation.submit(
			{
				type: "write",
				entry: { kind: "pi.user", model: [{ role: "user", content: `Message ${index}`, timestamp: Date.now() }] },
			},
			BACKGROUND_CONTEXT,
		);
		const status = await submission.status(BACKGROUND_CONTEXT);
		if (status.status !== "done") throw new Error(`seeding message ${index} failed: ${JSON.stringify(status)}`);
		ids.push(Number(status.entry));
	}
	return ids;
}

it("a long conversation offers older history and pages it", async () => {
	const test = await setup();
	const client = await TestClient.open(test.server);
	clients.push(client);
	await client.hello();
	const added = await client.request({ type: "projects.add", path: test.projectDir });
	if (added.type !== "projects.add") throw new Error(JSON.stringify(added));
	const projectId = added.project.id;
	await client.request({ type: "projects.configure", projectId, coordinatorModel: { provider: "faux", modelId: "faux-1" } });

	const seeded = await seed(test, projectId, 120);
	const watch = await client.request({ type: "conversation.watch", projectId });
	if (watch.type !== "conversation.watch") throw new Error(JSON.stringify(watch));
	const windowIds = watch.view.entries.map((entry) => entry.id);
	expect(windowIds).toHaveLength(50);
	expect(windowIds).toEqual(seeded.slice(-50));

	// The window names the entry just outside it: this is what makes the client offer "load earlier" at all.
	expect(watch.view.before).toBe(seeded[seeded.length - 51]!);

	const earlier = await client.request({
		type: "conversation.page",
		projectId,
		limit: 50,
		order: "descending",
		before: watch.view.before,
	});
	if (earlier.type !== "conversation.page") throw new Error(JSON.stringify(earlier));
	expect(earlier.entries.map((entry) => entry.id)).toEqual(seeded.slice(-101, -51).reverse());
	expect(earlier.next).toBeDefined();
	expect(watch.view.entries.some((entry) => earlier.entries.some((older) => older.id === entry.id))).toBe(false);
});

it("a conversation shorter than one window claims no older history", async () => {
	const test = await setup();
	const client = await TestClient.open(test.server);
	clients.push(client);
	await client.hello();
	const added = await client.request({ type: "projects.add", path: test.projectDir });
	if (added.type !== "projects.add") throw new Error(JSON.stringify(added));
	const projectId = added.project.id;
	await client.request({ type: "projects.configure", projectId, coordinatorModel: { provider: "faux", modelId: "faux-1" } });

	await seed(test, projectId, 12);
	const watch = await client.request({ type: "conversation.watch", projectId });
	if (watch.type !== "conversation.watch") throw new Error(JSON.stringify(watch));
	expect(watch.view.entries).toHaveLength(12);
	expect(watch.view.before).toBeUndefined();
});

it("a watch that resumes from an entry keeps its `before`", async () => {
	const test = await setup();
	const client = await TestClient.open(test.server);
	clients.push(client);
	await client.hello();
	const added = await client.request({ type: "projects.add", path: test.projectDir });
	if (added.type !== "projects.add") throw new Error(JSON.stringify(added));
	const projectId = added.project.id;
	await client.request({ type: "projects.configure", projectId, coordinatorModel: { provider: "faux", modelId: "faux-1" } });

	const seeded = await seed(test, projectId, 120);
	const from = seeded[110]!;
	const watch = await client.request({ type: "conversation.watch", projectId, from });
	if (watch.type !== "conversation.watch") throw new Error(JSON.stringify(watch));
	expect(watch.view.entries.map((entry) => entry.id)).toEqual(seeded.slice(110));
	expect(watch.view.before).toBe(seeded[109]!);
});
