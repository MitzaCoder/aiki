import { afterEach, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { TaskChangeObserver, gitRepository } from "../src/task-changes.ts";
import { TaskDeployObserver, parseDeployFeed, DEPLOY_FEED_MAX_BYTES, deploySummary, type DeployAttempt, type TaskDeployFact, type TaskDeployObserverOptions } from "../src/task-deploys.ts";

const roots: string[] = [];
afterEach(async () => { for (const path of roots.splice(0)) await rm(path, { recursive: true, force: true }); });
async function git(path: string, ...args: string[]): Promise<string> {
 const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("KEMIRI_")));
 const child = Bun.spawn(["git", ...args], { cwd: path, timeout: 10_000, env: { ...env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" }, stdout: "pipe", stderr: "pipe" });
 const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
 if (code) throw new Error(stderr);
 return stdout.trim();
}
async function fixture() {
 const path = await mkdtemp(join(tmpdir(), "task-deploys-")); roots.push(path);
 await git(path, "init", "-b", "main"); await git(path, "config", "user.name", "Fixture"); await git(path, "config", "user.email", "fixture@example.invalid");
 const commit = async (message: string) => { await git(path, "-c", "commit.gpgsign=false", "commit", "--allow-empty", "-m", message); return git(path, "rev-parse", "HEAD"); };
 const base = await commit("baseline");
 const changes = new TaskChangeObserver({ projectId: "synthetic", path, file: join(path,"ledger.json"), integrationRef: () => "auto", taskIds: async () => ["T1", "T2", "T3"], log: () => {} });
 await changes.poll();
 const middle = await commit("feat: first\n\nAiki-Task: T1, T2");
 const tip = await commit("feat: second\n\nAiki-Task: T3"); await changes.poll();
 const repository = (await gitRepository(path))!;
 const file = join(path,"feed.json"), cursorFile = join(path,"cursor.json");
 let configured: string | null = file;
 const facts: TaskDeployFact[] = [];
 const options: TaskDeployObserverOptions = { projectId: "synthetic", path, cursorFile, feed: () => configured, changes, onAttempt: async (fact: TaskDeployFact) => { facts.push(structuredClone(fact)); }, log: () => {} };
 const observers: TaskDeployObserver[] = [];
 const observer = () => { const o = new TaskDeployObserver(options); observers.push(o); return o; };
 const publish = (events: DeployAttempt[], scope = repository) => writeFile(file, JSON.stringify({ version: 1, projectId: "synthetic", repository: scope, events }));
 const attempt = (sequence = 1): DeployAttempt => ({ attemptId: "release-1", sequence, intendedCommit: tip, expectedTargets: ["one", "two", "three"], observedAt: "2026-01-01T12:00:00.000Z", targets: { one: { state: "queued", previousCommit: middle }, two: { state: "queued", previousCommit: base }, three: { state: "queued", previousCommit: base } } });
 return { path, base, middle, tip, facts, options, observer, publish, attempt, commit, changes, file, setFeed: (f: string | null) => { configured = f; }, cursor: async () => JSON.parse(await readFile(cursorFile,"utf8")), stop: async () => { for (const o of observers) await o.stop(); await changes.stop(); } };
}

test("freeze all newly shipped changes across target baselines, not just tip; hints never grant attribution", async () => {
 const f = await fixture(); try {
  const start = f.attempt(); start.taskIds = ["T999"];
  await f.publish([start]); const o = f.observer(); await o.poll();
  expect(f.facts[0]?.taskIds.sort()).toEqual(["T1","T2","T3"]);
  const next = structuredClone(start); next.sequence = 2; next.targets.one!.state = "running";
  // Ledger changes after admission cannot change this attempt's membership.
  f.options.changes = { deploymentTasks: async () => ["T999"] };
  await f.publish([start,next]); await o.poll();
  expect(f.facts[1]?.taskIds.sort()).toEqual(["T1","T2","T3"]);
 } finally { await f.stop(); }
});

test("rollback tracks attempted vs serving; pending isn't ok; catch-up and unchanged verify without changing serving", async () => {
 const f = await fixture(); try {
  const start = f.attempt(); const rollback = structuredClone(start); rollback.sequence = 2;
  rollback.targets.one = { state: "rolled_back", previousCommit: f.middle, servingCommit: f.middle };
  rollback.targets.two = { state: "ok", previousCommit: f.base, servingCommit: f.base, backendUnchanged: true };
  rollback.targets.three!.state = "pending";
  await f.publish([start,rollback]); const o = f.observer(); await o.poll();
  expect(deploySummary(f.facts[1]!)).toMatchObject({ state: "failed", text: "Deploy failed on 1 of 3 targets" });
  expect((await f.cursor()).verified.one.commit).toBe(f.middle);
  expect((await f.cursor()).verified.two.commit).toBe(f.tip);
  expect((await f.cursor()).verified.three).toBeUndefined();
  const recovered = structuredClone(rollback); recovered.sequence = 3; recovered.targets.one!.state = "ok"; recovered.targets.one!.servingCommit = f.tip;
  await f.publish([start,rollback,recovered]); await o.poll();
  expect(deploySummary(f.facts[2]!)).toMatchObject({ text: "Live on 2 of 3 targets · 1 pending" });
  const caughtUp = structuredClone(recovered); caughtUp.sequence = 4; caughtUp.targets.three!.state = "ok";
  await f.publish([start,rollback,recovered,caughtUp]); await o.poll();
  expect(deploySummary(f.facts[3]!)).toMatchObject({ text: "Live on all backends" });
  expect(f.facts[3]!.targets.two!.servingCommit).toBe(f.base);
  expect(f.facts.every(fact => fact.taskIds.length === 3)).toBe(true);
 } finally { await f.stop(); }
});

test("restart catches missed attempts exactly once; callback crash replays durable admission; sequences reject regression", async () => {
 const f = await fixture(); try {
  const first = f.attempt(); await f.publish([first]);
  const availability: boolean[] = [];
  f.options.onAvailability = async available => { availability.push(available); };
  const initial = f.observer(); await initial.poll();
  await writeFile(f.file, "{"); await expect(initial.poll()).rejects.toThrow();
  await f.publish([first]); await initial.poll();
  expect(availability).toEqual([true, false, true]);
  const second = f.attempt(2); second.attemptId = "release-2";
  const third = f.attempt(3); third.attemptId = "release-3";
  await f.publish([first,second,third]); await f.observer().poll(); await f.observer().poll();
  expect(f.facts.map(f => f.sequence)).toEqual([1,2,3]);
  const fourth = f.attempt(4); fourth.attemptId = "release-4";
  await f.publish([first,second,third,fourth]);
  const failing = new TaskDeployObserver({ ...f.options, onAttempt: async () => { throw new Error("interrupted"); } });
  await expect(failing.poll()).rejects.toThrow("interrupted"); await failing.stop();
  await f.observer().poll(); await f.observer().poll();
  expect(f.facts.map(f => f.sequence)).toEqual([1,2,3,4]);
  await f.publish([first]); await expect(f.observer().poll()).rejects.toThrow("regressed");
  await f.publish([first,first]); await expect(f.observer().poll()).rejects.toThrow("sequence");
 } finally { await f.stop(); }
});

test("old cursor resumes a trimmed journal at unseen attempts once, using retained rather than stale target baselines", async () => {
 const f = await fixture(); try {
  const old = f.attempt(); old.intendedCommit = f.base;
  for (const target of Object.values(old.targets)) { target.state = "ok"; target.previousCommit = f.base; }
  await f.publish([old]); await f.observer().poll();
  expect((await f.cursor()).sequence).toBe(1);
  const retained = f.attempt(100); retained.attemptId = "retained-failure";
  for (const target of Object.values(retained.targets)) { target.previousCommit = f.middle; target.state = "failed"; }
  const newest = structuredClone(retained); newest.sequence = 101; newest.attemptId = "retained-retry";
  for (const target of Object.values(newest.targets)) target.state = "ok";
  // The writer has pruned both the consumed entry and the intervening missed attempts.
  await f.publish([retained,newest]); await f.observer().poll(); await f.observer().poll();
  expect(f.facts.map(fact=>fact.sequence)).toEqual([1,100,101]);
  expect(f.facts.slice(1).map(fact=>fact.taskIds)).toEqual([["T3"],["T3"]]);
  expect((await f.cursor()).sequence).toBe(101);
  expect((await f.cursor()).verified.one.commit).toBe(f.tip);
  // Another trim retains a consumed attempt alongside a new one: never reapply the consumed one.
  const later = f.attempt(102); later.attemptId = "later";
  for(const target of Object.values(later.targets)) { target.previousCommit=f.tip; target.state="ok"; }
  await f.publish([newest,later]); await f.observer().poll(); await f.observer().poll();
  expect(f.facts.map(fact=>fact.sequence)).toEqual([1,100,101,102]);
  expect(f.facts.at(-1)!.taskIds).toEqual([]);
 } finally { await f.stop(); }
});

test("unattributed deploys and no configured feed leave tasks alone; commits/scope/identity are verified", async () => {
 const f = await fixture(); try {
  f.setFeed(null); await f.observer().poll(); expect(f.facts).toEqual([]);
  f.setFeed(f.file);
  const unrelated = await f.commit("docs: unrelated"); const event = f.attempt(); event.intendedCommit = unrelated;
  for (const t of Object.values(event.targets)) t.previousCommit = f.tip;
  await f.publish([event]); const o = f.observer(); await o.poll(); expect(f.facts[0]!.taskIds).toEqual([]);
  event.sequence = 2; event.intendedCommit = f.base;
  await f.publish([f.attempt(),event]); await expect(o.poll()).rejects.toThrow("identity changed");
  await f.publish([f.attempt()], "/tmp/not-the-repository"); await expect(o.poll()).rejects.toThrow("scope");
  const invalid = f.attempt(2); invalid.attemptId = "invalid"; invalid.intendedCommit = "f".repeat(40);
  await f.publish([invalid]); await expect(o.poll()).rejects.toThrow("Invalid deploy commit");
 } finally { await f.stop(); }
});

test("file reader rejects oversized input before parse and incomplete snapshots", async () => {
 const f = await fixture(); try {
  await writeFile(f.file, " ".repeat(DEPLOY_FEED_MAX_BYTES + 1));
  await expect(f.observer().poll()).rejects.toThrow("bounded regular file");
  await writeFile(f.file, "{"); await expect(f.observer().poll()).rejects.toThrow();
  expect(f.facts).toEqual([]);
 } finally { await f.stop(); }
});

test("bounded feed parser rejects malformed, oversize, partial target sets and invalid state", () => {
 expect(() => parseDeployFeed("{")).toThrow();
 expect(() => parseDeployFeed(" ".repeat(DEPLOY_FEED_MAX_BYTES + 1))).toThrow("too large");
 const feed = { version: 1, repository: "synthetic", events: [{ attemptId: "one", sequence: 1, intendedCommit: "a".repeat(40), observedAt: "2026-01-01T00:00:00Z", expectedTargets: ["one"], targets: {} }] };
 expect(() => parseDeployFeed(JSON.stringify(feed))).toThrow("Incomplete");
 Object.assign(feed.events[0]!.targets, { one: { state: "offline" } });
 expect(() => parseDeployFeed(JSON.stringify(feed))).toThrow("target");
});
