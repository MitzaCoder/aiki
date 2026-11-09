import { expect, test } from "bun:test";
import type { ProjectSummary, ProjectAttention } from "@mihai-harness/protocol";
import { attentionCount, needsYouLinks, projectAttentionActions, sidebarStatus } from "../src/lib/sidebar-attention.ts";
import { projectRow } from "../src/lib/projects.ts";
const empty: ProjectAttention = { questions: 0, warnings: 0, reviewTasks: 0, waitingTasks: 0, nextReturnAt: null, failedWorkers: 0, failedThreads: 0, runningWorkers: 0, questionTaskId: null, warningTaskId: null, reviewTaskId: null, failedWorkerTaskId: null, failedThreadId: null };
function project(id: string, attention?: Partial<ProjectAttention>): ProjectSummary {
	return { id, name: id, path: "/test", state: "open", coordinator: { model: { provider: "faux", modelId: "faux-1" }, thinkingLevel: null }, checkIns: { enabled: true, intervalMinutes: 10 }, workerModels: [], activity: { coordinator: "idle", runningWorkers: 0, lastReplyAt: null, lastReplyEntryId: null }, ...(attention ? { attention: { ...empty, ...attention } } : {}) };
}

test("groups across backends, questions and failures lead, reviews last; equal priorities stay stable", () => {
	const links = needsYouLinks([
		{ id: "a", name: "Studio", projects: [project("review", { reviewTasks: 3, reviewTaskId: "T1" }), project("failure", { failedWorkers: 1, failedWorkerTaskId: "T2" })] },
		{ id: "b", name: "Remote", projects: [project("q", { questions: 2, warnings: 1, questionTaskId: "T3" }), project("also-q", { questions: 1 })] },
	]);
	expect(links.map((link) => `${link.projectName}/${link.kind}`)).toEqual(["q/question", "also-q/question", "q/warning", "failure/worker", "review/review"]);
	expect(links.reduce((sum, link) => sum + link.count, 0)).toBe(8);
	expect(links[0]?.href).toBe("/b/b/projects/q?task=T3");
	expect(links[3]?.href).toBe("/b/a/projects/failure?task=T2");
});

test("multiple signals in one project are not dropped or double-counted; archived projects stay out", () => {
	const all = project("all", { questions: 1, warnings: 2, failedWorkers: 3, failedThreads: 1, reviewTasks: 4 });
	all.activity!.coordinator = "failed";
	expect(attentionCount(all)).toBe(12);
	expect(projectAttentionActions(all).map((action) => action.kind)).toEqual(["question", "warning", "coordinator", "worker", "thread", "review"]);
	all.archived = true;
	expect(attentionCount(all)).toBe(0);
});

test("old servers use their question count and coordinator state, but invent no task totals", () => {
	const old = project("old");
	old.activity!.openQuestions = 2;
	old.activity!.coordinator = "failed";
	expect(projectAttentionActions(old).map((action) => action.label)).toEqual(["2 questions", "Coordinator failed"]);
	expect(attentionCount(old)).toBe(3);
	const fresh = project("empty", {});
	expect(projectAttentionActions(fresh)).toEqual([]);
});

test("waiting is calm until the server returns it to review; counts all threads' workers", () => {
	const waiting = project("wait", { waitingTasks: 2, nextReturnAt: "2026-11-16T09:00:00Z" });
	expect(attentionCount(waiting)).toBe(0);
	expect(sidebarStatus(waiting, projectRow(waiting, undefined, 0)).label).toStartWith("Returns ");
	waiting.attention!.reviewTasks = 1;
	expect(projectAttentionActions(waiting)[0]?.label).toBe("1 to review");
	const working = project("work", { runningWorkers: 2 });
	expect(sidebarStatus(working, projectRow(working, undefined, 0)).label).toBe("Working · 2 workers");
});

test("failed thread links preserve backend, project and thread identity", () => {
	const links = needsYouLinks([{ id: "b", name: "Remote", projects: [project("p", { failedThreads: 1, failedThreadId: "release" })] }]);
	expect(links[0]?.href).toBe("/b/b/projects/p/threads/release");
});
