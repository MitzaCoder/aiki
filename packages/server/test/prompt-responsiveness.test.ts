/** The coordinator's prompt tells it to stay responsive, and memory's instructions tell it to confirm a failure first. */
import { describe, expect, it } from "bun:test";
import { DEFAULT_CHECK_INS } from "@mihai-harness/protocol";
import { MEMORY_INSTRUCTIONS } from "../src/memory-tools.ts";
import type { Project } from "../src/projects.ts";
import { coordinatorSection } from "../src/workers.ts";

function project(overrides: Partial<Project> = {}): Project {
	return {
		version: 1,
		id: "proj-1",
		name: "Demo",
		path: "/tmp/demo",
		createdAt: new Date(0).toISOString(),
		coordinator: { model: null, thinkingLevel: null },
		workerModels: [],
		checkIns: { ...DEFAULT_CHECK_INS },
		longPromptCache: "coordinators",
		keepPromptCacheWarm: true,
		promptCacheWarmHours: 8,
		uiProof: "screenshots-and-videos",
		links: null,
		...overrides,
	};
}

describe("the coordinator's system prompt", () => {
	it("tells the coordinator to stay responsive and delegate long work instead of waiting on it", () => {
		const text = coordinatorSection(project());
		expect(text).toContain("Stay responsive");
		expect(text).toContain("never block a turn on a wait or a poll");
		expect(text).toContain("worker_spawn");
		expect(text).toContain("schedule_save");
		expect(text).toContain("end your turn");
	});

	it("still carries the plan/delegate/review/merge role and the check-in instructions", () => {
		const text = coordinatorSection(project());
		expect(text).toContain("plan, delegate, review, merge");
		expect(text).toContain("worker_peek");
	});
});

describe("the memory instructions", () => {
	it("tells the coordinator to confirm a failure before writing it down", () => {
		expect(MEMORY_INSTRUCTIONS).toContain("not a durable fact from one attempt");
		expect(MEMORY_INSTRUCTIONS).toContain("Retry it, or try another way");
		expect(MEMORY_INSTRUCTIONS).toContain("write what you tried and saw");
	});

	it("still carries the original search-before-planning and update-don't-duplicate guidance", () => {
		expect(MEMORY_INSTRUCTIONS).toContain("Search memory before planning a task");
		expect(MEMORY_INSTRUCTIONS).toContain("Update an existing topic instead of starting a near-duplicate");
	});
});
