/**
 * How a tool call reads in a card's header: the coding tools keep their own
 * name, everything else is said in words.
 */
import { describe, expect, test } from "bun:test";
import { toolHeadline, toolSummary } from "../src/lib/chat/tools.ts";

describe("tool headlines", () => {
	test("the harness' own tools read as what they did", () => {
		expect(toolHeadline("schedule_save")).toBe("Saved a schedule");
		expect(toolHeadline("schedule_list")).toBe("Listed the schedules");
		expect(toolHeadline("schedule_run")).toBe("Started a scheduled run");
		expect(toolHeadline("worker_spawn")).toBe("Started a worker");
		expect(toolHeadline("worker_forget")).toBe("Forgot a worker");
	});

	test("a tool the app does not know keeps its name minus the wire's separators", () => {
		expect(toolHeadline("web_search")).toBe("Web search");
		expect(toolHeadline("mcp.task-get")).toBe("Mcp task get");
	});

	test("coding tools keep their own name, and an absent name has none", () => {
		expect(toolHeadline("bash")).toBeUndefined();
		expect(toolHeadline("read")).toBeUndefined();
		expect(toolHeadline("edit")).toBeUndefined();
		expect(toolHeadline("write")).toBeUndefined();
		expect(toolHeadline("")).toBeUndefined();
	});

	test("the summary beside it still names what the call acted on", () => {
		expect(toolSummary("schedule_save", { id: "s1", title: "Nightly checks" })).toBe("Nightly checks");
		expect(toolSummary("bash", { command: "bun test\nls" })).toBe("bun test");
	});
});
