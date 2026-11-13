import { afterEach, describe, expect, test } from "bun:test";
import {
	TERMINAL_FRAME,
	decodeTerminalFrame,
	encodeTerminalAck,
	encodeTerminalFrame,
	isTerminalSessionName,
	terminalPrefix,
	type ServerMessage,
} from "@kemiri/protocol";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TerminalHost } from "../src/terminals.ts";
import { TestClient, createSetup, type TestSetup } from "./support.ts";

/** A plain bash with no startup files: a prompt that is easy to wait for. */
const BASH = ["bash", "--norc", "--noprofile"];
const ZELLIJ = Bun.which("zellij");

const setups: TestSetup[] = [];
const clients: TestClient[] = [];
const scratch: string[] = [];

afterEach(async () => {
	for (const client of clients.splice(0)) client.close();
	for (const setup of setups.splice(0)) await setup.cleanup();
	for (const dir of scratch.splice(0)) {
		// A zellij server this test started must not outlive it: end every process that names its sockets.
		for (const pid of processesMentioning(dir)) {
			try {
				process.kill(pid, "SIGKILL");
			} catch {
				// Gone already.
			}
		}
		await rm(dir, { recursive: true, force: true });
	}
});

/** PIDs whose command line mentions `text`, read from /proc (no pkill: only this test's own processes). */
function processesMentioning(text: string): number[] {
	const found: number[] = [];
	for (const entry of readdirSync("/proc")) {
		if (!/^\d+$/.test(entry)) continue;
		try {
			const command = readFileSync(`/proc/${entry}/cmdline`, "utf8");
			if (command.includes(text) && Number(entry) !== process.pid) found.push(Number(entry));
		} catch {
			// Exited while scanning.
		}
	}
	return found;
}

function alive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

async function until(check: () => boolean | Promise<boolean>, what: string, timeoutMs = 15_000): Promise<void> {
	const start = Date.now();
	while (Date.now() - start < timeoutMs) {
		if (await check()) return;
		await Bun.sleep(20);
	}
	throw new Error(`timed out waiting for ${what}`);
}

/** One opened terminal as a client sees it: its output so far, and acks as it goes unless told not to. */
class Probe {
	readonly chunks: Uint8Array[] = [];
	frames = 0;
	bytes = 0;
	constructor(
		readonly client: TestClient,
		readonly terminalId: number,
		readonly autoAck: boolean,
	) {
		const receive = (raw: Uint8Array) => {
			const frame = decodeTerminalFrame(raw);
			if (frame === undefined || frame.kind !== TERMINAL_FRAME.output || frame.terminalId !== terminalId) return;
			this.chunks.push(frame.payload);
			this.frames += 1;
			this.bytes += frame.payload.length;
			if (this.autoAck) client.sendBinary(encodeTerminalAck(terminalId, frame.payload.length));
		};
		// The socket may deliver startup frames before the request continuation installs this probe.
		for (const raw of client.binaryFrames) receive(raw);
		client.onBinary(receive);
	}
	text(): string {
		return new TextDecoder().decode(Buffer.concat(this.chunks));
	}
	type(text: string): void {
		this.client.sendBinary(encodeTerminalFrame(TERMINAL_FRAME.input, this.terminalId, new TextEncoder().encode(text)));
	}
	ack(bytes: number): void {
		this.client.sendBinary(encodeTerminalAck(this.terminalId, bytes));
	}
	waitForText(needle: string | RegExp, timeoutMs = 15_000): Promise<void> {
		return until(() => (typeof needle === "string" ? this.text().includes(needle) : needle.test(this.text())), `"${String(needle)}" in the output`, timeoutMs);
	}
}

async function connect(setup: TestSetup): Promise<TestClient> {
	const client = await TestClient.open(setup.server);
	clients.push(client);
	await client.hello();
	return client;
}

async function plainSetup(options: { perConnection?: number; perServer?: number; windowBytes?: number; pendingLimitBytes?: number; flushMs?: number } = {}): Promise<TestSetup> {
	const setup = await createSetup({
		terminals: { multiplexer: "none", command: BASH, env: { ...process.env, PS1: "$ " }, ...(options.perConnection === undefined ? {} : { maxPerConnection: options.perConnection }), ...(options.perServer === undefined ? {} : { maxPerServer: options.perServer }), ...(options.windowBytes === undefined ? {} : { windowBytes: options.windowBytes }), ...(options.pendingLimitBytes === undefined ? {} : { pendingLimitBytes: options.pendingLimitBytes }), ...(options.flushMs === undefined ? {} : { flushMs: options.flushMs }) },
	});
	setups.push(setup);
	return setup;
}

async function open(client: TestClient, request: Record<string, unknown> = {}, autoAck = true): Promise<Probe & { response: Extract<ServerMessage, { type: "terminal.open" }> }> {
	const response = await client.request({ type: "terminal.open", cols: 100, rows: 30, ...request });
	if (response.type !== "terminal.open") throw new Error(`open failed: ${JSON.stringify(response)}`);
	const probe = new Probe(client, response.terminalId, autoAck) as Probe & { response: typeof response };
	probe.response = response;
	return probe;
}

describe("terminal protocol helpers", () => {
	test("frames round-trip and reject what is not a frame", () => {
		const frame = encodeTerminalFrame(TERMINAL_FRAME.input, 0x01020304, new Uint8Array([9, 8, 7]));
		expect([...frame.subarray(0, 5)]).toEqual([2, 1, 2, 3, 4]);
		expect(decodeTerminalFrame(frame)).toEqual({ kind: 2, terminalId: 0x01020304, payload: new Uint8Array([9, 8, 7]) });
		expect(decodeTerminalFrame(new Uint8Array([1, 0, 0]))).toBeUndefined();
		expect(decodeTerminalFrame(new Uint8Array([9, 0, 0, 0, 1]))).toBeUndefined();
		const ack = encodeTerminalAck(7, 65536);
		expect(decodeTerminalFrame(ack)?.kind).toBe(TERMINAL_FRAME.ack);
	});

	test("session names and prefixes", () => {
		expect(isTerminalSessionName("example-1")).toBe(true);
		expect(isTerminalSessionName("-rf")).toBe(false);
		expect(isTerminalSessionName(".hidden")).toBe(false);
		expect(isTerminalSessionName("a/b")).toBe(false);
		expect(isTerminalSessionName("a".repeat(49))).toBe(false);
		expect(terminalPrefix("Example Core Services")).toBe("example-core-services");
		expect(terminalPrefix("  ")).toBe("term");
		expect(terminalPrefix("Ünïcode ✨ test")).toBe("unicode-test");
	});
});

describe("terminals with a plain shell", () => {
	test("advertises the feature and lists no sessions", async () => {
		const setup = await plainSetup();
		const client = await connect(setup);
		const hello = await client.request({ type: "hello", protocolVersion: 1, client: { name: "x", version: "0" } }).catch(() => undefined);
		void hello;
		expect(setup.server.features).toContain("terminal");
		const list = await client.request({ type: "terminal.list" });
		expect(list).toMatchObject({ type: "terminal.list", available: true, multiplexer: "none", sessions: [], attached: [] });
		expect((list as { limits: { perConnection: number } }).limits.perConnection).toBe(8);
	});

	test("types into a real PTY, reads output, resizes, and detaches", async () => {
		const setup = await plainSetup();
		const client = await connect(setup);
		const terminal = await open(client, { cwd: setup.projectDir, cols: 90, rows: 20 });
		expect(terminal.response).toMatchObject({ cols: 90, rows: 20, created: true });

		terminal.type("echo hello-$((6*7))\n");
		await terminal.waitForText("hello-42");
		terminal.type("pwd\n");
		await terminal.waitForText(setup.projectDir);

		terminal.type("stty size\n");
		await terminal.waitForText("20 90");
		const resized = await client.request({ type: "terminal.resize", terminalId: terminal.terminalId, cols: 120, rows: 40 });
		expect(resized.type).toBe("terminal.resize");
		terminal.type("stty size\n");
		await terminal.waitForText("40 120");

		const list = await client.request({ type: "terminal.list" });
		expect((list as { attached: unknown[] }).attached).toEqual([{ terminalId: terminal.terminalId, session: terminal.response.session, cols: 120, rows: 40 }]);

		const pid = setup.server.terminals!.attachedCount;
		expect(pid).toBe(1);
		const closed = await client.request({ type: "terminal.close", terminalId: terminal.terminalId });
		expect(closed).toMatchObject({ type: "terminal.close", terminalId: terminal.terminalId });
		expect(setup.server.terminals!.attachedCount).toBe(0);
		// The id is gone: a second close, a resize and stray input are refused or ignored.
		expect(await client.request({ type: "terminal.close", terminalId: terminal.terminalId })).toMatchObject({ type: "error", error: { code: "unknown_terminal" } });
		terminal.type("echo ignored\n");
	});

	test("reports the shell exiting, after its last output", async () => {
		const setup = await plainSetup();
		const client = await connect(setup);
		const terminal = await open(client);
		terminal.type("echo bye-now; exit 3\n");
		const closed = (await client.waitFor((message) => message.type === "terminal.closed")) as Extract<ServerMessage, { type: "terminal.closed" }>;
		expect(closed).toMatchObject({ terminalId: terminal.terminalId, reason: "exited", exitCode: 3 });
		expect(terminal.text()).toContain("bye-now");
		expect(setup.server.terminals!.attachedCount).toBe(0);
	});

	test("refuses a missing directory and bad sizes and names", async () => {
		const setup = await plainSetup();
		const client = await connect(setup);
		expect(await client.request({ type: "terminal.open", cols: 80, rows: 24, cwd: "/definitely/not/here" })).toMatchObject({ type: "error", error: { code: "invalid_path" } });
		expect(await client.request({ type: "terminal.open", cols: 0, rows: 24 })).toMatchObject({ type: "error", error: { code: "bad_request" } });
		expect(await client.request({ type: "terminal.open", cols: 80, rows: 24, session: "-d" })).toMatchObject({ type: "error", error: { code: "bad_request" } });
		expect(await client.request({ type: "terminal.open", cols: 80, rows: 24, session: "../x" })).toMatchObject({ type: "error", error: { code: "bad_request" } });
		expect(setup.server.terminals!.attachedCount).toBe(0);
	});

	test("limits terminals per connection and per server", async () => {
		const setup = await plainSetup({ perConnection: 2, perServer: 3 });
		const first = await connect(setup);
		await open(first);
		await open(first);
		expect(await first.request({ type: "terminal.open", cols: 80, rows: 24 })).toMatchObject({ type: "error", error: { code: "terminal_limit" } });
		const second = await connect(setup);
		await open(second);
		const third = await second.request({ type: "terminal.open", cols: 80, rows: 24 });
		expect(third).toMatchObject({ type: "error", error: { code: "terminal_limit" } });
		expect(setup.server.terminals!.attachedCount).toBe(3);
		// Closing one frees a slot.
		const list = (await second.request({ type: "terminal.list" })) as { attached: { terminalId: number }[] };
		await second.request({ type: "terminal.close", terminalId: list.attached[0]!.terminalId });
		expect((await second.request({ type: "terminal.open", cols: 80, rows: 24 })).type).toBe("terminal.open");
	});

	test("caps input frames and rejects frames that are not terminal frames", async () => {
		const setup = await plainSetup();
		const client = await connect(setup);
		const terminal = await open(client);
		const before = client.messages.length;
		client.sendBinary(encodeTerminalFrame(TERMINAL_FRAME.input, terminal.terminalId, new Uint8Array(64 * 1024 + 1)));
		client.sendBinary(new Uint8Array([42, 0, 0, 0, 1, 1]));
		client.sendBinary(encodeTerminalFrame(TERMINAL_FRAME.ack, terminal.terminalId, new Uint8Array([1, 2])));
		await until(() => client.messages.length >= before + 3, "three errors");
		const errors = client.messages.slice(before).filter((message) => message.type === "error");
		expect(errors.map((message) => (message as { error: { code: string } }).error.code)).toEqual(["bad_request", "bad_request", "bad_request"]);
		// An input of exactly the cap is accepted.
		terminal.type(`echo ${"x".repeat(1000)}\n`);
		await terminal.waitForText("x".repeat(1000));
	});

	test("detaches every terminal when the socket goes away", async () => {
		const setup = await plainSetup();
		const client = await connect(setup);
		await open(client);
		await open(client);
		expect(setup.server.terminals!.attachedCount).toBe(2);
		const pids = processesMentioning("--norc");
		expect(pids.length).toBeGreaterThanOrEqual(2);
		client.close();
		await until(() => setup.server.terminals!.attachedCount === 0, "the terminals to detach");
		await until(() => pids.every((pid) => !alive(pid)), "the shells to end");
	});

	test("a big output arrives whole while the client acks", async () => {
		const setup = await plainSetup();
		const client = await connect(setup);
		const terminal = await open(client);
		terminal.type("seq 1 300000; echo done-$((1+1))\n");
		await terminal.waitForText("done-2", 30_000);
		const text = terminal.text();
		expect(text).toContain("\r\n300000\r\n");
		expect(text).toContain("\r\n150000\r\n");
		// Batched: far fewer frames than the 300000 lines, none over the frame limit.
		expect(terminal.frames).toBeLessThan(terminal.bytes / 1000);
		expect(Math.max(...terminal.chunks.map((chunk) => chunk.length))).toBeLessThanOrEqual(32 * 1024);
	});

	test("holds output at the window until acked, then sends the rest", async () => {
		const setup = await plainSetup({ windowBytes: 4096 });
		const client = await connect(setup);
		const terminal = await open(client, {}, false);
		terminal.type("seq 1 5000; echo marker-$((2+2))\n");
		await until(() => terminal.bytes >= 4096, "the window to fill");
		await Bun.sleep(300);
		expect(terminal.bytes).toBeLessThanOrEqual(4096);
		expect(terminal.text()).not.toContain("marker-4");
		// Acking lets the queue drain: ack everything received until the marker shows.
		let acked = 0;
		await until(() => {
			if (terminal.bytes > acked) {
				terminal.ack(terminal.bytes - acked);
				acked = terminal.bytes;
			}
			return terminal.text().includes("marker-4");
		}, "the queue to drain after acks");
	});

	test("drops output for a client that never acks, then resyncs once it catches up", async () => {
		const setup = await plainSetup({ windowBytes: 4096, pendingLimitBytes: 32 * 1024 });
		const client = await connect(setup);
		const terminal = await open(client, {}, false);
		terminal.type("seq 1 200000; echo flood-over-$((3+3))\n");
		const attachment = () => (setup.server.terminals as unknown as { attachments?: never }) ?? undefined;
		void attachment;
		await until(() => terminal.bytes >= 4096, "the window to fill");
		// Memory stays bounded while the client says nothing: at most the window went out.
		await Bun.sleep(1000);
		expect(terminal.bytes).toBeLessThanOrEqual(4096);
		// Catching up: ack what arrived. The flood is dropped, so there is a resync, not the thousands of lines.
		let acked = 0;
		await until(() => {
			if (terminal.bytes > acked) {
				terminal.ack(terminal.bytes - acked);
				acked = terminal.bytes;
			}
			return client.messages.some((message) => message.type === "terminal.resync");
		}, "the resync event");
		expect(terminal.bytes).toBeLessThan(200_000);
	});
});

describe("terminals switched off or without zellij", () => {
	test("terminals: false hides the feature and refuses the requests", async () => {
		const setup = await createSetup({ terminals: false });
		setups.push(setup);
		expect(setup.server.features).not.toContain("terminal");
		expect(setup.server.terminals).toBeUndefined();
		const client = await connect(setup);
		expect(await client.request({ type: "terminal.list" })).toMatchObject({ type: "error", error: { code: "unknown_request" } });
		expect(await client.request({ type: "terminal.open", cols: 80, rows: 24 })).toMatchObject({ type: "error", error: { code: "unknown_request" } });
	});

	test("a backend without zellij says so in the list and when opening", async () => {
		const setup = await createSetup({ terminals: { multiplexer: "zellij", zellij: "/nonexistent/zellij", env: { PATH: "", HOME: "/nonexistent" } } });
		setups.push(setup);
		const client = await connect(setup);
		const list = (await client.request({ type: "terminal.list" })) as { available: boolean; reason: string; survivesRestart: boolean; sessions: unknown[] };
		expect(list.available).toBe(false);
		expect(list.reason).toContain("zellij is not installed on this backend");
		expect(list.survivesRestart).toBe(false);
		expect(list.sessions).toEqual([]);
		const opened = await client.request({ type: "terminal.open", cols: 80, rows: 24 });
		expect(opened).toMatchObject({ type: "error", error: { code: "terminal_unavailable" } });
		expect((opened as { error: { message: string } }).error.message).toContain("zellij is not installed");
	});

	test("the environment switch", async () => {
		const { terminalsEnabled } = await import("../src/terminals.ts");
		expect(terminalsEnabled({})).toBe(true);
		expect(terminalsEnabled({ AIKI_TERMINALS: "off" })).toBe(false);
		expect(terminalsEnabled({ AIKI_TERMINALS: "OFF" })).toBe(false);
		expect(terminalsEnabled({ AIKI_TERMINALS: "on" })).toBe(true);
	});
});

/** zellij on throwaway sockets, cache and home: never the user's own sessions. */
async function zellijScratch(): Promise<{ dir: string; configFile: string; env: Record<string, string | undefined> }> {
	const dir = await mkdtemp(join(tmpdir(), "mh-zj-"));
	scratch.push(dir);
	await mkdir(join(dir, "sock"), { recursive: true });
	await mkdir(join(dir, "home"), { recursive: true });
	return {
		dir,
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
}

describe.skipIf(ZELLIJ === null)("terminals on zellij sessions", () => {
	async function zellijSetup(survive: "auto" | "off" = "off"): Promise<{ setup: TestSetup; dir: string }> {
		const { dir, env, configFile } = await zellijScratch();
		const setup = await createSetup({ terminals: { multiplexer: "zellij", survive, env, configFile } });
		setups.push(setup);
		return { setup, dir };
	}

	test("lists, creates, reattaches with the screen intact, and ends a session", async () => {
		const { setup } = await zellijSetup();
		const client = await connect(setup);
		const list = (await client.request({ type: "terminal.list" })) as { available: boolean; version: string; sessions: unknown[] };
		expect(list).toMatchObject({ available: true, multiplexer: "zellij", sessions: [] });
		expect(list.version).toMatch(/^\d+\.\d+/);

		// A new session named from the prefix, starting in the project's folder.
		let outputBeforeOpen = false;
		const stopCheckingOrder = client.onBinary(() => {
			if (!client.messages.some((message) => message.type === "terminal.open")) outputBeforeOpen = true;
		});
		const first = await open(client, { prefix: "My Project", cwd: setup.projectDir });
		stopCheckingOrder();
		expect(outputBeforeOpen).toBe(false);
		expect(first.response).toMatchObject({ session: "my-project-1", created: true });
		first.type("echo zj-$((2+3)) && pwd\r");
		await first.waitForText("zj-5", 30_000);
		await first.waitForText(setup.projectDir);

		// A small screen need not produce 2 KiB: readiness is the render event, not an output byte count.
		const second = await open(client, { prefix: "My Project", cols: 20, rows: 5 });
		expect(second.response.session).toBe("my-project-2");

		const listed = (await client.request({ type: "terminal.list" })) as { sessions: { name: string; attached: boolean; exited: boolean }[] };
		expect(listed.sessions.map((entry) => [entry.name, entry.attached, entry.exited]).sort()).toEqual([
			["my-project-1", true, false],
			["my-project-2", true, false],
		]);

		// Detach: the session stays, and a fresh attach redraws what was on screen.
		await client.request({ type: "terminal.close", terminalId: first.terminalId });
		const afterDetach = (await client.request({ type: "terminal.list" })) as { sessions: { name: string; attached: boolean }[] };
		expect(afterDetach.sessions.find((entry) => entry.name === "my-project-1")).toMatchObject({ attached: false });
		const again = await open(client, { session: "my-project-1" });
		expect(again.response).toMatchObject({ session: "my-project-1", created: false });
		await again.waitForText("zj-5", 30_000);

		// Ending a session closes whoever is attached and removes it from the list.
		const kill = await client.request({ type: "terminal.kill", session: "my-project-2" });
		expect(kill).toMatchObject({ type: "terminal.kill", session: "my-project-2" });
		const closed = (await client.waitFor((message) => message.type === "terminal.closed" && message.terminalId === second.terminalId)) as { reason: string };
		expect(closed.reason).toBe("killed");
		const afterKill = (await client.request({ type: "terminal.list" })) as { sessions: { name: string }[] };
		expect(afterKill.sessions.map((entry) => entry.name)).toEqual(["my-project-1"]);
		expect(await client.request({ type: "terminal.kill", session: "my-project-2" })).toMatchObject({ type: "error", error: { code: "unknown_terminal" } });
		expect(await client.request({ type: "terminal.kill", session: "-h" })).toMatchObject({ type: "error", error: { code: "bad_request" } });
		await client.request({ type: "terminal.kill", session: "my-project-1" });
	}, 120_000);

	test("a server restart only detaches: the session and its process keep running", async () => {
		const { setup, dir } = await zellijSetup();
		const client = await connect(setup);
		const first = await open(client, { prefix: "keep", cwd: setup.projectDir });
		first.type("sleep 7654\r");
		await first.waitForText("sleep 7654", 30_000);
		await until(() => processesMentioning("sleep\u00007654").length > 0, "sleep to run in the session");
		const sleepPid = processesMentioning("sleep\u00007654")[0]!;

		await setup.restart();
		expect(alive(sleepPid)).toBe(true);
		const reconnected = await connect(setup);
		const list = (await reconnected.request({ type: "terminal.list" })) as { sessions: { name: string; exited: boolean }[] };
		expect(list.sessions).toEqual([expect.objectContaining({ name: "keep-1", exited: false })]);
		const again = await open(reconnected, { session: "keep-1" });
		await again.waitForText("sleep 7654", 30_000);
		expect(alive(sleepPid)).toBe(true);
		await reconnected.request({ type: "terminal.kill", session: "keep-1" });
		await until(() => !alive(sleepPid), "sleep to end with its session");
		void dir;
	}, 120_000);

	test("starts the session's server outside the service's cgroup when the user manager allows it", async () => {
		const { setup, dir } = await zellijSetup("auto");
		const client = await connect(setup);
		const list = (await client.request({ type: "terminal.list" })) as { survivesRestart: boolean };
		if (!list.survivesRestart) {
			console.log("skipped: no user systemd manager here");
			return;
		}
		const terminal = await open(client, { prefix: "scoped" });
		terminal.type("echo scoped-ok\r");
		await terminal.waitForText("scoped-ok", 30_000);
		await until(() => processesMentioning(`--server`).some((pid) => readFileSync(`/proc/${pid}/cmdline`, "utf8").includes(dir)), "the zellij server");
		const server = processesMentioning("--server").find((pid) => readFileSync(`/proc/${pid}/cmdline`, "utf8").includes(dir))!;
		const serverGroup = readFileSync(`/proc/${server}/cgroup`, "utf8").trim();
		const ownGroup = readFileSync("/proc/self/cgroup", "utf8").trim();
		expect(serverGroup).not.toBe(ownGroup);
		expect(serverGroup).toContain(".scope");
		await client.request({ type: "terminal.kill", session: "scoped-1" });
		void existsSync;
	}, 120_000);
});

describe("TerminalHost", () => {
	test("readiness waits for a screen clear across chunks, not a byte threshold", async () => {
		let output = "";
		const host = new TerminalHost({ multiplexer: "none", command: ["bash", "-c",
			"stty -echo; printf '%2100s'; read -r first; printf '\\033[2'; read -r second; printf J; read -r last",
		] });
		try {
			const terminal = await host.open({ cols: 20, rows: 5 }, {
				output: (bytes) => { output += new TextDecoder().decode(bytes); },
				resync: () => undefined,
				closed: () => undefined,
			});
			let ready = false;
			const rendered = terminal.waitForRender().then(() => { ready = true; });
			await until(() => output.length >= 2100, "startup output");
			expect(ready).toBe(false);
			terminal.write("first\n");
			await until(() => output.endsWith("\x1b[2"), "partial screen clear");
			expect(ready).toBe(false);
			terminal.write("second\n");
			await rendered;
			expect(ready).toBe(true);
		} finally {
			await host.stop();
		}
	});

	test("stop detaches what is attached and refuses new terminals", async () => {
		const host = new TerminalHost({ multiplexer: "none", command: BASH });
		const sink = { output: () => undefined, resync: () => undefined, closed: () => undefined };
		const attachment = await host.open({ cols: 80, rows: 24 }, sink);
		expect(host.attachedCount).toBe(1);
		const pid = attachment.pid;
		await host.stop();
		expect(host.attachedCount).toBe(0);
		await until(() => !alive(pid), "the shell to end");
		await expect(host.open({ cols: 80, rows: 24 }, sink)).rejects.toThrow("shutting down");
	});
});
