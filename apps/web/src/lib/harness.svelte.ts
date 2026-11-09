/**
 * The app's per-backend harness connections and the reactive state screens read. Svelte runes live here; the client
 * package itself stays framework-free.
 *
 * One app connects to every configured backend at once. Each backend has its own socket, projects, models, logins and
 * transcript watches; the backend list is stored per browser by `backends.ts`.
 */
import {
	HarnessClient,
	contextIsFor,
	defaultsSetUnsupported,
	memoryChangedIsFor,
	schedulesStateIsFor,
	type ClientState,
	type ContextTarget,
	type ConversationWatchOptions,
	type ProjectChange,
	type WatchStatus,
	type WorkerDefaultsSupport,
} from "@mihai-harness/client";
import {
	HARNESS_FEATURES,
	type AuthLogin,
	type ConversationContext,
	type ConversationView,
	type CredentialInfo,
	type DeployStatus,
	type EntryRecord,
	type DirectoryEntry,
	type FilesystemCompleteResponse,
	type FilesystemListResponse,
	type HarnessFeature,
	type MemoryChange,
	type MemoryChangedEvent,
	type MemoryFile,
	type MemoryFileSummary,
	type MemoryMaintenanceSettings,
	type MemoryScope,
	type MemoryScopeStatus,
	type MemorySearchHit,
	type ModelInfo,
	type ModelRef,
	type ProjectSummary,
	type ProviderInfo,
	type Schedule,
	type ScheduleInput,
	type ScheduleRun,
	type ServerStatus,
	type WorkerDefaults,
	type WorkerSummary,
} from "@mihai-harness/protocol";
import {
	backendIdFromName,
	backendWebSocketUrl,
	loadBackends,
	normalizeBackendUrl,
	saveBackends,
	type BackendConfig,
} from "./backends.ts";
import { contextAnswerIsCurrent } from "./context.ts";
import { ProjectBoard } from "./board.svelte.ts";
import { ProjectThreads } from "./threads.svelte.ts";
import { inThread } from "./threads.ts";
import { loadMemoryScope, memorySearchTerm, memoryTarget, memoryUndoErrorText, saveMemoryScope } from "./memory.ts";
import { addDismissedDeploy, loadDismissedDeploys, saveDismissedDeploys } from "./server-status.ts";

function messageOf(error: unknown): string {
	if (error instanceof Error) return error.message;
	return String(error);
}

function sortProjects(projects: ProjectSummary[]): ProjectSummary[] {
	return [...projects].sort((left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id));
}

function sortLogins(logins: AuthLogin[]): AuthLogin[] {
	return [...logins].sort((left, right) => left.startedAt - right.startedAt);
}

const EMPTY_WORKER_DEFAULTS: WorkerDefaults = { model: null, thinkingLevel: null };

export function modelLabel(model: ModelRef | null, models: readonly ModelInfo[]): string {
	if (model === null) return "No model";
	const info = models.find((entry) => entry.provider === model.provider && entry.modelId === model.modelId);
	return info === undefined ? `${model.provider}/${model.modelId}` : info.name;
}

/** One backend's socket and the data the app has loaded from it. */
export class BackendConnection {
	readonly id: string;
	name = $state("");
	readonly url: string;
	readonly client: HarnessClient;

	connection = $state<ClientState>({ status: "idle", attempt: 0 });
	/** Advertised by `hello`; undefined until the first handshake, when the app assumes everything works. */
	features = $state<readonly string[] | undefined>(undefined);
	projects = $state<ProjectSummary[]>([]);
	projectsLoaded = $state(false);
	models = $state<ModelInfo[]>([]);
	providers = $state<ProviderInfo[]>([]);
	modelsLoaded = $state(false);
	credentials = $state<CredentialInfo[]>([]);
	/** Running OAuth logins, plus recently finished ones. A reloaded page picks them up here. */
	logins = $state<AuthLogin[]>([]);
	/**
	 * The release this backend runs and how its last deploy went, from `server.status`. Undefined until it answers, and
	 * for a backend that does not advertise `server-status`.
	 */
	status = $state<ServerStatus | undefined>(undefined);
	statusLoaded = $state(false);
	/**
	 * The backend's memory maintenance settings and its timezone, from `memory.status`. Undefined until it answers; a
	 * backend without `memory-maintenance` never fills them.
	 */
	memoryMaintenance = $state<MemoryMaintenanceSettings | undefined>(undefined);
	memoryTimezone = $state<string | undefined>(undefined);
	memoryMaintenanceSaving = $state(false);
	memoryMaintenanceError = $state<string | undefined>(undefined);
	lastError = $state<string | undefined>(undefined);

	#started = false;
	#lastStatus: ClientState["status"] = "idle";
	/** The newest settings a save has to send, so a burst lands in order. */
	#maintenancePending: MemoryMaintenanceSettings | undefined;
	#maintenanceRunning = false;

	constructor(config: BackendConfig) {
		this.id = config.id;
		this.name = config.name;
		this.url = config.url;
		this.client = new HarnessClient({
			url: backendWebSocketUrl(config.url),
			clientName: "mihai-harness-web",
			reconnect: { initialDelayMs: 300, maxDelayMs: 10_000, jitter: 0.2 },
		});
		this.client.subscribe((state) => {
			const wasReady = this.#lastStatus === "ready";
			this.connection = state;
			this.#lastStatus = state.status;
			if (state.status === "ready") {
				this.features = state.features ?? [...HARNESS_FEATURES];
				if (!wasReady && this.#started) void this.refreshAll();
				if (state.error === undefined) this.lastError = undefined;
			}
		});
		this.client.onProjectState((project) => this.upsertProject(project));
		this.client.onServerStatusChanged((status) => {
			this.status = status;
			this.statusLoaded = true;
		});
		this.client.onLogin((login) => this.applyLogin(login));
		this.client.onError((error) => {
			this.lastError = error.message;
		});
	}

	start(): void {
		if (this.#started) return;
		this.#started = true;
		this.client.connect();
	}

	stop(): void {
		this.client.close();
	}

	get ready(): boolean {
		return this.connection.status === "ready";
	}

	/** Whether this backend implements a feature. Unknown until hello answers, so nothing is hidden while connecting. */
	supports(feature: HarnessFeature | string): boolean {
		return this.features === undefined || this.features.includes(feature);
	}

	/** Connected to a backend that keeps chat drafts (`chat-drafts`). Unlike `supports`, false until hello has answered. */
	get supportsDrafts(): boolean {
		return this.connection.status === "ready" && (this.connection.features?.includes("chat-drafts") ?? false);
	}

	/** Load what the screens need, once, without waiting for a reconnect event. */
	async ensureLoaded(): Promise<void> {
		this.start();
		if (!this.ready) return;
		const tasks: Promise<void>[] = [];
		if (this.supports("projects") && !this.projectsLoaded) tasks.push(this.refreshProjects());
		if (this.supports("models") && !this.modelsLoaded) tasks.push(this.refreshModels());
		if (this.supports("credentials")) tasks.push(this.refreshCredentials());
		if (this.supports("logins")) tasks.push(this.refreshLogins());
		if (this.supports("server-status") && !this.statusLoaded) tasks.push(this.refreshServerStatus());
		if (this.supports("memory-maintenance") && this.memoryMaintenance === undefined) {
			tasks.push(this.refreshMemoryMaintenance());
		}
		await Promise.allSettled(tasks);
	}

	async refreshAll(): Promise<void> {
		const tasks: Promise<void>[] = [];
		if (this.supports("projects")) tasks.push(this.refreshProjects());
		if (this.supports("models")) tasks.push(this.refreshModels());
		if (this.supports("credentials")) tasks.push(this.refreshCredentials());
		if (this.supports("logins")) tasks.push(this.refreshLogins());
		// A deploy restarts the server, so the release after a reconnect is the one to show; events sent while away are lost.
		if (this.supports("server-status")) tasks.push(this.refreshServerStatus());
		// Memory settings are the backend's, not this project's; another device may have changed them.
		if (this.supports("memory-maintenance")) tasks.push(this.refreshMemoryMaintenance());
		await Promise.allSettled(tasks);
	}

	async refreshProjects(): Promise<void> {
		try {
			this.projects = sortProjects(await this.client.listProjects());
			this.projectsLoaded = true;
		} catch (error) {
			this.lastError = messageOf(error);
		}
	}

	async refreshModels(): Promise<void> {
		try {
			const catalog = await this.client.listModels();
			this.models = catalog.models;
			this.providers = catalog.providers;
			this.modelsLoaded = true;
		} catch (error) {
			this.lastError = messageOf(error);
		}
	}

	async refreshCredentials(): Promise<void> {
		try {
			this.credentials = await this.client.listCredentials();
		} catch (error) {
			this.lastError = messageOf(error);
		}
	}

	async refreshLogins(): Promise<void> {
		try {
			this.logins = sortLogins(await this.client.listLogins());
		} catch (error) {
			this.lastError = messageOf(error);
		}
	}

	async refreshServerStatus(): Promise<void> {
		try {
			this.status = await this.client.readServerStatus();
			this.statusLoaded = true;
		} catch (error) {
			this.lastError = messageOf(error);
		}
	}

	/** Read the backend's memory maintenance settings and timezone. */
	async refreshMemoryMaintenance(): Promise<void> {
		try {
			const snapshot = await this.client.readMemoryStatus({ scope: "global" });
			this.memoryMaintenance = snapshot.maintenance;
			this.memoryTimezone = snapshot.timezone;
			this.memoryMaintenanceError = undefined;
		} catch (error) {
			this.memoryMaintenanceError = messageOf(error);
		}
	}

	/**
	 * Save the backend's memory maintenance settings. Edits show at once and are saved one request at a time with the
	 * latest value, so a burst of picks cannot land out of order; a failed save shows what the server said.
	 */
	async saveMemoryMaintenance(settings: MemoryMaintenanceSettings): Promise<void> {
		this.memoryMaintenance = settings;
		this.memoryMaintenanceError = undefined;
		this.#maintenancePending = settings;
		if (this.#maintenanceRunning) return;
		this.#maintenanceRunning = true;
		this.memoryMaintenanceSaving = true;
		while (this.#maintenancePending !== undefined) {
			const target = this.#maintenancePending;
			this.#maintenancePending = undefined;
			try {
				this.memoryMaintenance = await this.client.setMemoryMaintenance(target);
			} catch (error) {
				this.#maintenancePending = undefined;
				this.memoryMaintenanceError = messageOf(error);
				// Show what the backend still has, not the edit it refused.
				try {
					const snapshot = await this.client.readMemoryStatus({ scope: "global" });
					this.memoryMaintenance = snapshot.maintenance;
					this.memoryTimezone = snapshot.timezone;
				} catch {
					// The save's error is the one worth showing.
				}
				break;
			}
		}
		this.#maintenanceRunning = false;
		this.memoryMaintenanceSaving = false;
	}

	/** Start a login, or rejoin the one already running for that provider. */
	async startLogin(providerId: string): Promise<AuthLogin> {
		const login = await this.client.startLogin(providerId);
		this.applyLogin(login);
		return login;
	}

	async answerLogin(loginId: string, promptId: string, value: string): Promise<void> {
		try {
			this.applyLogin(await this.client.answerLogin(loginId, promptId, value));
		} catch (error) {
			// The login may be gone (a server restart between the reload and the answer): resync instead of showing a
			// prompt that can no longer be answered.
			await this.refreshLogins();
			throw error;
		}
	}

	async cancelLogin(loginId: string): Promise<void> {
		try {
			await this.client.cancelLogin(loginId);
		} finally {
			await this.refreshLogins();
		}
	}

	/** Forget a finished login locally; nothing runs on the server any more. */
	dismissLogin(loginId: string): void {
		this.logins = this.logins.filter((login) => login.id !== loginId);
	}

	/** The running login for a provider, if any. */
	loginFor(providerId: string): AuthLogin | undefined {
		return this.logins.find(
			(login) => login.providerId === providerId && (login.status === "prompt" || login.status === "working"),
		);
	}

	/** The newest finished login for a provider, for showing a failure that no live login covers. */
	finishedLoginFor(providerId: string): AuthLogin | undefined {
		return [...this.logins]
			.reverse()
			.find(
				(login) =>
					login.providerId === providerId &&
					(login.status === "failed" || login.status === "cancelled"),
			);
	}

	applyLogin(login: AuthLogin): void {
		const index = this.logins.findIndex((entry) => entry.id === login.id);
		const next = [...this.logins];
		if (index === -1) next.push(login);
		else next[index] = login;
		this.logins = sortLogins(next);
		if (login.status === "succeeded") {
			// A new subscription changes what the provider offers; every connected app refreshes on this event.
			void Promise.allSettled([this.refreshCredentials(), this.refreshModels()]);
		}
	}

	/** List this backend's host directories for the folder picker; no path starts at its server user's home. */
	listDirectory(options: { path?: string; showHidden?: boolean } = {}): Promise<FilesystemListResponse> {
		return this.client.listDirectory(options);
	}

	completeDirectory(input: string, options: { showHidden?: boolean } = {}): Promise<FilesystemCompleteResponse> {
		return this.client.completeDirectory(input, options);
	}

	createDirectory(path: string, name: string): Promise<DirectoryEntry> {
		return this.client.createDirectory(path, name);
	}

	renameDirectory(path: string, name: string): Promise<DirectoryEntry> {
		return this.client.renameDirectory(path, name);
	}

	deleteDirectory(path: string): Promise<void> {
		return this.client.deleteDirectory(path);
	}

	async addProject(path: string): Promise<ProjectSummary> {
		const project = await this.client.addProject(path);
		this.upsertProject(project);
		this.projectsLoaded = true;
		return project;
	}

	async configureProject(projectId: string, change: ProjectChange): Promise<ProjectSummary> {
		const project = await this.client.configureProject(projectId, change);
		this.upsertProject(project);
		return project;
	}

	async saveCredential(providerId: string, apiKey: string): Promise<void> {
		await this.client.setCredential(providerId, apiKey);
		await Promise.all([this.refreshCredentials(), this.refreshModels()]);
	}

	async removeCredential(providerId: string): Promise<void> {
		await this.client.deleteCredential(providerId);
		await Promise.all([this.refreshCredentials(), this.refreshModels()]);
	}

	upsertProject(project: ProjectSummary): void {
		const index = this.projects.findIndex((entry) => entry.id === project.id);
		const next = [...this.projects];
		if (index === -1) next.push(project);
		else next[index] = project;
		this.projects = sortProjects(next);
	}

	/** Main's conversation, or a background thread's when given its ID. */
	watchProject(projectId: string, options: ConversationWatchOptions = {}, threadId?: string): ChatSession {
		return new ChatSession(this.client, projectId, options, undefined, threadId);
	}

	/** A worker's conversation, read-only: a worker takes no submit and no abort. `threadId` is the thread it works for. */
	watchWorker(
		projectId: string,
		workerId: string,
		options: ConversationWatchOptions = {},
		threadId?: string,
	): ChatSession {
		return new ChatSession(this.client, projectId, options, workerId, threadId);
	}

	/**
	 * Attach to a thread's worker list: main's by default, a background thread's when given its ID. The caller stops it
	 * when the screen goes away.
	 */
	watchWorkers(projectId: string, threadId?: string): ProjectWorkers {
		return new ProjectWorkers(this.client, projectId, threadId);
	}

	/**
	 * A conversation's context: main's coordinator, a background thread's, or a worker's when given its ID. The caller
	 * stops it when the screen goes away; it reloads by itself after a reconnect.
	 */
	watchContext(projectId: string, workerId?: string, threadId?: string): ProjectContext {
		return new ProjectContext(this.client, projectId, workerId, threadId);
	}

	/**
	 * A project's threads: main and its background threads, live from `threads.state` and re-read after a reconnect.
	 * The caller stops it when the screen goes away.
	 */
	watchThreads(projectId: string): ProjectThreads {
		return new ProjectThreads(this.client, projectId);
	}

	/**
	 * One project's memory: the global and the project scope, read-only apart from undoing an extraction or a maintenance
	 * commit. The caller stops it when the screen goes away; it reloads by itself when a scope changes, after a
	 * reconnect, and on every `memory.changed` for either scope when the backend has `memory-maintenance`.
	 */
	watchMemory(projectId: string, options: { maintenance?: boolean } = {}): ProjectMemory {
		return new ProjectMemory(this.client, projectId, options);
	}

	/**
	 * A project's scheduled tasks: the list, the backend's timezone, and the edits. The caller stops it when the screen
	 * goes away; it reloads by itself after a reconnect and follows every `schedules.state` push.
	 */
	watchSchedules(projectId: string): ProjectSchedules {
		return new ProjectSchedules(this.client, projectId);
	}

	/**
	 * A project's board: tasks, questions and decisions, live from `board.state` and re-read after a reconnect. The caller
	 * stops it when the screen goes away.
	 */
	watchBoard(projectId: string): ProjectBoard {
		return new ProjectBoard(this.client, projectId);
	}
}

/** The configured backends and the operations that add, rename and remove them. */
export class HarnessApp {
	backends = $state<BackendConnection[]>([]);
	/**
	 * Deploy attempts this browser's reader dismissed, oldest first. Shared by every screen, so dismissing the banner on
	 * the home page also hides it in the chat; a new attempt has a new key and shows again.
	 */
	dismissedDeploys = $state<string[]>([]);

	#loaded = false;
	#started = false;

	/** Read the browser's backend list once. Safe to call from every screen's onMount. */
	load(): void {
		if (this.#loaded) return;
		this.#loaded = true;
		this.backends = loadBackends().map((config) => new BackendConnection(config));
		this.dismissedDeploys = loadDismissedDeploys();
	}

	/** Hide a deploy's banner for this browser, now and on the next visit. */
	dismissDeploy(deploy: DeployStatus): void {
		this.dismissedDeploys = addDismissedDeploy(this.dismissedDeploys, deploy);
		saveDismissedDeploys(this.dismissedDeploys);
	}

	/** Connect every backend and load its data. Idempotent. */
	start(): void {
		this.load();
		if (this.#started) return;
		this.#started = true;
		for (const backend of this.backends) {
			backend.start();
			void backend.ensureLoaded();
		}
	}

	backend(id: string): BackendConnection | undefined {
		return this.backends.find((backend) => backend.id === id);
	}

	addBackend(name: string, url: string): BackendConnection {
		this.load();
		const trimmedName = name.trim();
		if (trimmedName.length === 0) throw new Error("Give the backend a name.");
		const normalized = normalizeBackendUrl(url);
		if (this.backends.some((backend) => backend.url === normalized)) {
			throw new Error("That backend is already added.");
		}
		const config: BackendConfig = {
			id: backendIdFromName(
				trimmedName,
				this.backends.map((backend) => backend.id),
			),
			name: trimmedName,
			url: normalized,
		};
		const backend = new BackendConnection(config);
		this.backends = [...this.backends, backend];
		this.#persist();
		backend.start();
		void backend.ensureLoaded();
		return backend;
	}

	renameBackend(id: string, name: string): void {
		const trimmed = name.trim();
		if (trimmed.length === 0) throw new Error("A backend needs a name.");
		const backend = this.backend(id);
		if (backend === undefined) return;
		backend.name = trimmed;
		this.#persist();
	}

	removeBackend(id: string): void {
		const backend = this.backend(id);
		if (backend === undefined) return;
		backend.stop();
		this.backends = this.backends.filter((entry) => entry.id !== id);
		this.#persist();
	}

	#persist(): void {
		saveBackends(
			this.backends.map((backend) => ({ id: backend.id, name: backend.name, url: backend.url })),
		);
	}
}

/** One project's live coordinator transcript, mirrored into runes for the chat screen. */
export class ChatSession {
	readonly projectId: string;
	/** Set when this watches a worker's conversation instead of the coordinator's. */
	readonly workerId: string | undefined;
	/** Set for a background thread's conversation (or one of its workers'); undefined for main. */
	readonly threadId: string | undefined;
	readonly watch: ReturnType<HarnessClient["watchConversation"]>;

	entries = $state<readonly EntryRecord[]>([]);
	view = $state<ConversationView | undefined>(undefined);
	status = $state<WatchStatus>("connecting");
	error = $state<string | undefined>(undefined);
	loadingEarlier = $state(false);
	canLoadEarlier = $state(false);

	readonly #unsubscribe: () => void;

	constructor(
		client: HarnessClient,
		projectId: string,
		options: ConversationWatchOptions = {},
		workerId?: string,
		threadId?: string,
	) {
		this.projectId = projectId;
		this.workerId = workerId;
		this.threadId = threadId;
		const watchOptions = threadId === undefined ? options : { ...options, threadId };
		this.watch =
			workerId === undefined
				? client.watchConversation(projectId, watchOptions)
				: client.watchWorkerConversation(projectId, workerId, watchOptions);
		this.#sync();
		this.#unsubscribe = this.watch.subscribe(() => this.#sync());
	}

	async loadEarlier(): Promise<void> {
		await this.watch.loadEarlier();
		this.#sync();
	}

	stop(): void {
		this.#unsubscribe();
		this.watch.stop();
	}

	#sync(): void {
		this.entries = this.watch.entries;
		this.view = this.watch.view;
		this.status = this.watch.status;
		this.error = this.watch.error;
		this.loadingEarlier = this.watch.loadingEarlier;
		this.canLoadEarlier = this.watch.canLoadEarlier;
	}
}

/**
 * One project's worker list and the worker model the project starts from.
 *
 * The server pushes the whole list on every change (`workers.state`), so a screen replaces what it holds instead of
 * diffing it; `workers.list` fills it in on connect and after a reconnect. Runes, so a panel and a transcript share one
 * live list.
 */
export class ProjectWorkers {
	readonly projectId: string;
	/** The thread whose workers these are; undefined for main. The server's list and pushes carry every thread's. */
	readonly threadId: string | undefined;
	workers = $state<WorkerSummary[]>([]);
	defaults = $state<WorkerDefaults>({ ...EMPTY_WORKER_DEFAULTS });
	loaded = $state(false);
	error = $state<string | undefined>(undefined);
	/**
	 * How far the backend has got with storing a pick (`workers.defaults.set`). Until it confirms one, the pick rides
	 * on the next message instead; a backend from before the request answers `unknown_request`.
	 */
	defaultsSupport = $state<WorkerDefaultsSupport>("unknown");
	/** The last failure of a save; cleared by the next one that works. */
	defaultsError = $state<string | undefined>(undefined);

	readonly #client: HarnessClient;
	readonly #unsubscribeState: () => void;
	readonly #unsubscribeWorkers: () => void;
	#stopped = false;
	/** Identifies the newest save, so an older answer cannot overwrite a newer pick. */
	#defaultsPick = 0;

	constructor(client: HarnessClient, projectId: string, threadId?: string) {
		this.projectId = projectId;
		this.threadId = threadId;
		this.#client = client;
		this.#unsubscribeWorkers = client.onWorkersState((state) => {
			if (state.projectId !== projectId) return;
			this.#apply(state.workers, state.defaults);
		});
		// A reconnect loses the events sent while away, so ask for the list again.
		this.#unsubscribeState = client.subscribe((state) => {
			if (state.status === "ready") void this.load();
		});
		if (client.connected) void this.load();
	}

	async load(): Promise<void> {
		if (this.#stopped || !this.#client.connected) return;
		try {
			const snapshot = await this.#client.listWorkers(this.projectId);
			if (this.#stopped) return;
			this.#apply(snapshot.workers, snapshot.defaults);
		} catch (error) {
			if (this.#stopped) return;
			this.error = messageOf(error);
		}
	}

	worker(id: string | undefined): WorkerSummary | undefined {
		if (id === undefined) return undefined;
		return this.workers.find((worker) => worker.id === id);
	}

	/** Choose the worker model this screen sends with its messages, until the server pushes the stored one back. */
	choose(model: ModelRef | null, thinkingLevel: WorkerDefaults["thinkingLevel"]): void {
		this.defaults = { model, thinkingLevel };
	}

	/**
	 * Pick a worker model and store it at once (`workers.defaults.set`), so the choice applies without a message and
	 * from every device. Before the worker list has loaded nothing is stored or sent, so a choice made elsewhere is
	 * never clobbered with this screen's empty state. A backend that predates the request keeps today's behaviour: the
	 * pick stays local and rides on the next message.
	 */
	async pick(model: ModelRef | null, thinkingLevel: WorkerDefaults["thinkingLevel"]): Promise<void> {
		this.choose(model, thinkingLevel);
		if (!this.loaded || this.defaultsSupport === "unsupported") return;
		const pick = ++this.#defaultsPick;
		try {
			const stored = await this.#client.setWorkerDefaults(this.projectId, { model, thinkingLevel });
			if (this.#stopped || pick !== this.#defaultsPick) return;
			this.defaultsSupport = "supported";
			this.defaultsError = undefined;
			this.defaults = stored;
		} catch (error) {
			if (this.#stopped || pick !== this.#defaultsPick) return;
			if (defaultsSetUnsupported(error)) {
				this.defaultsSupport = "unsupported";
				this.defaultsError = undefined;
				return;
			}
			this.defaultsError = messageOf(error);
		}
	}

	stop(): void {
		this.#stopped = true;
		this.#unsubscribeState();
		this.#unsubscribeWorkers();
	}

	#apply(workers: WorkerSummary[], defaults: WorkerDefaults): void {
		this.workers = workers.filter((worker) => inThread(worker, this.threadId));
		this.defaults = defaults;
		this.loaded = true;
		this.error = undefined;
	}
}

/**
 * One project's scheduled tasks: the list with its runs, and the backend's timezone, which every time in a schedule is
 * read in.
 *
 * The server pushes the whole list on every change (`schedules.state`), so a screen replaces what it holds instead of
 * diffing it; `schedules.list` fills it in on connect and after a reconnect. Saves, deletes and manual runs go through
 * here and update the list at once, so a row changes without waiting for the push. Runes, so the settings section and
 * the worker badges share one live list.
 */
export class ProjectSchedules {
	readonly projectId: string;
	schedules = $state<Schedule[]>([]);
	/** The backend's IANA timezone, e.g. "Europe/Bucharest"; empty until the list has loaded. */
	timezone = $state("");
	loaded = $state(false);
	error = $state<string | undefined>(undefined);

	readonly #client: HarnessClient;
	readonly #unsubscribeSchedules: () => void;
	readonly #unsubscribeState: () => void;
	#stopped = false;

	constructor(client: HarnessClient, projectId: string) {
		this.projectId = projectId;
		this.#client = client;
		this.#unsubscribeSchedules = client.onSchedulesState((state) => {
			if (this.#stopped || !schedulesStateIsFor(state, projectId)) return;
			this.#apply(state.schedules, state.timezone);
		});
		// A reconnect loses the events sent while away, so ask for the list again.
		this.#unsubscribeState = client.subscribe((state) => {
			if (state.status === "ready") void this.load();
		});
		if (client.connected) void this.load();
	}

	async load(): Promise<void> {
		if (this.#stopped || !this.#client.connected) return;
		try {
			const snapshot = await this.#client.listSchedules(this.projectId);
			if (this.#stopped) return;
			this.#apply(snapshot.schedules, snapshot.timezone);
		} catch (error) {
			if (this.#stopped) return;
			this.error = messageOf(error);
		}
	}

	schedule(id: string | undefined): Schedule | undefined {
		if (id === undefined) return undefined;
		return this.schedules.find((schedule) => schedule.id === id);
	}

	/** The title a worker's schedule badge shows; undefined while the list is loading or after a delete. */
	title(id: string | undefined): string | undefined {
		return this.schedule(id)?.title;
	}

	/** Create (no `scheduleId`) or replace one. Throws so the editor can show what the backend refused. */
	async save(input: ScheduleInput, scheduleId?: string): Promise<Schedule> {
		const saved = await this.#client.saveSchedule(this.projectId, input, scheduleId);
		if (!this.#stopped) this.#upsert(saved);
		return saved;
	}

	async remove(scheduleId: string): Promise<void> {
		await this.#client.deleteSchedule(this.projectId, scheduleId);
		if (this.#stopped) return;
		this.schedules = this.schedules.filter((schedule) => schedule.id !== scheduleId);
	}

	/**
	 * Run a schedule now, enabled or not. The answer is the run that was recorded: a started one names the worker to
	 * open, a skipped or failed one says why. The pushed list carries it in the schedule's runs too.
	 */
	run(scheduleId: string): Promise<ScheduleRun> {
		return this.#client.runSchedule(this.projectId, scheduleId);
	}

	stop(): void {
		this.#stopped = true;
		this.#unsubscribeState();
		this.#unsubscribeSchedules();
	}

	#apply(schedules: Schedule[], timezone: string): void {
		this.schedules = schedules;
		this.timezone = timezone;
		this.loaded = true;
		this.error = undefined;
	}

	#upsert(schedule: Schedule): void {
		const index = this.schedules.findIndex((entry) => entry.id === schedule.id);
		const next = [...this.schedules];
		if (index === -1) next.push(schedule);
		else next[index] = schedule;
		this.schedules = next;
		this.loaded = true;
	}
}

/**
 * One conversation's live context, for the sidebar's Info tab: what its model is
 * given besides the transcript.
 *
 * The server pushes the whole context on every change while the conversation is
 * watched (`conversation.context.changed`), so a screen replaces what it holds;
 * `conversation.context` fills it in on connect and after a reconnect. Runes, so a
 * push redraws the panel.
 */
export class ProjectContext {
	readonly projectId: string;
	/** Undefined for the coordinator. */
	readonly workerId: string | undefined;
	/** Undefined for main. */
	readonly threadId: string | undefined;
	context = $state<ConversationContext | undefined>(undefined);
	loaded = $state(false);
	error = $state<string | undefined>(undefined);
	/** A `conversation.compact` request is in flight; the server's usage takes over once it admits one. */
	compactPending = $state(false);
	compactError = $state<string | undefined>(undefined);

	readonly #client: HarnessClient;
	readonly #target: ContextTarget;
	readonly #unsubscribeState: () => void;
	readonly #unsubscribeContext: () => void;
	#stopped = false;
	/** How many pushed contexts for this conversation have been applied; guards answers against newer pushes. */
	#contextPushes = 0;

	constructor(client: HarnessClient, projectId: string, workerId?: string, threadId?: string) {
		this.projectId = projectId;
		this.workerId = workerId;
		this.threadId = threadId;
		this.#client = client;
		this.#target = {
			projectId,
			...(workerId === undefined ? {} : { workerId }),
			...(threadId === undefined ? {} : { threadId }),
		};
		this.#unsubscribeContext = client.onContextChanged((pushed) => {
			if (this.#stopped || !contextIsFor(pushed, this.#target)) return;
			this.#contextPushes += 1;
			this.#apply(pushed);
		});
		// A reconnect loses the events sent while away, so ask for the context again.
		this.#unsubscribeState = client.subscribe((state) => {
			if (state.status === "ready") void this.load();
		});
		if (client.connected) void this.load();
	}

	async load(): Promise<void> {
		if (this.#stopped || !this.#client.connected) return;
		const pushesAtRequest = this.#contextPushes;
		try {
			const context = await this.#client.readContext(this.projectId, {
				...(this.workerId === undefined ? {} : { workerId: this.workerId }),
				...(this.threadId === undefined ? {} : { threadId: this.threadId }),
			});
			// A push that arrived while the request was in flight describes a later state; the answer is older.
			if (this.#stopped || !contextAnswerIsCurrent(pushesAtRequest, this.#contextPushes)) return;
			this.#apply(context);
		} catch (error) {
			if (this.#stopped || !contextAnswerIsCurrent(pushesAtRequest, this.#contextPushes)) return;
			this.error = messageOf(error);
		}
	}

	/**
	 * A compaction is running: the request from this screen has not been answered yet, or the server's usage says one is
	 * working. Only the coordinator compacts; a worker's context has no button for it.
	 */
	get compacting(): boolean {
		return this.compactPending || this.context?.usage?.compacting === true;
	}

	/**
	 * Compact the coordinator's conversation now (`conversation.compact`), with optional instructions for the summary.
	 * The server answers when the compaction is admitted; the summary arrives as a `pi.compaction` entry through the
	 * watch, and the pushed usage reports it running until it ends. A failure is kept here for the panel to show.
	 */
	async compact(instructions?: string): Promise<void> {
		if (this.#stopped || this.workerId !== undefined) return;
		this.compactPending = true;
		this.compactError = undefined;
		try {
			await this.#client.compact(this.projectId, {
				...(instructions === undefined ? {} : { instructions }),
				...(this.threadId === undefined ? {} : { threadId: this.threadId }),
			});
		} catch (error) {
			if (this.#stopped) return;
			this.compactError = messageOf(error);
		} finally {
			if (!this.#stopped) this.compactPending = false;
		}
	}

	stop(): void {
		this.#stopped = true;
		this.#unsubscribeState();
		this.#unsubscribeContext();
	}

	#apply(context: ConversationContext): void {
		this.context = context;
		this.loaded = true;
		this.error = undefined;
	}
}

/**
 * One project's memory, for the sidebar's Memory tab: the global scope and the project's, their
 * topic files, one open file, a search, and each scope's history and maintenance state.
 *
 * Read-only apart from undo: the server's coordinator writes memory, the app reads it. The server pushes
 * `memory.changed` for the scope it wrote, and the panel reads again; a reconnect loses the
 * events sent while away, so it reads again then too. Everything it shows is derived here, so a
 * push, a scope switch or a search redraws without the panel holding state.
 *
 * A backend with `memory-maintenance` also reads both scopes' history and the shown scope's status with
 * the file list: the History view lists the commits, and the transcript's compaction markers need the
 * extractions from either scope, so the history is read once per scope and refreshed on `memory.changed`.
 */
export class ProjectMemory {
	readonly projectId: string;
	/** The scope shown: this project's memory, or the user's global one; remembered per browser. */
	scope = $state<MemoryScope>(loadMemoryScope());
	/** Whether the file list shows archived files; they arrive with the list, so the switch is instant. */
	includeArchived = $state(false);
	files = $state<MemoryFileSummary[]>([]);
	filesLoaded = $state(false);
	/** Each scope's newest commits, so the History view and the transcript read one history per scope. */
	history = $state<Record<MemoryScope, MemoryChange[]>>({ global: [], project: [] });
	historyLoaded = $state<Record<MemoryScope, boolean>>({ global: false, project: false });
	/** The shown scope's maintenance state; `maintenance` and `timezone` belong to the whole backend. */
	status = $state<MemoryScopeStatus | undefined>(undefined);
	maintenance = $state<MemoryMaintenanceSettings | undefined>(undefined);
	timezone = $state<string | undefined>(undefined);
	/** The open file, from `memory.read`; undefined in the list and the search views. */
	file = $state<MemoryFile | undefined>(undefined);
	fileId = $state<string | undefined>(undefined);
	hits = $state<MemorySearchHit[]>([]);
	/** The term the hits belong to; undefined when the reader is not searching. */
	term = $state<string | undefined>(undefined);
	searching = $state(false);
	error = $state<string | undefined>(undefined);
	/** The commit an undo is in flight for, so its row says so. */
	undoing = $state<string | undefined>(undefined);
	/** Why an undo failed, and the commit it was about, so the message sits under that row. */
	undoError = $state<{ commit: string; message: string } | undefined>(undefined);
	/** Why asking for a maintenance run, or reading its state, failed. */
	maintenanceError = $state<string | undefined>(undefined);
	/** A maintenance run was asked for and the server has not answered yet. */
	maintenanceStarting = $state(false);

	/** Whether this backend advertises `memory-maintenance`, so the undo and the status line exist at all. */
	readonly maintenanceEnabled: boolean;

	readonly #client: HarnessClient;
	readonly #unsubscribeState: () => void;
	readonly #unsubscribeMemory: () => void;
	#stopped = false;
	/** Bumped on a scope change and on stop, so an answer for the old scope is dropped. */
	#generation = 0;
	/** Bumped per search, so a slower earlier search cannot overwrite a newer one. */
	#searchSequence = 0;
	/** Bumped per read, so a file opened twice shows the newer answer. */
	#readSequence = 0;

	/** The shown scope's commits: the History view's list. */
	get changes(): readonly MemoryChange[] {
		return this.history[this.scope];
	}

	get changesLoaded(): boolean {
		return this.historyLoaded[this.scope];
	}

	constructor(client: HarnessClient, projectId: string, options: { maintenance?: boolean } = {}) {
		this.projectId = projectId;
		this.#client = client;
		this.maintenanceEnabled = options.maintenance === true;
		this.#unsubscribeMemory = client.onMemoryChanged((event) => {
			if (this.#stopped || !this.#tracks(event)) return;
			void this.refresh();
		});
		// A reconnect loses the events sent while away, so read the scope again.
		this.#unsubscribeState = client.subscribe((state) => {
			if (state.status === "ready") void this.refresh();
		});
		if (client.connected) void this.load();
	}

	/** Read the shown scope's files, and with `memory-maintenance` both histories and the scope's maintenance state. */
	async load(): Promise<void> {
		if (this.#stopped || !this.#client.connected) return;
		const tasks: Promise<void>[] = [this.#loadFiles()];
		if (this.maintenanceEnabled) {
			tasks.push(this.loadHistory("global"), this.loadHistory("project"), this.loadStatus());
		}
		await Promise.allSettled(tasks);
	}

	/** Read the scope's list, archived files included, so the toggle knows how many it hides. */
	async #loadFiles(): Promise<void> {
		if (this.#stopped || !this.#client.connected) return;
		const generation = this.#generation;
		try {
			const files = await this.#client.listMemory({ ...this.#target(), includeArchived: true });
			if (this.#stopped || generation !== this.#generation) return;
			this.files = files;
			this.filesLoaded = true;
			this.error = undefined;
		} catch (error) {
			if (this.#stopped || generation !== this.#generation) return;
			this.error = messageOf(error);
		}
	}

	/** Read one scope's commits; a backend with `memory-maintenance` reads both scopes with the file list. */
	async loadHistory(scope: MemoryScope = this.scope): Promise<void> {
		if (this.#stopped || !this.#client.connected) return;
		const generation = this.#generation;
		try {
			const changes = await this.#client.readMemoryHistory({ ...memoryTarget(scope, this.projectId), limit: 50 });
			if (this.#stopped || generation !== this.#generation) return;
			this.history = { ...this.history, [scope]: changes };
			this.historyLoaded = { ...this.historyLoaded, [scope]: true };
			this.error = undefined;
		} catch (error) {
			if (this.#stopped || generation !== this.#generation) return;
			this.error = messageOf(error);
		}
	}

	/** Read the shown scope's maintenance state, with the backend's settings and timezone. */
	async loadStatus(): Promise<void> {
		if (this.#stopped || !this.#client.connected || !this.maintenanceEnabled) return;
		const generation = this.#generation;
		try {
			const snapshot = await this.#client.readMemoryStatus(this.#target());
			if (this.#stopped || generation !== this.#generation) return;
			this.status = snapshot.status;
			this.maintenance = snapshot.maintenance;
			this.timezone = snapshot.timezone;
			this.maintenanceError = undefined;
		} catch (error) {
			if (this.#stopped || generation !== this.#generation) return;
			this.maintenanceError = messageOf(error);
		}
	}

	/** Show the other scope: its files and maintenance state, and nothing left over from the last one. */
	setScope(scope: MemoryScope): void {
		if (this.#stopped || scope === this.scope) return;
		this.scope = scope;
		saveMemoryScope(scope);
		this.#generation += 1;
		this.files = [];
		this.filesLoaded = false;
		this.status = undefined;
		this.undoError = undefined;
		this.hits = [];
		this.term = undefined;
		this.searching = false;
		this.file = undefined;
		this.fileId = undefined;
		void this.load();
		// The other scope's commits are asked for once, so the History view never waits for a request nobody sends.
		if (!this.historyLoaded[scope]) void this.loadHistory(scope);
	}

	/**
	 * Open one memory file. A file linked from the other scope switches to that scope first; a
	 * global link is opened in the global scope.
	 */
	async open(fileId: string, scope: MemoryScope = this.scope): Promise<void> {
		if (this.#stopped) return;
		if (scope !== this.scope) this.setScope(scope);
		// Re-reading the open file keeps it on screen; opening another one shows its content arrive.
		if (this.fileId !== fileId) this.file = undefined;
		this.fileId = fileId;
		this.#readSequence += 1;
		const sequence = this.#readSequence;
		const generation = this.#generation;
		if (!this.#client.connected) return;
		try {
			const file = await this.#client.readMemory({ ...memoryTarget(scope, this.projectId), fileId });
			if (this.#stopped || sequence !== this.#readSequence || generation !== this.#generation) return;
			this.file = file;
			this.error = undefined;
		} catch (error) {
			if (this.#stopped || sequence !== this.#readSequence || generation !== this.#generation) return;
			this.error = messageOf(error);
		}
	}

	/** Go back to the list or the results; the search term stays, so the reader returns to what they searched for. */
	closeFile(): void {
		this.fileId = undefined;
		this.file = undefined;
	}

	/**
	 * Search both scopes, so a fact about the user is found while reading the project's memory; each hit says which scope
	 * it came from. An empty query clears the results instead of asking the server.
	 */
	async search(query: string): Promise<void> {
		const term = memorySearchTerm(query);
		this.#searchSequence += 1;
		const sequence = this.#searchSequence;
		if (term === undefined) {
			this.term = undefined;
			this.hits = [];
			this.searching = false;
			return;
		}
		this.term = term;
		this.searching = true;
		const generation = this.#generation;
		if (!this.#client.connected) {
			this.searching = false;
			return;
		}
		try {
			const hits = await this.#client.searchMemory({
				scope: "both",
				projectId: this.projectId,
				query: term,
				limit: 30,
			});
			if (this.#stopped || sequence !== this.#searchSequence || generation !== this.#generation) return;
			this.hits = hits;
			this.searching = false;
			this.error = undefined;
		} catch (error) {
			if (this.#stopped || sequence !== this.#searchSequence || generation !== this.#generation) return;
			this.hits = [];
			this.searching = false;
			this.error = messageOf(error);
		}
	}

	/**
	 * Revert one extraction or maintenance commit in its own scope: the whole commit, as one undo commit. The server
	 * refuses a change that later writes touched; that refusal is shown under the commit it was about.
	 */
	async undo(scope: MemoryScope, commit: string): Promise<void> {
		if (this.#stopped || !this.#client.connected) return;
		this.undoing = commit;
		this.undoError = undefined;
		try {
			await this.#client.undoMemory({ ...memoryTarget(scope, this.projectId), commit });
			if (this.#stopped) return;
			await this.refresh();
		} catch (error) {
			if (this.#stopped) return;
			this.undoError = { commit, message: memoryUndoErrorText(error) };
		} finally {
			if (!this.#stopped) this.undoing = undefined;
		}
	}

	/** Ask for a maintenance run on the shown scope; it starts and its outcome arrives as `memory.changed`. */
	async runMaintenance(): Promise<void> {
		if (this.#stopped || !this.#client.connected || this.maintenanceStarting) return;
		this.maintenanceStarting = true;
		this.maintenanceError = undefined;
		try {
			await this.#client.maintainMemory(this.#target());
			if (!this.#stopped) await this.loadStatus();
		} catch (error) {
			if (!this.#stopped) this.maintenanceError = messageOf(error);
		} finally {
			if (!this.#stopped) this.maintenanceStarting = false;
		}
	}

	/** Read again: the scope's files, the history, the maintenance state, the open file, the search's hits. */
	async refresh(): Promise<void> {
		if (this.#stopped) return;
		const tasks: Promise<void>[] = [this.load()];
		if (!this.maintenanceEnabled && this.changesLoaded) tasks.push(this.loadHistory());
		const openFileId = this.fileId;
		if (openFileId !== undefined) tasks.push(this.open(openFileId));
		const term = this.term;
		if (term !== undefined) tasks.push(this.search(term));
		await Promise.allSettled(tasks);
	}

	stop(): void {
		this.#stopped = true;
		this.#generation += 1;
		this.#unsubscribeState();
		this.#unsubscribeMemory();
	}

	#target(): ReturnType<typeof memoryTarget> {
		return memoryTarget(this.scope, this.projectId);
	}

	/**
	 * Whether a pushed change concerns what this instance shows: the shown scope always, and with
	 * `memory-maintenance` either scope of this project, because the transcript's extractions can come from both.
	 */
	#tracks(event: Pick<MemoryChangedEvent, "scope" | "projectId">): boolean {
		if (memoryChangedIsFor(event, this.#target())) return true;
		if (!this.maintenanceEnabled) return false;
		if (event.scope === "global") return true;
		return event.projectId === this.projectId;
	}
}

export const harness = new HarnessApp();
