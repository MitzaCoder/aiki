/** Cross-project triage from the projects subscription alone; no per-project board watches. */
import type { ProjectSummary } from "@kemiri/protocol";
import { projectHref, threadHref } from "./backends.js";
import type { ProjectRow } from "./projects.js";

export type AttentionKind = "question" | "warning" | "coordinator" | "worker" | "thread" | "review";
export type AttentionAction = { kind: AttentionKind; count: number; label: string; taskId?: string | null; threadId?: string | null };
export type ProjectAttentionLink = AttentionAction & { key: string; href: string; projectName: string; backendName: string };
const priority: Record<AttentionKind, number> = { question: 0, warning: 1, coordinator: 2, worker: 3, thread: 4, review: 5 };

export function projectAttentionActions(project: ProjectSummary): AttentionAction[] {
	if (project.archived) return [];
	const summary = project.attention;
	const actions: AttentionAction[] = [];
	const questions = summary?.questions ?? project.activity?.openQuestions ?? 0;
	if (questions > 0) actions.push({ kind: "question", count: questions, label: `${questions} question${questions === 1 ? "" : "s"}`, taskId: summary?.questionTaskId });
	if ((summary?.warnings ?? 0) > 0) actions.push({ kind: "warning", count: summary!.warnings, label: `${summary!.warnings} warning${summary!.warnings === 1 ? "" : "s"}`, taskId: summary?.warningTaskId });
	if (project.state === "failed" || project.activity?.coordinator === "failed") actions.push({ kind: "coordinator", count: 1, label: project.state === "failed" ? "Project failed" : "Coordinator failed" });
	if ((summary?.failedWorkers ?? 0) > 0) actions.push({ kind: "worker", count: summary!.failedWorkers, label: summary!.failedWorkers === 1 ? "Worker failed" : `${summary!.failedWorkers} workers failed`, taskId: summary?.failedWorkerTaskId });
	if ((summary?.failedThreads ?? 0) > 0) actions.push({ kind: "thread", count: summary!.failedThreads, label: summary!.failedThreads === 1 ? "Thread failed" : `${summary!.failedThreads} threads failed`, threadId: summary?.failedThreadId });
	if ((summary?.reviewTasks ?? 0) > 0) actions.push({ kind: "review", count: summary!.reviewTasks, label: `${summary!.reviewTasks} to review`, taskId: summary?.reviewTaskId });
	return actions;
}

export function attentionCount(project: ProjectSummary): number {
	return projectAttentionActions(project).reduce((count, action) => count + action.count, 0);
}

export function needsYouLinks(backends: readonly { id: string; name: string; projects: readonly ProjectSummary[] }[]): ProjectAttentionLink[] {
	return backends.flatMap((backend) => backend.projects.flatMap((project) => projectAttentionActions(project).map((action) => ({
		...action, key: `${backend.id}/${project.id}/${action.kind}`, projectName: project.name, backendName: backend.name,
		href: action.threadId ? threadHref(backend.id, project.id, action.threadId) : `${projectHref(backend.id, project.id)}${action.taskId ? `?task=${encodeURIComponent(action.taskId)}` : ""}`,
	})))).sort((left, right) => priority[left.kind] - priority[right.kind]);
}

export function sidebarStatus(project: ProjectSummary, row: ProjectRow): { label: string; glyph: string; urgent: boolean; working: boolean } {
	const action = projectAttentionActions(project)[0];
	const working = project.activity?.coordinator === "working" || (project.attention?.runningWorkers ?? project.activity?.runningWorkers ?? 0) > 0;
	if (action) return { label: action.label, glyph: action.kind === "question" ? "?" : action.kind === "review" ? "✓" : "!", urgent: action.kind !== "review", working };
	const running = project.attention?.runningWorkers ?? project.activity?.runningWorkers ?? 0;
	if (working) return { label: running > 0 ? `Working · ${running} worker${running === 1 ? "" : "s"}` : "Working", glyph: "◌", urgent: false, working };
	const returning = project.attention?.nextReturnAt;
	const date = returning ? new Date(returning) : undefined;
	if (date && Number.isFinite(date.getTime())) return { label: `Returns ${date.toLocaleDateString(undefined, { month: "short", day: "numeric" })}`, glyph: "◷", urgent: false, working };
	if ((project.attention?.waitingTasks ?? 0) > 0) return { label: `${project.attention!.waitingTasks} waiting`, glyph: "◷", urgent: false, working };
	return { label: [row.label, row.detail].filter(Boolean).join(" · "), glyph: "·", urgent: row.tone === "warn" || row.tone === "error", working };
}
