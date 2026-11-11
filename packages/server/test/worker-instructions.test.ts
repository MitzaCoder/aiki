/** The worker prompt rule against chained `cat`/`grep` false failures (`workers.ts`'s `workerInstructions`). */
import { describe, expect, it } from "bun:test";
import type { Project } from "../src/projects.ts";
import { coordinatorSection, threadCoordinatorSection, workerInstructions } from "../src/workers.ts";

function project(): Project {
	return {
		version: 1,
		id: "proj",
		name: "Demo",
		path: "/repo",
		createdAt: new Date(0).toISOString(),
		coordinator: { model: null, thinkingLevel: null },
		workerModels: [],
		checkIns: { enabled: true, intervalMinutes: 10 },
		longPromptCache: "coordinators",
		keepPromptCacheWarm: true,
		promptCacheWarmHours: 8,
		uiProof: "screenshots-and-videos",
		links: null,
	};
}

describe("workerInstructions", () => {
	it("steers amendments, queues only next tasks, and tells both coordinators to stay silent on repeats", () => {
		for (const text of [coordinatorSection(project()), threadCoordinatorSection(project())]) {
			expect(text).toContain("To add to a running worker's current task, use worker_send with interrupt: true so it lands in the same run and report.");
			expect(text).toContain("Queue only a separate next task.");
			expect(text).toContain("When a report repeats one already handled or adds nothing new, end the turn without a chat reply; do not acknowledge it, just as with uneventful check-ins.");
		}
		const text = workerInstructions({ id: "a", title: "t", project: project(), cwd: "/repo", isolation: "shared" });
		expect(text).toContain("If a queued message asks for something you already did and have reported, and you have no new result, warning or question, answer with exactly one line: Nothing new.");
		expect(text).toContain("Do not repeat the full report or do more checks. This line is recorded without waking the coordinator.");
	});

	it("explains stale report messages after introducing reports, for both coordinators", () => {
		for (const text of [coordinatorSection(project()), threadCoordinatorSection(project())]) {
			const report = text.indexOf("Each task has a short report");
			const stale = text.indexOf('A message starting with "[reports]" names task reports that went out of date.');
			expect(report).toBeGreaterThanOrEqual(0);
			expect(stale).toBeGreaterThan(report);
			expect(stale).toBeLessThan(text.indexOf("Only the user closes a task."));
			expect(text).toContain("rewrite only the stale Results or Next, with evidence");
			expect(text).toContain("pass the eventSeq show_task gave you as coveredEventSeq, so anything that happened since stays marked");
		}
	});

	it("tells a worker to use read instead of cat chains, and how grep/rg exit", () => {
		const text = workerInstructions({
			id: "fixer",
			title: "fix the bug",
			project: project(),
			cwd: "/repo",
			isolation: "shared",
		});
		expect(text).toContain("Read files with the read tool");
		expect(text).toContain("resolve it against that file's own folder");
		expect(text).toContain("exit 1 when nothing matches and 2 when a path is missing");
		expect(text).toContain("never add `|| true`");
	});

	it("is the same text for a shared worker and one in its own workspace", () => {
		const base = { id: "a", title: "t", project: project(), cwd: "/repo" } as const;
		const shared = workerInstructions({ ...base, isolation: "shared" });
		const workspace = workerInstructions({ ...base, isolation: "workspace" });
		const rule = "Read files with the read tool, not a bash";
		expect(shared).toContain(rule);
		expect(workspace).toContain(rule);
	});
});
