import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TaskChangeObserver, taskTrailers, type ChangesLanded, type TaskChangeLedger } from "../src/task-changes.ts";
import { removeJjWorkspace } from "../src/jj.ts";

const hasGit = Boolean(Bun.which("git"));
const hasJj = hasGit && Boolean(Bun.which("jj"));
const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
const environment = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("KEMIRI_")));
async function run(path: string, binary: string, ...args: string[]): Promise<string> {
	const process = Bun.spawn([binary, ...args], { timeout: 15_000, cwd: path, env: { ...environment, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" }, stdout: "pipe", stderr: "pipe" });
	const [stdout, stderr, code] = await Promise.all([new Response(process.stdout).text(), new Response(process.stderr).text(), process.exited]);
	if (code !== 0) throw new Error(`${binary} ${args.join(" ")}: ${stderr}`);
	return stdout.trimEnd();
}
const git = (path: string, ...args: string[]): Promise<string> => run(path, "git", ...args);
const jj = (path: string, ...args: string[]): Promise<string> => run(path, "jj", "--config", 'user.name="Fixture"', "--config", 'user.email="fixture@example.invalid"', "--config", 'signing.behavior="drop"', ...args);
async function fixture(colocated = false) {
	const root = await mkdtemp(join(tmpdir(), "task-changes-")); roots.push(root);
	await git(root, "init", "-b", "main");
	await git(root, "config", "user.name", "Fixture"); await git(root, "config", "user.email", "fixture@example.invalid");
	await git(root, "-c", "commit.gpgsign=false", "commit", "--allow-empty", "-m", "baseline\n\nAiki-Task: T1");
	if (colocated) await jj(root, "git", "init", "--colocate");
	const stateDir = await mkdtemp(join(tmpdir(), "task-changes-state-")); roots.push(stateDir);
	const file = join(stateDir, "ledger.json");
	const facts: ChangesLanded[] = [], diagnostics: string[] = [];
	let ref: string | null | undefined = "refs/heads/main";
	const options = { projectId: "synthetic", path: root, file, integrationRef: () => ref, taskIds: async () => ["T1", "T2"], onChangesLanded: (fact: ChangesLanded) => { facts.push(structuredClone(fact)); }, log: (message: string) => { diagnostics.push(message); } };
	const observer = new TaskChangeObserver(options);
	return { root, file, facts, diagnostics, observer, options, setRef: (next: string | null | undefined) => { ref = next; }, ledger: async () => JSON.parse(await readFile(file, "utf8")) as TaskChangeLedger };
}
async function commit(root: string, message: string): Promise<string> {
	await git(root, "-c", "commit.gpgsign=false", "commit", "--allow-empty", "-m", message);
	return git(root, "rev-parse", "HEAD");
}
function repository(ledger: TaskChangeLedger) { return Object.values(ledger.repositories)[0]!; }

test("portable Aiki-Task trailers: repeated, comma lists, case-insensitive, deduplicated", () => {
	expect(taskTrailers("feat: example\n\nAiki-Task: T1\nAiki-Task: T2, T3\nAiki-Task: T1\nSigned-off-by: Fixture <fixture@example.invalid>")).toEqual(["T1", "T2", "T3"]);
	expect(taskTrailers("Aiki-Task: T2\n\nNot a trailer")).toEqual([]);
	expect(taskTrailers("feat: Aiki-Task: T1")).toEqual([]);
	expect(taskTrailers("feat: example\n\naiki-task: T1")).toEqual(["T1"]);
	expect(taskTrailers("feat: example\n\nAiki-Task: T1\nAiki-Task: T2")).toEqual(["T1", "T2"]);
	expect(taskTrailers(`feat: example\n\n${"Task"}: T1\n${"Tasks"}: T2, T3`)).toEqual([]);
	expect(taskTrailers("feat: example\n\nAiki-Task: T0\nAiki-Task: T1 T2")).toEqual([]);
});

describe.skipIf(!hasGit)("Git integration observation", () => {
	test("baseline without history; several tasks; unknown IDs diagnosed; quiet polls deduplicate", async () => {
		const f = await fixture(); await f.observer.poll(); expect(f.facts).toHaveLength(0);
		const hash = await commit(f.root, "feat: shared\n\nAiki-Task: T1\nAiki-Task: T2, T999");
		await f.observer.poll(); await f.observer.poll();
		expect(f.facts).toHaveLength(1); expect(f.facts[0]?.taskIds).toEqual(["T1", "T2"]);
		expect(f.facts[0]?.commits[0]?.hash).toBe(hash); expect(f.diagnostics.join()).toContain("T999");
		expect(repository(await f.ledger()).changes.map(change => [change.taskId, change.source])).toEqual([["T1", "trailer"], ["T2", "trailer"]]);
		await commit(f.root, "feat: unrelated\n\nAiki-Task: T999"); await f.observer.poll(); expect(f.facts).toHaveLength(1);
	});
	test("restart catches up from persisted tip, not whole history", async () => {
		const f = await fixture(); await f.observer.poll();
		const hash = await commit(f.root, "feat: offline\n\nAiki-Task: T2");
		await new TaskChangeObserver(f.options).poll();
		expect(f.facts).toHaveLength(1); expect(f.facts[0]?.commits.map(commit => commit.hash)).toEqual([hash]);
		await new TaskChangeObserver(f.options).poll(); expect(f.facts).toHaveLength(1);
	});
	test("durable outbox retries a failed callback after restart with the same admission key", async () => {
		const f = await fixture(); await f.observer.poll(); await commit(f.root, "feat: delivery\n\nAiki-Task: T1");
		const observer = new TaskChangeObserver({ ...f.options, onChangesLanded: () => { throw new Error("interrupted"); } });
		await expect(observer.poll()).rejects.toThrow("interrupted");
		const id = repository(await f.ledger()).facts[0]?.id;
		await new TaskChangeObserver(f.options).poll(); expect(f.facts[0]?.id).toBe(id);
		expect(repository(await f.ledger()).facts[0]?.delivered).toBe(true);
	});
	test("force move backwards records removals, and re-landing is a distinct fact", async () => {
		const f = await fixture(); await f.observer.poll(); const base = await git(f.root, "rev-parse", "HEAD");
		const hash = await commit(f.root, "feat: first\n\nAiki-Task: T1"); await f.observer.poll();
		await git(f.root, "update-ref", "refs/heads/main", base); await f.observer.poll();
		expect(f.facts[1]?.commits).toEqual([]); expect(f.facts[1]?.removed.map(commit => commit.hash)).toEqual([hash]);
		await git(f.root, "update-ref", "refs/heads/main", hash); await f.observer.poll();
		expect(f.facts[2]?.id).not.toBe(f.facts[0]?.id); expect(f.facts).toHaveLength(3);
	});
	test("revert retains ancestry but records the original task and semantic removal", async () => {
		const f = await fixture(); await f.observer.poll();
		await writeFile(join(f.root, "feature.txt"), "synthetic\n"); await git(f.root, "add", "feature.txt");
		const hash = await commit(f.root, "feat: feature\n\nAiki-Task: T2"); await f.observer.poll();
		await git(f.root, "-c", "commit.gpgsign=false", "revert", "--no-edit", hash); await f.observer.poll();
		expect(f.facts[1]?.taskIds).toEqual(["T2"]); expect(f.facts[1]?.reverted[0]?.hash).toBe(hash);
		expect(f.facts[1]?.removed).toEqual([]); expect(f.facts[1]?.commits[0]?.reverts).toBe(hash);
	});
	test("squash and merge preserve explicit trailers, including multiple task membership", async () => {
		const f = await fixture(); await f.observer.poll();
		await git(f.root, "checkout", "-b", "topic");
		await writeFile(join(f.root, "feature.txt"), "synthetic\n"); await git(f.root, "add", "feature.txt");
		await commit(f.root, "feat: topic\n\nAiki-Task: T1"); await git(f.root, "checkout", "main");
		await git(f.root, "merge", "--squash", "topic"); const squash = await commit(f.root, "feat: squashed\n\nAiki-Task: T1, T2");
		await f.observer.poll(); expect(f.facts[0]?.commits.map(commit => commit.hash)).toEqual([squash]);
		await git(f.root, "checkout", "-b", "other"); await commit(f.root, "feat: more\n\nAiki-Task: T2"); await git(f.root, "checkout", "main");
		await git(f.root, "-c", "commit.gpgsign=false", "merge", "--no-ff", "other", "-m", "feat: merged\n\nAiki-Task: T1");
		await f.observer.poll(); expect(f.facts[1]?.taskIds.sort()).toEqual(["T1", "T2"]); expect(f.facts[1]?.commits).toHaveLength(2);
	});
	test("manual corrections and worker declarations verify commits and scope; conflicts do not union", async () => {
		const f = await fixture(); await f.observer.poll(); const hash = await commit(f.root, "feat: declared");
		await f.observer.declareChanges([hash], ["T1"], "worker-declaration", { conversationId: 7, threadId: "example", runId: "run-1" });
		await f.observer.declareChanges([hash], ["T2"], "worker-declaration");
		expect(repository(await f.ledger()).changes.map(change => change.taskId)).toEqual(["T1"]);
		expect(f.diagnostics.join()).toContain("conflict");
		await f.observer.declareChanges([hash], ["T2"], "manual"); await f.observer.poll();
		expect(f.facts[0]?.taskIds).toEqual(["T2"]); expect(repository(await f.ledger()).changes[0]?.source).toBe("manual");
		await expect(f.observer.declareChanges(["f".repeat(40)], ["T1"], "manual")).rejects.toThrow("Unknown commit");
	});
	test("auto main/master, explicit ref changes baseline, off and missing refs do nothing", async () => {
		const f = await fixture(); f.setRef(undefined); await f.observer.poll();
		expect(repository(await f.ledger()).ref).toBe("refs/heads/main");
		await git(f.root, "branch", "-m", "main", "master"); await f.observer.poll();
		expect(repository(await f.ledger()).ref).toBe("refs/heads/master");
		f.setRef(null); await commit(f.root, "feat: disabled\n\nAiki-Task: T1"); await f.observer.poll(); expect(f.facts).toEqual([]);
		f.setRef("refs/heads/missing"); await f.observer.poll(); expect(f.facts).toEqual([]);
		await git(f.root, "branch", "custom"); f.setRef("refs/heads/custom"); await f.observer.poll(); expect(f.facts).toEqual([]);
		const empty = await mkdtemp(join(tmpdir(), "task-changes-empty-")); roots.push(empty);
		await new TaskChangeObserver({ ...f.options, path: empty }).poll();
		await git(empty, "init"); await new TaskChangeObserver({ ...f.options, path: empty }).poll();
	});
});

describe.skipIf(!hasJj)("colocated jj observation and workspace provenance", () => {
	test("jj rebase preserves change identity and replaces concrete hashes", async () => {
		const f = await fixture(true); await f.observer.poll();
		await jj(f.root, "commit", "-m", "feat: task change\n\nAiki-Task: T1");
		await jj(f.root, "bookmark", "set", "main", "-r", "@-");
		const changeId = await jj(f.root, "--ignore-working-copy", "log", "--no-graph", "-r", "main", "-T", "change_id");
		const old = await git(f.root, "rev-parse", "main"); await f.observer.poll();
		await jj(f.root, "new", "main-", "-m", "feat: another base");
		await jj(f.root, "commit", "-m", "feat: another base");
		const base = await jj(f.root, "--ignore-working-copy", "log", "--no-graph", "-r", "@-", "-T", "commit_id");
		await jj(f.root, "rebase", "-r", changeId, "-d", base);
		const rewritten = await git(f.root, "rev-parse", "main"); expect(rewritten).not.toBe(old);
		await f.observer.poll();
		const changes = repository(await f.ledger()).changes;
		expect(changes).toHaveLength(1); expect(changes[0]?.changeId).toBe(changeId); expect(changes[0]?.commits).toEqual([rewritten]);
		expect(f.facts[1]?.removed.map(commit => commit.hash)).toContain(old);
	}, 30_000);
	test("Git ref observation never snapshots dirty jj files or writes a jj operation", async () => {
		const f = await fixture(true); await f.observer.poll();
		const beforeWorking = await jj(f.root, "--ignore-working-copy", "log", "--no-graph", "-r", "@", "-T", "commit_id");
		await writeFile(join(f.root, "uncommitted.txt"), "must stay uncommitted\n");
		await commit(f.root, "feat: external Git\n\nAiki-Task: T1");
		const operation = await jj(f.root, "--ignore-working-copy", "op", "log", "--limit", "1", "--no-graph", "-T", "id");
		await f.observer.poll(); await f.observer.poll();
		expect(await jj(f.root, "--ignore-working-copy", "op", "log", "--limit", "1", "--no-graph", "-T", "id")).toBe(operation);
		expect(await jj(f.root, "--ignore-working-copy", "log", "--no-graph", "-r", "@", "-T", "commit_id")).toBe(beforeWorking);
		expect(await git(f.root, "ls-tree", "-r", "HEAD", "--", "uncommitted.txt")).toBe("");
		expect(f.facts).toHaveLength(1);
	});
	test("single-task base→tip attribution is durable before actual workspace cleanup; unrelated commits excluded", async () => {
		const f = await fixture(true); await f.observer.poll();
		const workspace = await mkdtemp(join(tmpdir(), "task-workspace-")); await rm(workspace, { recursive: true }); roots.push(workspace);
		await jj(f.root, "workspace", "add", workspace, "--name", "synthetic-worker", "-r", "main");
		await f.observer.rememberWorkspace(workspace);
		await writeFile(join(workspace, "feature.txt"), "task work\n"); await jj(workspace, "commit", "-m", "feat: isolated work");
		const hash = await jj(workspace, "--ignore-working-copy", "log", "--no-graph", "-r", "@-", "-T", "commit_id");
		const unrelated = await commit(f.root, "feat: unrelated while worker ran");
		await f.observer.recordWorkspace(workspace, ["T2"], { threadId: "example", conversationId: 8, runId: "run-2" });
		const changes = repository(await f.ledger()).changes;
		expect(changes).toHaveLength(1); expect(changes[0]).toMatchObject({ taskId: "T2", source: "workspace", commits: [hash], threadId: "example", conversationId: 8, runId: "run-2" });
		expect(changes.some(change => change.commits.includes(unrelated))).toBe(false);
		await removeJjWorkspace({ repo: f.root, name: "synthetic-worker", path: workspace });
		await git(f.root, "update-ref", "refs/heads/main", hash); await f.observer.poll();
		expect(f.facts.at(-1)?.taskIds).toEqual(["T2"]);
	}, 30_000);
	test("multiple tasks require trailers; unknown explicit IDs never fall back; explicit trailers take precedence", async () => {
		const f = await fixture(true);
		const workspace = await mkdtemp(join(tmpdir(), "task-workspace-")); await rm(workspace, { recursive: true }); roots.push(workspace);
		await jj(f.root, "workspace", "add", workspace, "--name", "synthetic-worker", "-r", "main"); await f.observer.rememberWorkspace(workspace);
		await jj(workspace, "commit", "-m", "feat: no declaration");
		await jj(workspace, "commit", "-m", "feat: invalid declaration\n\nAiki-Task: T999");
		await jj(workspace, "commit", "-m", "feat: explicit\n\nAiki-Task: T1, T2");
		await f.observer.recordWorkspace(workspace, ["T1", "T2"]);
		expect(repository(await f.ledger()).changes.map(change => [change.taskId, change.source])).toEqual([["T1", "trailer"], ["T2", "trailer"]]);
		await f.observer.recordWorkspace(workspace, ["T1"]);
		const changes = repository(await f.ledger()).changes;
		expect(changes.filter(change => change.source === "workspace")).toHaveLength(1);
		expect(changes).toHaveLength(3); expect(f.diagnostics.join()).toContain("T999");
	}, 30_000);
});
