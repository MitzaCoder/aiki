/**
 * Terminals: PTYs on this machine, each one a zellij session, so a terminal that is closed, dropped or cut off by a
 * restart only detaches and reopening reattaches with the screen intact (see "Terminals" in docs/DESIGN.md).
 *
 * `TerminalHost` is the server's one holder of attach clients. A `TerminalAttachment` is one PTY running
 * `zellij attach --create <session>` (or, for tests and development, a plain shell). It batches what the PTY writes,
 * paces it with the client's acks and, when a client falls too far behind, drops what is queued and repaints instead of
 * growing without bound. The connection above it turns attachments into binary frames and JSON events.
 *
 * Surviving a restart: the backend's unit has `KillMode=mixed`, so a zellij server forked from the server's own PTY would
 * be killed with the unit's cgroup. A session that has to be created is therefore started with
 * `systemd-run --user --scope`, which has the user's systemd manager move the client into a transient scope outside the
 * unit; the zellij server the client forks lives there. Without a user manager the PTY is started plainly and the host
 * says so (`survivesRestart: false`).
 */
import { existsSync } from "node:fs";
import { mkdir, stat } from "node:fs/promises";
import { homedir, userInfo } from "node:os";
import { dirname, join } from "node:path";
import {
	TERMINAL_MAX_COLS,
	TERMINAL_MAX_OUTPUT_FRAME_BYTES,
	TERMINAL_MAX_ROWS,
	TERMINAL_OUTPUT_WINDOW_BYTES,
	TERMINAL_SESSION_NAME_MAX,
	type TerminalClosedReason,
	type TerminalLimits,
	isTerminalSessionName,
	terminalPrefix,
} from "@kemiri/protocol";
import { ServerError, errorMessage } from "./errors.ts";
import { childEnvironment } from "./child-environment.ts";
import { serverSettings } from "./server-settings.ts";

export type TerminalMultiplexer = "zellij" | "none";

export type TerminalHostOptions = {
	/** `zellij` (default) or `none`: a plain shell without sessions, for tests and development. */
	multiplexer?: TerminalMultiplexer;
	/** The zellij binary. Default: `AIKI_ZELLIJ`, else `zellij` on PATH, else `~/.local/bin/zellij`. */
	zellij?: string;
	/**
	 * Where a new zellij server is started. `auto` (default): outside the service's cgroup with `systemd-run --user
	 * --scope` when the user's systemd manager answers, else in the PTY itself. `off`: always in the PTY.
	 */
	survive?: "auto" | "off";
	/**
	 * Where to write a zellij config of the harness's own, used only when the user has none (zellij otherwise opens a
	 * first-run wizard that swallows the terminal's first keystrokes, and shows tips and release notes). Without this
	 * option zellij is left to its own defaults.
	 */
	configFile?: string;
	/** The command a `none` terminal runs. Default: the user's shell. */
	command?: readonly string[];
	/** The environment terminals start from (and the one zellij is asked in). Default: this process's. */
	env?: Record<string, string | undefined>;
	maxPerConnection?: number;
	maxPerServer?: number;
	/** Output bytes in flight before the host waits for acks. Default: the protocol's window. */
	windowBytes?: number;
	/** Queued output beyond which a slow client's output is dropped. Default 2 MiB. */
	pendingLimitBytes?: number;
	/** How long output is gathered before it is sent. Default 8 ms. */
	flushMs?: number;
	log?: (message: string) => void;
};

export type TerminalAvailability = {
	available: boolean;
	multiplexer: TerminalMultiplexer;
	version?: string;
	reason?: string;
	survivesRestart: boolean;
};

export type SessionListing = { name: string; exited: boolean; created?: string };

export type TerminalClosed = { reason: TerminalClosedReason; exitCode?: number; message?: string };

export type TerminalSink = {
	/** A batch of output, at most one frame's worth. */
	output(bytes: Uint8Array): void;
	/** Output was dropped: reset the screen; the frames after this repaint it. */
	resync(): void;
	/** The client ended on its own (not by `detach`). Called once, after the last output. */
	closed(info: TerminalClosed): void;
};

export type OpenTerminal = {
	session?: string;
	prefix?: string;
	cwd?: string;
	cols: number;
	rows: number;
};

/** For a user with no zellij config: no first-run wizard, no tips, no release notes; everything else is zellij's default. */
export const HARNESS_ZELLIJ_CONFIG = `// Written by aiki for the terminals it opens. It is used only while you have no zellij config of your own.
show_startup_tips false
show_release_notes false
default_mode "normal"
`;

/** `ICANON` in a terminal's local flags: set while a program has not switched to raw mode. */
const CANONICAL_MODE = process.platform === "darwin" ? 0x100 : 0x2;
/** Input held for a client that is not ready yet: at most this much, for at most this long. */
const HELD_INPUT_LIMIT = 256 * 1024;
const HELD_INPUT_MAX_MS = 15_000;
/** Zellij clears the screen on its first render; its startup terminal queries do not. May span PTY chunks. */
const FIRST_SCREEN_CLEAR = "\x1b[2J";

const DEFAULT_PENDING_LIMIT = 2 * 1024 * 1024;
const DEFAULT_FLUSH_MS = 8;
const COMMAND_TIMEOUT_MS = 8_000;
const SCOPE_PROBE_TTL_MS = 60_000;

/** The variables a terminal must not inherit: this server's own settings and its service manager's. */
const SCRUBBED_ENV = [/^ZELLIJ/, /^INVOCATION_ID$/, /^JOURNAL_STREAM$/, /^NOTIFY_SOCKET$/, /^SYSTEMD_EXEC_PID$/];

/** Whether terminals are on: yes, unless `AIKI_TERMINALS` is `off` (or `0`, `false`, `no`). */
export function terminalsEnabled(env: Readonly<Record<string, string | undefined>> = serverSettings): boolean {
	const value = env.AIKI_TERMINALS?.trim().toLowerCase();
	return !(value === "off" || value === "0" || value === "false" || value === "no");
}

function clampSize(value: number, max: number): number {
	return Math.max(1, Math.min(max, Math.floor(value)));
}

type CommandResult = { code: number; stdout: string; stderr: string };

export class TerminalHost {
	readonly #multiplexer: TerminalMultiplexer;
	readonly #zellijOption: string | undefined;
	readonly #survive: "auto" | "off";
	readonly #command: readonly string[] | undefined;
	readonly #configFile: string | undefined;
	readonly #baseEnv: Record<string, string | undefined>;
	readonly #windowBytes: number;
	readonly #pendingLimit: number;
	readonly #flushMs: number;
	readonly #log: (message: string) => void;
	readonly limits: TerminalLimits;
	readonly #attachments = new Set<TerminalAttachment>();
	#opening: Promise<unknown> = Promise.resolve();
	#scope: { at: number; usable: boolean } | undefined;
	#stopped = false;

	constructor(options: TerminalHostOptions = {}) {
		this.#multiplexer = options.multiplexer ?? "zellij";
		this.#zellijOption = options.zellij ?? (options.env ?? serverSettings).AIKI_ZELLIJ;
		this.#survive = options.survive ?? "auto";
		this.#command = options.command;
		this.#configFile = options.configFile;
		this.#baseEnv = options.env ?? { ...process.env };
		this.#windowBytes = options.windowBytes ?? TERMINAL_OUTPUT_WINDOW_BYTES;
		this.#pendingLimit = options.pendingLimitBytes ?? DEFAULT_PENDING_LIMIT;
		this.#flushMs = options.flushMs ?? DEFAULT_FLUSH_MS;
		this.#log = options.log ?? (() => undefined);
		this.limits = {
			perConnection: options.maxPerConnection ?? 8,
			perServer: options.maxPerServer ?? 16,
			maxInputBytes: 64 * 1024,
			windowBytes: this.#windowBytes,
		};
	}

	get attachedCount(): number {
		return this.#attachments.size;
	}

	/** The zellij binary, or undefined when none can be found. */
	#zellij(): string | undefined {
		const configured = this.#zellijOption;
		if (configured !== undefined && configured.length > 0) return existsSync(configured) ? configured : Bun.which(configured, { PATH: this.#baseEnv.PATH ?? "" }) ?? undefined;
		const found = Bun.which("zellij", { PATH: this.#baseEnv.PATH ?? "" });
		if (found !== null) return found;
		const local = join(this.#home(), ".local", "bin", "zellij");
		return existsSync(local) ? local : undefined;
	}

	#home(): string {
		return this.#baseEnv.HOME ?? homedir();
	}

	/** The environment a terminal or a zellij command runs in. */
	#env(): Record<string, string> {
		const env: Record<string, string> = {};
		for (const [key, value] of Object.entries(childEnvironment(this.#baseEnv))) {
			if (value === undefined || SCRUBBED_ENV.some((pattern) => pattern.test(key))) continue;
			env[key] = value;
		}
		// A test or an operator points zellij at its own sockets and config with these.
		for (const key of ["ZELLIJ_SOCKET_DIR", "ZELLIJ_CONFIG_DIR", "ZELLIJ_CONFIG_FILE"]) {
			const value = this.#baseEnv[key];
			if (value !== undefined) env[key] = value;
		}
		if (env.ZELLIJ_CONFIG_FILE === undefined && this.#configFile !== undefined && !this.#userHasZellijConfig(env)) {
			env.ZELLIJ_CONFIG_FILE = this.#configFile;
		}
		env.TERM = "xterm-256color";
		env.COLORTERM = "truecolor";
		env.HOME ??= this.#home();
		if (env.SHELL === undefined || env.SHELL.length === 0) env.SHELL = this.#loginShell();
		if (env.LANG === undefined && env.LC_ALL === undefined) env.LANG = "C.UTF-8";
		// A system service has no session, so no runtime directory; zellij keeps its sockets in it, and the user's own
		// zellij does too, so both see the same sessions.
		const runtime = this.#runtimeDir();
		if (runtime !== undefined) {
			env.XDG_RUNTIME_DIR = runtime;
			env.DBUS_SESSION_BUS_ADDRESS ??= `unix:path=${runtime}/bus`;
		}
		return env;
	}

	/** Whether zellij would find a config of the user's own. */
	#userHasZellijConfig(env: Record<string, string>): boolean {
		const candidates = [
			env.ZELLIJ_CONFIG_DIR === undefined ? undefined : join(env.ZELLIJ_CONFIG_DIR, "config.kdl"),
			join(env.XDG_CONFIG_HOME ?? join(this.#home(), ".config"), "zellij", "config.kdl"),
			join(this.#home(), ".config", "zellij", "config.kdl"),
		];
		return candidates.some((file) => file !== undefined && existsSync(file));
	}

	/** Write the harness's zellij config the first time it is needed. */
	async #ensureConfig(): Promise<void> {
		const file = this.#env().ZELLIJ_CONFIG_FILE;
		if (file === undefined || file !== this.#configFile || existsSync(file)) return;
		await mkdir(dirname(file), { recursive: true });
		await Bun.write(file, HARNESS_ZELLIJ_CONFIG);
	}

	#loginShell(): string {
		try {
			const shell = userInfo().shell;
			if (shell !== null && shell.length > 0) return shell;
		} catch {
			// No passwd entry.
		}
		return "/bin/sh";
	}

	#runtimeDir(): string | undefined {
		const configured = this.#baseEnv.XDG_RUNTIME_DIR;
		if (configured !== undefined && configured.length > 0) return configured;
		const uid = process.getuid?.();
		if (uid === undefined) return undefined;
		const dir = `/run/user/${uid}`;
		return existsSync(dir) ? dir : undefined;
	}

	async #run(command: string[], timeoutMs = COMMAND_TIMEOUT_MS): Promise<CommandResult> {
		let child: Bun.Subprocess<"ignore", "pipe", "pipe">;
		try {
			child = Bun.spawn(command, { env: this.#env(), stdin: "ignore", stdout: "pipe", stderr: "pipe" });
		} catch (error) {
			return { code: 127, stdout: "", stderr: errorMessage(error) };
		}
		const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
		try {
			const [stdout, stderr, code] = await Promise.all([
				new Response(child.stdout).text(),
				new Response(child.stderr).text(),
				child.exited,
			]);
			return { code, stdout, stderr };
		} finally {
			clearTimeout(timer);
		}
	}

	/** Whether a terminal can be opened here, and whether its zellij server would survive this process. */
	async availability(): Promise<TerminalAvailability> {
		if (this.#multiplexer === "none") {
			return { available: true, multiplexer: "none", survivesRestart: false };
		}
		const zellij = this.#zellij();
		if (zellij === undefined) {
			return {
				available: false,
				multiplexer: "zellij",
				reason:
					"zellij is not installed on this backend (it is not on the server's PATH or in ~/.local/bin). Install zellij there, or set AIKI_ZELLIJ to its path.",
				survivesRestart: false,
			};
		}
		await this.#ensureConfig().catch((error: unknown) => this.#log(`terminals: could not write ${this.#configFile ?? "the zellij config"}: ${errorMessage(error)}`));
		const version = await this.#run([zellij, "--version"], 5_000);
		if (version.code !== 0) {
			return {
				available: false,
				multiplexer: "zellij",
				reason: `zellij did not start on this backend: ${(version.stderr || version.stdout).trim().slice(0, 200) || `exit code ${version.code}`}`,
				survivesRestart: false,
			};
		}
		return {
			available: true,
			multiplexer: "zellij",
			version: version.stdout.trim().replace(/^zellij\s+/, ""),
			survivesRestart: await this.#canMoveOutOfService(),
		};
	}

	/** Whether `systemd-run --user --scope` works from here: a running user manager and the tool. Cached for a minute. */
	async #canMoveOutOfService(): Promise<boolean> {
		if (this.#survive === "off") return false;
		const now = Date.now();
		if (this.#scope !== undefined && now - this.#scope.at < SCOPE_PROBE_TTL_MS) return this.#scope.usable;
		const systemdRun = Bun.which("systemd-run", { PATH: this.#env().PATH ?? "" });
		let usable = false;
		if (systemdRun !== null && this.#runtimeDir() !== undefined) {
			const probe = await this.#run([systemdRun, "--user", "--scope", "--quiet", "--collect", "--", "true"], 5_000);
			usable = probe.code === 0;
			if (!usable) this.#log(`terminals: systemd-run --user --scope does not work here (${probe.stderr.trim().slice(0, 160)}); sessions will not survive a restart`);
		}
		this.#scope = { at: now, usable };
		return usable;
	}

	/** Every session zellij knows: running ones and exited ones it can resurrect. */
	async listSessions(): Promise<SessionListing[]> {
		if (this.#multiplexer === "none") return [];
		const zellij = this.#zellij();
		if (zellij === undefined) return [];
		const result = await this.#run([zellij, "list-sessions", "--no-formatting"]);
		// "No active zellij sessions found." exits 1.
		const sessions: SessionListing[] = [];
		for (const line of result.stdout.split("\n")) {
			const match = /^(.+?) \[Created (.+?) ago\](?: \((EXITED)[^)]*\))?\s*$/.exec(line.trim());
			if (match === null) continue;
			sessions.push({ name: match[1]!, exited: match[3] !== undefined, created: match[2]! });
		}
		return sessions;
	}

	/**
	 * Attach a terminal. A new session is created without `session`, or when the named one does not exist. Openings are
	 * serialised so two new sessions never pick the same name.
	 */
	open(request: OpenTerminal, sink: TerminalSink): Promise<TerminalAttachment> {
		const run = this.#opening.then(() => this.#open(request, sink));
		this.#opening = run.catch(() => undefined);
		return run;
	}

	async #open(request: OpenTerminal, sink: TerminalSink): Promise<TerminalAttachment> {
		if (this.#stopped) throw new ServerError("terminal_unavailable", "The server is shutting down");
		const availability = await this.availability();
		if (!availability.available) throw new ServerError("terminal_unavailable", availability.reason ?? "Terminals are not available on this backend");
		if (this.#attachments.size >= this.limits.perServer) {
			throw new ServerError("terminal_limit", `This backend already has ${this.limits.perServer} terminals attached; close one first`);
		}
		const cwd = await this.#directory(request.cwd);
		const cols = clampSize(request.cols, TERMINAL_MAX_COLS);
		const rows = clampSize(request.rows, TERMINAL_MAX_ROWS);

		let session: string;
		let command: string[];
		let created = false;
		if (this.#multiplexer === "none") {
			session = request.session ?? `${terminalPrefix(request.prefix ?? "term")}-${this.#attachments.size + 1}`;
			command = [...(this.#command ?? [this.#env().SHELL ?? "/bin/sh"])];
			created = true;
		} else {
			const zellij = this.#zellij()!;
			const known = await this.listSessions();
			if (request.session !== undefined) {
				session = request.session;
				const existing = known.find((entry) => entry.name === session);
				created = existing === undefined;
				// A session that has to be (re)started gets its server outside this service; attaching to a live one only
				// needs a client, which dies with this process, and that is what detaching is.
				command = [zellij, "attach", "--create", session];
				if (existing === undefined || existing.exited) command = this.#outsideService(availability, command);
			} else {
				session = this.#newSessionName(request.prefix, known);
				created = true;
				command = this.#outsideService(availability, [zellij, "attach", "--create", session]);
			}
		}

		const attachment = new TerminalAttachment({
			session,
			created,
			command,
			cwd,
			cols,
			rows,
			env: this.#env(),
			sink,
			windowBytes: this.#windowBytes,
			pendingLimitBytes: this.#pendingLimit,
			flushMs: this.#flushMs,
			repaint: this.#multiplexer === "zellij",
			holdInputUntilRaw: this.#multiplexer === "zellij",
			onEnd: (ended) => this.#attachments.delete(ended),
			log: this.#log,
		});
		this.#attachments.add(attachment);
		// Do not probe a booting server with list-sessions. Zellij 0.45.1 handles that probe's disconnect before
		// session_data exists and panics (RemoveClient in zellij-server/src/lib.rs). Its first screen is the readiness
		// event: the session exists by then, without creating and dropping another client during initialization.
		if (this.#multiplexer === "zellij" && created) {
			try {
				await attachment.waitForRender();
			} catch (error) {
				await attachment.detach();
				throw error;
			}
		}
		return attachment;
	}

	#outsideService(availability: TerminalAvailability, command: string[]): string[] {
		if (!availability.survivesRestart) return command;
		const systemdRun = Bun.which("systemd-run", { PATH: this.#env().PATH ?? "" });
		if (systemdRun === null) return command;
		return [systemdRun, "--user", "--scope", "--quiet", "--collect", "--description=aiki terminal session", "--", ...command];
	}

	#newSessionName(prefix: string | undefined, known: readonly SessionListing[]): string {
		const base = terminalPrefix(prefix ?? "term").slice(0, TERMINAL_SESSION_NAME_MAX - 8);
		const taken = new Set(known.map((entry) => entry.name));
		for (let number = 1; ; number += 1) {
			const name = `${base}-${number}`;
			if (!taken.has(name)) return name;
		}
	}

	async #directory(cwd: string | undefined): Promise<string> {
		if (cwd === undefined) return this.#home();
		try {
			if ((await stat(cwd)).isDirectory()) return cwd;
		} catch {
			// Reported below.
		}
		throw new ServerError("invalid_path", `Not a directory on this backend: ${cwd}`);
	}

	/**
	 * End a session. Any attachment to it (here) is closed with reason `killed` first, then zellij stops its processes
	 * and forgets it. The session has to exist (running or exited).
	 */
	async kill(session: string): Promise<void> {
		if (this.#multiplexer === "none") {
			throw new ServerError("unknown_terminal", "This backend has no sessions to end (plain shell mode)");
		}
		if (session.startsWith("-") || session.includes("/") || /[\u0000-\u001f]/.test(session)) {
			throw new ServerError("bad_request", "Not a session name");
		}
		const zellij = this.#zellij();
		if (zellij === undefined) throw new ServerError("terminal_unavailable", "zellij is not installed on this backend");
		const known = await this.listSessions();
		if (!known.some((entry) => entry.name === session)) {
			throw new ServerError("unknown_terminal", `No session named "${session}" on this backend`);
		}
		for (const attachment of [...this.#attachments]) {
			if (attachment.session === session) attachment.endWith({ reason: "killed" });
		}
		const killed = await this.#run([zellij, "kill-session", session]);
		const deleted = await this.#run([zellij, "delete-session", "--force", session]);
		if (deleted.code !== 0 && killed.code !== 0) {
			throw new ServerError("internal", `zellij could not end "${session}": ${(deleted.stderr || killed.stderr).trim().slice(0, 200)}`);
		}
	}

	/** Detach everything (the server is stopping). Sessions keep running. */
	async stop(): Promise<void> {
		this.#stopped = true;
		await Promise.all([...this.#attachments].map((attachment) => attachment.detach()));
	}
}

type AttachmentOptions = {
	session: string;
	created: boolean;
	command: string[];
	cwd: string;
	cols: number;
	rows: number;
	env: Record<string, string>;
	sink: TerminalSink;
	windowBytes: number;
	pendingLimitBytes: number;
	flushMs: number;
	repaint: boolean;
	/** Hold input until the program in the PTY has put it in raw mode (zellij discards what was typed before). */
	holdInputUntilRaw: boolean;
	onEnd: (attachment: TerminalAttachment) => void;
	log: (message: string) => void;
};

/** One PTY and the process in it. */
export class TerminalAttachment {
	readonly session: string;
	readonly created: boolean;
	cols: number;
	rows: number;

	readonly #options: AttachmentOptions;
	readonly #process: Bun.Subprocess;
	readonly #pending: Uint8Array[] = [];
	#pendingBytes = 0;
	#inFlight = 0;
	#timer: ReturnType<typeof setTimeout> | undefined;
	#dropping = false;
	#droppedSince = 0;
	#lastDataAt = 0;
	#lastResyncAt = 0;
	#ended: TerminalClosed | undefined;
	#finished = false;
	#detached = false;
	#exited = false;
	#eof = false;
	/** Input typed before the program was ready, written once it is. */
	#heldInput: Uint8Array[] | undefined;
	#heldBytes = 0;
	#rawPoll: ReturnType<typeof setInterval> | undefined;
	#rendered = false;
	#renderTail = "";
	readonly #firstRender = Promise.withResolvers<void>();

	constructor(options: AttachmentOptions) {
		this.#options = options;
		this.session = options.session;
		this.created = options.created;
		this.cols = options.cols;
		this.rows = options.rows;
		const [file, ...args] = options.command;
		this.#process = Bun.spawn([file!, ...args], {
			cwd: options.cwd,
			env: options.env,
			terminal: {
				cols: options.cols,
				rows: options.rows,
				data: (_terminal, data) => this.#onData(data),
				exit: () => {
					this.#eof = true;
					this.#maybeFinish();
				},
			},
		});
		if (options.holdInputUntilRaw) this.#heldInput = [];
		void this.#process.exited.then((code) => {
			this.#exited = true;
			this.#firstRender.resolve();
			this.#ended ??= { reason: "exited", exitCode: code };
			// The PTY's last bytes arrive before its EOF; wait for it, but not for long.
			setTimeout(() => {
				this.#eof = true;
				this.#maybeFinish();
			}, 150).unref?.();
			this.#maybeFinish();
		});
	}

	get pid(): number {
		return this.#process.pid;
	}

	/** Output bytes sent and not yet acknowledged (for tests). */
	get inFlightBytes(): number {
		return this.#inFlight;
	}

	/** Output bytes waiting for the window (for tests). */
	get pendingBytes(): number {
		return this.#pendingBytes;
	}

	/** The client has ended (it exited, was killed or detached). */
	get ended(): boolean {
		return this.#finished || this.#exited || this.#detached;
	}

	get dropping(): boolean {
		return this.#dropping;
	}

	/** A new zellij server has initialized once its client draws the first screen, not merely when its socket exists. */
	async waitForRender(): Promise<void> {
		let timer: ReturnType<typeof setTimeout> | undefined;
		try {
			await Promise.race([
				this.#firstRender.promise,
				new Promise<never>((_resolve, reject) => {
					// Includes a service-manager round trip, server startup and the first shell on a loaded backend.
					timer = setTimeout(() => reject(new ServerError("terminal_unavailable", "Timed out starting zellij")), 30_000);
				}),
			]);
			if (this.ended) throw new ServerError("terminal_unavailable", "Zellij exited before drawing its session");
		} finally {
			clearTimeout(timer);
		}
	}

	/** Type into the PTY. */
	write(bytes: Uint8Array | string): void {
		if (this.#finished || this.#detached || this.#process.terminal === undefined) return;
		if (this.#heldInput !== undefined) {
			// zellij's client throws away whatever was typed before it switched the terminal to raw mode, so what arrives
			// until then (a reattach that types at once) waits here instead of being lost.
			const chunk = typeof bytes === "string" ? new TextEncoder().encode(bytes) : bytes;
			if (this.#heldBytes + chunk.length <= HELD_INPUT_LIMIT) {
				this.#heldInput.push(chunk);
				this.#heldBytes += chunk.length;
			}
			this.#pollRaw();
			return;
		}
		this.#process.terminal.write(bytes);
	}

	/** Watch the PTY's line discipline; when the client leaves canonical mode it is reading keys, so held input goes in. */
	#pollRaw(): void {
		if (this.#rawPoll !== undefined) return;
		const started = Date.now();
		const check = (): void => {
			const terminal = this.#process.terminal;
			if (terminal === undefined || this.#finished || this.#detached) return this.#stopRawPoll();
			// Raw mode alone is not enough: the client switches early, but only reads keys once the server has drawn
			// the session, which is its first full-screen write.
			const ready = (terminal.localFlags & CANONICAL_MODE) === 0 && this.#rendered;
			if (ready || Date.now() - started > HELD_INPUT_MAX_MS) {
				const held = this.#heldInput ?? [];
				this.#heldInput = undefined;
				this.#stopRawPoll();
				for (const chunk of held) terminal.write(chunk);
			}
		};
		this.#rawPoll = setInterval(check, 10);
		check();
	}

	#stopRawPoll(): void {
		if (this.#rawPoll !== undefined) clearInterval(this.#rawPoll);
		this.#rawPoll = undefined;
	}

	resize(cols: number, rows: number): void {
		cols = clampSize(cols, TERMINAL_MAX_COLS);
		rows = clampSize(rows, TERMINAL_MAX_ROWS);
		this.cols = cols;
		this.rows = rows;
		if (this.#finished || this.#detached) return;
		this.#process.terminal?.resize(cols, rows);
	}

	/** The client has processed `bytes` of output: more may be sent. */
	ack(bytes: number): void {
		this.#inFlight = Math.max(0, this.#inFlight - bytes);
		if (this.#pendingBytes > 0 || this.#dropping || this.#ended !== undefined) this.#schedule(0);
	}

	/** Stop this client; the session and its processes keep running. No `closed` is reported. */
	async detach(): Promise<void> {
		if (this.#detached) return;
		this.#detached = true;
		this.#clear();
		await this.#stopProcess();
		this.#finish();
	}

	/** End the client for a reason the host knows (the session was killed); reported as `closed` after the output. */
	endWith(info: TerminalClosed): void {
		this.#ended = info;
		void this.#stopProcess();
	}

	async #stopProcess(): Promise<void> {
		if (this.#exited) return;
		// SIGHUP is what closing a terminal window does; zellij's client leaves and the server carries on.
		this.#process.kill("SIGHUP");
		const killer = setTimeout(() => this.#process.kill("SIGKILL"), 2_000);
		try {
			await this.#process.exited;
		} finally {
			clearTimeout(killer);
		}
	}

	#onData(data: Uint8Array): void {
		if (this.#detached || this.#finished) return;
		if (!this.#rendered) {
			const output = this.#renderTail + new TextDecoder().decode(data);
			this.#rendered = output.includes(FIRST_SCREEN_CLEAR);
			this.#renderTail = output.slice(-(FIRST_SCREEN_CLEAR.length - 1));
			if (this.#rendered) this.#firstRender.resolve();
		}
		this.#lastDataAt = Date.now();
		if (this.#dropping) return;
		this.#pending.push(data);
		this.#pendingBytes += data.length;
		if (this.#pendingBytes > this.#options.pendingLimitBytes) {
			// The client cannot keep up: keep the memory bounded, and repaint once it has caught up. What the window
			// still allows goes out first, so the client sees the screen it had.
			this.#sendWithinWindow();
			this.#pending.length = 0;
			this.#pendingBytes = 0;
			this.#dropping = true;
			this.#droppedSince = Date.now();
			this.#schedule(50);
			return;
		}
		this.#schedule(this.#pendingBytes >= TERMINAL_MAX_OUTPUT_FRAME_BYTES ? 0 : this.#options.flushMs);
	}

	#schedule(delayMs: number): void {
		if (this.#timer !== undefined || this.#finished || this.#detached) return;
		this.#timer = setTimeout(() => {
			this.#timer = undefined;
			this.#flush();
		}, delayMs);
	}

	#clear(): void {
		this.#stopRawPoll();
		if (this.#timer !== undefined) clearTimeout(this.#timer);
		this.#timer = undefined;
		this.#pending.length = 0;
		this.#pendingBytes = 0;
	}

	#flush(): void {
		if (this.#finished || this.#detached) return;
		const { windowBytes, sink } = this.#options;
		if (this.#dropping) {
			const now = Date.now();
			const caughtUp = this.#inFlight <= windowBytes / 4;
			const quiet = now - this.#lastDataAt >= 150;
			// During a flood, repaint at most once a second; when it stops, at once.
			if (caughtUp && (quiet || (now - this.#droppedSince >= 1_000 && now - this.#lastResyncAt >= 1_000))) {
				this.#dropping = false;
				this.#lastResyncAt = now;
				sink.resync();
				this.#repaint();
			} else {
				this.#schedule(50);
			}
			return;
		}
		this.#sendWithinWindow();
		if (this.#pendingBytes === 0) this.#maybeFinish();
		// What is left waits for an ack, which schedules the next flush.
	}

	/** Send queued output in frames until the unacked window is full. */
	#sendWithinWindow(): void {
		const { windowBytes, sink } = this.#options;
		while (this.#pendingBytes > 0 && this.#inFlight < windowBytes) {
			const frame = this.#take(Math.min(TERMINAL_MAX_OUTPUT_FRAME_BYTES, windowBytes - this.#inFlight));
			this.#inFlight += frame.length;
			sink.output(frame);
		}
	}

	/** Up to `limit` bytes from the front of the queue, as one buffer. */
	#take(limit: number): Uint8Array {
		const size = Math.min(limit, this.#pendingBytes);
		const frame = new Uint8Array(size);
		let filled = 0;
		while (filled < size) {
			const chunk = this.#pending[0]!;
			const room = size - filled;
			if (chunk.length <= room) {
				frame.set(chunk, filled);
				filled += chunk.length;
				this.#pending.shift();
			} else {
				frame.set(chunk.subarray(0, room), filled);
				this.#pending[0] = chunk.subarray(room);
				filled += room;
			}
		}
		this.#pendingBytes -= size;
		return frame;
	}

	/** zellij redraws the whole screen when its client's size changes: bounce the size by one column. */
	#repaint(): void {
		if (!this.#options.repaint || this.#finished) return;
		const { cols, rows } = this;
		const narrower = cols > 1 ? cols - 1 : cols + 1;
		this.#process.terminal?.resize(narrower, rows);
		setTimeout(() => {
			if (!this.#finished && !this.#detached) this.#process.terminal?.resize(this.cols, this.rows);
		}, 60).unref?.();
	}

	#maybeFinish(): void {
		if (this.#finished || this.#detached) return;
		if (this.#ended === undefined || !this.#exited || !this.#eof) return;
		if (this.#pendingBytes > 0 && !this.#dropping) {
			// The rest of the output goes first; an ack (or the next flush) brings us back here.
			this.#schedule(0);
			return;
		}
		const info = this.#ended;
		this.#finish();
		this.#options.sink.closed(info);
	}

	#finish(): void {
		if (this.#finished) return;
		this.#finished = true;
		this.#clear();
		try {
			this.#process.terminal?.close();
		} catch {
			// Closed already.
		}
		this.#options.onEnd(this);
	}
}
