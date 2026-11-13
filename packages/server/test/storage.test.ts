/**
 * Resources: the project's worker and thread workspaces on disk (`projects.storage`, `projects.storage.clean`) and the
 * free space of the disks the harness writes to (`ServerStatus.disks`, `disk_low`, main's check-ins).
 */
import { afterEach, describe, expect, it } from "bun:test";
import type { TranscriptContext } from "@earendil-works/pi-ai";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
import type { DiskStatus, ModelRef } from "@kemiri/protocol";
import { mkdir, mkdtemp, readdir, rm, symlink, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	DiskMonitor,
	type DiskReader,
	diskLowNotification,
	diskWarningLine,
	isDiskLow,
	resolveDiskThreshold,
} from "../src/disks.ts";
import { treeBytes } from "../src/storage.ts";
import { createSetup, errorOf, TestClient, type TestSetup } from "./support.ts";

const cleanups: (() => Promise<void>)[] = [];
const clients: TestClient[] = [];
const FAUX: ModelRef = { provider: "faux", modelId: "faux-1" };
const GiB = 1024 ** 3;

afterEach(async () => {
	for (const client of clients.splice(0)) client.close();
	for (const cleanup of cleanups.splice(0)) await cleanup();
});

async function setup(options?: Parameters<typeof createSetup>[0]): Promise<TestSetup> {
	const created = await createSetup(options);
	cleanups.push(created.cleanup);
	return created;
}

async function connect(test: TestSetup): Promise<TestClient> {
	const client = await TestClient.open(test.server);
	clients.push(client);
	await client.hello();
	return client;
}

async function until(check: () => Promise<boolean>, timeoutMs = 20_000): Promise<void> {
	const start = Date.now();
	while (Date.now() - start < timeoutMs) {
		if (await check()) return;
		await new Promise((resolve) => setTimeout(resolve, 20));
	}
	throw new Error("timed out waiting for a condition");
}

async function run(args: string[], cwd: string): Promise<{ code: number; stdout: string }> {
	const child = Bun.spawn(args, { cwd, stdout: "pipe", stderr: "pipe" });
	const [stdout, code] = await Promise.all([new Response(child.stdout).text(), child.exited]);
	return { code, stdout };
}

function lastText(request: TranscriptContext): { role: string; text: string } {
	const last = request.messages.findLast((message) => message.role !== "system");
	const content = (last as { content?: unknown } | undefined)?.content;
	const text =
		typeof content === "string"
			? content
			: Array.isArray(content)
				? content.map((part: { type?: string; text?: string }) => (part.type === "text" ? (part.text ?? "") : "")).join("")
				: "";
	return { role: last?.role ?? "", text };
}

describe("project storage", () => {
	it("measures a tree without following symlinks", async () => {
		const dir = await mkdtemp(join(tmpdir(), "storage-"));
		cleanups.push(() => rm(dir, { recursive: true, force: true }));
		await mkdir(join(dir, "a", "b"), { recursive: true });
		await writeFile(join(dir, "a", "b", "big"), Buffer.alloc(64 * 1024));
		const outside = await mkdtemp(join(tmpdir(), "storage-outside-"));
		cleanups.push(() => rm(outside, { recursive: true, force: true }));
		await writeFile(join(outside, "huge"), Buffer.alloc(4 * 1024 * 1024));
		await symlink(outside, join(dir, "a", "link"));
		const bytes = await treeBytes(dir);
		expect(bytes).toBeGreaterThanOrEqual(64 * 1024);
		expect(bytes).toBeLessThan(1024 * 1024);
		expect(await treeBytes(join(dir, "missing"))).toBe(0);
	});

	it("lists worker workspaces, refuses a live worker's and removes finished and orphaned ones", async () => {
		const test = await setup();
		const client = await connect(test);
		const repo = join(test.root, "repo");
		await mkdir(repo, { recursive: true });
		await writeFile(join(repo, "README.md"), "# repo\n");
		expect((await run(["jj", "git", "init"], repo)).code).toBe(0);
		const added = await client.request({ type: "projects.add", path: repo });
		if (added.type !== "projects.add") throw errorOf(added);
		const projectId = added.project.id;
		await client.request({ type: "projects.configure", projectId, coordinatorModel: FAUX, workerModels: [FAUX] });

		test.faux.setResponses(
			Array.from({ length: 40 }, () => (request: TranscriptContext) => {
				const { role, text } = lastText(request);
				if (role === "toolResult") return fauxAssistantMessage("Done.");
				if (text.startsWith("Brief:")) return fauxAssistantMessage("## Report\nOutcome: done");
				if (text === "Spawn both.") {
					return fauxAssistantMessage(
						[
							fauxToolCall("worker_spawn", { id: "keeper", task: "Brief: keep", isolation: "workspace" }),
							fauxToolCall("worker_spawn", { id: "finished", task: "Brief: finish", isolation: "workspace" }),
						],
						{ stopReason: "toolUse" },
					);
				}
				if (text === "Forget one.") {
					return fauxAssistantMessage([fauxToolCall("worker_forget", { id: "finished", removeWorkspace: false })], {
						stopReason: "toolUse",
					});
				}
				return fauxAssistantMessage("Reviewed.");
			}),
		);
		const listWorkers = async () => {
			const listed = await client.request({ type: "workers.list", projectId });
			if (listed.type !== "workers.list") throw errorOf(listed);
			return listed.workers;
		};
		await client.request({ type: "conversation.submit", projectId, requestId: "r1", content: "Spawn both." });
		await until(async () => {
			const workers = await listWorkers();
			return workers.length === 2 && workers.every((worker) => worker.status === "idle");
		});
		await client.request({ type: "conversation.submit", projectId, requestId: "r2", content: "Forget one." });
		await until(async () => (await listWorkers()).some((worker) => worker.id === "finished" && worker.status === "done"));

		// A folder no worker claims, old enough not to be one being created right now.
		const workspaces = join(test.dataDir, "projects", projectId, "workspaces");
		const orphan = join(workspaces, "orphan");
		await mkdir(orphan, { recursive: true });
		await writeFile(join(orphan, "cache.bin"), Buffer.alloc(256 * 1024));
		const old = new Date(Date.now() - 60 * 60_000);
		await utimes(orphan, old, old);

		const storage = await client.request({ type: "projects.storage", projectId });
		if (storage.type !== "projects.storage") throw errorOf(storage);
		const byId = new Map(storage.items.map((item) => [item.id, item]));
		expect(byId.get("worker:main/keeper")).toMatchObject({ kind: "worker", removable: false });
		expect(byId.get("worker:main/finished")).toMatchObject({ kind: "worker", removable: true });
		expect(byId.get("worker:main/orphan")).toMatchObject({ label: "orphan", removable: true });
		expect(storage.items[0]?.id).toBe("worker:main/orphan");
		expect(storage.totalBytes).toBe(storage.items.reduce((sum, item) => sum + item.bytes, 0));

		const cleaned = await client.request({
			type: "projects.storage.clean",
			projectId,
			itemIds: ["worker:main/keeper", "worker:main/finished", "worker:main/nope"],
		});
		if (cleaned.type !== "projects.storage.clean") throw errorOf(cleaned);
		expect(cleaned.removed).toEqual(["worker:main/finished"]);
		expect(cleaned.refused.map((refusal) => refusal.id)).toEqual(["worker:main/keeper", "worker:main/nope"]);
		expect(cleaned.freedBytes).toBeGreaterThan(0);
		expect((await run(["jj", "workspace", "list"], repo)).stdout).not.toContain("harness-finished");
		expect((await run(["jj", "workspace", "list"], repo)).stdout).toContain("harness-keeper");

		// Without IDs, every removable one goes; the live worker's workspace stays.
		const rest = await client.request({ type: "projects.storage.clean", projectId });
		if (rest.type !== "projects.storage.clean") throw errorOf(rest);
		expect(rest.removed).toEqual(["worker:main/orphan"]);
		expect((await readdir(workspaces)).sort()).toEqual(["keeper"]);
	}, 60_000);
});

describe("disks", () => {
	it("is low below the smaller of the percent and the bytes, configurable by env", () => {
		const threshold = resolveDiskThreshold({});
		expect(threshold).toEqual({ percent: 15, bytes: 10 * GiB });
		// A big disk is low under 10 GiB, a small one under 15%.
		expect(isDiskLow(20 * GiB, 1000 * GiB, threshold)).toBe(false);
		expect(isDiskLow(9 * GiB, 1000 * GiB, threshold)).toBe(true);
		expect(isDiskLow(5 * GiB, 20 * GiB, threshold)).toBe(false);
		expect(isDiskLow(2 * GiB, 20 * GiB, threshold)).toBe(true);
		expect(resolveDiskThreshold({ KEMIRI_DISK_LOW_PERCENT: "5", KEMIRI_DISK_LOW_BYTES: "1000" })).toEqual({
			percent: 5,
			bytes: 1000,
		});
	});

	it("measures each filesystem once, announces each crossing once, also across a restart, and pushes notable changes", async () => {
		const dir = await mkdtemp(join(tmpdir(), "disks-"));
		cleanups.push(() => rm(dir, { recursive: true, force: true }));
		const free = { value: 50 * GiB };
		const read: DiskReader = async (path) =>
			path === "/gone" ? undefined : { device: path.startsWith("/other") ? 2 : 1, freeBytes: path.startsWith("/other") ? 900 * GiB : free.value, totalBytes: 1000 * GiB };
		const lows: DiskStatus[] = [];
		const pushes: DiskStatus[][] = [];
		const monitor = (): DiskMonitor =>
			new DiskMonitor({
				dataDir: dir,
				projects: async () => [
					{ label: "same-disk", path: `${dir}/project` },
					{ label: "other", path: "/other/project" },
					{ label: "gone", path: "/gone" },
				],
				read,
				onChange: (disks) => pushes.push(disks),
				onLow: (disk) => lows.push(disk),
				log: () => undefined,
			});
		const first = monitor();
		await first.start(60_000);
		cleanups.push(async () => first.stop());
		expect(first.disks.map((disk) => [disk.label, disk.low])).toEqual([
			["Data", false],
			["other", false],
		]);
		expect(pushes).toHaveLength(1);

		// A small move is not worth a push; a crossing is, and is announced once.
		free.value -= 100 * 1024 ** 2;
		await first.check();
		expect(pushes).toHaveLength(1);
		free.value = 8 * GiB;
		await first.check();
		await first.check();
		expect(pushes).toHaveLength(2);
		expect(lows.map((disk) => disk.label)).toEqual(["Data"]);
		expect(diskLowNotification(lows[0]!, "2026-11-05T12:00:00.000Z")).toMatchObject({
			kind: "disk_low",
			title: "Disk low · Data",
			body: `8.0 GiB free of 1000.0 GiB (1%) at ${dir}`,
			key: `disk_low:${dir}:2026-11-05T12:00:00.000Z`,
		});
		expect(first.warnings()).toEqual([diskWarningLine(first.disks[0]!)]);
		expect(first.warnings()[0]).toContain("Disk low: Data");

		// A restart while still low does not announce it again.
		first.stop();
		const second = monitor();
		await second.start(60_000);
		cleanups.push(async () => second.stop());
		expect(lows).toHaveLength(1);
		// Back above, then below again: a new crossing.
		free.value = 50 * GiB;
		await second.check();
		free.value = 5 * GiB;
		await second.check();
		expect(lows).toHaveLength(2);
	});

	it("reports the disks in server.status", async () => {
		const read: DiskReader = async () => ({ device: 1, freeBytes: 2 * GiB, totalBytes: 100 * GiB });
		const test = await setup({ disks: { read, intervalMs: 60_000 } });
		const client = await connect(test);
		const status = await client.request({ type: "server.status" });
		if (status.type !== "server.status") throw errorOf(status);
		expect(status.status.disks).toEqual([
			{ label: "Data", path: test.dataDir, freeBytes: 2 * GiB, totalBytes: 100 * GiB, low: true },
		]);
	});
});
