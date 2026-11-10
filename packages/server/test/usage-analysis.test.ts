import { afterEach, expect, it } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createModels } from "@earendil-works/pi-ai";
import { fauxProvider, fauxAssistantMessage } from "@earendil-works/pi-ai/providers/faux";
import { usageAnalysis, usageRole } from "../src/usage-analysis.ts";
import { ConversationRequests, RequestLog } from "../src/request-log.ts";
import { RequestLogStore, type RequestRow } from "../src/request-log-store.ts";
import { readCacheStats } from "../src/cache-stats.ts";
import { createSetup, TestClient } from "./support.ts";
const cleanups: (() => Promise<unknown> | void)[] = [];
afterEach(async () => {
	for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
function row(overrides: Partial<RequestRow> = {}): RequestRow {
	const requests = new ConversationRequests({
		projectId: "garden",
		conversationId: 1,
		identity: { kind: "main", threadId: "main", taskId: null, workerId: null, scheduleId: null },
	});
	return {
		...requests.request(
			{
				provider: "synthetic",
				model: "small",
				timestamp: 100,
				stopReason: "stop",
				usage: { input: 10, cacheRead: 20, cacheWrite: 30, output: 40, cost: { total: 2 } },
			},
			{ wake: "user", retention: "short", changes: null, source: "live" },
		),
		...overrides,
	};
}
it("attributes ordinary historic roles without migration guesses and keeps schedule/maintenance mutually exclusive", () => {
	expect(usageRole(row())).toBe("coordinator");
	expect(usageRole(row({ kind: "worker" }))).toBe("worker");
	expect(usageRole(row({ kind: "thread" }))).toBe("thread");
	expect(usageRole(row({ kind: "worker", scheduleId: "nightly" }))).toBe("scheduled");
	expect(usageRole(row({ source: "keepWarm", scheduleId: "nightly" }))).toBe("keep_warm");
	expect(usageRole(row({ purpose: "compaction" }))).toBe("compaction");
	expect(usageRole(row({ kind: "other" }))).toBe("unknown");
});
it("reconciles every token and catalog cost across roles, model roles and projects, including warm-up", () => {
	const rows = [
		row(),
		row({
			kind: "worker",
			taskId: "T2",
			workerId: "writer",
			projectId: "library",
			model: "large",
			stopReason: "aborted",
		}),
		row({ source: "keepWarm", wake: "check_in" }),
		row({ purpose: "compaction", conversationId: 0, wake: null }),
	];
	const analysis = usageAnalysis(rows, new Map([["garden", "Garden"]]), 500);
	expect(analysis.totals).toMatchObject({
		requests: 4,
		inputTokens: 40,
		cacheReadTokens: 80,
		cacheWriteTokens: 120,
		outputTokens: 160,
		cost: 8,
		maxPromptTokens: 60,
	});
	for (const groups of [analysis.byRole, analysis.byModel, analysis.byModelRole, analysis.byProject])
		expect(groups.reduce((sum, g) => sum + g.cost, 0)).toBe(8);
	expect(analysis.byTask).toMatchObject([{ label: "library · T2", cost: 2 }]);
	expect(analysis.failed.requests).toBe(1);
	expect(analysis.checkIns.requests).toBe(0);
	expect(analysis.internalSince).toBe(new Date(500).toISOString());
	expect(analysis.conversations.every((c) => !c.label.includes("conversation 0"))).toBe(true);
});
it("keeps all ordinary usage, zero-cost calls and empty ranges; caps task and conversation rankings", () => {
	const rows = Array.from({ length: 40 }, (_, i) =>
		row({ conversationId: i + 1, taskId: `T${i}`, cost: i, wake: i === 0 ? "check_in" : "retry" }),
	);
	const analysis = usageAnalysis(rows, new Map(), null);
	expect(analysis.byTask).toHaveLength(30);
	expect(analysis.conversations).toHaveLength(30);
	expect(analysis.checkIns.requests).toBe(1);
	expect(analysis.retries.requests).toBe(39);
	expect(usageAnalysis([], new Map(), null).totals.cost).toBe(0);
});
it("migrates a legacy log losslessly and still opens it read-only before migration", async () => {
	const dir = await mkdtemp(join(tmpdir(), "usage-migration-"));
	cleanups.push(() => rm(dir, { recursive: true, force: true }));
	const path = join(dir, "log.sqlite");
	let store = RequestLogStore.open(path, { now: 100 });
	store.insert(row());
	store.close();
	const db = new Database(path);
	db.exec(
		"ALTER TABLE requests DROP COLUMN purpose; UPDATE meta SET value='1' WHERE key='schema_version'; DELETE FROM meta WHERE key='internal_since'",
	);
	db.close();
	store = RequestLogStore.open(path, { readonly: true });
	expect(store.rows({ from: 0, to: 1000 })[0]?.purpose).toBeNull();
	expect(store.internalSince()).toBeNull();
	store.close();
	store = RequestLogStore.open(path, { now: 200 });
	expect(store.rows({ from: 0, to: 1000 })[0]?.cost).toBe(2);
	expect(store.internalSince()).toBe(200);
	store.insert(row({ purpose: "compaction" }));
	expect(store.rows({ from: 0, to: 1000 })[1]?.purpose).toBe("compaction");
	store.close();
});
it("records internal completeSimple results once without changing replies or joining a cache-miss chain", async () => {
	const store = RequestLogStore.open(":memory:");
	const log = new RequestLog({ store });
	cleanups.push(() => log.close());
	const faux = fauxProvider();
	const models = createModels();
	models.setProvider(faux.provider);
	faux.setResponses([() => fauxAssistantMessage("A synthetic summary.")]);
	const observed = log.observeInternalModels(models, "garden", "compaction");
	const response = await observed.completeSimple(observed.getModel("faux", "faux-1")!, {
		messages: [{ role: "user", content: "Summarize synthetic fixture", timestamp: 100 }],
	});
	expect(response.stopReason).toBe("stop");
	await log.flush();
	expect(store.rows({ from: 0, to: Date.now() + 1 })).toMatchObject([
		{ purpose: "compaction", projectId: "garden", conversationId: 0, kind: "other", missTokens: 0, retention: "none" },
	]);
});
it("keeps analysis and reset mutations behind negotiated feature names", async () => {
	const setup = await createSetup({features:["cache-stats"]});
	cleanups.push(setup.cleanup);
	const client = await TestClient.open(setup.server);
	cleanups.push(()=>client.close());
	const hello = await client.hello();
	expect(hello.type).toBe("hello");
	if(hello.type === "hello") expect(hello.features).not.toContain("usage-breakdown");
	const stats = await client.request({type:"cache.stats"});
	expect(stats.type).toBe("cache.stats");
	if(stats.type === "cache.stats") expect(stats.stats.usage).toBeUndefined();
	const reset = await client.request({type:"subscriptions.reset",providerId:"openai-codex",creditId:"synthetic",program:"codex",requestId:crypto.randomUUID(),confirmed:true});
	expect(reset.type).toBe("error");
});

it("calendarToday respects local midnight and excludes rows outside it", async () => {
	const store = RequestLogStore.open(":memory:");
	cleanups.push(() => store.close());
	const now = Date.parse("2026-01-02T02:00:00Z");
	store.insert(row({ at: now - 3 * 3600000 }));
	store.insert(row({ at: now - 3600000 }));
	const stats = await readCacheStats({
		store,
		projects: { list: async () => [] },
		now,
		calendarToday: true,
		utcOffsetMinutes: 120,
	});
	expect(stats.from).toBe("2026-01-01T22:00:00.000Z");
	expect(stats.usage?.totals.requests).toBe(2);
	const utc = await readCacheStats({
		store,
		projects: { list: async () => [] },
		now,
		calendarToday: true,
		utcOffsetMinutes: 0,
	});
	expect(utc.usage?.totals.requests).toBe(1);
});
