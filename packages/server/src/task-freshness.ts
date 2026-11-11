/** Deterministic report coverage and durable nudge admission. No model calls or timeline writes. */
import type { BoardReportSection, BoardTask, BoardWriter } from "@aiki/protocol";
import { estimateTextTokens } from "@earendil-works/pi-ai/utils/estimate";
import type { BoardState } from "./board.ts";

export const REPORT_TRAILING_MS = 30_000;
export const REPORT_MAX_BURST_MS = 120_000;
export const REPORT_AGE_MS = 2 * 60 * 60_000;
export const REPORT_SWEEP_MS = 60 * 60_000;
export type ReportSection = "results" | "next";
export const REPORT_SECTIONS: readonly ReportSection[] = ["results", "next"];
export type TaskFact = {
	kind: "question_asked" | "question_settled" | "blocker_resolved" | "worker_start" | "worker_resume" | "worker_report" | "worker_fail" | "worker_stop" | "thread_handoff" | "thread_finish" | "status" | "feedback" | "feedback_addressed" | "decision" | "milestone" | "commit" | "integration" | "publication" | "deploy" | "check_outcome" | "chat" | "stale";
	reason: string;
	at: string;
	ref?: string | undefined;
	/** Explicit sections for audit/button/chat, or sections NOT rewritten alongside a milestone. */
	sections?: readonly ReportSection[] | undefined;
};
type SectionInvalidation = { seq: number; reason: string };
type PendingReport = { burst: number; first: number; last: number; sections: Partial<Record<ReportSection, number>> };
export type TaskReportTracking = {
	activityAt: string | null;
	chatEvidence?: { snippet: string; source: string }[];
	invalidated: Partial<Record<ReportSection, SectionInvalidation>>;
	suppressed: Partial<Record<ReportSection, number>>;
	pending?: PendingReport;
};
export type ReportAdmission = { taskId: string; burst: number; sections: Partial<Record<ReportSection, number>> };
export type ReportOutbox = { key: string; owner: string; content: string; admissions: ReportAdmission[] };

/** Legacy coverage is unknown, not zero; upgrading is not a fact and never queues a nudge. */
export function initializeTaskFreshness(state: BoardState, task: BoardTask): void {
	if (state.taskFreshnessEnabled === false) return;
	task.eventSeq ??= 0;
	if (task.report.freshness === undefined) {
		const legacy = (task.report.updatedAt !== null);
		const section = (): BoardReportSection => ({
			writtenAt: task.report.updatedAt, writtenBy: task.report.updatedBy, version: 0,
			coveredEventSeq: legacy ? null : task.eventSeq ?? 0, approximate: legacy,
			stale: false, eventsSince: 0, reasons: [],
		});
		task.report.freshness = { results: section(), next: section() };
	}
	state.reportTracking ??= {};
	state.reportTracking[task.id] ??= { activityAt: null, invalidated: {}, suppressed: {} };
}

function invalidatedSections(task: BoardTask, fact: TaskFact): readonly ReportSection[] {
	if (fact.sections !== undefined) return fact.sections;
	switch (fact.kind) {
		case "question_asked": return [];
		case "question_settled": {
			const waitsOn = task.report.freshness?.next.waitsOn;
			return task.report.next.trim() !== "" && (waitsOn === undefined || (fact.ref !== undefined && waitsOn.includes(fact.ref))) ? ["next"] : [];
		}
		case "worker_start": case "worker_resume": case "blocker_resolved": case "thread_handoff": case "feedback": return ["next"];
		case "decision": case "feedback_addressed": return ["results"];
		case "status": return ["next", ...(task.report.results.trim() === "" && (task.status === "review" || task.status === "done") ? ["results" as const] : [])];
		default: return REPORT_SECTIONS;
	}
}

/** The single entry point for structured lifecycle facts, future verified commits/deploys, audits and the button. */
export function noteTaskFact(state: BoardState, taskId: string, fact: TaskFact): void {
	if (state.taskFreshnessEnabled === false) return;
	const task = state.tasks.find((candidate) => candidate.id === taskId);
	if (task === undefined) return;
	initializeTaskFreshness(state, task);
	const tracking = state.reportTracking![taskId]!;
	task.eventSeq = (task.eventSeq ?? 0) + 1;
	tracking.activityAt = fact.at;
	for (const name of REPORT_SECTIONS) {
		const section = task.report.freshness![name];
		section.eventsSince = (section.eventsSince ?? 0) + 1;
	}
	invalidateReportSections(state, task, fact);
}

function invalidateReportSections(state: BoardState, task: BoardTask, fact: TaskFact): void {
	const tracking = state.reportTracking![task.id]!;
	for (const name of invalidatedSections(task, fact)) {
		const section = task.report.freshness![name];
		const reason = fact.reason.replace(/[\r\n\t]+/g, " ").trim().slice(0, 160) || "needs update";
		tracking.invalidated[name] = { seq: task.eventSeq ?? 0, reason };
		section.stale = true;
		const reasons = [...new Set([...section.reasons, reason])];
		section.reasons = reasons.length <= 3 ? reasons : [...reasons.slice(0, 2), reason];
		if (tracking.suppressed[name] === section.version) continue;
		tracking.pending ??= { burst: task.eventSeq ?? 0, first: Date.parse(fact.at), last: Date.parse(fact.at), sections: {} };
		tracking.pending.last = Date.parse(fact.at);
		tracking.pending.sections[name] = section.version;
	}
}

/** A no-op does not cover new facts, refresh the date, bump the section version or rearm a delivered nudge. */
export function coverReportSection(state: BoardState, task: BoardTask, name: ReportSection, input: {
	previous: string; by: BoardWriter; at: string; coveredEventSeq?: number | undefined; waitsOn?: string[] | undefined;
}): void {
	initializeTaskFreshness(state, task);
	if (state.taskFreshnessEnabled === false || input.previous === task.report[name]) return;
	const section = task.report.freshness![name];
	const tracking = state.reportTracking![task.id]!;
	const coverage = Math.max(section.coveredEventSeq ?? 0, Math.min(task.eventSeq ?? 0, Math.max(0, input.coveredEventSeq ?? task.eventSeq ?? 0)));
	section.writtenAt = input.at;
	section.writtenBy = { ...input.by };
	section.approximate = false;
	section.version += 1;
	section.coveredEventSeq = coverage;
	section.eventsSince = (task.eventSeq ?? 0) - coverage;
	if (name === "next") {
		if (input.waitsOn === undefined) delete section.waitsOn;
		else section.waitsOn = [...new Set(input.waitsOn)];
	}
	const invalidation = tracking.invalidated[name];
	section.stale = invalidation !== undefined && invalidation.seq > coverage;
	section.reasons = section.stale ? [invalidation!.reason] : [];
	// An unseen concurrent fact stays stale and keeps its existing admission; only a covered rewrite rearms.
	if (section.stale) {
		if (tracking.pending?.sections[name] !== undefined) tracking.pending.sections[name] = section.version;
		else tracking.suppressed[name] = section.version;
	} else {
		delete tracking.suppressed[name];
		if (tracking.pending !== undefined) {
			delete tracking.pending.sections[name];
			if (Object.keys(tracking.pending.sections).length === 0) delete tracking.pending;
		}
	}
}

/** Hourly maximum, persisted across restarts. Quiet old prose is not meaningful activity. */
export function sweepReportAge(state: BoardState, now: number, ageMs = REPORT_AGE_MS, sweepMs = REPORT_SWEEP_MS): void {
	if (state.taskFreshnessEnabled === false) return;
	if (state.lastReportSweep === undefined) { state.lastReportSweep = now; return; }
	if (now - state.lastReportSweep < sweepMs) return;
	state.lastReportSweep = now;
	for (const task of state.tasks) {
		if (!["in_progress", "review", "waiting"].includes(task.status)) continue;
		initializeTaskFreshness(state, task);
		const activity = state.reportTracking![task.id]!.activityAt;
		if (activity === null) continue;
		const sections = REPORT_SECTIONS.filter((name) => {
			const section = task.report.freshness![name];
			const written = Date.parse(section.writtenAt ?? task.createdAt);
			return !section.stale && now - written >= ageMs && written < Date.parse(activity);
		});
		// This is a coverage warning about existing activity, not a new meaningful fact.
		if (sections.length > 0) invalidateReportSections(state, task, { kind: "stale", sections, reason: "new activity since this section was written", at: new Date(now).toISOString() });
	}
}

/** Audit and UI action share this path, without changing the task's status or timeline. */
export function markReportStale(state: BoardState, taskId: string, sections: readonly ReportSection[] = REPORT_SECTIONS, reason = "marked out of date", at: string): void {
	noteTaskFact(state, taskId, { kind: "stale", reason, sections, at });
}

export function reportDueAt(pending: PendingReport, trailingMs = REPORT_TRAILING_MS, maxBurstMs = REPORT_MAX_BURST_MS): number {
	return Math.min(pending.last + trailingMs, pending.first + maxBurstMs);
}

/** Freeze each short batch before delivery. Replay uses identical content and admission key. Overflow stays pending. */
export function prepareReportNudges(state: BoardState, now: number, ownerOf: (task: BoardTask) => string, options: {
 trailingMs?: number | undefined; maxBurstMs?: number | undefined; maxTokens?: number | undefined;
} = {}): void {
 if (state.taskFreshnessEnabled === false) return;
 state.reportOutbox ??= [];
 const admitted = new Set(state.reportOutbox.flatMap((batch) => batch.admissions.map((item) => `${item.taskId}:${item.burst}`)));
 const grouped = new Map<string, { lines: string[]; admissions: ReportAdmission[] }>();
 const suffix = ". Read tasks; rewrite stale sections with evidence.";
 for (const task of state.tasks) {
  const tracking = state.reportTracking?.[task.id];
  const pending = tracking?.pending;
  if (pending === undefined || state.reportInFlight?.[ownerOf(task)] !== undefined || admitted.has(`${task.id}:${pending.burst}`) || reportDueAt(pending, options.trailingMs, options.maxBurstMs) > now) continue;
  const sections = REPORT_SECTIONS.filter((name) => pending.sections[name] === task.report.freshness?.[name].version && task.report.freshness![name].stale);
  if (sections.length === 0) { delete tracking!.pending; continue; }
  const owner = ownerOf(task);
  const batch = grouped.get(owner) ?? { lines: [], admissions: [] };
  const names = sections.map((name) => name === "next" ? "Next" : "Results").join("/");
  const reasons = [...new Set(sections.flatMap((name) => task.report.freshness![name].reasons))].join(", ").slice(0, 72);
  const line = `${task.id} ${names} stale: ${reasons}`;
  if (estimateTextTokens(`[reports] ${[...batch.lines, line].join("; ")}${suffix}`) > (options.maxTokens ?? 100) && batch.lines.length > 0) continue;
  batch.lines.push(line);
  batch.admissions.push({ taskId: task.id, burst: pending.burst, sections: Object.fromEntries(REPORT_SECTIONS.map((name) => [name, task.report.freshness![name].version])) });
  grouped.set(owner, batch);
 }
 for (const [owner, batch] of grouped) {
  const key = `reports:${batch.admissions.map((item) => `${item.taskId}@${item.burst}:${JSON.stringify(item.sections)}`).join("|")}`;
  state.reportOutbox.push({ owner, key, admissions: batch.admissions, content: `[reports] ${batch.lines.join("; ")}${suffix}` });
 }
}

export function acknowledgeReportNudge(state: BoardState, key: string, submissionId?: number): void {
 const batch = state.reportOutbox?.find((item) => item.key === key);
 if (batch === undefined) return;
 if (submissionId !== undefined) {
  state.reportInFlight ??= {};
  state.reportInFlight[batch.owner] = submissionId;
 }
 for (const admission of batch.admissions) {
  const tracking = state.reportTracking?.[admission.taskId];
  if (tracking === undefined) continue;
  for (const name of REPORT_SECTIONS) {
   const version = admission.sections[name];
   if (version === undefined) continue;
   tracking.suppressed[name] = version;
   if (tracking.pending?.sections[name] === version) delete tracking.pending.sections[name];
  }
  if (tracking.pending !== undefined && Object.keys(tracking.pending.sections).length === 0) delete tracking.pending;
 }
 state.reportOutbox = state.reportOutbox!.filter((item) => item.key !== key);
}

/** Conservative mention fallback: no quote/code/transport/template mining, no bare IDs or links. */
export function substantiveTaskMentions(content: string, validIds: ReadonlySet<string>): string[] {
 const prose = content.replace(/```[\s\S]*?```|~~~[\s\S]*?~~~/g, "").replace(/`[^`]*`/g, "")
  .replace(/^\s*>.*$/gm, "").replace(/\[[^\]]*\]\([^)]*\)/g, "")
  .replace(/https?:\/\/\S+/g, "").replace(/^\s*\[(?:from |thread |worker |board|reports|task )[^\]]*\]/gm, "")
  .replace(/[^.!?\n]*(?:filed under|tracked (?:in|under)|recorded (?:in|under))\s+(?:task\s+)?T\d+[^.!?\n]*[.!?]?/gi, "")
  .replace(/"[^"\n]*"|“[^”\n]*”/g, "");
 const ids = [...new Set(prose.match(/\bT[1-9]\d*\b/g) ?? [])].filter((id) => validIds.has(id));
 const other = prose.replace(/\b(?:task\s+)?T\d+\b/gi, "").replace(/\s+/g, " ").trim();
 return other.length >= 40 ? ids : [];
}
