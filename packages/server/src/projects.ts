/**
 * Project records on disk: one directory per project under `<data>/projects/<id>/`, holding `project.json` and the
 * project's `session.sqlite` (see `sessionPath`).
 */
import { createHash } from "node:crypto";
import { mkdir, readdir, realpath, stat } from "node:fs/promises";
import { basename, join } from "node:path";
import type { ReportAuditSettings, LongPromptCache, ModelRef, ProjectCheckIns, ProjectLinks, ThinkingLevel, UiProof, WorkerModel } from "@aiki/protocol";
import {
	DEFAULT_CHECK_INS,
	DEFAULT_REPORT_AUDIT,
	DEFAULT_LONG_PROMPT_CACHE,
	DEFAULT_UI_PROOF,
	normalizeGithubRepo,
	normalizeJiraSite,
	THINKING_LEVELS,
} from "@aiki/protocol";
import { ServerError } from "./errors.ts";
import { readJsonFile, writeJsonFile } from "./fs-json.ts";

export const PROJECT_FILE = "project.json";
export const SESSION_FILE = "session.sqlite";
export const WORKSPACES_DIR = "workspaces";

export type Project = {
	version: 1;
	id: string;
	name: string;
	/** Absolute, symlink-free host directory. The coordinator's tools run with this as cwd. */
	path: string;
	createdAt: string;
	coordinator: {
		model: ModelRef | null;
		thinkingLevel: ThinkingLevel | null;
	};
	/** Defaults for workers, in order of preference, when nobody picked a worker model for this project yet. */
	workerModels: WorkerModel[];
	/** The coordinator's periodic check-ins on running workers. */
	checkIns: ProjectCheckIns;
	/** Which conversations ask for the one-hour prompt cache. */
	longPromptCache: LongPromptCache;
	keepPromptCacheWarm: boolean;
	promptCacheWarmHours: 1 | 2 | 4 | 8;
	/** Show UI changes: what agents prove with screenshots or videos; see `uiProofParagraph` in `workers.ts`. */
	uiProof: UiProof;
	reportAudit?: ReportAuditSettings;
	/** Where ticket keys and PR numbers point, as the user set it; null: filled in automatically (`project-links.ts`). */
	links: ProjectLinks | null;
	/** auto (absent): main/master; null: disabled; otherwise a full Git ref. */
	integrationRef?: string | null;
	/** Trusted local JSON file only. No command execution. */
	deployFeed?: string | null;
	/** Archived: hidden from lists, schedules and event triggers paused, no notifications. Written only while true. */
	archived?: true;
};

export type ProjectChange = {
	name?: string;
	coordinatorModel?: ModelRef | null;
	coordinatorThinkingLevel?: ThinkingLevel | null;
	workerModels?: WorkerModel[] | null;
	/** `null` restores `DEFAULT_CHECK_INS`. */
	checkIns?: ProjectCheckIns | null;
	/** `null` restores `DEFAULT_LONG_PROMPT_CACHE`. */
	longPromptCache?: LongPromptCache | null;
	keepPromptCacheWarm?: boolean | null;
	promptCacheWarmHours?: 1 | 2 | 4 | 8 | null;
	/** `null` restores `DEFAULT_UI_PROOF`. */
	uiProof?: UiProof | null;
	reportAudit?: ReportAuditSettings | null;
	/** `null` goes back to filling them in automatically. */
	links?: ProjectLinks | null;
	integrationRef?: string | null;
	deployFeed?: string | null;
	/** `true` archives, `false` unarchives. */
	archived?: boolean;
};

const ID_PATTERN = /^[a-z0-9][a-z0-9._-]*$/;

function slugify(value: string): string {
	const slug = value
		.toLowerCase()
		.replace(/[^a-z0-9._-]+/g, "-")
		.replace(/^[-._]+|[-._]+$/g, "")
		.slice(0, 48);
	return slug.length > 0 ? slug : "project";
}

/** Stable per directory: re-adding the same path after a restart finds the same project. */
function projectIdFor(path: string): string {
	const digest = createHash("sha256").update(path).digest("hex").slice(0, 10);
	return `${slugify(basename(path))}-${digest}`;
}

function defaultProject(id: string, name: string, path: string): Project {
	return {
		version: 1,
		id,
		name,
		path,
		createdAt: new Date().toISOString(),
		coordinator: { model: null, thinkingLevel: null },
		workerModels: [],
		checkIns: { ...DEFAULT_CHECK_INS },
		longPromptCache: DEFAULT_LONG_PROMPT_CACHE,
		keepPromptCacheWarm: true,
		promptCacheWarmHours: 8,
		uiProof: DEFAULT_UI_PROOF,
		reportAudit: { ...DEFAULT_REPORT_AUDIT },
		links: null,
	};
}

function parseProject(value: unknown, id: string): Project | undefined {
	if (typeof value !== "object" || value === null) return undefined;
	const record = value as Partial<Project> & Record<string, unknown>;
	if (record.version !== 1) return undefined;
	if (typeof record.path !== "string" || typeof record.name !== "string") return undefined;
	const coordinator = (record.coordinator ?? {}) as Partial<Project["coordinator"]>;
	const model = coordinator.model;
	const validModel =
		model === null ||
		model === undefined ||
		(typeof model === "object" &&
			typeof (model as ModelRef).provider === "string" &&
			typeof (model as ModelRef).modelId === "string");
	const thinkingLevel =
		typeof coordinator.thinkingLevel === "string" || coordinator.thinkingLevel === null || coordinator.thinkingLevel === undefined
			? (coordinator.thinkingLevel ?? null)
			: null;
	return {
		version: 1,
		id,
		name: record.name,
		path: record.path,
		createdAt: typeof record.createdAt === "string" ? record.createdAt : new Date(0).toISOString(),
		coordinator: {
			model: validModel ? ((model ?? null) as ModelRef | null) : null,
			thinkingLevel: thinkingLevel as ThinkingLevel | null,
		},
		workerModels: parseWorkerModels(record.workerModels),
		checkIns: parseCheckIns(record.checkIns),
		longPromptCache: parseLongPromptCache(record.longPromptCache),
		keepPromptCacheWarm: typeof record.keepPromptCacheWarm === "boolean" ? record.keepPromptCacheWarm : true,
		promptCacheWarmHours: [1, 2, 4, 8].includes(record.promptCacheWarmHours as number) ? record.promptCacheWarmHours as 1 | 2 | 4 | 8 : 8,
		uiProof: parseUiProof(record.uiProof),
		reportAudit: parseReportAudit(record.reportAudit),
		links: cleanLinks(record.links),
		deployFeed: typeof record.deployFeed === "string" ? record.deployFeed : null,
		integrationRef: typeof record.integrationRef === "string" || record.integrationRef === null ? record.integrationRef : "auto",
		...(record.archived === true ? { archived: true as const } : {}),
	};
}

/**
 * The stored default worker models. A file from before thinking levels (or one an older client wrote) has no
 * `thinkingLevel`, which reads as the model's default. An entry that is not a usable model is dropped, and a level this
 * server does not know is dropped while its model stays, so a corrupt file cannot make the project unusable.
 */
function parseWorkerModels(value: unknown): WorkerModel[] {
	if (!Array.isArray(value)) return [];
	const models: WorkerModel[] = [];
	for (const entry of value) {
		if (typeof entry !== "object" || entry === null) continue;
		const record = entry as Partial<WorkerModel> & Record<string, unknown>;
		if (typeof record.provider !== "string" || record.provider.length === 0) continue;
		if (typeof record.modelId !== "string" || record.modelId.length === 0) continue;
		const level = record.thinkingLevel;
		const valid =
			level === undefined ||
			level === null ||
			(typeof level === "string" && (THINKING_LEVELS as readonly string[]).includes(level));
		models.push({
			provider: record.provider,
			modelId: record.modelId,
			...(valid && level !== undefined ? { thinkingLevel: level as ThinkingLevel | null } : {}),
		});
	}
	return models;
}

/** Invalid or legacy stored settings get the on-by-default bounded audit. */
export function parseReportAudit(value: unknown): ReportAuditSettings {
	const record = value as Partial<ReportAuditSettings> | null;
	if (!record || !["auto", "off", "model"].includes(record.mode ?? "")) return { ...DEFAULT_REPORT_AUDIT };
	const model = record.model;
	if (record.mode === "model" && (!model || typeof model.provider !== "string" || typeof model.modelId !== "string")) return { ...DEFAULT_REPORT_AUDIT };
	return { mode: record.mode!, ...(record.mode === "model" ? { model: model! } : {}), dailyTokens: Number.isInteger(record.dailyTokens) && record.dailyTokens! >= 0 && record.dailyTokens! <= 10_000_000 ? record.dailyTokens! : DEFAULT_REPORT_AUDIT.dailyTokens };
}

const UI_PROOFS: readonly UiProof[] = ["off", "screenshots", "screenshots-and-videos"];

/** A `project.json` from before this setting, or with a value this server does not know, gets the default. */
function parseUiProof(value: unknown): UiProof {
	return (UI_PROOFS as readonly unknown[]).includes(value) ? (value as UiProof) : DEFAULT_UI_PROOF;
}

const LONG_PROMPT_CACHES: readonly LongPromptCache[] = ["off", "coordinators", "all"];

/** A `project.json` from before this setting, or with a value this server does not know, gets the default. */
function parseLongPromptCache(value: unknown): LongPromptCache {
	return (LONG_PROMPT_CACHES as readonly unknown[]).includes(value) ? (value as LongPromptCache) : DEFAULT_LONG_PROMPT_CACHE;
}

/**
 * Link settings as the user saved them, cleaned: a site as an address, repositories as "owner/name", prefixes in capitals,
 * each once. Anything else (a file from before the setting included) reads as not set, so they are filled in again.
 */
export function cleanLinks(value: unknown): ProjectLinks | null {
	if (typeof value !== "object" || value === null) return null;
	const record = value as Partial<Record<keyof ProjectLinks, unknown>>;
	const strings = (list: unknown): string[] => (Array.isArray(list) ? list.filter((entry): entry is string => typeof entry === "string") : []);
	const site = typeof record.jiraSite === "string" ? normalizeJiraSite(record.jiraSite) : undefined;
	const prefixes = strings(record.jiraProjects)
		.map((prefix) => prefix.trim().toUpperCase())
		.filter((prefix) => /^[A-Z][A-Z0-9_]+$/.test(prefix));
	const repos = strings(record.githubRepos)
		.map((repo) => normalizeGithubRepo(repo))
		.filter((repo): repo is string => repo !== undefined);
	return { jiraSite: site ?? null, jiraProjects: [...new Set(prefixes)], githubRepos: [...new Set(repos)] };
}

/** A stored setting wins when the server can still use it; anything else falls back to the defaults. */
function parseCheckIns(value: unknown): ProjectCheckIns {
	if (typeof value !== "object" || value === null) return { ...DEFAULT_CHECK_INS };
	const record = value as Partial<ProjectCheckIns>;
	const interval = record.intervalMinutes;
	return {
		enabled: typeof record.enabled === "boolean" ? record.enabled : DEFAULT_CHECK_INS.enabled,
		intervalMinutes:
			typeof interval === "number" && Number.isInteger(interval) && interval >= 1 && interval <= 1440
				? interval
				: DEFAULT_CHECK_INS.intervalMinutes,
	};
}

export class ProjectStore {
	readonly dataDir: string;

	/** Serializes writes, so two concurrent `projects.*` requests cannot lose each other's change. */
	#writes: Promise<unknown> = Promise.resolve();

	constructor(dataDir: string) {
		this.dataDir = dataDir;
	}

	get projectsDir(): string {
		return join(this.dataDir, "projects");
	}

	projectDir(id: string): string {
		if (!ID_PATTERN.test(id)) throw new ServerError("unknown_project", `No project with ID "${id}"`);
		return join(this.projectsDir, id);
	}

	projectFile(id: string): string {
		return join(this.projectDir(id), PROJECT_FILE);
	}

	/** The one storage file a project's Harness owns. */
	sessionPath(id: string): string {
		return join(this.projectDir(id), SESSION_FILE);
	}

	/** Worker workspaces: inside the data directory, never inside the repository. */
	workspacesDir(id: string): string {
		return join(this.projectDir(id), WORKSPACES_DIR);
	}

	async list(): Promise<Project[]> {
		let entries: { name: string; isDirectory(): boolean }[];
		try {
			entries = await readdir(this.projectsDir, { withFileTypes: true });
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
			throw error;
		}
		const projects: Project[] = [];
		for (const entry of entries) {
			if (!entry.isDirectory() || !ID_PATTERN.test(entry.name)) continue;
			const project = await this.load(entry.name);
			if (project !== undefined) projects.push(project);
		}
		projects.sort((left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id));
		return projects;
	}

	async load(id: string): Promise<Project | undefined> {
		const file = this.projectFile(id);
		const value = await readJsonFile(file);
		return value === undefined ? undefined : parseProject(value, id);
	}

	async require(id: string): Promise<Project> {
		const project = await this.load(id);
		if (project === undefined) throw new ServerError("unknown_project", `No project with ID "${id}"`);
		return project;
	}

	/** Add an existing host directory. Adding the same directory twice returns the project already stored. */
	async add(path: string): Promise<Project> {
		return this.#write(async () => {
			const absolute = await realpath(path).catch(() => {
				throw new ServerError("invalid_path", `No such directory: ${path}`);
			});
			const info = await stat(absolute).catch(() => undefined);
			if (info === undefined || !info.isDirectory()) {
				throw new ServerError("invalid_path", `Not a directory: ${path}`);
			}
			const existing = (await this.list()).find((project) => project.path === absolute);
			if (existing !== undefined) return existing;

			const id = projectIdFor(absolute);
			const project = defaultProject(id, basename(absolute), absolute);
			await mkdir(this.projectDir(id), { recursive: true, mode: 0o700 });
			await writeJsonFile(this.projectFile(id), project, 0o600);
			return project;
		});
	}

	async update(id: string, change: ProjectChange): Promise<Project> {
		return this.#write(async () => {
			const project = await this.require(id);
			if (typeof change.integrationRef === "string" && change.integrationRef !== "auto" && (!/^refs\/[A-Za-z0-9_./-]+$/.test(change.integrationRef) || change.integrationRef.includes(".."))) {
				throw new ServerError("bad_request", "Integration ref must be auto, null, or a full Git ref");
			}
			if (typeof change.deployFeed === "string" && (!change.deployFeed.startsWith("/") || change.deployFeed.length > 4096 || change.deployFeed.includes("\0"))) throw new ServerError("bad_request", "Deploy feed must be an absolute local file path or null");
			const next: Project = {
				...project,
				name: change.name ?? project.name,
				coordinator: {
					model:
						change.coordinatorModel === undefined ? project.coordinator.model : change.coordinatorModel,
					thinkingLevel:
						change.coordinatorThinkingLevel === undefined
							? project.coordinator.thinkingLevel
							: change.coordinatorThinkingLevel,
				},
				workerModels: change.workerModels === undefined ? project.workerModels : (change.workerModels ?? []),
				checkIns:
					change.checkIns === undefined
						? project.checkIns
						: change.checkIns === null
							? { ...DEFAULT_CHECK_INS }
							: { ...change.checkIns },
				keepPromptCacheWarm: change.keepPromptCacheWarm === undefined ? project.keepPromptCacheWarm : (change.keepPromptCacheWarm ?? true),
				promptCacheWarmHours: change.promptCacheWarmHours === undefined ? project.promptCacheWarmHours : (change.promptCacheWarmHours ?? 8),
				longPromptCache:
					change.longPromptCache === undefined
						? project.longPromptCache
						: (change.longPromptCache ?? DEFAULT_LONG_PROMPT_CACHE),
				reportAudit: change.reportAudit === undefined ? parseReportAudit(project.reportAudit) : parseReportAudit(change.reportAudit),
				uiProof: change.uiProof === undefined ? project.uiProof : (change.uiProof ?? DEFAULT_UI_PROOF),
				links: change.links === undefined ? project.links : cleanLinks(change.links),
				integrationRef: change.integrationRef === undefined ? project.integrationRef : change.integrationRef,
				deployFeed: change.deployFeed === undefined ? project.deployFeed : change.deployFeed,
			};
			if (change.archived !== undefined) {
				if (change.archived) next.archived = true;
				else delete next.archived;
			}
			await writeJsonFile(this.projectFile(id), next, 0o600);
			return next;
		});
	}

	#write<T>(work: () => Promise<T>): Promise<T> {
		const run = this.#writes.then(work);
		this.#writes = run.catch(() => undefined);
		return run;
	}
}
