import { DeviceAuthStateSchema } from "./device-auth.ts";
/** Projects, the model catalog and credentials. */
import { type Static, Type } from "typebox";
import { ModelRefSchema, ProjectIdSchema, RequestIdSchema, ThinkingLevelSchema } from "./common.ts";
import { ProjectLinkSettingsSchema, ProjectLinksSchema } from "./refs.ts";

/**
 * The coordinator's agent choices. `model` is required to run the project: the server has no model defaults, and a
 * project whose `model` is null answers `conversation.submit` with `no_coordinator_model`.
 */
export const CoordinatorConfigSchema = Type.Object({
	model: Type.Union([ModelRefSchema, Type.Null()]),
	thinkingLevel: Type.Union([ThinkingLevelSchema, Type.Null()], {
		description: "Null follows whatever the model resolves to (pi-durable's default).",
	}),
});
export type CoordinatorConfig = Static<typeof CoordinatorConfigSchema>;

/**
 * One of a project's default worker models: a model plus the thinking level the user picked for it in settings.
 * `thinkingLevel` is optional and `null` means the model's own default, so a `project.json` written before this field
 * existed (or one written by an older client) reads as the same list, and an older server simply ignores the field.
 */
export const WorkerModelSchema = Type.Object(
	{
		...ModelRefSchema.properties,
		thinkingLevel: Type.Optional(
			Type.Union([ThinkingLevelSchema, Type.Null()], {
				description: "The thinking level new workers get with this model; null or absent means the model's default.",
			}),
		),
	},
	{ description: "A default worker model and the thinking level that goes with it." },
);
export type WorkerModel = Static<typeof WorkerModelSchema>;

/** The only server-chosen model default: a bounded, no-tools report audit (D60/D61). */
export const ReportAuditSettingsSchema = Type.Object({
	mode: Type.Union([Type.Literal("auto"), Type.Literal("off"), Type.Literal("model")]),
	model: Type.Optional(ModelRefSchema),
	dailyTokens: Type.Integer({ minimum: 0, maximum: 10_000_000 }),
});
export type ReportAuditSettings = Static<typeof ReportAuditSettingsSchema>;
export const DEFAULT_REPORT_AUDIT: ReportAuditSettings = { mode: "auto", dailyTokens: 65_000 };
export const ReportAuditStatusSchema = Type.Object({
	effectiveModel: Type.Union([ModelRefSchema, Type.Null()]),
	day: Type.String({ description: "UTC budget day." }),
	tokensUsed: Type.Integer({ minimum: 0 }),
	lastRunAt: Type.Union([Type.String(), Type.Null()]),
	state: Type.String({ description: "idle, running, checked, error, budget, off, or unavailable." }),
	reason: Type.Union([Type.String(), Type.Null()]),
});
export type ReportAuditStatus = Static<typeof ReportAuditStatusSchema>;

/** Whether a project's Harness is currently open in the server process. */
export const ProjectStateSchema = Type.Union([Type.Literal("closed"), Type.Literal("open"), Type.Literal("failed")]);
export type ProjectState = Static<typeof ProjectStateSchema>;

/**
 * The coordinator's periodic check-ins on running workers: while at least one worker runs, the harness wakes it every
 * `intervalMinutes` with a peek-style digest of those workers, so it can judge whether one is stuck or on a wrong path.
 * Enabled by default; a project without running workers never gets one.
 */
export const ProjectCheckInsSchema = Type.Object({
	enabled: Type.Boolean({ description: "Default true." }),
	intervalMinutes: Type.Integer({
		minimum: 1,
		maximum: 1440,
		description: "How often the coordinator is woken while a worker runs. Default 10.",
	}),
});
export type ProjectCheckIns = Static<typeof ProjectCheckInsSchema>;

/** The check-in settings a project starts with. */
export const DEFAULT_CHECK_INS: ProjectCheckIns = { enabled: true, intervalMinutes: 10 };

/**
 * Which of a project's conversations ask the provider to keep their prompt cached for an hour instead of five minutes
 * (pi-ai's "long" cache retention): `coordinators` (main and its background threads), `all` (workers too) or `off`.
 * On Claude a cache write then costs twice the input price instead of 1.25 times, and a conversation that waits
 * between 5 and 60 minutes (a coordinator between check-ins) reads its prompt from the cache instead of paying for it
 * again. Codex ignores it; OpenAI's own API keeps the prompt for up to 24 hours at no extra cost.
 */
export const LongPromptCacheSchema = Type.Union([
	Type.Literal("off"),
	Type.Literal("coordinators"),
	Type.Literal("all"),
]);
export type LongPromptCache = Static<typeof LongPromptCacheSchema>;

/** Coordinators often wait between turns; workers default to short retention to limit write premiums. */
export const DEFAULT_LONG_PROMPT_CACHE: LongPromptCache = "coordinators";

/**
 * "Show UI changes" (feature `ui-proof`): whether agents prove a change a user can see in a UI (a web page, an app
 * screen) with screenshots, or screenshots and a short screen recording, before it goes to review. `off` adds nothing to
 * the prompts. It is only about user interfaces: no backend or terminal recordings.
 */
export const UiProofSchema = Type.Union([
	Type.Literal("off"),
	Type.Literal("screenshots"),
	Type.Literal("screenshots-and-videos"),
]);
export type UiProof = Static<typeof UiProofSchema>;

/** What every project starts with, and what a project saved before the setting reads as. */
export const DEFAULT_UI_PROOF: UiProof = "screenshots-and-videos";

/**
 * The coordinator's current tool call, for `ProjectActivity.runningTool`: its name and when it started, so a client can
 * show "Running bash · 3m" with a ticking relative time. `null` while no tool call is running (including while the
 * coordinator is only generating text). Absent on servers older than this field.
 */
export const ProjectRunningToolSchema = Type.Object({
	name: Type.String({ description: 'The tool\'s name, e.g. "bash".' }),
	startedAt: Type.String({ description: "ISO 8601, when this call started." }),
});
export type ProjectRunningTool = Static<typeof ProjectRunningToolSchema>;

/**
 * What a project is doing, for project lists: kept current through `project.state`, which is sent whenever any of these
 * fields changes. Known for closed projects too (the server remembers the last values), so a list after a restart is
 * still right. Absent on servers older than this field.
 */
export const ProjectActivitySchema = Type.Object({
	coordinator: Type.Union([Type.Literal("idle"), Type.Literal("working"), Type.Literal("failed")], {
		description: '"working": a run is in progress; "failed": the last run failed and nothing runs since.',
	}),
	runningWorkers: Type.Integer({ minimum: 0 }),
	lastReplyAt: Type.Union([Type.String(), Type.Null()], {
		description:
			"ISO 8601, when the coordinator last finished an answer; clients compare it with when the user last looked.",
	}),
	lastReplyEntryId: Type.Union([Type.Integer({ minimum: 1 }), Type.Null()]),
	backgroundThreads: Type.Optional(
		Type.Integer({
			minimum: 0,
			description: "Background threads running or idle (not done). Absent on an older server.",
		}),
	),
	openQuestions: Type.Optional(
		Type.Integer({ minimum: 0, description: "Board questions waiting on the user. Absent on an older server." }),
	),
	runningTool: Type.Optional(
		Type.Union([ProjectRunningToolSchema, Type.Null()], {
			description:
				"The coordinator's current tool call, or null while idle or only generating text. Absent on an older server.",
		}),
	),
});
export type ProjectActivity = Static<typeof ProjectActivitySchema>;

/** Cheap cross-project triage, updated by existing server watches. Absent on older servers. */
export const ProjectAttentionSchema = Type.Object({
	questions: Type.Integer({ minimum: 0 }),
	warnings: Type.Integer({ minimum: 0 }),
	reviewTasks: Type.Integer({ minimum: 0 }),
	waitingTasks: Type.Integer({ minimum: 0 }),
	nextReturnAt: Type.Union([Type.String(), Type.Null()]),
	failedWorkers: Type.Integer({ minimum: 0 }),
	failedThreads: Type.Integer({ minimum: 0 }),
	runningWorkers: Type.Integer({ minimum: 0, description: "Across main and background threads." }),
	questionTaskId: Type.Union([Type.String(), Type.Null()]),
	warningTaskId: Type.Union([Type.String(), Type.Null()]),
	reviewTaskId: Type.Union([Type.String(), Type.Null()]),
	failedWorkerTaskId: Type.Union([Type.String(), Type.Null()]),
	failedThreadId: Type.Union([Type.String(), Type.Null()]),
});
export type ProjectAttention = Static<typeof ProjectAttentionSchema>;

export const ProjectSummarySchema = Type.Object({
	id: ProjectIdSchema,
	name: Type.String(),
	path: Type.String({ description: "Absolute host directory the coordinator's tools run in." }),
	coordinator: CoordinatorConfigSchema,
	workerModels: Type.Array(WorkerModelSchema, {
		description:
			"Default models for new workers, in order of preference, each with an optional thinking level. A worker model the user picked with a message, or one the coordinator names when delegating, wins over these.",
	}),
	checkIns: ProjectCheckInsSchema,
	/** Absent on servers older than this field. */
	longPromptCache: Type.Optional(LongPromptCacheSchema),
	keepPromptCacheWarm: Type.Optional(Type.Boolean()),
	promptCacheWarmHours: Type.Optional(Type.Union([Type.Literal(1), Type.Literal(2), Type.Literal(4), Type.Literal(8)])),
	/** Show UI changes (feature `ui-proof`). Absent on servers older than this field. */
	uiProof: Type.Optional(UiProofSchema),
	/** Feature task-changes: auto selects main/master; null disables observation. */
	integrationRef: Type.Optional(Type.Union([Type.String(), Type.Null()])),
	reportAudit: Type.Optional(ReportAuditSettingsSchema),
	reportAuditStatus: Type.Optional(ReportAuditStatusSchema),
	/** Where bare ticket keys and PR numbers point. Absent on servers older than this field. */
	links: Type.Optional(ProjectLinkSettingsSchema),
	/**
	 * The project is archived: hidden from project lists, its schedules and event triggers paused, no notifications.
	 * Absent means not archived (and on servers older than the `project-archive` feature, always).
	 */
	archived: Type.Optional(Type.Boolean()),
	state: ProjectStateSchema,
	failure: Type.Optional(
		Type.String({ description: "Why the Harness failed, when state is failed. Never contains credentials." }),
	),
	activity: Type.Optional(ProjectActivitySchema),
	attention: Type.Optional(ProjectAttentionSchema),
});
export type ProjectSummary = Static<typeof ProjectSummarySchema>;

// --- requests ----------------------------------------------------------------------------------------------------

export const HelloRequestSchema = Type.Object({
	type: Type.Literal("hello"),
	id: RequestIdSchema,
	protocolVersion: Type.Integer(),
	auth: Type.Optional(Type.Object({ accessToken: Type.String() })),
	client: Type.Optional(Type.Object({ name: Type.String(), version: Type.Optional(Type.String()) })),
});
export type HelloRequest = Static<typeof HelloRequestSchema>;

export const ProjectsListRequestSchema = Type.Object({ type: Type.Literal("projects.list"), id: RequestIdSchema });
export type ProjectsListRequest = Static<typeof ProjectsListRequestSchema>;

export const ProjectsAddRequestSchema = Type.Object({
	type: Type.Literal("projects.add"),
	id: RequestIdSchema,
	path: Type.String({ minLength: 1, description: "Existing directory on the host. Symlinks are resolved." }),
});
export type ProjectsAddRequest = Static<typeof ProjectsAddRequestSchema>;

/**
 * Changes one field, or clears it with null. Omitted fields are left as they are. A project that is open in this
 * process applies the change at once; one that is closed picks it up when it opens.
 */
export const ProjectsConfigureRequestSchema = Type.Object({
	type: Type.Literal("projects.configure"),
	id: RequestIdSchema,
	projectId: ProjectIdSchema,
	name: Type.Optional(Type.String({ minLength: 1 })),
	coordinatorModel: Type.Optional(
		Type.Union([ModelRefSchema, Type.Null()], {
			description: "Set or replace the coordinator model; null clears it (the project then cannot run).",
		}),
	),
	coordinatorThinkingLevel: Type.Optional(Type.Union([ThinkingLevelSchema, Type.Null()])),
	workerModels: Type.Optional(
		Type.Union([Type.Array(WorkerModelSchema), Type.Null()], {
			description:
				"Replaces the default worker models. An entry's thinkingLevel is optional; without it the model's default applies.",
		}),
	),
	checkIns: Type.Optional(
		Type.Union([ProjectCheckInsSchema, Type.Null()], {
			description: "Replaces the check-in settings; null restores the defaults (enabled, every 10 minutes).",
		}),
	),
	longPromptCache: Type.Optional(
		Type.Union([LongPromptCacheSchema, Type.Null()], {
			description:
				'Which conversations keep their prompt cached for an hour; null restores the default ("coordinators").',
		}),
	),
	keepPromptCacheWarm: Type.Optional(Type.Union([Type.Boolean(), Type.Null()])),
	promptCacheWarmHours: Type.Optional(
		Type.Union([Type.Literal(1), Type.Literal(2), Type.Literal(4), Type.Literal(8), Type.Null()]),
	),
	reportAudit: Type.Optional(Type.Union([ReportAuditSettingsSchema, Type.Null()], { description: "Feature report-audit; null restores auto and 65000 daily tokens." })),
	uiProof: Type.Optional(
		Type.Union([UiProofSchema, Type.Null()], {
			description:
				'Show UI changes (feature ui-proof): whether agents prove visible UI work with screenshots or screenshots and videos; null restores the default ("screenshots-and-videos").',
		}),
	),
	integrationRef: Type.Optional(Type.Union([Type.String({ pattern: "^(auto|refs/[A-Za-z0-9_./-]+)$" }), Type.Null()], {
		description: 'Feature task-changes: "auto" selects main then master; full Git ref selects another; null turns observation off.',
	})),
	links: Type.Optional(
		Type.Union([ProjectLinksSchema, Type.Null()], {
			description: "Replaces where ticket keys and PR numbers point; null goes back to filling them in automatically.",
		}),
	),
	archived: Type.Optional(
		Type.Boolean({
			description:
				"true archives the project, false unarchives it (feature project-archive). Refused with project_busy while a worker or background thread runs.",
		}),
	),
});
export type ProjectsConfigureRequest = Static<typeof ProjectsConfigureRequestSchema>;

export const ModelsListRequestSchema = Type.Object({ type: Type.Literal("models.list"), id: RequestIdSchema });
export type ModelsListRequest = Static<typeof ModelsListRequestSchema>;

export const CredentialsListRequestSchema = Type.Object({
	type: Type.Literal("credentials.list"),
	id: RequestIdSchema,
});
export type CredentialsListRequest = Static<typeof CredentialsListRequestSchema>;

export const CredentialsSetRequestSchema = Type.Object({
	type: Type.Literal("credentials.set"),
	id: RequestIdSchema,
	providerId: Type.String({ minLength: 1 }),
	apiKey: Type.String({ minLength: 1, description: "Never echoed back, never logged." }),
});
export type CredentialsSetRequest = Static<typeof CredentialsSetRequestSchema>;

export const CredentialsDeleteRequestSchema = Type.Object({
	type: Type.Literal("credentials.delete"),
	id: RequestIdSchema,
	providerId: Type.String({ minLength: 1 }),
});
export type CredentialsDeleteRequest = Static<typeof CredentialsDeleteRequestSchema>;

// --- responses ---------------------------------------------------------------------------------------------------

/**
 * The features this protocol version knows. A server lists the ones it actually implements in its `hello`, and a client
 * hides the UI for the rest. New features are appended, so an older server's shorter list still means what it says.
 */
export const HARNESS_FEATURES = [
	"projects",
	"filesystem",
	"models",
	"credentials",
	"logins",
	"conversation",
	"workers",
	"context",
	"server-status",
	"memory",
	"schedules",
	"memory-maintenance",
	"notifications",
	"board",
	"subscription-usage",
	"threads",
	"artifacts",
	"storage",
	"drain",
	"task-reports",
	"cache-stats",
	"usage-breakdown",
	"subscription-resets",
	"ref-status",
	"board-moves",
	"ref-details",
	"fcm-push",
	"fcm-relay-v1",
	"schedule-events",
	"project-archive",
	"filesystem-complete",
	"filesystem-edit",
	"artifact-tags",
	"terminal",
	"queued-inputs",
	"chat-drafts",
	"notification-hold",
	"ui-proof",
	"task-links",
	"task-waiting",
	"task-freshness",
 "task-activity",
	"report-audit",
	"sidebar-attention",
	"cache-keep-warm",
	"device-auth-v1",
	"device-pairing-v1",
	"device-management-v1",
	"task-changes",
] as const;
export type HarnessFeature = (typeof HARNESS_FEATURES)[number];

/** Missing hello.features is never evidence of device-auth support. */
export const LEGACY_HARNESS_FEATURES = HARNESS_FEATURES.filter(
	(feature) => feature !== "task-activity" && feature !== "report-audit" && feature !== "task-freshness" && feature !== "task-changes" && feature !== "fcm-relay-v1" && feature !== "device-auth-v1" && feature !== "device-pairing-v1" && feature !== "device-management-v1",
);

export const HarnessFeatureSchema = Type.Union([
	Type.Literal("projects"),
	Type.Literal("filesystem"),
	Type.Literal("models"),
	Type.Literal("credentials"),
	Type.Literal("logins"),
	Type.Literal("conversation"),
	Type.Literal("workers"),
	Type.Literal("context"),
	Type.Literal("server-status"),
	Type.Literal("memory"),
	Type.Literal("schedules"),
	Type.Literal("memory-maintenance"),
	Type.Literal("notifications"),
	Type.Literal("board"),
	Type.Literal("subscription-usage"),
	Type.Literal("threads"),
	Type.Literal("artifacts"),
	Type.Literal("storage"),
	Type.Literal("drain"),
	Type.Literal("task-reports"),
	Type.Literal("cache-stats"),
	Type.Literal("usage-breakdown"),
	Type.Literal("subscription-resets"),
	Type.Literal("ref-status"),
	Type.Literal("board-moves"),
	Type.Literal("ref-details"),
	Type.Literal("fcm-push"),
	Type.Literal("fcm-relay-v1"),
	Type.Literal("schedule-events"),
	Type.Literal("project-archive"),
	Type.Literal("filesystem-complete"),
	Type.Literal("filesystem-edit"),
	Type.Literal("artifact-tags"),
	Type.Literal("terminal"),
	Type.Literal("queued-inputs"),
	Type.Literal("chat-drafts"),
	Type.Literal("notification-hold"),
	Type.Literal("ui-proof"),
	Type.Literal("task-links"),
	Type.Literal("task-waiting"),
	Type.Literal("task-freshness"),
 Type.Literal("task-activity"),
	Type.Literal("report-audit"),
	Type.Literal("sidebar-attention"),
	Type.Literal("cache-keep-warm"),
	Type.Literal("device-auth-v1"),
	Type.Literal("device-pairing-v1"),
	Type.Literal("device-management-v1"),
	Type.Literal("task-changes"),
]);
export type HarnessFeatureValue = Static<typeof HarnessFeatureSchema>;

export const HelloResponseSchema = Type.Object({
	type: Type.Literal("hello"),
	id: RequestIdSchema,
	protocolVersion: Type.Literal(1),
	backendId: Type.Optional(Type.String()),
	auth: Type.Optional(DeviceAuthStateSchema),
	server: Type.Object({ name: Type.String(), version: Type.String() }),
	features: Type.Optional(
		Type.Array(Type.String(), {
			description:
				"Feature names this server implements. Absent on servers older than this field; clients then assume the original set.",
		}),
	),
});
export type HelloResponse = Static<typeof HelloResponseSchema>;

export const ProjectsListResponseSchema = Type.Object({
	type: Type.Literal("projects.list"),
	id: RequestIdSchema,
	projects: Type.Array(ProjectSummarySchema),
});
export type ProjectsListResponse = Static<typeof ProjectsListResponseSchema>;

export const ProjectsAddResponseSchema = Type.Object({
	type: Type.Literal("projects.add"),
	id: RequestIdSchema,
	project: ProjectSummarySchema,
});
export type ProjectsAddResponse = Static<typeof ProjectsAddResponseSchema>;

export const ProjectsConfigureResponseSchema = Type.Object({
	type: Type.Literal("projects.configure"),
	id: RequestIdSchema,
	project: ProjectSummarySchema,
});
export type ProjectsConfigureResponse = Static<typeof ProjectsConfigureResponseSchema>;

/** A provider's OAuth (subscription) login, when it has one. */
export const ProviderOAuthInfoSchema = Type.Object({
	name: Type.String({ description: 'For example "Anthropic (Claude Pro/Max)".' }),
	loginLabel: Type.String({ description: 'For example "Sign in with ChatGPT".' }),
	isSubscription: Type.Boolean({ description: "Whether access is backed by a subscription rather than API billing." }),
});
export type ProviderOAuthInfo = Static<typeof ProviderOAuthInfoSchema>;

export const ProviderInfoSchema = Type.Object({
	id: Type.String(),
	name: Type.String(),
	configured: Type.Boolean({
		description: "A credential resolves for this provider (stored or from its environment).",
	}),
	authType: Type.Optional(
		Type.Union([Type.Literal("api_key"), Type.Literal("oauth")], { description: "How the provider is configured." }),
	),
	oauth: Type.Optional(ProviderOAuthInfoSchema),
});
export type ProviderInfo = Static<typeof ProviderInfoSchema>;

export const ModelInfoSchema = Type.Object({
	api: Type.Optional(Type.String()),
	provider: Type.String(),
	modelId: Type.String(),
	name: Type.String(),
	contextWindow: Type.Integer(),
	maxTokens: Type.Integer(),
	input: Type.Array(Type.Union([Type.Literal("text"), Type.Literal("image")])),
	reasoning: Type.Boolean(),
	thinkingLevels: Type.Array(ThinkingLevelSchema, {
		description: "Levels this model supports: [off] when it does not reason, otherwise the mapped levels.",
	}),
	configured: Type.Boolean({ description: "The model's provider has a usable credential." }),
});
export type ModelInfo = Static<typeof ModelInfoSchema>;

export const ModelsListResponseSchema = Type.Object({
	type: Type.Literal("models.list"),
	id: RequestIdSchema,
	providers: Type.Array(ProviderInfoSchema),
	models: Type.Array(ModelInfoSchema),
});
export type ModelsListResponse = Static<typeof ModelsListResponseSchema>;

/** Metadata only: a credential's secret never leaves the server. */
export const CredentialInfoSchema = Type.Object({
	providerId: Type.String(),
	type: Type.Union([Type.Literal("api_key"), Type.Literal("oauth")]),
});
export type CredentialInfo = Static<typeof CredentialInfoSchema>;

export const CredentialsListResponseSchema = Type.Object({
	type: Type.Literal("credentials.list"),
	id: RequestIdSchema,
	credentials: Type.Array(CredentialInfoSchema),
});
export type CredentialsListResponse = Static<typeof CredentialsListResponseSchema>;

export const CredentialsSetResponseSchema = Type.Object({
	type: Type.Literal("credentials.set"),
	id: RequestIdSchema,
	credential: CredentialInfoSchema,
});
export type CredentialsSetResponse = Static<typeof CredentialsSetResponseSchema>;

export const CredentialsDeleteResponseSchema = Type.Object({
	type: Type.Literal("credentials.delete"),
	id: RequestIdSchema,
	deleted: Type.Boolean({ description: "False when nothing was stored for that provider." }),
});
export type CredentialsDeleteResponse = Static<typeof CredentialsDeleteResponseSchema>;

// --- server events -----------------------------------------------------------------------------------------------

/** Sent when a project's Harness opens, closes or fails, so a project list stays current without polling. */
export const ProjectStateEventSchema = Type.Object({
	type: Type.Literal("project.state"),
	project: ProjectSummarySchema,
});
export type ProjectStateEvent = Static<typeof ProjectStateEventSchema>;
