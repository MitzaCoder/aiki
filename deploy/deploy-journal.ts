/** Origin-only, best-effort observer journal. Called under its own lock, never the deploy lock.
 * No protocol imports: tooling must also work from a checkout without installed dependencies.
 */
import { readFileSync, writeFileSync, renameSync, rmSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";

type Target = { state: string; previousCommit?: string; servingCommit?: string; backendUnchanged?: boolean; message?: string };
type Update = { id: string; sequence: number; intendedCommit: string; names: string[]; resume: boolean; target: string; state: string; previous?: string; status?: string; hostBaseline?: string; observedAt: string; attemptId?: string; snapshot?: Event };
type Event = { attemptId: string; sequence: number; intendedCommit: string; expectedTargets: string[]; targets: Record<string, Target>; observedAt: string };
const MAX_BYTES = 2 * 1024 * 1024;
export const JOURNAL_KEEP_ATTEMPTS = 200;
export const JOURNAL_KEEP_BYTES = 1024 * 1024;
type VerifiedTargets = Record<string, { commit: string; order: number }>; 
const commitHash = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;

/** Caller serializes writers with flock; a failure is diagnostic only and never changes deploy status. */
export function appendDeployJournal(file: string, repositoryPath: string, update: Update): void {
 const git = spawnSync("git", ["-C", repositoryPath, "rev-parse", "--path-format=absolute", "--git-common-dir"], { encoding: "utf8", timeout: 1000, env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" } });
 if (git.status !== 0) throw new Error("Cannot identify journal repository");
 const repository = realpathSync(git.stdout.trim());
 let updates: Update[] = [];
 let bases: Record<string, number> = {};
 let seeds: Record<string, Event> = {};
 let savedVerified: VerifiedTargets = {};
 let lastBase = -1000;
 try {
  const text = readFileSync(file, "utf8");
  if (Buffer.byteLength(text) > MAX_BYTES) throw new Error("Journal exceeds read bound");
  const earlier = JSON.parse(text);
  if (earlier.repository !== repository || earlier.version !== 1 || !Array.isArray(earlier.updates)) throw new Error("Journal scope/version mismatch");
  updates = earlier.updates;
  bases = earlier.bases ?? {};
  seeds = earlier.seeds ?? {};
  savedVerified = earlier.verified ?? {};
  lastBase = earlier.lastBase ?? Math.max(-1000, ...Object.values(bases));
 } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
 // Reserve a whole attempt interval on first arrival. Clock rollback cannot regress the feed;
 // out-of-order background updates within that interval still sort in orchestrator order.
 const ordinal = update.sequence % 1000;
 if (!Number.isSafeInteger(update.sequence) || ordinal < 1 || !/^[A-Za-z0-9_.-]+$/.test(update.id)) throw new Error("Invalid journal sequence");
 if (!Object.hasOwn(bases, update.id)) bases[update.id] = Math.max(Math.floor(update.sequence / 1000) * 1000, lastBase + 1000);
 lastBase = Math.max(lastBase, bases[update.id]!);
 update = { ...update, sequence: bases[update.id]! + ordinal };
 if (updates.some(u => u.sequence === update.sequence)) return;
 updates.push(update); updates.sort((a,b) => a.sequence - b.sequence);
 const attempts = new Map<string, Event>();
 const verified = new Map(Object.entries(savedVerified));
 const orders = new Map<string, number>();
 const events: Event[] = [];
 const aliases = new Map<string, string>();
 for (const u of updates) {
  let id = u.attemptId ?? aliases.get(u.id);
  if (!id) {
   id = u.resume ? [...attempts.values()].reverse().find(a => a.intendedCommit === u.intendedCommit)?.attemptId : undefined;
   id ??= u.id; aliases.set(u.id, id);
  }
  u.attemptId = id; aliases.set(u.id, id);
  let attempt = attempts.get(id);
  if (!attempt) {
   attempt = { attemptId: id, sequence: u.sequence, intendedCommit: u.intendedCommit, expectedTargets: u.names, targets: Object.fromEntries(u.names.map(name => [name, { state: "queued", ...(verified.has(name) ? { previousCommit: verified.get(name)!.commit } : {}) }])), observedAt: u.observedAt };
   if (attempt.targets.host && !attempt.targets.host.previousCommit && u.hostBaseline) try {
    const [releaseText, statusText] = u.hostBaseline.split("\n---");
    const parse = (text: string | undefined) => { try { return JSON.parse(text ?? "{}"); } catch { return {}; } };
    const release = parse(releaseText), status = parse(statusText);
    // unchanged status verifies a newer effective commit than the older running release.
    const previous = status.state === "ok" ? status.commit : release.commit;
    if (typeof previous === "string" && commitHash.test(previous)) attempt.targets.host.previousCommit = previous;
   } catch { /* Unknown baseline never imports the repository's whole history. */ }
   attempt = structuredClone(seeds[id] ?? attempt);
   seeds[id] ??= structuredClone(attempt);
   attempts.set(id, attempt); orders.set(id, seeds[id]!.sequence);
  }
  if (u.snapshot) { attempt = structuredClone(u.snapshot); attempts.set(id, attempt); }
  if (u.target && attempt.targets[u.target]) {
   const target = attempt.targets[u.target]!;
   target.state = u.state;
   delete target.message; delete target.backendUnchanged;
   if (u.state === "ok") target.servingCommit = u.intendedCommit;
   if (u.previous && commitHash.test(u.previous) && !target.previousCommit) target.previousCommit = u.previous;
   if (u.status) try {
    const [releaseText, statusText] = u.status.split("\n---");
    const release = JSON.parse(releaseText ?? "{}");
    const status = JSON.parse(statusText ?? "{}");
    if (commitHash.test(release.commit)) target.servingCommit = release.commit;
    if (status.commit === u.intendedCommit && ["ok", "failed", "rolled_back"].includes(status.state)) {
     target.state = status.state;
     if (status.backendUnchanged === true && status.state === "ok") target.backendUnchanged = true;
     if (typeof status.message === "string") target.message = status.message.slice(0,2000);
    }
   } catch { /* A disconnected target is still pending/failed, not fabricated success. */ }
   if (target.state === "ok") {
    if ((verified.get(u.target)?.order ?? 0) <= orders.get(id)!) verified.set(u.target, { commit: u.intendedCommit, order: orders.get(id)! });
    target.servingCommit ??= u.intendedCommit;
   } else if (target.state === "rolled_back") {
    target.servingCommit ??= target.previousCommit;
    if (target.servingCommit && (verified.get(u.target)?.order ?? 0) <= orders.get(id)!) verified.set(u.target, { commit: target.servingCommit, order: orders.get(id)! });
   }
  }
  attempt.sequence = u.sequence; attempt.observedAt = u.observedAt;
  events.push(structuredClone(attempt));
 }
 // Evict whole oldest attempts, including replay inputs and sequence reservations. Keep the
 // frozen start baselines and verified target cursors separately: pruning must not reattribute
 // retained attempts or lose a success on a target that has been offline since before the cut.
 const kept = [...attempts.keys()].sort((a,b) => orders.get(b)! - orders.get(a)!).slice(0, JOURNAL_KEEP_ATTEMPTS);
 let retainedEvents: Event[] = [], retainedUpdates: Update[] = [];
 let retainedBases: Record<string, number> = {}, retainedSeeds: Record<string, Event> = {};
 let verifiedTargets: VerifiedTargets = {};
 const encode = () => JSON.stringify({ version: 1, repository, events: retainedEvents, updates: retainedUpdates, bases: retainedBases, seeds: retainedSeeds, verified: verifiedTargets, lastBase });
 let text: string;
 for (;;) {
  const ids = new Set(kept);
  retainedEvents = events.filter(event => ids.has(event.attemptId));
  retainedUpdates = updates.filter(u => ids.has(u.attemptId!));
  const sessions = new Set(retainedUpdates.map(u => u.id));
  retainedBases = Object.fromEntries(Object.entries(bases).filter(([id]) => sessions.has(id)));
  retainedSeeds = Object.fromEntries(kept.map(id => [id, seeds[id]!]));
  const targetNames = new Set(retainedEvents.flatMap(event => event.expectedTargets));
  verifiedTargets = Object.fromEntries([...verified].filter(([name]) => targetNames.has(name)));
  text = encode();
  if (Buffer.byteLength(text) <= JOURNAL_KEEP_BYTES && retainedEvents.length <= 4096) break;
  if (kept.length > 1) { kept.pop(); continue; }
  // A single unusually noisy attempt still cannot fill the file forever. Compact its history
  // to a full latest snapshot, retaining its original identity, order and frozen baselines.
  const latest = retainedEvents.at(-1)!;
  const session = retainedUpdates.at(-1)!.id;
  retainedEvents = [latest];
  retainedUpdates = [{ id: session, attemptId: latest.attemptId, sequence: latest.sequence, intendedCommit: latest.intendedCommit, names: latest.expectedTargets, resume: false, target: "", state: "queued", observedAt: latest.observedAt, snapshot: latest }];
  retainedBases = { [session]: bases[session]! };
  text = encode();
  if (Buffer.byteLength(text) > JOURNAL_KEEP_BYTES) throw new Error("Deploy snapshot exceeds journal budget");
  break;
 }
 const temporary = join(dirname(file), `.deploy-journal-${process.pid}.tmp`);
 try { writeFileSync(temporary, text, { mode: 0o600 }); renameSync(temporary, file); }
 finally { rmSync(temporary, { force: true }); }
}

if (import.meta.main) {
 try {
  const [file, repo, id, sequence, intendedCommit, names, resume, target = "", state = "queued", previous = "", status = "", hostBaseline = ""] = process.argv.slice(2);
  if (!file || !repo || !id || !sequence || !intendedCommit || !names) throw new Error("Missing journal arguments");
  appendDeployJournal(file, repo, { id, sequence: Number(sequence), intendedCommit, names: names.split(","), resume: resume === "1", target, state, previous, status, hostBaseline, observedAt: new Date().toISOString() });
 } catch { /* Deliberately no failure propagation, stdout, network call or deploy action. */ }
}
