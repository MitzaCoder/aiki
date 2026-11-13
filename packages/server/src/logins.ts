/**
 * OAuth subscription logins, run on the server and relayed to clients.
 *
 * pi-ai owns the flows: `models.login(providerId, "oauth", interaction)` asks questions and reports progress through a
 * provider-neutral interaction, and persists the credential through our `CredentialStore`. Here each login becomes a
 * server-owned session (`AuthLogin`) so it survives a page reload: prompts wait for any client to answer them, the
 * notification history travels with the session, and only an explicit cancel, a logout or an idle timeout aborts it.
 *
 * Answers (authorization codes, pasted redirect URLs, secrets) are held only in the pending prompt's promise. They are
 * never stored in the session, echoed to a client or logged.
 */
import type {
	AuthEvent as ProviderAuthEvent,
	AuthPrompt as ProviderAuthPrompt,
	Models,
} from "@earendil-works/pi-ai";
import type { AuthEvent, AuthLogin, AuthPrompt, AuthPromptOption } from "@kemiri/protocol";
import { ServerError, errorMessage } from "./errors.ts";

/** How many notifications a login keeps for a client that reloads late. */
const EVENT_HISTORY_LIMIT = 30;
/** How long a finished login stays listed, so a client that reconnects still sees the outcome. */
const FINISHED_RETENTION_MS = 5 * 60_000;
const DEFAULT_IDLE_TIMEOUT_MS = 10 * 60_000;

export type OAuthLoginManagerOptions = {
	models: Models;
	log?: (message: string) => void;
	/** Called after every change to a login, for broadcasting and tests. */
	onChange?: (login: AuthLogin) => void;
	/** Called when a login starts waiting for an answer, so the user's devices can say so. Never waited for. */
	onPrompt?: (login: AuthLogin) => void;
	/**
	 * Stable ID of this installation, for flows that identify the agent host (Sign in with ChatGPT). Called only by
	 * those flows.
	 */
	deviceId?: () => string | Promise<string>;
	/** How the app introduces itself to providers during login. */
	agentName?: string;
	/** A login with no client activity for this long is aborted. Default 10 minutes; 0 disables it. */
	idleTimeoutMs?: number;
	now?: () => number;
};

type PendingPrompt = {
	id: string;
	resolve(value: string): void;
	reject(error: Error): void;
};

type Session = {
	login: AuthLogin;
	controller: AbortController;
	prompt?: PendingPrompt;
	timer?: ReturnType<typeof setTimeout>;
};

function isFinished(login: AuthLogin): boolean {
	return login.status === "succeeded" || login.status === "failed" || login.status === "cancelled";
}

function wirePrompt(id: string, prompt: ProviderAuthPrompt): AuthPrompt {
	const options: AuthPromptOption[] | undefined =
		prompt.type === "select"
			? prompt.options.map((option) => ({
					id: option.id,
					label: option.label,
					...(option.description === undefined ? {} : { description: option.description }),
				}))
			: undefined;
	const placeholder = prompt.type === "select" ? undefined : prompt.placeholder;
	return {
		id,
		type: prompt.type,
		message: prompt.message,
		...(placeholder === undefined ? {} : { placeholder }),
		...(options === undefined ? {} : { options }),
	};
}

function wireEvent(event: ProviderAuthEvent): AuthEvent {
	switch (event.type) {
		case "info":
			return {
				type: "info",
				message: event.message,
				...(event.links === undefined
					? {}
					: { links: event.links.map((link) => ({ url: link.url, ...(link.label === undefined ? {} : { label: link.label }) })) }),
			};
		case "auth_url":
			return {
				type: "auth_url",
				url: event.url,
				...(event.instructions === undefined ? {} : { instructions: event.instructions }),
			};
		case "device_code":
			return {
				type: "device_code",
				userCode: event.userCode,
				verificationUri: event.verificationUri,
				...(event.intervalSeconds === undefined ? {} : { intervalSeconds: event.intervalSeconds }),
				...(event.expiresInSeconds === undefined ? {} : { expiresInSeconds: event.expiresInSeconds }),
			};
		case "progress":
			return { type: "progress", message: event.message };
	}
}

export class OAuthLoginManager {
	readonly #models: Models;
	readonly #log: (message: string) => void;
	readonly #onChange: ((login: AuthLogin) => void) | undefined;
	readonly #onPrompt: ((login: AuthLogin) => void) | undefined;
	readonly #deviceId: (() => string | Promise<string>) | undefined;
	readonly #agentName: string | undefined;
	readonly #idleTimeoutMs: number;
	readonly #now: () => number;
	readonly #sessions = new Map<string, Session>();
	#loginSequence = 0;
	#promptSequence = 0;

	constructor(options: OAuthLoginManagerOptions) {
		this.#models = options.models;
		this.#log = options.log ?? ((message) => console.log(message));
		this.#onChange = options.onChange;
		this.#onPrompt = options.onPrompt;
		this.#deviceId = options.deviceId;
		this.#agentName = options.agentName;
		this.#idleTimeoutMs = options.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS;
		this.#now = options.now ?? Date.now;
	}

	/** Every login this server knows, oldest first: running ones, plus finished ones kept for display. */
	list(): AuthLogin[] {
		this.#prune();
		return [...this.#sessions.values()].map((session) => session.login).sort((left, right) => left.startedAt - right.startedAt);
	}

	/** The running login for one provider, if any. */
	active(providerId: string): AuthLogin | undefined {
		for (const session of this.#sessions.values()) {
			if (session.login.providerId === providerId && !isFinished(session.login)) return session.login;
		}
		return undefined;
	}

	/** Start a login, or return the one already running for that provider so a reload rejoins it. */
	start(providerId: string): AuthLogin {
		const provider = this.#models.getProvider(providerId);
		if (provider === undefined) {
			throw new ServerError("unknown_provider", `Unknown provider "${providerId}"`);
		}
		if (provider.auth.oauth === undefined) {
			throw new ServerError("bad_request", `${provider.name} has no OAuth login; use an API key instead`);
		}
		const existing = this.active(providerId);
		if (existing !== undefined) return existing;

		this.#prune(true);
		const now = this.#now();
		const id = `login-${++this.#loginSequence}`;
		const session: Session = {
			controller: new AbortController(),
			login: {
				id,
				providerId,
				status: "working",
				events: [],
				startedAt: now,
				updatedAt: now,
			},
		};
		this.#sessions.set(id, session);
		this.#log(`login ${id} for ${providerId}: started`);
		this.#emit(session);
		void this.#run(session);
		return session.login;
	}

	/** Answer the login's current prompt. Rejects when it is unknown or already answered. */
	answer(loginId: string, promptId: string, value: string): AuthLogin {
		const session = this.#requireSession(loginId);
		if (isFinished(session.login)) {
			throw new ServerError("bad_request", "That login has already finished");
		}
		const prompt = session.prompt;
		if (prompt === undefined || prompt.id !== promptId) {
			throw new ServerError("bad_request", "That login is not waiting for this answer");
		}
		session.prompt = undefined;
		delete session.login.prompt;
		session.login.status = "working";
		prompt.resolve(value);
		this.#emit(session);
		return session.login;
	}

	/** Abort a running login. A finished login is left as it is and reported as not cancelled. */
	cancel(loginId: string): boolean {
		const session = this.#requireSession(loginId);
		if (isFinished(session.login)) return false;
		this.#log(`login ${loginId}: cancelled by a client`);
		// Finish before aborting: the abort wakes the provider, and the session must already look finished then.
		this.#finish(session, "cancelled");
		session.controller.abort(new Error("Login cancelled"));
		return true;
	}

	/** Abort every running login for one provider; used when its credential is removed. */
	cancelProvider(providerId: string): void {
		for (const session of [...this.#sessions.values()]) {
			if (session.login.providerId !== providerId || isFinished(session.login)) continue;
			this.#finish(session, "cancelled");
			session.controller.abort(new Error("Login cancelled"));
		}
	}

	/** Abort every running login; used when the server stops. Changes are not broadcast. */
	cancelAll(): void {
		for (const session of [...this.#sessions.values()]) {
			if (isFinished(session.login)) continue;
			this.#finish(session, "cancelled", undefined, { silent: true });
			session.controller.abort(new Error("Login cancelled"));
		}
	}

	async #run(session: Session): Promise<void> {
		try {
			const deviceId = this.#deviceId === undefined ? undefined : await this.#deviceId();
			await this.#models.login(
				session.login.providerId,
				"oauth",
				{
					signal: session.controller.signal,
					prompt: (prompt) => this.#ask(session, prompt),
					notify: (event) => this.#notify(session, event),
				},
				{
					...(deviceId === undefined ? {} : { getDeviceId: () => deviceId }),
					...(this.#agentName === undefined ? {} : { agentName: this.#agentName }),
				},
			);
			this.#finish(session, "succeeded");
		} catch (error) {
			if (session.controller.signal.aborted) {
				this.#finish(session, "cancelled");
				return;
			}
			const message = errorMessage(error);
			this.#log(`login ${session.login.id}: failed: ${message}`);
			this.#finish(session, "failed", message);
		}
	}

	#ask(session: Session, prompt: ProviderAuthPrompt): Promise<string> {
		session.controller.signal.throwIfAborted();
		const id = `${session.login.id}-prompt-${++this.#promptSequence}`;
		return new Promise<string>((resolve, reject) => {
			// A provider abandons a prompt when something else settles the step, for example a browser that reached the
			// callback server. Stop showing it, then let the flow continue.
			const onAbandon = (): void => {
				if (isFinished(session.login) || session.prompt?.id !== id) return;
				session.prompt = undefined;
				delete session.login.prompt;
				session.login.status = "working";
				this.#emit(session);
				reject(new Error("Login prompt abandoned"));
			};
			prompt.signal?.addEventListener("abort", onAbandon, { once: true });
			const cleanup = (): void => {
				prompt.signal?.removeEventListener("abort", onAbandon);
			};
			session.prompt = {
				id,
				resolve: (value) => {
					cleanup();
					resolve(value);
				},
				reject: (error) => {
					cleanup();
					reject(error);
				},
			};
			session.login.prompt = wirePrompt(id, prompt);
			session.login.status = "prompt";
			this.#log(`login ${session.login.id}: waiting for a ${prompt.type} answer`);
			this.#emit(session);
			if (this.#onPrompt !== undefined) {
				try {
					this.#onPrompt(structuredClone(session.login));
				} catch (error) {
					this.#log(`login ${session.login.id}: prompt listener failed: ${errorMessage(error)}`);
				}
			}
		});
	}

	#notify(session: Session, event: ProviderAuthEvent): void {
		if (isFinished(session.login)) return;
		session.login.events.push(wireEvent(event));
		if (session.login.events.length > EVENT_HISTORY_LIMIT) {
			session.login.events.splice(0, session.login.events.length - EVENT_HISTORY_LIMIT);
		}
		// Status stays as it is: a notification needs no answer, and the flow continues either way.
		this.#emit(session);
	}

	#finish(
		session: Session,
		status: "succeeded" | "failed" | "cancelled",
		error?: string,
		options: { silent?: boolean } = {},
	): void {
		if (isFinished(session.login)) return;
		if (session.timer !== undefined) {
			clearTimeout(session.timer);
			session.timer = undefined;
		}
		const prompt = session.prompt;
		session.prompt = undefined;
		delete session.login.prompt;
		// Settle the provider's prompt so the flow unwinds instead of hanging on a login that is over.
		prompt?.reject(new Error(error ?? "Login cancelled"));
		session.login.status = status;
		if (error !== undefined) session.login.error = error;
		this.#log(`login ${session.login.id}: ${status}${error === undefined ? "" : `: ${error}`}`);
		if (options.silent !== true) this.#emit(session);
	}

	#emit(session: Session): void {
		session.login.updatedAt = this.#now();
		this.#armIdleTimer(session);
		if (this.#onChange === undefined) return;
		try {
			this.#onChange(structuredClone(session.login));
		} catch (error) {
			this.#log(`login ${session.login.id}: change listener failed: ${errorMessage(error)}`);
		}
	}

	#armIdleTimer(session: Session): void {
		if (this.#idleTimeoutMs <= 0 || isFinished(session.login)) return;
		if (session.timer !== undefined) clearTimeout(session.timer);
		session.timer = setTimeout(() => this.#expire(session), this.#idleTimeoutMs);
		session.timer.unref?.();
	}

	#expire(session: Session): void {
		if (isFinished(session.login)) return;
		this.#log(`login ${session.login.id}: idle for ${this.#idleTimeoutMs}ms, aborting`);
		this.#finish(session, "failed", "The login timed out. Start it again.");
		session.controller.abort(new Error("Login timed out"));
	}

	#prune(removeFinished = false): void {
		const cutoff = this.#now() - FINISHED_RETENTION_MS;
		for (const [id, session] of this.#sessions) {
			if (!isFinished(session.login)) continue;
			if (removeFinished || session.login.updatedAt < cutoff) this.#sessions.delete(id);
		}
	}

	#requireSession(loginId: string): Session {
		const session = this.#sessions.get(loginId);
		if (session === undefined) throw new ServerError("unknown_login", `Unknown login "${loginId}"`);
		return session;
	}
}
