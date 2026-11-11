import { DEFAULT_REPORT_AUDIT } from "@aiki/protocol";
import { readJsonFile, writeJsonFile } from "./fs-json.ts";
import { chooseAuditModel, emptyAuditRecord, auditDay, type ReportAuditRecord } from "./report-audit.ts";
import { createHash } from "node:crypto";
/**
 * One Harness per project, opened lazily on first use and kept open. The root conversation is the project's coordinator
 * and runs pi-durable's CodingTools with the project directory as cwd. Workers the coordinator delegates to are child
 * conversations of the same Harness (see `workers.ts`), and so are the background threads main starts (`threads.ts`):
 * coordinators of their own, each with its own workers, sharing the project's board and memory.
 */
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { CodemodeSandbox } from "@earendil-works/pi-codemode";
import type { Models } from "@earendil-works/pi-ai";
import type { Conversation, ConversationView, Harness, Registry } from "@earendil-works/pi-durable";
import { Harness as HarnessImpl, LiveDoc, createRegistry } from "@earendil-works/pi-durable";
import { AgentExecutionEnv } from "./agent-execution-env.ts";
import { createNodePhotonImages } from "@earendil-works/pi-durable/images/node";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import type { ImageProcessor } from "@earendil-works/pi-durable/tools";
import { createCodingTools } from "@earendil-works/pi-durable/tools";
import type { SetTimer } from "@earendil-works/pi-durable";
import type { MemoryMaintenanceSettings, MemoryScopeStatus } from "@aiki/protocol";
import {
	type ConversationContext,
	type MemoryChange,
	type MemoryFile,
	type MemoryFileSummary,
	type MemoryScope,
	type MemorySearchHit,
	type ModelRef,
	type ProjectActivity,
	type ProjectSummary,
	type Schedule,
	type ScheduleInput,
	type ScheduleRun,
	type ThinkingLevel,
	type WorkerDefaults,
	type WorkerSummary,
	type ThreadSummary,
	type StorageItem,
	MAIN_THREAD_ID,
	type Board,
	type BoardQuestion,
	type BoardTask,
	type BoardTaskSnapshot,
	type BoardTimelineKind,
	type BoardFeedback,
	type BoardFeedbackState,
	type BoardTaskInput,
	type ProjectLinks,
	type ProjectLinkSettings,
	type RefDetails,
	type RefStatus,
	NO_PROJECT_LINKS,
} from "@aiki/protocol";
import {
	DEFAULT_ACTIVITY,
	ProjectActivityService,
	ProjectActivityStore,
	idleActivity,
	sameActivity,
} from "./activity.ts";
import { createArtifactExtension } from "./artifact-tools.ts";
import { ArtifactStore } from "./artifacts.ts";
import { cacheRetentionFor, type PromptCacheRetention } from "./cache-retention.ts";
import { createCodemodeSandbox, createHarnessCodemodeExtension } from "./codemode.ts";
import { Coordinators } from "./coordinators.ts";
import { createAgentContextExtension, readConversationContext } from "./context.ts";
import { createFolderContextExtension } from "./folder-context.ts";
import { resolveAgentDir, resolveClaudeDir, resolveConfigDir } from "./data-dir.ts";
import { ServerError, errorMessage } from "./errors.ts";
import { MemoryExtractionService, MemoryExtractionStore } from "./memory-extraction.ts";
import type { MemoryMaintenanceService } from "./memory-maintenance.ts";
import { MemoryStore } from "./memory.ts";
import { MemoryService } from "./memory-tools.ts";
import { describeModels, findModel, type ModelCatalog } from "./models.ts";
import {
	type Notifier,
	compactionFailureNotification,
	replyNotification,
} from "./notifications.ts";
import { ProjectStorage } from "./storage.ts";
import { DEFAULT_WORK_QUIET_MS, WorkFinishedWatch, resolveWorkFinishedMs } from "./work-finished.ts";
import type { Project, ProjectChange, ProjectStore } from "./projects.ts";
import { ProjectLinkDetector } from "./project-links.ts";
import type { FireEventOptions, ReviewRequest, ScheduleEventPoller } from "./schedule-events.ts";
import { RefDetailsService } from "./ref-details.ts";
import { RefStatusService } from "./ref-status.ts";
import type { BusyState } from "./server-status.ts";
import { CompactionService, ContextUsageReader, coordinatorCompactionSettings } from "./compaction.ts";
import { BoardService, openQuestionCount } from "./board.ts";
import { HistoryService } from "./history.ts";
import { type ScheduleStore, SchedulesService, nextRunAfter } from "./schedules.ts";
import { ThreadService } from "./threads.ts";
import { createToolCapExtension, DEFAULT_TOOL_CALL_CAP_MS } from "./tool-caps.ts";
import { ToolCallDrain } from "./drain.ts";
import { WorkerService } from "./workers.ts";
import { TaskChangeObserver, TASK_CHANGES_FILE } from "./task-changes.ts";
import { ProjectAttentionStore, boardAttention, workerAttention, threadAttention } from "./sidebar-attention.ts";
import { readStoredAttention } from "./sidebar-attention-migration.ts";
import type { ConversationIdentity, RequestLog } from "./request-log.ts";
import { join } from "node:path";

export type ProjectRuntime = {
	readonly project: Project;
	readonly harness: Harness;
	readonly conversation: Conversation;
	readonly registry: Registry;
	/** This project's workers: the durable list, workspace bookkeeping and the coordinator's tools. */
	readonly workers: WorkerService;
	/** This project's schedules: the clock's side of them and the coordinator's `schedule_*` tools. */
	readonly schedules: SchedulesService;
	/** The coordinator's board document and `board` tool; workers remove the extension. */
	readonly board: BoardService;
	/** The coordinator's memory tools and prompt section; workers remove the extension. */
	readonly memory: MemoryService;
	/** The coordinator's compaction summary and the `history` tool; workers remove both extensions. */
	readonly compaction: CompactionService;
	/** Extraction of memories from the parts a compaction replaces. */
	readonly extraction: MemoryExtractionService;
	readonly history: HistoryService;
	/** Reads `ConversationContext.usage` for every conversation of the project. */
	readonly usage: ContextUsageReader;
	/** What the project is doing, pushed as `project.state`; persisted while its Harness is open. */
	readonly activity: ProjectActivityService;
	/** Main and its background threads: which conversations are coordinators, and where each one's workers work. */
	readonly coordinators: Coordinators;
	/** The project's background threads: the durable list, their tools and their live status. */
	readonly threads: ThreadService;
	/** What the workers' and threads' workspaces take on disk, and removing finished ones. */
	readonly storage: ProjectStorage;
};

/**
 * The least time between two recomputations of a watched context. A commit that can change it waits for this long and
 * is then recomputed with everything that arrived meanwhile, so a busy turn costs at most about one per second.
 */
export const CONTEXT_PUSH_INTERVAL_MS = 1_000;

/**
 * What a watched view must change in before the context can differ: the finished transcript entries and the conversation's
 * agent settings (cwd, model, tools, instructions). Live output (`pi.live`) and the other documents cannot change the
 * context, so streaming updates do not trigger a recomputation at all.
 */
function contextSignal(value: ConversationView): string {
	const first = value.entries[0]?.id;
	const last = value.entries.at(-1)?.id;
	// The number of running compactions decides `usage.compacting`, and nothing else of `pi.live` reaches the context, so
	// only that count is part of the signal: streaming output still never triggers a recomputation.
	const live = value.docs["pi.live"] as { compactions?: unknown[] } | undefined;
	const compacting = Array.isArray(live?.compactions) ? live.compactions.length : 0;
	return `${value.entries.length}:${first ?? ""}:${last ?? ""}:${compacting}:${JSON.stringify(value.docs["pi.agent"] ?? null)}`;
}

type RuntimeEntry = {
	project: Project;
	state: "opening" | "open" | "failed" | "closed";
	failure?: string;
	opening?: Promise<ProjectRuntime>;
	runtime?: ProjectRuntime;
	/** Stops the worker-list watch of an open runtime. */
	stopWorkersWatch?: () => Promise<void>;
	stopBoardWatch?: () => Promise<void>;
	stopTaskChanges?: () => Promise<void>;
	/** Stops the background threads' watches of an open runtime. */
	stopThreads?: () => Promise<void>;
	/** Stops the extraction watch of an open runtime. */
	stopExtraction?: () => Promise<void>;
	/** Stops the watch that announces a project going quiet after a stretch of work. */
	stopWorkFinished?: () => Promise<void>;
};

export type ProjectManagerOptions = {
	store: ProjectStore;
	models: Models;
	/** Logs every turn's model request; each project installs its extension, which tells it the conversation. */
	requestLog?: RequestLog;
	/** Sets each turn's cache retention from the project's `longPromptCache`; `models` must be wrapped by it. */
	cacheRetention?: PromptCacheRetention;
	/** Every project's schedules, on disk and shared by all of them. */
	schedules: ScheduleStore;
	/** `null` disables image processing for `read`; omitted creates the Photon worker processor once. */
	images?: ImageProcessor | null;
	/** The Harness clock; tests pass a fake one so check-in timers run instantly. Default: `Date.now`. */
	now?: () => number;
	/** The Harness timer, for tests with a fake clock. Default: `setTimeout`. */
	setTimer?: SetTimer;
	/**
	 * The directory whose AGENTS.md and skills every conversation is given. Default: `AIKI_AGENT_DIR`, else
	 * `~/.pi/agent` of the user the server runs as.
	 */
	agentDir?: string;
	/**
	 * The harness's own config directory, whose SYSTEM.md and APPEND_SYSTEM.md apply to every conversation. Default:
	 * `AIKI_CONFIG_DIR`, else `${XDG_CONFIG_HOME:-~/.config}/aiki`.
	 */
	configDir?: string;
	/**
	 * Claude Code's home, whose skills, enabled plugins' skills and `.claude/skills` every conversation is also given.
	 * Default: `AIKI_CLAUDE_DIR`, else `~/.claude` of the user the server runs as.
	 */
	claudeDir?: string;
	log?: (message: string) => void;
	/** Called after a project was archived or unarchived, so the schedule clock and the GitHub poller look again. */
	onArchivedChange?: (projectId: string, archived: boolean) => void;
	/** Called when a project's Harness state changes, so connections can push `project.state`. */
	onProjectState?: (summary: ProjectSummary) => void;
	/** Called whenever a project's worker list changes, so connections can push `workers.state`. */
	onWorkersState?: (projectId: string, workers: WorkerSummary[], defaults: WorkerDefaults) => void;
	/** Called whenever a project's board changes (without archived tasks), so connections can push `board.state`. */
	onBoardState?: (projectId: string, board: Board) => void;
	/** Called whenever a project's threads change (without archived ones), so connections can push `threads.state`. */
	onThreadsState?: (projectId: string, threads: ThreadSummary[]) => void;
	/** How long the user's board edits wait for another before they reach the coordinator. Default 3 s. */
	boardEditDebounceMs?: number;
	taskFreshness?: boolean;
	reportAudit?: boolean;
	/**
	 * The backend's memory scopes. Default: one over the store's data directory, without change notifications, which only
	 * the server needs.
	 */
	memory?: MemoryStore;
	/** The backend's maintenance (settings, status and the runs `memory.maintain` asks for). */
	maintenance?: MemoryMaintenanceService;
	/** The user's devices: they hear about replies, compactions that failed, and their workers. */
	notifications?: Notifier;
	/** What each project already extracted from its compactions. Default: one over the project store. */
	extractions?: MemoryExtractionStore;
	/**
	 * How long the coordinator's own `bash`/`powershell` calls may run before they are stopped with a message to
	 * delegate. Default: `resolveToolCallCapMs()`. Workers are unaffected: they keep the tools' own timeouts.
	 */
	toolCallCapMs?: number;
	/** Holds new tool calls while a deploy drains the server, and counts the executing ones. Default: a fresh one. */
	drain?: ToolCallDrain;
	/** The backend's artifact store, behind every conversation's `artifact_save`. Default: one over the data directory. */
	artifacts?: ArtifactStore;
	/**
	 * When `work_finished` goes out: after `minWorkMs` of continuous work (default `resolveWorkFinishedMs()`, 10 minutes)
	 * and once the project stayed quiet for `quietMs` (default 30 s).
	 */
	workFinished?: { minWorkMs?: number; quietMs?: number };
	/** One line per low disk, for main's check-ins. Default: none. */
	diskWarnings?: () => string[];
	/** Fills in the link settings of projects whose user has not set them. Default: one over the host's git, jj and acli. */
	linkDetector?: ProjectLinkDetector;
	/** Reads the live state of tickets and pull requests. Default: one over the host's gh and acli. */
	refStatus?: RefStatusService;
	/** Reads what a ref's card shows. Default: one over the host's gh and acli. */
	refDetails?: RefDetailsService;
};

function projectSummary(
	project: Project,
	entry: RuntimeEntry | undefined,
	activity: ProjectActivity,
	links: ProjectLinkSettings,
): ProjectSummary {
	const state = entry?.state === "opening" || entry?.state === "open" ? "open" : (entry?.state ?? "closed");
	return {
		id: project.id,
		name: project.name,
		path: project.path,
		coordinator: {
			model: project.coordinator.model,
			thinkingLevel: project.coordinator.thinkingLevel,
		},
		workerModels: project.workerModels,
		checkIns: project.checkIns,
		longPromptCache: project.longPromptCache,
		keepPromptCacheWarm: project.keepPromptCacheWarm,
		promptCacheWarmHours: project.promptCacheWarmHours,
		uiProof: project.uiProof,
		integrationRef: project.integrationRef ?? (project.integrationRef === null ? null : "auto"),
		links,
		state: state === "failed" ? "failed" : state === "open" ? "open" : "closed",
		...(project.archived === true ? { archived: true } : {}),
		activity,
		...(entry?.failure === undefined ? {} : { failure: entry.failure }),
	};
}

export class ProjectManager {
	readonly store: ProjectStore;
	readonly models: Models;
	/** Every project's artifacts: `artifact_save` writes them, the `artifacts.*` requests read and delete them. */
	readonly artifacts: ArtifactStore;
	readonly #log: (message: string) => void;
	readonly #onProjectState: ((summary: ProjectSummary) => void) | undefined;
	readonly #onArchivedChange: ((projectId: string, archived: boolean) => void) | undefined;
	readonly #onBoardState: ((projectId: string, board: Board) => void) | undefined;
	readonly #onThreadsState: ((projectId: string, threads: ThreadSummary[]) => void) | undefined;
	readonly #boardEditDebounceMs: number | undefined;
	readonly #taskFreshness: boolean;
	readonly #reportAudit: boolean;
	/** Shared across project summaries; pending auth checks are coalesced too. */
	readonly #auditModelCache = new Map<string, { expiresAt: number; model: ReturnType<typeof chooseAuditModel> }>();
	readonly #onWorkersState:
		| ((projectId: string, workers: WorkerSummary[], defaults: WorkerDefaults) => void)
		| undefined;
	readonly #now: (() => number) | undefined;
	readonly #setTimer: SetTimer | undefined;
	readonly #agentDir: string;
	readonly #configDir: string;
	readonly #claudeDir: string;
	readonly #memory: MemoryStore;
	readonly #maintenance: MemoryMaintenanceService | undefined;
	readonly #notifications: Notifier | undefined;
	readonly #schedules: ScheduleStore;
	readonly #activityStore: ProjectActivityStore;
	readonly #attentionStore: ProjectAttentionStore;
	readonly #attentionTimers = new Map<string, ReturnType<typeof setTimeout>>();
	#closing = false;
	/** The last activity seen for each project, so a summary never waits for a disk read. */
	readonly #activities = new Map<string, ProjectActivity>();
	readonly #runtimes = new Map<string, RuntimeEntry>();
	readonly #extractions: MemoryExtractionStore;
	readonly #toolCallCapMs: number;
	/** Every project's tool calls go through it: `server.drain` holds them, `busy().toolCalls` counts them. */
	readonly drain: ToolCallDrain;
	readonly #workFinished: { minWorkMs: number; quietMs: number };
	readonly #diskWarnings: (() => string[]) | undefined;
	readonly #requestLog: RequestLog | undefined;
	readonly #cacheRetention: PromptCacheRetention | undefined;
	/** One sandbox for every project this manager opens; fresh per process, like a restart in tests. */
	readonly #codemodeSandbox: CodemodeSandbox;
	/** Where ticket keys and PR numbers point in projects whose user left it to the server. */
	readonly linkDetector: ProjectLinkDetector;
	readonly #refStatus: RefStatusService;
	readonly #refDetails: RefDetailsService;
	#images: ImageProcessor | null | undefined;
	#imagesPromise: Promise<ImageProcessor | null> | undefined;

	constructor(options: ProjectManagerOptions) {
		this.store = options.store;
		this.models = options.models;
		this.#log = options.log ?? ((message) => console.log(message));
		this.artifacts = options.artifacts ?? new ArtifactStore({ dataDir: options.store.dataDir, log: this.#log });
		this.#onProjectState = options.onProjectState;
		this.#onArchivedChange = options.onArchivedChange;
		this.#onWorkersState = options.onWorkersState;
		this.#onBoardState = options.onBoardState;
		this.#onThreadsState = options.onThreadsState;
		this.#boardEditDebounceMs = options.boardEditDebounceMs;
		this.#taskFreshness = options.taskFreshness !== false;
		this.#reportAudit = options.reportAudit !== false;
		this.#now = options.now;
		this.#setTimer = options.setTimer;
		this.#agentDir = options.agentDir ?? resolveAgentDir();
		this.#configDir = options.configDir ?? resolveConfigDir();
		this.#claudeDir = options.claudeDir ?? resolveClaudeDir();
		this.#memory = options.memory ?? new MemoryStore({ dataDir: options.store.dataDir, log: this.#log });
		this.#maintenance = options.maintenance;
		this.#notifications = options.notifications;
		this.#extractions = options.extractions ?? new MemoryExtractionStore({ projects: options.store, log: this.#log });
		this.#schedules = options.schedules;
		this.#activityStore = new ProjectActivityStore(options.store);
		this.#attentionStore = new ProjectAttentionStore((id) => options.store.projectDir(id), (error) => this.#log(`attention save failed: ${errorMessage(error)}`));
		this.#toolCallCapMs = options.toolCallCapMs ?? DEFAULT_TOOL_CALL_CAP_MS;
		this.drain = options.drain ?? new ToolCallDrain({ log: this.#log });
		this.#diskWarnings = options.diskWarnings;
		this.#requestLog = options.requestLog;
		this.#cacheRetention = options.cacheRetention;
		this.#workFinished = {
			minWorkMs: options.workFinished?.minWorkMs ?? resolveWorkFinishedMs(),
			quietMs: options.workFinished?.quietMs ?? DEFAULT_WORK_QUIET_MS,
		};
		this.#codemodeSandbox = createCodemodeSandbox();
		this.#images = options.images;
		this.linkDetector = options.linkDetector ?? new ProjectLinkDetector();
		this.linkDetector.onChange = (path) => void this.#emitProjectsAt(path);
		this.#refStatus =
			options.refStatus ?? new RefStatusService({ jiraSite: () => this.linkDetector.jiraLoginSite(), log: this.#log });
		this.#refDetails =
			options.refDetails ?? new RefDetailsService({ jiraSite: () => this.linkDetector.jiraLoginSite(), log: this.#log });
	}

	/** Resolves a project ID to its stored record. */
	async requireProject(projectId: string): Promise<Project> {
		return this.store.require(projectId);
	}

	async summary(project: Project): Promise<ProjectSummary> {
		return this.#summaryOf(project);
	}

	/** Where a project's ticket keys and PR numbers point: the user's settings, else what the host tells. */
	async links(projectId: string): Promise<ProjectLinks> {
		const project = await this.store.require(projectId);
		return project.links ?? (await this.linkDetector.links(project.path));
	}

	/** The live state of a project's refs that this host can read (`refs.status`). */
	async refStatuses(projectId: string, refs: readonly string[]): Promise<RefStatus[]> {
		return this.#refStatus.statuses(refs, await this.links(projectId));
	}

	/** What a ref's card shows, when this host can read it (`refs.details`). */
	async refDetails(projectId: string, ref: string): Promise<RefDetails | null> {
		return this.#refDetails.details(ref, await this.links(projectId));
	}

	/** Upgrade old summaries before accepting connections; never starts a model or opens a Harness. */
	async prepareAttention(): Promise<void> {
		for (const project of await this.store.list()) {
			try {
				if (await this.#attentionStore.read(project.id) === undefined) {
					this.#attentionStore.update(project.id, await readStoredAttention(this.store.sessionPath(project.id)));
				}
				await this.#summaryOf(project);
			} catch (error) {
				this.#log(`project ${project.id}: attention upgrade failed: ${errorMessage(error)}`);
			}
		}
	}

	async list(): Promise<ProjectSummary[]> {
		const projects = await this.store.list();
		return Promise.all(projects.map((project) => this.#summaryOf(project)));
	}

	async add(path: string): Promise<ProjectSummary> {
		const project = await this.store.add(path);
		return this.#summaryOf(project);
	}

	/** Persists a change and applies it to a Harness already open. A closed project picks it up when it opens. */
	async configure(projectId: string, change: ProjectChange): Promise<ProjectSummary> {
		const before = await this.store.require(projectId);
		this.#validateModels(change);
		const archiving = change.archived === true && before.archived !== true;
		const unarchiving = change.archived === false && before.archived === true;
		if (archiving) await this.#requireNothingRunning(projectId);
		const project = await this.store.update(projectId, change);
		if (unarchiving) await this.#schedules.resume(projectId);
		if (archiving || unarchiving) {
			try {
				this.#onArchivedChange?.(projectId, archiving);
			} catch (error) {
				this.#log(`project ${projectId}: archive listener failed: ${errorMessage(error)}`);
			}
		}
		// Back to automatic: look again rather than show what was found before the user changed it.
		if (change.links === null) this.linkDetector.forget(project.path);

		this.#requestLog?.warming.invalidate(projectId, "Project settings changed");
		const entry = this.#runtimes.get(projectId);
		// The worker lists decide their model at spawn time, so an updated default applies to the next worker only.
		if (entry !== undefined) entry.project = project;
		if (entry?.runtime !== undefined) {
			try {
				await entry.runtime.conversation.configure(
					{
						model: project.coordinator.model,
						thinkingLevel: project.coordinator.thinkingLevel,
						cwd: project.path,
					},
					BACKGROUND_CONTEXT,
				);
			} catch (error) {
				throw new ServerError(
					"harness_failed",
					`The change was saved but could not be applied to the open project: ${errorMessage(error)}`,
				);
			}
		}
		const summary = await this.#summaryOf(project);
		this.#emit(summary);
		return summary;
	}

	/**
	 * Refuses with `project_busy`, naming what runs, while the coordinator is working, a worker runs or a background
	 * thread runs. Only an open project can be running, so a closed one is never opened for this.
	 */
	async #requireNothingRunning(projectId: string): Promise<void> {
		const entry = this.#runtimes.get(projectId);
		if (entry?.state !== "open" || entry.runtime === undefined) return;
		const runtime = entry.runtime;
		const coordinator = this.#activities.get(projectId)?.coordinator === "working";
		const { workers } = await runtime.workers.list();
		const runningWorkers = workers.filter((worker) => worker.status === "running").length;
		const threads = (await runtime.threads.list(false)).filter((thread) => !thread.main && thread.status === "running").length;
		const running: string[] = [];
		if (coordinator) running.push("the coordinator is working");
		if (runningWorkers > 0) running.push(`${runningWorkers} worker${runningWorkers === 1 ? "" : "s"} ${runningWorkers === 1 ? "is" : "are"} running`);
		if (threads > 0) running.push(`${threads} background thread${threads === 1 ? "" : "s"} ${threads === 1 ? "is" : "are"} running`);
		if (running.length === 0) return;
		throw new ServerError(
			"project_busy",
			`Can't archive this project while ${running.join(" and ")}. Stop them first.`,
			{ coordinator, workers: runningWorkers, threads },
		);
	}

	async catalog(): Promise<ModelCatalog> {
		return describeModels(this.models);
	}

	/**
	 * The project's Harness and coordinator conversation, opening the Harness on first use. A Harness that failed or
	 * closed is reopened instead of answering with a dead handle.
	 */
	async open(projectId: string): Promise<{ project: Project; runtime: ProjectRuntime }> {
		const project = await this.store.require(projectId);
		let entry = this.#runtimes.get(projectId);
		if (entry?.runtime !== undefined && entry.state === "open") return { project, runtime: entry.runtime };
		if (entry?.opening !== undefined) {
			const runtime = await entry.opening;
			return { project, runtime };
		}

		entry = { project, state: "opening" };
		const opening = this.#openRuntime(entry);
		entry.opening = opening;
		this.#runtimes.set(projectId, entry);
		try {
			const runtime = await opening;
			entry.runtime = runtime;
			entry.state = "open";
			entry.opening = undefined;
			await this.#requestLog?.warming.restore(projectId).catch(error => { this.#log(`request log: cache warm restore skipped: ${errorMessage(error)}`); });
			entry.failure = undefined;
			await this.#notify(project);
			return { project, runtime };
		} catch (error) {
			entry.state = "failed";
			entry.opening = undefined;
			entry.failure = errorMessage(error);
			await this.#notify(project, entry.failure);
			throw error;
		}
	}

	/** Main's conversation, or a background thread's when `threadId` names one (`unknown_thread` otherwise). */
	async conversation(
		projectId: string,
		threadId?: string,
	): Promise<{ project: Project; runtime: ProjectRuntime; conversation: Conversation }> {
		const { project, runtime } = await this.open(projectId);
		if (threadId === undefined || threadId === MAIN_THREAD_ID) return { project, runtime, conversation: runtime.conversation };
		return { project, runtime, conversation: await runtime.threads.conversation(threadId) };
	}

	/**
	 * The user typed into a thread: a finished or stopped background thread works again. Main and live threads are
	 * left as they are.
	 */
	async reviveThread(projectId: string, threadId: string | undefined): Promise<void> {
		if (threadId === undefined || threadId === MAIN_THREAD_ID) return;
		const { runtime } = await this.open(projectId);
		await runtime.threads.revive(threadId);
	}

	/** The project's threads, main first; archived ones only when asked for. */
	async threads(projectId: string, includeArchived: boolean): Promise<ThreadSummary[]> {
		const { runtime } = await this.open(projectId);
		return runtime.threads.list(includeArchived);
	}

	async stopThread(projectId: string, threadId: string): Promise<ThreadSummary> {
		const { runtime } = await this.open(projectId);
		return runtime.threads.stopThread(threadId);
	}

	async storage(projectId: string): Promise<{ totalBytes: number; items: StorageItem[]; measuredAt: string }> {
		const { runtime } = await this.open(projectId);
		return runtime.storage.list();
	}

	async cleanStorage(
		projectId: string,
		itemIds: readonly string[] | undefined,
	): Promise<{ removed: string[]; freedBytes: number; refused: { id: string; reason: string }[] }> {
		const { runtime } = await this.open(projectId);
		return runtime.storage.clean(itemIds);
	}

	async archiveThread(projectId: string, threadId: string, archived: boolean): Promise<ThreadSummary> {
		const { runtime } = await this.open(projectId);
		if (archived) this.#requestLog?.warming.invalidate(projectId, "Thread archived", Number((await runtime.threads.conversation(threadId)).id));
		return runtime.threads.archive(threadId, archived);
	}

	/**
	 * Compact the coordinator now, with the coordinator's own summary (see `compaction.ts`). Resolves once the compaction
	 * is admitted: it summarizes while the conversation keeps working, and the summary lands as a `pi.compaction` entry.
	 */
	async compact(projectId: string, instructions?: string, threadId?: string): Promise<void> {
		const project = await this.store.require(projectId);
		if (project.coordinator.model === null) {
			throw new ServerError(
				"no_coordinator_model",
				"This project has no coordinator model, so there is nothing to compact with. Set one with projects.configure.",
				{ projectId: project.id },
			);
		}
		const { conversation } = await this.conversation(projectId, threadId);
		this.#requestLog?.warming.invalidate(projectId, "Compaction started", Number(conversation.id));
		await conversation.compact(instructions, BACKGROUND_CONTEXT);
	}

	/** A worker's conversation, which clients watch and page read-only; looked up in `threadId`'s workers (main's by default). */
	async workerConversation(
		projectId: string,
		workerId: string,
		threadId?: string,
	): Promise<{ project: Project; runtime: ProjectRuntime; conversation: Conversation }> {
		const { project, runtime, conversation: owner } = await this.conversation(projectId, threadId);
		const conversation = await runtime.workers.conversation(workerId, owner.id);
		if (conversation === undefined) {
			throw new ServerError("unknown_worker", `No worker "${workerId}" in this project`, { workerId });
		}
		return { project, runtime, conversation };
	}

	/**
	 * What a restart would interrupt now: coordinator conversations with a run in progress, workers whose durable status
	 * is `running`, across the projects open in this process, and the tool calls executing in any of them. A closed project runs nothing, so this never opens one and
	 * costs two document snapshots per open project (both are reads of state the Harness keeps in memory).
	 */
	async busy(): Promise<BusyState> {
		const open = [...this.#runtimes.values()].filter(
			(entry): entry is RuntimeEntry & { runtime: ProjectRuntime } => entry.state === "open" && entry.runtime !== undefined,
		);
		const busy: BusyState = { conversations: 0, workers: 0, toolCalls: this.drain.toolCalls };
		for (const entry of open) {
			const runtime = entry.runtime;
			// Main and every background thread: each is a coordinator conversation with workers of its own.
			for (const place of runtime.coordinators.places()) {
				const [live, workers] = await Promise.all([
					runtime.harness.snapshot(LiveDoc, place.conversationId as Conversation["id"], BACKGROUND_CONTEXT),
					runtime.workers.state(BACKGROUND_CONTEXT, place.conversationId),
				]);
				// `pi.live`'s `run` is present exactly while the conversation has a run in progress.
				if (live?.run !== undefined) busy.conversations += 1;
				for (const record of Object.values(workers.workers)) {
					if (record.status === "running") busy.workers += 1;
				}
			}
		}
		return busy;
	}

	/**
	 * The project's workers with their live status, and the worker model the project starts from: every thread's, or
	 * one thread's when `threadId` names it.
	 */
	async workers(projectId: string, threadId?: string): Promise<{ workers: WorkerSummary[]; defaults: WorkerDefaults }> {
		const { runtime } = await this.open(projectId);
		if (threadId !== undefined && threadId !== MAIN_THREAD_ID && (await runtime.threads.record(threadId)) === undefined) {
			throw new ServerError("unknown_thread", `No thread "${threadId}" in this project`, { threadId });
		}
		return runtime.workers.list(threadId);
	}

	/** Remember the worker model the user picked with a message, so workers started from now on use it. */
	async rememberWorkerDefaults(
		projectId: string,
		change: { model?: ModelRef | null; thinkingLevel?: ThinkingLevel | null },
	): Promise<void> {
		const { runtime } = await this.conversation(projectId);
		if (change.model !== undefined && change.model !== null) this.#requireModel(change.model);
		await runtime.workers.rememberDefaults(change);
	}

	/** Set the worker model the project starts from, without a message; the worker watch pushes `workers.state`. */
	async setWorkerDefaults(projectId: string, defaults: WorkerDefaults): Promise<WorkerDefaults> {
		await this.store.require(projectId);
		if (defaults.model !== null) this.#requireModel(defaults.model);
		const { runtime } = await this.conversation(projectId);
		return runtime.workers.setDefaults(defaults);
	}

	/** The project's board; archived tasks only when asked for. */
	async board(projectId: string, includeArchived: boolean): Promise<Board> {
		const { runtime } = await this.open(projectId);
		return runtime.board.get(includeArchived);
	}

	async markBoardReportStale(projectId: string, input: { taskId: string; sections?: readonly ("results" | "next")[] | undefined; reason?: string | undefined }) {
		const { runtime } = await this.open(projectId);
		return runtime.board.markReportStale(input.taskId, input.sections, input.reason);
	}

	/** A board task's snapshots, oldest first; `unknown_task` when the board has no such task. */
	async boardTaskHistory(projectId: string, taskId: string): Promise<BoardTaskSnapshot[]> {
		const { runtime } = await this.open(projectId);
		return runtime.board.history(taskId);
	}

	/** A board task's timeline and feedback; `unknown_task` when the board has no such task. */
	async boardTaskTimeline(projectId: string, taskId: string, kinds?: readonly BoardTimelineKind[]) {
		const { runtime } = await this.open(projectId);
		return runtime.board.timeline(taskId, kinds);
	}

	/** The user sets a feedback entry's state (dismisses or reopens it). */
	async setBoardFeedback(
		projectId: string,
		input: { taskId: string; feedbackId: string; state: BoardFeedbackState; note?: string | undefined },
	): Promise<BoardFeedback> {
		const { runtime } = await this.conversation(projectId);
		return runtime.board.setFeedback(input);
	}

	/** Record the user's message about a task as feedback on it; answers the entry whose ID goes in the message. */
	async recordBoardFeedback(
		projectId: string,
		input: { taskId: string; text: string; images: number; threadId: string; requestId: string },
	): Promise<BoardFeedback> {
		const { runtime } = await this.open(projectId);
		return runtime.board.recordFeedback(input);
	}

	/** Refuse a message about a task the board does not have, with `unknown_task`. */
	async requireBoardTask(projectId: string, taskId: string): Promise<void> {
		const { runtime } = await this.open(projectId);
		await runtime.board.requireTask(taskId);
	}

	async saveBoardTask(
		projectId: string,
		input: { taskId?: string | undefined; expectedRevision?: number | undefined; task: BoardTaskInput; note?: string | undefined },
	): Promise<BoardTask> {
		const { runtime } = await this.conversation(projectId);
		return runtime.board.saveTask(input, "user");
	}

	async reorderBoardTasks(projectId: string, taskIds: readonly string[]): Promise<void> {
		const { runtime } = await this.conversation(projectId);
		await runtime.board.reorder(taskIds);
	}

	async answerBoardQuestion(
		projectId: string,
		input: { questionId: string; expectedRevision: number; answer: string },
	): Promise<BoardQuestion> {
		const { runtime } = await this.conversation(projectId);
		return runtime.board.answer(input);
	}

	/** One project's schedules, read without opening it, and the timezone they run in. */
	async schedules(projectId: string): Promise<{ schedules: Schedule[]; timezone: string }> {
		const project = await this.store.require(projectId);
		return {
			schedules: await this.#schedules.list(project.id),
			timezone: this.#schedules.timezone,
		};
	}

	/** Create or replace a schedule the user saved in the app; a closed project picks it up when the clock fires. */
	async saveSchedule(projectId: string, input: ScheduleInput, scheduleId?: string): Promise<Schedule> {
		const project = await this.store.require(projectId);
		return this.#schedules.save(project.id, input, {
			createdBy: "user",
			...(scheduleId === undefined ? {} : { scheduleId }),
		});
	}

	async deleteSchedule(projectId: string, scheduleId: string): Promise<void> {
		const project = await this.store.require(projectId);
		await this.#schedules.delete(project.id, scheduleId);
	}

	/** Run a schedule now, opening the project if it was closed. */
	async runSchedule(projectId: string, scheduleId: string): Promise<ScheduleRun> {
		const { runtime } = await this.open(projectId);
		return runtime.schedules.runNow(scheduleId);
	}

	/**
	 * A schedule came due: open the project and let it start the worker. A project that cannot open is recorded `failed`
	 * with the reason and its next run moves on, so the clock cannot spin on the same failure.
	 */
	async fireSchedule(projectId: string, scheduleId: string, trigger: "schedule" | "catch-up"): Promise<void> {
		const schedule = await this.#schedules.find(projectId, scheduleId);
		if (schedule === undefined) return;
		// Archived since the clock read it: the slot is not run, and it is not recorded either.
		if ((await this.store.load(projectId))?.archived === true) return;
		const stored = schedule.nextRunAt === null ? Number.NaN : Date.parse(schedule.nextRunAt);
		const due = Number.isFinite(stored) ? stored : this.#clock();
		try {
			const { runtime } = await this.open(projectId);
			await runtime.schedules.fire(schedule, trigger, due);
		} catch (error) {
			const message = errorMessage(error);
			this.#log(`project ${projectId}: schedule ${scheduleId} could not run: ${message}`);
			const next = nextRunAfter(
				schedule.spec,
				this.#clock(),
				this.#schedules.timezone,
				Date.parse(schedule.createdAt) || this.#clock(),
			);
			await this.#schedules
				.recordRun(
					projectId,
					scheduleId,
					{ at: new Date(due).toISOString(), trigger, outcome: "failed", workerId: null, message },
					{ nextRunAt: next === undefined ? null : new Date(next).toISOString() },
				)
				.catch((error: unknown) => {
					this.#log(`project ${projectId}: could not record the failed run: ${errorMessage(error)}`);
				});
		}
	}

	/**
	 * The poller of event schedules, set by the server once it exists. A run by hand on an event rule goes through it,
	 * since it reads GitHub for every request not handled yet.
	 */
	scheduleEvents: ScheduleEventPoller | undefined;

	/** An event schedule's request is new: open the project and start its run. Throws when the project cannot open. */
	async fireScheduleEvent(
		projectId: string,
		scheduleId: string,
		request: ReviewRequest,
		options: FireEventOptions,
	): Promise<ScheduleRun> {
		const schedule = await this.#schedules.find(projectId, scheduleId);
		if (schedule === undefined) throw new ServerError("unknown_schedule", `No schedule "${scheduleId}" in this project`, { scheduleId });
		const { runtime } = await this.open(projectId);
		return runtime.schedules.fireEvent(schedule, request, options);
	}

	/** The clock the schedules read: the fake one in tests, `Date.now` otherwise. */
	#clock(): number {
		return this.#now === undefined ? Date.now() : this.#now();
	}

	/** The agent directory whose AGENTS.md and skills every conversation reads. */
	get agentDir(): string {
		return this.#agentDir;
	}

	/** The harness's config directory, whose SYSTEM.md and APPEND_SYSTEM.md apply unless the project has its own. */
	get configDir(): string {
		return this.#configDir;
	}

	/** Claude Code's home, whose skills and `.claude/skills` every conversation is also offered. */
	get claudeDir(): string {
		return this.#claudeDir;
	}

	/** The backend's memory scopes, global and per project. */
	get memory(): MemoryStore {
		return this.#memory;
	}

	/** The per-project activity files: what a project was doing, kept across restarts. */
	get activityStore(): ProjectActivityStore {
		return this.#activityStore;
	}

	/** A project's memory topics, most recently updated first. A closed project's memory is read the same way. */
	async listMemory(
		scope: MemoryScope,
		projectId: string | undefined,
		includeArchived: boolean,
	): Promise<MemoryFileSummary[]> {
		const id = scope === "project" ? await this.#memoryProjectId(projectId) : undefined;
		return this.#memory.list(scope, id, { includeArchived });
	}

	async readMemory(scope: MemoryScope, projectId: string | undefined, fileId: string): Promise<MemoryFile> {
		const id = scope === "project" ? await this.#memoryProjectId(projectId) : undefined;
		return this.#memory.read(scope, id, fileId);
	}

	async searchMemory(options: {
		query: string;
		scope: MemoryScope | "both";
		projectId?: string;
		tags?: readonly string[];
		includeArchived?: boolean;
		limit: number;
	}): Promise<MemorySearchHit[]> {
		const projectId =
			options.scope === "global" || options.projectId === undefined
				? options.projectId
				: await this.#memoryProjectId(options.projectId);
		return this.#memory.search({ ...options, projectId });
	}

	async memoryHistory(scope: MemoryScope, projectId: string | undefined, limit: number): Promise<MemoryChange[]> {
		const id = scope === "project" ? await this.#memoryProjectId(projectId) : undefined;
		return this.#memory.history(scope, id, limit);
	}

	/** Revert one extraction or maintenance change; a later change to the same files refuses it with `memory_conflict`. */
	async undoMemory(scope: MemoryScope, projectId: string | undefined, commit: string): Promise<MemoryChange> {
		const id = scope === "project" ? await this.#memoryProjectId(projectId) : undefined;
		return this.#memory.undo(scope, id, commit);
	}

	/** A scope's maintenance state and what this backend's maintenance is set to. */
	async memoryStatus(
		scope: MemoryScope,
		projectId: string | undefined,
	): Promise<{ status: MemoryScopeStatus; maintenance: MemoryMaintenanceSettings; timezone: string }> {
		const maintenance = this.#requireMaintenance();
		const target = await maintenance.target(scope, projectId);
		return {
			status: await maintenance.status(target),
			maintenance: await maintenance.settings(),
			timezone: this.#schedules.timezone,
		};
	}

	/** Run maintenance on one scope now; it answers once the run has started. */
	async maintainMemory(scope: MemoryScope, projectId: string | undefined): Promise<void> {
		const maintenance = this.#requireMaintenance();
		await maintenance.maintain(await maintenance.target(scope, projectId));
	}

	async memorySettings(): Promise<MemoryMaintenanceSettings> {
		return this.#requireMaintenance().settings();
	}

	async setMemorySettings(input: MemoryMaintenanceSettings): Promise<MemoryMaintenanceSettings> {
		return this.#requireMaintenance().setSettings(input);
	}

	#requireMaintenance(): MemoryMaintenanceService {
		if (this.#maintenance === undefined) {
			throw new ServerError("internal", "Memory maintenance is not available in this server");
		}
		return this.#maintenance;
	}

	/** The project a memory request names, so a scope is never created for a project this backend does not have. */
	async #memoryProjectId(projectId: string | undefined): Promise<string> {
		if (projectId === undefined) {
			throw new ServerError("bad_request", "projectId is required for the project memory scope");
		}
		return (await this.store.require(projectId)).id;
	}

	/**
	 * A conversation's context: where its tools run, the system prompt the next request would be sent with, its tools, the
	 * AGENTS.md files in that prompt and the skills it may read. The coordinator's unless `workerId` names a worker.
	 */
	async context(projectId: string, workerId?: string, threadId?: string): Promise<ConversationContext> {
		const { project, runtime, conversation } =
			workerId === undefined
				? await this.conversation(projectId, threadId)
				: await this.workerConversation(projectId, workerId, threadId);
		return this.#readContext(project, runtime, conversation, workerId ?? null, threadId ?? MAIN_THREAD_ID);
	}

	/**
	 * Recompute a conversation's context whenever its transcript or its agent settings change, and call `onChange` only
	 * when the result differs: a skill gets read, a turn re-renders the prompt from edited files, tools change. Resolves
	 * to a stop function.
	 */
	async watchContext(
		projectId: string,
		workerId: string | undefined,
		onChange: (context: ConversationContext) => void,
		threadId?: string,
	): Promise<() => Promise<void>> {
		const { project, runtime, conversation } =
			workerId === undefined
				? await this.conversation(projectId, threadId)
				: await this.workerConversation(projectId, workerId, threadId);
		const thread = threadId ?? MAIN_THREAD_ID;
		const handle = await conversation.watch(BACKGROUND_CONTEXT);
		let published: string | undefined;
		let signal = contextSignal(handle.value);
		let stopped = false;
		let running = false;
		let dirty = false;
		let lastRunAt = 0;
		let timer: ReturnType<typeof setTimeout> | undefined;

		const publish = async (): Promise<void> => {
			if (stopped) return;
			if (running) {
				dirty = true;
				return;
			}
			running = true;
			try {
				do {
					dirty = false;
					lastRunAt = Date.now();
					const context = await this.#readContext(project, runtime, conversation, workerId ?? null, thread);
					const encoded = JSON.stringify(context);
					if (encoded === published) continue;
					published = encoded;
					if (stopped) return;
					onChange(context);
				} while (dirty && !stopped);
			} catch (error) {
				this.#log(`project ${projectId}: context watch failed: ${errorMessage(error)}`);
			} finally {
				running = false;
			}
		};

		/** One recomputation now, or after the throttle if one ran recently; a pending timer already covers new commits. */
		const schedule = (): void => {
			if (stopped || timer !== undefined) return;
			const delay = Math.max(0, lastRunAt + CONTEXT_PUSH_INTERVAL_MS - Date.now());
			timer = setTimeout(() => {
				timer = undefined;
				void publish();
			}, delay);
			timer.unref?.();
		};

		// The caller has just read the context, so the first recomputation only records it: nothing changes yet.
		published = JSON.stringify(await this.#readContext(project, runtime, conversation, workerId ?? null, thread));
		lastRunAt = Date.now();
		const stop = async (): Promise<void> => {
			stopped = true;
			if (timer !== undefined) clearTimeout(timer);
			timer = undefined;
			await handle.stop().catch(() => undefined);
		};
		void handle.closed.then(() => {
			stopped = true;
			if (timer !== undefined) clearTimeout(timer);
			timer = undefined;
		});
		handle.start(async (call) => {
			if (call.kind === "failed") throw call.error;
			const value = call.value;
			// Streamed output commits many times per answer; only a finished entry or an agent-settings change can matter.
			const next = contextSignal(value);
			if (next === signal) return;
			signal = next;
			schedule();
		});
		return stop;
	}

	#readContext(
		project: Project,
		runtime: ProjectRuntime,
		conversation: Conversation,
		workerId: string | null,
		threadId: string,
	): Promise<ConversationContext> {
		return readConversationContext({
			project,
			workerId,
			threadId,
			conversation,
			harness: runtime.harness,
			registry: runtime.registry,
			agentDir: this.#agentDir,
			configDir: this.#configDir,
			claudeDir: this.#claudeDir,
			usage: runtime.usage,
		});
	}

	async closeAll(): Promise<void> {
		this.#closing = true;
		for (const timer of this.#attentionTimers.values()) clearTimeout(timer);
		this.#attentionTimers.clear();
		const entries = [...this.#runtimes.values()];
		this.#runtimes.clear();
		for (const entry of entries) {
			if (entry.opening !== undefined) await entry.opening.catch(() => undefined);
			const runtime = entry.runtime;
			if (runtime === undefined) continue;
			this.#requestLog?.warming.unregister(entry.project.id, true);
			await entry.stopExtraction?.().catch(() => undefined);
			await entry.stopWorkFinished?.().catch(() => undefined);
			await entry.stopWorkersWatch?.().catch(() => undefined);
			await entry.stopBoardWatch?.().catch(() => undefined);
			await entry.stopThreads?.().catch(() => undefined);
			await entry.stopTaskChanges?.().catch(() => undefined);
			await runtime.board.stop().catch(() => undefined);
			await runtime.activity.stop().catch(() => undefined);
			// Nothing runs once this process is done: the next process must not read a stale `working`.
			const closed = idleActivity(this.#activities.get(entry.project.id) ?? DEFAULT_ACTIVITY);
			this.#activities.set(entry.project.id, closed);
			await this.#activityStore.write(entry.project.id, closed).catch((error: unknown) => {
				this.#log(`project ${entry.project.id}: could not save activity: ${errorMessage(error)}`);
			});
			await runtime.harness.close(BACKGROUND_CONTEXT).catch((error: unknown) => {
				this.#log(`project ${entry.project.id}: close failed: ${errorMessage(error)}`);
			});
		}
		await this.#attentionStore.flush();
		// A script in flight resumes with the next process's sandbox (pi-durable's codemode docs), so closing this one is
		// not an outcome for it; this only frees the worker-thread pool.
		await this.#codemodeSandbox.close().catch((error: unknown) => {
			this.#log(`codemode sandbox: close failed: ${errorMessage(error)}`);
		});
	}

	#validateModels(change: ProjectChange): void {
		if (change.coordinatorModel !== undefined && change.coordinatorModel !== null) {
			this.#requireModel(change.coordinatorModel);
		}
		for (const ref of change.workerModels ?? []) this.#requireModel(ref);
		if (change.reportAudit?.mode === "model") {
			if (!change.reportAudit.model) throw new ServerError("bad_request", "Report audit model mode requires a model");
			this.#requireModel(change.reportAudit.model);
		}
	}

	#requireModel(ref: ModelRef): void {
		if (findModel(this.models, ref) === undefined) {
			throw new ServerError("unknown_model", `Unknown model ${ref.provider}/${ref.modelId}`);
		}
	}

	async #openRuntime(entry: RuntimeEntry): Promise<ProjectRuntime> {
		const project = entry.project;
		const images = await this.#resolveImages();
		const registry: Registry = createRegistry();
		registry.install(createCodingTools(images === undefined ? {} : { images }));
		// Caps the coordinator's own bash/powershell calls so a slow or polling command can never keep it unreachable;
		// removed for workers below, who keep the tools' own timeouts.
		const toolCaps = createToolCapExtension({ capMs: this.#toolCallCapMs });
		registry.install(toolCaps);
		// Every conversation of the project reads its own cwd's AGENTS.md and skills through these sections, so a worker
		// created later selects the extension with the rest of the coordinator's and picks up its workspace's files.
		registry.install(
			createAgentContextExtension({
				agentDir: this.#agentDir,
				configDir: this.#configDir,
				claudeDir: this.#claudeDir,
			}),
		);
		// Gives read/edit/write the AGENTS.md of the folders they actually touch — below cwd, or down from a file's own
		// repository root when it sits outside cwd entirely — not only the ones from the root down to cwd the section
		// above carries; kept for workers too, unlike the tool call cap.
		registry.install(
			createFolderContextExtension({
				agentDir: this.#agentDir,
				configDir: this.#configDir,
				claudeDir: this.#claudeDir,
			}),
		);

		const storage = await openNodeSqliteStorage(this.store.sessionPath(project.id));
		let harness: Harness;
		try {
			harness = await HarnessImpl.open(
				storage,
				{
					models: this.models,
					registry,
					settings: () => ({
						// A run that fails with a model error keeps the inputs queued behind it until another input arrives
						// (pi-durable's `keep` default). A message typed while the failing run was still retrying then sits in
						// `pi.inbox`: it is acknowledged, but no entry appears and no run starts, and the user, whose message
						// looked sent, never sends the input that would place it. Start the next run with it at the failure
						// instead, so the model fixed in settings answers it.
						afterFailedRun: "continue",
						// Read at every threshold check, so the coordinator's compaction thresholds follow its current model.
						compaction: coordinatorCompactionSettings(entry.project.coordinator.model, this.models),
					}),
					...(this.#now === undefined ? {} : { now: this.#now }),
					...(this.#setTimer === undefined ? {} : { setTimer: this.#setTimer }),
					env: ({ cwd }) => new AgentExecutionEnv({ cwd: cwd ?? project.path }),
					onReport: (report) => {
						const detail = report.kind === "storage_failed" ? `: ${errorMessage(report.error)}` : "";
						this.#log(`project ${project.id}: ${report.kind}${detail}`);
					},
				},
				BACKGROUND_CONTEXT,
			);
		} catch (error) {
			await storage.close(BACKGROUND_CONTEXT).catch(() => undefined);
			throw error;
		}

		const conversation = await harness.root(BACKGROUND_CONTEXT);
		// Main and, once started, its background threads: every coordinator tool answers any of them.
		const coordinators = new Coordinators({
			harness,
			main: conversation,
			checkout: () => entry.project.path,
			workspacesDir: this.store.workspacesDir(project.id),
		});
		// The coordinator's own tools come from the coding extension; memory and the worker tools add on top, and the
		// worker conversations remove both of those extensions, so a worker has no memory and cannot delegate.
		const memory = new MemoryService({
			store: this.#memory,
			project: () => entry.project,
			conversation,
			coordinators,
			log: (message) => this.#log(`project ${project.id}: ${message}`),
		});
		// The coordinator's compaction summary, thresholds and the `history` tool stay with it: workers remove both
		// extensions, so a worker transcript compacts the way pi-durable does.
		const compaction = new CompactionService({
			conversation,
			coordinators,
			models: this.#requestLog?.observeInternalModels(this.models, project.id, "compaction") ?? this.models,
			now: () => this.#clock(),
			log: (message) => this.#log(`project ${project.id}: ${message}`),
		});
		const history = new HistoryService({ conversation, coordinators });
		const board = new BoardService({
			taskFreshness: this.#taskFreshness,
			auditStatusChanged: async record => { await writeJsonFile(join(this.store.projectDir(project.id), "report-audit-status.json"), record, 0o600); },
			...(this.#reportAudit ? { auditModels: this.#requestLog?.observeInternalModels(this.models, project.id, "report_audit") ?? this.models } : {}),
			threadIsLive: async (id) => {
				if (id === "main") return true;
				const record = await threads.record(id);
				return record !== undefined && !record.archived && (record.status === "running" || record.status === "idle");
			},
			project: () => entry.project,
			harness,
			coordinator: conversation,
			coordinators,
			...(this.#notifications === undefined ? {} : { notifications: this.#notifications }),
			now: () => this.#clock(),
			...(this.#boardEditDebounceMs === undefined ? {} : { editDebounceMs: this.#boardEditDebounceMs }),
			// A board answer or handoff reaching a finished thread brings it back, as a message from the app does.
			wakeThread: (threadId) => threads.revive(threadId),
			log: (message) => this.#log(`project ${project.id}: ${message}`),
		});
		const taskChanges = new TaskChangeObserver({
			projectId: project.id, path: project.path,
			file: join(this.store.projectDir(project.id), TASK_CHANGES_FILE),
			integrationRef: () => entry.project.integrationRef,
			taskIds: async () => (await board.state()).tasks.map(task => task.id),
			onChangesLanded: fact => board.recordChangesLanded(fact),
			log: message => this.#log(`project ${project.id}: ${message}`), now: () => this.#clock(),
		});
		const extraction = new MemoryExtractionService({
			project: () => entry.project,
			conversation,
			memory: this.#memory,
			store: this.#extractions,
			models: this.#requestLog?.observeInternalModels(this.models, project.id, "memory_extraction") ?? this.models,
			log: (message) => this.#log(`project ${project.id}: ${message}`),
		});
		// A background thread's compactions are extracted too, each conversation by its own service.
		const threadExtractions = new Map<number, MemoryExtractionService>();
		let stopFollowingThreads: () => void = () => undefined;
		let extractionStopped = false;
		const startThreadExtraction = (conversationId: number): void => {
			if (threadExtractions.has(conversationId)) return;
			const log = (message: string): void => this.#log(`project ${project.id} thread conversation ${conversationId}: ${message}`);
			void coordinators
				.conversation(conversationId)
				.then(async (threadConversation) => {
					if (threadConversation === undefined || extractionStopped || threadExtractions.has(conversationId)) return;
					const service = new MemoryExtractionService({
						project: () => entry.project,
						conversation: threadConversation,
						background: true,
						memory: this.#memory,
						store: this.#extractions,
						models: this.#requestLog?.observeInternalModels(this.models, project.id, "memory_extraction") ?? this.models,
						log,
					});
					threadExtractions.set(conversationId, service);
					await service.start();
				})
				.catch((error: unknown) => log(`could not start extracting memories: ${errorMessage(error)}`));
		};

		const workers = new WorkerService({
			project: () => entry.project,
			taskChanges,
			harness,
			models: this.models,
			coordinator: conversation,
			coordinators,
			workspacesDir: this.store.workspacesDir(project.id),
			// Workers get none of the coordinator's own tools. The schedule and thread tools are built below, on top of
			// the workers they start, so this list is read at each spawn instead of captured here.
			removedExtensions: () => [
				memory.extension,
				compaction.extension,
				history.extension,
				board.extension,
				schedules.extension,
				threads.startExtension,
				threads.extension,
				threads.finishExtension,
				toolCaps,
			],
			...(this.#notifications === undefined ? {} : { notifications: this.#notifications }),
			log: (message) => this.#log(`project ${project.id}: ${message}`),
		});
		// The clock is the server's, not the project's: a closed project's schedules fire from there and open it. This
		// half only starts the workers and answers the coordinator's `schedule_*` tools.
		// Main's activity, once it exists: main's status in the thread list.
		let mainActivity: ProjectActivityService | undefined;
		let pushThreads: () => void = () => undefined;
		const threadsDir = join(this.store.projectDir(project.id), "threads");
		// Background threads: coordinators of their own. They keep every coordinator extension except the tools that
		// start threads and the schedule tools, which stay main's; main removes `thread_finish`.
		const threads = new ThreadService({
			project: () => entry.project,
			harness,
			models: this.models,
			coordinators,
			workers,
			board,
			threadsDir,
			removedExtensions: () => [schedules.extension, workers.taskExtension],
			mainActivity: () => mainActivity?.current ?? DEFAULT_ACTIVITY,
			...(this.#notifications === undefined ? {} : { notifications: this.#notifications }),
			now: () => this.#clock(),
			onChange: () => pushThreads(),
			log: (message) => this.#log(`project ${project.id}: ${message}`),
		});
		workers.attachThreadCheckIns(threads.checkIns);
		workers.diskWarnings = this.#diskWarnings;
		const projectStorage = new ProjectStorage({
			projectPath: () => entry.project.path,
			workspacesDir: this.store.workspacesDir(project.id),
			threadsDir,
			workers,
			threads,
			now: () => this.#clock(),
			log: (message) => this.#log(`project ${project.id}: ${message}`),
		});
		threads.attachStorage(projectStorage);
		const schedules = new SchedulesService({
			project: () => entry.project,
			store: this.#schedules,
			workers,
			threads,
			board,
			runEventNow: async (projectId, scheduleId) => {
				if (this.scheduleEvents === undefined) throw new ServerError("bad_request", "This backend cannot check GitHub for events.");
				return this.scheduleEvents.runNow(projectId, scheduleId);
			},
			...(this.#notifications === undefined ? {} : { notifications: this.#notifications }),
			now: () => this.#clock(),
			log: (message) => this.#log(`project ${project.id}: ${message}`),
		});
		registry.install(memory.extension);
		registry.install(compaction.extension);
		registry.install(history.extension);
		registry.install(board.extension);
		registry.install(workers.extension);
		registry.install(schedules.extension);
		registry.install(threads.startExtension);
		registry.install(threads.extension);
		registry.install(threads.finishExtension);
		registry.install(workers.taskExtension);
		// The worker a conversation is, and the thread whose worker it is; undefined for a coordinator.
		const workerOf = async (conversationId: number): Promise<{ workerId: string; threadId: string } | undefined> => {
			for (const place of coordinators.places()) {
				const state = await workers.state(BACKGROUND_CONTEXT, place.conversationId);
				const worker = Object.values(state.workers).find((candidate) => candidate.conversationId === conversationId);
				if (worker !== undefined) return { workerId: worker.id, threadId: place.threadId };
			}
			return undefined;
		};
		// Every conversation keeps `artifact_save`: workers do not remove it.
		registry.install(
			createArtifactExtension({
				store: this.artifacts,
				project: () => entry.project,
				workspaceDirs: [this.store.workspacesDir(project.id), threadsDir],
				workerIdOf: async (conversationId) => (await workerOf(conversationId))?.workerId ?? null,
				threadIdOf: async (conversationId) =>
					coordinators.threadIdOf(conversationId) ?? (await workerOf(conversationId))?.threadId ?? MAIN_THREAD_ID,
			}),
		);
		// Code mode: always on, for the coordinator and every worker alike, offered alongside the tools themselves. Its
		// own `codemode` tool call is capped above like `bash`; nested `bash` calls a script makes are capped too, since
		// the cap wraps the tool by name in the registry, which a nested call resolves the same way a model call does.
		// Installed last so its section (the tools a script can call) renders after every other section's, which fixed
		// positions (the SYSTEM.md preamble first of all) depend on first-extension-wins insertion order.
		registry.install(createHarnessCodemodeExtension(this.#codemodeSandbox));
		// Tags each turn's model request with its conversation for the request log. Hooks only, no section or tool, so
		// no prompt changes with it; workers and threads keep it.
		if (this.#requestLog !== undefined) {
            this.#requestLog.warming.register(project.id, {
                settings: () => entry.project,
                prefixRevision: async id => {
                    const threadId = coordinators.threadIdOf(id) ?? MAIN_THREAD_ID;
                    const target = coordinators.isMain(id) ? conversation : await threads.conversation(threadId);
                    const context = await readConversationContext({ project: entry.project, workerId: null, threadId, conversation: target,
                        harness, registry, agentDir: this.#agentDir, configDir: this.#configDir, claudeDir: this.#claudeDir });
                    return createHash("sha256").update(JSON.stringify([context.systemPrompt, context.tools])).digest("hex");
                },
                conversation: async id => {
                    if (coordinators.isMain(id)) return conversation;
                    const threadId = coordinators.threadIdOf(id);
                    if (threadId === undefined || (await threads.record(threadId))?.archived) return undefined;
                    return threads.conversation(threadId);
                },
            });
			registry.install(
				this.#requestLog.extension(project.id, async (conversationId): Promise<ConversationIdentity> => {
					const none = { workerId: null, taskId: null, scheduleId: null };
					if (coordinators.isMain(conversationId)) return { kind: "main", threadId: MAIN_THREAD_ID, ...none };
					const threadId = coordinators.threadIdOf(conversationId);
					if (threadId !== undefined) {
						const record = await threads.record(threadId);
						return {
							kind: "thread",
							threadId,
							workerId: null,
							taskId: record?.taskId ?? null,
							scheduleId: record?.scheduleId ?? null,
						};
					}
					for (const place of coordinators.places()) {
						const state = await workers.state(BACKGROUND_CONTEXT, place.conversationId);
						const worker = Object.values(state.workers).find((candidate) => candidate.conversationId === conversationId);
						if (worker === undefined) continue;
						return {
							kind: "worker",
							threadId: place.threadId,
							workerId: worker.id,
							taskId: worker.taskId ?? null,
							scheduleId: worker.scheduleId ?? null,
						};
					}
					return { kind: "other", threadId: null, ...none };
				}),
			);
		}
		// Asks for the one-hour cache where the project's setting says so (coordinators by default), read at each request
		// so a change applies to the next one. Hooks only, like the request log's.
		if (this.#cacheRetention !== undefined) {
			registry.install(
				this.#cacheRetention.extension((conversationId) =>
					cacheRetentionFor(entry.project.longPromptCache, coordinators.isCoordinator(conversationId)),
				),
			);
		}
		// After everything else, so its wraps see every tool (and count the time of the caps above) and its hook holds only
		// calls no other hook blocked. Neither changes a section, so code mode's section stays last.
		registry.install(this.drain.extension(registry.snapshot().tools().map(({ tool }) => tool.name)));
		try {
			// Applied on every open: project.json is the source of truth, including a cleared model.
			await conversation.configure(
				{
					model: project.coordinator.model,
					thinkingLevel: project.coordinator.thinkingLevel,
					cwd: project.path,
					// Main never finishes: `thread_finish` is for its background threads. `task_progress` is a worker's.
					extensions: { remove: [threads.finishExtension, workers.taskExtension] },
				},
				BACKGROUND_CONTEXT,
			);
			await workers.ensureDocument();
			await board.ensureDocument();
			// Every thread registers as a coordinator before anything resumes, so a resumed turn's tools know it.
			await threads.open();
			// Create this project's memory repository and watch it, so hand edits reach the index and the app.
			await this.#memory.scope({ scope: "project", projectId: project.id }).ensure();
			// Compactions that landed while this process was off are extracted on the way in, main's and every thread's;
			// a thread started later gets its own extraction when it registers.
			void extraction.start();
			for (const place of coordinators.places()) {
				if (!coordinators.isMain(place.conversationId)) startThreadExtraction(place.conversationId);
			}
			stopFollowingThreads = coordinators.onAdded((place) => startThreadExtraction(place.conversationId));
		} catch (error) {
			await harness.close(BACKGROUND_CONTEXT).catch(() => undefined);
			throw error;
		}

		const work = new WorkFinishedWatch({
			projectDir: this.store.projectDir(project.id),
			projectId: project.id,
			projectName: () => entry.project.name,
			minWorkMs: this.#workFinished.minWorkMs,
			quietMs: this.#workFinished.quietMs,
			now: () => this.#clock(),
			notify: (event) => this.#notifications?.notify(event),
			log: (message) => this.#log(`project ${project.id}: ${message}`),
		});
		await work.start();
		entry.stopWorkFinished = () => work.stop();

		await this.#attentionStore.read(project.id);
		const updateAttention = (patch: Parameters<ProjectAttentionStore["update"]>[1]) => {
			if (this.#attentionStore.update(project.id, patch)) void this.#emitProject(project.id);
		};
		updateAttention({
			...boardAttention(await board.state()),
			...workerAttention((await workers.list()).workers),
			...threadAttention(await threads.list(false)),
		});
		const initialActivity = await this.#activityFor(project.id, entry);
		const runningWorkers = (await workers.list(MAIN_THREAD_ID)).workers.filter((worker) => worker.status === "running").length;
		const openQuestions = openQuestionCount(await board.state());
		const backgroundThreads = await threads.backgroundCount();
		const activity = new ProjectActivityService({
			conversation,
			initial: { ...initialActivity, runningWorkers, openQuestions, backgroundThreads },
			...(this.#now === undefined ? {} : { now: this.#now }),
			onChange: (next) => {
				this.#activities.set(project.id, next);
				void this.#activityStore.write(project.id, next).catch((error: unknown) => {
					this.#log(`project ${project.id}: could not save activity: ${errorMessage(error)}`);
				});
				void this.#emitProject(project.id);
				threads.mainChanged();
				if (next.coordinator === "idle") void board.audit?.check("idle").catch(error => this.#log(`report audit failed: ${errorMessage(error)}`));
				work.update({ coordinatorWorking: next.coordinator === "working" });
			},
			// A new final answer and a failed compaction are worth a push; the notifier decides which devices hear it.
			onReply: (reply) => {
				work.reply(reply.text);
				// While workers or threads still run, the answer is not the end of the work: work_finished tells it later.
				if (work.othersRunning) return;
				this.#notifications?.notify(
					replyNotification({
						projectId: project.id,
						projectName: entry.project.name,
						entryId: reply.entryId,
						at: reply.at,
						text: reply.text,
					}),
				);
			},
			onCompactionFailure: (failure) => {
				this.#notifications?.notify(
					compactionFailureNotification({
						projectId: project.id,
						projectName: entry.project.name,
						taskId: failure.taskId,
						reason: failure.reason,
						error: failure.error,
					}),
				);
			},
			log: (message) => this.#log(`project ${project.id}: ${message}`),
		});
		mainActivity = activity;
		await activity.start();

		// The thread list is pushed when it differs from the last one pushed; many changes in a row cost one read.
		let threadsPushed = "";
		let threadsQueued = false;
		pushThreads = () => {
			if (threadsQueued) return;
			threadsQueued = true;
			queueMicrotask(() => {
				threadsQueued = false;
				void (async () => {
					const list = await threads.list(false);
					activity.setBackgroundThreads(await threads.backgroundCount());
					updateAttention(threadAttention(list));
					work.update({ runningThreads: list.filter((thread) => !thread.main && thread.status === "running").length });
					const encoded = JSON.stringify(list);
					if (encoded === threadsPushed) return;
					threadsPushed = encoded;
					this.#emitThreads(project.id, list);
				})().catch((error: unknown) => {
					this.#log(`project ${project.id}: thread push failed: ${errorMessage(error)}`);
				});
			});
		};

		const runtime: ProjectRuntime = {
			project,
			harness,
			conversation,
			registry,
			workers,
			schedules,
			memory,
			board,
			compaction,
			extraction,
			history,
			usage: new ContextUsageReader({
				models: this.models,
				settings: () => coordinatorCompactionSettings(entry.project.coordinator.model, this.models),
			}),
			activity,
			coordinators,
			threads,
			storage: projectStorage,
		};
		entry.stopExtraction = async () => {
			extractionStopped = true;
			stopFollowingThreads();
			await Promise.all([extraction, ...threadExtractions.values()].map((service) => service.stop()));
		};
		entry.stopThreads = () => threads.stop();
		entry.stopWorkersWatch = await workers
			.watch((list, defaults) => {
				this.#emitWorkers(project.id, list, defaults);
				updateAttention(workerAttention(list));
				// The project's activity counts main's running workers; each thread counts its own in the thread list.
				activity.setRunningWorkers(
					list.filter((worker) => worker.status === "running" && (worker.threadId ?? MAIN_THREAD_ID) === MAIN_THREAD_ID).length,
				);
				threads.workersChanged(list);
				work.update({ runningWorkers: list.filter((worker) => worker.status === "running").length });
			})
			.catch((error: unknown) => {
				this.#log(`project ${project.id}: worker watch failed: ${errorMessage(error)}`);
				return async () => undefined;
			});
		entry.stopBoardWatch = await board
			.watch((view, openQuestions) => {
				this.#emitBoard(project.id, view);
				activity.setOpenQuestions(openQuestions);
				updateAttention(boardAttention(view));
				threads.boardChanged(view);
			})
			.catch((error: unknown) => {
				this.#log(`project ${project.id}: board watch failed: ${errorMessage(error)}`);
				return async () => undefined;
			});
		await taskChanges.start();
		entry.stopTaskChanges = () => taskChanges.stop();
		await threads.startWatches();
		// Continue any run the last process left unfinished.
		harness.resume();

		void harness.closed.then((end) => {
			const current = this.#runtimes.get(project.id);
			if (current?.runtime !== runtime) return;
			current.runtime = undefined;
			current.state = end.kind === "failed" ? "failed" : "closed";
			current.failure = end.kind === "failed" ? errorMessage(end.error) : undefined;
			void (async () => {
				await taskChanges.stop().catch(() => undefined);
				await activity.stop().catch(() => undefined);
				const closed = idleActivity(this.#activities.get(project.id) ?? DEFAULT_ACTIVITY);
				this.#activities.set(project.id, closed);
				await this.#activityStore.write(project.id, closed).catch((error: unknown) => {
					this.#log(`project ${project.id}: could not save activity: ${errorMessage(error)}`);
				});
				await this.#notify(current.project, current.failure);
			})();
		});
		return runtime;
	}

	async #resolveImages(): Promise<ImageProcessor | undefined> {
		if (this.#images === null) return undefined;
		if (this.#images !== undefined) return this.#images;
		this.#imagesPromise ??= createNodePhotonImages().catch((error: unknown) => {
			this.#log(`image processor unavailable, read returns images unprepared: ${errorMessage(error)}`);
			return null;
		});
		const images = await this.#imagesPromise;
		return images ?? undefined;
	}

	#notify(project: Project, failure?: string): Promise<void> {
		return this.#summaryOf(project).then((summary) => {
			this.#emit(failure === undefined ? summary : { ...summary, failure });
		});
	}

	/** One project's summary with its activity, read from the cache, the activity file or the defaults. */
	async #summaryOf(project: Project): Promise<ProjectSummary> {
		const entry = this.#runtimes.get(project.id);
		const activity = await this.#activityFor(project.id, entry);
		const attention = await this.#attentionStore.read(project.id);
		this.#armAttentionReturn(project, attention?.nextReturnAt);
		return {
			...projectSummary(project, entry, activity, this.#linkSettings(project)),
			...(this.#reportAudit ? { reportAudit: project.reportAudit ?? DEFAULT_REPORT_AUDIT, reportAuditStatus: await this.#auditStatus(project, entry) } : {}),
			...(attention === undefined ? {} : { attention: entry?.state === "open" || entry?.state === "opening" ? attention : { ...attention, runningWorkers: 0 } }),
		};
	}

	async #auditStatus(project: Project, entry: RuntimeEntry | undefined) {
		const settings = project.reportAudit ?? DEFAULT_REPORT_AUDIT;
		const key = JSON.stringify([settings.mode, settings.model]);
		let cached = this.#auditModelCache.get(key);
		if (!cached || cached.expiresAt <= this.#clock()) {
			const next = { expiresAt: Infinity, model: chooseAuditModel(this.models, settings) };
			this.#auditModelCache.set(key, next);
			void next.model.then(() => { next.expiresAt = this.#clock() + 60_000; }, () => { this.#auditModelCache.delete(key); });
			cached = next;
		}
		const model = await cached.model;
		const stored = entry?.runtime ? (await entry.runtime.board.state()).reportAudit : await readJsonFile(join(this.store.projectDir(project.id), "report-audit-status.json")) as ReportAuditRecord | undefined;
		const status = stored ?? emptyAuditRecord(this.#clock());
		return { effectiveModel: model ? { provider: model.provider, modelId: model.id } : null,
			day: auditDay(this.#clock()), tokensUsed: status.day === auditDay(this.#clock()) ? status.tokensUsed : 0,
			lastRunAt: status.lastRunAt, state: settings.mode === "off" ? "off" : !model ? "unavailable" : status.state === "running" && !entry?.runtime ? "error" : status.state,
			reason: settings.mode === "off" ? "disabled" : !model ? "no signed-in provider offers a small model" : status.reason };
	}

	/** Only a closed project's next deadline needs a clock; open projects already have the board's clock. */
	#armAttentionReturn(project: Project, nextReturnAt: string | null | undefined): void {
		const old = this.#attentionTimers.get(project.id);
		if (old !== undefined) clearTimeout(old);
		this.#attentionTimers.delete(project.id);
		const entry = this.#runtimes.get(project.id);
		if (this.#closing || project.archived || entry?.state === "open" || entry?.state === "opening" || entry?.state === "failed" || !nextReturnAt) return;
		const at = Date.parse(nextReturnAt);
		if (!Number.isFinite(at)) return;
		const timer = setTimeout(() => {
			this.#attentionTimers.delete(project.id);
			void (async () => {
				const latest = await this.store.require(project.id);
				if (latest.archived || this.#closing) return;
				if (at > this.#clock()) { this.#armAttentionReturn(latest, nextReturnAt); return; }
				const { runtime } = await this.open(project.id);
				await runtime.board.checkWaiting();
			})().catch((error) => this.#log(`project ${project.id}: attention return failed: ${errorMessage(error)}`));
		}, Math.max(0, Math.min(60_000, at - this.#clock())));
		timer.unref?.();
		this.#attentionTimers.set(project.id, timer);
	}

	/** The settings the user saved, or what the host told so far (nothing before its first look ends). */
	#linkSettings(project: Project): ProjectLinkSettings {
		if (project.links !== null) return { ...project.links, detected: false };
		return { ...(this.linkDetector.cached(project.path) ?? NO_PROJECT_LINKS), detected: true };
	}

	/** Re-emit the summaries of the projects in a folder whose found links changed. */
	async #emitProjectsAt(path: string): Promise<void> {
		if (this.#onProjectState === undefined) return;
		for (const project of await this.store.list()) {
			if (project.path === path && project.links === null) this.#emit(await this.#summaryOf(project));
		}
	}

	/**
	 * A project's last activity. A project that is not open runs nothing, so a value a crash left at `working` or with
	 * running workers reads as idle with none; `failed` is about the last run and stays.
	 */
	async #activityFor(projectId: string, entry: RuntimeEntry | undefined): Promise<ProjectActivity> {
		const known = this.#activities.get(projectId);
		let activity = known ?? (await this.#activityStore.read(projectId)) ?? DEFAULT_ACTIVITY;
		const open = entry?.state === "open" || entry?.state === "opening";
		if (!open) activity = idleActivity(activity);
		if (known === undefined || !sameActivity(known, activity)) this.#activities.set(projectId, activity);
		return activity;
	}

	/** Re-emit a project's summary after its activity changed; the activity is already in the cache. */
	async #emitProject(projectId: string): Promise<void> {
		if (this.#onProjectState === undefined) return;
		const entry = this.#runtimes.get(projectId);
		const project = entry?.project ?? (await this.store.load(projectId));
		if (project === undefined) return;
		this.#emit(await this.#summaryOf(project));
	}

	#emit(summary: ProjectSummary): void {
		if (this.#onProjectState === undefined) return;
		try {
			this.#onProjectState(summary);
		} catch (error) {
			this.#log(`project ${summary.id}: state listener failed: ${errorMessage(error)}`);
		}
	}

	#emitBoard(projectId: string, board: Board): void {
		if (this.#onBoardState === undefined) return;
		try {
			this.#onBoardState(projectId, board);
		} catch (error) {
			this.#log(`project ${projectId}: board state listener failed: ${errorMessage(error)}`);
		}
	}

	#emitThreads(projectId: string, threads: ThreadSummary[]): void {
		if (this.#onThreadsState === undefined) return;
		try {
			this.#onThreadsState(projectId, threads);
		} catch (error) {
			this.#log(`project ${projectId}: thread state listener failed: ${errorMessage(error)}`);
		}
	}

	#emitWorkers(projectId: string, workers: WorkerSummary[], defaults: WorkerDefaults): void {
		if (this.#onWorkersState === undefined) return;
		try {
			this.#onWorkersState(projectId, workers, defaults);
		} catch (error) {
			this.#log(`project ${projectId}: worker state listener failed: ${errorMessage(error)}`);
		}
	}
}
