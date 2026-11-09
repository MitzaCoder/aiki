/**
 * Memory: durable facts the coordinator keeps, read-only for clients.
 *
 * Two scopes per backend: `global` (about the user) and `project` (about one project). Each is a directory of markdown
 * topic files with `##` sections and front matter, under git, in the backend's data directory; a backend never shares
 * them with another. Only the coordinator writes, through its tools. Clients list, read, search and see the change
 * history, and get `memory.changed` when a scope's files change so they can read again.
 */
import { type Static, Type } from "typebox";
import { ModelRefSchema, ProjectIdSchema, RequestIdSchema, ThinkingLevelSchema } from "./common.ts";

export const MemoryScopeSchema = Type.Union([Type.Literal("global"), Type.Literal("project")]);
export type MemoryScope = Static<typeof MemoryScopeSchema>;

export const MemoryStatusSchema = Type.Union([
	Type.Literal("active"),
	Type.Literal("superseded"),
	Type.Literal("archived"),
]);
export type MemoryStatus = Static<typeof MemoryStatusSchema>;

/** Which scope to address: `project` needs the project. */
const ScopeTarget = {
	scope: MemoryScopeSchema,
	projectId: Type.Optional(ProjectIdSchema),
};

export const MemoryFileSummarySchema = Type.Object({
	scope: MemoryScopeSchema,
	fileId: Type.String({ minLength: 1, description: 'The file\'s name without ".md", unique in its scope.' }),
	title: Type.String(),
	summary: Type.String({ description: "One line." }),
	tags: Type.Array(Type.String()),
	links: Type.Array(Type.String(), { description: "fileIds of related memories, `global:` prefixed across scopes." }),
	status: MemoryStatusSchema,
	supersededBy: Type.Union([Type.String(), Type.Null()]),
	headings: Type.Array(Type.String(), { description: "The `##` sections, in file order." }),
	created: Type.String({ description: "ISO 8601." }),
	updated: Type.String({ description: "ISO 8601." }),
	source: Type.Union(
		[
			Type.Object({
				projectId: Type.Union([ProjectIdSchema, Type.Null()]),
				conversationId: Type.Union([Type.Integer({ minimum: 1 }), Type.Null()]),
				entryId: Type.Union([Type.Integer({ minimum: 1 }), Type.Null()]),
			}),
			Type.Null(),
		],
		{ description: "Where the last write came from." },
	),
});
export type MemoryFileSummary = Static<typeof MemoryFileSummarySchema>;

export const MemoryFileSchema = Type.Object({
	file: MemoryFileSummarySchema,
	body: Type.String({ description: "The markdown after the front matter." }),
});
export type MemoryFile = Static<typeof MemoryFileSchema>;

export const MemorySearchHitSchema = Type.Object({
	scope: MemoryScopeSchema,
	fileId: Type.String(),
	title: Type.String(),
	heading: Type.Union([Type.String(), Type.Null()], { description: "Null when the match is in the file's intro." }),
	snippet: Type.String({ description: "Matching text, with the matches between \u0002 and \u0003." }),
	rank: Type.Number({ description: "BM25; lower is better." }),
});
export type MemorySearchHit = Static<typeof MemorySearchHitSchema>;

/** One commit in a scope's git history. */
/**
 * Who made a change. `tool`: the coordinator's memory tools. `hand`: edits made to the files outside the harness.
 * `extraction`: memories saved automatically from a compacted part of a conversation. `maintenance`: a maintenance run.
 * `undo`: the revert of an earlier change.
 */
export const MemoryChangeKindSchema = Type.Union([
	Type.Literal("tool"),
	Type.Literal("hand"),
	Type.Literal("extraction"),
	Type.Literal("maintenance"),
	Type.Literal("undo"),
]);
export type MemoryChangeKind = Static<typeof MemoryChangeKindSchema>;

export const MemoryChangeSchema = Type.Object({
	commit: Type.String(),
	message: Type.String({ description: "The whole commit message." }),
	at: Type.String({ description: "ISO 8601." }),
	files: Type.Array(Type.String(), { description: "fileIds touched." }),
	kind: Type.Optional(MemoryChangeKindSchema),
	source: Type.Optional(
		Type.Union([
			Type.Object({
				projectId: Type.Union([ProjectIdSchema, Type.Null()]),
				conversationId: Type.Union([Type.Integer({ minimum: 1 }), Type.Null()]),
				entryId: Type.Union([Type.Integer({ minimum: 1 }), Type.Null()], {
					description: "For `extraction`: the `pi.compaction` entry whose compacted part it came from.",
				}),
			}),
			Type.Null(),
		]),
	),
	undoable: Type.Optional(
		Type.Boolean({ description: "`extraction` and `maintenance` changes not undone yet: `memory.undo` takes them." }),
	),
	undoneBy: Type.Optional(Type.Union([Type.String(), Type.Null()], { description: "The undo commit, once undone." })),
});
export type MemoryChange = Static<typeof MemoryChangeSchema>;

// --- requests ----------------------------------------------------------------------------------------------------

export const MemoryListRequestSchema = Type.Object({
	type: Type.Literal("memory.list"),
	id: RequestIdSchema,
	...ScopeTarget,
	includeArchived: Type.Optional(Type.Boolean({ description: "Default false." })),
});
export type MemoryListRequest = Static<typeof MemoryListRequestSchema>;

export const MemoryReadRequestSchema = Type.Object({
	type: Type.Literal("memory.read"),
	id: RequestIdSchema,
	...ScopeTarget,
	fileId: Type.String({ minLength: 1 }),
});
export type MemoryReadRequest = Static<typeof MemoryReadRequestSchema>;

export const MemorySearchRequestSchema = Type.Object({
	type: Type.Literal("memory.search"),
	id: RequestIdSchema,
	query: Type.String({ minLength: 1 }),
	scope: Type.Union([MemoryScopeSchema, Type.Literal("both")]),
	projectId: Type.Optional(ProjectIdSchema),
	tags: Type.Optional(Type.Array(Type.String())),
	includeArchived: Type.Optional(Type.Boolean()),
	limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100, description: "Default 20." })),
});
export type MemorySearchRequest = Static<typeof MemorySearchRequestSchema>;

export const MemoryHistoryRequestSchema = Type.Object({
	type: Type.Literal("memory.history"),
	id: RequestIdSchema,
	...ScopeTarget,
	limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200, description: "Default 50, newest first." })),
});
export type MemoryHistoryRequest = Static<typeof MemoryHistoryRequestSchema>;

/** Revert one `extraction` or `maintenance` change. Refused with `memory_conflict` when later changes touched it. */
export const MemoryUndoRequestSchema = Type.Object({
	type: Type.Literal("memory.undo"),
	id: RequestIdSchema,
	...ScopeTarget,
	commit: Type.String({ minLength: 1 }),
});
export type MemoryUndoRequest = Static<typeof MemoryUndoRequestSchema>;

/** A scope's maintenance state, and the backend's maintenance settings. */
export const MemoryStatusRequestSchema = Type.Object({
	type: Type.Literal("memory.status"),
	id: RequestIdSchema,
	...ScopeTarget,
});
export type MemoryStatusRequest = Static<typeof MemoryStatusRequestSchema>;

/** Run maintenance on a scope now. Answers once it has started; the outcome arrives as `memory.changed`. */
export const MemoryMaintainRequestSchema = Type.Object({
	type: Type.Literal("memory.maintain"),
	id: RequestIdSchema,
	...ScopeTarget,
});
export type MemoryMaintainRequest = Static<typeof MemoryMaintainRequestSchema>;

/**
 * The backend's maintenance settings. Maintenance runs on every scope that changed since its last run: nightly at
 * `time` (backend timezone) and after `afterWrites` new writes to a scope. No model, no maintenance.
 */
export const MemoryMaintenanceSettingsSchema = Type.Object({
	model: Type.Union([ModelRefSchema, Type.Null()]),
	thinkingLevel: Type.Union([ThinkingLevelSchema, Type.Null()]),
	time: Type.String({ pattern: "^([01][0-9]|2[0-3]):[0-5][0-9]$", description: '"HH:MM", default "03:00".' }),
	afterWrites: Type.Integer({ minimum: 1, maximum: 1000, description: "Default 20." }),
});
export type MemoryMaintenanceSettings = Static<typeof MemoryMaintenanceSettingsSchema>;

export const MemorySettingsSetRequestSchema = Type.Object({
	type: Type.Literal("memory.settings.set"),
	id: RequestIdSchema,
	maintenance: MemoryMaintenanceSettingsSchema,
});
export type MemorySettingsSetRequest = Static<typeof MemorySettingsSetRequestSchema>;

export const MemoryScopeStatusSchema = Type.Object({
	scope: MemoryScopeSchema,
	projectId: Type.Union([ProjectIdSchema, Type.Null()]),
	writesSinceMaintenance: Type.Integer({ minimum: 0 }),
	maintaining: Type.Boolean({ description: "A maintenance run is in progress on this scope." }),
	lastMaintenance: Type.Union([
		Type.Object({
			at: Type.String(),
			outcome: Type.Union([Type.Literal("ok"), Type.Literal("nothing_to_do"), Type.Literal("failed")]),
			commit: Type.Union([Type.String(), Type.Null()]),
			message: Type.Union([Type.String(), Type.Null()]),
		}),
		Type.Null(),
	]),
	nextMaintenanceAt: Type.Union([Type.String(), Type.Null()], { description: "Null when no model is set." }),
});
export type MemoryScopeStatus = Static<typeof MemoryScopeStatusSchema>;

// --- responses ---------------------------------------------------------------------------------------------------

export const MemoryListResponseSchema = Type.Object({
	type: Type.Literal("memory.list"),
	id: RequestIdSchema,
	files: Type.Array(MemoryFileSummarySchema, { description: "Most recently updated first." }),
});
export type MemoryListResponse = Static<typeof MemoryListResponseSchema>;

export const MemoryReadResponseSchema = Type.Object({
	type: Type.Literal("memory.read"),
	id: RequestIdSchema,
	file: MemoryFileSchema,
});
export type MemoryReadResponse = Static<typeof MemoryReadResponseSchema>;

export const MemorySearchResponseSchema = Type.Object({
	type: Type.Literal("memory.search"),
	id: RequestIdSchema,
	hits: Type.Array(MemorySearchHitSchema, { description: "Best first." }),
});
export type MemorySearchResponse = Static<typeof MemorySearchResponseSchema>;

export const MemoryHistoryResponseSchema = Type.Object({
	type: Type.Literal("memory.history"),
	id: RequestIdSchema,
	changes: Type.Array(MemoryChangeSchema),
});
export type MemoryHistoryResponse = Static<typeof MemoryHistoryResponseSchema>;

export const MemoryUndoResponseSchema = Type.Object({
	type: Type.Literal("memory.undo"),
	id: RequestIdSchema,
	change: MemoryChangeSchema,
});
export type MemoryUndoResponse = Static<typeof MemoryUndoResponseSchema>;

export const MemoryStatusResponseSchema = Type.Object({
	type: Type.Literal("memory.status"),
	id: RequestIdSchema,
	status: MemoryScopeStatusSchema,
	maintenance: MemoryMaintenanceSettingsSchema,
	timezone: Type.String(),
});
export type MemoryStatusResponse = Static<typeof MemoryStatusResponseSchema>;

export const MemoryMaintainResponseSchema = Type.Object({
	type: Type.Literal("memory.maintain"),
	id: RequestIdSchema,
});
export type MemoryMaintainResponse = Static<typeof MemoryMaintainResponseSchema>;

export const MemorySettingsSetResponseSchema = Type.Object({
	type: Type.Literal("memory.settings.set"),
	id: RequestIdSchema,
	maintenance: MemoryMaintenanceSettingsSchema,
});
export type MemorySettingsSetResponse = Static<typeof MemorySettingsSetResponseSchema>;

// --- server events -----------------------------------------------------------------------------------------------

/**
 * A scope's files, history or maintenance state changed (a write, an archive, an edit by hand, an extraction, an undo, a
 * maintenance run starting or ending). Pushed to every connection; clients read again.
 */
export const MemoryChangedEventSchema = Type.Object({
	type: Type.Literal("memory.changed"),
	scope: MemoryScopeSchema,
	projectId: Type.Union([ProjectIdSchema, Type.Null()], { description: "Null for global." }),
});
export type MemoryChangedEvent = Static<typeof MemoryChangedEventSchema>;
