/**
 * Listing host subdirectories for the web app's folder picker. The browser cannot see host paths, so the server lists
 * them: only directories, hidden ones on request, repos marked, already-added projects identified, and unreadable
 * directories reported as an error instead of an empty listing.
 */
import { readdir, realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join } from "node:path";
import { COMPLETION_LIMIT, type DirectoryEntry } from "@kemiri/protocol";
import { ServerError } from "./errors.ts";

/** A directory with more subdirectories than this lists the first ones and says so. Keeps a phone responsive. */
export const DIRECTORY_ENTRY_LIMIT = 500;

export type DirectoryListing = {
	/** The listed directory, symlinks resolved. */
	path: string;
	/** The directory above, or null at the filesystem root. */
	parent: string | null;
	home: string;
	projectId?: string;
	entries: DirectoryEntry[];
	truncated: boolean;
};

export type ListDirectoryOptions = {
	/** Absolute host directory. Default: the server user's home directory. */
	path?: string;
	showHidden?: boolean;
	/** Canonical paths of the projects already added, mapped to their IDs. */
	projects?: ReadonlyMap<string, string>;
	limit?: number;
	/** Default `homedir()`. Overridable for tests. */
	home?: string;
};

function fail(error: unknown, path: string): never {
	const code = (error as NodeJS.ErrnoException).code;
	if (code === "ENOENT") throw new ServerError("invalid_path", `No such directory: ${path}`);
	if (code === "ENOTDIR") throw new ServerError("invalid_path", `Not a directory: ${path}`);
	if (code === "EACCES" || code === "EPERM") {
		throw new ServerError("permission_denied", `Cannot read the directory ${path}: permission denied`);
	}
	throw error;
}

/** Which repo marker the directory has, if any; both can be files (worktrees, submodules). `.jj` wins over `.git`. */
async function repoKindOf(path: string): Promise<"git" | "jj" | undefined> {
	for (const [marker, kind] of [
		[".jj", "jj"],
		[".git", "git"],
	] as const) {
		const info = await stat(join(path, marker)).catch(() => undefined);
		if (info !== undefined) return kind;
	}
	return undefined;
}

/**
 * One listed folder: its repo marker, last-modified time and the project already added for it. `canonical` is the
 * folder's symlink-free path, the key of `projects`.
 */
export async function describeDirectory(
	entryPath: string,
	name: string,
	canonical: string,
	projects: ReadonlyMap<string, string>,
): Promise<DirectoryEntry> {
	const projectId = projects.get(canonical) ?? projects.get(entryPath);
	const [repoKind, info] = await Promise.all([repoKindOf(entryPath), stat(entryPath).catch(() => undefined)]);
	return {
		name,
		path: entryPath,
		isRepo: repoKind !== undefined,
		...(repoKind === undefined ? {} : { repoKind }),
		...(info === undefined ? {} : { modifiedAt: info.mtime.toISOString() }),
		...(projectId === undefined ? {} : { projectId }),
	};
}

export function compareNames(left: string, right: string): number {
	return left.localeCompare(right, undefined, { numeric: true, sensitivity: "base" }) || left.localeCompare(right);
}

export async function listDirectory(options: ListDirectoryOptions = {}): Promise<DirectoryListing> {
	const home = options.home ?? homedir();
	const requested = options.path ?? home;
	if (!isAbsolute(requested)) throw new ServerError("invalid_path", `Path must be absolute: ${requested}`);

	const path = await realpath(requested).catch((error: unknown) => fail(error, requested));
	const info = await stat(path).catch((error: unknown) => fail(error, requested));
	if (!info.isDirectory()) throw new ServerError("invalid_path", `Not a directory: ${requested}`);

	const dirents = await readdir(path, { withFileTypes: true }).catch((error: unknown) => fail(error, requested));
	const showHidden = options.showHidden === true;
	const names = dirents
		.filter((dirent) => showHidden || !dirent.name.startsWith("."))
		.map((dirent) => ({ name: dirent.name, symbolicLink: dirent.isSymbolicLink(), directory: dirent.isDirectory() }))
		.filter((entry) => entry.directory || entry.symbolicLink)
		.sort((left, right) => compareNames(left.name, right.name));

	const limit = options.limit ?? DIRECTORY_ENTRY_LIMIT;
	const visible = names.slice(0, limit);
	const projects = options.projects ?? new Map<string, string>();

	const entries = await Promise.all(
		visible.map(async (entry): Promise<DirectoryEntry | undefined> => {
			const entryPath = join(path, entry.name);
			// A symlink to a directory is listed under its own name; a broken one or a file is skipped.
			let canonical = entryPath;
			if (entry.symbolicLink) {
				canonical = await realpath(entryPath).catch(() => "");
				if (canonical === "") return undefined;
				const target = await stat(canonical).catch(() => undefined);
				if (target === undefined || !target.isDirectory()) return undefined;
			}
			return describeDirectory(entryPath, entry.name, canonical, projects);
		}),
	);

	const parent = dirname(path);
	const projectId = projects.get(path);
	return {
		path,
		parent: parent === path ? null : parent,
		home,
		...(projectId === undefined ? {} : { projectId }),
		entries: entries.filter((entry): entry is DirectoryEntry => entry !== undefined),
		truncated: names.length > visible.length,
	};
}

export type CompleteDirectoryOptions = {
	/** What the user typed: an absolute path or `~…`; the last segment may be part of a folder name. */
	input: string;
	showHidden?: boolean;
	projects?: ReadonlyMap<string, string>;
	/** Default `homedir()`. Overridable for tests. */
	home?: string;
};

export type DirectoryCompletion = {
	directory: string | null;
	exact: string | null;
	entries: DirectoryEntry[];
	truncated: boolean;
};

/** `~` and `~/x` mean the home directory; anything else is returned as it is. */
export function expandHome(input: string, home: string): string {
	if (input === "~") return home;
	if (input.startsWith("~/")) return join(home, input.slice(2)) + (input.endsWith("/") && input.length > 2 ? "/" : "");
	return input;
}

async function directoryAt(path: string): Promise<string | null> {
	const resolved = await realpath(path).catch(() => undefined);
	if (resolved === undefined) return null;
	const info = await stat(resolved).catch(() => undefined);
	return info?.isDirectory() === true ? resolved : null;
}

/**
 * The folders a typed path could continue to. `/a/b/` lists everything in `/a/b`; `/a/b/Pr` the folders there whose
 * name starts with `Pr` (case-insensitive). Missing or unreadable folders give no matches rather than an error: the
 * user is still typing.
 */
export async function completeDirectory(options: CompleteDirectoryOptions): Promise<DirectoryCompletion> {
	const home = options.home ?? homedir();
	const input = expandHome(options.input, home);
	if (!isAbsolute(input)) throw new ServerError("invalid_path", `Path must start with / or ~: ${options.input}`);

	const endsWithSlash = input.endsWith("/");
	const exact = await directoryAt(input);
	const directoryPath = endsWithSlash ? input : dirname(input);
	const prefix = endsWithSlash ? "" : basename(input);
	const directory = await directoryAt(directoryPath);
	if (directory === null) return { directory: null, exact, entries: [], truncated: false };

	const dirents = await readdir(directory, { withFileTypes: true }).catch(() => []);
	const lowered = prefix.toLowerCase();
	const showHidden = options.showHidden === true || prefix.startsWith(".");
	const matches = dirents
		.filter((dirent) => (dirent.isDirectory() || dirent.isSymbolicLink()) && (showHidden || !dirent.name.startsWith(".")))
		.filter((dirent) => dirent.name.toLowerCase().startsWith(lowered))
		.sort((left, right) => compareNames(left.name, right.name));

	const projects = options.projects ?? new Map<string, string>();
	const described = await Promise.all(
		matches.map(async (dirent): Promise<DirectoryEntry | undefined> => {
			const entryPath = join(directory, dirent.name);
			const canonical = await directoryAt(entryPath);
			if (canonical === null) return undefined;
			return describeDirectory(entryPath, dirent.name, canonical, projects);
		}),
	);
	const entries = described.filter((entry): entry is DirectoryEntry => entry !== undefined);
	// Repos first, like a listing, so the first match is the likeliest one.
	entries.sort((left, right) => Number(right.isRepo) - Number(left.isRepo) || compareNames(left.name, right.name));
	return { directory, exact, entries: entries.slice(0, COMPLETION_LIMIT), truncated: entries.length > COMPLETION_LIMIT };
}
