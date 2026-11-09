/**
 * One WebSocket connection: handshake, request dispatch, and the watches that push conversation views.
 */
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { CredentialStore } from "@earendil-works/pi-ai";
import { ConversationBusy, type ConversationWatch, type EntryId as DurableEntryId, type Cursor as DurableCursor } from "@earendil-works/pi-durable";
import type { WatchEnd } from "@earendil-works/pi-durable";
import {
	type AuthLogin,
	type ClientMessage,
	type Cursor,
	type ErrorCode,
	PROTOCOL_VERSION,
	type ProjectSummary,
	type Schedule,
	SERVER_NAME,
	SERVER_VERSION,
	type ServerMessage,
	type ServerStatus,
	type SubscriptionUsage,
	type WatchEndReason,
	type WorkerDefaults,
	type WorkerSummary,
	type Board,
	type ThreadSummary,
	CLIENT_MESSAGE_TYPES,
	ClientMessageSchema,
	DEFAULT_DRAIN_TIMEOUT_MS,
	TERMINAL_FRAME,
	TERMINAL_MAX_INPUT_BYTES,
	draftThreadId,
	inputImagesError,
	decodeTerminalFrame,
	encodeTerminalFrame,
	terminalAckBytes,
} from "@mihai-harness/protocol";
import { Value } from "typebox/value";
import type { ArtifactsChangedEvent, DraftsChangedEvent } from "@mihai-harness/protocol";
import type { ArtifactUrlSigner } from "./artifacts.ts";
import type { DraftStore } from "./drafts.ts";
import { withTaskReference } from "./board.ts";
import { createDirectory, deleteDirectory, renameDirectory } from "./directory-edit.ts";
import { completeDirectory, listDirectory } from "./directory-listing.ts";
import { ServerError, errorMessage } from "./errors.ts";
import type { OAuthLoginManager } from "./logins.ts";
import type { SubscriptionUsageService } from "./subscription-usage.ts";
import { readCacheStats } from "./cache-stats.ts";
import type { RequestLog } from "./request-log.ts";
import type { Notifier } from "./notifications.ts";
import type { ProjectManager } from "./runtime.ts";
import { QueuedInputs, describeContent, queueClock } from "./queued-inputs.ts";
import { WatchWindow, resolveWindowBounds } from "./window.ts";
import { wireEntry } from "./wire.ts";
import type { TerminalAttachment, TerminalHost } from "./terminals.ts";

type WatchState = {
	handle: ConversationWatch;
	tracker: WatchWindow;
	explicitStop: boolean;
	/** Pushes `conversation.context.changed` for the same conversation; absent when that watch could not start. */
	stopContext?: () => Promise<void>;
};

export type ConnectionIO = {
	send(message: ServerMessage): void;
	/** One binary frame (terminal output). */
	sendBinary(bytes: Uint8Array): void;
	close(code?: number, reason?: string): void;
};

export type ClientConnectionOptions = {
	manager: ProjectManager;
	credentials: CredentialStore;
	logins: OAuthLoginManager;
	/** The user's devices: registration, the VAPID key, a test push, and where this connection is looking. */
	notifications: Notifier;
	/** Feature names this server implements, sent in `hello`. */
	features: readonly string[];
	/** The server's release, deploy outcome and busy state, for `server.status`. */
	serverStatus: () => Promise<ServerStatus>;
	/** `server.drain`: start, extend or (0) end the drain; answers when it ends and how many tool calls execute now. */
	drain: (timeoutMs: number) => { drainingUntil: string | null; toolCalls: number };
	/** Subscription usage for `subscriptions.usage`; told when a credential is set or deleted. */
	subscriptionUsage?: SubscriptionUsageService;
	/** The request log `cache.stats` sums; without it the request fails. */
	requestLog?: RequestLog;
	/**
	 * Signs `artifacts.url` answers, which are absolute on `origin`: where the browser reached this backend (see
	 * `requestOrigin`). Without it the `artifacts.url` request fails.
	 */
	artifactUrls?: { signer: ArtifactUrlSigner; origin: string };
	/** The backend's terminals; without it (turned off) every `terminal.*` request is unknown. */
	terminals?: TerminalHost;
	/** Chat drafts; they need this and the `chat-drafts` feature, else every `drafts.*` request is unknown. */
	drafts?: DraftStore;
	io: ConnectionIO;
	log?: (message: string) => void;
};

function watchEndReason(reason: WatchEnd["reason"]): WatchEndReason {
	switch (reason) {
		case "cancelled":
			return "cancelled";
		case "session_closed":
			return "session_closed";
		case "session_failed":
			return "session_failed";
		case "listener_error":
			return "listener_error";
		default:
			return "stopped";
	}
}

function endMessage(end: WatchEnd): string | undefined {
	if ("error" in end) return errorMessage(end.error);
	return undefined;
}

export class ClientConnection {
	readonly #manager: ProjectManager;
	readonly #credentials: CredentialStore;
	readonly #logins: OAuthLoginManager;
	readonly #notifications: Notifier;
	readonly #features: readonly string[];
	readonly #serverStatus: () => Promise<ServerStatus>;
	readonly #drain: ClientConnectionOptions["drain"];
	readonly #subscriptionUsage: SubscriptionUsageService | undefined;
	readonly #requestLog: RequestLog | undefined;
	readonly #artifactUrls: { signer: ArtifactUrlSigner; origin: string } | undefined;
	readonly #terminalHost: TerminalHost | undefined;
	readonly #drafts: DraftStore | undefined;
	readonly #io: ConnectionIO;
	readonly #log: (message: string) => void;
	readonly #watches = new Map<string, WatchState>();
	/** The terminals this connection has attached, by the ID its binary frames use. */
	readonly #terminals = new Map<number, TerminalAttachment>();
	#terminalSequence = 0;
	#ready = false;
	#closed = false;
	#watchSequence = 0;

	constructor(options: ClientConnectionOptions) {
		this.#manager = options.manager;
		this.#credentials = options.credentials;
		this.#logins = options.logins;
		this.#notifications = options.notifications;
		this.#features = options.features;
		this.#serverStatus = options.serverStatus;
		this.#drain = options.drain;
		this.#subscriptionUsage = options.subscriptionUsage;
		this.#requestLog = options.requestLog;
		this.#artifactUrls = options.artifactUrls;
		this.#terminalHost = options.terminals;
		this.#drafts = options.features.includes("chat-drafts") ? options.drafts : undefined;
		this.#io = options.io;
		this.#log = options.log ?? ((message) => console.log(message));
	}

	get ready(): boolean {
		return this.#ready;
	}

	/** Push a project state change to this connection. */
	notifyProject(summary: ProjectSummary): void {
		this.#respond({ type: "project.state", project: summary });
	}

	/** Push a project's whole worker list when it changes. */
	notifyWorkers(projectId: string, workers: WorkerSummary[], defaults: WorkerDefaults): void {
		this.#respond({ type: "workers.state", projectId, workers, defaults });
	}

	/** Push a project's board (without archived tasks) when it changes. */
	notifyBoard(projectId: string, board: Board): void {
		this.#respond({ type: "board.state", projectId, board });
	}

	/** Push a project's threads (without archived ones) when any changes. */
	notifyThreads(projectId: string, threads: ThreadSummary[]): void {
		this.#respond({ type: "threads.state", projectId, threads });
	}

	/** Push a project's whole schedule list when a schedule or its runs change. */
	notifySchedules(projectId: string, schedules: Schedule[], timezone: string): void {
		this.#respond({ type: "schedules.state", projectId, schedules, timezone });
	}

	/** Push an OAuth login change to this connection. */
	notifyLogin(login: AuthLogin): void {
		this.#respond({ type: "credentials.login", login });
	}

	/** Push the release or deploy outcome when it changed; `busy` rides along for whoever reads it. */
	notifyServerStatus(status: ServerStatus): void {
		this.#respond({ type: "server.status.changed", status });
	}

	/** Push every subscription's usage when a read changed its numbers. */
	notifySubscriptionsUsage(subscriptions: SubscriptionUsage[]): void {
		this.#respond({ type: "subscriptions.usage.changed", subscriptions });
	}

	/** Push that a memory scope's files changed, so clients read it again. */
	notifyMemory(scope: "global" | "project", projectId: string | null): void {
		this.#respond({ type: "memory.changed", scope, projectId });
	}

	/** Push that one artifact was saved or deleted. */
	notifyArtifact(event: ArtifactsChangedEvent): void {
		this.#respond(event);
	}

	/** Push that a chat's draft changed. */
	notifyDraft(event: DraftsChangedEvent): void {
		if (this.#drafts !== undefined) this.#respond(event);
	}

	/** Handle one raw WebSocket message. Never throws. */
	async handle(raw: string | Uint8Array): Promise<void> {
		if (this.#closed) return;
		// A binary frame is terminal input or an ack (`{` is not a frame kind, so JSON sent as bytes still parses).
		if (typeof raw !== "string" && raw.length > 0 && raw[0] !== 0x7b) {
			this.#terminalFrame(raw);
			return;
		}
		let parsed: unknown;
		try {
			const text = typeof raw === "string" ? raw : new TextDecoder().decode(raw);
			parsed = JSON.parse(text);
		} catch {
			this.#error(undefined, "bad_request", "Message is not valid JSON");
			return;
		}

		const id = typeof (parsed as { id?: unknown }).id === "string" ? (parsed as { id: string }).id : undefined;
		const type = (parsed as { type?: unknown }).type;
		if (typeof type === "string" && !CLIENT_MESSAGE_TYPES.has(type)) {
			// Usually a web app newer than this server: say so, rather than "Invalid message".
			this.#error(id, "unknown_request", `This server does not know "${type}"; it may be older than the app, so restart it`);
			return;
		}
		if (!Value.Check(ClientMessageSchema, parsed)) {
			const first = Value.Errors(ClientMessageSchema, parsed)[0];
			this.#error(id, "bad_request", "Invalid message", first === undefined ? undefined : { path: first.instancePath });
			return;
		}

		await this.#dispatch(parsed as ClientMessage);
	}

	/** Stop every watch; called when the socket closes. A closed connection is no longer looking at a project. */
	close(): void {
		if (this.#closed) return;
		this.#closed = true;
		this.#notifications.presence.remove(this);
		const watches = [...this.#watches.values()];
		this.#watches.clear();
		for (const watch of watches) {
			watch.explicitStop = true;
			void watch.handle.stop().catch(() => undefined);
			void watch.stopContext?.().catch(() => undefined);
		}
		// Detach only: the sessions and what runs in them stay.
		const terminals = [...this.#terminals.values()];
		this.#terminals.clear();
		for (const terminal of terminals) void terminal.detach().catch(() => undefined);
	}

	async #dispatch(request: ClientMessage): Promise<void> {
		if (request.type === "hello") {
			await this.#hello(request);
			return;
		}
		if (!this.#ready) {
			this.#error(request.id, "not_ready", "Send hello before any other request");
			return;
		}

		try {
			switch (request.type) {
				case "projects.list": {
					const projects = await this.#manager.list();
					this.#respond({ type: "projects.list", id: request.id, projects });
					return;
				}
				case "projects.add": {
					const project = await this.#manager.add(request.path);
					this.#respond({ type: "projects.add", id: request.id, project });
					return;
				}
				case "projects.configure": {
					const project = await this.#manager.configure(request.projectId, {
						...(request.name === undefined ? {} : { name: request.name }),
						...(request.coordinatorModel === undefined
							? {}
							: { coordinatorModel: request.coordinatorModel }),
						...(request.coordinatorThinkingLevel === undefined
							? {}
							: { coordinatorThinkingLevel: request.coordinatorThinkingLevel }),
						...(request.workerModels === undefined ? {} : { workerModels: request.workerModels }),
						...(request.checkIns === undefined ? {} : { checkIns: request.checkIns }),
						...(request.longPromptCache === undefined ? {} : { longPromptCache: request.longPromptCache }),
						...(request.keepPromptCacheWarm === undefined ? {} : { keepPromptCacheWarm: request.keepPromptCacheWarm }),
						...(request.promptCacheWarmHours === undefined ? {} : { promptCacheWarmHours: request.promptCacheWarmHours }),
						...(request.uiProof === undefined ? {} : { uiProof: request.uiProof }),
						...(request.links === undefined ? {} : { links: request.links }),
						...(request.archived === undefined ? {} : { archived: request.archived }),
					});
					this.#respond({ type: "projects.configure", id: request.id, project });
					return;
				}
				case "filesystem.list": {
					const listing = await listDirectory({
						...(request.path === undefined ? {} : { path: request.path }),
						...(request.showHidden === undefined ? {} : { showHidden: request.showHidden }),
						projects: await this.#projectPaths(),
					});
					this.#respond({ type: "filesystem.list", id: request.id, ...listing });
					return;
				}
				case "filesystem.complete": {
					const completion = await completeDirectory({
						input: request.input,
						...(request.showHidden === undefined ? {} : { showHidden: request.showHidden }),
						projects: await this.#projectPaths(),
					});
					this.#respond({ type: "filesystem.complete", id: request.id, ...completion });
					return;
				}
				case "filesystem.create": {
					const entry = await createDirectory(request.path, request.name, await this.#editOptions());
					this.#respond({ type: "filesystem.create", id: request.id, entry });
					return;
				}
				case "filesystem.rename": {
					const entry = await renameDirectory(request.path, request.name, await this.#editOptions());
					this.#respond({ type: "filesystem.rename", id: request.id, entry });
					return;
				}
				case "filesystem.delete": {
					const path = await deleteDirectory(request.path, await this.#editOptions());
					this.#respond({ type: "filesystem.delete", id: request.id, path });
					return;
				}
				case "models.list": {
					const catalog = await this.#manager.catalog();
					this.#respond({ type: "models.list", id: request.id, ...catalog });
					return;
				}
				case "credentials.list": {
					const credentials = await this.#credentials.list();
					this.#respond({
						type: "credentials.list",
						id: request.id,
						credentials: credentials.map((credential) => ({
							providerId: credential.providerId,
							type: credential.type,
						})),
					});
					return;
				}
				case "credentials.set": {
					await this.#setCredential(request.id, request.providerId, request.apiKey);
					return;
				}
				case "credentials.delete": {
					await this.#deleteCredential(request.id, request.providerId);
					return;
				}
				case "credentials.logins": {
					this.#respond({ type: "credentials.logins", id: request.id, logins: this.#logins.list() });
					return;
				}
				case "credentials.loginStart": {
					const login = this.#logins.start(request.providerId);
					this.#respond({ type: "credentials.loginStart", id: request.id, login });
					return;
				}
				case "credentials.loginAnswer": {
					const login = this.#logins.answer(request.loginId, request.promptId, request.value);
					this.#respond({ type: "credentials.loginAnswer", id: request.id, login });
					return;
				}
				case "credentials.loginCancel": {
					this.#respond({
						type: "credentials.loginCancel",
						id: request.id,
						cancelled: this.#logins.cancel(request.loginId),
					});
					return;
				}
				case "notifications.config": {
					this.#respond({
						type: "notifications.config",
						id: request.id,
						publicKey: this.#notifications.publicKey,
						fcm:
							this.#notifications.fcmProjectId === null ? null : { projectId: this.#notifications.fcmProjectId },
					});
					return;
				}
				case "notifications.register": {
					const device = await this.#notifications.register({
						deviceId: request.deviceId,
						label: request.label,
						backendKey: request.backendKey,
						subscription: request.subscription,
						preferences: request.preferences,
					});
					this.#respond({ type: "notifications.register", id: request.id, device });
					return;
				}
				case "notifications.registerFcm": {
					const device = await this.#notifications.register({
						deviceId: request.deviceId,
						label: request.label,
						backendKey: request.backendKey,
						fcmToken: request.token,
						preferences: request.preferences,
					});
					this.#respond({ type: "notifications.registerFcm", id: request.id, device });
					return;
				}
				case "notifications.unregister": {
					const removed = await this.#notifications.unregister(request.deviceId);
					this.#log(`notifications: ${removed ? "forgot" : "had no"} device ${request.deviceId}`);
					this.#respond({ type: "notifications.unregister", id: request.id });
					return;
				}
				case "notifications.device": {
					this.#respond({
						type: "notifications.device",
						id: request.id,
						device: this.#notifications.device(request.deviceId),
					});
					return;
				}
				case "notifications.test": {
					const outcome = await this.#notifications.test(request.deviceId);
					this.#respond({
						type: "notifications.test",
						id: request.id,
						ok: outcome.ok,
						status: outcome.status,
						message: outcome.message,
					});
					return;
				}
				case "notifications.presence": {
					this.#notifications.presence.set(this, {
						deviceId: request.deviceId,
						visible: request.visible,
						projectId: request.projectId,
					});
					this.#respond({ type: "notifications.presence", id: request.id });
					return;
				}
				case "notifications.interaction": {
					if (!this.#features.includes("notification-hold")) return this.#unknownRequest(request);
					this.#respond({
						type: "notifications.interaction",
						id: request.id,
						dropped: this.#notifications.interaction(),
					});
					return;
				}
				case "subscriptions.usage": {
					const subscriptions =
						this.#subscriptionUsage === undefined
							? []
							: await this.#subscriptionUsage.usage({ refresh: request.refresh === true });
					this.#respond({ type: "subscriptions.usage", id: request.id, subscriptions });
					return;
				}
				case "cache.stats": {
					if (this.#requestLog === undefined) {
						throw new ServerError("internal", "This backend keeps no request log");
					}
					const stats = await readCacheStats({
						store: this.#requestLog.store,
						projects: this.#manager.store,
						models: this.#manager.models,
						...(request.days === undefined ? {} : { days: request.days }),
						...(request.projectId === undefined ? {} : { projectId: request.projectId }),
						...(request.utcOffsetMinutes === undefined ? {} : { utcOffsetMinutes: request.utcOffsetMinutes }),
					});
					this.#respond({ type: "cache.stats", id: request.id, stats });
					return;
				}
				case "refs.status": {
					const statuses = await this.#manager.refStatuses(request.projectId, request.refs);
					this.#respond({ type: "refs.status", id: request.id, statuses });
					return;
				}
				case "refs.details": {
					const details = await this.#manager.refDetails(request.projectId, request.ref);
					this.#respond({ type: "refs.details", id: request.id, details });
					return;
				}
				case "artifacts.list": {
					await this.#manager.requireProject(request.projectId);
					const artifacts = await this.#manager.artifacts.list(request.projectId, {
						...(request.threadId === undefined ? {} : { threadId: request.threadId }),
						...(request.workerId === undefined ? {} : { workerId: request.workerId }),
						...(request.taskId === undefined ? {} : { taskId: request.taskId }),
						...(request.limit === undefined ? {} : { limit: request.limit }),
					});
					this.#respond({ type: "artifacts.list", id: request.id, artifacts });
					return;
				}
				case "artifacts.url": {
					await this.#manager.requireProject(request.projectId);
					const artifact = await this.#manager.artifacts.require(request.projectId, request.artifactId);
					if (this.#artifactUrls === undefined) throw new ServerError("internal", "Artifact URLs are not available");
					const { path, expiresAt } = this.#artifactUrls.signer.sign(
						artifact.projectId,
						artifact.id,
						request.download === true ? "attachment" : "inline",
					);
					this.#respond({ type: "artifacts.url", id: request.id, url: `${this.#artifactUrls.origin}${path}`, expiresAt });
					return;
				}
				case "artifacts.update": {
					await this.#manager.requireProject(request.projectId);
					const artifact = await this.#manager.artifacts.updateTags(request.projectId, request.artifactId, request.tags);
					this.#respond({ type: "artifacts.update", id: request.id, artifact });
					return;
				}
				case "artifacts.delete": {
					await this.#manager.requireProject(request.projectId);
					await this.#manager.artifacts.delete(request.projectId, request.artifactId);
					this.#respond({ type: "artifacts.delete", id: request.id });
					return;
				}
				case "server.status": {
					this.#respond({ type: "server.status", id: request.id, status: await this.#serverStatus() });
					return;
				}
				case "server.drain": {
					const drained = this.#drain(request.timeoutMs ?? DEFAULT_DRAIN_TIMEOUT_MS);
					this.#respond({ type: "server.drain", id: request.id, ...drained });
					return;
				}
				case "workers.list": {
					const { workers, defaults } = await this.#manager.workers(request.projectId, request.threadId);
					this.#respond({ type: "workers.list", id: request.id, workers, defaults });
					return;
				}
				case "workers.defaults.set": {
					const defaults = await this.#manager.setWorkerDefaults(request.projectId, request.defaults);
					this.#respond({ type: "workers.defaults.set", id: request.id, defaults });
					return;
				}
				case "threads.list": {
					const threads = await this.#manager.threads(request.projectId, request.includeArchived === true);
					this.#respond({ type: "threads.list", id: request.id, threads });
					return;
				}
				case "threads.stop": {
					const thread = await this.#manager.stopThread(request.projectId, request.threadId);
					this.#respond({ type: "threads.stop", id: request.id, thread });
					return;
				}
				case "projects.storage": {
					const storage = await this.#manager.storage(request.projectId);
					this.#respond({ type: "projects.storage", id: request.id, ...storage });
					return;
				}
				case "projects.storage.clean": {
					const cleaned = await this.#manager.cleanStorage(request.projectId, request.itemIds);
					this.#respond({ type: "projects.storage.clean", id: request.id, ...cleaned });
					return;
				}
				case "threads.archive": {
					const thread = await this.#manager.archiveThread(request.projectId, request.threadId, request.archived);
					this.#respond({ type: "threads.archive", id: request.id, thread });
					return;
				}
				case "board.get": {
					const board = await this.#manager.board(request.projectId, request.includeArchived === true);
					this.#respond({ type: "board.get", id: request.id, board });
					return;
				}
				case "board.task.history": {
					const snapshots = await this.#manager.boardTaskHistory(request.projectId, request.taskId);
					this.#respond({ type: "board.task.history", id: request.id, taskId: request.taskId, snapshots });
					return;
				}
				case "board.task.timeline": {
					if (!this.#features.includes("task-links")) return this.#unknownRequest(request);
					const { entries, feedback } = await this.#manager.boardTaskTimeline(request.projectId, request.taskId, request.kinds);
					this.#respond({ type: "board.task.timeline", id: request.id, taskId: request.taskId, entries, feedback });
					return;
				}
				case "board.feedback.set": {
					if (!this.#features.includes("task-links")) return this.#unknownRequest(request);
					const feedback = await this.#manager.setBoardFeedback(request.projectId, {
						taskId: request.taskId,
						feedbackId: request.feedbackId,
						state: request.state,
						note: request.note,
					});
					this.#respond({ type: "board.feedback.set", id: request.id, feedback });
					return;
				}
				case "board.task.save": {
					const task = await this.#manager.saveBoardTask(request.projectId, {
						taskId: request.taskId,
						expectedRevision: request.expectedRevision,
						task: request.task,
						note: request.note,
					});
					this.#respond({ type: "board.task.save", id: request.id, task });
					return;
				}
				case "board.tasks.reorder": {
					await this.#manager.reorderBoardTasks(request.projectId, request.taskIds);
					this.#respond({ type: "board.tasks.reorder", id: request.id });
					return;
				}
				case "board.question.answer": {
					const question = await this.#manager.answerBoardQuestion(request.projectId, {
						questionId: request.questionId,
						expectedRevision: request.expectedRevision,
						answer: request.answer,
					});
					this.#respond({ type: "board.question.answer", id: request.id, question });
					return;
				}
				case "schedules.list": {
					const { schedules, timezone } = await this.#manager.schedules(request.projectId);
					this.#respond({ type: "schedules.list", id: request.id, schedules, timezone });
					return;
				}
				case "schedules.save": {
					const schedule = await this.#manager.saveSchedule(
						request.projectId,
						request.schedule,
						request.scheduleId,
					);
					this.#respond({ type: "schedules.save", id: request.id, schedule });
					return;
				}
				case "schedules.delete": {
					await this.#manager.deleteSchedule(request.projectId, request.scheduleId);
					this.#respond({ type: "schedules.delete", id: request.id });
					return;
				}
				case "schedules.run": {
					const run = await this.#manager.runSchedule(request.projectId, request.scheduleId);
					this.#respond({ type: "schedules.run", id: request.id, run });
					return;
				}
				case "memory.list": {
					const files = await this.#manager.listMemory(
						request.scope,
						request.projectId,
						request.includeArchived === true,
					);
					this.#respond({ type: "memory.list", id: request.id, files });
					return;
				}
				case "memory.read": {
					const file = await this.#manager.readMemory(request.scope, request.projectId, request.fileId);
					this.#respond({ type: "memory.read", id: request.id, file });
					return;
				}
				case "memory.search": {
					const hits = await this.#manager.searchMemory({
						query: request.query,
						scope: request.scope,
						...(request.projectId === undefined ? {} : { projectId: request.projectId }),
						...(request.tags === undefined ? {} : { tags: request.tags }),
						...(request.includeArchived === undefined
							? {}
							: { includeArchived: request.includeArchived }),
						limit: request.limit ?? 20,
					});
					this.#respond({ type: "memory.search", id: request.id, hits });
					return;
				}
				case "memory.history": {
					const changes = await this.#manager.memoryHistory(
						request.scope,
						request.projectId,
						request.limit ?? 50,
					);
					this.#respond({ type: "memory.history", id: request.id, changes });
					return;
				}
				case "memory.undo": {
					const change = await this.#manager.undoMemory(request.scope, request.projectId, request.commit);
					this.#respond({ type: "memory.undo", id: request.id, change });
					return;
				}
				case "memory.status": {
					const { status, maintenance, timezone } = await this.#manager.memoryStatus(
						request.scope,
						request.projectId,
					);
					this.#respond({ type: "memory.status", id: request.id, status, maintenance, timezone });
					return;
				}
				case "memory.maintain": {
					await this.#manager.maintainMemory(request.scope, request.projectId);
					this.#respond({ type: "memory.maintain", id: request.id });
					return;
				}
				case "memory.settings.set": {
					const maintenance = await this.#manager.setMemorySettings(request.maintenance);
					this.#respond({ type: "memory.settings.set", id: request.id, maintenance });
					return;
				}
				case "conversation.context": {
					const context = await this.#manager.context(request.projectId, request.workerId, request.threadId);
					this.#respond({ type: "conversation.context", id: request.id, context });
					return;
				}
				case "conversation.watch": {
					await this.#watch(request);
					return;
				}
				case "conversation.unwatch": {
					await this.#unwatch(request.id, request.watchId);
					return;
				}
				case "conversation.page": {
					await this.#page(request);
					return;
				}
				case "conversation.submit": {
					const receivedAt = this.#drafts?.now() ?? 0;
					const imagesError = inputImagesError(request.content);
					if (imagesError !== undefined) throw new ServerError("bad_request", imagesError);
					const project = await this.#manager.requireProject(request.projectId);
					if (project.coordinator.model === null) {
						throw new ServerError(
							"no_coordinator_model",
							"This project has no coordinator model. Set one with projects.configure.",
							{ projectId: project.id },
						);
					}
					// The worker model the user picks with a message applies to the workers started from now on.
					if (request.workerModel !== undefined || request.workerThinkingLevel !== undefined) {
						await this.#manager.rememberWorkerDefaults(request.projectId, {
							...(request.workerModel === undefined ? {} : { model: request.workerModel }),
							...(request.workerThinkingLevel === undefined
								? {}
								: { thinkingLevel: request.workerThinkingLevel }),
						});
					}
					// A message about a task names it in front of its text, so every coordinator reads which task it is about.
					if (request.taskId !== undefined) await this.#manager.requireBoardTask(request.projectId, request.taskId);
					const { conversation, runtime } = await this.#manager.conversation(request.projectId, request.threadId);
					// The message becomes a feedback entry on the task, and its ID goes into the reference the coordinator reads.
					// A re-sent request ID finds its entry. Only what the user typed is recorded, never the harness's own inputs.
					const feedback =
						request.taskId === undefined || !this.#features.includes("task-links")
							? undefined
							: await this.#manager.recordBoardFeedback(request.projectId, {
									taskId: request.taskId,
									...describeContent(request.content),
									threadId: request.threadId ?? "main",
									requestId: request.requestId,
								});
					// The user typed into a finished or stopped background thread: it works again.
					await this.#manager.reviveThread(request.projectId, request.threadId);
					const submission = await conversation.submit(
						{
							type: "input",
							content: request.taskId === undefined ? request.content : withTaskReference(request.content, request.taskId, feedback?.id),
							requestId: request.requestId,
							...(request.whenBusy === undefined ? {} : { whenBusy: request.whenBusy }),
						},
						BACKGROUND_CONTEXT,
					);
					// Whether the run took it at once or it waits for a boundary; a re-sent request ID answers the same way.
					const status = (await submission.status(BACKGROUND_CONTEXT).catch(() => undefined))?.status;
					if (status === "queued") queueClock(runtime.harness).stamp(conversation.id, submission.id);
					// The message is on its way, so what was typed for it is spent, on every device. A draft written after the message
					// arrived is something typed since, and stays.
					if (request.keepDraft !== true) {
						await this.#drafts?.clear(request.projectId, draftThreadId(request.threadId), receivedAt).catch((error: unknown) => {
							this.#log(`project ${request.projectId}: could not clear the draft: ${errorMessage(error)}`);
						});
					}
					this.#respond({
						type: "conversation.submit",
						id: request.id,
						submissionId: submission.id,
						...(status === "queued" ? { status } : status === "placed" || status === "done" ? { status: "placed" } : {}),
					});
					return;
				}
				case "conversation.withdraw": {
					const { conversation, runtime } = await this.#manager.conversation(request.projectId, request.threadId);
					const result = await runtime.harness.abortSubmission(
						request.submissionId as never,
						BACKGROUND_CONTEXT,
						conversation.id,
					);
					// A submission that is settled without an answer was withdrawn (or never ran): nothing to take back.
					const record =
						result === "settled" || result === "already_placed"
							? await (await runtime.harness.submission(request.submissionId as never, BACKGROUND_CONTEXT))
									?.status(BACKGROUND_CONTEXT)
									.catch(() => undefined)
							: undefined;
					const outcome =
						result === "aborted"
							? "withdrawn"
							: result === "not_found" || record?.status === "unanswered"
								? "gone"
								: "already_placed";
					this.#respond({ type: "conversation.withdraw", id: request.id, outcome });
					return;
				}
				case "conversation.abort": {
					const { conversation } = await this.#manager.conversation(request.projectId, request.threadId);
					await conversation.abort(
						BACKGROUND_CONTEXT,
						request.background === true ? { background: true } : undefined,
					);
					this.#respond({ type: "conversation.abort", id: request.id });
					return;
				}
				case "conversation.compact": {
					await this.#manager.compact(request.projectId, request.instructions, request.threadId);
					this.#respond({ type: "conversation.compact", id: request.id });
					return;
				}
				case "terminal.list": {
					const host = this.#terminalHost;
					if (host === undefined) return this.#unknownRequest(request);
					const availability = await host.availability();
					const attached = [...this.#terminals.entries()].map(([terminalId, terminal]) => ({
						terminalId,
						session: terminal.session,
						cols: terminal.cols,
						rows: terminal.rows,
					}));
					const mine = new Set(attached.map((entry) => entry.session));
					const sessions = (await host.listSessions()).map((entry) => ({
						name: entry.name,
						exited: entry.exited,
						attached: mine.has(entry.name),
						...(entry.created === undefined ? {} : { created: entry.created }),
					}));
					this.#respond({
						type: "terminal.list",
						id: request.id,
						available: availability.available,
						multiplexer: availability.multiplexer,
						...(availability.version === undefined ? {} : { version: availability.version }),
						...(availability.reason === undefined ? {} : { reason: availability.reason }),
						survivesRestart: availability.survivesRestart,
						sessions,
						attached,
						limits: host.limits,
					});
					return;
				}
				case "terminal.open": {
					const host = this.#terminalHost;
					if (host === undefined) return this.#unknownRequest(request);
					if (this.#terminals.size >= host.limits.perConnection) {
						throw new ServerError(
							"terminal_limit",
							`This connection already has ${host.limits.perConnection} terminals open; close one first`,
						);
					}
					const terminalId = ++this.#terminalSequence;
					// Output is sent from timers, which cannot run between the host answering and the response below.
					const terminal = await host.open(
						{
							...(request.session === undefined ? {} : { session: request.session }),
							...(request.prefix === undefined ? {} : { prefix: request.prefix }),
							...(request.cwd === undefined ? {} : { cwd: request.cwd }),
							cols: request.cols,
							rows: request.rows,
						},
						{
							output: (bytes) => {
								if (this.#closed) return;
								try {
									this.#io.sendBinary(encodeTerminalFrame(TERMINAL_FRAME.output, terminalId, bytes));
								} catch (error) {
									this.#log(`terminal ${terminalId}: send failed: ${errorMessage(error)}`);
								}
							},
							resync: () => this.#respond({ type: "terminal.resync", terminalId }),
							closed: (info) => {
								this.#terminals.delete(terminalId);
								this.#respond({ type: "terminal.closed", terminalId, ...info });
							},
						},
					);
					this.#terminals.set(terminalId, terminal);
					this.#respond({
						type: "terminal.open",
						id: request.id,
						terminalId,
						session: terminal.session,
						created: terminal.created,
						cols: terminal.cols,
						rows: terminal.rows,
					});
					return;
				}
				case "terminal.resize": {
					const terminal = this.#terminalFor(request.terminalId);
					terminal.resize(request.cols, request.rows);
					this.#respond({ type: "terminal.resize", id: request.id, terminalId: request.terminalId });
					return;
				}
				case "terminal.close": {
					const terminal = this.#terminalFor(request.terminalId);
					this.#terminals.delete(request.terminalId);
					await terminal.detach();
					this.#respond({ type: "terminal.close", id: request.id, terminalId: request.terminalId });
					return;
				}
				case "terminal.kill": {
					const host = this.#terminalHost;
					if (host === undefined) return this.#unknownRequest(request);
					await host.kill(request.session);
					this.#respond({ type: "terminal.kill", id: request.id, session: request.session });
					return;
				}
				case "drafts.get": {
					const drafts = this.#drafts;
					if (drafts === undefined) return this.#unknownRequest(request);
					await this.#manager.requireProject(request.projectId);
					this.#respond({
						type: "drafts.get",
						id: request.id,
						drafts: await drafts.get(request.projectId, request.threadId),
					});
					return;
				}
				case "drafts.set": {
					const drafts = this.#drafts;
					if (drafts === undefined) return this.#unknownRequest(request);
					await this.#manager.requireProject(request.projectId);
					const result = await drafts.set(
						request.projectId,
						request.threadId,
						request.content,
						request.baseRevision,
						request.device,
						this,
					);
					this.#respond({ type: "drafts.set", id: request.id, applied: result.applied, draft: result.draft });
					return;
				}
				case "drafts.attachment.put": {
					const drafts = this.#drafts;
					if (drafts === undefined) return this.#unknownRequest(request);
					await this.#manager.requireProject(request.projectId);
					const attachment = await drafts.putAttachment(request.projectId, request.mimeType, request.data, request.name);
					this.#respond({ type: "drafts.attachment.put", id: request.id, attachment });
					return;
				}
				case "drafts.attachment.get": {
					const drafts = this.#drafts;
					if (drafts === undefined) return this.#unknownRequest(request);
					await this.#manager.requireProject(request.projectId);
					const found = await drafts.getAttachment(request.projectId, request.attachmentId);
					this.#respond({ type: "drafts.attachment.get", id: request.id, ...found });
					return;
				}
				default: {
					this.#unknownRequest(request as { id?: string; type?: string });
					return;
				}
			}
		} catch (error) {
			this.#fail(request.id, error);
		}
	}

	/** The added projects' folders, mapped to their IDs, for marking and protecting them in the folder picker. */
	async #projectPaths(): Promise<Map<string, string>> {
		const projects = await this.#manager.store.list();
		return new Map(projects.map((project) => [project.path, project.id]));
	}

	async #editOptions(): Promise<{ projects: Map<string, string>; dataDir: string }> {
		return { projects: await this.#projectPaths(), dataDir: this.#manager.store.dataDir };
	}

	async #hello(request: Extract<ClientMessage, { type: "hello" }>): Promise<void> {
		if (this.#ready) {
			this.#error(request.id, "bad_request", "Already greeted on this connection");
			return;
		}
		if (request.protocolVersion !== PROTOCOL_VERSION) {
			this.#error(
				request.id,
				"unsupported_protocol",
				`This server speaks protocol version ${PROTOCOL_VERSION}`,
				{ protocolVersion: PROTOCOL_VERSION },
			);
			this.#io.close(1002, "unsupported protocol version");
			return;
		}
		this.#ready = true;
		this.#respond({
			type: "hello",
			id: request.id,
			protocolVersion: PROTOCOL_VERSION,
			server: { name: SERVER_NAME, version: SERVER_VERSION },
			features: [...this.#features],
		});
	}

	async #setCredential(id: string, providerId: string, apiKey: string): Promise<void> {
		if (this.#manager.models.getProvider(providerId) === undefined) {
			throw new ServerError("unknown_provider", `Unknown provider "${providerId}"`);
		}
		const key = apiKey.trim();
		if (key.length === 0) throw new ServerError("bad_request", "apiKey must not be empty");
		// A pending OAuth login would overwrite this key when it completes, so it gives way to the explicit choice.
		this.#logins.cancelProvider(providerId);
		await this.#credentials.modify(providerId, async () => ({ type: "api_key", key }));
		this.#subscriptionUsage?.credentialsChanged();
		this.#respond({
			type: "credentials.set",
			id,
			credential: { providerId, type: "api_key" },
		});
	}

	async #deleteCredential(id: string, providerId: string): Promise<void> {
		const before = await this.#credentials.list();
		const existed = before.some((credential) => credential.providerId === providerId);
		this.#logins.cancelProvider(providerId);
		await this.#credentials.delete(providerId);
		this.#subscriptionUsage?.credentialsChanged();
		this.#respond({ type: "credentials.delete", id, deleted: existed });
	}

	async #watch(request: Extract<ClientMessage, { type: "conversation.watch" }>): Promise<void> {
		const bounds = resolveWindowBounds(request.min, request.max);
		const { conversation, runtime } =
			request.workerId === undefined
				? await this.#manager.conversation(request.projectId, request.threadId)
				: await this.#manager.workerConversation(request.projectId, request.workerId, request.threadId);
		const handle = await conversation.watch(BACKGROUND_CONTEXT);
		const tracker = new WatchWindow(bounds);
		// A worker's conversation takes no input from the app, so it has no waiting messages to show.
		const queue = request.workerId === undefined ? new QueuedInputs(runtime.harness, conversation.id) : undefined;
		const warm = () => request.workerId === undefined ? this.#requestLog?.warmStretches(request.projectId, Number(conversation.id)) : undefined;
		const view = tracker.initial(handle.value, request.from, await queue?.decorate(handle.value), warm());
		const watchId = `watch-${++this.#watchSequence}`;
		const state: WatchState = { handle, tracker, explicitStop: false };
		this.#watches.set(watchId, state);

		// The response carries the initial value; from here on the client only applies ops to it.
		this.#respond({ type: "conversation.watch", id: request.id, watchId, conversationId: conversation.id, view });

		handle.start(async (value) => {
			if (this.#closed || state.explicitStop) return;
			const update = tracker.update(value, await queue?.decorate(value), warm());
			if (update.ops.length === 0) return;
			this.#respond({ type: "conversation.view", watchId, ops: update.ops });
		});

		// The same conversation's context is pushed while it is watched, so the app sees a skill being read and the prompt
		// changing with the files. A failure here must not cost the transcript watch.
		state.stopContext = await this.#manager
			.watchContext(
				request.projectId,
				request.workerId,
				(context) => {
					if (this.#closed || state.explicitStop) return;
					this.#respond({ type: "conversation.context.changed", context });
				},
				request.threadId,
			)
			.catch((error: unknown) => {
				this.#log(`context watch for ${request.projectId} failed: ${errorMessage(error)}`);
				return async () => undefined;
			});

        const stopWarm = this.#requestLog?.store.onWarmChange(() => {
            if (this.#closed || state.explicitStop) return;
            void (async () => {
                const update = tracker.update(handle.value, await queue?.decorate(handle.value), warm());
                if (update.ops.length > 0) this.#respond({ type: "conversation.view", watchId, ops: update.ops });
            })().catch(error => this.#log(`cache warm history: ${errorMessage(error)}`));
        });
        const stopContext = state.stopContext;
        state.stopContext = async () => { stopWarm?.(); await stopContext?.(); };
		void handle.closed.then((end) => {
			stopWarm?.();
			this.#watches.delete(watchId);
			if (this.#closed || state.explicitStop) return;
			const message = endMessage(end);
			this.#respond({
				type: "conversation.watchEnded",
				watchId,
				reason: watchEndReason(end.reason),
				...(message === undefined ? {} : { message }),
			});
		});
	}

	async #unwatch(id: string, watchId: string): Promise<void> {
		const state = this.#watches.get(watchId);
		if (state !== undefined) {
			state.explicitStop = true;
			this.#watches.delete(watchId);
			await state.handle.stop().catch(() => undefined);
			await state.stopContext?.().catch(() => undefined);
		}
		this.#respond({ type: "conversation.unwatch", id, watchId });
	}

	async #page(request: Extract<ClientMessage, { type: "conversation.page" }>): Promise<void> {
		const { conversation } =
			request.workerId === undefined
				? await this.#manager.conversation(request.projectId, request.threadId)
				: await this.#manager.workerConversation(request.projectId, request.workerId, request.threadId);
		let maxEntryId = request.maxEntryId === undefined ? undefined : (request.maxEntryId as DurableEntryId);
		if (request.before !== undefined && request.cursor === undefined) {
			maxEntryId = Math.max(0, request.before - 1) as DurableEntryId;
		}
		const page = await conversation.entries(
			{
				...(request.minEntryId === undefined
					? {}
					: { minEntryId: request.minEntryId as DurableEntryId }),
				...(maxEntryId === undefined ? {} : { maxEntryId }),
				...(request.order === undefined ? {} : { order: request.order }),
			},
			request.limit ?? 50,
			request.cursor === undefined ? undefined : (request.cursor as DurableCursor),
			BACKGROUND_CONTEXT,
		);
		this.#respond({
			type: "conversation.page",
			id: request.id,
			keepWarm: this.#requestLog?.warmStretches(request.projectId, Number(conversation.id)),
			entries: page.items.map(wireEntry),
			...(page.next === undefined ? {} : { next: page.next as unknown as Cursor }),
		});
	}

	#unknownRequest(request: { id?: string; type?: string }): void {
		this.#error(request.id, "unknown_request", `This server does not know "${request.type ?? ""}"`);
	}

	#terminalFor(terminalId: number): TerminalAttachment {
		const terminal = this.#terminals.get(terminalId);
		if (terminal === undefined) throw new ServerError("unknown_terminal", `No terminal ${terminalId} on this connection`);
		return terminal;
	}

	/** Terminal input and acks, the two binary frames a client sends. A frame for a terminal that is gone is ignored. */
	#terminalFrame(raw: Uint8Array): void {
		const frame = decodeTerminalFrame(raw);
		if (frame === undefined) {
			this.#error(undefined, "bad_request", "Not a terminal frame");
			return;
		}
		const terminal = this.#terminals.get(frame.terminalId);
		if (terminal === undefined) return;
		if (frame.kind === TERMINAL_FRAME.input) {
			if (frame.payload.length > TERMINAL_MAX_INPUT_BYTES) {
				this.#error(undefined, "bad_request", `A terminal input frame is at most ${TERMINAL_MAX_INPUT_BYTES} bytes`);
				return;
			}
			terminal.write(frame.payload);
		} else if (frame.kind === TERMINAL_FRAME.ack) {
			const bytes = terminalAckBytes(frame.payload);
			if (bytes === undefined) {
				this.#error(undefined, "bad_request", "An ack carries a 4-byte count");
				return;
			}
			terminal.ack(bytes);
		}
	}

	#fail(id: string, error: unknown): void {
		if (error instanceof ServerError) {
			this.#error(id, error.code, error.message, error.data);
			return;
		}
		if (error instanceof ConversationBusy) {
			this.#error(id, "conversation_busy", error.message);
			return;
		}
		this.#log(`request ${id} failed: ${errorMessage(error)}`);
		this.#error(id, "internal", "Internal server error");
	}

	#respond(message: ServerMessage): void {
		if (this.#closed) return;
		try {
			this.#io.send(message);
		} catch (error) {
			this.#log(`send failed, closing connection: ${errorMessage(error)}`);
			this.#io.close(1011, "send failed");
		}
	}

	#error(id: string | undefined, code: ErrorCode, message: string, data?: unknown): void {
		this.#respond({
			type: "error",
			...(id === undefined ? {} : { id }),
			error: {
				code,
				message,
				...(data === undefined ? {} : { data }),
			},
		});
	}
}
