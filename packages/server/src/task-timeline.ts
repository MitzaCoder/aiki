import { createHash } from "node:crypto";
import type { BoardTask, BoardTimelineEntry, BoardTimelineFact, BoardTimelineGroup, BoardTimelineGroupKind, BoardTimelineKind } from "@aiki/protocol";
import type { BoardState, TaskHistoryState } from "./board.ts";

/** Hash source keys, not labels/timestamps that change as work advances. */
export function timelineId(taskId: string, source: string): string {
 return createHash("sha256").update(`${taskId}\0${source}`).digest("hex").slice(0, 32);
}

/** Update a source in place. Start time, ID and hour never change; identical retries are inert. */
export function upsertTimelineFact(history: TaskHistoryState, task: BoardTask, input: Omit<BoardTimelineFact, "revision" | "factCount">): boolean {
 history.timelineEntries ??= [];
 const entries = history.timelineEntries;
 const previous = entries.find(entry => entry.id === input.id);
 if (previous) {
  const next = { ...input, at: previous.at };
  const { revision: _revision, factCount: _count, ...old } = previous;
  if (JSON.stringify(old) === JSON.stringify(next)) return false;
  const outcomeChanged = previous.outcome !== next.outcome;
  Object.assign(previous, next, { revision: previous.revision + 1, factCount: previous.factCount + (outcomeChanged ? 1 : 0) });
 } else entries.push({ ...input, revision: 1, factCount: 1 });
 if (entries.length > 500) entries.splice(0, entries.length - 500);
 task.timelineRevision = Math.max(task.timelineRevision ?? 0, history.revision ?? 0) + 1;
 history.revision = task.timelineRevision;
 return true;
}

function fact(taskId: string, source: string, entry: BoardTimelineEntry, group: BoardTimelineGroupKind, outcome = "recorded", count = 1): BoardTimelineFact {
 return { ...entry, id: timelineId(taskId, source), endAt: entry.at, group, outcome, revision: count, factCount: count };
}

/** Legacy worker IDs are names, scoped by writer thread and the episode's starting row. */
function foldLegacyEvents(taskId: string, events: readonly BoardTimelineEntry[], curated: readonly BoardTimelineFact[]): BoardTimelineFact[] {
 const entries: BoardTimelineFact[] = [];
 const workers = new Map<string, BoardTimelineFact>();
 for (const event of events) {
  if (event.kind === "worker") {
   const key = `${event.by?.threadId ?? "main"}:${event.ref ?? event.label}`;
   const outcome = /failed/i.test(event.label) ? "failed" : /reported/i.test(event.label) ? "reported" : /stopped/i.test(event.label) ? "stopped" : "running";
   // Curated run identities supersede the matching legacy projection, not another worker with the same name.
   if (curated.some(entry => entry.source === "worker" && entry.ref === event.ref && (!event.by?.threadId || entry.actor?.threadId === event.by.threadId) && entry.at <= event.at && entry.endAt >= event.at)) continue;
   let entry = workers.get(key);
   if (outcome === "running" || !entry || entry.outcome !== "running") {
    entry = { ...fact(taskId, `legacy-worker:${key}:${event.at}`, event, "work", outcome), source: "worker" };
    entries.push(entry);
    workers.set(key, entry);
   } else {
    Object.assign(entry, { label: event.label, detail: event.detail, endAt: event.at, outcome, revision: entry.revision + 1, factCount: entry.factCount + 1 });
   }
   continue;
  }
  if (curated.some(entry => entry.ref && entry.ref === event.ref && entry.kind === event.kind)) continue;
  // Legacy curated events only: no transport, tool, report rewrite or phase rows.
  if (!["link", "milestone", "status", "decision"].includes(event.kind) || excludedLabel(event.label)) continue;
  const delivery = event.ref?.startsWith("deploy:") || /changes? (landed|removed|reverted)/i.test(event.label);
  const entry = fact(taskId, delivery && event.ref ? event.ref : `event:${event.kind}:${event.ref ?? ""}:${event.at}:${event.label}`, event, delivery ? "delivery" : "work", /failed|rolled.back/i.test(event.label) ? "failed" : "recorded");
  if (delivery) entry.source = event.ref?.startsWith("deploy:") ? "deploy" : "change";
  entries.push(entry);
 }
 return entries;
}

function excludedLabel(label: string): boolean {
 return /^(report (updated|rewritten)|now updated|phase\b|metadata\b|title updated|description updated|refs updated|stale\b|check.in\b|artifact\b|thread message\b|tool\b)/i.test(label);
}

/** Pure read migration: snapshots remain byte-for-byte untouched, no upgrade/backfill writes. */
export function buildTimelineGroups(task: Pick<BoardTask, "id">, state: Readonly<BoardState>, history: Readonly<TaskHistoryState> | undefined, kinds?: readonly BoardTimelineKind[]): BoardTimelineGroup[] {
 const entries: BoardTimelineFact[] = (history?.timelineEntries ?? []).map(entry => ({ ...entry }));
 entries.push(...foldLegacyEvents(task.id, history?.events ?? [], entries));
 for (const snapshot of history?.snapshots ?? []) {
  if (excludedLabel(snapshot.label)) continue;
  const status = / → /.test(snapshot.label) || snapshot.label === "Created" || snapshot.label === "Waiting updated";
  entries.push(fact(task.id, `snapshot:${snapshot.seq}`, { at: snapshot.at, kind: status ? "status" : "milestone", label: snapshot.label, ref: String(snapshot.seq), by: snapshot.by,
   ...(snapshot.waiting ? { detail: snapshot.waiting.note } : {}) }, "work"));
 }
 for (const question of state.questions.filter(q => q.taskId === task.id)) {
  const outcome = question.status === "answered" && question.kind === "warning" ? "acknowledged" : question.status;
  const entry = fact(task.id, `question:${question.id}`, { at: question.askedAt, kind: "question", label: `${question.id} ${outcome}`, detail: [question.text, question.answer].filter(Boolean).join("\n"), ref: question.id }, "decisions", outcome, question.revision);
  entry.endAt = question.answeredAt ?? question.askedAt;
  entries.push(entry);
 }
 for (const feedback of history?.feedback ?? []) {
  const entry = fact(task.id, `feedback:${feedback.id}`, { at: feedback.at, kind: "feedback", label: `${feedback.id} ${feedback.state}`, detail: [feedback.text, ...feedback.changes.map(change => `${change.state}${change.note ? `: ${change.note}` : ""}`)].join("\n"), ref: feedback.id, state: feedback.state, by: { author: "user", threadId: null, workerId: null } }, "decisions", feedback.state, feedback.changes.length + 1);
  entry.endAt = feedback.changes.at(-1)?.at ?? feedback.at;
  entries.push(entry);
 }
 for (const decision of state.decisions.filter(d => d.taskId === task.id)) entries.push(fact(task.id, `decision:${decision.id}`, { at: decision.at, kind: "decision", label: `Decision ${decision.id}`, detail: [decision.text, decision.why].filter(Boolean).join(" — "), ref: decision.id }, "decisions"));
 const groups = new Map<string, BoardTimelineGroup>();
 const ordered = entries.filter(entry => !kinds?.length || kinds.includes(entry.kind)).sort((a,b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id));
 for (const entry of ordered) {
  const time = Date.parse(entry.at);
  if (!Number.isFinite(time)) continue;
  const hour = new Date(Math.floor(time / 3_600_000) * 3_600_000).toISOString();
  const id = timelineId(task.id, `${hour}:${entry.group}`);
  let group = groups.get(id);
  if (!group) {
   group = { id, kind: entry.group, hour, range: { start: entry.at, end: entry.endAt }, revision: 0, factCount: 0, label: "", entries: [] };
   groups.set(id, group);
  }
  group.entries.push(entry);
  if (entry.endAt > group.range.end) group.range.end = entry.endAt;
  group.revision += entry.revision;
  group.factCount += entry.factCount;
 }
 for (const group of groups.values()) group.label = timelineGroupLabel(group);
 return [...groups.values()].sort((a,b) => a.hour.localeCompare(b.hour) || a.kind.localeCompare(b.kind));
}

/** Failures and unresolved questions win over later routine successes. Labels contain no newlines. */
export function timelineGroupLabel(group: BoardTimelineGroup): string {
 const latest = [...group.entries].sort((a,b) => b.endAt.localeCompare(a.endAt) || b.id.localeCompare(a.id));
 const failure = latest.find(entry => entry.outcome === "failed" || entry.outcome === "rolled_back");
 const open = latest.filter(entry => entry.kind === "question" && entry.outcome === "open");
 const clean = (label: string) => label.replace(/\s+/g, " ").trim();
 if (failure) return clean(failure.label);
 if (open.length) return `${open.map(entry => entry.ref).join(", ")} awaiting answer`;
 if (group.kind === "decisions") {
  const question = latest.find(entry => entry.kind === "question");
  const feedback = latest.find(entry => entry.kind === "feedback");
  return [question, feedback].filter((entry): entry is BoardTimelineFact => !!entry).map(entry => clean(entry.label)).join("; ") || clean(latest[0]!.label);
 }
 if (group.kind === "delivery") {
  const landed = latest.reduce((count, entry) => count + Number(/^(\d+) changes? landed/i.exec(entry.label)?.[1] ?? 0), 0);
  const deploy = latest.find(entry => entry.source === "deploy");
  return [landed ? `${landed} change${landed === 1 ? "" : "s"} landed` : "", deploy ? clean(deploy.label) : ""].filter(Boolean).join("; ") || clean(latest[0]!.label);
 }
 const workers = latest.filter(entry => entry.source === "worker" && entry.outcome === "reported").length;
 const status = latest.find(entry => entry.kind === "status");
 const outcome = status && /→ review$/.test(status.label) ? "ready for review" : status ? clean(status.label) : "";
 return [workers ? `${workers} worker${workers === 1 ? "" : "s"} reported` : "", outcome].filter(Boolean).join("; ") || clean(latest[0]!.label);
}

/** Lifecycle-only projection; phase/check-in/report rewrites never call this reducer. */
export function recordTimelineRun(history: TaskHistoryState, task: BoardTask, actor: import("@aiki/protocol").BoardActivityActor, outcome: string, at: string, detail: string): void {
 if (actor.kind === "coordinator") return;
 const previous = [...(history.timelineEntries ?? [])].reverse().find(entry => entry.source === actor.kind && entry.actor?.conversationId === actor.conversationId && entry.actor.threadId === actor.threadId);
 const exact = history.timelineEntries?.find(entry => entry.actor?.id === actor.id);
 const claim = actor.kind === "thread" && outcome === "running" && !exact ? [...(history.timelineEntries ?? [])].reverse().find(entry => entry.source === "ownership" && entry.label === `Claimed by ${actor.name}`) : undefined;
 const continuing = previous && (previous.outcome === "running" || outcome !== "running");
 const entry = actor.kind === "thread" ? exact ?? claim : continuing ? previous : undefined;
 if (entry?.outcome === outcome && entry.detail === detail) return;
 const legacyStart = !entry && outcome !== "running" && actor.kind === "worker" ? [...(history.events ?? [])].reverse().find(event => event.kind === "worker" && event.ref === actor.name && /started/.test(event.label) && event.at <= at && (!event.by?.threadId || event.by.threadId === actor.threadId)) : undefined;
 const legacyKey = legacyStart ? `legacy-worker:${legacyStart.by?.threadId ?? "main"}:${actor.name}:${legacyStart.at}` : undefined;
 const id = entry?.id ?? timelineId(task.id, legacyKey ?? `run:${actor.threadId}:${actor.conversationId}:${actor.runId}`);
 if (legacyStart) upsertTimelineFact(history, task, { ...legacyStart, id, endAt: legacyStart.at, group: "work", source: "worker", outcome: "running", actor });
 upsertTimelineFact(history, task, { id, at: entry?.at ?? legacyStart?.at ?? at, endAt: at, kind: "worker", group: "work", source: actor.kind, outcome,
  label: `${actor.kind === "worker" ? "Worker" : "Thread"} ${actor.name} ${outcome}`, detail, ref: actor.name, actor: entry?.actor ?? actor,
  by: { author: "harness", threadId: actor.threadId === "main" ? null : actor.threadId, workerId: actor.kind === "worker" ? actor.name : null } });
}
