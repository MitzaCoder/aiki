/** Test harness: a real server on a free port, a faux pi-ai provider, and a WebSocket client. */
import { applyImmutable } from "@earendil-works/chord/delta";
import type { Op } from "@earendil-works/chord/delta";
import type { MutableModels } from "@earendil-works/pi-ai";
import { createModels } from "@earendil-works/pi-ai";
import { fauxProvider, type FauxProviderHandle } from "@earendil-works/pi-ai/providers/faux";
import type { ConversationView, ServerMessage } from "@aiki/protocol";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileCredentialStore } from "../src/credentials.ts";
import { startServer, type HarnessServer, type StartServerOptions } from "../src/server.ts";

export type TestSetup = {
	root: string;
	dataDir: string;
	projectDir: string;
	/** The agent directory the server reads AGENTS.md and skills from; a fresh one per test, never the host's. */
	agentDir: string;
	/** The harness's own config directory, where its SYSTEM.md and APPEND_SYSTEM.md live; fresh per test. */
	configDir: string;
	/** Claude Code's home, whose skills and plugins the server reads; fresh per test, never the host's. */
	claudeDir: string;
	faux: FauxProviderHandle;
	models: MutableModels;
	credentials: FileCredentialStore;
	server: HarnessServer;
	/** Start a second server over the same data directory, as after a restart. */
	restart(): Promise<HarnessServer>;
	cleanup(): Promise<void>;
};

export async function createSetup(options?: {
	updates?: StartServerOptions["updates"];
	/** Register extra providers, for example a fake OAuth provider, on the setup's models. */
	configureModels?: (models: MutableModels) => void;
	logins?: StartServerOptions["logins"];
	log?: StartServerOptions["log"];
	allowedOrigins?: StartServerOptions["allowedOrigins"];
	/** Installed SPA shell; still isolated under the fixture's owned paths. */
	webDir?: StartServerOptions["webDir"];
	features?: StartServerOptions["features"];
	/** Where the server reads AGENTS.md and skills; defaults to a directory under the test's own root. */
	agentDir?: string;
	/** Where the server reads its own SYSTEM.md and APPEND_SYSTEM.md; defaults to a directory under the test's root. */
	configDir?: string;
	/** Where the server reads Claude Code's skills and plugins; defaults to a directory under the test's root. */
	claudeDir?: string;
	/** A fake Harness clock, for the worker check-in timers; the same one is kept across a restart. */
	now?: StartServerOptions["now"];
	setTimer?: StartServerOptions["setTimer"];
	/** How long the user's board edits wait before they reach the coordinator as one input. */
	boardEditDebounceMs?: StartServerOptions["boardEditDebounceMs"];
	/** The timezone schedules run in; defaults to the host's, or `AIKI_TIMEZONE`. */
	timezone?: StartServerOptions["timezone"];
	/** Where the release and the deploy status are read from; defaults to what the running code discovers. */
	status?: StartServerOptions["status"];
	/** Web Push: the fake push service a test points the transport at, and the VAPID subject. */
	auth?: StartServerOptions["auth"];
	notifications?: StartServerOptions["notifications"];
	/** How long the coordinator's own bash/powershell calls may run; defaults to the server's own default. */
	toolCallCapMs?: StartServerOptions["toolCallCapMs"];
	/** Free disk space: a fake reader, the threshold and the poll interval. */
	disks?: StartServerOptions["disks"];
	/** When work_finished goes out: minimum work and how long the project must stay quiet. */
	workFinished?: StartServerOptions["workFinished"];
	/** Subscription usage reads: a fake HTTP server's URLs and short intervals. */
	subscriptionUsage?: StartServerOptions["subscriptionUsage"];
	/** Artifact limits, URL lifetime and the duration probe. */
	artifacts?: StartServerOptions["artifacts"];
	/** Event schedules: a fake `gh` and the poll interval. */
	githubReviews?: StartServerOptions["githubReviews"];
	/** Terminals: a plain-shell host, or zellij pointed at test-only sockets. */
	terminals?: StartServerOptions["terminals"];
}): Promise<TestSetup> {
	const root = await mkdtemp(join(tmpdir(), "aiki-test-"));
	const dataDir = join(root, "data");
	const projectDir = join(root, "project");
	await mkdir(projectDir, { recursive: true });
	await writeFile(join(projectDir, "README.md"), "# test project\n");

	const agentDir = options?.agentDir ?? join(root, "agent");
	await mkdir(agentDir, { recursive: true });
	const configDir = options?.configDir ?? join(root, "config", "aiki");
	await mkdir(configDir, { recursive: true });
	const claudeDir = options?.claudeDir ?? join(root, "claude");
	await mkdir(claudeDir, { recursive: true });
	const credentials = new FileCredentialStore(join(dataDir, "credentials.json"));
	const faux = fauxProvider();
	const models = createModels({ credentials });
	models.setProvider(faux.provider);
	options?.configureModels?.(models);

	const start = (): Promise<HarnessServer> =>
		startServer({
			dataDir,
			...(options?.updates === undefined ? {} : { updates: options.updates }),
			auth: options?.auth ?? { mode: "off" },
			port: 0,
			models,
			credentials,
			images: null,
			agentDir,
			configDir,
			claudeDir,
			...(options?.logins === undefined ? {} : { logins: options.logins }),
			...(options?.allowedOrigins === undefined ? {} : { allowedOrigins: options.allowedOrigins }),
			...(options?.webDir === undefined ? {} : { webDir: options.webDir }),
			...(options?.features === undefined ? {} : { features: options.features }),
			...(options?.now === undefined ? {} : { now: options.now }),
			...(options?.setTimer === undefined ? {} : { setTimer: options.setTimer }),
			...(options?.boardEditDebounceMs === undefined ? {} : { boardEditDebounceMs: options.boardEditDebounceMs }),
			...(options?.timezone === undefined ? {} : { timezone: options.timezone }),
			...(options?.status === undefined ? {} : { status: options.status }),
			notifications: { fcmKeyFile: null, relayEndpoint: null, ...options?.notifications },
			...(options?.toolCallCapMs === undefined ? {} : { toolCallCapMs: options.toolCallCapMs }),
			...(options?.workFinished === undefined ? {} : { workFinished: options.workFinished }),
			...(options?.disks === undefined ? {} : { disks: options.disks }),
			...(options?.subscriptionUsage === undefined ? {} : { subscriptionUsage: options.subscriptionUsage }),
			...(options?.artifacts === undefined ? {} : { artifacts: options.artifacts }),
			...(options?.githubReviews === undefined ? {} : { githubReviews: options.githubReviews }),
			...(options?.terminals === undefined ? {} : { terminals: options.terminals }),
			log: options?.log ?? (() => undefined),
		});

	let server = await start();
	const setup: TestSetup = {
		root,
		dataDir,
		projectDir,
		agentDir,
		configDir,
		claudeDir,
		faux,
		models,
		credentials,
		get server() {
			return server;
		},
		async restart() {
			await server.stop();
			server = await start();
			return server;
		},
		async cleanup() {
			await server.stop().catch(() => undefined);
			await rm(root, { recursive: true, force: true });
		},
	};
	return setup;
}

type Pending = { resolve: (message: ServerMessage) => void };

export class TestClient {
	readonly #socket: WebSocket;
	readonly #messages: ServerMessage[] = [];
	readonly #pending = new Map<string, Pending>();
	#sequence = 0;
	#stopped = false;
	readonly #listeners = new Set<(message: ServerMessage) => void>();
	readonly #binary: Uint8Array[] = [];
	readonly #binaryListeners = new Set<(frame: Uint8Array) => void>();

	private constructor(socket: WebSocket) {
		this.#socket = socket;
		socket.binaryType = "arraybuffer";
		socket.addEventListener("close", () => {
			this.#stopped = true;
		});
		socket.addEventListener("message", (event) => {
			if (typeof event.data !== "string") {
				const frame = new Uint8Array(event.data as ArrayBuffer);
				this.#binary.push(frame);
				for (const listener of this.#binaryListeners) listener(frame);
				return;
			}
			const message = JSON.parse(String(event.data)) as ServerMessage;
			this.#messages.push(message);
			const id = (message as { id?: string }).id;
			if (id !== undefined) {
				const pending = this.#pending.get(id);
				if (pending !== undefined) {
					this.#pending.delete(id);
					pending.resolve(message);
					return;
				}
			}
			for (const listener of this.#listeners) listener(message);
		});
	}

	static async open(
		server: HarnessServer,
		options: { origin?: string; headers?: Record<string, string> } = {},
	): Promise<TestClient> {
		const url = `${server.url.replace(/^http/, "ws")}/ws`;
		const socket =
			options.origin === undefined && options.headers === undefined
				? new WebSocket(url)
				: new WebSocket(url, {
						headers: { ...options.headers, ...(options.origin === undefined ? {} : { origin: options.origin }) },
					} as never);
		await new Promise<void>((resolve, reject) => {
			socket.addEventListener("open", () => resolve());
			socket.addEventListener("error", () => reject(new Error(`could not connect to ${url}`)));
		});
		return new TestClient(socket);
	}

	get messages(): readonly ServerMessage[] {
		return this.#messages;
	}

	get stopped(): boolean {
		return this.#stopped;
	}

	/** Every binary frame received so far (terminal output). */
	get binaryFrames(): readonly Uint8Array[] {
		return this.#binary;
	}

	/** Called for each binary frame as it arrives. Returns the unsubscribe. */
	onBinary(listener: (frame: Uint8Array) => void): () => void {
		this.#binaryListeners.add(listener);
		return () => this.#binaryListeners.delete(listener);
	}

	/** Send one binary frame (terminal input or an ack). */
	sendBinary(bytes: Uint8Array): void {
		this.#socket.send(bytes as Uint8Array<ArrayBuffer>);
	}

	/** Send one raw message. */
	send(message: Record<string, unknown>): void {
		this.#socket.send(JSON.stringify(message));
	}

	/** Send a request and resolve with its response (or error response). */
	async request(message: Record<string, unknown>, timeoutMs = 20_000): Promise<ServerMessage> {
		const id = `req-${++this.#sequence}`;
		const response = new Promise<ServerMessage>((resolve, reject) => {
			this.#pending.set(id, { resolve });
			const timer = setTimeout(() => {
				this.#pending.delete(id);
				reject(new Error(`timed out waiting for ${String(message.type)} (${id})`));
			}, timeoutMs);
			this.#pending.set(id, {
				resolve: (value) => {
					clearTimeout(timer);
					resolve(value);
				},
			});
		});
		this.send({ ...message, id });
		return response;
	}

	async hello(protocolVersion = 1): Promise<ServerMessage> {
		return this.request({ type: "hello", protocolVersion, client: { name: "test", version: "0" } });
	}

	/** Wait for the first message matching `predicate`, including ones already received. */
	async waitFor(predicate: (message: ServerMessage) => boolean, timeoutMs = 20_000): Promise<ServerMessage> {
		const existing = this.#messages.find(predicate);
		if (existing !== undefined) return existing;
		return new Promise<ServerMessage>((resolve, reject) => {
			const listener = (message: ServerMessage): void => {
				if (!predicate(message)) return;
				clearTimeout(timer);
				this.#listeners.delete(listener);
				resolve(message);
			};
			const timer = setTimeout(() => {
				this.#listeners.delete(listener);
				reject(new Error("timed out waiting for a message"));
			}, timeoutMs);
			this.#listeners.add(listener);
		});
	}

	close(): void {
		this.#socket.close();
	}

	async closed(): Promise<void> {
		if (this.#socket.readyState === WebSocket.CLOSED) return;
		await new Promise<void>((resolve) => this.#socket.addEventListener("close", () => resolve()));
	}
}

/** Applies a watch response plus `conversation.view` events, the way a client does. */
export class ViewClient {
	view: ConversationView | undefined;

	constructor(readonly client: TestClient) {}

	async start(
		projectId: string,
		options?: { from?: number; min?: number; max?: number; workerId?: string; threadId?: string },
	): Promise<string> {
		const response = await this.client.request({
			type: "conversation.watch",
			projectId,
			...(options?.threadId === undefined ? {} : { threadId: options.threadId }),
			...(options?.workerId === undefined ? {} : { workerId: options.workerId }),
			...(options?.from === undefined ? {} : { from: options.from }),
			...(options?.min === undefined ? {} : { min: options.min }),
			...(options?.max === undefined ? {} : { max: options.max }),
		});
		if (response.type === "error") throw new Error(`watch failed: ${response.error.code}: ${response.error.message}`);
		if (response.type !== "conversation.watch") throw new Error(`unexpected response ${response.type}`);
		this.view = response.view;
		const watchId = response.watchId;
		void this.#pump(watchId);
		return watchId;
	}

	async #pump(watchId: string): Promise<void> {
		let index = 0;
		while (!this.client.stopped) {
			const messages = this.client.messages;
			while (index < messages.length) {
				const event = messages[index++]!;
				if (event.type === "conversation.watchEnded" && event.watchId === watchId) return;
				if (event.type !== "conversation.view" || event.watchId !== watchId) continue;
				this.view = applyImmutable(this.view as never, event.ops as unknown as Op[]) as unknown as ConversationView;
			}
			await new Promise((resolve) => setTimeout(resolve, 10));
		}
	}

	async waitForView(predicate: (view: ConversationView) => boolean, timeoutMs = 20_000): Promise<ConversationView> {
		const startTime = Date.now();
		while (Date.now() - startTime < timeoutMs) {
			if (this.view !== undefined && predicate(this.view)) return this.view;
			await new Promise((resolve) => setTimeout(resolve, 20));
		}
		throw new Error("timed out waiting for the view");
	}
}

/** Text of a `pi.user` or `pi.assistant` entry, for assertions. */
export function entryText(entry: ConversationView["entries"][number]): string {
	const messages = entry.model as { content?: unknown }[] | undefined;
	const message = messages?.[0];
	if (message === undefined) return "";
	const content = message.content;
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.map((block) => {
			if (typeof block !== "object" || block === null) return "";
			const record = block as { type?: string; text?: string };
			return record.type === "text" ? (record.text ?? "") : "";
		})
		.join("");
}

export function errorOf(message: ServerMessage): { code: string; message: string } {
	if (message.type !== "error") throw new Error(`expected an error response, got ${message.type}`);
	return { code: message.error.code, message: message.error.message };
}
