import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ReleaseUpdateState, SelfUpdateState, ServerUpdateRequest } from "@kemiri/protocol";
import type { ToolCallDrain } from "./drain.ts";
import { ServerError } from "./errors.ts";

export const SELF_UPDATE_FILE = "self-update.json";
export const updateInProgress = (phase: string): boolean => ["preparing", "waiting", "restarting", "checking"].includes(phase);
export function readSelfUpdate(root: string): SelfUpdateState | undefined {
	try {
		const raw = JSON.parse(readFileSync(join(root, SELF_UPDATE_FILE), "utf8"));
		if (raw.schemaVersion === 1 && typeof raw.enabled === "boolean" &&
			(raw.disabledReason === null || typeof raw.disabledReason === "string") &&
			["idle", "preparing", "waiting", "restarting", "checking", "succeeded", "rolled_back", "failed", "cancelled"].includes(raw.phase) &&
			["attempt", "fromVersion", "toVersion", "notesUrl", "message"].every(key => typeof raw[key] === "string") &&
			Number.isSafeInteger(raw.agents) && raw.agents >= 0) return raw;
	} catch { /* No transaction yet. */ }
	return undefined;
}
export function writeSelfUpdate(root: string, state: SelfUpdateState): void {
	const path = join(root, SELF_UPDATE_FILE);
	const temporary = `${path}.${process.pid}.incoming`;
	writeFileSync(temporary, JSON.stringify(state, null, 2), { mode: 0o600 });
	renameSync(temporary, path);
}

export function selfUpdateDisabledReason(env: Readonly<Record<string, string | undefined>>, deployed: boolean): string | null {
	if (deployed || env.AIKI_DEPLOY_STATUS_FILE) return "This backend is managed by the deploy watcher.";
	const root = env.AIKI_INSTALL_DIR;
	if (!root || !env.AIKI_INSTALLED_VERSION || env.AIKI_INSTALLED_VERSION.startsWith("ref-")) return "Self-update is only available for installed releases, not development checkouts.";
	try {
		const installed = JSON.parse(readFileSync(join(root, ".aiki-install.json"), "utf8"));
		if (installed.root !== root || installed.version !== env.AIKI_INSTALLED_VERSION || readFileSync(join(root, ".aiki-managed"), "utf8").trim() !== "aiki-installer-v1") return "Installation identity could not be verified.";
	} catch { return "Installation identity could not be verified."; }
	if (env.AIKI_UPDATE_SUPERVISED !== "1" || !existsSync(join(root, "supervisor.pid"))) return "Restart with the updated aiki start command to enable self-update.";
	return null;
}

type SelfUpdateOptions = {
	root?: string;
	disabledReason: string | null;
	updates: () => ReleaseUpdateState;
	drain: ToolCallDrain;
	waitTimeoutMs?: number;
	now?: () => number;
	stage: (version: string, channel: string) => Promise<void>;
	onChange: () => void;
	log: (message: string) => void;
};

/** Backend owns preparation/wait; the installed supervisor owns restart/health/rollback. */
export class SelfUpdate {
	readonly #options: SelfUpdateOptions;
	#state: SelfUpdateState;
	#poll: ReturnType<typeof setInterval>;
	#ticking = false;
	#closed = false;
	#release: (() => void) | undefined;
	#waitingSince = 0;
	constructor(options: SelfUpdateOptions) {
		this.#options = options;
		this.#state = { schemaVersion: 1, enabled: options.disabledReason === null, disabledReason: options.disabledReason,
			phase: "idle", attempt: "", fromVersion: options.updates().installedVersion ?? "dev", toVersion: "", notesUrl: "", agents: 0, message: "" };
		if (options.root && !options.disabledReason) {
			const saved = readSelfUpdate(options.root);
			if (saved) this.#state = saved;
			// Supervisor recovers switch/check phases before starting us. Preparation is safe to retry.
			if (["preparing", "waiting"].includes(this.#state.phase)) this.#set({ phase: "cancelled", message: "Update interrupted before switching releases. Try again." });
		}
		this.#poll = setInterval(() => { void this.tick().catch(error => this.#fail(error)); }, 500);
		this.#poll.unref();
	}
	get state(): SelfUpdateState {
		const saved = this.#options.root && !this.#options.disabledReason ? readSelfUpdate(this.#options.root) : undefined;
		return { ...(saved ?? this.#state), enabled: this.#options.disabledReason === null, disabledReason: this.#options.disabledReason };
	}
	get holding(): boolean { return ["restarting", "checking"].includes(this.state.phase); }
	async request(request: Pick<ServerUpdateRequest, "action" | "version">, actor: string): Promise<SelfUpdateState> {
		if (this.#options.disabledReason) throw new ServerError("bad_request", this.#options.disabledReason);
		if (request.action === "start") {
			if (updateInProgress(this.state.phase)) throw new ServerError("bad_request", "An update is already in progress");
			const updates = this.#options.updates();
			const target = updates.available;
			if (!updates.enabled || !target || target.version !== request.version || !/^v?[0-9]+\.[0-9]+\.[0-9]+(?:-[a-zA-Z0-9.-]+)?$/.test(target.version)) throw new ServerError("bad_request", "The available release changed. Review it and confirm again.");
			this.#set({ phase: "preparing", attempt: crypto.randomUUID(), fromVersion: updates.installedVersion!, toVersion: target.version, notesUrl: target.notesUrl, agents: 0, toolCalls: 0, restartAllowed: false, message: "Downloading and verifying release…" });
			this.#options.log(`self-update: start ${this.#state.fromVersion} -> ${target.version} by session ${actor}`);
			void this.#prepare(target.version, updates.channel);
		} else {
			if (this.state.phase !== "waiting" || request.version !== this.state.toVersion) throw new ServerError("bad_request", "This update is no longer waiting");
			this.#options.log(`self-update: ${request.action} ${request.version} by session ${actor}`);
			if (request.action === "cancel") {
				this.#release?.(); this.#release = undefined;
				this.#set({ phase: "cancelled", restartAllowed: false, message: "Update cancelled. Running release unchanged." });
			} else {
				if (!this.#state.restartAllowed) throw new ServerError("bad_request", "Running commands have not reached the wait limit");
				this.#switch(true);
			}
		}
		return this.state;
	}
	async #prepare(version: string, channel: string): Promise<void> {
		try {
			await this.#options.stage(version, channel);
			if (!this.#closed) {
				this.#release = this.#options.drain.acquire();
				this.#waitingSince = (this.#options.now ?? Date.now)();
				this.#set({ phase: "waiting", message: "Waiting for running commands…" });
				await this.tick();
			}
		} catch (error) { if (!this.#closed) this.#fail(error); }
	}
	async tick(): Promise<void> {
		if (this.#closed || this.#ticking) return;
		const persisted = this.state;
		if (["checking", "succeeded", "rolled_back", "failed"].includes(persisted.phase) && JSON.stringify(persisted) !== JSON.stringify(this.#state)) {
			this.#state = persisted; this.#options.onChange();
		}
		if (this.#state.phase !== "waiting") return;
		this.#ticking = true;
		try { await this.#switch(false); } finally { this.#ticking = false; }
	}
	#switch(force: boolean): void {
		if (this.#state.phase !== "waiting") return;
		const toolCalls = this.#options.drain.toolCalls;
		if (!force && toolCalls) {
			const now = (this.#options.now ?? Date.now)();
			const restartAllowed = now - this.#waitingSince >= (this.#options.waitTimeoutMs ?? 300_000);
			const commands = this.#options.drain.runningCommands.map(call => {
				const seconds = Math.max(0, Math.floor((now - call.started) / 1000));
				return `${call.label}, ${seconds >= 60 ? `${Math.floor(seconds / 60)}m` : `${seconds}s`}`;
			}).join("; ");
			const message = `Waiting for ${toolCalls} running command${toolCalls === 1 ? "" : "s"}${commands ? ` (${commands})` : ""}…`;
			if (message !== this.#state.message || restartAllowed !== this.#state.restartAllowed) this.#set({ agents: 0, toolCalls, restartAllowed, message });
			return;
		}
		// The deploy's beforeTool hook is already holding: no new execution can race this synchronous check.
		this.#set({ phase: "restarting", agents: 0, toolCalls, restartAllowed: false, message: "Updating… Clients will reconnect automatically." });
	}
	#set(change: Partial<SelfUpdateState>): void {
		this.#state = { ...this.#state, ...change };
		if (this.#options.root) writeSelfUpdate(this.#options.root, this.#state);
		this.#options.onChange();
	}
	#fail(error: unknown): void {
		this.#release?.(); this.#release = undefined;
		this.#set({ phase: "failed", message: `Update failed before restart: ${error instanceof Error ? error.message : String(error)}` });
	}
	stop(): void { this.#closed = true; clearInterval(this.#poll); }
}
