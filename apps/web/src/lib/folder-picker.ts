/**
 * The folder picker's pure logic: sorting and filtering a listing, reading a typed path, quick places, what a key does,
 * how a row's actions read, the delete confirmation and what the device remembers per backend. The component
 * (`FolderPicker.svelte`) only draws this and talks to the backend.
 */
import type { DirectoryEntry } from "@aiki/protocol";
import { compactRelativeTime, relativeTime } from "./relative-time.ts";

/** The server's own order: numeric-aware, case-insensitive, then exact. */
export function compareFolderNames(left: string, right: string): number {
	return left.localeCompare(right, undefined, { numeric: true, sensitivity: "base" }) || left.localeCompare(right);
}

/** Repos first, then everything else, each group by name. */
export function sortEntries(entries: readonly DirectoryEntry[]): DirectoryEntry[] {
	return [...entries].sort(
		(left, right) => Number(right.isRepo) - Number(left.isRepo) || compareFolderNames(left.name, right.name),
	);
}

/** The entries whose name contains the query (case-insensitive); an empty query keeps all. Order is kept. */
export function filterEntries(entries: readonly DirectoryEntry[], query: string): DirectoryEntry[] {
	const needle = query.trim().toLowerCase();
	if (needle === "") return [...entries];
	return entries.filter((entry) => entry.name.toLowerCase().includes(needle));
}

// --- typed paths ---------------------------------------------------------------------------------------------------

/** Text starting with `/` or `~` is a path to go to; anything else filters the current folder. */
export function isPathInput(text: string): boolean {
	const trimmed = text.trimStart();
	return trimmed.startsWith("/") || trimmed === "~" || trimmed.startsWith("~/");
}

/** `~` and `~/x` mean the backend user's home. Anything else is unchanged (and trimmed). */
export function expandHome(input: string, home: string): string {
	const text = input.trim();
	if (text === "~") return home;
	if (text.startsWith("~/")) return `${home.replace(/\/$/, "")}/${text.slice(2)}`;
	return text;
}

/** A path with the home directory written as `~`, for short labels. */
export function shortPath(path: string, home: string): string {
	if (path === home) return "~";
	const prefix = home.endsWith("/") ? home : `${home}/`;
	return path.startsWith(prefix) ? `~/${path.slice(prefix.length)}` : path;
}

function commonPrefix(names: readonly string[]): string {
	const first = names[0];
	if (first === undefined) return "";
	let prefix = first;
	for (const name of names.slice(1)) {
		let length = 0;
		while (length < prefix.length && length < name.length && prefix[length] === name[length]) length++;
		prefix = prefix.slice(0, length);
	}
	return prefix;
}

/**
 * What Tab does in a typed path: continue to the longest prefix every match shares, and add a slash when exactly one
 * folder matches. Returns the input unchanged when there is nothing to add.
 */
export function completeInput(input: string, entries: readonly DirectoryEntry[]): string {
	if (entries.length === 0) return input;
	const slash = input.lastIndexOf("/");
	const head = input.slice(0, slash + 1);
	const typed = input.slice(slash + 1);
	const only = entries.length === 1 ? entries[0] : undefined;
	if (only !== undefined) return `${head}${only.name}/`;
	const shared = commonPrefix(entries.map((entry) => entry.name));
	// Matching is case-insensitive, so the shared part may differ in case from what was typed; keep the longer one.
	return shared.length > typed.length ? `${head}${shared}` : input;
}

// --- rows ----------------------------------------------------------------------------------------------------------

/** "jj" or "git" for a repo whose kind the server told, "repo" for an older server's, null for a plain folder. */
export function repoLabel(entry: DirectoryEntry): "jj" | "git" | "repo" | null {
	if (!entry.isRepo) return null;
	return entry.repoKind ?? "repo";
}

/** A row's last-modified time: short text and the full phrase for a tooltip; both empty when the server sent none. */
export function modifiedText(entry: DirectoryEntry, now: number): { short: string; title: string } {
	if (entry.modifiedAt === undefined) return { short: "", title: "" };
	const short = compactRelativeTime(entry.modifiedAt, now);
	if (short === "") return { short: "", title: "" };
	return { short, title: `Modified ${relativeTime(entry.modifiedAt, now)}` };
}

export type RowActions = {
	/** Rename and delete are offered at all (the backend can change folders). */
	available: boolean;
	rename: { enabled: boolean; reason?: string };
	delete: { enabled: boolean; reason?: string };
};

/**
 * Which row actions the menu shows. The app can only know that a folder is itself a project; a folder that holds one is
 * refused by the server with a message, which the dialog shows.
 */
export function rowActions(entry: DirectoryEntry, canEdit: boolean): RowActions {
	if (!canEdit) return { available: false, rename: { enabled: false }, delete: { enabled: false } };
	if (entry.projectId !== undefined) {
		const reason = "This folder is a project. Remove the project first.";
		return { available: true, rename: { enabled: false, reason }, delete: { enabled: false, reason } };
	}
	return { available: true, rename: { enabled: true }, delete: { enabled: true } };
}

export type DeleteConfirmation = {
	title: string;
	message: string;
	confirmLabel: string;
};

/** The delete dialog's words. Only an empty folder can be deleted, so a plain confirmation is enough. */
export function deleteConfirmation(entry: DirectoryEntry): DeleteConfirmation {
	return {
		title: `Delete “${entry.name}”?`,
		message: "Only an empty folder can be deleted here. A folder with anything inside is refused and stays as it is.",
		confirmLabel: "Delete folder",
	};
}

// --- keyboard ------------------------------------------------------------------------------------------------------

export type PickerKey = "ArrowDown" | "ArrowUp" | "Home" | "End" | "Backspace" | "Escape";

export type KeyContext = {
	/** Where the key was pressed: the text field or a row's buttons. */
	focus: "field" | "row";
	/** The field's text. */
	text: string;
	/** Rows shown. */
	rows: number;
	/** The focused row, or -1 in the field. */
	index: number;
};

export type KeyAction =
	| { kind: "focus-row"; index: number }
	| { kind: "focus-field" }
	| { kind: "go-up" }
	| { kind: "clear" }
	| { kind: "close" }
	| { kind: "none" };

/**
 * What a key does. Arrows move the real focus between the field and the rows (so the focus ring shows); Backspace in
 * an empty field, or on a row, goes up a folder; Escape clears the field and only then closes.
 */
export function keyAction(key: string, context: KeyContext): KeyAction {
	const { focus, text, rows, index } = context;
	switch (key) {
		case "ArrowDown":
			if (rows === 0) return { kind: "none" };
			if (focus === "field") return { kind: "focus-row", index: 0 };
			return { kind: "focus-row", index: Math.min(rows - 1, index + 1) };
		case "ArrowUp":
			if (focus === "field") return { kind: "none" };
			return index <= 0 ? { kind: "focus-field" } : { kind: "focus-row", index: index - 1 };
		case "Home":
			return focus === "row" && rows > 0 ? { kind: "focus-row", index: 0 } : { kind: "none" };
		case "End":
			return focus === "row" && rows > 0 ? { kind: "focus-row", index: rows - 1 } : { kind: "none" };
		case "Backspace":
			if (focus === "row") return { kind: "go-up" };
			return text === "" ? { kind: "go-up" } : { kind: "none" };
		case "Escape":
			return text === "" ? { kind: "close" } : { kind: "clear" };
		default:
			return { kind: "none" };
	}
}

// --- quick places --------------------------------------------------------------------------------------------------

export type QuickPlace = {
	label: string;
	path: string;
	kind: "home" | "project-parent" | "recent";
};

/** How many recent picks a device keeps per backend, and how many it offers. */
export const RECENT_PICKS_LIMIT = 8;

function parentOf(path: string): string | undefined {
	const index = path.lastIndexOf("/");
	if (index < 0) return undefined;
	return index === 0 ? "/" : path.slice(0, index);
}

/**
 * Home, then the parent folders of the added projects (each once), then recent picks; a path appears once, under its
 * first reason. Labels write the home directory as `~`.
 */
export function quickPlaces(input: {
	home: string;
	projectPaths: readonly string[];
	recent: readonly string[];
}): QuickPlace[] {
	const { home } = input;
	const places: QuickPlace[] = [{ label: "Home", path: home, kind: "home" }];
	const seen = new Set<string>([home]);
	const add = (path: string, kind: QuickPlace["kind"]) => {
		if (seen.has(path)) return;
		seen.add(path);
		places.push({ label: shortPath(path, home), path, kind });
	};
	const parents = input.projectPaths
		.map(parentOf)
		.filter((path): path is string => path !== undefined)
		.sort(compareFolderNames);
	for (const path of parents) add(path, "project-parent");
	for (const path of input.recent) add(path, "recent");
	return places;
}

// --- what the device remembers ------------------------------------------------------------------------------------

export const FOLDER_PICKER_STORAGE_KEY = "aiki.folder-picker.v1";

export type BackendPickerMemory = {
	/** The folder the picker last showed, where it starts next time. */
	last?: string;
	/** Folders used as a project, newest first. */
	recent: string[];
};

export type PickerMemory = Record<string, BackendPickerMemory>;

export function readPickerMemory(storage: Pick<Storage, "getItem"> | undefined = browserStorage()): PickerMemory {
	if (storage === undefined) return {};
	try {
		const parsed: unknown = JSON.parse(storage.getItem(FOLDER_PICKER_STORAGE_KEY) ?? "{}");
		if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
		const memory: PickerMemory = {};
		for (const [backendId, value] of Object.entries(parsed)) {
			if (typeof value !== "object" || value === null) continue;
			const record = value as { last?: unknown; recent?: unknown };
			const recent = Array.isArray(record.recent)
				? record.recent.filter((path): path is string => typeof path === "string" && path.startsWith("/"))
				: [];
			memory[backendId] = {
				...(typeof record.last === "string" && record.last.startsWith("/") ? { last: record.last } : {}),
				recent: recent.slice(0, RECENT_PICKS_LIMIT),
			};
		}
		return memory;
	} catch {
		return {};
	}
}

export function writePickerMemory(
	memory: PickerMemory,
	storage: Pick<Storage, "setItem"> | undefined = browserStorage(),
): void {
	if (storage === undefined) return;
	try {
		storage.setItem(FOLDER_PICKER_STORAGE_KEY, JSON.stringify(memory));
	} catch {
		// Storage can be full or disabled; the picker just starts at Home next time.
	}
}

/** The memory with `path` as the backend's last folder. */
export function withLastFolder(memory: PickerMemory, backendId: string, path: string): PickerMemory {
	const current = memory[backendId] ?? { recent: [] };
	return { ...memory, [backendId]: { ...current, last: path } };
}

/** The memory with `path` newest among the backend's recent picks, once, capped. */
export function withRecentPick(memory: PickerMemory, backendId: string, path: string): PickerMemory {
	const current = memory[backendId] ?? { recent: [] };
	const recent = [path, ...current.recent.filter((entry) => entry !== path)].slice(0, RECENT_PICKS_LIMIT);
	return { ...memory, [backendId]: { ...current, recent } };
}

/** The memory without a folder that turned out not to exist any more. */
export function withoutFolder(memory: PickerMemory, backendId: string, path: string): PickerMemory {
	const current = memory[backendId];
	if (current === undefined) return memory;
	const { last, ...rest } = current;
	return {
		...memory,
		[backendId]: { ...rest, ...(last === undefined || last === path ? {} : { last }), recent: current.recent.filter((entry) => entry !== path) },
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
