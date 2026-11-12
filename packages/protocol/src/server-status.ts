/**
 * The server's own status: which release it runs, whether anything is running, and how the last deploy went.
 *
 * Deploys read it to restart only when the backend is idle and to check a new release beyond `hello`; clients show the
 * release and warn when the last deploy failed or rolled back. `server.status.changed` is pushed to every connection when
 * the release or the deploy outcome changes, not when `busy` does (ask with `server.status` for that).
 */
import { type Static, Type } from "typebox";
import { RequestIdSchema } from "./common.ts";

/** The release the server runs, from the `RELEASE.json` the deploy writes into it; null when run from a checkout. */
export const ReleaseInfoSchema = Type.Object({
	name: Type.String({ minLength: 1, description: 'The release directory\'s name, e.g. "20261030T113815Z-be84355".' }),
	commit: Type.String({ minLength: 1, description: "Full commit ID the release was built from." }),
	description: Type.String({ description: "First line of the commit's description." }),
	deployedAt: Type.String({ description: "ISO 8601." }),
});
export type ReleaseInfo = Static<typeof ReleaseInfoSchema>;

/**
 * The last deploy attempt that concerned this backend, from the `deploy-status.json` the deploy writes in the deploy root.
 *
 * - `ok`: the commit is deployed and passed the health check.
 * - `failed`: the checks or the build failed before anything was published; the previous release keeps running.
 * - `rolled_back`: the new release failed its health check after the restart and the previous one was restored.
 *
 * An `ok` with `backendUnchanged` deployed a commit that changes nothing this backend runs (only the web app, docs and
 * the like), so the backend was not restarted and keeps running an older release: `release.commit` differs from
 * `commit` on purpose.
 */
export const DeployStatusSchema = Type.Object({
	state: Type.Union([Type.Literal("ok"), Type.Literal("failed"), Type.Literal("rolled_back")]),
	commit: Type.String({ minLength: 1, description: "The commit the attempt was for." }),
	description: Type.String({ description: "First line of that commit's description." }),
	message: Type.Union([Type.String(), Type.Null()], { description: "What failed, for failed and rolled_back." }),
	at: Type.String({ description: "ISO 8601, when the attempt ended." }),
	backendUnchanged: Type.Optional(
		Type.Literal(true, {
			description: "ok without a restart: no path the backend runs changed since its release. Absent otherwise.",
		}),
	),
	pending: Type.Optional(
		Type.Object(
			{
				commit: Type.String({ minLength: 1, description: "The commit it is being brought up to." }),
				description: Type.String({ description: "First line of that commit's description." }),
				message: Type.String({ description: 'Why it is behind, e.g. "back online, deploying <description>".' }),
				since: Type.String({ description: "ISO 8601, when the note was written." }),
			},
			{ description: "Set while this backend catches up to a commit it missed. Absent otherwise." },
		),
	),
});
export type DeployStatus = Static<typeof DeployStatusSchema>;

export const DiskStatusSchema = Type.Object({
	label: Type.String({ description: 'What lives there, e.g. "Data" or a project name.' }),
	path: Type.String({ description: "A path on that filesystem." }),
	freeBytes: Type.Integer({ minimum: 0 }),
	totalBytes: Type.Integer({ minimum: 0 }),
	low: Type.Boolean({ description: "Below the warning threshold (AIKI_DISK_LOW_*, default 15% or 10 GiB free)." }),
});
export type DiskStatus = Static<typeof DiskStatusSchema>;

export const ReleaseUpdateStateSchema = Type.Object({
	schemaVersion: Type.Literal(1),
	enabled: Type.Boolean(),
	installedVersion: Type.Union([Type.String(), Type.Null()]),
	channel: Type.Union([Type.Literal("pilot"), Type.Literal("stable")]),
	available: Type.Union([Type.Object({ version: Type.String(), notesUrl: Type.String() }), Type.Null()]),
	dismissedVersion: Type.Union([Type.String(), Type.Null()]),
});
export type ReleaseUpdateState = Static<typeof ReleaseUpdateStateSchema>;

/** Backend-wide, not a project setting. No check is triggered by reading or changing this state. */
export const ReleaseUpdatesSetRequestSchema = Type.Object({
	type: Type.Literal("server.updates.set"),
	id: RequestIdSchema,
	enabled: Type.Optional(Type.Union([Type.Boolean(), Type.Null()], { description: "null restores installed-only default." })),
	dismissVersion: Type.Optional(Type.String({ maxLength: 200 })),
});
export const ReleaseUpdatesSetResponseSchema = Type.Object({
	type: Type.Literal("server.updates.set"),
	id: RequestIdSchema,
	updates: ReleaseUpdateStateSchema,
});
export type ReleaseUpdatesSetRequest = Static<typeof ReleaseUpdatesSetRequestSchema>;
export type ReleaseUpdatesSetResponse = Static<typeof ReleaseUpdatesSetResponseSchema>;

export const SelfUpdateStateSchema = Type.Object({
	schemaVersion: Type.Literal(1),
	enabled: Type.Boolean(),
	disabledReason: Type.Union([Type.String(), Type.Null()]),
	phase: Type.Union([Type.Literal("idle"), Type.Literal("preparing"), Type.Literal("waiting"), Type.Literal("restarting"), Type.Literal("checking"), Type.Literal("succeeded"), Type.Literal("rolled_back"), Type.Literal("failed"), Type.Literal("cancelled")]),
	attempt: Type.String(),
	fromVersion: Type.String(),
	toVersion: Type.String(),
	notesUrl: Type.String(),
	/** Legacy field; self-update no longer waits for agents. */
	agents: Type.Integer({ minimum: 0 }),
	toolCalls: Type.Optional(Type.Integer({ minimum: 0 })),
	restartAllowed: Type.Optional(Type.Boolean()),
	message: Type.String(),
});
export type SelfUpdateState = Static<typeof SelfUpdateStateSchema>;
export const ServerUpdateRequestSchema = Type.Object({
	type: Type.Literal("server.update"),
	id: RequestIdSchema,
	action: Type.Union([Type.Literal("start"), Type.Literal("cancel"), Type.Literal("force")]),
	version: Type.String({ maxLength: 200 }),
});
export const ServerUpdateResponseSchema = Type.Object({
	type: Type.Literal("server.update"),
	id: RequestIdSchema,
	selfUpdate: SelfUpdateStateSchema,
});
export type ServerUpdateRequest = Static<typeof ServerUpdateRequestSchema>;
export type ServerUpdateResponse = Static<typeof ServerUpdateResponseSchema>;

export const ServerStatusSchema = Type.Object({
	selfUpdate: Type.Optional(SelfUpdateStateSchema),
	updates: Type.Optional(ReleaseUpdateStateSchema),
	release: Type.Union([ReleaseInfoSchema, Type.Null()]),
	deploy: Type.Union([DeployStatusSchema, Type.Null()], { description: "Null when no deploy wrote a status yet." }),
	busy: Type.Object(
		{
			conversations: Type.Integer({ minimum: 0, description: "Coordinator conversations with a run in progress." }),
			workers: Type.Integer({ minimum: 0, description: "Workers whose status is running." }),
			toolCalls: Type.Optional(
				Type.Integer({
					minimum: 0,
					description:
						"Tool calls executing now, in every conversation (coordinators, threads, workers). A code mode script's " +
						"nested calls count through the script's own call. Absent on servers without the `drain` feature.",
				}),
			),
		},
		{ description: "What a restart would interrupt now. Idle when conversations and workers are 0." },
	),
	startedAt: Type.String({ description: "ISO 8601, when this server process started." }),
	disks: Type.Optional(
		Type.Array(DiskStatusSchema, {
			description: "One per filesystem the data directory and the projects live on, deduplicated. Absent on older servers.",
		}),
	),
});
export type ServerStatus = Static<typeof ServerStatusSchema>;

// --- requests ----------------------------------------------------------------------------------------------------

export const ServerStatusRequestSchema = Type.Object({
	type: Type.Literal("server.status"),
	id: RequestIdSchema,
});
export type ServerStatusRequest = Static<typeof ServerStatusRequestSchema>;

/** The longest drain one `server.drain` may ask for; a deploy that waits longer sends the request again. */
export const MAX_DRAIN_TIMEOUT_MS = 30 * 60_000;
/** The drain a `server.drain` without `timeoutMs` starts. */
export const DEFAULT_DRAIN_TIMEOUT_MS = 2 * 60_000;

/**
 * Hold new tool calls so a restart interrupts none (feature `drain`). Until the drain ends — the server stops, or
 * `timeoutMs` passes — every tool call a model makes in any conversation waits before it starts, so
 * `server.status.busy.toolCalls` can only fall; a deploy restarts once it is 0. A held call has not started: after a
 * restart it runs from the beginning. Calls a running tool makes (a code mode script's) are not held, so their caller
 * can finish. Asking again extends the drain from now; `timeoutMs: 0` ends it and releases the held calls.
 */
export const ServerDrainRequestSchema = Type.Object({
	type: Type.Literal("server.drain"),
	id: RequestIdSchema,
	timeoutMs: Type.Optional(
		Type.Integer({ minimum: 0, maximum: MAX_DRAIN_TIMEOUT_MS, description: "Default 120000 (2 minutes); 0 ends the drain." }),
	),
});
export type ServerDrainRequest = Static<typeof ServerDrainRequestSchema>;

// --- responses ---------------------------------------------------------------------------------------------------

export const ServerStatusResponseSchema = Type.Object({
	type: Type.Literal("server.status"),
	id: RequestIdSchema,
	status: ServerStatusSchema,
});
export type ServerStatusResponse = Static<typeof ServerStatusResponseSchema>;

export const ServerDrainResponseSchema = Type.Object({
	type: Type.Literal("server.drain"),
	id: RequestIdSchema,
	drainingUntil: Type.Union([Type.String(), Type.Null()], {
		description: "ISO 8601, when the drain ends unless asked again; null when it was ended.",
	}),
	toolCalls: Type.Integer({ minimum: 0, description: "Tool calls executing now, as `busy.toolCalls`." }),
});
export type ServerDrainResponse = Static<typeof ServerDrainResponseSchema>;

// --- server events -----------------------------------------------------------------------------------------------

export const ServerStatusEventSchema = Type.Object({
	type: Type.Literal("server.status.changed"),
	status: ServerStatusSchema,
});
export type ServerStatusEvent = Static<typeof ServerStatusEventSchema>;
