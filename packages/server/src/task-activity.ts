import type { BoardTask, BoardTaskActivity, BoardActivityActor, BoardQuestion } from "@kemiri/protocol";

/** Durable run identities, never worker names alone. Deployment facts have separate typed slots. */
export type TaskActivitySource = {
 actor: BoardActivityActor;
 state: "running" | "failed" | "ended" | "unknown";
 since: string;
 phase?: string;
 title: string;
 failure?: string;
};
export type TaskActivityTracking = {
 sources: Record<string, TaskActivitySource>;
 lastEndedAt?: string;
 status?: BoardTask["status"];
 statusSince?: string;
 feedback?: { id: string; at: string }[];
 delivery?: { text: string; at: string; refs: string[]; count: number };
 deploy?: { state: "failed" | "active" | "unknown"; text: string; since: string; refs: string[] };
 deployUnknownSince?: string;
 deployFailure?: { text: string; since: string; refs: string[]; targets: string[]; total: number };
};
export const DELIVERY_ACTIVITY_MS = 24 * 60 * 60 * 1000;

/** First match wins. No ages, clock reads, mutations, model calls or transcript inference. */
export function taskActivity(task: BoardTask, questions: readonly BoardQuestion[], tasks: readonly BoardTask[], tracking: TaskActivityTracking | undefined, now: number): BoardTaskActivity {
 const sources = Object.values(tracking?.sources ?? {}).sort((a, b) => b.since.localeCompare(a.since) || a.actor.id.localeCompare(b.actor.id));
 const closed = task.status === "done" || task.status === "dropped";
 const workers = closed ? [] : sources.filter(s => s.state === "running" && s.actor.kind === "worker");
 const make = (kind: BoardTaskActivity["kind"], text: string, since: string, refs: string[] = [], actor?: BoardActivityActor, count?: number): BoardTaskActivity => ({ kind, text, since, refs, ...(actor ? { actor } : {}), ...(count === undefined ? {} : { count }) });
 const deploy = tracking?.deploy;
 if (tracking?.deployFailure) return make("failure", tracking.deployFailure.text, tracking.deployFailure.since, tracking.deployFailure.refs);
 if (deploy?.state === "failed") return make("failure", deploy.text, deploy.since, deploy.refs);
 const failure = sources.find(s => s.state === "failed");
 if (failure) return make("failure", `${failure.actor.name} failed${failure.failure ? `: ${failure.failure.replace(/\s+/g, " ").slice(0, 160)}` : ""}`, failure.since, [failure.actor.id], failure.actor);
 const blocking = questions.filter(q => q.taskId === task.id && q.status === "open" && (q.blocksWork ?? q.kind !== "warning")).sort((a,b) => a.askedAt.localeCompare(b.askedAt) || a.id.localeCompare(b.id));
 if (blocking[0]) return make("question", `Waiting for your answer to ${blocking[0].id}${blocking.length > 1 ? ` and ${blocking.length - 1} more` : ""}${workers.length ? ` · ${workers.length} worker${workers.length === 1 ? "" : "s"} still running` : ""}`, blocking[0].askedAt, blocking.map(q => q.id), undefined, blocking.length);
 if (deploy?.state === "active" && tracking?.deployUnknownSince) return make("unknown", "Status unknown", tracking.deployUnknownSince, deploy.refs);
 if (deploy?.state === "active") return make("deploy", deploy.text, deploy.since, deploy.refs);
 const live = closed ? undefined : sources.find(s => s.state === "running");
 if (live) return make("working", `${live.actor.name} is ${live.phase || `working on ${live.title}`}${workers.length > (live.actor.kind === "worker" ? 1 : 0) ? ` · +${workers.length - (live.actor.kind === "worker" ? 1 : 0)} worker${workers.length - (live.actor.kind === "worker" ? 1 : 0) === 1 ? "" : "s"}` : ""}`, live.since, [live.actor.id], live.actor, workers.length);
 const feedback = tracking?.feedback?.[0];
 if (feedback) return make("feedback", `Feedback ${feedback.id} is waiting for the coordinator`, feedback.at, tracking!.feedback!.map(f => f.id));
 const since = tracking?.statusSince ?? task.updatedAt;
 if (!closed) {
  const blocked = task.blockedBy.filter(id => !["done", "dropped"].includes(tasks.find(t => t.id === id)?.status ?? ""));
  if (blocked.length) return make("blocked", `Blocked by ${blocked.join(", ")}`, since, blocked);
  if (task.status === "blocked") return make("blocked", task.blockedReason ? `Blocked: ${task.blockedReason}` : "Blocked", since);
  if (task.status === "waiting") return make("waiting", `Waiting for ${task.waiting?.note ?? "external review"}`, task.waiting?.since ?? since);
  if (task.status === "review") return make("review", "Ready for your review", since);
 }
 if (tracking?.deployUnknownSince) return make("unknown", "Status unknown", tracking.deployUnknownSince, tracking.deploy?.refs ?? tracking.delivery?.refs ?? []);
 const delivery = tracking?.delivery;
 if (delivery && now - Date.parse(delivery.at) < DELIVERY_ACTIVITY_MS && !sources.some(s => s.since > delivery.at)) return make("delivery", delivery.text, delivery.at, delivery.refs, undefined, delivery.count);
 if (closed) return make(task.status === "done" ? "done" : "dropped", task.status === "done" ? "Done" : "Dropped", task.settledAt ?? since);
 if (deploy?.state === "unknown" || sources.some(s => s.state === "unknown")) return make("unknown", "Status unknown", sources.find(s => s.state === "unknown")?.since ?? deploy?.since ?? since);
 if (task.status === "todo") return make("not_started", "Not started", task.createdAt);
 return make("idle", "Idle", tracking?.lastEndedAt ?? task.createdAt);
}

export function activityTracking(state: { taskActivity?: Record<string, TaskActivityTracking> }, taskId: string): TaskActivityTracking {
 state.taskActivity ??= {};
 state.taskActivity[taskId] ??= { sources: {} };
 return state.taskActivity[taskId]!;
}

/** Clear just this run. Failure persists until its source retries or is acknowledged. */
export function endActivitySource(tracking: TaskActivityTracking, id: string, at: string): void {
 const source = tracking.sources[id];
 if (!source || source.state === "ended" || source.state === "failed") return;
 source.state = "ended";
 delete source.phase;
 source.since = at;
 tracking.lastEndedAt = at;
}

export function setActivityPhase(tracking: TaskActivityTracking, id: string, phase: string, at: string): void {
 const source = tracking.sources[id];
 const short = phase.replace(/\s+/g, " ").trim().slice(0, 160);
 if (!source || source.state !== "running" || (source.phase ?? "") === short) return;
 if (short) source.phase = short;
 else delete source.phase;
 source.since = at;
}
