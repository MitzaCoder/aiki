/** Opt-in local deployment feed. Reads objects/files only; never invokes a deploy or a configured command. */
import { watch, type FSWatcher, constants } from "node:fs";
import { open } from "node:fs/promises";
import { dirname } from "node:path";
import { readJsonFile, writeJsonFile } from "./fs-json.ts";
import { gitRepository, type TaskChangeObserver } from "./task-changes.ts";

export const DEPLOY_FEED_MAX_BYTES = 2 * 1024 * 1024;
export type DeployTarget = {
 state: "queued" | "running" | "ok" | "failed" | "rolled_back" | "pending";
 previousCommit?: string;
 servingCommit?: string;
 backendUnchanged?: boolean;
 message?: string;
};
export type DeployAttempt = {
 attemptId: string;
 sequence: number;
 intendedCommit: string;
 expectedTargets: string[];
 targets: Record<string, DeployTarget>;
 observedAt: string;
 taskIds?: string[];
 changeIds?: string[];
};
export type DeployFeed = { version: 1; repository: string; projectId?: string; events: DeployAttempt[] };
export type TaskDeployFact = DeployAttempt & { scope: string; order: number; taskIds: string[] };
type Cursor = {
 version: 1; projectId: string; feed: string; sequence: number;
 attempts: Record<string, { order: number; taskIds: string[]; intendedCommit: string; expectedTargets: string[] }>;
 verified: Record<string, { commit: string; order: number }>;
 pending?: TaskDeployFact;
};
const hash = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const names = (v: unknown): v is string[] => Array.isArray(v) && v.length <= 64 && v.every(s => typeof s === "string" && /^[A-Za-z0-9_.-]{1,100}$/.test(s) && !["__proto__", "constructor", "prototype"].includes(s));

export function parseDeployFeed(text: string): DeployFeed {
 if (Buffer.byteLength(text) > DEPLOY_FEED_MAX_BYTES) throw new Error("Deploy feed too large");
 const feed: unknown = JSON.parse(text);
 if (!record(feed) || feed.version !== 1 || typeof feed.repository !== "string" || feed.repository.length > 4096 || (feed.projectId !== undefined && typeof feed.projectId !== "string") || !Array.isArray(feed.events) || feed.events.length > 4096) throw new Error("Invalid deploy feed envelope");
 let previous = 0;
 for (const event of feed.events) {
  if (!record(event) || !names([event.attemptId]) || !Number.isSafeInteger(event.sequence) || (event.sequence as number) <= previous || typeof event.intendedCommit !== "string" || !hash.test(event.intendedCommit) || !names(event.expectedTargets) || !event.expectedTargets.length || new Set(event.expectedTargets).size !== event.expectedTargets.length || !record(event.targets) || typeof event.observedAt !== "string" || !Number.isFinite(Date.parse(event.observedAt))) throw new Error("Invalid deploy attempt/sequence");
  previous = event.sequence as number;
  if (Object.keys(event.targets).length !== event.expectedTargets.length) throw new Error("Incomplete deploy target set");
  for (const name of event.expectedTargets) {
   const target = event.targets[name];
   if (!record(target) || !["queued", "running", "ok", "failed", "rolled_back", "pending"].includes(target.state as string) || [target.previousCommit, target.servingCommit].some(v => v !== undefined && (typeof v !== "string" || !hash.test(v))) || (target.message !== undefined && (typeof target.message !== "string" || target.message.length > 2000)) || (target.backendUnchanged !== undefined && typeof target.backendUnchanged !== "boolean")) throw new Error("Invalid deploy target");
   if (target.backendUnchanged && target.state !== "ok") throw new Error("Unverified unchanged target");
  }
  for (const key of ["taskIds", "changeIds"]) if (event[key] !== undefined && !names(event[key])) throw new Error("Invalid deploy attribution hints");
 }
 return feed as DeployFeed;
}

/** A single bounded read of a regular file, including when the configured path is accidentally a FIFO/device. */
async function readFeed(file: string): Promise<DeployFeed> {
 const handle = await open(file, constants.O_RDONLY | constants.O_NONBLOCK);
 try {
  const stat = await handle.stat();
  if (!stat.isFile() || stat.size > DEPLOY_FEED_MAX_BYTES) throw new Error("Deploy feed must be a bounded regular file");
  const buffer = Buffer.alloc(DEPLOY_FEED_MAX_BYTES + 1);
  const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
  if (bytesRead > DEPLOY_FEED_MAX_BYTES) throw new Error("Deploy feed too large");
  return parseDeployFeed(buffer.subarray(0, bytesRead).toString("utf8"));
 } finally { await handle.close(); }
}

export type TaskDeployObserverOptions = {
 projectId: string; path: string; cursorFile: string;
 feed(): string | null | undefined;
 changes: Pick<TaskChangeObserver, "deploymentTasks">;
 onAttempt(fact: TaskDeployFact): Promise<void>;
 onConfigured?(configured: boolean): Promise<void>;
 onAvailability?(available: boolean): Promise<void>;
 log(message: string): void;
};
export class TaskDeployObserver {
 #options: TaskDeployObserverOptions;
 #queue: Promise<unknown> = Promise.resolve();
 #watcher?: FSWatcher;
 #watched?: string;
 #timer?: ReturnType<typeof setInterval>;
 #stopped = false;
 #started = false;
 #configured?: boolean;
 #available?: boolean;
 constructor(options: TaskDeployObserverOptions) { this.#options = options; }
 poll(): Promise<void> {
  const next = this.#queue.then(async () => {
   try { await this.#poll(); }
   catch (error) {
    if (this.#options.feed() && this.#available !== false) { await this.#options.onAvailability?.(false); this.#available = false; }
    throw error;
   }
  });
  this.#queue = next.catch(() => undefined);
  return next;
 }
 async #poll(): Promise<void> {
  if (this.#stopped) return;
  const file = this.#options.feed();
  if (this.#configured !== !!file) { await this.#options.onConfigured?.(!!file); this.#configured = !!file; }
  if (file !== this.#watched) {
   this.#watcher?.close(); this.#watcher = undefined; this.#watched = file ?? undefined;
  }
  if (!file) return;
  if (this.#started && !this.#watcher) try { this.#watcher = watch(dirname(file), () => this.#quiet()); this.#watcher.on("error", () => { this.#watcher?.close(); this.#watcher = undefined; }); } catch { /* fallback poll retries missing directories */ }
  const repository = await gitRepository(this.#options.path);
  const feed = await readFeed(file);
  if (!repository || feed.repository !== repository || (feed.projectId !== undefined && feed.projectId !== this.#options.projectId)) throw new Error("Deploy feed scope mismatch");
  const stored = await readJsonFile(this.#options.cursorFile) as Cursor | undefined;
  if (stored && (stored.version !== 1 || stored.projectId !== this.#options.projectId)) throw new Error("Deploy cursor scope mismatch");
  const cursor: Cursor = stored?.feed === file ? stored : { version: 1, projectId: this.#options.projectId, feed: file, sequence: 0, attempts: {}, verified: {} };
  const deliver = async () => {
   if (!cursor.pending) return;
   await this.#options.onAttempt(cursor.pending);
   delete cursor.pending;
   await writeJsonFile(this.#options.cursorFile, cursor);
  };
  await deliver();
  if ((feed.events.at(-1)?.sequence ?? 0) < cursor.sequence) throw new Error("Deploy feed sequence regressed");
  // Retention may have discarded history while this project was closed. Keep the admission
  // sequence/attempt identities for dedupe, but use the feed's frozen target baselines rather
  // than attributing all changes since a stale pre-gap success to the first retained attempt.
  if (cursor.sequence > 0 && (feed.events[0]?.sequence ?? 0) > cursor.sequence) cursor.verified = {};
  const ranges = new Map<string, Promise<string[]>>();
  const tasks = (previous: string | undefined, intended: string): Promise<string[]> => {
   const key = `${previous ?? ""}:${intended}`;
   if (!ranges.has(key)) ranges.set(key, this.#options.changes.deploymentTasks(repository, previous, intended));
   return ranges.get(key)!;
  };
  for (const event of feed.events) {
   if (event.sequence <= cursor.sequence) continue;
   let attempt = cursor.attempts[event.attemptId];
   if (attempt && (attempt.intendedCommit !== event.intendedCommit || attempt.expectedTargets.join() !== event.expectedTargets.join())) throw new Error("Deploy attempt identity changed");
   const taskIds = new Set<string>();
   // Validate every object, even for frozen attempts and serving/rollback commits. Hints never grant attribution.
   for (const name of event.expectedTargets) {
    const target = event.targets[name]!;
    const previous = cursor.verified[name]?.commit ?? target.previousCommit;
    for (const id of await tasks(attempt ? undefined : previous, event.intendedCommit)) taskIds.add(id);
    for (const commit of [target.previousCommit, target.servingCommit]) if (commit) await tasks(undefined, commit);
   }
   if (!attempt) {
    cursor.attempts[event.attemptId] = { order: event.sequence, taskIds: [...taskIds], intendedCommit: event.intendedCommit, expectedTargets: event.expectedTargets };
    attempt = cursor.attempts[event.attemptId]!;
   }
   for (const name of event.expectedTargets) {
    if ((cursor.verified[name]?.order ?? 0) > attempt.order) continue;
    const target = event.targets[name]!;
    if (target.state === "ok") cursor.verified[name] = { commit: event.intendedCommit, order: attempt.order };
    else if (target.state === "rolled_back") {
     const serving = target.servingCommit ?? target.previousCommit;
     if (serving) cursor.verified[name] = { commit: serving, order: attempt.order };
     else delete cursor.verified[name];
    }
   }
   cursor.sequence = event.sequence;
   cursor.pending = { ...event, taskIds: attempt.taskIds, order: attempt.order, scope: `${repository}:${file}` };
   await writeJsonFile(this.#options.cursorFile, cursor);
   await deliver();
  }
  if (this.#available !== true) { await this.#options.onAvailability?.(true); this.#available = true; }
 }
 #quiet(): void { void this.poll().catch(error => this.#options.log(`task deploys: ${String(error)}`)); }
 async start(): Promise<void> { this.#started = true; this.#quiet(); this.#timer = setInterval(() => this.#quiet(), 10_000); this.#timer.unref(); await this.#queue; }
 async stop(): Promise<void> { this.#stopped = true; this.#watcher?.close(); if (this.#timer) clearInterval(this.#timer); await this.#queue; }
}

export function deploySummary(fact: DeployAttempt): { state: "failed" | "active" | "delivered"; text: string; outcome: boolean } {
 const targets = Object.values(fact.targets), total = fact.expectedTargets.length;
 const ready = targets.filter(t => t.state === "ok").length;
 const failed = targets.filter(t => t.state === "failed" || t.state === "rolled_back").length;
 if (failed) return { state: "failed", text: `Deploy failed on ${failed} of ${total} targets`, outcome: true };
 if (targets.some(t => t.state === "running")) return { state: "active", text: `Deploying ${fact.intendedCommit.slice(0,12)} · ${ready} of ${total} targets ready`, outcome: false };
 if (targets.some(t => t.state === "queued")) return { state: "active", text: `Deploy queued for ${fact.intendedCommit.slice(0,12)}`, outcome: false };
 return { state: "delivered", text: ready === total ? "Live on all backends" : `Live on ${ready} of ${total} targets · ${total - ready} pending`, outcome: true };
}
