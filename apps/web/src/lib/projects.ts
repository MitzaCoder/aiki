/**
 * The projects sidebar: what a project row says at a glance, which reply counts as
 * unread, and what this browser remembers about the sidebar and about what the user
 * has read. Pure functions, so the sidebar only wires them to markup and storage.
 *
 * A row's status comes from the project's `state` (opening, open, failed), whether a
 * coordinator model is chosen, and — when the backend sends it — the coordinator's
 * `activity`: working, failed, how many workers run, when it last answered.
 */
import type { ProjectActivity, ProjectSummary } from "@aiki/protocol";
import { elapsedFor } from "./relative-time.ts";

/** Per browser, like the backend list, the theme and the right sidebar. */
export const PROJECTS_SEEN_STORAGE_KEY = "aiki.projects-seen.v1";
export const PROJECTS_NAV_STORAGE_KEY = "aiki.projects-nav.v1";

/** The width from which the sidebar is persistent; below it the same content is a drawer. */
export const PROJECTS_NAV_WIDE_QUERY = "(min-width: 64rem)";

/**
 * When this browser last had a project open: the reply it had reached. `lastReplyEntryId`
 * is the more precise stamp; `lastReplyAt` covers a backend whose activity predates it.
 */
export type ProjectSeen = { lastReplyEntryId: number | null; lastReplyAt: string | null };

/** Seen stamps by project, keyed with `projectSeenKey`. */
export type ProjectSeens = Record<string, ProjectSeen>;

/** A project's key in this browser's storage: both IDs escaped, so neither can collide with the separator. */
export function projectSeenKey(backendId: string, projectId: string): string {
	return `${encodeURIComponent(backendId)}/${encodeURIComponent(projectId)}`;
}

/** The reply a project has reached, for remembering that the user saw it. Undefined when it has no reply. */
export function projectSeenStamp(activity: ProjectActivity | undefined): ProjectSeen | undefined {
	if (activity === undefined || (activity.lastReplyAt === null && activity.lastReplyEntryId === null)) {
		return undefined;
	}
	return { lastReplyEntryId: activity.lastReplyEntryId, lastReplyAt: activity.lastReplyAt };
}

export function sameSeen(left: ProjectSeen | undefined, right: ProjectSeen | undefined): boolean {
	if (left === undefined || right === undefined) return left === right;
	return left.lastReplyEntryId === right.lastReplyEntryId && left.lastReplyAt === right.lastReplyAt;
}

/** Whether `stamp` is a later reply than `than`, so a mark only moves forward. */
export function seenIsNewer(stamp: ProjectSeen, than: ProjectSeen | undefined): boolean {
	if (than === undefined) return true;
	if (stamp.lastReplyEntryId !== null && than.lastReplyEntryId !== null) {
		return stamp.lastReplyEntryId > than.lastReplyEntryId;
	}
	const next = stamp.lastReplyAt === null ? Number.NaN : Date.parse(stamp.lastReplyAt);
	const previous = than.lastReplyAt === null ? Number.NaN : Date.parse(than.lastReplyAt);
	if (Number.isNaN(next)) return false;
	if (Number.isNaN(previous)) return true;
	return next > previous;
}

/**
 * Whether the project has answered since this browser last had it open. Entry IDs are
 * compared when both sides have one; otherwise the reply times decide. A project never
 * opened here counts as unread once it has answered: nothing on this browser has seen it.
 */
export function projectUnread(activity: ProjectActivity | undefined, seen: ProjectSeen | undefined): boolean {
	if (activity === undefined || activity.lastReplyAt === null) return false;
	if (activity.lastReplyEntryId !== null && seen?.lastReplyEntryId != null) {
		return activity.lastReplyEntryId > seen.lastReplyEntryId;
	}
	if (seen === undefined || seen.lastReplyAt === null) return true;
	const replied = Date.parse(activity.lastReplyAt);
	if (Number.isNaN(replied)) return false;
	const read = Date.parse(seen.lastReplyAt);
	return Number.isNaN(read) ? true : replied > read;
}

/** How a row's status reads: a colour to pick and two short lines. */
export type ProjectStatusTone = "ok" | "busy" | "warn" | "error" | "muted";

export type ProjectStatus = {
	tone: ProjectStatusTone;
	/** Two or three words, for the row and for the rail's tooltip. */
	label: string;
	/** When it last answered, or how many workers run. */
	detail?: string;
	/** The long version, for the row's tooltip. */
	title: string;
};

/** "just now", "4m ago", "3h ago", "5d ago" for an ISO time; empty for a missing or invalid one. */
export function timeAgo(iso: string | null | undefined, now: number): string {
	if (iso === null || iso === undefined) return "";
	const at = Date.parse(iso);
	if (Number.isNaN(at)) return "";
	const seconds = Math.max(0, Math.round((now - at) / 1000));
	if (seconds < 45) return "just now";
	const minutes = Math.round(seconds / 60);
	if (minutes < 60) return `${minutes}m ago`;
	const hours = Math.round(minutes / 60);
	if (hours < 24) return `${hours}h ago`;
	const days = Math.round(hours / 24);
	return `${days}d ago`;
}

function workersLabel(count: number): string {
	return count === 1 ? "1 worker" : `${count} workers`;
}

/**
 * What one project is doing, from its state, its model and its activity. Servers older
 * than `ProjectSummary.activity` send none, so a row then shows the open/closed state
 * alone rather than inventing activity.
 */
export function projectStatus(project: ProjectSummary, now: number): ProjectStatus {
	if (project.state === "failed") {
		return {
			tone: "error",
			label: "Open failed",
			title: project.failure ?? "The project failed to open.",
		};
	}
	if (project.coordinator.model === null) {
		return {
			tone: "warn",
			label: "No model",
			title: "No coordinator model is chosen; this project cannot answer until it has one.",
		};
	}
	const activity = project.activity;
	if (activity === undefined) {
		return project.state === "open"
			? { tone: "ok", label: "Open", title: "The project is open. This backend does not report activity." }
			: { tone: "muted", label: "Closed", title: "The project is closed. This backend does not report activity." };
	}
	const ago = timeAgo(activity.lastReplyAt, now);
	if (project.state === "closed") {
		return {
			tone: "muted",
			label: "Closed",
			detail: activity.runningWorkers > 0 ? workersLabel(activity.runningWorkers) : undefined,
			title: `The project is closed.${ago.length > 0 ? ` It last answered ${ago}.` : ""}`,
		};
	}
	switch (activity.coordinator) {
		case "working": {
			const workers = activity.runningWorkers > 0 ? workersLabel(activity.runningWorkers) : undefined;
			const tool = activity.runningTool;
			if (tool != null) {
				const elapsed = elapsedFor(tool.startedAt, now);
				return {
					tone: "busy",
					label: `Running ${tool.name}`,
					detail: elapsed.length > 0 ? elapsed : undefined,
					title: `The coordinator is running ${tool.name}${elapsed.length > 0 ? ` (${elapsed})` : ""}${workers !== undefined ? `, with ${workers} running` : ""}.`,
				};
			}
			return {
				tone: "busy",
				label: "Working",
				detail: workers,
				title: `The coordinator is answering${workers !== undefined ? `, with ${workers} running` : ""}.`,
			};
		}
		case "failed":
			return {
				tone: "error",
				label: "Run failed",
				detail: ago.length > 0 ? ago : undefined,
				title: `The coordinator's last run failed${ago.length > 0 ? ` ${ago}` : ""}.`,
			};
		default:
			break;
	}
	if (activity.runningWorkers > 0) {
		return {
			tone: "busy",
			label: workersLabel(activity.runningWorkers),
			detail: ago.length > 0 ? ago : undefined,
			title: `${workersLabel(activity.runningWorkers)} running${ago.length > 0 ? `; the coordinator last answered ${ago}` : ""}.`,
		};
	}
	if (ago.length === 0) {
		return { tone: "muted", label: "Not started", title: "The coordinator has not answered yet." };
	}
	return {
		tone: "muted",
		label: "Idle",
		detail: ago,
		title: `The coordinator is idle; it last answered ${ago}.`,
	};
}

/** A row in the sidebar: its status plus whether a reply is waiting to be read. */
export type ProjectRow = ProjectStatus & { unread: boolean };

/** The colour a project's status dot takes; a working project's dot pulses, in the rail and the list. */
export function projectToneDotClass(tone: ProjectStatusTone): string {
	switch (tone) {
		case "ok":
			return "bg-emerald-600 dark:bg-emerald-400";
		case "busy":
			return "bg-(--accent-2) animate-pulse motion-reduce:animate-none";
		case "warn":
			return "bg-amber-500 dark:bg-amber-400";
		case "error":
			return "bg-destructive";
		default:
			return "bg-muted-foreground/40";
	}
}

/** The colour its status text takes, when the tone is worth colouring. */
export function projectToneTextClass(tone: ProjectStatusTone): string {
	switch (tone) {
		case "error":
			return "text-destructive";
		case "warn":
			return "text-amber-700 dark:text-amber-300";
		case "busy":
			return "text-(--chat-fg-muted)";
		default:
			return "text-(--chat-fg-subtle)";
	}
}

export function projectRow(
	project: ProjectSummary,
	seen: ProjectSeen | undefined,
	now: number,
): ProjectRow {
	return { ...projectStatus(project, now), unread: projectUnread(project.activity, seen) };
}

/** Whether the user archived the project. A summary from an older backend has no flag and reads as not archived. */
export function isArchived(project: Pick<ProjectSummary, "archived">): boolean {
	return project.archived === true;
}

/** The projects the drawer, the sidebar and the backends page list: everything not archived, in the given order. */
export function activeProjects<T extends Pick<ProjectSummary, "archived">>(projects: readonly T[]): T[] {
	return projects.filter((project) => !isArchived(project));
}

/** The archived projects, in the given order, for the Archived list. */
export function archivedProjects<T extends Pick<ProjectSummary, "archived">>(projects: readonly T[]): T[] {
	return projects.filter(isArchived);
}

/** The Archived list's toggle: "Archived (2)". */
export function archivedHeading(count: number): string {
	return `Archived (${count})`;
}

/** The letter or digit the collapsed rail shows for a project. */
export function projectInitial(name: string): string {
	const first = name.trim().charAt(0);
	return first.length === 0 ? "?" : first.toUpperCase();
}

/** Where the app is: the backend and project a path belongs to, when it belongs to one. */
export type CurrentProject = { backendId: string; projectId: string };

/**
 * The project a path shows: `/b/<backend>/projects/<id>` and everything below it
 * (settings, a worker's transcript). Undefined for any other path.
 */
export function currentProject(pathname: string): CurrentProject | undefined {
	const parts = pathname.split("/").filter((part) => part.length > 0);
	if (parts.length < 4) return undefined;
	const [root, backendId, projects, projectId] = parts;
	if (root !== "b" || projects !== "projects" || backendId === undefined || projectId === undefined) {
		return undefined;
	}
	try {
		return { backendId: decodeURIComponent(backendId), projectId: decodeURIComponent(projectId) };
	} catch {
		return undefined;
	}
}

/** What a browser remembers about the projects sidebar itself. */
export type ProjectsNavState = { collapsed: boolean };

export const DEFAULT_PROJECTS_NAV_STATE: ProjectsNavState = { collapsed: false };

export function parseProjectsNavState(raw: string | null): ProjectsNavState {
	if (raw === null) return { ...DEFAULT_PROJECTS_NAV_STATE };
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return { ...DEFAULT_PROJECTS_NAV_STATE };
	}
	if (typeof parsed !== "object" || parsed === null) return { ...DEFAULT_PROJECTS_NAV_STATE };
	return { collapsed: (parsed as { collapsed?: unknown }).collapsed === true };
}

export function loadProjectsNavState(
	storage: Pick<Storage, "getItem"> | undefined = browserStorage(),
): ProjectsNavState {
	if (storage === undefined) return { ...DEFAULT_PROJECTS_NAV_STATE };
	try {
		return parseProjectsNavState(storage.getItem(PROJECTS_NAV_STORAGE_KEY));
	} catch {
		return { ...DEFAULT_PROJECTS_NAV_STATE };
	}
}

export function saveProjectsNavState(
	state: ProjectsNavState,
	storage: Pick<Storage, "setItem"> | undefined = browserStorage(),
): void {
	if (storage === undefined) return;
	try {
		storage.setItem(PROJECTS_NAV_STORAGE_KEY, JSON.stringify({ collapsed: state.collapsed }));
	} catch {
		// Storage can be full or disabled; the sidebar still collapses for this session.
	}
}

function isProjectSeen(value: unknown): value is ProjectSeen {
	if (typeof value !== "object" || value === null) return false;
	const record = value as { lastReplyEntryId?: unknown; lastReplyAt?: unknown };
	const entryId = record.lastReplyEntryId;
	const at = record.lastReplyAt;
	if (entryId !== null && !(typeof entryId === "number" && Number.isInteger(entryId) && entryId >= 1)) return false;
	if (at !== null && typeof at !== "string") return false;
	return entryId !== null || at !== null;
}

/** Parse stored seen stamps, dropping anything that is not one. */
export function parseProjectSeens(raw: string | null): ProjectSeens {
	if (raw === null) return {};
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return {};
	}
	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
	const seens: ProjectSeens = {};
	for (const [key, value] of Object.entries(parsed)) {
		if (!isProjectSeen(value)) continue;
		seens[key] = { lastReplyEntryId: value.lastReplyEntryId, lastReplyAt: value.lastReplyAt };
	}
	return seens;
}

export function loadProjectSeens(
	storage: Pick<Storage, "getItem"> | undefined = browserStorage(),
): ProjectSeens {
	if (storage === undefined) return {};
	try {
		return parseProjectSeens(storage.getItem(PROJECTS_SEEN_STORAGE_KEY));
	} catch {
		return {};
	}
}

export function saveProjectSeens(
	seens: ProjectSeens,
	storage: Pick<Storage, "setItem"> | undefined = browserStorage(),
): void {
	if (storage === undefined) return;
	try {
		storage.setItem(PROJECTS_SEEN_STORAGE_KEY, JSON.stringify(seens));
	} catch {
		// Storage can be full or disabled; unread marks still work for this session.
	}
}

function browserStorage(): Storage | undefined {
	if (typeof window === "undefined") return undefined;
	try {
		return window.localStorage;
	} catch {
		return undefined;
	}
}
