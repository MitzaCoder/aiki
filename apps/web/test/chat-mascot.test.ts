import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { createServer } from "vite";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
const source = (path: string) => readFileSync(new URL(`../src/lib/components/${path}`, import.meta.url), "utf8");

test("chat activity and reply avatars share the larger vector size and full motion", () => {
	const mascot = source("AgentMascot.svelte");
	expect(mascot).toContain("size = 40");
	expect(mascot).toContain("data-size={size <= 32 ? 'small' : undefined}");
	for (const path of ["chat/AssistantTurn.svelte", "chat/TranscriptColumn.svelte"]) {
		expect(source(path)).toContain("<AgentMascot state=");
		expect(source(path)).not.toContain("size={26}");
	}
});

test("rendered waiting has no standalone mascot, with or without an agent message", async () => {
	const directory = await mkdtemp(join(tmpdir(), "kemiri-chat-mascot-"));
	const vite = await createServer({ root: import.meta.dir + "/..", cacheDir: join(directory, "cache"), server: { middlewareMode: true }, logLevel: "error" });
	try {
		const { default: TranscriptColumn } = await vite.ssrLoadModule("/src/lib/components/chat/TranscriptColumn.svelte");
		const { render } = await vite.ssrLoadModule("svelte/server");
		for (const working of [false, true]) {
			const empty = render(TranscriptColumn, { props: { items: [], waitingForUser: true, working, running: working } }).body;
			expect(empty).not.toContain("mascot-motion");
			expect(empty).not.toContain("data-agent-activity");
			const reply = render(TranscriptColumn, { props: { items: [{ kind: "turn", key: "reply", parts: [{ type: "error", key: "answer", message: "Synthetic reply failed." }] }], waitingForUser: true, working, running: working } }).body;
			expect(reply).toContain("Synthetic reply failed.");
			expect(reply.match(/class="mascot-motion/g)).toHaveLength(1);
			expect(reply).not.toContain("data-agent-activity");
		}
		const working = render(TranscriptColumn, { props: { items: [], working: true, running: true } }).body;
		expect(working).toContain('data-agent-activity="working"');
		expect(working).toContain("Working…");
	} finally { await vite.close(); await rm(directory, { recursive: true, force: true }); }
}, 20_000);

test("waiting has no standalone row, while working and real replies retain their mascot", () => {
	const column = source("chat/TranscriptColumn.svelte");
	expect(column).toContain("{#if showsAgentActivityRow(waitingForUser, working, completed)}");
	expect(column).not.toContain("data-agent-activity={waitingForUser");
	expect(column).toContain("{completed ? 'Done.' : 'Working…'}");
	const turn = source("chat/AssistantTurn.svelte");
	expect(turn).toContain("aria-label={motion === 'waiting' ? 'Waiting for your answer…' : 'Assistant'}");
	expect(turn).toContain("{#if motion !== 'waiting'}");
	expect(turn).toContain("{#if motion !== 'waiting' || parts.length > 0}");
	for (const chat of [column, turn]) expect(chat).not.toMatch(/>\{[^}]*\? 'Waiting for your answer…'/);
});
