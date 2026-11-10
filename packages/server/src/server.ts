/**
 * The Bun server: `Bun.serve` on the configured interface (loopback by default) and the WebSocket protocol at `/ws`.
 * This is a backend only; the web app is deployed separately and talks to it over the socket.
 */
import type { CredentialStore, Models } from "@earendil-works/pi-ai";
import type { SetTimer } from "@earendil-works/pi-durable";
import type { ImageProcessor } from "@earendil-works/pi-durable/tools";
import { HARNESS_FEATURES, SERVER_NAME } from "@aiki/protocol";
import { basename, join } from "node:path";
import {
	ArtifactStore,
	type ArtifactStoreOptions,
	ArtifactUrlSigner,
	loadOrCreateArtifactSecret,
	requestOrigin,
	serveArtifact,
} from "./artifacts.ts";
import { DraftStore } from "./drafts.ts";
import { PromptCacheRetention } from "./cache-retention.ts";
import { ClientConnection } from "./connection.ts";
import { type LoadedSkill, loadAgentContext } from "./context.ts";
import { FileCredentialStore } from "./credentials.ts";
import { SubscriptionUsageService, type SubscriptionUsageOptions } from "./subscription-usage.ts";
import {
	DEFAULT_HOSTNAME,
	ensureDataDir,
	resolveAgentDir,
	resolveClaudeDir,
	resolveConfigDir,
	resolvePort,
} from "./data-dir.ts";
import { loadOrCreateDeviceId } from "./device-id.ts";
import { errorMessage } from "./errors.ts";
import { OAuthLoginManager } from "./logins.ts";
import { MemoryMaintenanceClock, MemoryMaintenanceService, MemoryMaintenanceStore } from "./memory-maintenance.ts";
import { MemoryStore } from "./memory.ts";
import { createHarnessModels } from "./models.ts";
import {
	type Notifier,
	type PushTransport,
	Notifier as NotificationSender,
	type HoldScheduler,
	NotificationPresence,
	NotificationStateStore,
	NotificationStore,
	loadOrCreateVapidKeys,
	loginPromptNotification,
	maintenanceFailureNotification,
	resolveVapidKeyFile,
	resolveVapidSubject,
} from "./notifications.ts";
import { isOriginAllowed, resolveAllowedOrigins } from "./origins.ts";
import { ProjectStore } from "./projects.ts";
import { backfillProjects } from "./request-backfill.ts";
import { RequestLog, type RequestLogOptions } from "./request-log.ts";
import { REQUEST_LOG_FILE, RequestLogStore } from "./request-log-store.ts";
import { ProjectManager } from "./runtime.ts";
import { GithubReviewReader, ScheduleEventPoller, ScheduleEventStore } from "./schedule-events.ts";
import { type RunCommand } from "./host-commands.ts";
import { ScheduleScheduler, ScheduleStore } from "./schedules.ts";
import { ServerStatusService } from "./server-status.ts";
import { FcmSender, loadFcmServiceAccount, resolveFcmKeyFile } from "./fcm.ts";
import { DiskMonitor, type DiskReader, type DiskThreshold, diskLowNotification } from "./disks.ts";
import { TerminalHost, type TerminalHostOptions, terminalsEnabled } from "./terminals.ts";
import { resolveToolCallCapMs } from "./tool-caps.ts";

export type StartServerOptions = {
	/** Usually `resolveDataDir()`; tests use a temp directory. */
	dataDir: string;
	/** Default: `AIKI_PORT`, else 7317. `0` picks a free port (the handle reports it). */
	port?: number;
	/** Default: `AIKI_HOST`, else 127.0.0.1. `0.0.0.0` listens on every interface. */
	hostname?: string;
	/**
	 * Browser origins allowed to open `/ws`. Default: `AIKI_ALLOWED_ORIGINS`, else none. Requests without an
	 * Origin header are always allowed, so native clients, tests and health checks work without an allow-list.
	 */
	allowedOrigins?: readonly string[];
	/** Features advertised in `hello`. Default: every feature this server implements. */
	features?: readonly string[];
	/** Replace model access, for example with pi-ai's faux provider in tests. */
	models?: Models;
	/** Where the request log lives (`request-log.sqlite` in the data directory by default); `false` keeps none. */
	requestLog?: { file?: string } | false;
	/**
	 * The directory whose AGENTS.md and skills every conversation is given. Default: `AIKI_AGENT_DIR`, else
	 * `~/.pi/agent` of the user this process runs as.
	 */
	agentDir?: string;
	/**
	 * The harness's own config directory, whose SYSTEM.md and APPEND_SYSTEM.md apply to every conversation. Default:
	 * `AIKI_CONFIG_DIR`, else `${XDG_CONFIG_HOME:-~/.config}/aiki`.
	 */
	configDir?: string;
	/**
	 * Claude Code's home, whose skills, enabled plugins' skills and `.claude/skills` every conversation is also given.
	 * Default: `AIKI_CLAUDE_DIR`, else `~/.claude` of the user this process runs as.
	 */
	claudeDir?: string;
	/** Must match the store the models were created with. Default: `credentials.json` in the data directory. */
	credentials?: CredentialStore;
	/** `null` disables image processing; omitted creates the Photon worker processor on first project open. */
	images?: ImageProcessor | null;
	/** The Harness clock, for tests with a fake one (worker check-in timers). Default: `Date.now`. */
	now?: () => number;
	/** The Harness timer, for tests with a fake clock. Default: `setTimeout`. */
	setTimer?: SetTimer;
	/** How long the user's board edits wait before they reach the coordinator as one input. Default 3 s. */
	boardEditDebounceMs?: number;
	/**
	 * The timezone schedules run in. Default: `AIKI_TIMEZONE` when it names a zone, else the host's clock, else
	 * UTC; `schedules.list` reports what is in effect.
	 */
	timezone?: string;
	/**
	 * How long the coordinator's own `bash`/`powershell` calls may run before they are stopped with a message to
	 * delegate the work. Default: `AIKI_TOOL_CALL_CAP_MINUTES`, else two minutes. Workers are unaffected.
	 */
	toolCallCapMs?: number;
	/**
	 * Event schedules (GitHub review requests): the command that runs `gh` (default: the host's) and how often GitHub is
	 * read (default 2 minutes). Tests hand in a fake `gh`.
	 */
	githubReviews?: { run?: RunCommand; pollIntervalMs?: number };
	/** Free disk space: how it is read, the low threshold and the poll interval. Defaults: statfs, the env, 3 minutes. */
	disks?: { read?: DiskReader; threshold?: DiskThreshold; intervalMs?: number };
	/** When `work_finished` goes out; see `ProjectManagerOptions.workFinished`. */
	workFinished?: { minWorkMs?: number; quietMs?: number };
	/** OAuth subscription logins. Defaults: a per-installation device ID in the data directory, 10 minute idle timeout. */
	logins?: {
		/** Stable installation ID for Sign in with ChatGPT. Default: `device-id` in the data directory. */
		deviceId?: () => string | Promise<string>;
		/** How the app introduces itself during login. */
		agentName?: string;
		/** A login with no client activity for this long is aborted. 0 disables it. */
		idleTimeoutMs?: number;
	};
	/** Subscription usage reads. Defaults: the real endpoints, a 5 minute poll while a client is connected. */
	subscriptionUsage?: Pick<
		SubscriptionUsageOptions,
		"fetch" | "anthropicBaseUrl" | "chatgptBaseUrl" | "pollIntervalMs" | "afterTurnQuietMs" | "minReadGapMs"
	>;
	/**
	 * Artifacts. Defaults: `AIKI_ARTIFACT_MAX_BYTES` (else 2 GiB) per file, URLs valid 4 hours, durations from
	 * `ffprobe` when it is on PATH.
	 */
	artifacts?: Pick<ArtifactStoreOptions, "maxFileBytes" | "probeDuration"> & { urlTtlMs?: number };
	/**
	 * Terminals (feature `terminal`): a PTY per attached session, each a zellij session. Default: on, unless
	 * `AIKI_TERMINALS` is `off`; `false` turns it off (it is then not advertised and its requests are refused).
	 * Tests hand in a plain-shell host or their own zellij sockets.
	 */
	terminals?: false | TerminalHostOptions;
	log?: (message: string) => void;
	/**
	 * Where `server.status` reads the release and the deploy outcome. Default: discovered from where this code runs — the
	 * release root from this module's location and the deploy status file from the deploy root's layout (see
	 * `resolveDeployStatusFile`).
	 */
	status?: {
		/** The directory holding the running code's root `package.json`. */
		releaseRoot?: string;
		/** The deploy's `deploy-status.json`; `null` disables the deploy part. */
		deployStatusFile?: string | null;
	};
	/**
	 * Web Push. The key pair is generated on first start and shared by every backend, so a device subscribes once; tests
	 * point the transport at a fake push service and hand in a subject.
	 */
	notifications?: {
		/** The VAPID key pair file. Default: `AIKI_VAPID_KEY_FILE`, else `<data>/notifications/vapid.json`. */
		vapidKeyFile?: string;
		/** The VAPID `sub`. Default: `AIKI_VAPID_SUBJECT`, else the first HTTPS allowed origin. */
		subject?: string;
		/** How a push is posted. Default: `fetch`. */
		send?: PushTransport;
		/** Default: 12 hours. */
		ttlSeconds?: number;
		/** The clock quiet hours are read against. Default: the server clock. */
		now?: () => number;
		/** How long events are held while the app is open (`NOTIFICATION_HOLD_MS`, 15 s); tests shorten it. */
		holdMs?: number;
		/** Runs the hold timers. Default: `setTimeout`; a test passes a fake clock. */
		schedule?: HoldScheduler;
		/**
		 * The FCM service-account key file for Android devices. Default: `AIKI_FCM_KEY_FILE`, else
		 * `<data>/notifications/fcm-service-account.json`; a missing file (or `null`) turns FCM off.
		 */
		fcmKeyFile?: string | null;
		/** FCM's origin and `fetch`, which tests point at a fake. Default: `https://fcm.googleapis.com` and `fetch`. */
		fcmEndpoint?: string;
		fcmFetch?: (input: string, init: RequestInit) => Promise<Response>;
	};
};

export type HarnessServer = {
	readonly hostname: string;
	readonly port: number;
	readonly url: string;
	readonly dataDir: string;
	/** The directory whose AGENTS.md and skills the projects read. */
	readonly agentDir: string;
	/** The harness's own config directory, whose SYSTEM.md and APPEND_SYSTEM.md the projects read. */
	readonly configDir: string;
	/** Claude Code's home, whose skills and `.claude/skills` the projects are also offered. */
	readonly claudeDir: string;
	readonly allowedOrigins: readonly string[];
	readonly features: readonly string[];
	/** The projects, their Harnesses and their workers in this process. */
	readonly manager: ProjectManager;
	/** Every project's schedules, kept on disk next to `project.json`. */
	readonly schedules: ScheduleStore;
	/** The backend's one clock: it opens a project when one of its schedules is due. */
	readonly scheduleScheduler: ScheduleScheduler;
	/** The backend's one poll of GitHub for event schedules; it runs only while an enabled one exists. */
	readonly scheduleEvents: ScheduleEventPoller;
	/** The backend's memory scopes, global and per project. */
	readonly memory: MemoryStore;
	/** The backend's memory maintenance: settings, status and the runs `memory.maintain` asks for. */
	readonly memoryMaintenance: MemoryMaintenanceService;
	/** The backend's maintenance clock: the one loop that maintains a scope nightly or after enough writes. */
	readonly maintenanceClock: MemoryMaintenanceClock;
	/** The release, deploy outcome and busy state this server reports. */
	readonly serverStatus: ServerStatusService;
	/** The user's devices and the pushes to them. */
	readonly notifications: Notifier;
	/** Every logged-in subscription's rate-limit windows. */
	readonly subscriptionUsage: SubscriptionUsageService;
	/** Every project's artifacts, served at `/artifacts/<projectId>/<artifactId>` with a signed token. */
	readonly artifacts: ArtifactStore;
	/** The attached terminals; undefined when terminals are off. */
	readonly terminals: TerminalHost | undefined;
	/** One row per model request, for `cache.stats`; undefined when it is off or could not be opened. */
	readonly requestLog: RequestLog | undefined;
	/** Resolves once every project's transcripts were read back into the request log. */
	readonly requestLogBackfill: Promise<void>;
	stop(): Promise<void>;
};

type SocketData = {
	connection?: ClientConnection;
	/** Where the browser reached this backend, for the absolute URLs `artifacts.url` answers. */
	origin: string;
};

export async function startServer(options: StartServerOptions): Promise<HarnessServer> {
	const log = options.log ?? ((message: string) => console.log(message));
	const dataDir = options.dataDir;
	await ensureDataDir(dataDir);

	const store = new ProjectStore(dataDir);
	const credentials = options.credentials ?? new FileCredentialStore(join(dataDir, "credentials.json"));
	const connections = new Set<ClientConnection>();
	const unobservedModels = options.models ?? createHarnessModels({ credentials });
	const subscriptionUsage = new SubscriptionUsageService({
		models: unobservedModels,
		credentials,
		dataDir,
		...options.subscriptionUsage,
		...(options.now === undefined ? {} : { now: options.now }),
		log,
		onChange: (subscriptions) => {
			for (const connection of connections) connection.notifySubscriptionsUsage(subscriptions);
		},
	});
	const cacheReadPerToken = (provider: string, modelId: string): number | undefined => {
		const perMillion = unobservedModels.getModel(provider, modelId)?.cost.cacheRead;
		return perMillion === undefined ? undefined : perMillion / 1_000_000;
	};
	const requestLog = openRequestLog(options.requestLog, dataDir, {
		log,
		cacheReadPerToken,
		...(options.now === undefined ? {} : { now: options.now }),
	});
	// Every model request passes the usage service, which reads rate-limit headers and notices when a turn ends, and the
	// request log, which writes a row for each turn's request once it ends. Outside both, the cache retention each
	// conversation asks for is added to its request's options, so the log records it.
	const usageModels = subscriptionUsage.observeModels(unobservedModels);
	const cacheRetention = new PromptCacheRetention();
	const models = cacheRetention.applyTo(requestLog?.observeModels(usageModels) ?? usageModels);
	const hostname = options.hostname ?? DEFAULT_HOSTNAME;
	const port = options.port ?? resolvePort();
	const allowedOrigins = options.allowedOrigins ?? resolveAllowedOrigins();
	// Without its log, `cache.stats` has nothing to answer with.
	// A terminal is a shell as this server's user, so it can be switched off per backend and is then not even advertised.
	const terminals =
		options.terminals === false || (options.terminals === undefined && !terminalsEnabled())
			? undefined
			: new TerminalHost({ configFile: join(dataDir, "terminals", "zellij-config.kdl"), ...(options.terminals ?? {}), log });
	const features = (options.features ?? HARNESS_FEATURES).filter(
		(feature) => ((feature !== "cache-stats" && feature !== "cache-keep-warm" && feature !== "usage-breakdown") || requestLog !== undefined) && (feature !== "terminal" || terminals !== undefined),
	);
	// One VAPID key pair for every backend: a browser holds one subscription, so the key cannot belong to one process.
	const notificationsDir = join(dataDir, "notifications");
	const vapidKeyFile = options.notifications?.vapidKeyFile ?? resolveVapidKeyFile(dataDir);
	const vapid = await loadOrCreateVapidKeys(vapidKeyFile);
	const notificationStore = new NotificationStore({ dir: notificationsDir, log });
	await notificationStore.read();
	const notificationState = new NotificationStateStore({ dir: notificationsDir, log });
	await notificationState.read();
	// FCM for the Android app: on when the user has put the Firebase project's service-account key in place.
	const fcmKeyFile =
		options.notifications?.fcmKeyFile === undefined ? resolveFcmKeyFile(dataDir) : options.notifications.fcmKeyFile;
	const fcmAccount = fcmKeyFile === null ? undefined : await loadFcmServiceAccount(fcmKeyFile, log);
	const fcm =
		fcmAccount === undefined
			? undefined
			: new FcmSender({
					account: fcmAccount,
					...(options.notifications?.fcmEndpoint === undefined ? {} : { endpoint: options.notifications.fcmEndpoint }),
					...(options.notifications?.fcmFetch === undefined ? {} : { fetch: options.notifications.fcmFetch }),
					log,
				});
	const notifications = new NotificationSender({
		store: notificationStore,
		state: notificationState,
		vapid,
		subject: options.notifications?.subject ?? resolveVapidSubject(allowedOrigins),
		presence: new NotificationPresence(),
		...(options.notifications?.holdMs === undefined ? {} : { holdMs: options.notifications.holdMs }),
		...(options.notifications?.schedule === undefined ? {} : { schedule: options.notifications.schedule }),
		...(options.notifications?.send === undefined ? {} : { send: options.notifications.send }),
		...(options.notifications?.ttlSeconds === undefined ? {} : { ttlSeconds: options.notifications.ttlSeconds }),
		...(fcm === undefined ? {} : { fcm }),
		isArchived: async (projectId) => (await store.load(projectId).catch(() => undefined))?.archived === true,
		...(options.notifications?.now === undefined && options.now === undefined
			? {}
			: { now: options.notifications?.now ?? options.now }),
		log,
	});
	// Events that were in their hold when the last process ended carry on with the rest of their time.
	notifications.restore();
	log(`aiki: notifications ${notificationStore.file} (VAPID key ${vapidKeyFile}, sub ${notifications.subject})`);
	const agentDir = options.agentDir ?? resolveAgentDir();
	const configDir = options.configDir ?? resolveConfigDir();
	const claudeDir = options.claudeDir ?? resolveClaudeDir();
	// The server may run as a system service whose HOME is not the user's, so what its prompts read is worth saying at
	// every start: the agent directory with its AGENTS.md and global skills, the harness's own config directory with the
	// system prompt files it holds, and Claude Code's home with the skills it adds.
	const globalContext = loadAgentContext({ agentDir, configDir, claudeDir, cwd: dataDir });
	const globalFile = globalContext.files.find((file) => file.scope === "global" && file.kind === "agents");
	const globalPromptFiles = globalContext.files.filter((file) => file.kind !== "agents");
	const globalSkillsFrom = (source: LoadedSkill["source"]): number =>
		globalContext.skills.filter((skill) => skill.scope === "global" && skill.source === source).length;
	const promptFileLabel =
		globalPromptFiles.length === 0
			? "no SYSTEM.md or APPEND_SYSTEM.md"
			: globalPromptFiles.map((file) => basename(file.path)).join(" and ");
	log(
		`aiki: agent dir ${agentDir} (${globalFile === undefined ? "no AGENTS.md" : globalFile.path}; ${globalSkillsFrom("pi")} global skill${globalSkillsFrom("pi") === 1 ? "" : "s"})`,
	);
	log(`aiki: config dir ${configDir} (${promptFileLabel})`);
	log(
		`aiki: claude dir ${claudeDir} (${globalSkillsFrom("claude")} global skill${globalSkillsFrom("claude") === 1 ? "" : "s"})`,
	);
	log(
		`aiki: global skills ${globalSkillsFrom("harness")} harness, ${globalSkillsFrom("pi")} pi, ${globalSkillsFrom("claude")} claude`,
	);

	// Set below, once the maintenance clock exists; a memory write is what tells it a scope may be due.
	let maintenanceClock: MemoryMaintenanceClock | undefined;
	const memory = new MemoryStore({
		dataDir,
		log,
		onChange: (scope, projectId) => {
			for (const connection of connections) connection.notifyMemory(scope, projectId);
			maintenanceClock?.wake();
		},
	});
	// The global scope exists and is watched from the start, so an edit made by hand reaches the index and the app even
	// before a request names it.
	await memory.start().catch((error: unknown) => {
		log(`aiki: memory at ${memory.globalDir} is unavailable: ${errorMessage(error)}`);
	});
	log(`aiki: memory ${memory.globalDir} (global) and projects/<id>/memory/ per project`);
	const logins = new OAuthLoginManager({
		models,
		log,
		deviceId: options.logins?.deviceId ?? (() => loadOrCreateDeviceId(join(dataDir, "device-id"))),
		agentName: options.logins?.agentName ?? SERVER_NAME,
		...(options.logins?.idleTimeoutMs === undefined ? {} : { idleTimeoutMs: options.logins.idleTimeoutMs }),
		onChange: (login) => {
			for (const connection of connections) connection.notifyLogin(login);
			if (login.status === "succeeded") subscriptionUsage.credentialsChanged();
		},
		onPrompt: (login) => {
			const event = loginPromptNotification(login);
			if (event !== undefined) notifications.notify(event);
		},
	});
	// Every project's schedules, read without opening anything: the clock below arms one timer from them and a due run
	// opens the one project it belongs to.
	const schedules = new ScheduleStore({
		projects: store,
		...(options.now === undefined ? {} : { now: options.now }),
		...(options.timezone === undefined ? {} : { timezone: options.timezone }),
		log,
	});
	// Memory maintenance is the backend's, not a project's: it walks the scope directories and never opens a project.
	const maintenanceStore = new MemoryMaintenanceStore({ dataDir, log });
	const memoryMaintenance = new MemoryMaintenanceService({
		memory,
		store: maintenanceStore,
		models: requestLog?.observeInternalModels(models, "backend-maintenance", "memory_maintenance") ?? models,
		projects: store,
		timezone: schedules.timezone,
		...(options.now === undefined ? {} : { now: options.now }),
		onChange: (scope, projectId) => {
			for (const connection of connections) connection.notifyMemory(scope, projectId);
		},
		onSettingsChange: () => maintenanceClock?.wake(),
		onFailure: (target, run) => {
			const projectId = target.scope === "project" ? target.projectId : null;
			// The name costs one small read; the push itself is fire and forget.
			void (projectId === null ? Promise.resolve(undefined) : store.load(projectId))
				.then((project) =>
					notifications.notify(
						maintenanceFailureNotification({
							scope: target.scope,
							projectId,
							projectName: project?.name ?? null,
							at: run.at,
							message: run.message,
						}),
					),
				)
				.catch((error: unknown) => log(`memory maintenance: notification failed: ${errorMessage(error)}`));
		},
		log,
	});
	maintenanceClock = new MemoryMaintenanceClock({
		service: memoryMaintenance,
		store: maintenanceStore,
		memory,
		dataDir,
		timezone: schedules.timezone,
		...(options.now === undefined ? {} : { now: options.now }),
		...(options.setTimer === undefined ? {} : { setTimer: options.setTimer }),
		log,
	});
	const artifacts = new ArtifactStore({
		dataDir,
		...(options.artifacts?.maxFileBytes === undefined ? {} : { maxFileBytes: options.artifacts.maxFileBytes }),
		...(options.artifacts?.probeDuration === undefined ? {} : { probeDuration: options.artifacts.probeDuration }),
		...(options.now === undefined ? {} : { now: options.now }),
		log,
		onChange: (event) => {
			for (const connection of connections) connection.notifyArtifact(event);
		},
	});
	const drafts = new DraftStore({
		dataDir,
		...(options.now === undefined ? {} : { now: options.now }),
		log,
		// The writer's own connection already has the answer; everyone else is told.
		onChange: (event, origin) => {
			for (const connection of connections) if (connection !== origin) connection.notifyDraft(event);
		},
	});
	const artifactSigner = new ArtifactUrlSigner({
		secret: await loadOrCreateArtifactSecret(dataDir),
		...(options.now === undefined ? {} : { now: options.now }),
		...(options.artifacts?.urlTtlMs === undefined ? {} : { ttlMs: options.artifacts.urlTtlMs }),
	});
	// Read by main's check-ins; the monitor starts once the status service it pushes through exists.
	let diskMonitor: DiskMonitor | undefined;
	const manager = new ProjectManager({
		diskWarnings: () => diskMonitor?.warnings() ?? [],
		store,
		artifacts,
		models,
		...(requestLog === undefined ? {} : { requestLog }),
		cacheRetention,
		memory,
		maintenance: memoryMaintenance,
		schedules,
		notifications,
		images: options.images,
		agentDir,
		configDir,
		claudeDir,
		toolCallCapMs: options.toolCallCapMs ?? resolveToolCallCapMs(),
		...(options.workFinished === undefined ? {} : { workFinished: options.workFinished }),
		...(options.now === undefined ? {} : { now: options.now }),
		...(options.setTimer === undefined ? {} : { setTimer: options.setTimer }),
		log,
		onArchivedChange: () => {
			void scheduleScheduler.wake();
			void scheduleEvents.wake();
		},
		onProjectState: (summary) => {
			for (const connection of connections) connection.notifyProject(summary);
		},
		onBoardState: (projectId, board) => {
			for (const connection of connections) connection.notifyBoard(projectId, board);
		},
		onThreadsState: (projectId, threads) => {
			for (const connection of connections) connection.notifyThreads(projectId, threads);
		},
		...(options.boardEditDebounceMs === undefined ? {} : { boardEditDebounceMs: options.boardEditDebounceMs }),
		onWorkersState: (projectId, workers, defaults) => {
			for (const connection of connections) connection.notifyWorkers(projectId, workers, defaults);
		},
	});

	// The backend's clock. It reads the persisted next runs, arms one timer for the soonest, and opens a project only when
	// one of its schedules comes due; `start()` also catches up once on whatever was missed while the process was off.
	const scheduleScheduler = new ScheduleScheduler({
		store: schedules,
		fire: (projectId, scheduleId, trigger) => manager.fireSchedule(projectId, scheduleId, trigger),
		...(options.now === undefined ? {} : { now: options.now }),
		...(options.setTimer === undefined ? {} : { setTimer: options.setTimer }),
		log,
	});
	// The poll of GitHub for event schedules: it reads once for every project, and opens a project only to run a request.
	const scheduleEvents = new ScheduleEventPoller({
		store: schedules,
		events: new ScheduleEventStore({ projects: store, log }),
		projects: store,
		reader: new GithubReviewReader({
			...(options.githubReviews?.run === undefined ? {} : { run: options.githubReviews.run }),
			...(options.now === undefined ? {} : { now: options.now }),
		}),
		projectRepos: async (projectId) => (await manager.links(projectId)).githubRepos,
		fire: (projectId, scheduleId, request, fireOptions) => manager.fireScheduleEvent(projectId, scheduleId, request, fireOptions),
		...(options.githubReviews?.pollIntervalMs === undefined ? {} : { intervalMs: options.githubReviews.pollIntervalMs }),
		...(options.now === undefined ? {} : { now: options.now }),
		...(options.setTimer === undefined ? {} : { setTimer: options.setTimer }),
		log,
	});
	manager.scheduleEvents = scheduleEvents;
	// Any change to a schedule reaches every connection and wakes the clock, so a save takes effect at once.
	const pushSchedules = (projectId: string): void => {
		void (async () => {
			try {
				const list = await schedules.list(projectId);
				for (const connection of connections) connection.notifySchedules(projectId, list, schedules.timezone);
			} catch (error) {
				log(`project ${projectId}: could not push schedules: ${errorMessage(error)}`);
			}
		})();
	};
	schedules.onChange = (projectId) => {
		pushSchedules(projectId);
		void scheduleScheduler.wake();
		void scheduleEvents.wake();
	};
	// A note on how the last check of GitHub went reaches the app, and nothing else: it must not wake the poller.
	schedules.onEventStateChange = pushSchedules;

	const serverStatus = await ServerStatusService.create({
		busy: () => manager.busy(),
		disks: () => diskMonitor?.disks ?? [],
		...(options.status?.releaseRoot === undefined ? {} : { releaseRoot: options.status.releaseRoot }),
		...(options.status?.deployStatusFile === undefined
			? {}
			: { deployStatusFile: options.status.deployStatusFile }),
		log,
		onChange: (status) => {
			for (const connection of connections) connection.notifyServerStatus(status);
			void notifications.deployProblem(status.deploy);
		},
	});
	diskMonitor = new DiskMonitor({
		dataDir,
		projects: async () => (await store.list()).map((project) => ({ label: project.name, path: project.path })),
		...(options.disks?.read === undefined ? {} : { read: options.disks.read }),
		...(options.disks?.threshold === undefined ? {} : { threshold: options.disks.threshold }),
		...(options.now === undefined ? {} : { now: options.now }),
		onChange: () => void serverStatus.changed(),
		onLow: (disk, crossedAt) => notifications.notify(diskLowNotification(disk, crossedAt)),
		log,
	});
	await diskMonitor.start(options.disks?.intervalMs);
	// The deploy status the file holds now: an attempt that failed or rolled back before this process started is news
	// after a restart too, and the persisted marker keeps it to once per attempt.
	void notifications.deployProblem(serverStatus.deploy);
	const release = serverStatus.release;
	log(`aiki: release ${release === null ? "none (running from a checkout)" : release.name}`);
	log(
		`aiki: deploy status ${
			serverStatus.deployStatusFile === null ? `none (no deploy root for ${serverStatus.releaseRoot})` : serverStatus.deployStatusFile
		}`,
	);

	// One-time compact summary upgrade before any socket can open the same project storage.
	await manager.prepareAttention();
	const server = Bun.serve<SocketData>({
		hostname,
		port,
		fetch(request, bunServer) {
			const url = new URL(request.url);
			if (url.pathname === "/ws") {
				const origin = request.headers.get("origin");
				if (!isOriginAllowed(origin, allowedOrigins)) {
					return new Response("Forbidden origin", {
						status: 403,
						headers: { "content-type": "text/plain; charset=utf-8" },
					});
				}
				const data: SocketData = { origin: requestOrigin(request) };
				if (bunServer.upgrade(request, { data })) return undefined;
				return new Response("Expected a WebSocket upgrade at /ws", {
					status: 426,
					headers: { upgrade: "websocket" },
				});
			}
			if (url.pathname.startsWith("/artifacts/")) {
				return serveArtifact(request, { store: artifacts, signer: artifactSigner, allowedOrigins }).then(
					(response) => response ?? new Response("Not found", { status: 404 }),
				);
			}
			return new Response("Aiki is an API-only backend; the app is deployed separately.", {
				status: 404,
				headers: { "content-type": "text/plain; charset=utf-8" },
			});
		},
		websocket: {
			open(ws) {
				const connection = new ClientConnection({
					manager,
					credentials,
					logins,
					notifications,
					features,
					serverStatus: () => serverStatus.status(),
					drain: (timeoutMs) => {
						manager.drain.drain(timeoutMs);
						const until = manager.drain.drainingUntil;
						return {
							drainingUntil: until === undefined ? null : new Date(until).toISOString(),
							toolCalls: manager.drain.toolCalls,
						};
					},
					subscriptionUsage,
					...(requestLog === undefined ? {} : { requestLog }),
					artifactUrls: { signer: artifactSigner, origin: ws.data.origin },
					...(terminals === undefined ? {} : { terminals }),
					drafts,
					log,
					io: {
						send: (message) => {
							ws.send(JSON.stringify(message));
						},
						sendBinary: (bytes) => {
							ws.sendBinary(bytes);
						},
						close: (code, reason) => {
							ws.close(code, reason);
						},
					},
				});
				ws.data.connection = connection;
				connections.add(connection);
				subscriptionUsage.clientConnected();
			},
			message(ws, message) {
				const connection = ws.data.connection;
				if (connection !== undefined) void connection.handle(message);
			},
			close(ws) {
				const connection = ws.data.connection;
				ws.data.connection = undefined;
				if (connection === undefined) return;
				connections.delete(connection);
				subscriptionUsage.clientDisconnected();
				connection.close();
			},
			// Image inputs arrive as base64 inside a submit request.
			maxPayloadLength: 32 * 1024 * 1024,
		},
		error(error) {
			log(`http error: ${errorMessage(error)}`);
			return new Response("Internal server error", { status: 500 });
		},
	});

	const actualPort = server.port ?? port;
	log(`aiki: schedules run in ${schedules.timezone}`);
	log(`aiki: memory maintenance settings ${maintenanceStore.file}`);
	// Catch up on runs missed while the process was off, then arm the timer for the next one.
	await scheduleScheduler.start();
	// Event schedules listen from here: GitHub is read at once if one is enabled, and every two minutes while one is.
	scheduleEvents.start();
	// A scope that changed while the process was off is maintained on the way in; then the nightly timer is armed.
	await maintenanceClock.start();
	// Requests made before the request log existed are read back from the transcripts, in the background: live rows of a
	// project wait for its read-back. The log keeps its days by pruning now and once a day.
	let requestLogBackfill: Promise<void> = Promise.resolve();
	let pruneTimer: ReturnType<typeof setInterval> | undefined;
	if (requestLog !== undefined) {
		requestLog.prune();
		pruneTimer = setInterval(() => requestLog.prune(), 24 * 60 * 60 * 1000);
		pruneTimer.unref?.();
		requestLogBackfill = store
			.list()
			.then((projects) =>
				backfillProjects({
					requestLog,
					projects: projects.map((project) => ({ id: project.id, sessionPath: store.sessionPath(project.id) })),
					cacheReadPerToken,
					log,
					...(options.now === undefined ? {} : { now: options.now }),
				}),
			)
			.catch((error: unknown) => log(`request log: read-back failed: ${errorMessage(error)}`));
	}
	let stopped = false;
	const handle: HarnessServer = {
		hostname,
		port: actualPort,
		url: `http://${hostname}:${actualPort}`,
		dataDir,
		agentDir,
		configDir,
		claudeDir,
		allowedOrigins,
		features,
		manager,
		schedules,
		scheduleScheduler,
		scheduleEvents,
		memory,
		memoryMaintenance,
		maintenanceClock,
		serverStatus,
		notifications,
		subscriptionUsage,
		artifacts,
		terminals,
		requestLog,
		requestLogBackfill,
		async stop() {
			if (stopped) return;
			stopped = true;
			scheduleScheduler.stop();
			scheduleEvents.stop();
			maintenanceClock.stop();
			await memoryMaintenance.stop().catch(() => undefined);
			serverStatus.stop();
			manager.drain.stop();
			diskMonitor?.stop();
			notifications.stop();
			await notifications.flush().catch(() => undefined);
			logins.cancelAll();
			await subscriptionUsage.stop().catch(() => undefined);
			await memory.close().catch(() => undefined);
			for (const connection of [...connections]) connection.close();
			connections.clear();
			await terminals?.stop().catch(() => undefined);
			await manager.closeAll();
			if (pruneTimer !== undefined) clearInterval(pruneTimer);
			await requestLogBackfill;
			await requestLog?.close().catch(() => undefined);
			server.stop(true);
		},
	};
	return handle;
}

/** The request log at `config.file` (default in the data directory), or undefined when it is off or will not open. */
function openRequestLog(
	config: StartServerOptions["requestLog"],
	dataDir: string,
	options: Omit<RequestLogOptions, "store"> & { log: (message: string) => void },
): RequestLog | undefined {
	if (config === false) return undefined;
	const file = config?.file ?? join(dataDir, REQUEST_LOG_FILE);
	try {
		const store = RequestLogStore.open(file, options.now === undefined ? {} : { now: options.now() });
		options.log(`aiki: request log ${file}`);
		return new RequestLog({ store, ...options });
	} catch (error) {
		// Model requests go on without it.
		options.log(`aiki: request log ${file} is unavailable: ${errorMessage(error)}`);
		return undefined;
	}
}
