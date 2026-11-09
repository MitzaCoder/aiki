/** Browsing host directories, so a client can pick a project folder without typing a path. */
import { type Static, Type } from "typebox";
import { RequestIdSchema } from "./common.ts";

/** One subdirectory of a listed directory. Files are not listed: a project is a directory. */
export const DirectoryEntrySchema = Type.Object({
	name: Type.String({ description: "The directory's own name, without its parent path." }),
	path: Type.String({ description: "Absolute host path, as joined from the listed directory." }),
	isRepo: Type.Boolean({ description: "The directory has a `.git` or `.jj` entry." }),
	repoKind: Type.Optional(
		Type.Union([Type.Literal("git"), Type.Literal("jj")], {
			description: 'Which marker: "jj" when there is a `.jj` entry (also when `.git` is there too), else "git". Absent on older servers.',
		}),
	),
	modifiedAt: Type.Optional(
		Type.String({ description: "When the directory was last modified, ISO 8601. Absent on older servers." }),
	),
	projectId: Type.Optional(
		Type.String({ minLength: 1, description: "The project already added for this directory, if any." }),
	),
});
export type DirectoryEntry = Static<typeof DirectoryEntrySchema>;

/**
 * List the subdirectories of one host directory. Without `path` the listing starts at the server user's home
 * directory, which is also where a picker should start. A directory the server cannot read answers with
 * `permission_denied`; the client keeps whatever it showed and displays the error.
 */
export const FilesystemListRequestSchema = Type.Object({
	type: Type.Literal("filesystem.list"),
	id: RequestIdSchema,
	path: Type.Optional(
		Type.String({
			minLength: 1,
			description: "Absolute host directory. Default: the server user's home directory. Symlinks are resolved.",
		}),
	),
	showHidden: Type.Optional(
		Type.Boolean({ description: "Include directories whose name starts with a dot. Default false." }),
	),
});
export type FilesystemListRequest = Static<typeof FilesystemListRequestSchema>;

export const FilesystemListResponseSchema = Type.Object({
	type: Type.Literal("filesystem.list"),
	id: RequestIdSchema,
	path: Type.String({ description: "The listed directory, with symlinks resolved." }),
	parent: Type.Union([Type.String(), Type.Null()], {
		description: "The parent directory to go up to, or null at the filesystem root.",
	}),
	home: Type.String({ description: "The server user's home directory, so a client can offer it as a shortcut." }),
	projectId: Type.Optional(
		Type.String({ minLength: 1, description: "The project already added for the listed directory itself, if any." }),
	),
	entries: Type.Array(DirectoryEntrySchema, { description: "Subdirectories, sorted by name." }),
	truncated: Type.Boolean({ description: "The directory has more subdirectories than this listing returns." }),
});
export type FilesystemListResponse = Static<typeof FilesystemListResponseSchema>;

/** The most matches one `filesystem.complete` answer carries. */
export const COMPLETION_LIMIT = 30;

/**
 * Complete a typed path. `input` is an absolute path or starts with `~` (the server user's home); the last segment is
 * a prefix of a folder name, so `/home/me/Pro` lists the folders in `/home/me` that start with `Pro` and `/home/me/`
 * lists all of them. A folder that does not exist is not an error, it just has no matches. Needs `filesystem-complete`.
 */
export const FilesystemCompleteRequestSchema = Type.Object({
	type: Type.Literal("filesystem.complete"),
	id: RequestIdSchema,
	input: Type.String({ description: "Absolute path or `~…`; the last segment may be a partial folder name." }),
	showHidden: Type.Optional(
		Type.Boolean({ description: "Offer dot folders even when the prefix does not start with a dot. Default false." }),
	),
});
export type FilesystemCompleteRequest = Static<typeof FilesystemCompleteRequestSchema>;

export const FilesystemCompleteResponseSchema = Type.Object({
	type: Type.Literal("filesystem.complete"),
	id: RequestIdSchema,
	directory: Type.Union([Type.String(), Type.Null()], {
		description: "The existing folder the matches are in (symlinks resolved), or null when it does not exist.",
	}),
	exact: Type.Union([Type.String(), Type.Null()], {
		description: "The folder `input` names itself (symlinks resolved), or null when it is not an existing folder.",
	}),
	entries: Type.Array(DirectoryEntrySchema, {
		description: `Matching folders, repos first then by name, at most ${COMPLETION_LIMIT}.`,
	}),
	truncated: Type.Boolean({ description: "More folders matched than `entries` carries." }),
});
export type FilesystemCompleteResponse = Static<typeof FilesystemCompleteResponseSchema>;

/** The longest folder name `filesystem.create` and `filesystem.rename` accept, in UTF-8 bytes. */
export const FOLDER_NAME_MAX_BYTES = 255;

/**
 * Why a folder name is not acceptable, in words for the user, or undefined when it is. The server checks the same
 * rules (and that the name is free); a client uses it to answer before sending.
 */
export function validateFolderName(name: string): string | undefined {
	const trimmed = name.trim();
	if (trimmed === "") return "Give the folder a name.";
	if (trimmed === "." || trimmed === "..") return `"${trimmed}" is not a usable folder name.`;
	if (trimmed.includes("/")) return "A folder name cannot contain a slash.";
	if (trimmed.includes("\0")) return "A folder name cannot contain a null character.";
	if (new TextEncoder().encode(trimmed).length > FOLDER_NAME_MAX_BYTES) return "That name is too long.";
	return undefined;
}

/** Make a folder in `path`. The name must pass `validateFolderName` and be free. Needs `filesystem-edit`. */
export const FilesystemCreateRequestSchema = Type.Object({
	type: Type.Literal("filesystem.create"),
	id: RequestIdSchema,
	path: Type.String({ minLength: 1, description: "Absolute host directory to create the folder in." }),
	name: Type.String({ description: "The new folder's name (not a path)." }),
});
export type FilesystemCreateRequest = Static<typeof FilesystemCreateRequestSchema>;

export const FilesystemCreateResponseSchema = Type.Object({
	type: Type.Literal("filesystem.create"),
	id: RequestIdSchema,
	entry: DirectoryEntrySchema,
});
export type FilesystemCreateResponse = Static<typeof FilesystemCreateResponseSchema>;

/**
 * Rename a folder within its parent. Refused when the folder is an added project or contains one, is a symlink, is
 * the root, the home directory (or an ancestor of it) or the data directory, or when the new name is taken.
 * Needs `filesystem-edit`.
 */
export const FilesystemRenameRequestSchema = Type.Object({
	type: Type.Literal("filesystem.rename"),
	id: RequestIdSchema,
	path: Type.String({ minLength: 1, description: "Absolute path of the folder to rename." }),
	name: Type.String({ description: "The new name (not a path)." }),
});
export type FilesystemRenameRequest = Static<typeof FilesystemRenameRequestSchema>;

export const FilesystemRenameResponseSchema = Type.Object({
	type: Type.Literal("filesystem.rename"),
	id: RequestIdSchema,
	entry: DirectoryEntrySchema,
});
export type FilesystemRenameResponse = Static<typeof FilesystemRenameResponseSchema>;

/**
 * Delete an empty folder. A folder with anything inside (hidden files too) is refused with "This folder is not
 * empty"; there is no recursive delete and no trash. Refused for the same folders as `filesystem.rename`. Needs `filesystem-edit`.
 */
export const FilesystemDeleteRequestSchema = Type.Object({
	type: Type.Literal("filesystem.delete"),
	id: RequestIdSchema,
	path: Type.String({ minLength: 1, description: "Absolute path of the folder to delete." }),
});
export type FilesystemDeleteRequest = Static<typeof FilesystemDeleteRequestSchema>;

export const FilesystemDeleteResponseSchema = Type.Object({
	type: Type.Literal("filesystem.delete"),
	id: RequestIdSchema,
	path: Type.String({ description: "The deleted folder's path." }),
});
export type FilesystemDeleteResponse = Static<typeof FilesystemDeleteResponseSchema>;
