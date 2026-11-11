import { describe, expect, test } from "bun:test";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createSetup } from "./support.ts";
import { WorkersDoc, type WorkerRecord } from "../src/workers.ts";
import { BoardDoc, type BoardState } from "../src/board.ts";
import { prepareReportNudges } from "../src/task-freshness.ts";
import { TASK_CHANGES_FILE, type ChangesLanded, type TaskChangeLedger } from "../src/task-changes.ts";

async function run(path: string, ...args: string[]): Promise<string> {
	const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("AIKI_")));
	const child = Bun.spawn(args, { cwd: path, timeout: 15_000, env: { ...env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" }, stdout: "pipe", stderr: "pipe" });
	const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
	if (code) throw new Error(stderr);
	return stdout.trimEnd();
}
const task = { title: "Synthetic task", description: "", acceptance: null, status: "todo" as const, blockedBy: [], blockedReason: null, writeScopes: [] };

test("legacy projection is one plain milestone per task per advance, including deduplicated callback retry", async () => {
	const setup = await createSetup();
	try {
		const project = await setup.server.manager.store.add(setup.projectDir);
		const { runtime } = await setup.server.manager.open(project.id);
		await runtime.board.saveTask({ task }, "harness"); await runtime.board.saveTask({ task }, "harness");
		const fact: ChangesLanded = { id: "synthetic-advance-1", projectId: project.id, repository: "synthetic", ref: "refs/heads/main", previous: "a".repeat(40), tip: "b".repeat(40), at: "2026-01-01T12:00:00.000Z", taskIds: ["T1", "T2"],
			commits: [1, 2, 3].map(n => ({ hash: String(n).repeat(40), subject: "Synthetic change", taskIds: ["T1", "T2"] })), removed: [], reverted: [] };
		await runtime.board.recordChangesLanded(fact); await runtime.board.recordChangesLanded(fact);
		for (const taskId of fact.taskIds) {
			const entries = (await runtime.board.timeline(taskId)).entries.filter(entry => entry.ref === fact.id);
			expect(entries).toHaveLength(1); expect(entries[0]?.kind).toBe("milestone"); expect(entries[0]?.label).toBe("3 changes landed on main");
			expect(entries[0]?.detail).toContain("1".repeat(40)); expect(entries[0]?.detail).toContain("3".repeat(40));
		}
	} finally { await setup.cleanup(); }
}, 30_000);

test.each(["landed", "removed", "reverted"] as const)("attributed %s changes stale Results/Next once and queue one nudge", async (kind) => {
	const start = Date.parse("2026-01-01T12:00:00.000Z");
	const setup = await createSetup({ now: () => start });
	try {
		const project = await setup.server.manager.store.add(setup.projectDir);
		const { runtime } = await setup.server.manager.open(project.id);
		await runtime.board.saveTask({ task }, "harness");
		const commit = <R>(change: Parameters<typeof runtime.harness.commit<R>>[0]) => runtime.harness.commit(change, BACKGROUND_CONTEXT);
		await runtime.board.writeReport(commit, { taskId: "T1", sections: { results: "Synthetic tests passed", next: "Review the changes" }, by: { author: "coordinator", threadId: null, workerId: null } }, "initial-report");
		const count = kind === "landed" ? 2 : 1;
		const commits = Array.from({ length: count }, (_, i) => ({ hash: String(i + 1).repeat(40), subject: "Synthetic change", taskIds: ["T1"] }));
		const fact: ChangesLanded = { id: `synthetic-${kind}`, projectId: project.id, repository: "synthetic", ref: "refs/heads/main", previous: "a".repeat(40), tip: "b".repeat(40), at: new Date(start).toISOString(), taskIds: ["T1"], commits: [], removed: [], reverted: [], [kind === "landed" ? "commits" : kind]: commits };
		const before = await runtime.board.state();
		// An unattributed advance (even with a stray task hint) cannot invalidate reports.
		await runtime.board.recordChangesLanded({ ...fact, id: "unattributed", commits: commits.map(c => ({ ...c, taskIds: [] })), removed: [], reverted: [] });
		expect(await runtime.board.state()).toEqual(before);
		await runtime.board.recordChangesLanded(fact);
		const stale = await runtime.board.state();
		const reason = `${count} change${count === 1 ? "" : "s"} ${kind} ${kind === "removed" ? "from" : "on"} main`;
		for (const section of ["results", "next"] as const) {
			expect(stale.tasks[0]!.report.freshness![section]).toMatchObject({ stale: true, reasons: [reason], eventsSince: 1 });
		}
		expect(stale.tasks[0]!.eventSeq).toBe((before.tasks[0]!.eventSeq ?? 0) + 1);
		expect(stale.reportTracking!.T1!.pending?.sections).toEqual({ results: 1, next: 1 });
		await runtime.board.recordChangesLanded(fact);
		expect(await runtime.board.state()).toEqual(stale);
		await commit(async tx => {
			const state = await tx.doc(BoardDoc, runtime.conversation.id);
			prepareReportNudges(state as BoardState, start + 30_000, () => "main");
		});
		const queued = await runtime.board.state();
		expect(queued.reportOutbox).toHaveLength(1);
		expect(queued.reportOutbox![0]!.admissions).toHaveLength(1);
		await runtime.board.recordChangesLanded(fact);
		expect(await runtime.board.state()).toEqual(queued);
		expect((await runtime.board.timeline("T1")).entries.filter(entry => entry.ref === fact.id)).toHaveLength(1);
	} finally { await setup.cleanup(); }
}, 30_000);

describe.skipIf(!Bun.which("git"))("server integration ref lifecycle", () => {
	test("settings preserve off/auto/custom; restart stays lazy and persisted tips catch up on reopen", async () => {
		const setup = await createSetup();
		try {
			await run(setup.projectDir, "git", "init", "-b", "main");
			await run(setup.projectDir, "git", "config", "user.name", "Fixture"); await run(setup.projectDir, "git", "config", "user.email", "fixture@example.invalid");
			await run(setup.projectDir, "git", "-c", "commit.gpgsign=false", "commit", "--allow-empty", "-m", "baseline");
			const project = await setup.server.manager.store.add(setup.projectDir);
			expect((await setup.server.manager.configure(project.id, { integrationRef: null })).integrationRef).toBe(null);
			expect((await setup.server.manager.configure(project.id, { integrationRef: "refs/heads/custom" })).integrationRef).toBe("refs/heads/custom");
			await expect(setup.server.manager.configure(project.id, { integrationRef: "refs/heads/../bad" })).rejects.toThrow("Integration ref");
			expect((await setup.server.manager.configure(project.id, { integrationRef: "auto" })).integrationRef).toBe("auto");
			const { runtime } = await setup.server.manager.open(project.id); await runtime.board.saveTask({ task }, "harness");
			await run(setup.projectDir, "git", "-c", "commit.gpgsign=false", "commit", "--allow-empty", "-m", "feat: offline\n\nAiki-Task: T1");
			const ledgerFile = join(setup.dataDir, "projects", project.id, TASK_CHANGES_FILE);
			const beforeRestart = await readFile(ledgerFile, "utf8");
			const restarted = await setup.restart();
			expect((await restarted.manager.list()).find(summary => summary.id === project.id)?.state).toBe("closed");
			expect(await readFile(ledgerFile, "utf8")).toBe(beforeRestart);
			const next = await restarted.manager.open(project.id);
			expect((await next.runtime.board.timeline("T1")).entries.some(entry => entry.label === "1 change landed on main")).toBe(true);
		} finally { await setup.cleanup(); }
	}, 30_000);
});

describe.skipIf(!Bun.which("git") || !Bun.which("jj"))("workspace storage cleanup", () => {
	test("storage records task provenance before removing the worker workspace", async () => {
		const setup = await createSetup();
		try {
			await run(setup.projectDir, "jj", "git", "init");
			const project = await setup.server.manager.store.add(setup.projectDir);
			const { runtime } = await setup.server.manager.open(project.id); await runtime.board.saveTask({ task }, "harness");
			const path = await runtime.workers.createWorkspace("synthetic");
			await writeFile(join(path, "feature.txt"), "synthetic\n");
			await run(path, "jj", "--config", 'user.name="Fixture"', "--config", 'user.email="fixture@example.invalid"', "--config", 'signing.behavior="drop"', "commit", "-m", "feat: isolated");
			const record: WorkerRecord = { id: "synthetic", title: "Synthetic", conversationId: 999, isolation: "workspace", workspacePath: path,
				model: { provider: "faux", modelId: "faux-1" }, thinkingLevel: null, status: "done", taskId: "T1", spawnedByCallId: "synthetic-run", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), lastReport: null, failure: null, anchorTaskId: 1 };
			await runtime.harness.commit(async tx => { (await tx.doc(WorkersDoc, runtime.conversation.id)).workers.synthetic = record; }, BACKGROUND_CONTEXT);
			const cleaned = await runtime.storage.clean(["worker:main/synthetic"]); expect(cleaned.removed).toEqual(["worker:main/synthetic"]);
			const ledger = JSON.parse(await readFile(join(setup.dataDir, "projects", project.id, TASK_CHANGES_FILE), "utf8")) as TaskChangeLedger;
			expect(Object.values(ledger.repositories).flatMap(repository => repository.changes)).toMatchObject([{ taskId: "T1", source: "workspace", runId: "synthetic-run" }]);
			expect(await Bun.file(join(path, "feature.txt")).exists()).toBe(false);
		} finally { await setup.cleanup(); }
	}, 30_000);
});
