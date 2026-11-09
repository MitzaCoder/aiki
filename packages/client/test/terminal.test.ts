import { afterEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HarnessClient, type TerminalSession } from "../src/index.ts";
import { startServer, type HarnessServer } from "../../server/src/server.ts";
import type { TerminalHostOptions } from "../../server/src/terminals.ts";
import { createSetup, type TestSetup } from "../../server/test/support.ts";

const ZELLIJ = Bun.which("zellij");
const cleanups: (() => Promise<void>)[] = [];
const clients: HarnessClient[] = [];
const sessions: TerminalSession[] = [];
const scratch: string[] = [];

afterEach(async () => {
	for (const session of sessions.splice(0)) await session.detach().catch(() => undefined);
	for (const client of clients.splice(0)) client.close();
	for (const cleanup of cleanups.splice(0)) await cleanup();
	for (const dir of scratch.splice(0)) {
		for (const entry of readdirSync("/proc")) {
			if (!/^\d+$/.test(entry)) continue;
			try {
				if (readFileSync(`/proc/${entry}/cmdline`, "utf8").includes(dir)) process.kill(Number(entry), "SIGKILL");
			} catch {
				// Gone.
			}
		}
		await rm(dir, { recursive: true, force: true });
	}
});

async function waitFor<T>(what: string, check: () => T | undefined | false, timeoutMs = 20_000): Promise<T> {
	const start = Date.now();
	while (Date.now() - start < timeoutMs) {
		const value = check();
		if (value !== undefined && value !== false) return value;
		await new Promise((resolve) => setTimeout(resolve, 20));
	}
	throw new Error(`timed out waiting for ${what}`);
}

function clientFor(server: HarnessServer): HarnessClient {
	const client = new HarnessClient({
		url: `${server.url.replace(/^http/, "ws")}/ws`,
		clientName: "terminal-test",
		requestTimeoutMs: 10_000,
		reconnect: { initialDelayMs: 20, maxDelayMs: 200, jitter: 0 },
	});
	clients.push(client);
	return client;
}

/** Collects a terminal's output and what it reports. */
function watchTerminal(terminal: TerminalSession): { text(): string; resets: number; states: string[] } {
	const chunks: Uint8Array[] = [];
	const seen = { text: () => new TextDecoder().decode(Buffer.concat(chunks)), resets: 0, states: [] as string[] };
	terminal.onOutput((bytes) => chunks.push(bytes));
	terminal.onReset(() => {
		seen.resets += 1;
		chunks.length = 0;
	});
	terminal.onState((state) => seen.states.push(state.status));
	return seen;
}

describe("openTerminal with a plain shell", () => {
	it("attaches, types, resizes and detaches", async () => {
		const test = await createSetup({ terminals: { multiplexer: "none", command: ["bash", "--norc", "--noprofile"], env: { ...process.env, PS1: "$ " } } });
		cleanups.push(test.cleanup);
		const client = clientFor(test.server);
		const list = await client.readTerminals();
		expect(list).toMatchObject({ available: true, multiplexer: "none" });

		const terminal = client.openTerminal({ cols: 80, rows: 24, cwd: test.projectDir, prefix: "plain" });
		sessions.push(terminal);
		const seen = watchTerminal(terminal);
		await waitFor("attached", () => terminal.state.status === "attached");
		expect(terminal.state.session).toBe("plain-1");

		expect(terminal.write("echo from-$((20+22))\n")).toBe(true);
		await waitFor("the output", () => seen.text().includes("from-42"));
		terminal.resize(132, 43);
		terminal.write("stty size\n");
		await waitFor("the new size", () => seen.text().includes("43 132"));

		await terminal.detach();
		expect(terminal.state.status).toBe("detached");
		expect(terminal.write("x")).toBe(false);
		expect(test.server.terminals!.attachedCount).toBe(0);
	});

	it("is failed, not retried, when the backend cannot open it", async () => {
		const test = await createSetup({ terminals: { multiplexer: "zellij", zellij: "/nonexistent/zellij", env: { PATH: "", HOME: "/nonexistent" } } });
		cleanups.push(test.cleanup);
		const client = clientFor(test.server);
		const terminal = client.openTerminal({ cols: 80, rows: 24 });
		sessions.push(terminal);
		await waitFor("failed", () => terminal.state.status === "failed");
		expect(terminal.state.errorCode).toBe("terminal_unavailable");
		expect(terminal.state.error).toContain("zellij is not installed");
	});

	it("says it ended when the shell exits, and does not reopen", async () => {
		const test = await createSetup({ terminals: { multiplexer: "none", command: ["bash", "--norc", "--noprofile"] } });
		cleanups.push(test.cleanup);
		const client = clientFor(test.server);
		const terminal = client.openTerminal({ cols: 80, rows: 24 });
		sessions.push(terminal);
		await waitFor("attached", () => terminal.state.status === "attached");
		terminal.write("exit 5\n");
		await waitFor("ended", () => terminal.state.status === "ended");
		expect(terminal.state).toMatchObject({ endedReason: "exited", exitCode: 5 });
		await Bun.sleep(200);
		expect(test.server.terminals!.attachedCount).toBe(0);
	});
});

describe.skipIf(ZELLIJ === null)("openTerminal on zellij", () => {
	it("reattaches the same session by itself after the server restarts", async () => {
		const dir = await mkdtemp(join(tmpdir(), "mh-zc-"));
		scratch.push(dir);
		await mkdir(join(dir, "sock"), { recursive: true });
		await mkdir(join(dir, "home"), { recursive: true });
		const terminals: TerminalHostOptions = {
			multiplexer: "zellij",
			survive: "off",
			configFile: join(dir, "zellij.kdl"),
			env: {
				PATH: process.env.PATH,
				ZELLIJ_SOCKET_DIR: join(dir, "sock"),
				XDG_CACHE_HOME: join(dir, "cache"),
				XDG_CONFIG_HOME: join(dir, "config"),
				XDG_RUNTIME_DIR: process.env.XDG_RUNTIME_DIR,
				HOME: join(dir, "home"),
				SHELL: Bun.which("bash") ?? "/bin/bash",
				PS1: "$ ",
			},
		};
		const test: TestSetup = await createSetup({ terminals });
		cleanups.push(async () => {
			await test.cleanup();
		});
		const client = clientFor(test.server);
		const terminal = client.openTerminal({ cols: 100, rows: 30, cwd: test.projectDir, prefix: "back" });
		sessions.push(terminal);
		const seen = watchTerminal(terminal);
		await waitFor("attached", () => terminal.state.status === "attached");
		expect(terminal.state).toMatchObject({ session: "back-1", created: true });
		terminal.write("echo before-restart-$((1+1))\r");
		await waitFor("the first output", () => seen.text().includes("before-restart-2"));

		const port = test.server.port;
		await test.server.stop();
		await waitFor("the handle to notice", () => terminal.state.status === "reconnecting");
		const restarted: HarnessServer = await startServer({
			dataDir: test.dataDir,
			port,
			models: test.models,
			credentials: test.credentials,
			images: null,
			terminals,
			log: () => undefined,
		});
		cleanups.push(() => restarted.stop());
		await waitFor("attached again", () => terminal.state.status === "attached");
		// The same session, not a new one, with its screen redrawn after a reset.
		expect(terminal.state).toMatchObject({ session: "back-1", created: false });
		expect(seen.resets).toBeGreaterThanOrEqual(1);
		await waitFor("the redraw", () => seen.text().includes("before-restart-2"));
		await client.killTerminalSession("back-1");
		await waitFor("ended", () => terminal.state.status === "ended");
		expect(terminal.state.endedReason).toBe("killed");
	}, 90_000);
});
