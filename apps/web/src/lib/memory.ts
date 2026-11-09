/**
 * How memory reads in the sidebar's Memory tab: the scope switch's targets, the topic files as
 * scannable rows, the search hits with their highlighted snippets, the history's commits, the
 * front matter's links and source, and which archived files the toggle shows. Pure functions, so
 * the panel only lays them out.
 *
 * Memory is read-only here: the server lists, reads, searches and keeps history; nothing in the
 * app writes, archives or pins.
 */
import {
	memoryUndoConflict,
	memorySnippetParts,
	shortCommit,
	type MemorySnippetPart,
	type MemoryTarget,
} from "@mihai-harness/client";
import type {
	MemoryChange,
	MemoryChangeKind,
	MemoryFileSummary,
	MemoryMaintenanceSettings,
	MemoryScope,
	MemoryScopeStatus,
	MemorySearchHit,
	MemoryStatus,
	ModelInfo,
	ModelRef,
	ThinkingLevel,
} from "@mihai-harness/protocol";
import { THINKING_LEVELS } from "@mihai-harness/protocol";
import { exactTime, relativeTime, relativeTimeAhead } from "./relative-time.ts";
import { sameModel } from "./models.ts";

/** The two scopes, in the switch's order: the user's own memory, then the project's. */
export const MEMORY_SCOPES: readonly MemoryScope[] = ["global", "project"];

/** Per browser, like the backend list, the theme and the sidebar. Bumped when the stored shape changes. */
export const MEMORY_SCOPE_STORAGE_KEY = "mihai-harness.memory-scope.v1";

/** A conversation is about its project, so its memory opens on the project's scope until the reader picks another. */
export const DEFAULT_MEMORY_SCOPE: MemoryScope = "project";

const MEMORY_SCOPE_LABELS: Record<MemoryScope, string> = {
	global: "Global",
	project: "Project",
};

/** How a scope reads in the switch and on a search hit: "Global" or "Project". */
export function memoryScopeLabel(scope: MemoryScope): string {
	return MEMORY_SCOPE_LABELS[scope];
}

export function isMemoryScope(value: unknown): value is MemoryScope {
	return MEMORY_SCOPES.some((scope) => scope === value);
}

/** Read a stored scope, falling back to the default so a missing or broken record still opens somewhere. */
export function parseMemoryScope(raw: string | null): MemoryScope {
	if (raw === null) return DEFAULT_MEMORY_SCOPE;
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return DEFAULT_MEMORY_SCOPE;
	}
	return isMemoryScope(parsed) ? parsed : DEFAULT_MEMORY_SCOPE;
}

/** The browser's remembered scope; the default when it has none or storage is unavailable. */
export function loadMemoryScope(
	storage: Pick<Storage, "getItem"> | undefined = browserStorage(),
): MemoryScope {
	if (storage === undefined) return DEFAULT_MEMORY_SCOPE;
	try {
		return parseMemoryScope(storage.getItem(MEMORY_SCOPE_STORAGE_KEY));
	} catch {
		return DEFAULT_MEMORY_SCOPE;
	}
}

export function saveMemoryScope(
	scope: MemoryScope,
	storage: Pick<Storage, "setItem"> | undefined = browserStorage(),
): void {
	if (storage === undefined) return;
	try {
		storage.setItem(MEMORY_SCOPE_STORAGE_KEY, JSON.stringify(scope));
	} catch {
		// Storage can be full or disabled; the choice still holds for this session.
	}
}

const MEMORY_STATUS_LABELS: Record<MemoryStatus, string> = {
	active: "Active",
	superseded: "Superseded",
	archived: "Archived",
};

/** How a file's status reads; only the ones worth flagging are shown next to a title. */
export function memoryStatusLabel(status: MemoryStatus): string {
	return MEMORY_STATUS_LABELS[status];
}

/**
 * The scope and project a request addresses. A global memory belongs to the backend, not to a
 * project, so the project is left out there; it is what the server reads the project's directory from.
 */
export function memoryTarget(scope: MemoryScope, projectId: string): MemoryTarget {
	return scope === "project" ? { scope, projectId } : { scope };
}

/** One topic file row: what it is called, how it reads, when it changed and what it is tagged with. */
export type MemoryFileRow = {
	file: MemoryFileSummary;
	/** Status `archived`; a superseded file stays in the active list. */
	archived: boolean;
	/** How long ago it changed, as a short phrase. */
	updated: string;
	/** The exact time, for a title. */
	updatedTitle: string;
	tags: string[];
};

/** Topic files as rows, most recently updated first; archived ones keep their place among the rows. */
export function memoryFileRows(files: readonly MemoryFileSummary[], now: number): MemoryFileRow[] {
	return [...files]
		.sort(
			(left, right) =>
				timestamp(right.updated) - timestamp(left.updated) || left.title.localeCompare(right.title),
		)
		.map((file) => ({
			file,
			archived: file.status === "archived",
			updated: relativeTime(file.updated, now),
			updatedTitle: exactTime(file.updated),
			tags: [...file.tags],
		}));
}

/** What the list shows, and how many archived files the toggle would add. */
export type MemoryFileSplit = {
	shown: MemoryFileRow[];
	active: number;
	archived: number;
};

/**
 * The rows the list shows: the active ones always, the archived ones only when the toggle is on.
 * The archived count stays known either way, so the toggle can say how many it hides.
 */
export function splitMemoryFiles(
	files: readonly MemoryFileSummary[],
	includeArchived: boolean,
	now: number,
): MemoryFileSplit {
	const rows = memoryFileRows(files, now);
	return {
		shown: rows.filter((row) => includeArchived || !row.archived),
		active: rows.filter((row) => !row.archived).length,
		archived: rows.filter((row) => row.archived).length,
	};
}

/** What a hit's section is called; a match in the file's introduction has no heading. */
export function memorySearchHeading(heading: string | null): string {
	return heading === null || heading.trim().length === 0 ? "Introduction" : heading;
}

/**
 * One search hit: the file it is in, which scope that is, the section and the snippet split into plain and matched
 * runs. A search covers both scopes, so every hit says where it came from.
 */
export type MemorySearchRow = {
	hit: MemorySearchHit;
	heading: string;
	scopeLabel: string;
	parts: MemorySnippetPart[];
};

/** Search hits in the order the server ranked them, each ready to render. */
export function memorySearchRows(hits: readonly MemorySearchHit[]): MemorySearchRow[] {
	return hits.map((hit) => ({
		hit,
		heading: memorySearchHeading(hit.heading),
		scopeLabel: memoryScopeLabel(hit.scope),
		parts: memorySnippetParts(hit.snippet),
	}));
}

/** The text a search box sends: trimmed, and nothing at all when the reader cleared it. */
export function memorySearchTerm(query: string): string | undefined {
	const term = query.trim();
	return term.length === 0 ? undefined : term;
}

/** A commit message split into its subject line and the rest of it. */
export function memoryMessageParts(message: string): { subject: string; body: string } {
	const [first = "", ...rest] = message.trim().split("\n");
	return { subject: first.trim(), body: rest.join("\n").trim() };
}

const MEMORY_CHANGE_KIND_LABELS: Record<MemoryChangeKind, string> = {
	tool: "By the coordinator",
	hand: "By hand",
	extraction: "Saved from a compaction",
	maintenance: "Maintenance",
	undo: "Undo",
};

/** Who made a change, as the history says it; a commit from before kinds reads as a plain change. */
export function memoryChangeKindLabel(kind: MemoryChangeKind | undefined): string {
	return kind === undefined ? "Change" : MEMORY_CHANGE_KIND_LABELS[kind];
}

/**
 * Whether `memory.undo` takes this change: the server says so for an extraction or maintenance commit that nothing has
 * undone yet.
 */
export function memoryChangeUndoable(change: MemoryChange): boolean {
	if (change.undoneBy !== undefined && change.undoneBy !== null) return false;
	return change.undoable === true;
}

/** The undo commit that reverted a change, once one did. */
export function memoryChangeUndone(change: MemoryChange): string | undefined {
	return change.undoneBy ?? undefined;
}

/**
 * What a refused or failed undo reads as. A `memory_conflict` is explained in words — later writes touched the same
 * files, so nothing was reverted — and any other failure shows what the server said.
 */
export function memoryUndoErrorText(error: unknown): string {
	if (memoryUndoConflict(error)) {
		return "Not undone: later changes touched the same memories, so the newer ones win. Nothing was reverted.";
	}
	return error instanceof Error ? error.message : String(error);
}

/**
 * Whether a change is an extraction linked to a `pi.compaction` entry: the conversation spot the history points back at.
 */
export function memoryChangeCompactionEntry(change: MemoryChange): number | undefined {
	if (change.kind !== "extraction") return undefined;
	return change.source?.entryId ?? undefined;
}

/** One commit row in the History view: what changed, when, and which files. */
export type MemoryChangeRow = {
	change: MemoryChange;
	commit: string;
	subject: string;
	body: string;
	files: string[];
	when: string;
	whenTitle: string;
	/** Who made it: "By the coordinator", "Saved from a compaction", … */
	kind: string;
	/** Whether the row offers Undo; the server refuses one a later change touched. */
	undoable: boolean;
	/** The undo commit that reverted it, for the row's mark. */
	undoneBy: string | undefined;
	/** The `pi.compaction` entry an extraction came from. */
	compactionEntry: number | undefined;
};

/** A scope's commits as rows, newest first. */
export function memoryChangeRows(changes: readonly MemoryChange[], now: number): MemoryChangeRow[] {
	return [...changes]
		.sort((left, right) => timestamp(right.at) - timestamp(left.at))
		.map((change) => {
			const { subject, body } = memoryMessageParts(change.message);
			return {
				change,
				commit: shortCommit(change.commit),
				subject,
				body,
				files: [...change.files],
				when: relativeTime(change.at, now),
				whenTitle: exactTime(change.at),
				kind: memoryChangeKindLabel(change.kind),
				undoable: memoryChangeUndoable(change),
				undoneBy: memoryChangeUndone(change),
				compactionEntry: memoryChangeCompactionEntry(change),
			};
		});
}

/** One of a commit's files, as a topic: its title when that scope's list is loaded, else its file ID. */
export type MemoryTopic = {
	fileId: string;
	title: string;
	/** Whether the title came from the scope's list. */
	known: boolean;
};

/** A commit's files as topics, titled from one scope's files. */
export function memoryTopics(files: readonly string[], list: readonly MemoryFileSummary[]): MemoryTopic[] {
	return files.map((fileId) => {
		const file = list.find((entry) => entry.fileId === fileId);
		return { fileId, title: file?.title ?? fileId, known: file !== undefined };
	});
}

/** One scope's history, as the transcript reads it to find what a compaction saved. */
export type MemoryScopeHistory = {
	scope: MemoryScope;
	changes: readonly MemoryChange[];
	files: readonly MemoryFileSummary[];
};

/** The memories a compaction entry saved: the extraction commit, the scope it was written in and its topics. */
export type MemoryExtraction = {
	scope: MemoryScope;
	change: MemoryChange;
	topics: MemoryTopic[];
	/** The undo commit, once this extraction was reverted. */
	undoneBy: string | undefined;
};

/**
 * What a compaction entry saved: the newest `extraction` change in either scope whose source names that entry, with its
 * topics. The project's scope is read first, because a project's coordinator extracts into it; the global scope's
 * extractions are found from the same histories.
 */
export function memoryExtractionFor(
	histories: readonly MemoryScopeHistory[],
	entryId: number,
): MemoryExtraction | undefined {
	const ordered = [...histories].sort(
		(left, right) => Number(right.scope === "project") - Number(left.scope === "project"),
	);
	let found: MemoryExtraction | undefined;
	for (const history of ordered) {
		for (const change of history.changes) {
			if (change.kind !== "extraction" || change.source?.entryId !== entryId) continue;
			if (found !== undefined && timestamp(found.change.at) >= timestamp(change.at)) continue;
			found = {
				scope: history.scope,
				change,
				topics: memoryTopics(change.files, history.files),
				undoneBy: memoryChangeUndone(change),
			};
		}
	}
	return found;
}

const MAINTENANCE_OUTCOMES: Record<"ok" | "nothing_to_do" | "failed", string> = {
	ok: "changed memory",
	nothing_to_do: "nothing to do",
	failed: "failed",
};

/** A scope's maintenance state as one small status line. */
export type MemoryStatusView = {
	/** A run is in progress right now. */
	running: boolean;
	/** The last run: when and how it went, with the server's message behind a title. */
	last?: { text: string; title: string; failed: boolean };
	/** When the next run is due; absent when no model is set. */
	next?: { text: string; title: string };
	/** How many writes the scope took since the last run. */
	writes: string;
	/** No model set, so maintenance never runs. */
	off: boolean;
};

/** How a scope's maintenance reads in the Memory tab: the last run, the next one, and the writes waiting for it. */
export function memoryStatusView(status: MemoryScopeStatus, now: number): MemoryStatusView {
	const last = status.lastMaintenance;
	const count = status.writesSinceMaintenance;
	return {
		running: status.maintaining,
		...(last === null
			? {}
			: {
					last: {
						text: `${relativeTime(last.at, now)} · ${MAINTENANCE_OUTCOMES[last.outcome]}`,
						title: last.message ?? exactTime(last.at),
						failed: last.outcome === "failed",
					},
				}),
		...(status.nextMaintenanceAt === null
			? {}
			: {
					next: {
						text: relativeTimeAhead(status.nextMaintenanceAt, now),
						title: exactTime(status.nextMaintenanceAt),
					},
				}),
		writes: count === 1 ? "1 write since the last run" : `${count} writes since the last run`,
		off: status.nextMaintenanceAt === null,
	};
}

/** What maintenance does when the backend has no model chosen: the protocol's defaults, with no model. */
export const DEFAULT_MEMORY_MAINTENANCE: MemoryMaintenanceSettings = {
	model: null,
	thinkingLevel: null,
	time: "03:00",
	afterWrites: 20,
};

/** Without a model, maintenance never runs. */
export function memoryMaintenanceOff(settings: MemoryMaintenanceSettings): boolean {
	return settings.model === null;
}

/** One line saying when maintenance runs on a backend: nightly in its timezone, or after N writes. */
export function memoryMaintenanceSummary(settings: MemoryMaintenanceSettings, timezone: string): string {
	if (settings.model === null) return "Off: maintenance doesn't run without a model.";
	const writes = settings.afterWrites === 1 ? "after 1 write" : `after ${settings.afterWrites} writes`;
	return `Nightly at ${settings.time} (${timezone}), or ${writes}.`;
}

/** A nightly time as the server takes it: "HH:MM" on a 24-hour clock; anything else is undefined. */
export function parseNightlyTime(value: string): string | undefined {
	const match = /^([01][0-9]|2[0-3]):([0-5][0-9])$/.exec(value.trim());
	return match === null ? undefined : `${match[1]}:${match[2]}`;
}

/** A write count the server takes, 1 to 1000; anything else is undefined, so a stray keystroke changes nothing. */
export function parseAfterWrites(value: string | number): number | undefined {
	const count = typeof value === "number" ? value : Number(value.trim());
	if (!Number.isInteger(count) || count < 1 || count > 1000) return undefined;
	return count;
}

/** The levels the maintenance model offers; a model the catalog does not list keeps the protocol's full set. */
export function maintenanceThinkingLevels(
	model: ModelRef,
	models: readonly ModelInfo[],
): readonly ThinkingLevel[] {
	return models.find((entry) => sameModel(entry, model))?.thinkingLevels ?? THINKING_LEVELS;
}

/** Where a front matter link points: its own scope, or the global one when it is `global:` prefixed. */
export type MemoryLinkTarget = {
	scope: MemoryScope;
	fileId: string;
};

const CROSS_SCOPE_PREFIXES: ReadonlyArray<readonly [string, MemoryScope]> = [
	["global:", "global"],
	["project:", "project"],
];

/**
 * Read a link as the memory it points to. Links are file IDs; one across scopes is prefixed with
 * its scope (`global:testing`). An empty link points nowhere.
 */
export function memoryLinkTarget(link: string, scope: MemoryScope): MemoryLinkTarget | undefined {
	const trimmed = link.trim();
	if (trimmed.length === 0) return undefined;
	for (const [prefix, linkedScope] of CROSS_SCOPE_PREFIXES) {
		if (!trimmed.startsWith(prefix)) continue;
		const fileId = trimmed.slice(prefix.length).trim();
		return fileId.length === 0 ? undefined : { scope: linkedScope, fileId };
	}
	return { scope, fileId: trimmed };
}

/** A link ready to render: where it goes, and what to call it. */
export type MemoryLinkView = MemoryLinkTarget & {
	/** The linked memory's title when this scope's files are loaded, else its ID. */
	label: string;
	/** Whether the title was found, so a row can style an unknown link as an ID. */
	known: boolean;
};

/**
 * A file's links as rows. Titles come from `files`, which is the current scope's list: a link into
 * the other scope shows its file ID, because that scope's files are not loaded.
 */
export function memoryLinkViews(
	links: readonly string[],
	scope: MemoryScope,
	files: readonly MemoryFileSummary[],
): MemoryLinkView[] {
	const views: MemoryLinkView[] = [];
	for (const link of links) {
		const target = memoryLinkTarget(link, scope);
		if (target === undefined) continue;
		const known =
			target.scope === scope ? files.find((file) => file.fileId === target.fileId) : undefined;
		views.push({
			...target,
			label: known?.title ?? target.fileId,
			known: known !== undefined,
		});
	}
	return views;
}

/** Where a memory's last write came from, as the panel says it. */
export type MemorySourceView = {
	text: string;
	projectId: string | null;
	conversationId: number | null;
};

/**
 * The source of a file's last write: the conversation and entry it came from. A memory the
 * coordinator of a project wrote has that project, so the panel can link back to its chat.
 */
export function memorySourceView(source: MemoryFileSummary["source"]): MemorySourceView | undefined {
	if (source === null) return undefined;
	const parts: string[] = [];
	if (source.conversationId !== null) parts.push(`conversation #${source.conversationId}`);
	if (source.entryId !== null) parts.push(`entry #${source.entryId}`);
	return {
		text: parts.length === 0 ? "the coordinator" : parts.join(", "),
		projectId: source.projectId,
		conversationId: source.conversationId,
	};
}

function browserStorage(): Storage | undefined {
	if (typeof window === "undefined") return undefined;
	try {
		return window.localStorage;
	} catch {
		return undefined;
	}
}

function timestamp(at: string): number {
	const ms = Date.parse(at);
	return Number.isFinite(ms) ? ms : 0;
}
