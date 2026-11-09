/**
 * Making, renaming and deleting folders for the web app's folder picker. The picker works on the user's real folders,
 * so every change goes through the same checks: a valid, free name; never a folder that is an added project or holds
 * one; never the filesystem root, the home directory (or a folder above it) or the harness's own data directory; never
 * a symlink (it is not the folder); and only an empty folder may be deleted.
 */
import { lstat, mkdir, readdir, realpath, rename, rmdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import { type DirectoryEntry, validateFolderName } from "@mihai-harness/protocol";
import { describeDirectory } from "./directory-listing.ts";
import { ServerError } from "./errors.ts";

export type EditDirectoryOptions = {
	/** Canonical paths of the projects already added, mapped to their IDs. */
	projects?: ReadonlyMap<string, string>;
	/** The harness's data directory; never renamed or deleted, nor anything above it. */
	dataDir?: string;
	/** Default `homedir()`. Overridable for tests. */
	home?: string;
};

type Operation = "create" | "rename" | "delete";

const VERB: Record<Operation, string> = { create: "create a folder in", rename: "rename", delete: "delete" };

function describeError(error: unknown, operation: Operation, path: string): never {
	if (error instanceof ServerError) throw error;
	const code = (error as NodeJS.ErrnoException).code;
	if (code === "EACCES" || code === "EPERM" || code === "EROFS") {
		throw new ServerError("permission_denied", `Cannot ${VERB[operation]} ${path}: permission denied`);
	}
	if (code === "ENOENT") throw new ServerError("invalid_path", `No such folder: ${path}`);
	if (code === "ENOTDIR") throw new ServerError("invalid_path", `Not a folder: ${path}`);
	if (code === "EEXIST") throw new ServerError("invalid_path", `${path} already exists.`);
	if (code === "ENOTEMPTY") throw new ServerError("invalid_path", `${path} is not empty.`);
	const reason = error instanceof Error ? error.message : String(error);
	throw new ServerError("invalid_path", `Could not ${VERB[operation]} ${path}: ${reason}`);
}

function isInside(path: string, ancestor: string): boolean {
	return path === ancestor || path.startsWith(ancestor.endsWith("/") ? ancestor : `${ancestor}/`);
}

function cleanName(name: string): string {
	const problem = validateFolderName(name);
	if (problem !== undefined) throw new ServerError("invalid_path", problem);
	return name.trim();
}

/** The canonical parent plus the folder's own name, so a symlinked parent is fine but the folder itself is not followed. */
async function locate(path: string, operation: Operation): Promise<{ parent: string; name: string; path: string }> {
	if (!isAbsolute(path)) throw new ServerError("invalid_path", `Path must be absolute: ${path}`);
	const parent = await realpath(dirname(path)).catch((error: unknown) => describeError(error, operation, path));
	const name = path === "/" ? "" : path.slice(path.lastIndexOf("/") + 1);
	if (name === "" || name === "." || name === "..") {
		throw new ServerError("invalid_path", `Cannot ${VERB[operation]} ${path}: it is not an ordinary folder.`);
	}
	return { parent, name, path: join(parent, name) };
}

/** The folder must be a real directory, not a symlink, and not something the harness depends on. */
async function checkChangeable(
	target: { path: string; name: string },
	operation: Exclude<Operation, "create">,
	options: EditDirectoryOptions,
): Promise<void> {
	const info = await lstat(target.path).catch((error: unknown) => describeError(error, operation, target.path));
	if (info.isSymbolicLink()) {
		throw new ServerError(
			"invalid_path",
			`"${target.name}" is a link to another folder. Change the link in a terminal; the picker only changes real folders.`,
		);
	}
	if (!info.isDirectory()) throw new ServerError("invalid_path", `"${target.name}" is not a folder.`);

	const action = operation === "delete" ? "deleted" : "renamed";
	const home = options.home ?? homedir();
	if (target.path === "/") throw new ServerError("invalid_path", `The filesystem root cannot be ${action}.`);
	if (isInside(home, target.path)) {
		throw new ServerError("invalid_path", `"${target.name}" is or holds the home folder, so it cannot be ${action}.`);
	}
	if (options.dataDir !== undefined && isInside(await realpath(options.dataDir).catch(() => options.dataDir ?? ""), target.path)) {
		throw new ServerError("invalid_path", `"${target.name}" holds the harness's own data, so it cannot be ${action}.`);
	}
	for (const [projectPath] of options.projects ?? []) {
		if (projectPath === target.path) {
			throw new ServerError(
				"invalid_path",
				`"${target.name}" is an added project, so it cannot be ${action}. Remove the project first.`,
			);
		}
		if (isInside(projectPath, target.path)) {
			throw new ServerError(
				"invalid_path",
				`"${target.name}" contains a project (${projectPath}), so it cannot be ${action}.`,
			);
		}
	}
}

/**
 * Only an empty folder may be deleted (decided by the user; no recursive delete, no trash). `rmdir` itself refuses a
 * folder with anything inside, hidden files included; this check words the refusal before trying.
 */
async function checkEmpty(target: { path: string; name: string }): Promise<void> {
	const contents = await readdir(target.path).catch((error: unknown) => describeError(error, "delete", target.path));
	if (contents.length > 0) {
		const count = `${contents.length} item${contents.length === 1 ? "" : "s"}`;
		throw new ServerError("invalid_path", `This folder is not empty: "${target.name}" has ${count} inside. Only an empty folder can be deleted.`);
	}
}

async function entryFor(path: string, name: string, projects: ReadonlyMap<string, string>): Promise<DirectoryEntry> {
	return describeDirectory(path, name, path, projects);
}

/** Make a folder called `name` in `parent`. */
export async function createDirectory(parent: string, name: string, options: EditDirectoryOptions = {}): Promise<DirectoryEntry> {
	const clean = cleanName(name);
	const directory = await realpath(parent).catch((error: unknown) => describeError(error, "create", parent));
	const info = await stat(directory).catch((error: unknown) => describeError(error, "create", parent));
	if (!info.isDirectory()) throw new ServerError("invalid_path", `Not a folder: ${parent}`);
	const path = join(directory, clean);
	if (await lstat(path).then(() => true, () => false)) {
		throw new ServerError("invalid_path", `"${clean}" already exists in ${directory}.`);
	}
	// Not recursive: a failure must not leave a half-made tree.
	await mkdir(path).catch((error: unknown) => describeError(error, "create", directory));
	return entryFor(path, clean, options.projects ?? new Map());
}

/** Rename the folder at `path` to `name` within the same parent. */
export async function renameDirectory(path: string, name: string, options: EditDirectoryOptions = {}): Promise<DirectoryEntry> {
	const clean = cleanName(name);
	const target = await locate(path, "rename");
	await checkChangeable(target, "rename", options);
	if (clean === target.name) throw new ServerError("invalid_path", `It is already called "${clean}".`);
	const next = join(target.parent, clean);
	const existing = await lstat(next).catch(() => undefined);
	if (existing !== undefined) {
		// A case-only rename on a case-insensitive filesystem finds the folder itself; that one is allowed.
		const own = await lstat(target.path);
		if (existing.ino !== own.ino || existing.dev !== own.dev) {
			throw new ServerError("invalid_path", `"${clean}" already exists in ${target.parent}.`);
		}
	}
	// `rename(2)` replaces an empty folder silently, which is why the name was checked above.
	await rename(target.path, next).catch((error: unknown) => describeError(error, "rename", target.path));
	return entryFor(next, clean, options.projects ?? new Map());
}

/** Delete the empty folder at `path`. */
export async function deleteDirectory(path: string, options: EditDirectoryOptions = {}): Promise<string> {
	const target = await locate(path, "delete");
	await checkChangeable(target, "delete", options);
	await checkEmpty(target);
	await rmdir(target.path).catch((error: unknown) => describeError(error, "delete", target.path));
	return target.path;
}
