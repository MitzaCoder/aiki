/**
 * A terminal attached through the client: one zellij session on the backend, its output as bytes, its input as bytes.
 *
 * The handle outlives the socket. When the connection drops it goes to `reconnecting`, and once the client is ready again it
 * attaches the same session by name; zellij repaints it, and `onReset` tells the consumer to clear its screen first. A
 * session that ended (the shell exited, the session was killed) is `ended` and is not reopened by itself.
 *
 * The consumer reports what it has *rendered* with `processed(bytes)`, which is what the server paces on; with
 * `autoAcknowledge` (the default) the handle acks as soon as the output listeners have returned.
 */
import {
	TERMINAL_MAX_INPUT_BYTES,
	type TerminalClosedEvent,
	type TerminalOpenResponse,
} from "@kemiri/protocol";
import { ClientError } from "./errors.ts";

export type TerminalStatus =
	/** The first attach is under way. */
	| "attaching"
	| "attached"
	/** The connection dropped (or the server restarted); the same session is attached again when it is back. */
	| "reconnecting"
	/** The session ended: the shell exited, it was detached from inside, or it was killed. */
	| "ended"
	/** It cannot be attached (no zellij, a limit, a bad folder); `error` says why. */
	| "failed"
	/** Closed by this client; the session keeps running on the backend. */
	| "detached";

export type TerminalState = {
	status: TerminalStatus;
	/** The session's name once it is known (a new session is named by the backend). */
	session?: string;
	/** Whether the last attach created the session (false: it was already there). */
	created?: boolean;
	error?: string;
	errorCode?: string;
	/** Why it ended, when status is `ended`. */
	endedReason?: TerminalClosedEvent["reason"];
	exitCode?: number;
};

export type TerminalOpenOptions = {
	/** Attach (or create) this session. Without it a new one is made from `prefix`. */
	session?: string;
	prefix?: string;
	/** Where a new session's first shell starts. */
	cwd?: string;
	cols: number;
	rows: number;
	/** Ack output as soon as the listeners returned. Set false to call `processed` after rendering. Default true. */
	autoAcknowledge?: boolean;
};

/** What a terminal needs from the client that owns it. */
export type TerminalHostApi = {
	isReady(): boolean;
	/** Called now and on every connection change; returns the unsubscribe. */
	subscribe(listener: (ready: boolean) => void): () => void;
	open(terminal: TerminalSession, request: { session?: string; prefix?: string; cwd?: string; cols: number; rows: number }): Promise<TerminalOpenResponse>;
	resize(terminalId: number, cols: number, rows: number): Promise<void>;
	close(terminalId: number): Promise<void>;
	/** Send input bytes for a terminal; false when the socket is not there. */
	sendInput(terminalId: number, bytes: Uint8Array): boolean;
	sendAck(terminalId: number, bytes: number): boolean;
	/** The handle is done with its slot. */
	release(terminal: TerminalSession, terminalId: number | undefined): void;
};

/** Errors that will not get better by trying again when the socket comes back. */
const FINAL_CODES = new Set(["terminal_unavailable", "terminal_limit", "invalid_path", "unknown_request", "bad_request"]);
const ACK_BATCH_BYTES = 16 * 1024;
const ACK_DELAY_MS = 25;

export class TerminalSession {
	readonly #host: TerminalHostApi;
	readonly #options: TerminalOpenOptions;
	readonly #stateListeners = new Set<(state: TerminalState) => void>();
	readonly #outputListeners = new Set<(bytes: Uint8Array) => void>();
	readonly #resetListeners = new Set<() => void>();
	readonly #encoder = new TextEncoder();
	#state: TerminalState = { status: "attaching" };
	#terminalId: number | undefined;
	#cols: number;
	#rows: number;
	#session: string | undefined;
	#attached = false;
	#attaching = false;
	#unsubscribe: (() => void) | undefined;
	#unacked = 0;
	#ackTimer: ReturnType<typeof setTimeout> | undefined;
	#stopped = false;

	constructor(host: TerminalHostApi, options: TerminalOpenOptions) {
		this.#host = host;
		this.#options = options;
		this.#cols = options.cols;
		this.#rows = options.rows;
		this.#session = options.session;
		if (options.session !== undefined) this.#state = { status: "attaching", session: options.session };
	}

	/** Begin attaching, and keep the session attached across reconnects. Called by the client. */
	start(): void {
		this.#unsubscribe = this.#host.subscribe((ready) => {
			if (this.#stopped) return;
			if (ready) void this.#attach();
			else this.#connectionLost();
		});
	}

	get state(): TerminalState {
		return this.#state;
	}

	get terminalId(): number | undefined {
		return this.#terminalId;
	}

	get cols(): number {
		return this.#cols;
	}

	get rows(): number {
		return this.#rows;
	}

	/** Called with every state change. Not called for the state at the moment of subscribing. */
	onState(listener: (state: TerminalState) => void): () => void {
		this.#stateListeners.add(listener);
		return () => this.#stateListeners.delete(listener);
	}

	/** Called with every batch of output bytes, in order. */
	onOutput(listener: (bytes: Uint8Array) => void): () => void {
		this.#outputListeners.add(listener);
		return () => this.#outputListeners.delete(listener);
	}

	/** The next output repaints the whole screen (a reattach, or the server dropped output): reset the emulator first. */
	onReset(listener: () => void): () => void {
		this.#resetListeners.add(listener);
		return () => this.#resetListeners.delete(listener);
	}

	/** Type into the terminal. False when it is not attached (what was typed is not kept). */
	write(data: string | Uint8Array): boolean {
		if (!this.#attached || this.#terminalId === undefined) return false;
		const bytes = typeof data === "string" ? this.#encoder.encode(data) : data;
		for (let offset = 0; offset < bytes.length; offset += TERMINAL_MAX_INPUT_BYTES) {
			if (!this.#host.sendInput(this.#terminalId, bytes.subarray(offset, offset + TERMINAL_MAX_INPUT_BYTES))) return false;
		}
		return true;
	}

	/** Tell the backend the terminal's size changed. Remembered for the next attach. */
	resize(cols: number, rows: number): void {
		if (cols === this.#cols && rows === this.#rows) return;
		this.#cols = cols;
		this.#rows = rows;
		if (this.#attached && this.#terminalId !== undefined) {
			void this.#host.resize(this.#terminalId, cols, rows).catch(() => undefined);
		}
	}

	/** The consumer has rendered `bytes` of output (see `autoAcknowledge`). */
	processed(bytes: number): void {
		this.#unacked += bytes;
		if (this.#unacked >= ACK_BATCH_BYTES) this.#flushAck();
		else this.#ackTimer ??= setTimeout(() => this.#flushAck(), ACK_DELAY_MS);
	}

	/** Stop this client's attachment. The session keeps running on the backend and can be attached again. */
	async detach(): Promise<void> {
		if (this.#stopped) return;
		this.#stopped = true;
		this.#unsubscribe?.();
		this.#clearAck();
		const id = this.#terminalId;
		this.#terminalId = undefined;
		this.#attached = false;
		this.#set({ ...this.#state, status: "detached" });
		this.#host.release(this, id);
		if (id !== undefined) await this.#host.close(id).catch(() => undefined);
	}

	// --- called by the client ------------------------------------------------------------------------------------

	/** @internal */
	receiveOutput(bytes: Uint8Array): void {
		if (this.#stopped) return;
		for (const listener of this.#outputListeners) {
			try {
				listener(bytes);
			} catch {
				// A consumer's listener must not break the stream.
			}
		}
		if (this.#options.autoAcknowledge !== false) this.processed(bytes.length);
	}

	/** @internal */
	receiveResync(): void {
		this.#reset();
	}

	/** @internal */
	receiveClosed(event: TerminalClosedEvent): void {
		if (this.#stopped) return;
		this.#attached = false;
		this.#terminalId = undefined;
		this.#clearAck();
		this.#stopped = true;
		this.#unsubscribe?.();
		this.#host.release(this, undefined);
		this.#set({
			status: "ended",
			...(this.#session === undefined ? {} : { session: this.#session }),
			endedReason: event.reason,
			...(event.exitCode === undefined ? {} : { exitCode: event.exitCode }),
			...(event.message === undefined ? {} : { error: event.message }),
		});
	}

	// --- internals ----------------------------------------------------------------------------------------------

	async #attach(): Promise<void> {
		if (this.#attaching || this.#attached || this.#stopped) return;
		this.#attaching = true;
		const reattach = this.#session !== undefined && this.#state.status === "reconnecting";
		try {
			const response = await this.#host.open(this, {
				...(this.#session === undefined ? {} : { session: this.#session }),
				...(this.#session === undefined && this.#options.prefix !== undefined ? { prefix: this.#options.prefix } : {}),
				...(this.#options.cwd === undefined ? {} : { cwd: this.#options.cwd }),
				cols: this.#cols,
				rows: this.#rows,
			});
			if (this.#stopped) {
				// Detached while the open was in flight: let the backend drop it again.
				void this.#host.close(response.terminalId).catch(() => undefined);
				return;
			}
			this.#terminalId = response.terminalId;
			this.#session = response.session;
			this.#attached = true;
			this.#unacked = 0;
			if (reattach) this.#reset();
			this.#set({ status: "attached", session: response.session, created: response.created });
			// The size may have changed while it was away.
			if (response.cols !== this.#cols || response.rows !== this.#rows) {
				void this.#host.resize(response.terminalId, this.#cols, this.#rows).catch(() => undefined);
			}
		} catch (error) {
			if (this.#stopped) return;
			const code = error instanceof ClientError ? error.code : undefined;
			if (code !== undefined && FINAL_CODES.has(code)) {
				this.#stopped = true;
				this.#unsubscribe?.();
				this.#host.release(this, undefined);
				this.#set({ status: "failed", ...(this.#session === undefined ? {} : { session: this.#session }), error: error instanceof Error ? error.message : String(error), errorCode: code });
			}
			// Anything else is a dropped connection or a timeout: the next `ready` tries again.
		} finally {
			this.#attaching = false;
		}
	}

	#connectionLost(): void {
		if (!this.#attached && !this.#attaching) return;
		this.#attached = false;
		this.#terminalId = undefined;
		this.#clearAck();
		this.#unacked = 0;
		this.#set({ ...this.#state, status: "reconnecting" });
	}

	#reset(): void {
		for (const listener of this.#resetListeners) {
			try {
				listener();
			} catch {
				// A consumer's listener must not break the stream.
			}
		}
	}

	#flushAck(): void {
		this.#clearAck();
		if (this.#unacked <= 0 || this.#terminalId === undefined) return;
		const bytes = this.#unacked;
		this.#unacked = 0;
		this.#host.sendAck(this.#terminalId, bytes);
	}

	#clearAck(): void {
		if (this.#ackTimer !== undefined) clearTimeout(this.#ackTimer);
		this.#ackTimer = undefined;
	}

	#set(state: TerminalState): void {
		this.#state = state;
		for (const listener of this.#stateListeners) {
			try {
				listener(state);
			} catch {
				// A consumer's listener must not break the connection.
			}
		}
	}
}
