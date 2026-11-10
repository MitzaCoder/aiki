/**
 * The `artifact_save` tool: every conversation of a project — the coordinator, its workers, and scripts either runs in
 * code mode — keeps a file for the user by copying it into the project's artifact store (`artifacts.ts`).
 *
 * What it may read: a regular file under the calling conversation's cwd, the project directory or the system temp
 * directory (where browsers and screen recorders usually leave their output), after symlinks are resolved. Nothing in
 * the data directory except the project's own worker workspaces, so credentials and secrets cannot become artifacts.
 *
 * Replay: the artifact ID is memoized before the copy, so a rerun after a restart finds the row the first run saved
 * instead of saving the file twice.
 */
import type { Context } from "@earendil-works/chord/context";
import { type Extension, type ToolRegistration, defineExtension, defineTool } from "@earendil-works/pi-durable";
import { MAIN_THREAD_ID } from "@mihai-harness/protocol";
import { constants } from "node:fs";
import { access, realpath, stat } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { Type } from "typebox";
import { type ArtifactStore, newArtifactId } from "./artifacts.ts";
import { errorMessage } from "./errors.ts";
import type { Project } from "./projects.ts";

export const ARTIFACT_SAVE_TOOL = "artifact_save";
export const ARTIFACT_EXTENSION = "artifact-tools";

/**
 * Fixed text (it sits in the tool description, so prompts stay byte-stable) that tells the model how to tag media. The
 * app groups a task's photos and videos by tag and pairs `before` with `after` for its compare slide.
 */
export const ARTIFACT_TAG_GUIDANCE =
	"Tag screenshots and videos by platform and state with `tags`: short lowercase words such as web, android, phone, " +
	"desktop, tablet, dark, light, before, after (free-form; use others when they fit). A web screenshot of the phone " +
	"layout in dark mode is `web, phone, dark`; give a before/after pair the same tags except `before` and `after`. " +
	"The app filters a task's media by tag and compares a before with its after.";

export type ArtifactToolsOptions = {
	store: ArtifactStore;
	project: () => Project;
	/**
	 * The parts of the data directory a save may read from: main's worker workspaces and the background threads'
	 * directories (their checkouts and their workers' workspaces).
	 */
	workspaceDirs: string[];
	/** The worker a conversation is, or null for a coordinator (and any other conversation). */
	workerIdOf: (conversationId: number) => Promise<string | null>;
	/** The thread a conversation belongs to, a worker's being its coordinator's; main when not given. */
	threadIdOf?: (conversationId: number) => Promise<string>;
};

/** Whether `path` is `root` or inside it. Both must already be real paths. */
function isWithin(path: string, root: string): boolean {
	const rel = relative(root, path);
	return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel));
}

async function realOrUndefined(path: string): Promise<string | undefined> {
	return realpath(path).catch(() => undefined);
}

/**
 * The real path of a file `artifact_save` may copy, or the reason it may not. `path` is absolute or relative to `cwd`;
 * `~/` is the server user's home.
 */
export async function resolveArtifactSource(options: {
	path: string;
	cwd: string;
	projectPath: string;
	dataDir: string;
	workspaceDirs: string[];
}): Promise<{ ok: true; path: string } | { ok: false; message: string }> {
	const expanded = options.path === "~" || options.path.startsWith("~/") ? homedir() + options.path.slice(1) : options.path;
	const requested = isAbsolute(expanded) ? resolve(expanded) : resolve(options.cwd, expanded);
	const real = await realOrUndefined(requested);
	if (real === undefined) return { ok: false, message: `${requested} does not exist.` };
	const info = await stat(real);
	if (info.isDirectory()) return { ok: false, message: `${requested} is a directory; save the files in it one by one, or an archive of it.` };
	if (!info.isFile()) return { ok: false, message: `${requested} is not a regular file.` };

	const roots = (await Promise.all([options.cwd, options.projectPath, tmpdir()].map(realOrUndefined))).filter(
		(root): root is string => root !== undefined,
	);
	const dataDir = await realOrUndefined(options.dataDir);
	const workspaces = (await Promise.all(options.workspaceDirs.map(realOrUndefined))).filter(
		(root): root is string => root !== undefined,
	);
	const inDataDir = dataDir !== undefined && isWithin(real, dataDir);
	const inWorkspaces = workspaces.some((root) => isWithin(real, root));
	if (!roots.some((root) => isWithin(real, root)) || (inDataDir && !inWorkspaces)) {
		return {
			ok: false,
			message: `${requested} is outside the paths an artifact may come from: this conversation's working directory, the project directory and ${tmpdir()}.`,
		};
	}
	try {
		await access(real, constants.R_OK);
	} catch {
		return { ok: false, message: `${requested} is not readable.` };
	}
	return { ok: true, path: real };
}

function formatBytes(size: number): string {
	if (size < 1024) return `${size} B`;
	const units = ["KiB", "MiB", "GiB"];
	let value = size / 1024;
	let unit = 0;
	while (value >= 1024 && unit < units.length - 1) {
		value /= 1024;
		unit += 1;
	}
	return `${value.toFixed(value < 10 ? 1 : 0)} ${units[unit]}`;
}

function toolText(text: string, isError = false, details?: { artifactId: string }) {
	return {
		output: [{ type: "text" as const, text }],
		...(isError ? { isError: true } : {}),
		...(details === undefined ? {} : { details }),
	};
}

export function createArtifactExtension(options: ArtifactToolsOptions): Extension {
	const threadIdOf = options.threadIdOf ?? (async () => MAIN_THREAD_ID);
	const saveTool = defineTool({
		name: ARTIFACT_SAVE_TOOL,
		description:
			"Keep a file for the user as an artifact: a demo video, screenshot, log or report they can open in the app " +
			"(videos play, images and text show inline). Copies the file (it stays where it is) into the project's " +
			"artifact store on this backend. `path` is relative to your working directory or absolute; it must be a file " +
			"under your working directory, the project directory or the temp directory. Give `taskId` when it is evidence " +
			"for a board task. " +
			ARTIFACT_TAG_GUIDANCE,
		parameters: Type.Object({
			path: Type.String({ minLength: 1, description: "The file to keep." }),
			title: Type.Optional(Type.String({ minLength: 1, description: "What it shows, in a few words." })),
			note: Type.Optional(Type.String({ minLength: 1, description: "Longer description, Markdown." })),
			taskId: Type.Optional(Type.String({ minLength: 1, description: "The board task it is evidence for, e.g. T3." })),
			tags: Type.Optional(
				Type.Array(Type.String({ minLength: 1 }), {
					maxItems: 100,
					description: "Short lowercase words: platform, form factor, theme, before/after. E.g. [\"web\", \"phone\", \"dark\"].",
				}),
			),
		}),
		// The ID is memoized before the copy, so a rerun returns the first run's artifact.
		replay: "safe",
		execute: async (args, api, context: Context) => {
			const project = options.project();
			try {
				const agent = await api.agent(context);
				const source = await resolveArtifactSource({
					path: args.path,
					cwd: agent.cwd ?? project.path,
					projectPath: project.path,
					dataDir: options.store.dataDir,
					workspaceDirs: options.workspaceDirs,
				});
				if (!source.ok) return toolText(source.message, true);
				const artifactId = await api.memo<string>("artifactId", newArtifactId(api.now()), context);
				const artifact = await options.store.save({
					projectId: project.id,
					sourcePath: source.path,
					title: args.title ?? null,
					note: args.note ?? null,
					threadId: await threadIdOf(api.conversationId),
					workerId: await options.workerIdOf(api.conversationId),
					taskId: args.taskId ?? null,
					...(args.tags === undefined ? {} : { tags: args.tags }),
					artifactId,
				});
				const duration = artifact.durationSeconds === null ? "" : `, ${artifact.durationSeconds.toFixed(1)} s`;
				const tags = artifact.tags === undefined || artifact.tags.length === 0 ? "" : `, tags ${artifact.tags.join(", ")}`;
				return toolText(
					`Saved artifact ${artifact.id}: ${artifact.name} (${artifact.kind}, ${formatBytes(artifact.size)}${duration}${tags}).`,
					false,
					{ artifactId: artifact.id },
				);
			} catch (error) {
				return toolText(`Saving the artifact failed: ${errorMessage(error)}`, true);
			}
		},
	});
	return defineExtension({ name: ARTIFACT_EXTENSION, tools: [saveTool] as ToolRegistration[] });
}
