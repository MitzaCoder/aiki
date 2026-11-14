import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const component = (name: string) => readFileSync(new URL(`../src/lib/components/${name}.svelte`, import.meta.url), "utf8");

describe("header-only conversation panels", () => {
	test("the shared desktop and phone shell labels a region without panel tabs", () => {
		const sidebar = component("ConversationSidebar");
		expect(sidebar).not.toContain('role="tablist"');
		expect(sidebar).not.toContain('role="tab"');
		expect(sidebar).not.toContain('role="tabpanel"');
		expect(sidebar).toContain('role="region"');
		expect(sidebar).toContain('aria-labelledby="sidebar-heading"');
		expect(sidebar).toContain('<h2 id="sidebar-heading"');
		expect(sidebar).toContain('<Dialog.Title id="sidebar-heading"');
		expect(sidebar).toContain('aria-label="Close the sidebar"');
	});

	test("main and thread chats keep all panel toggles in both header presentations", () => {
		const chat = component("ProjectChat");
		for (const panel of ["board", "background", "info", "memory"]) {
			expect(chat).toContain(`onclick: () => toggleSidebar('${panel}')`);
			expect(chat).toContain(`pressed: sidebarOpen && sidebarTab === '${panel}'`);
		}
		expect(chat.match(/aria-pressed=\{action.pressed\}/g)).toHaveLength(2);
		expect(chat.match(/aria-pressed:bg-muted/g)).toHaveLength(2);
		expect(chat).toContain("shownHeaderActions.menu as action");
		expect(chat).toContain("if (sidebarOpen && sidebarTab === target)");
		expect(chat).toContain("count: questionBadgeText(questionsWaiting)");
		expect(chat).toContain("count: backgroundActive > 0");
	});

	test("worker transcripts retain their own context and memory toggles", () => {
		const worker = component("WorkerTranscript");
		for (const panel of ["info", "memory"]) {
			expect(worker).toContain(`onclick={() => toggleSidebar('${panel}')}`);
			expect(worker).toContain(`aria-pressed={sidebarOpen && sidebarTab === '${panel}'}`);
		}
		expect(worker.match(/aria-pressed:bg-muted/g)).toHaveLength(2);
		expect(worker).toContain("<ConversationSidebar");
	});
});
