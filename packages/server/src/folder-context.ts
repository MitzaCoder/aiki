/**
 * Gives `read`, `edit` and `write` the AGENTS.md (or CLAUDE.md, pi's own fallback) of the folders they actually work
 * in, not only the ones the system prompt already carries from the filesystem root down to the conversation's cwd
 * (`context.ts`): a project that keeps rules in subfolders — `services/python/harness/AGENTS.md`,
 * `.claude/reference/testing.md` referenced from one — leaves a worker to `cat` them itself, and a stray missing path
 * at the end of a chained command turns an otherwise useful call red.
 *
 * A worker often touches a file outside its own cwd too — on the VM a worker's cwd is its own worktree while the
 * conversation's files may sit in a different clone's cache directory entirely. There the cwd's own root-to-cwd chain
 * says nothing about the file, so this walks instead from the nearest ancestor repository root (the nearest `.git` or
 * `.jj`) down to the file's folder, root included; a file with no ancestor repository gets nothing attached.
 *
 * Attached in the tool result, once per conversation and folder, never in the system prompt: a prompt section changes
 * on every new folder touched, which would defeat the provider's cache the way `context.ts`'s own files deliberately
 * do not.
 */
import { defineDoc, defineExtension, type Extension, type ToolRegistration, type Wrap } from "@earendil-works/pi-durable";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { isInside, loadAgentContext, readContextFile, resolveToolPath } from "./context.ts";

export const FOLDER_CONTEXT_EXTENSION_NAME = "folder-context";

/** The tools whose `path` argument this extension inspects. Any other tool (bash included) is left alone. */
const ATTACHED_TOOLS = ["read", "edit", "write"] as const;

export type AttachedFoldersState = { attached: string[] };

/** The folder context files already attached to this conversation, by the context file's own absolute path. */
export const AttachedFoldersDoc = defineDoc<AttachedFoldersState>({
	kind: "mihai.attached-folders",
	version: 1,
	scope: "conversation",
	history: "latest",
	fork: "initial",
	checkpointWhen: () => false,
	initial: () => ({ attached: [] }),
});

/** Whether `directory` holds a `.git` or `.jj` entry; both can be files (worktrees, submodules) as well as directories. */
function hasRepoMarker(directory: string): boolean {
	return [".git", ".jj"].some((marker) => existsSync(join(directory, marker)));
}

/** The nearest ancestor of `path`, itself included, that holds a `.git` or `.jj` entry; undefined when none does. */
function findRepoRoot(path: string): string | undefined {
	let current = resolve(path);
	while (true) {
		if (hasRepoMarker(current)) return current;
		const parent = dirname(current);
		if (parent === current) return undefined;
		current = parent;
	}
}

/**
 * Every directory this file's folder context should show, nearest to the root first, `targetDir` last:
 * - Inside `cwd`, every directory strictly between `cwd` and `targetDir`, `targetDir` included; empty when `targetDir`
 *   is `cwd` itself, whose own AGENTS.md the system prompt already carries.
 * - Outside `cwd` (a worker's file in a different checkout entirely), every directory from the nearest ancestor
 *   repository root down to `targetDir`, root included; empty when no ancestor is a repository root.
 */
function enclosingFolders(cwd: string, targetDir: string): string[] {
	const root = resolve(cwd);
	let current = resolve(targetDir);
	const top = isInside(current, root) ? (current === root ? undefined : root) : findRepoRoot(current);
	if (top === undefined) return [];
	const folders: string[] = [];
	while (true) {
		folders.push(current);
		if (current === top) break;
		const parent = dirname(current);
		if (parent === current) break;
		current = parent;
	}
	return folders.reverse();
}

function pathArgument(args: unknown): string | undefined {
	if (typeof args !== "object" || args === null) return undefined;
	const path = (args as { path?: unknown }).path;
	return typeof path === "string" ? path : undefined;
}

function folderInstructionsBlock(file: { path: string; content: string }): string {
	return (
		`<folder_instructions path="${file.path}">\n` +
		`Relative paths this file names resolve against ${dirname(file.path)}, not the project root.\n\n` +
		`${file.content.trim()}\n</folder_instructions>`
	);
}

function wrapWithFolderContext<Tool extends ToolRegistration>(
	tool: Tool,
	options: { agentDir: string; configDir: string; claudeDir: string },
): Tool {
	return {
		...tool,
		async execute(args, api, context) {
			const result = await tool.execute(args, api, context);
			if (result.isError === true) return result;
			const path = pathArgument(args);
			if (path === undefined) return result;
			const agent = await api.agent(context);
			const cwd = agent.cwd;
			if (cwd === undefined) return result;
			const absolute = resolveToolPath(path, cwd);
			const folders = enclosingFolders(cwd, dirname(absolute));
			if (folders.length === 0) return result;
			const found = folders.map(readContextFile).filter((file) => file !== undefined);
			if (found.length === 0) return result;
			// A folder's context file may already be one of the system prompt's own (e.g. the file sits in a sibling
			// directory of a repository whose root is itself an ancestor of `cwd`), which would otherwise duplicate it.
			const shown = new Set(
				loadAgentContext({ ...options, cwd }).files.map((file) => file.path),
			);
			const candidates = found.filter((file) => !shown.has(file.path));
			if (candidates.length === 0) return result;
			const newlyAttached: { path: string; content: string }[] = [];
			for (const file of candidates) {
				const attached = await api.commit(async (tx) => {
					const doc = await tx.doc(AttachedFoldersDoc, api.conversationId);
					if (doc.attached.includes(file.path)) return false;
					doc.attached.push(file.path);
					return true;
				}, context);
				if (attached) newlyAttached.push(file);
			}
			if (newlyAttached.length === 0) return result;
			const extra = newlyAttached.map(folderInstructionsBlock).join("\n\n");
			return { ...result, output: [...(result.output ?? []), { type: "text" as const, text: extra }] };
		},
	};
}

/**
 * Installed for every conversation of a project, coordinator and workers alike: a worker in its own jj workspace reads
 * that checkout's folders, the coordinator the project's. Unlike `coordinator-tool-caps`, never removed for a worker.
 */
export function createFolderContextExtension(options: { agentDir: string; configDir: string; claudeDir: string }): Extension {
	const wraps: Wrap[] = ATTACHED_TOOLS.map((name) => ({
		tool: name,
		wrap: (tool: ToolRegistration) => wrapWithFolderContext(tool, options),
	}));
	return defineExtension({ name: FOLDER_CONTEXT_EXTENSION_NAME, wraps });
}
