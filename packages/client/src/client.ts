/**
 * The framework-free harness client: one WebSocket, a `hello` handshake, correlated requests, reconnects with backoff,
 * project/model/credential calls, conversation submissions, and live views that survive a dropped socket.
 *
 * Only `WebSocket` is platform-specific; pass a `webSocketFactory` for a host whose global differs.
 */
import type {
	Artifact,
	ArtifactsChangedEvent,
	ArtifactsDeleteResponse,
	ArtifactsUpdateResponse,
	ArtifactsListResponse,
	ArtifactsUrlResponse,
	AuthLogin,
	Board,
	BoardGetResponse,
	BoardQuestion,
	BoardQuestionAnswerResponse,
	BoardTask,
	BoardTaskHistoryResponse,
	BoardTaskTimelineResponse,
	BoardFeedbackSetResponse,
	BoardTimelineKind,
	BoardTimelineEntry,
	BoardFeedback,
	BoardFeedbackState,
	BoardTaskInput,
	BoardTaskSaveResponse,
	BoardTaskSnapshot,
	BoardTasksReorderResponse,
	DraftAttachment,
	DraftAuthor,
	DraftContent,
	DraftsAttachmentGetResponse,
	DraftsAttachmentPutResponse,
	DraftsChangedEvent,
	DraftsGetResponse,
	DraftsSetResponse,
	ChatDraft,
	ClientMessage,
	ConversationAbortResponse,
	ConversationWithdrawResponse,
	ConversationCompactResponse,
	ConversationContext,
	ConversationContextResponse,
	ConversationPageResponse,
	ConversationSubmitResponse,
	ConversationWatchResponse,
	CredentialInfo,
	CredentialsDeleteResponse,
	CredentialsListResponse,
	CredentialsLoginAnswerResponse,
	CredentialsLoginCancelResponse,
	CredentialsLoginStartResponse,
	CredentialsLoginsResponse,
	CredentialsSetResponse,
	ErrorResponse,
	DirectoryEntry,
	FilesystemCompleteResponse,
	FilesystemCreateResponse,
	FilesystemDeleteResponse,
	FilesystemListResponse,
	FilesystemRenameResponse,
	InputContent,
	LongPromptCache,
	UiProof,
	MemoryChange,
	MemoryChangedEvent,
	MemoryFile,
	MemoryFileSummary,
	MemoryHistoryResponse,
	MemoryListResponse,
	MemoryMaintainResponse,
	MemoryMaintenanceSettings,
	MemoryReadResponse,
	MemoryScope,
	MemoryScopeStatus,
	MemorySearchHit,
	MemorySearchResponse,
	MemorySettingsSetResponse,
	MemoryStatusResponse,
	MemoryUndoResponse,
	ModelRef,
	ModelsListResponse,
	NotificationDevice,
	NotificationsConfigResponse,
	NotificationsDeviceResponse,
	NotificationsInteractionResponse,
	NotificationsPresenceResponse,
	NotificationsRegisterRequest,
	NotificationsRegisterResponse,
	NotificationsTestResponse,
	NotificationsUnregisterResponse,
	ProjectCheckIns,
	ProjectSummary,
	ProjectsAddResponse,
	ProjectsConfigureResponse,
	ProjectsListResponse,
	Response,
	Schedule,
	ScheduleInput,
	ScheduleRun,
	SchedulesDeleteResponse,
	SchedulesListResponse,
	SchedulesRunResponse,
	SchedulesSaveResponse,
	ServerMessage,
	ServerStatus,
	ServerStatusResponse,
	ProjectsStorageCleanResponse,
	ProjectsStorageResponse,
	SubscriptionUsage,
	SubscriptionsUsageResponse,
	CacheStats,
	CacheStatsResponse,
	ProjectLinks,
	RefDetails,
	RefsDetailsResponse,
	RefStatus,
	RefsStatusResponse,
	ThinkingLevel,
	ThreadSummary,
	ThreadsArchiveResponse,
	ThreadsListResponse,
	ThreadsStopResponse,
	TerminalCloseResponse,
	TerminalKillResponse,
	TerminalListResponse,
	TerminalOpenResponse,
	TerminalResizeResponse,
	WhenBusy,
	WorkerDefaults,
	WorkerModel,
	WorkerSummary,
	WorkersDefaultsSetResponse,
	WorkersListResponse,
} from "@aiki/protocol";
import { LEGACY_HARNESS_FEATURES, PROTOCOL_VERSION, TERMINAL_FRAME, decodeTerminalFrame, encodeTerminalAck, encodeTerminalFrame } from "@aiki/protocol";
import { backoffDelay, canRetry, type BackoffOptions } from "./backoff.ts";
import { ClientError, errorFromResponse, errorMessage } from "./errors.ts";
import { memoryChangedIsFor, type MemoryTarget } from "./memory.ts";
import type { ProjectStorage, StorageCleanResult } from "./storage.ts";
import type { SchedulesSnapshot } from "./schedules.ts";
import { TerminalSession, type TerminalHostApi, type TerminalOpenOptions } from "./terminal.ts";
import { threadField, type ThreadsSnapshot } from "./threads.ts";
import {
	ConversationWatch,
	type ClientConnectionStatus,
	type ConversationWatchOptions,
	type WatchHost,
} from "./watch.ts";
import { defaultWebSocketFactory, type HarnessWebSocket, type WebSocketFactory } from "./websocket.ts";

type WithOptionalId<T> = T extends unknown ? Omit<T, "id"> & { id?: string } : never;

/** A request without an ID; the client assigns one and the server echoes it. */
export type ClientRequest = WithOptionalId<ClientMessage>;

export type DeviceAuthEvent = Extract<ServerMessage, { type: "auth.devicesChanged" | "auth.pairingRequested" | "auth.sessionRevoked" }>;

export type ClientState = {
	status: ClientConnectionStatus;
	/** Reconnect attempt number; zero while connected. */
	attempt: number;
	server?: { name: string; version: string };
	/** What the server implements. An older server that does not list features supports the original set. */
	features?: readonly string[];
	backendId?: string;
	auth?: { mode: "off" | "optional" | "required"; sessionId: string | null; accessExpiresAt: string | null };
	error?: string;
};

export type HarnessClientOptions = {
	/** WebSocket URL, including the `/ws` path. */
	url: string;
	/** Runs before opening each socket. Tokens never enter client state. Errors may set retryable explicitly. */
	prepareHello?: () => Promise<string | undefined>;
	webSocketFactory?: WebSocketFactory;
	clientName?: string;
	clientVersion?: string;
	/** Protocol version to announce. Default: this client's compiled-in version. */
	protocolVersion?: number;
	requestTimeoutMs?: number;
	/** Default true. `false` disables automatic reconnects; an object tunes the backoff. */
	reconnect?: boolean | BackoffOptions;
};

export type ProjectChange = {
	name?: string;
	coordinatorModel?: ModelRef | null;
	coordinatorThinkingLevel?: ThinkingLevel | null;
	workerModels?: WorkerModel[] | null;
	/** `null` restores the server's defaults (enabled, every 10 minutes). */
	checkIns?: ProjectCheckIns | null;
	/** `null` restores the server's default (`coordinators`). */
	longPromptCache?: LongPromptCache | null;
	keepPromptCacheWarm?: boolean | null;
	promptCacheWarmHours?: 1 | 2 | 4 | 8 | null;
	/** `null` restores the server's default (`screenshots-and-videos`); needs feature `ui-proof`. */
	uiProof?: UiProof | null;
	/** `null` goes back to letting the server fill them in. */
	links?: ProjectLinks | null;
	/** `true` archives the project, `false` unarchives it (feature `project-archive`). */
	archived?: boolean;
};

export type SubmitOptions = {
	/** The background thread to send to; absent (or "main") for main. */
	threadId?: string;
	whenBusy?: WhenBusy;
	/** Reuse after a reconnect so a submission already admitted is found instead of run twice. */
	requestId?: string;
	/** Worker model the user picked with this message; workers the coordinator starts from now on use it. */
	workerModel?: ModelRef | null;
	workerThinkingLevel?: ThinkingLevel | null;
	/** The board task this message is about; the server prefixes the text with `[task <id>] `. */
	taskId?: string;
	/** Do not let the backend clear the chat's draft for this message: it is not what the composer holds (a retry). */
	keepDraft?: boolean;
};

export type PageOptions = {
	limit?: number;
	order?: "ascending" | "descending";
	minEntryId?: number;
	maxEntryId?: number;
	before?: number;
	cursor?: Record<string, unknown>;
};

/**
 * Which memory scope a request addresses. `projectId` is required for `project`; for `global` it is ignored, because a
 * global memory belongs to the backend and not to a project.
 */
export type MemoryQuery = MemoryTarget & {
	/** Archived topic files too, for a list; a search returns them only when asked. Default false. */
	includeArchived?: boolean;
};

export type MemorySearchOptions = {
	/** `both` searches the global scope and the project's, so it needs the project. */
	scope: MemoryScope | "both";
	projectId?: string;
	query: string;
	tags?: readonly string[];
	includeArchived?: boolean;
	limit?: number;
};

/** A project's workers and the worker model it starts from, as `workers.list` returns them. */
export type WorkersSnapshot = {
	workers: WorkerSummary[];
	defaults: WorkerDefaults;
};

/**
 * One scope's maintenance state and the backend's maintenance settings, from `memory.status`. The timezone is the
 * backend's: maintenance times are read there, never in the browser.
 */
export type MemoryStatusSnapshot = {
	status: MemoryScopeStatus;
	maintenance: MemoryMaintenanceSettings;
	timezone: string;
};

type Pending = {
	resolve(message: ServerMessage): void;
	reject(error: Error): void;
	timer: ReturnType<typeof setTimeout>;
};

export class HarnessClient {
	readonly url: string;

	readonly #prepareHello: HarnessClientOptions["prepareHello"];
	#preparing = false;
	readonly #deviceAuthListeners = new Set<(event: DeviceAuthEvent) => void>();
	readonly #webSocketFactory: WebSocketFactory;
	readonly #clientName: string;
	readonly #clientVersion: string | undefined;
	readonly #protocolVersion: number;
	readonly #requestTimeoutMs: number;
	readonly #reconnect: boolean;
	readonly #backoff: BackoffOptions;

	#state: ClientState = { status: "idle", attempt: 0 };
	readonly #listeners = new Set<(state: ClientState) => void>();
	readonly #projectListeners = new Set<(project: ProjectSummary) => void>();
	readonly #workerListeners = new Set<(state: WorkersSnapshot & { projectId: string }) => void>();
	readonly #contextListeners = new Set<(context: ConversationContext) => void>();
	readonly #serverStatusListeners = new Set<(status: ServerStatus) => void>();
	readonly #memoryListeners = new Set<(event: MemoryChangedEvent) => void>();
	readonly #scheduleListeners = new Set<(state: SchedulesSnapshot & { projectId: string }) => void>();
	readonly #boardListeners = new Set<(state: { projectId: string; board: Board }) => void>();
	readonly #threadListeners = new Set<(state: ThreadsSnapshot & { projectId: string }) => void>();
	readonly #subscriptionUsageListeners = new Set<(subscriptions: SubscriptionUsage[]) => void>();
	readonly #artifactListeners = new Set<(event: ArtifactsChangedEvent) => void>();
	readonly #draftListeners = new Set<(event: DraftsChangedEvent) => void>();
	readonly #loginListeners = new Set<(login: AuthLogin) => void>();
	readonly #errorListeners = new Set<(error: ClientError) => void>();
	readonly #pending = new Map<string, Pending>();
	readonly #watches = new Set<ConversationWatch>();
	/** The terminals attached on the current socket, by the ID the server gave them. */
	readonly #terminalsById = new Map<number, TerminalSession>();

	#socket: HarnessWebSocket | undefined;
	#reconnectTimer: ReturnType<typeof setTimeout> | undefined;
	#readySince: number | undefined;
	#attempt = 0;
	#sequence = 0;
	#closedByUser = false;
	#fatal = false;

	constructor(options: HarnessClientOptions) {
		this.url = options.url;
		this.#prepareHello = options.prepareHello;
		this.#webSocketFactory = options.webSocketFactory ?? defaultWebSocketFactory;
		this.#clientName = options.clientName ?? "aiki-client";
		this.#clientVersion = options.clientVersion;
		this.#protocolVersion = options.protocolVersion ?? PROTOCOL_VERSION;
		this.#requestTimeoutMs = options.requestTimeoutMs ?? 20_000;
		this.#reconnect = options.reconnect !== false;
		this.#backoff = typeof options.reconnect === "object" ? options.reconnect : {};
	}

	get state(): ClientState {
		return this.#state;
	}

	get connected(): boolean {
		return this.#state.status === "ready";
	}

	subscribe(listener: (state: ClientState) => void): () => void {
		this.#listeners.add(listener);
		return () => this.#listeners.delete(listener);
	}

	/** Project state pushed by the server; the project list can stay current without polling. */
	onProjectState(listener: (project: ProjectSummary) => void): () => void {
		this.#projectListeners.add(listener);
		return () => this.#projectListeners.delete(listener);
	}

	/**
	 * Worker lists pushed by the server, one per change: spawn, status, report, stop, or a newly picked worker model.
	 * Each event carries the project's whole list, so a consumer replaces what it holds.
	 */
	onWorkersState(listener: (state: WorkersSnapshot & { projectId: string }) => void): () => void {
		this.#workerListeners.add(listener);
		return () => this.#workerListeners.delete(listener);
	}

	/**
	 * Conversation contexts pushed by the server, one for every change while this connection watches that conversation:
	 * a skill was read, a worker was spawned, an AGENTS.md file was edited. The event carries the whole context, and
	 * contexts for every conversation watched by this connection arrive here, so a listener filters with
	 * `contextIsFor`.
	 */
	onContextChanged(listener: (context: ConversationContext) => void): () => void {
		this.#contextListeners.add(listener);
		return () => this.#contextListeners.delete(listener);
	}

	/**
	 * Server status pushed by the server when its release or its last deploy outcome changes, for every connection. The
	 * event carries the whole status, `busy` included; ask with `readServerStatus` for the busy counts between events.
	 */
	onServerStatusChanged(listener: (status: ServerStatus) => void): () => void {
		this.#serverStatusListeners.add(listener);
		return () => this.#serverStatusListeners.delete(listener);
	}

	/**
	 * `memory.changed` events, pushed to every connection when a scope's files change: a write, an archive, an edit by
	 * hand. The event names the scope and the project (null for global); read again with `listMemory`, `readMemory`,
	 * `searchMemory` and `readMemoryHistory`. A listener that watches one scope filters with `memoryChangedIsFor`.
	 */
	onMemoryChanged(listener: (event: MemoryChangedEvent) => void): () => void {
		this.#memoryListeners.add(listener);
		return () => this.#memoryListeners.delete(listener);
	}

	/**
	 * Schedule lists pushed by the server, one per change (`schedules.state`): a schedule was created, edited, deleted or
	 * run, or its runs changed. Each event carries the project's whole list and the backend's timezone, so a consumer
	 * replaces what it holds; a listener filters with `schedulesStateIsFor`.
	 */
	onSchedulesState(listener: (state: SchedulesSnapshot & { projectId: string }) => void): () => void {
		this.#scheduleListeners.add(listener);
		return () => this.#scheduleListeners.delete(listener);
	}

	/**
	 * A project's board, pushed to every connection whenever it changes (`board.state`): without archived tasks, and
	 * whole, so a consumer replaces what it holds. A listener filters with `boardStateIsFor`.
	 */
	onBoardState(listener: (state: { projectId: string; board: Board }) => void): () => void {
		this.#boardListeners.add(listener);
		return () => this.#boardListeners.delete(listener);
	}

	/**
	 * A project's threads without archived ones, pushed to every connection whenever any changes (`threads.state`):
	 * status, current line, workers, owned tasks. Whole, so a consumer replaces what it holds; a listener filters with
	 * `threadsStateIsFor`.
	 */
	onThreadsState(listener: (state: ThreadsSnapshot & { projectId: string }) => void): () => void {
		this.#threadListeners.add(listener);
		return () => this.#threadListeners.delete(listener);
	}

	/**
	 * Every subscription's usage, pushed to every connection when a read changes any of the numbers
	 * (`subscriptions.usage.changed`). The event carries the whole list, so a consumer replaces what it holds.
	 */
	onSubscriptionsUsageChanged(listener: (subscriptions: SubscriptionUsage[]) => void): () => void {
		this.#subscriptionUsageListeners.add(listener);
		return () => this.#subscriptionUsageListeners.delete(listener);
	}

	/**
	 * One artifact saved or deleted (`artifacts.changed`), pushed to every connection. A listener whose list could hold it
	 * takes it in (`applyArtifactChange`) or reads again; `artifactsChangedIsFor` filters.
	 */
	onArtifactsChanged(listener: (event: ArtifactsChangedEvent) => void): () => void {
		this.#artifactListeners.add(listener);
		return () => this.#artifactListeners.delete(listener);
	}

	/**
	 * A chat's draft changed on another connection, or a message sent to the chat cleared it (`drafts.changed`; feature
	 * `chat-drafts`). The event carries the whole entry; the sync rules for what to do with it are `decideRemoteDraft`'s.
	 */
	onDraftsChanged(listener: (event: DraftsChangedEvent) => void): () => void {
		this.#draftListeners.add(listener);
		return () => this.#draftListeners.delete(listener);
	}

	/** Protocol errors that belong to no request, and failures of pushes. */
	onError(listener: (error: ClientError) => void): () => void {
		this.#errorListeners.add(listener);
		return () => this.#errorListeners.delete(listener);
	}

	/** OAuth login changes pushed by the server: new prompts, auth URLs, progress and outcomes. */
	onLogin(listener: (login: AuthLogin) => void): () => void {
		this.#loginListeners.add(listener);
		return () => this.#loginListeners.delete(listener);
	}

	onDeviceAuth(listener: (event: DeviceAuthEvent) => void): () => void {
		this.#deviceAuthListeners.add(listener);
		return () => this.#deviceAuthListeners.delete(listener);
	}

	/** Start connecting. Idempotent; requests also call this. */
	connect(): void {
		if (this.#state.status === "ready" || this.#state.status === "connecting" || this.#state.status === "reconnecting") {
			return;
		}
		this.#closedByUser = false;
		this.#fatal = false;
		this.#attempt = 0;
		this.#openSocket();
	}

	/** Wait until the handshake has completed, or reject on timeout or a closed client. */
	whenReady(timeoutMs = this.#requestTimeoutMs): Promise<void> {
		if (this.#state.status === "ready") return Promise.resolve();
		if (this.#fatal) return Promise.reject(new ClientError("closed", this.#state.error ?? "Connection closed"));
		this.connect();
		return new Promise((resolve, reject) => {
			const finish = (): void => {
				clearTimeout(timer);
				unsubscribe();
			};
			const timer = setTimeout(() => {
				finish();
				reject(new ClientError("timeout", `Not connected after ${timeoutMs}ms`));
			}, timeoutMs);
			const unsubscribe = this.subscribe((state) => {
				if (state.status === "ready") {
					finish();
					resolve();
				} else if (state.status === "closed") {
					finish();
					reject(new ClientError("closed", state.error ?? "Connection closed"));
				}
			});
		});
	}

	/** Stop reconnecting and close the socket. Watches keep their local state for a later `connect()`. */
	close(): void {
		this.#closedByUser = true;
		this.#readySince = undefined;
		this.#clearReconnect();
		const socket = this.#socket;
		this.#socket = undefined;
		if (socket !== undefined) {
			try {
				socket.close(1000, "client closed");
			} catch {
				// Already gone.
			}
		}
		this.#rejectPending(new ClientError("closed", "Connection closed by the client"));
		this.#setState({ status: "closed", attempt: this.#attempt, error: undefined });
	}

	/**
	 * Drop the current socket but keep the client running, so the reconnect loop starts. Used when an app resumes from
	 * the background and does not trust the old socket.
	 */
	disconnect(reason = "Connection dropped by the client"): void {
		this.#socket?.close(1000, reason);
	}

	/** Send one request (an ID is added when absent) and return its response, errors included. */
	async request<T extends Response = Response>(message: ClientRequest, timeoutMs = this.#requestTimeoutMs): Promise<T | ErrorResponse> {
		if (this.#fatal) throw new ClientError("closed", this.#state.error ?? "Connection closed");
		this.connect();
		await this.whenReady(timeoutMs);
		const socket = this.#socket;
		if (socket === undefined || this.#state.status !== "ready") {
			throw new ClientError("disconnected", "Not connected");
		}
		return (await this.#sendOn(socket, message, timeoutMs)) as T | ErrorResponse;
	}

	async listProjects(): Promise<ProjectSummary[]> {
		const response = await this.#call<ProjectsListResponse>({ type: "projects.list" });
		return response.projects;
	}

	async addProject(path: string): Promise<ProjectSummary> {
		const response = await this.#call<ProjectsAddResponse>({ type: "projects.add", path });
		return response.project;
	}

	async configureProject(projectId: string, change: ProjectChange): Promise<ProjectSummary> {
		const response = await this.#call<ProjectsConfigureResponse>({
			type: "projects.configure",
			projectId,
			...(change.name === undefined ? {} : { name: change.name }),
			...(change.coordinatorModel === undefined ? {} : { coordinatorModel: change.coordinatorModel }),
			...(change.coordinatorThinkingLevel === undefined
				? {}
				: { coordinatorThinkingLevel: change.coordinatorThinkingLevel }),
			...(change.workerModels === undefined ? {} : { workerModels: change.workerModels }),
			...(change.checkIns === undefined ? {} : { checkIns: change.checkIns }),
			...(change.longPromptCache === undefined ? {} : { longPromptCache: change.longPromptCache }),
			...(change.keepPromptCacheWarm === undefined ? {} : { keepPromptCacheWarm: change.keepPromptCacheWarm }),
			...(change.promptCacheWarmHours === undefined ? {} : { promptCacheWarmHours: change.promptCacheWarmHours }),
			...(change.uiProof === undefined ? {} : { uiProof: change.uiProof }),
			...(change.links === undefined ? {} : { links: change.links }),
			...(change.archived === undefined ? {} : { archived: change.archived }),
		});
		return response.project;
	}

	listModels(): Promise<ModelsListResponse> {
		return this.#call<ModelsListResponse>({ type: "models.list" });
	}

	/** List one host directory's subdirectories. Without a path it starts at the server user's home directory. */
	listDirectory(options: { path?: string; showHidden?: boolean } = {}): Promise<FilesystemListResponse> {
		return this.#call<FilesystemListResponse>({
			type: "filesystem.list",
			...(options.path === undefined ? {} : { path: options.path }),
			...(options.showHidden === undefined ? {} : { showHidden: options.showHidden }),
		});
	}

	/** Folders a typed path (absolute or `~…`) could continue to. Needs `filesystem-complete`. */
	completeDirectory(input: string, options: { showHidden?: boolean } = {}): Promise<FilesystemCompleteResponse> {
		return this.#call<FilesystemCompleteResponse>({
			type: "filesystem.complete",
			input,
			...(options.showHidden === undefined ? {} : { showHidden: options.showHidden }),
		});
	}

	/** Make a folder called `name` inside `path`. Needs `filesystem-edit`. */
	async createDirectory(path: string, name: string): Promise<DirectoryEntry> {
		const response = await this.#call<FilesystemCreateResponse>({ type: "filesystem.create", path, name });
		return response.entry;
	}

	/** Rename a folder within its parent. Refused for projects and what holds them. Needs `filesystem-edit`. */
	async renameDirectory(path: string, name: string): Promise<DirectoryEntry> {
		const response = await this.#call<FilesystemRenameResponse>({ type: "filesystem.rename", path, name });
		return response.entry;
	}

	/** Delete an empty folder; a folder with anything inside is refused. Needs `filesystem-edit`. */
	async deleteDirectory(path: string): Promise<void> {
		await this.#call<FilesystemDeleteResponse>({ type: "filesystem.delete", path });
	}

	async listCredentials(): Promise<CredentialInfo[]> {
		const response = await this.#call<CredentialsListResponse>({ type: "credentials.list" });
		return response.credentials;
	}

	async setCredential(providerId: string, apiKey: string): Promise<CredentialInfo> {
		const response = await this.#call<CredentialsSetResponse>({ type: "credentials.set", providerId, apiKey });
		return response.credential;
	}

	async deleteCredential(providerId: string): Promise<boolean> {
		const response = await this.#call<CredentialsDeleteResponse>({ type: "credentials.delete", providerId });
		return response.deleted;
	}

	/** Every OAuth login the server knows: running ones, plus finished ones kept for display. */
	async listLogins(): Promise<AuthLogin[]> {
		const response = await this.#call<CredentialsLoginsResponse>({ type: "credentials.logins" });
		return response.logins;
	}

	/**
	 * Start an OAuth login, or rejoin the one already running for that provider. Follow it with `onLogin`; the response
	 * is only the state at that moment.
	 */
	async startLogin(providerId: string): Promise<AuthLogin> {
		const response = await this.#call<CredentialsLoginStartResponse>({
			type: "credentials.loginStart",
			providerId,
		});
		return response.login;
	}

	/** Answer the login's current prompt. The value travels only to the server. */
	async answerLogin(loginId: string, promptId: string, value: string): Promise<AuthLogin> {
		const response = await this.#call<CredentialsLoginAnswerResponse>({
			type: "credentials.loginAnswer",
			loginId,
			promptId,
			value,
		});
		return response.login;
	}

	/** Abort a running login. Returns false when it had already finished. */
	async cancelLogin(loginId: string): Promise<boolean> {
		const response = await this.#call<CredentialsLoginCancelResponse>({
			type: "credentials.loginCancel",
			loginId,
		});
		return response.cancelled;
	}

	/**
	 * Submit user input. Returns the protocol submission ID and the deduplication request ID used, and with `queued-inputs` whether the run was busy (`queued`) or took it at once (`placed`). The request ID is
	 * random: the backend keeps it per conversation for good, so a counter that restarts with every page load or device
	 * would collide with an earlier message and be dropped as a duplicate.
	 */
	async submit(
		projectId: string,
		content: InputContent,
		options: SubmitOptions = {},
	): Promise<{ submissionId: number; requestId: string; status?: "queued" | "placed" }> {
		const requestId = options.requestId ?? `submit-${crypto.randomUUID()}`;
		const response = await this.#call<ConversationSubmitResponse>({
			type: "conversation.submit",
			projectId,
			...threadField(options.threadId),
			requestId,
			content,
			...(options.whenBusy === undefined ? {} : { whenBusy: options.whenBusy }),
			...(options.workerModel === undefined ? {} : { workerModel: options.workerModel }),
			...(options.workerThinkingLevel === undefined
				? {}
				: { workerThinkingLevel: options.workerThinkingLevel }),
			...(options.taskId === undefined ? {} : { taskId: options.taskId }),
			...(options.keepDraft === true ? { keepDraft: true } : {}),
		});
		return {
			submissionId: response.submissionId,
			requestId,
			...(response.status === undefined ? {} : { status: response.status }),
		};
	}

	async abort(projectId: string, options: { background?: boolean; threadId?: string } = {}): Promise<void> {
		const message: ClientRequest = {
			type: "conversation.abort",
			projectId,
			...threadField(options.threadId),
			...(options.background === undefined ? {} : { background: options.background }),
		};
		await this.#call<ConversationAbortResponse>(message);
	}

	/**
	 * Take back one message still waiting in the queue (feature `queued-inputs`), by the submission ID `submit` answered
	 * with or a `QueuedInput.id`. `already_placed` means the run took it first: it is in the transcript now.
	 */
	async withdraw(
		projectId: string,
		submissionId: number,
		options: { threadId?: string } = {},
	): Promise<ConversationWithdrawResponse["outcome"]> {
		const response = await this.#call<ConversationWithdrawResponse>({
			type: "conversation.withdraw",
			projectId,
			...threadField(options.threadId),
			submissionId,
		});
		return response.outcome;
	}

	/**
	 * Compact the coordinator's conversation now, with optional instructions for the summary. The server answers once
	 * the compaction is admitted; it runs in the background, its summary lands as a `pi.compaction` entry through the
	 * watch, and `ConversationContext.usage` reports `compacting` until it ends. Worker conversations are not compacted
	 * from the app, so the request names only the project and, for a background thread, the thread.
	 */
	async compact(projectId: string, options: { instructions?: string; threadId?: string } = {}): Promise<void> {
		const instructions = options.instructions?.trim();
		await this.#call<ConversationCompactResponse>({
			type: "conversation.compact",
			projectId,
			...threadField(options.threadId),
			...(instructions === undefined || instructions.length === 0 ? {} : { instructions }),
		});
	}

	/**
	 * A project's workers with their live status, and the worker model it starts from. With `threadId`, only that
	 * thread's workers (`"main"` is sent as is, since without it the list is every thread's).
	 */
	async listWorkers(projectId: string, options: { threadId?: string } = {}): Promise<WorkersSnapshot> {
		const response = await this.#call<WorkersListResponse>({
			type: "workers.list",
			projectId,
			...(options.threadId === undefined ? {} : { threadId: options.threadId }),
		});
		return { workers: response.workers, defaults: response.defaults };
	}

	/**
	 * Store the worker model new workers start from, as if it had been picked with a message, so a pick made in the
	 * composer applies without one. The server pushes the result to every connection through `workers.state`. A backend
	 * that predates the request answers `unknown_request`; callers then send the choice with the next message instead.
	 */
	async setWorkerDefaults(projectId: string, defaults: WorkerDefaults): Promise<WorkerDefaults> {
		const response = await this.#call<WorkersDefaultsSetResponse>({
			type: "workers.defaults.set",
			projectId,
			defaults,
		});
		return response.defaults;
	}

	/**
	 * The VAPID public key this backend signs its pushes with. Every backend should answer the same key, because a browser
	 * holds one push subscription; a backend older than the request answers `unknown_request`.
	 */
	async readNotificationsConfig(): Promise<string> {
		const response = await this.#call<NotificationsConfigResponse>({ type: "notifications.config" });
		return response.publicKey;
	}

	/**
	 * Register this browser's push subscription, its name and its preferences with this backend. Registering again
	 * replaces the stored device, so a preference change reaches a backend by registering again.
	 */
	async registerNotifications(
		registration: Omit<NotificationsRegisterRequest, "type" | "id">,
	): Promise<NotificationDevice> {
		const response = await this.#call<NotificationsRegisterResponse>({
			type: "notifications.register",
			...registration,
		});
		return response.device;
	}

	/** Delete this device from this backend: its subscription and its preferences. */
	async unregisterNotifications(deviceId: string): Promise<void> {
		await this.#call<NotificationsUnregisterResponse>({ type: "notifications.unregister", deviceId });
	}

	/** This device's registration on this backend, or null when it is not registered (or was forgotten). */
	async readNotificationDevice(deviceId: string): Promise<NotificationDevice | null> {
		const response = await this.#call<NotificationsDeviceResponse>({ type: "notifications.device", deviceId });
		return response.device;
	}

	/** Push a test notification to this device now, and report how the push service answered. */
	async sendTestNotification(deviceId: string): Promise<Omit<NotificationsTestResponse, "type" | "id">> {
		const response = await this.#call<NotificationsTestResponse>({ type: "notifications.test", deviceId });
		return { ok: response.ok, status: response.status, message: response.message };
	}

	/**
	 * Tell this backend whether this device's page is visible (an open app makes the backend hold notifications for 15 s).
	 * Sent on connect and on every visibility or route change; the server forgets it when the socket closes.
	 */
	async setNotificationsPresence(presence: {
		deviceId: string;
		visible: boolean;
		projectId: string | null;
	}): Promise<void> {
		await this.#call<NotificationsPresenceResponse>({
			type: "notifications.presence",
			deviceId: presence.deviceId,
			visible: presence.visible,
			projectId: presence.projectId,
		});
	}

	/**
	 * The user touched the app (feature `notification-hold`): the backend drops every notification it is holding, for every
	 * device. Callers throttle (`INTERACTION_REPORT_INTERVAL_MS`); this sends each call. Answers how many were dropped.
	 */
	async reportNotificationInteraction(deviceId: string): Promise<number> {
		const response = await this.#call<NotificationsInteractionResponse>({ type: "notifications.interaction", deviceId });
		return response.dropped;
	}

	/** A project's scheduled tasks and the backend's timezone. Follow changes with `onSchedulesState`. */
	async listSchedules(projectId: string): Promise<SchedulesSnapshot> {
		const response = await this.#call<SchedulesListResponse>({ type: "schedules.list", projectId });
		return { schedules: response.schedules, timezone: response.timezone };
	}

	/**
	 * Create a schedule (no `scheduleId`) or replace one. The server pushes the result to every connection through
	 * `schedules.state`; the answer is the schedule as stored, runs and next run included.
	 */
	async saveSchedule(projectId: string, schedule: ScheduleInput, scheduleId?: string): Promise<Schedule> {
		const response = await this.#call<SchedulesSaveResponse>({
			type: "schedules.save",
			projectId,
			...(scheduleId === undefined ? {} : { scheduleId }),
			schedule,
		});
		return response.schedule;
	}

	async deleteSchedule(projectId: string, scheduleId: string): Promise<void> {
		await this.#call<SchedulesDeleteResponse>({ type: "schedules.delete", projectId, scheduleId });
	}

	/**
	 * Run a schedule now, enabled or not. The answer is the run that was recorded: `started` with the worker's ID, or
	 * `skipped`/`failed` with the reason (a previous run of the same schedule still running is the usual skip).
	 */
	async runSchedule(projectId: string, scheduleId: string): Promise<ScheduleRun> {
		const response = await this.#call<SchedulesRunResponse>({ type: "schedules.run", projectId, scheduleId });
		return response.run;
	}

	/**
	 * A project's board: tasks, questions and decisions. Archived tasks (done or dropped for more than a week) are left
	 * out unless asked for. Follow changes with `onBoardState`.
	 */
	async readBoard(projectId: string, options: { includeArchived?: boolean } = {}): Promise<Board> {
		const response = await this.#call<BoardGetResponse>({
			type: "board.get",
			projectId,
			...(options.includeArchived === true ? { includeArchived: true } : {}),
		});
		return response.board;
	}

	/**
	 * Create a task (no `taskId`) or change one that was read at `expectedRevision`. A row that moved on since is refused
	 * with `board_conflict` (`boardConflict` reads it); the answer is the task as stored. A `note` (why the user made the
	 * change) reaches the coordinator with it; only a server with `board-moves` reads it.
	 */
	async saveBoardTask(
		projectId: string,
		task: BoardTaskInput,
		options: { taskId?: string; expectedRevision?: number; note?: string } = {},
	): Promise<BoardTask> {
		const response = await this.#call<BoardTaskSaveResponse>({
			type: "board.task.save",
			projectId,
			...(options.taskId === undefined ? {} : { taskId: options.taskId }),
			...(options.expectedRevision === undefined ? {} : { expectedRevision: options.expectedRevision }),
			...(options.note === undefined ? {} : { note: options.note }),
			task,
		});
		return response.task;
	}

	/** Put tasks in this order; tasks not named keep their place after them. */
	async reorderBoardTasks(projectId: string, taskIds: string[]): Promise<void> {
		await this.#call<BoardTasksReorderResponse>({ type: "board.tasks.reorder", projectId, taskIds });
	}

	/**
	 * Answer an open question read at `expectedRevision`. `board_conflict` when it was answered or withdrawn since. The
	 * answer reaches the coordinator like a message.
	 */
	async answerBoardQuestion(
		projectId: string,
		questionId: string,
		expectedRevision: number,
		answer: string,
	): Promise<BoardQuestion> {
		const response = await this.#call<BoardQuestionAnswerResponse>({
			type: "board.question.answer",
			projectId,
			questionId,
			expectedRevision,
			answer,
		});
		return response.question;
	}

	/**
	 * A task's timeline, oldest first (all kinds, or only `kinds`), and its feedback entries, open ones first. Needs
	 * `task-links`.
	 */
	async readTaskTimeline(
		projectId: string,
		taskId: string,
		options: { kinds?: BoardTimelineKind[] } = {},
	): Promise<{ entries: BoardTimelineEntry[]; feedback: BoardFeedback[] }> {
		const response = await this.#call<BoardTaskTimelineResponse>({
			type: "board.task.timeline",
			projectId,
			taskId,
			...(options.kinds === undefined ? {} : { kinds: options.kinds }),
		});
		return { entries: response.entries, feedback: response.feedback };
	}

	/** Set a feedback entry's state: the user dismisses or reopens it. Answers the entry as stored. Needs `task-links`. */
	async setFeedbackState(
		projectId: string,
		taskId: string,
		feedbackId: string,
		state: BoardFeedbackState,
		note?: string,
	): Promise<BoardFeedback> {
		const response = await this.#call<BoardFeedbackSetResponse>({
			type: "board.feedback.set",
			projectId,
			taskId,
			feedbackId,
			state,
			...(note === undefined ? {} : { note }),
		});
		return response.feedback;
	}

	/** A task's snapshots, oldest first: one per milestone a report write named and one per status change. */
	async readTaskHistory(projectId: string, taskId: string): Promise<BoardTaskSnapshot[]> {
		const response = await this.#call<BoardTaskHistoryResponse>({ type: "board.task.history", projectId, taskId });
		return response.snapshots;
	}

	/**
	 * A project's threads, main first. Archived background threads only with `includeArchived`. Follow changes with
	 * `onThreadsState`.
	 */
	async listThreads(projectId: string, options: { includeArchived?: boolean } = {}): Promise<ThreadsSnapshot> {
		const response = await this.#call<ThreadsListResponse>({
			type: "threads.list",
			projectId,
			...(options.includeArchived === true ? { includeArchived: true } : {}),
		});
		return { threads: response.threads };
	}

	/** Stop a background thread: its running turn and workers are aborted. Main cannot be stopped this way. */
	async stopThread(projectId: string, threadId: string): Promise<ThreadSummary> {
		const response = await this.#call<ThreadsStopResponse>({ type: "threads.stop", projectId, threadId });
		return response.thread;
	}

	/** Archive a background thread, or bring it back with `archived: false`. */
	async archiveThread(projectId: string, threadId: string, archived = true): Promise<ThreadSummary> {
		const response = await this.#call<ThreadsArchiveResponse>({
			type: "threads.archive",
			projectId,
			threadId,
			archived,
		});
		return response.thread;
	}

	/**
	 * What one conversation's model is given besides the transcript: its project path and cwd, AGENTS.md files, skills,
	 * tools and full system prompt. Without `workerId` this is the coordinator's context; with one, that worker's. Follow
	 * changes with `onContextChanged`; this returns the state at the moment of the request.
	 */
	async readContext(
		projectId: string,
		options: { workerId?: string; threadId?: string } = {},
	): Promise<ConversationContext> {
		const message: ClientRequest = {
			type: "conversation.context",
			projectId,
			...threadField(options.threadId),
			...(options.workerId === undefined ? {} : { workerId: options.workerId }),
		};
		const response = await this.#call<ConversationContextResponse>(message);
		return response.context;
	}

	/**
	 * This server's own status: the release it runs, how its last deploy went, and what a restart would interrupt right
	 * now. Follow the pushed changes with `onServerStatusChanged`; after a reconnect ask again, because a deploy restarts
	 * the server and the events sent while away are lost.
	 */
	async readServerStatus(): Promise<ServerStatus> {
		const response = await this.#call<ServerStatusResponse>({ type: "server.status" });
		return response.status;
	}

	/**
	 * Every logged-in subscription's rate-limit windows. The server answers from its last read unless `refresh` asks it to
	 * read the providers now. Follow changes with `onSubscriptionsUsageChanged`; after a reconnect ask again.
	 */
	async readSubscriptionsUsage(options: { refresh?: boolean } = {}): Promise<SubscriptionUsage[]> {
		const response = await this.#call<SubscriptionsUsageResponse>({
			type: "subscriptions.usage",
			...(options.refresh === undefined ? {} : { refresh: options.refresh }),
		});
		return response.subscriptions;
	}

	/**
	 * The live state of a project's refs (pull requests, issues, Jira tickets) that the backend can read; the rest are left
	 * out. The backend caches, so asking every few minutes is fine. Needs `ref-status`.
	 */
	async readRefStatus(projectId: string, refs: readonly string[]): Promise<RefStatus[]> {
		const response = await this.#call<RefsStatusResponse>({ type: "refs.status", projectId, refs: [...refs] });
		return response.statuses;
	}

	/**
	 * What a ref's card shows: a pull request's branches, checks and reviews, an issue's people, a ticket's people,
	 * parent and sprint. Null when the backend cannot read it. The backend caches briefly. Needs `ref-details`.
	 */
	async readRefDetails(projectId: string, ref: string): Promise<RefDetails | null> {
		const response = await this.#call<RefsDetailsResponse>({ type: "refs.details", projectId, ref });
		return response.details;
	}

	/**
	 * What the backend's model requests cost over the last `days` (default 30), and how much of it re-billed a prompt the
	 * provider should still have cached: why, where, and what a longer cache would have saved. Needs `cache-stats`.
	 */
	/** Spend one saved reset only after the user confirms. Needs subscription-resets. */
	async resetSubscription(options: Omit<import("@aiki/protocol").SubscriptionsResetRequest, "type" | "id">): Promise<import("@aiki/protocol").SubscriptionsResetResponse> {
		return this.#call<import("@aiki/protocol").SubscriptionsResetResponse>({type:"subscriptions.reset",...options});
	}

	async readCacheStats(options: { days?: number; projectId?: string; utcOffsetMinutes?: number; calendarToday?: boolean } = {}): Promise<CacheStats> {
		const response = await this.#call<CacheStatsResponse>({
			type: "cache.stats",
			...(options.days === undefined ? {} : { days: options.days }),
			...(options.calendarToday === undefined ? {} : { calendarToday: options.calendarToday }),
			...(options.projectId === undefined ? {} : { projectId: options.projectId }),
			...(options.utcOffsetMinutes === undefined ? {} : { utcOffsetMinutes: options.utcOffsetMinutes }),
		});
		return response.stats;
	}

	/**
	 * A project's artifacts, newest first, narrowed by thread, worker and board task when given. Follow changes with
	 * `onArtifactsChanged`; after a reconnect ask again.
	 */
	async listArtifacts(
		projectId: string,
		filter: { threadId?: string; workerId?: string; taskId?: string; limit?: number } = {},
	): Promise<Artifact[]> {
		const response = await this.#call<ArtifactsListResponse>({
			type: "artifacts.list",
			projectId,
			...(filter.threadId === undefined ? {} : { threadId: filter.threadId }),
			...(filter.workerId === undefined ? {} : { workerId: filter.workerId }),
			...(filter.taskId === undefined ? {} : { taskId: filter.taskId }),
			...(filter.limit === undefined ? {} : { limit: filter.limit }),
		});
		return response.artifacts;
	}

	/**
	 * A URL on the backend's origin that loads one artifact's bytes (byte ranges included), signed for a few hours. With
	 * `download` the server answers it as an attachment. Ask again before `expiresAt` (`artifactUrlRefreshIn`).
	 */
	async readArtifactUrl(
		projectId: string,
		artifactId: string,
		options: { download?: boolean } = {},
	): Promise<{ url: string; expiresAt: string }> {
		const response = await this.#call<ArtifactsUrlResponse>({
			type: "artifacts.url",
			projectId,
			artifactId,
			...(options.download === true ? { download: true } : {}),
		});
		return { url: response.url, expiresAt: response.expiresAt };
	}

	/**
	 * Replace an artifact's tags (feature `artifact-tags`). The server normalises them and answers with the stored row;
	 * every connection gets `artifacts.changed` for it.
	 */
	async updateArtifactTags(projectId: string, artifactId: string, tags: readonly string[]): Promise<Artifact> {
		const response = await this.#call<ArtifactsUpdateResponse>({
			type: "artifacts.update",
			projectId,
			artifactId,
			tags: [...tags],
		});
		return response.artifact;
	}

	/** One chat's draft entry (an empty list when it has none), or every entry of the project; feature `chat-drafts`. */
	async readDrafts(projectId: string, threadId?: string): Promise<ChatDraft[]> {
		const response = await this.#call<DraftsGetResponse>({
			type: "drafts.get",
			projectId,
			...(threadId === undefined ? {} : { threadId }),
		});
		return response.drafts;
	}

	/**
	 * Write a chat's draft (`null` clears it) if `baseRevision` is the revision this device last saw (0 for none). A
	 * refused write has `applied: false` and the current entry in `draft`; nothing was changed. The other connections get
	 * `drafts.changed`.
	 */
	async writeDraft(
		projectId: string,
		threadId: string,
		content: DraftContent | null,
		baseRevision: number,
		device?: DraftAuthor,
	): Promise<{ applied: boolean; draft: ChatDraft | null }> {
		const response = await this.#call<DraftsSetResponse>({
			type: "drafts.set",
			projectId,
			threadId,
			content,
			baseRevision,
			...(device === undefined ? {} : { device }),
		});
		return { applied: response.applied, draft: response.draft };
	}

	/** Upload an image for a draft once; the draft then holds the returned reference. */
	async uploadDraftAttachment(projectId: string, mimeType: string, data: string, name?: string): Promise<DraftAttachment> {
		const response = await this.#call<DraftsAttachmentPutResponse>({
			type: "drafts.attachment.put",
			projectId,
			mimeType,
			data,
			...(name === undefined ? {} : { name }),
		});
		return response.attachment;
	}

	/** The bytes (base64) of an image a draft refers to. */
	async readDraftAttachment(projectId: string, attachmentId: string): Promise<{ attachment: DraftAttachment; data: string }> {
		const response = await this.#call<DraftsAttachmentGetResponse>({ type: "drafts.attachment.get", projectId, attachmentId });
		return { attachment: response.attachment, data: response.data };
	}

	/** Delete an artifact from the backend's store; `unknown_artifact` when it is already gone. */
	async deleteArtifact(projectId: string, artifactId: string): Promise<void> {
		await this.#call<ArtifactsDeleteResponse>({ type: "artifacts.delete", projectId, artifactId });
	}

	/**
	 * What a project's worker and thread workspaces take on disk, largest first. Sizes come from the server's background
	 * measurement, a few minutes old at most (`measuredAt`). Needs the `storage` feature.
	 */
	async readProjectStorage(projectId: string): Promise<ProjectStorage> {
		const response = await this.#call<ProjectsStorageResponse>({ type: "projects.storage", projectId });
		return { totalBytes: response.totalBytes, items: response.items, measuredAt: response.measuredAt };
	}

	/**
	 * Remove finished workspaces: these items, or every removable one without `itemIds`. The server refuses running ones
	 * and says why in `refused`; nothing is removed from the project checkout itself.
	 */
	async cleanProjectStorage(
		projectId: string,
		itemIds?: readonly string[],
	): Promise<StorageCleanResult> {
		const response = await this.#call<ProjectsStorageCleanResponse>({
			type: "projects.storage.clean",
			projectId,
			...(itemIds === undefined ? {} : { itemIds: [...itemIds] }),
		});
		return { removed: response.removed, freedBytes: response.freedBytes, refused: response.refused };
	}

	/**
	 * One memory scope's topic files, most recently updated first, archived ones only when asked. Follow changes with
	 * `onMemoryChanged`; this returns the state at the moment of the request.
	 */
	async listMemory(options: MemoryQuery): Promise<MemoryFileSummary[]> {
		const response = await this.#call<MemoryListResponse>({
			type: "memory.list",
			...memoryScopeOf(options),
			...(options.includeArchived === undefined ? {} : { includeArchived: options.includeArchived }),
		});
		return response.files;
	}

	/** One memory file: its front matter summary and the markdown body after it. */
	async readMemory(options: MemoryQuery & { fileId: string }): Promise<MemoryFile> {
		const response = await this.#call<MemoryReadResponse>({
			type: "memory.read",
			...memoryScopeOf(options),
			fileId: options.fileId,
		});
		return response.file;
	}

	/** Matching sections, best first, each with a snippet whose matches sit between `\u0002` and `\u0003`. */
	async searchMemory(options: MemorySearchOptions): Promise<MemorySearchHit[]> {
		const message: ClientRequest = {
			type: "memory.search",
			query: options.query,
			...memoryScopeOf(options),
			...(options.tags === undefined ? {} : { tags: [...options.tags] }),
			...(options.includeArchived === undefined ? {} : { includeArchived: options.includeArchived }),
			...(options.limit === undefined ? {} : { limit: options.limit }),
		};
		const response = await this.#call<MemorySearchResponse>(message);
		return response.hits;
	}

	/** One scope's commits, newest first: what changed and when, the undo trail of the memory's git repository. */
	async readMemoryHistory(options: MemoryQuery & { limit?: number }): Promise<MemoryChange[]> {
		const response = await this.#call<MemoryHistoryResponse>({
			type: "memory.history",
			...memoryScopeOf(options),
			...(options.limit === undefined ? {} : { limit: options.limit }),
		});
		return response.changes;
	}

	/**
	 * Revert one `extraction` or `maintenance` change: the whole commit, as one undo commit. The server refuses with
	 * `memory_conflict` when later changes touched the same files, and nothing is reverted; `memoryUndoConflict` reads
	 * that refusal. Answers with the undo commit.
	 */
	async undoMemory(options: MemoryQuery & { commit: string }): Promise<MemoryChange> {
		const response = await this.#call<MemoryUndoResponse>({
			type: "memory.undo",
			...memoryScopeOf(options),
			commit: options.commit,
		});
		return response.change;
	}

	/**
	 * One scope's maintenance state, the backend's maintenance settings and the backend's timezone. The settings belong to
	 * the backend, so any scope answers them.
	 */
	async readMemoryStatus(options: MemoryTarget): Promise<MemoryStatusSnapshot> {
		const response = await this.#call<MemoryStatusResponse>({
			type: "memory.status",
			...memoryScopeOf(options),
		});
		return { status: response.status, maintenance: response.maintenance, timezone: response.timezone };
	}

	/**
	 * Run maintenance on one scope now. It answers once the run has started; its outcome arrives as `memory.changed`, so
	 * read `memory.status` and the history again.
	 */
	async maintainMemory(options: MemoryTarget): Promise<void> {
		await this.#call<MemoryMaintainResponse>({ type: "memory.maintain", ...memoryScopeOf(options) });
	}

	/**
	 * Save the backend's maintenance settings: the model and thinking level it runs with, its nightly time in the
	 * backend's timezone, and how many writes trigger a run. A `null` model turns maintenance off.
	 */
	async setMemoryMaintenance(maintenance: MemoryMaintenanceSettings): Promise<MemoryMaintenanceSettings> {
		const response = await this.#call<MemorySettingsSetResponse>({
			type: "memory.settings.set",
			maintenance,
		});
		return response.maintenance;
	}

	async page(
		projectId: string,
		options: PageOptions & { workerId?: string; threadId?: string } = {},
	): Promise<ConversationPageResponse> {
		const message: ClientRequest = {
			type: "conversation.page",
			projectId,
			...threadField(options.threadId),
			...(options.workerId === undefined ? {} : { workerId: options.workerId }),
			...(options.limit === undefined ? {} : { limit: options.limit }),
			...(options.order === undefined ? {} : { order: options.order }),
			...(options.minEntryId === undefined ? {} : { minEntryId: options.minEntryId }),
			...(options.maxEntryId === undefined ? {} : { maxEntryId: options.maxEntryId }),
			...(options.before === undefined ? {} : { before: options.before }),
			...(options.cursor === undefined ? {} : { cursor: options.cursor }),
		};
		return this.#call<ConversationPageResponse>(message);
	}

	/**
	 * Watch the coordinator conversation. The watch reattaches by itself after reconnects and applies every view op in
	 * order; see `ConversationWatch`. With `threadId`, that background thread's conversation instead of main's.
	 */
	watchConversation(
		projectId: string,
		options: ConversationWatchOptions & { threadId?: string } = {},
	): ConversationWatch {
		const { threadId, ...watchOptions } = options;
		return this.#watch({ projectId, ...threadField(threadId) }, watchOptions);
	}

	/**
	 * Watch a worker's conversation read-only, exactly like the coordinator's: same window, ops and paging. Submit and
	 * abort do not take a worker, so a watch can never drive the worker.
	 */
	watchWorkerConversation(
		projectId: string,
		workerId: string,
		options: ConversationWatchOptions & { threadId?: string } = {},
	): ConversationWatch {
		const { threadId, ...watchOptions } = options;
		return this.#watch({ projectId, workerId, ...threadField(threadId) }, watchOptions);
	}

	#watch(
		target: { projectId: string; workerId?: string; threadId?: string },
		options: ConversationWatchOptions,
	): ConversationWatch {
		const workerId = target.workerId;
		const thread = threadField(target.threadId);
		const host: WatchHost = {
			projectId: target.projectId,
			...(workerId === undefined ? {} : { workerId }),
			...thread,
			state: () => this.#state,
			subscribe: (listener) => this.subscribe(listener),
			startWatch: (id, from, watchOptions) =>
				this.#call<ConversationWatchResponse>({
					type: "conversation.watch",
					projectId: id,
					...thread,
					...(workerId === undefined ? {} : { workerId }),
					...(from === undefined ? {} : { from }),
					...(watchOptions.min === undefined ? {} : { min: watchOptions.min }),
					...(watchOptions.max === undefined ? {} : { max: watchOptions.max }),
				}),
			pageEarlier: (id, pageOptions) =>
				this.#call<ConversationPageResponse>({
					type: "conversation.page",
					projectId: id,
					...thread,
					...(workerId === undefined ? {} : { workerId }),
					limit: pageOptions.limit,
					order: "descending",
					...(pageOptions.before === undefined ? {} : { before: pageOptions.before }),
					...(pageOptions.cursor === undefined ? {} : { cursor: pageOptions.cursor }),
				}),
			unwatch: (watchId) => this.#unwatch(watchId),
			remove: (watch) => {
				this.#watches.delete(watch);
			},
		};
		const watch = new ConversationWatch(host, options);
		this.#watches.add(watch);
		return watch;
	}

	/**
	 * Whether a terminal can be opened on this backend, why not, and every zellij session on it (the reattach list).
	 * Needs `terminal`.
	 */
	readTerminals(): Promise<TerminalListResponse> {
		return this.#call<TerminalListResponse>({ type: "terminal.list" });
	}

	/**
	 * Attach a terminal: a zellij session on the backend, streamed as bytes. Without `session` a new one is made from
	 * `prefix`. The handle reattaches the same session by itself after a dropped connection; see `TerminalSession`.
	 * Needs `terminal`.
	 */
	openTerminal(options: TerminalOpenOptions): TerminalSession {
		const host: TerminalHostApi = {
			isReady: () => this.#state.status === "ready",
			subscribe: (listener) => {
				const unsubscribe = this.subscribe((state) => listener(state.status === "ready"));
				if (this.#state.status === "ready") listener(true);
				else this.connect();
				return unsubscribe;
			},
			open: async (terminal, request) => {
				const response = await this.#call<TerminalOpenResponse>({ type: "terminal.open", ...request });
				this.#terminalsById.set(response.terminalId, terminal);
				return response;
			},
			resize: async (terminalId, cols, rows) => {
				await this.#call<TerminalResizeResponse>({ type: "terminal.resize", terminalId, cols, rows });
			},
			close: async (terminalId) => {
				await this.#call<TerminalCloseResponse>({ type: "terminal.close", terminalId });
			},
			sendInput: (terminalId, bytes) => this.#sendBinary(encodeTerminalFrame(TERMINAL_FRAME.input, terminalId, bytes)),
			sendAck: (terminalId, bytes) => this.#sendBinary(encodeTerminalAck(terminalId, bytes)),
			release: (terminal, terminalId) => {
				if (terminalId !== undefined && this.#terminalsById.get(terminalId) === terminal) this.#terminalsById.delete(terminalId);
				for (const [id, entry] of this.#terminalsById) if (entry === terminal) this.#terminalsById.delete(id);
			},
		};
		const terminal = new TerminalSession(host, options);
		terminal.start();
		return terminal;
	}

	/** End a zellij session on the backend: its processes are stopped. Anything attached to it ends. Needs `terminal`. */
	async killTerminalSession(session: string): Promise<void> {
		await this.#call<TerminalKillResponse>({ type: "terminal.kill", session });
	}

	#sendBinary(bytes: Uint8Array): boolean {
		const socket = this.#socket;
		if (socket === undefined || this.#state.status !== "ready") return false;
		try {
			socket.send(bytes);
			return true;
		} catch {
			return false;
		}
	}

	async #call<T extends Response>(message: ClientRequest, timeoutMs = this.#requestTimeoutMs): Promise<T> {
		const response = await this.request<T>(message, timeoutMs);
		if (response.type === "error") throw errorFromResponse(response);
		return response;
	}

	#nextRequestId(): string {
		this.#sequence += 1;
		return `c-${this.#sequence}`;
	}

	#openSocket(): void {
		void this.#prepareSocket();
	}

	async #prepareSocket(): Promise<void> {
		if (this.#socket !== undefined || this.#closedByUser || this.#fatal || this.#preparing) return;
		const attempt = this.#attempt;
		this.#setState({
			status: attempt === 0 ? "connecting" : "reconnecting",
			attempt,
			...(this.#state.error === undefined ? {} : { error: this.#state.error }),
		});

		let accessToken: string | undefined;
		if (this.#prepareHello) {
			this.#preparing = true;
			try { accessToken = await this.#prepareHello(); }
			catch (error) {
				const status = (error as { status?: number } | null)?.status;
				const transient = (error as { retryable?: boolean } | null)?.retryable ?? (error instanceof TypeError || (error instanceof DOMException && ["TimeoutError", "AbortError"].includes(error.name)) || status === 429 || (status !== undefined && status >= 500));
				this.#fatal = !transient;
				this.#setState({ status: transient ? "reconnecting" : "closed", attempt, error: errorMessage(error) });
				if (transient) this.#scheduleReconnect(status === 429 ? ((error as { retryAfter?: number }).retryAfter ?? 1) * 1000 : 0);
				return;
			} finally { this.#preparing = false; }
			if (this.#closedByUser) return;
		}
		let socket: HarnessWebSocket;
		try {
			socket = this.#webSocketFactory(this.url);
		} catch (error) {
			this.#setState({ status: "reconnecting", attempt, error: errorMessage(error) });
			this.#scheduleReconnect();
			return;
		}

		this.#socket = socket;
		socket.onopen = () => {
			if (this.#socket !== socket) return;
			void this.#handshake(socket, accessToken);
		};
		socket.onmessage = (event) => {
			if (this.#socket !== socket) return;
			this.#receive(event.data);
		};
		socket.onclose = (event) => this.#handleClose(socket, event);
		socket.onerror = () => {
			// A close event follows in browsers and Bun; `onclose` does the work.
		};
	}

	async #handshake(socket: HarnessWebSocket, accessToken?: string): Promise<void> {
		try {
			const response = await this.#sendOn(
				socket,
				{
					type: "hello",
					...(accessToken ? { auth: { accessToken } } : {}),
					protocolVersion: this.#protocolVersion,
					client: {
						name: this.#clientName,
						...(this.#clientVersion === undefined ? {} : { version: this.#clientVersion }),
					},
				},
				this.#requestTimeoutMs,
			);
			if (this.#socket !== socket) return;
			if (response.type === "error") {
				const error = errorFromResponse(response);
				const canRefresh = this.#prepareHello && ["auth_required", "auth_invalid", "auth_expired", "auth_revoked"].includes(error.code);
				if (error.code === "unsupported_protocol" || (error.code.startsWith("auth_") && !canRefresh)) {
					this.#fatal = true;
					this.#clearReconnect();
					this.#setState({ status: "closed", attempt: this.#attempt, error: error.message });
					this.#rejectPending(error);
					try {
						socket.close(1002, "unsupported protocol");
					} catch {
						// Already closing.
					}
					return;
				}
				throw error;
			}
			if (response.type !== "hello") {
				throw new ClientError("protocol", `Expected a hello response, got ${response.type}`);
			}
			// A hello alone does not prove recovery: repeated short-lived connections must keep backing off.
			this.#readySince = Date.now();
			this.#setState({
				status: "ready",
				attempt: 0,
				server: response.server,
				backendId: response.backendId,
				auth: response.auth,
				features: response.features ?? [...LEGACY_HARNESS_FEATURES],
				error: undefined,
			});
		} catch (error) {
			if (this.#socket !== socket) return;
			this.#setState({
				status: "reconnecting",
				attempt: this.#attempt,
				error: errorMessage(error),
			});
			try {
				socket.close(1000, "handshake failed");
			} catch {
				// Already gone.
			}
			this.#handleClose(socket, { reason: errorMessage(error) });
		}
	}

	#sendOn(socket: HarnessWebSocket, message: ClientRequest, timeoutMs: number): Promise<ServerMessage> {
		const id = message.id ?? this.#nextRequestId();
		const payload = { ...message, id } as ClientMessage;
		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				this.#pending.delete(id);
				reject(new ClientError("timeout", `No response to ${message.type} within ${timeoutMs}ms`));
			}, timeoutMs);
			this.#pending.set(id, {
				resolve: (response) => {
					clearTimeout(timer);
					resolve(response);
				},
				reject: (error) => {
					clearTimeout(timer);
					reject(error);
				},
				timer,
			});
			try {
				socket.send(JSON.stringify(payload));
			} catch (error) {
				this.#pending.delete(id);
				clearTimeout(timer);
				reject(new ClientError("disconnected", `Could not send ${message.type}`, { cause: error }));
			}
		});
	}

	#receive(data: unknown): void {
		if (typeof data !== "string") {
			const bytes = binaryOf(data);
			// `{` is not a frame kind, so JSON delivered as bytes still goes through the text path.
			if (bytes !== undefined && bytes.length > 0 && bytes[0] !== 0x7b) {
				this.#receiveFrame(bytes);
				return;
			}
		}
		let parsed: unknown;
		try {
			parsed = JSON.parse(textOf(data));
		} catch {
			return;
		}
		if (typeof parsed !== "object" || parsed === null) return;
		const message = parsed as ServerMessage;
		const id = (message as { id?: unknown }).id;
		if (typeof id === "string") {
			const pending = this.#pending.get(id);
			if (pending !== undefined) {
				this.#pending.delete(id);
				pending.resolve(message);
				return;
			}
		}

		switch (message.type) {
			case "conversation.view": {
				for (const watch of this.#watches) {
					if (watch.matchesServerWatch(message.watchId)) watch.applyOps(message.ops);
				}
				return;
			}
			case "conversation.watchEnded": {
				for (const watch of this.#watches) watch.handleEnded(message.watchId, message.reason, message.message);
				return;
			}
			case "project.state": {
				for (const listener of this.#projectListeners) {
					try {
						listener(message.project);
					} catch {
						// A consumer's listener must not break message handling.
					}
				}
				return;
			}
			case "workers.state": {
				for (const listener of this.#workerListeners) {
					try {
						listener({
							projectId: message.projectId,
							workers: message.workers,
							defaults: message.defaults,
						});
					} catch {
						// A consumer's listener must not break message handling.
					}
				}
				return;
			}
			case "conversation.context.changed": {
				for (const listener of this.#contextListeners) {
					try {
						listener(message.context);
					} catch {
						// A consumer's listener must not break message handling.
					}
				}
				return;
			}
			case "schedules.state": {
				for (const listener of this.#scheduleListeners) {
					try {
						listener({
							projectId: message.projectId,
							schedules: message.schedules,
							timezone: message.timezone,
						});
					} catch {
						// A consumer's listener must not break message handling.
					}
				}
				return;
			}
			case "threads.state": {
				for (const listener of this.#threadListeners) {
					try {
						listener({ projectId: message.projectId, threads: message.threads });
					} catch {
						// A consumer's listener must not break message handling.
					}
				}
				return;
			}
			case "board.state": {
				for (const listener of this.#boardListeners) {
					try {
						listener({ projectId: message.projectId, board: message.board });
					} catch {
						// A consumer's listener must not break message handling.
					}
				}
				return;
			}
			case "memory.changed": {
				for (const listener of this.#memoryListeners) {
					try {
						listener(message);
					} catch {
						// A consumer's listener must not break message handling.
					}
				}
				return;
			}
			case "drafts.changed": {
				for (const listener of this.#draftListeners) {
					try {
						listener(message);
					} catch {
						// A consumer's listener must not break message handling.
					}
				}
				return;
			}
			case "artifacts.changed": {
				for (const listener of this.#artifactListeners) {
					try {
						listener(message);
					} catch {
						// A consumer's listener must not break message handling.
					}
				}
				return;
			}
			case "subscriptions.usage.changed": {
				for (const listener of this.#subscriptionUsageListeners) {
					try {
						listener(message.subscriptions);
					} catch {
						// A consumer's listener must not break message handling.
					}
				}
				return;
			}
			case "server.status.changed": {
				for (const listener of this.#serverStatusListeners) {
					try {
						listener(message.status);
					} catch {
						// A consumer's listener must not break message handling.
					}
				}
				return;
			}
			case "terminal.closed": {
				this.#terminalsById.get(message.terminalId)?.receiveClosed(message);
				this.#terminalsById.delete(message.terminalId);
				return;
			}
			case "terminal.resync": {
				this.#terminalsById.get(message.terminalId)?.receiveResync();
				return;
			}
			case "credentials.login": {
				for (const listener of this.#loginListeners) {
					try {
						listener(message.login);
					} catch {
						// A consumer's listener must not break message handling.
					}
				}
				return;
			}
			case "auth.devicesChanged":
			case "auth.pairingRequested":
			case "auth.sessionRevoked": {
				for (const listener of this.#deviceAuthListeners) {
					try { listener(message); } catch { /* Consumer isolation. */ }
				}
				return;
			}
			case "error": {
				const error = errorFromResponse(message);
				for (const listener of this.#errorListeners) {
					try {
						listener(error);
					} catch {
						// A consumer's listener must not break message handling.
					}
				}
				return;
			}
			default:
				return;
		}
	}

	/** Terminal output: a binary frame for one of this socket's terminals. */
	#receiveFrame(bytes: Uint8Array): void {
		const frame = decodeTerminalFrame(bytes);
		if (frame === undefined || frame.kind !== TERMINAL_FRAME.output) return;
		this.#terminalsById.get(frame.terminalId)?.receiveOutput(frame.payload);
	}

	#handleClose(socket: HarnessWebSocket, event: { code?: number; reason?: string }): void {
		if (this.#socket !== socket) return;
		this.#socket = undefined;
		if (this.#readySince !== undefined && Date.now() - this.#readySince >= 60_000) this.#attempt = 0;
		this.#readySince = undefined;
		if ((event.code === 4401 || event.code === 4403) && !this.#prepareHello) {
			this.#fatal = true;
			this.#clearReconnect();
			this.#setState({ status: "closed", attempt: this.#attempt, error: event.code === 4403 ? "This device was signed out" : "Session expired" });
		}
		// The server detached every terminal of this socket; a handle attaches again when the client is ready.
		this.#terminalsById.clear();
		const reason = event.reason !== undefined && event.reason.length > 0 ? event.reason : "Connection lost";
		this.#rejectPending(new ClientError("disconnected", reason));
		if (this.#closedByUser || this.#fatal) {
			this.#setState({
				status: "closed",
				attempt: this.#attempt,
				...(this.#state.error === undefined ? {} : { error: this.#state.error }),
			});
			return;
		}
		this.#setState({ status: "reconnecting", attempt: this.#attempt, error: reason });
		this.#scheduleReconnect();
	}

	#scheduleReconnect(minDelayMs = 0): void {
		if (!this.#reconnect || this.#closedByUser || this.#fatal || this.#reconnectTimer !== undefined) return;
		if (!canRetry(this.#attempt, this.#backoff)) {
			this.#setState({
				status: "closed",
				attempt: this.#attempt,
				error: this.#state.error ?? "Could not reconnect",
			});
			return;
		}
		const delay = Math.max(minDelayMs, backoffDelay(this.#attempt, this.#backoff));
		this.#attempt += 1;
		this.#setState({ status: "reconnecting", attempt: this.#attempt, ...(this.#state.error === undefined ? {} : { error: this.#state.error }) });
		this.#reconnectTimer = setTimeout(() => {
			this.#reconnectTimer = undefined;
			if (this.#closedByUser || this.#fatal) return;
			this.#openSocket();
		}, delay);
	}

	#clearReconnect(): void {
		if (this.#reconnectTimer === undefined) return;
		clearTimeout(this.#reconnectTimer);
		this.#reconnectTimer = undefined;
	}

	#rejectPending(error: ClientError): void {
		const pending = [...this.#pending.values()];
		this.#pending.clear();
		for (const entry of pending) {
			clearTimeout(entry.timer);
			entry.reject(error);
		}
	}

	#unwatch(watchId: string): void {
		if (this.#state.status !== "ready") return;
		void this.request({ type: "conversation.unwatch", watchId }, Math.min(5_000, this.#requestTimeoutMs)).catch(
			() => undefined,
		);
	}

	#setState(next: ClientState): void {
		this.#state = next;
		for (const listener of this.#listeners) {
			try {
				listener(this.#state);
			} catch {
				// A consumer's listener must not break the connection.
			}
		}
	}
}

/** The scope fields of a memory request: a global one carries no project, a project one must. */
function memoryScopeOf<S extends MemoryScope | "both">(target: { scope: S; projectId?: string }): {
	scope: S;
	projectId?: string;
} {
	const scope = target.scope;
	if (scope === "global" || target.projectId === undefined) return { scope };
	return { scope, projectId: target.projectId };
}

/** The bytes of a binary WebSocket message, or undefined for anything else (a `Blob` is not read: set `binaryType`). */
function binaryOf(data: unknown): Uint8Array | undefined {
	if (data instanceof ArrayBuffer) return new Uint8Array(data);
	if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
	return undefined;
}

function textOf(data: unknown): string {
	if (typeof data === "string") return data;
	if (data instanceof ArrayBuffer) return new TextDecoder().decode(data);
	if (ArrayBuffer.isView(data)) return new TextDecoder().decode(data as Uint8Array);
	return String(data);
}
