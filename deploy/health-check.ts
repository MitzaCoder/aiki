#!/usr/bin/env bun
/**
	* Is a aiki backend alive, and is it safe to restart?
	*
	* Sends protocol requests over the WebSocket at `/ws`, retrying until `--timeout-ms` runs out. Exit 0 only when the
	* server answers everything asked; prints one line saying what answered. The backends are API-only, so there is no app
	* shell to fetch.
	*
	*   bun deploy/health-check.ts                                    # http://127.0.0.1:7317
	*   bun deploy/health-check.ts http://vm.example.test:7317 --timeout-ms=15000
	*   bun deploy/health-check.ts --deep --expect-commit=<sha>       # what the deploy checks after a restart
	*   bun deploy/health-check.ts --record-open-projects=<file>      # before the restart: which projects to check
	*   bun deploy/health-check.ts --wait-idle                        # before the restart: drain, wait for tool calls
	*
	* `--deep` goes past `hello`: with the `server-status` feature it asks for `server.status` and, with `--expect-commit`,
	* fails unless the server runs that commit; then it lists the projects and pages a coordinator conversation. Which ones
	* it pages matters: projects open lazily, so right after a restart `projects.list` reports none open and paging only
	* those would check nothing. `--record-open-projects=<file>` saves the IDs that are open before the restart, and
	* `--open-projects=<file>` makes the deep check page exactly those (paging opens them again) and fail if one of them
	* cannot be paged. A project that was not open before was not checked before either, so a vanished path there cannot
	* block a deploy. Without the file the deep check pages whatever is open right now. A server without the status
	* feature (an older release, a rollback target) skips the status step only, so this stays usable against every release.
	*
	* `--record-open-projects` never fails: a server that does not answer records no project, and the deep check then
	* checks none.
	*
	* `--wait-idle` waits until a restart interrupts no tool call, at most `--idle-timeout-ms` (10 minutes by default,
	* `DEPLOY_IDLE_TIMEOUT_SECONDS` in the deploy), `--idle-poll-ms` apart. A server with the `drain` feature is asked for
	* `server.drain` on every poll — new tool calls wait while it lasts, and each request extends it by the server's default
	* (2 minutes), so it lapses soon after a deploy that died — until no tool call is executing; conversations and workers
	* may still be running, and their held calls run after the restart. An older server is polled with `server.status`
	* until nothing runs at all (`busy` conversations and workers both 0). It exits 0 either way and says what happened:
	* the deploy restarts anyway, it just prefers not to interrupt work. A server that does not answer, or has neither
	* feature, is not waited for.
	*
	* The deploy runs it against each backend's loopback (that decides a rollback) and, for the VM, from this host over the
	* tailnet (warning only, `--alive-only`: hello, or required auth discovery).
	* Required local checks use the owner-only Unix socket and the same limited RPC dispatch, never a device credential.
	*/
/** Copied standalone to each backend: built-in imports only, no workspace dependencies. */
import { existsSync, readdirSync, realpathSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { parseEnv } from "node:util";
import { Database } from "bun:sqlite";

/** Keep in step with packages/protocol/src/common.ts. */
const PROTOCOL_VERSION = 1;

/** The feature that carries `server.status`; older servers do not list it and skip the checks that need it. */
const SERVER_STATUS_FEATURE = "server-status";
/** The feature that carries `server.drain`; without it the deploy waits for the server to be idle instead. */
const DRAIN_FEATURE = "drain";

const DEFAULT_BASE = "http://127.0.0.1:7317";
const DEFAULT_TIMEOUT_MS = 30_000;
const REQUEST_TIMEOUT_MS = 5_000;
const DEFAULT_IDLE_TIMEOUT_MS = 600_000;
const DEFAULT_IDLE_POLL_MS = 5_000;

type Options = {
	base: string;
	timeoutMs: number;
	expectCommit: string | null;
	deep: boolean;
	waitIdle: boolean;
	idleTimeoutMs: number;
	idlePollMs: number;
	/** Where the projects open before the restart are recorded, or read from. */
	openProjects: string | null;
	aliveOnly: boolean;
	checkRelease: string | null;
	recordOpen: boolean;
};

type Message = Record<string, unknown>;

function parseOptions(argv: readonly string[]): Options {
	const options: Options = {
		base: DEFAULT_BASE,
		timeoutMs: DEFAULT_TIMEOUT_MS,
		expectCommit: null,
		deep: false,
		waitIdle: false,
		idleTimeoutMs: DEFAULT_IDLE_TIMEOUT_MS,
		idlePollMs: DEFAULT_IDLE_POLL_MS,
		openProjects: null,
		recordOpen: false,
		aliveOnly: false,
		checkRelease: null,
	};
	for (const argument of argv) {
		if (!argument.startsWith("--")) {
			options.base = argument;
			continue;
		}
		const [name, value] = argument.split("=", 2);
		switch (name) {
			case "--alive-only":
				options.aliveOnly = true;
				continue;
			case "--check-release":
				if (!value) throw new Error("--check-release needs a release directory");
				options.checkRelease = value;
				continue;
			case "--deep":
				options.deep = true;
				continue;
			case "--wait-idle":
				options.waitIdle = true;
				continue;
			case "--expect-commit":
				if (!value) throw new Error("--expect-commit needs a commit");
				options.expectCommit = value;
				continue;
			case "--open-projects":
				if (!value) throw new Error("--open-projects needs a file");
				options.openProjects = value;
				continue;
			case "--record-open-projects":
				if (!value) throw new Error("--record-open-projects needs a file");
				options.openProjects = value;
				options.recordOpen = true;
				continue;
			case "--timeout-ms":
			case "--idle-timeout-ms":
			case "--idle-poll-ms": {
				if (value === undefined || !(Number(value) >= 0)) throw new Error(`${name} needs a number of milliseconds`);
				if (name === "--timeout-ms") options.timeoutMs = Number(value);
				if (name === "--idle-timeout-ms") options.idleTimeoutMs = Number(value);
				if (name === "--idle-poll-ms") options.idlePollMs = Math.max(Number(value), 1);
				continue;
			}
			default:
				throw new Error(`unknown option ${argument}`);
		}
	}
	options.base = options.base.replace(/\/+$/, "");
	return options;
}

function webSocketUrl(base: string): string {
	const url = new URL(base);
	url.protocol = url.protocol === "https:" || url.protocol === "wss:" ? "wss:" : "ws:";
	url.pathname = "/ws";
	url.search = "";
	url.hash = "";
	return url.toString();
}

/** Deliberately standalone copies of server-env.ts and data-dir.ts; explicit process settings win. */
type Environment = Readonly<Record<string, string | undefined>>;
function normalizeEnvironment(env: Environment): Record<string, string | undefined> {
 return Object.fromEntries(Object.entries(env).filter(([name]) => !name.startsWith("AIKI_")));
}
function privateSetting(name: string): boolean { return name.startsWith("KEMIRI_"); }

function defaultProductDirectory(base: string): string {
	const canonical = join(base, "kemiri"), legacy = join(base, "aiki");
	const populated = (path: string) => existsSync(path) && readdirSync(path).length > 0;
	if (populated(canonical) && populated(legacy) && realpathSync(canonical) !== realpathSync(legacy)) {
		throw new Error("Both kemiri and aiki default directories contain data; choose an explicit KEMIRI_DATA_DIR or KEMIRI_CONFIG_DIR (or KEMIRI_ENV_FILE).");
	}
	if (existsSync(legacy) && (!existsSync(canonical) || (!populated(canonical) && populated(legacy)))) return legacy;
	return canonical;
}

function dataDirectory(): string {
	const env = process.env;
	const settings = normalizeEnvironment(env);
	if (settings.KEMIRI_CHILD_PROCESS === "1" && !settings.KEMIRI_ENV_FILE) return resolveData(settings);
	const file = settings.KEMIRI_ENV_FILE || join(settings.KEMIRI_CONFIG_DIR || defaultProductDirectory(env.XDG_CONFIG_HOME || join(homedir(), ".config")), "server.env");
	let source: string;
	try { source = readFileSync(file, "utf8"); }
	catch (error) {
		if (!settings.KEMIRI_ENV_FILE && (error as NodeJS.ErrnoException).code === "ENOENT") return resolveData(settings);
		throw error;
	}
	const parsed = parseEnv(source);
	for (const name of Object.keys(parsed)) if (!privateSetting(name)) throw new Error(`Server env file may only set KEMIRI_ settings: ${name}`);
	const fileSettings = normalizeEnvironment(parsed);
	for (const [name, value] of Object.entries(settings)) if (value !== undefined) fileSettings[name] = value;
	return resolveData(fileSettings);
}
function resolveData(env: Record<string, string | undefined>): string {
	const expand = (path: string) => path === "~" ? homedir() : path.startsWith("~/") ? join(homedir(), path.slice(2)) : path;
	const data = env.KEMIRI_DATA_DIR?.trim(), xdg = env.XDG_DATA_HOME?.trim();
	return data ? resolve(expand(data)) : defaultProductDirectory(xdg ? resolve(expand(xdg)) : join(homedir(), ".local/share"));
}

/** Read only: a dead backend must not make a required data directory safe to downgrade. */
async function checkRelease(directory: string): Promise<void> {
	const file = join(dataDirectory(), "auth.sqlite");
	try { statSync(file); }
	catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return; throw error; } // pre-auth installation
	const db = new Database(file, { readonly: true });
	try {
		const row = db.query("SELECT state FROM auth WHERE id=1").get() as { state: string } | null;
		const mode = row && JSON.parse(row.state).mode;
		if (!["off", "optional", "required"].includes(mode)) throw new Error("Cannot read persisted auth mode; refusing release switch");
		if (mode !== "required") return;
		let supported = false;
		try { supported = (await Bun.file(join(directory, "RELEASE.json")).json()).supportsDeviceAuth === true; } catch {}
		if (!supported) throw new Error("required device sign-in: refusing release without recorded device-auth support");
	} finally { db.close(); }
}

type CheckSession = Pick<Session, "request" | "close">;
class OwnerCheckSession {
	#socket = join(dataDirectory(), "auth.sock");
	constructor(readonly backendId: string, readonly port: string) {}
	async request(type: string, fields: Message = {}, timeoutMs = REQUEST_TIMEOUT_MS): Promise<Message> {
		const response = await fetch("http://localhost/", {
			unix: this.#socket, method: "POST", headers: { "content-type": "application/json" },
			body: JSON.stringify({ args: ["health-check", JSON.stringify({ type, id: "health-check", ...fields })] }),
			signal: AbortSignal.timeout(timeoutMs),
		});
		const answer = await response.json() as Message;
		if (!response.ok || answer.type === "error") {
			const error = answer.error as { code?: string } | undefined;
			throw new Error(`owner health check: ${error?.code ?? "failed"}`);
		}
		if (answer.backendId !== this.backendId || new URL(String(answer.loopbackOrigin)).port !== this.port)
			throw new Error("owner socket does not belong to the checked backend");
		const reply = answer.answer as Message;
		if (reply.type === "error") throw new Error(`owner health check: ${String((reply.error as { code?: string })?.code)}`);
		return reply;
	}
	close(): void {}
}

async function requiredBackendId(base: string): Promise<string | null> {
	const url = new URL(base);
	url.protocol = url.protocol === "wss:" ? "https:" : url.protocol === "ws:" ? "http:" : url.protocol;
	url.pathname = "/auth/status"; url.search = ""; url.hash = "";
	const response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
	if (response.status === 404) return null; // older releases
	if (!response.ok) throw new Error(`auth status HTTP ${response.status}`);
	let status: { authVersion?: unknown; backendId?: unknown; mode?: unknown };
	try { status = await response.json(); } catch { return null; } // older app-shell responses
	if (status.authVersion !== 1 || typeof status.backendId !== "string" || !status.backendId ||
		typeof status.mode !== "string" || !["off", "optional", "required"].includes(status.mode)) throw new Error("invalid auth status");
	return status.mode === "required" ? status.backendId : null;
}

async function connect(options: Options): Promise<CheckSession> {
	const backendId = await requiredBackendId(options.base);
	if (backendId) {
		const url = new URL(options.base);
		if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) throw new Error("required backend needs an on-host owner check");
		return new OwnerCheckSession(backendId, url.port);
	}
	return Session.connect(webSocketUrl(options.base));
}

/** One connection, many requests: each answer is matched by its id, an `error` answer rejects. */
class Session {
	#socket: WebSocket;
	#pending = new Map<string, { resolve: (answer: Message) => void; reject: (error: Error) => void }>();
	#counter = 0;
	#closed = false;

	private constructor(socket: WebSocket) {
		this.#socket = socket;
		socket.onmessage = (event) => this.#receive(event.data);
		socket.onclose = (event) => this.#fail(new Error(`websocket closed (${event.code})`));
		socket.onerror = () => this.#fail(new Error("websocket error"));
	}

	static connect(url: string): Promise<Session> {
		return new Promise((resolve, reject) => {
			const socket = new WebSocket(url);
			let opened = false;
			const timer = setTimeout(() => {
				socket.close();
				reject(new Error(`websocket did not open in ${REQUEST_TIMEOUT_MS}ms`));
			}, REQUEST_TIMEOUT_MS);
			socket.onopen = () => {
				opened = true;
				clearTimeout(timer);
				socket.onerror = null;
				resolve(new Session(socket));
			};
			socket.onerror = () => {
				clearTimeout(timer);
				if (!opened) reject(new Error("websocket error"));
			};
			socket.onclose = (event) => {
				clearTimeout(timer);
				if (!opened) reject(new Error(`websocket closed (${event.code})`));
			};
		});
	}

	#receive(data: unknown): void {
		let message: Message;
		try {
			message = JSON.parse(String(data)) as Message;
		} catch {
			return;
		}
		if (typeof message !== "object" || message === null) return;
		const id = message.id;
		if (typeof id !== "string") return;
		const pending = this.#pending.get(id);
		if (!pending) return;
		this.#pending.delete(id);
		if (message.type === "error") {
			const error = message.error as { code?: unknown; message?: unknown } | undefined;
			pending.reject(new Error(`${String(error?.code)}: ${String(error?.message)}`));
			return;
		}
		pending.resolve(message);
	}

	#fail(error: Error): void {
		this.#closed = true;
		for (const pending of this.#pending.values()) pending.reject(error);
		this.#pending.clear();
	}

	request(type: string, fields: Message = {}, timeoutMs = REQUEST_TIMEOUT_MS): Promise<Message> {
		if (this.#closed) return Promise.reject(new Error("websocket closed"));
		const id = `health-check-${++this.#counter}`;
		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				this.#pending.delete(id);
				reject(new Error(`no answer to ${type} in ${timeoutMs}ms`));
			}, timeoutMs);
			this.#pending.set(id, {
				resolve: (answer) => {
					clearTimeout(timer);
					resolve(answer);
				},
				reject: (error) => {
					clearTimeout(timer);
					reject(error);
				},
			});
			this.#socket.send(JSON.stringify({ type, id, ...fields }));
		});
	}

	close(): void {
		this.#fail(new Error("health check done"));
		this.#socket.close();
	}
}

type Hello = { name: string; version: string; features: ReadonlySet<string> };

async function hello(session: CheckSession): Promise<Hello> {
	const answer = await session.request("hello", {
		protocolVersion: PROTOCOL_VERSION,
		client: { name: "health-check" },
	});
	if (answer.protocolVersion !== PROTOCOL_VERSION) {
		throw new Error(`server speaks protocol ${String(answer.protocolVersion)}, expected ${PROTOCOL_VERSION}`);
	}
	const server = answer.server as { name?: unknown; version?: unknown } | undefined;
	const features = Array.isArray(answer.features) ? answer.features.map(String) : [];
	return { name: String(server?.name), version: String(server?.version), features: new Set(features) };
}

function message(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/**
	* A server can list `server-status` in its `hello` and still not answer it: a release between the feature being named
	* and being implemented, and exactly the case that must not roll itself back. It is treated like a server without the
	* feature.
	*/
function isUnknownRequest(error: unknown): boolean {
	return error instanceof Error && error.message.startsWith("unknown_request");
}

/**
	* `server.status`, or null when this server does not answer it. Any other error is the caller's problem.
	*/
async function askStatus(session: CheckSession): Promise<Message | null> {
	try {
		return ((await session.request("server.status")).status as Message | undefined) ?? null;
	} catch (error) {
		if (isUnknownRequest(error)) return null;
		throw error;
	}
}

/** `server.drain` (extending it from now): how many tool calls execute; null when the server does not know it. */
async function askDrain(session: CheckSession): Promise<number | null> {
	let answer: Message;
	try {
		answer = await session.request("server.drain");
	} catch (error) {
		if (isUnknownRequest(error)) return null;
		throw error;
	}
	if (typeof answer.toolCalls !== "number") throw new Error("server.drain has no toolCalls count");
	return answer.toolCalls;
}

function short(commit: string): string {
	return commit.slice(0, 12);
}

/** `busy` from `server.status`, or null when the server does not answer the request at all. */
function readBusy(status: Message | null): { conversations: number; workers: number } | null {
	if (status === null) return null;
	const busy = status.busy as { conversations?: unknown; workers?: unknown } | undefined;
	if (typeof busy?.conversations !== "number" || typeof busy.workers !== "number") {
		throw new Error("server.status has no busy counts");
	}
	return { conversations: busy.conversations, workers: busy.workers };
}

/** The projects a restart must check afterwards: the ones recorded before it, else the ones open now. */
async function projectsToPage(projects: Message[], recordedFile: string | null): Promise<string[]> {
	if (recordedFile === null) {
		return projects.filter((project) => project.state === "open").map((project) => String(project.id));
	}
	try {
		const recorded = await Bun.file(recordedFile).text();
		return recorded
			.split("\n")
			.map((line) => line.trim())
			.filter((line) => line !== "");
	} catch {
		return [];
	}
}

/** The checks after a restart: the release that runs, and that the projects open before it still page their transcript. */
async function checkDeep(
	session: CheckSession,
	answer: Hello,
	expectCommit: string | null,
	recordedFile: string | null,
): Promise<string> {
	const notes: string[] = [];
	if (answer.features.has(SERVER_STATUS_FEATURE)) {
		const status = await askStatus(session);
		const release = status?.release as { name?: unknown; commit?: unknown } | null | undefined;
		if (release) notes.push(`release ${String(release.name)}`);
		if (status === null) notes.push(`no working ${SERVER_STATUS_FEATURE} feature, so the running commit is not checked`);
		else if (expectCommit) {
			if (!release) throw new Error(`reports no release; expected ${short(expectCommit)}`);
			const commit = String(release.commit ?? "");
			if (commit !== expectCommit && !commit.startsWith(expectCommit)) {
				throw new Error(`runs commit ${short(commit)}, expected ${short(expectCommit)}`);
			}
		}
	} else if (expectCommit) {
		notes.push(`no ${SERVER_STATUS_FEATURE} feature, so the running commit is not checked`);
	}

	const listed = (await session.request("projects.list")).projects;
	const projects = Array.isArray(listed) ? (listed as Message[]) : [];
	const pages = await projectsToPage(projects, recordedFile);
	for (const projectId of pages) {
		await session.request("conversation.page", { projectId, limit: 1 });
	}
	if (recordedFile === null) {
		notes.push(`${pages.length} open project(s) paged`);
	} else if (pages.length === 0) {
		notes.push("no project was open before the restart, so no coordinator conversation was checked");
	} else {
		notes.push(`paged the ${pages.length} project(s) that were open before the restart`);
	}
	return notes.join(", ");
}

/** `hello`, plus the deep checks when asked. Resolves with what to print. */
async function check(options: Options): Promise<string> {
	if (options.aliveOnly) {
		if (options.deep || options.expectCommit) throw new Error("--alive-only cannot check release integrity");
		if (await requiredBackendId(options.base)) return "required device sign-in (discovery alive; no private checks)";
		const session = await Session.connect(webSocketUrl(options.base));
		try { const answer = await hello(session); return `${answer.name} ${answer.version}`; }
		finally { session.close(); }
	}
	const session = await connect(options);
	try {
		const answer = await hello(session);
		const summary = `${answer.name} ${answer.version}`;
		if (!options.deep) return summary;
		const notes = await checkDeep(session, answer, options.expectCommit, options.openProjects);
		return notes ? `${summary}, ${notes}` : summary;
	} finally {
		session.close();
	}
}

/**
	* Wait until a restart interrupts no tool call (`drain`) or, on an older server, nothing runs. Never fails the deploy:
	* every answer here is advice the deploy logs before it restarts anyway.
	*/
async function waitForIdle(options: Options): Promise<string> {
	const totalSeconds = Math.round(options.idleTimeoutMs / 1000);
	if (options.idleTimeoutMs <= 0) return `${options.base}: not waiting for it to be idle (idle timeout is 0s)`;
	const deadline = Date.now() + options.idleTimeoutMs;
	let lastError = "not tried";
	let busy = "";
	let reachedServer = false;
	/** Set when the server lists `drain` but does not answer it: from then on, the idle wait. */
	let drainUnanswered = false;
	let draining = false;
	for (let attempt = 1; ; attempt++) {
		let session: CheckSession | undefined;
		try {
			session = await connect(options);
			const answer = await hello(session);
			reachedServer = true;
			if (answer.features.has(DRAIN_FEATURE) && !drainUnanswered) {
				const toolCalls = await askDrain(session);
				if (toolCalls === null) {
					drainUnanswered = true;
				} else {
					draining = true;
					if (toolCalls === 0) {
						return `${options.base} is drained: no tool call is executing and new ones wait, safe to restart`;
					}
					busy = `${toolCalls} tool call(s) executing, new ones held`;
				}
			}
			if (!draining) {
				if (!answer.features.has(SERVER_STATUS_FEATURE)) {
					return `${options.base} has no ${SERVER_STATUS_FEATURE} feature; not waiting for it to be idle`;
				}
				const counts = readBusy(await askStatus(session));
				if (counts === null) {
					return `${options.base} lists but does not answer ${SERVER_STATUS_FEATURE}; not waiting for it to be idle`;
				}
				if (counts.conversations === 0 && counts.workers === 0) {
					return `${options.base} is idle: nothing is running, safe to restart`;
				}
				busy = `${counts.conversations} conversation(s) and ${counts.workers} worker(s) running`;
			}
		} catch (error) {
			lastError = message(error);
			// A server that is down is not going to go idle: restart it now rather than waiting for the timeout.
			if (attempt === 1 && !reachedServer) {
				return `${options.base} does not answer (${lastError}); not waiting for it to be idle`;
			}
		} finally {
			session?.close();
		}
		const waited = Math.round((options.idleTimeoutMs - Math.max(deadline - Date.now(), 0)) / 1000);
		if (Date.now() >= deadline) break;
		process.stderr.write(
			`${options.base} is ${draining ? "draining" : "not idle"} (${busy || lastError}), waiting ${waited}s of ${totalSeconds}s\n`,
		);
		await Bun.sleep(Math.min(options.idlePollMs, Math.max(deadline - Date.now(), 1)));
	}
	return `${options.base} is still busy after ${totalSeconds}s (${busy || lastError}); restarting anyway`;
}

/**
	* Save the projects that are open now, so the deep check after the restart can page exactly those. Never fails: a
	* server that does not answer records none, and the deploy goes on to restart it anyway.
	*/
async function recordOpenProjects(options: Options, path: string): Promise<string> {
	let projects: string[] = [];
	let note: string;
	let session: CheckSession | undefined;
	try {
		session = await connect(options);
		await hello(session);
		const listed = (await session.request("projects.list")).projects;
		const all = Array.isArray(listed) ? (listed as Message[]) : [];
		projects = all.filter((project) => project.state === "open").map((project) => String(project.id));
		note = `${projects.length} project(s) open before the restart`;
	} catch (error) {
		note = `cannot list the projects open before the restart (${message(error)}); checking none after it`;
	} finally {
		session?.close();
	}
	try {
		const ids = projects.map((projectId) => `${projectId}\n`).join("");
		if (path === "-") { process.stdout.write(ids); return ""; }
		await Bun.write(path, ids);
	} catch (error) {
		return `${options.base}: ${note}, but could not write ${path} (${message(error)})`;
	}
	return `${options.base}: ${note}`;
}

const options = parseOptions(process.argv.slice(2));

if (options.checkRelease) {
	try { await checkRelease(options.checkRelease); process.exit(0); }
	catch (error) { console.error(`release switch refused: ${message(error)}`); process.exit(1); }
}

if (options.recordOpen && options.openProjects !== null) {
	const note = await recordOpenProjects(options, options.openProjects);
	if (note) console.log(note);
	process.exit(0);
}

if (options.waitIdle) {
	console.log(await waitForIdle(options));
	process.exit(0);
}

const deadline = Date.now() + options.timeoutMs;
let lastError = "not tried";

for (let wait = 250; ; wait = Math.min(wait * 2, 2_000)) {
	try {
		console.log(`${options.base} answers: ${await check(options)}`);
		process.exit(0);
	} catch (error) {
		lastError = message(error);
	}
	if (Date.now() >= deadline) break;
	process.stderr.write(`${options.base} not up yet (${lastError}), retrying\n`);
	await Bun.sleep(Math.min(wait, Math.max(deadline - Date.now(), 1)));
}

console.error(`health check failed: ${options.base} after ${options.timeoutMs}ms: ${lastError}`);
process.exit(1);
