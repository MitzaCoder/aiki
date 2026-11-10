/**
 * What a conversation's model is told besides the transcript: pi's system prompt files (SYSTEM.md and
 * APPEND_SYSTEM.md), the AGENTS.md files of the project and of the agent directory, and the skills it may read on demand.
 *
 * All go into the system prompt as sections, so the harness re-reads them before every turn and an edit applies to the
 * next turn without a restart. The same files, plus the rendered prompt and the offered tools, are what
 * `conversation.context` serves; see `readConversationContext`.
 */
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { contentText, getSystemMessageText } from "@earendil-works/pi-ai";
import type { Message } from "@earendil-works/pi-ai";
import {
	type Agent,
	type Conversation,
	type DocumentReader,
	type Extension,
	type Harness,
	type LiveState,
	LiveDoc,
	type PromptInput,
	type Registry,
	defineExtension,
	section,
} from "@earendil-works/pi-durable";
import type {
	ContextFile,
	ContextFileKind,
	ConversationContext,
	SkillInfo,
	SkillSource,
	ToolInfo,
} from "@aiki/protocol";
import { type Dirent, readFileSync, readdirSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import type { ContextUsageReader } from "./compaction.ts";
import { parseFrontmatter } from "./frontmatter.ts";
import type { Project } from "./projects.ts";

/** The AGENTS.md a directory may hold, in the order they win: one file per directory, whoever wrote it (pi's order). */
export const CONTEXT_FILE_NAMES = ["AGENTS.md", "CLAUDE.md"] as const;
/**
 * pi's two system prompt files, from the harness's own config directory and the project's `.aiki`: `SYSTEM.md`
 * replaces the base instructions, `APPEND_SYSTEM.md` is added after them. pi's own files (`~/.pi/agent`, `.pi/`) are
 * deliberately not read.
 */
export const SYSTEM_FILE_NAME = "SYSTEM.md";
export const APPEND_SYSTEM_FILE_NAME = "APPEND_SYSTEM.md";
/**
 * Notes for one model or a family of them, which the user keeps in `<configDir>/models/`: `<provider>--<model>.md`,
 * where `--` stands for `/` and `*` matches anything (`openai-codex--gpt-*.md`, `claude-bridge--*.md`).
 */
export const MODEL_NOTES_DIR_NAME = "models";
/** A skill is the `SKILL.md` of a directory named after it, in one of these directories. */
export const SKILL_FILE_NAME = "SKILL.md";
export const SKILLS_DIR_NAME = "skills";
/** A project's skills live next to its pi configuration, as pi's do. */
export const PROJECT_CONFIG_DIR = ".pi";
/** A project's own SYSTEM.md and APPEND_SYSTEM.md live here, apart from its pi configuration and from pi's files. */
export const PROJECT_HARNESS_DIR = ".aiki";
/** Claude Code's per-project configuration directory; its `.claude/skills` are offered too. */
export const PROJECT_CLAUDE_DIR = ".claude";
/** Claude Code's plugins home, below its home, and the file that records what is installed there. */
export const CLAUDE_PLUGINS_DIR = "plugins";
export const CLAUDE_INSTALLED_PLUGINS_FILE = "installed_plugins.json";
/** Claude Code's settings, whose `enabledPlugins` maps decide whether an installed plugin's skills are offered. */
export const CLAUDE_SETTINGS_FILE = "settings.json";
export const CLAUDE_LOCAL_SETTINGS_FILE = "settings.local.json";
/** The directory an installed plugin keeps its skills in, and the manifest that can add more paths to it. */
export const CLAUDE_PLUGIN_SKILLS_DIR = "skills";
export const CLAUDE_PLUGIN_MANIFEST_DIR = ".claude-plugin";
export const CLAUDE_PLUGIN_MANIFEST_FILE = "plugin.json";
/**
 * `~/.claude/skills/synced/` holds the skills Claude Code downloads from claude.ai, one account directory and then one
 * directory per skill. The name is reserved, and the harness does not offer those skills: like `.trash/`, it is skipped.
 */
export const CLAUDE_SYNCED_DIR = "synced";
/** The directory names Claude Code reserves under `skills/`, which the harness never reads as a skill. */
const CLAUDE_SKIPPED_SKILL_DIRS: ReadonlySet<string> = new Set([CLAUDE_SYNCED_DIR]);

/**
 * The section keys the model sees our files under; every one is wrapped in `<key>…</key>` like every section, except the
 * preamble, which pi sends as the leading text. The two system prompt files keep pi's section names.
 */
export const CONTEXT_SECTION = "context";
export const SKILLS_SECTION = "skills";
export const PREAMBLE_SECTION = "preamble";
export const ADDENDUM_SECTION = "addendum";
export const MODEL_NOTES_SECTION = "model_notes";
/** The extension that provides those sections, installed for every conversation of a project. */
export const AGENT_CONTEXT_EXTENSION = "aiki-agent-context";

/**
 * A skill as the harness knows it: where it came from, and whether this conversation has read it — the latter is per
 * conversation, so `read` is added later.
 */
export type LoadedSkill = Omit<SkillInfo, "read"> & { source: SkillSource };

export type LoadedAgentContext = {
	/**
	 * In the order they go into the system prompt: SYSTEM.md, APPEND_SYSTEM.md, the AGENTS.md files from the agent
	 * directory and the filesystem root down to the cwd, then the notes for the conversation's model.
	 */
	files: ContextFile[];
	skills: LoadedSkill[];
};

function escapeXml(text: string): string {
	return text
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&apos;");
}

function isFile(path: string): boolean {
	try {
		return statSync(path).isFile();
	} catch {
		return false;
	}
}

function isDirectory(path: string): boolean {
	try {
		return statSync(path).isDirectory();
	} catch {
		return false;
	}
}

/** A file's text, or undefined when it cannot be read (missing, a directory, no permission). */
function readText(path: string): string | undefined {
	try {
		return readFileSync(path, "utf8");
	} catch {
		return undefined;
	}
}

/**
 * Claude Code's `@path/to/file` imports: a relative path resolves against the importing file's own directory (not the
 * conversation's cwd), `~/...` against home, and an absolute path as itself. Not evaluated inside a fenced code block or
 * an inline code span, so `` `@README` `` stays literal. Imports recurse up to four hops (Claude Code's documented
 * limit) and never revisit a file already in the chain, so a cycle stops instead of looping; a missing target is left as
 * the literal `@token`. Only CLAUDE.md carries this syntax — AGENTS.md is the cross-tool format and has no imports.
 */
export const CLAUDE_IMPORT_MAX_HOPS = 4;

const CLAUDE_IMPORT_PATTERN = /(^|[\s(])@([^\s`()]+)/gm;

/** `text` with fenced code blocks and inline code spans blanked out, same length, so match offsets still index `text`. */
function maskCode(text: string): string {
	const blank = (match: string): string => match.replace(/[^\n]/g, " ");
	return text.replace(/```[\s\S]*?```/g, blank).replace(/`[^`\n]*`/g, blank);
}

function resolveImportTarget(token: string, importingFileDir: string): string {
	if (token === "~") return homedir();
	if (token.startsWith("~/")) return join(homedir(), token.slice(2));
	if (token.startsWith("/")) return token;
	return resolve(importingFileDir, token);
}

function expandClaudeImportsFrom(path: string, content: string, hop: number, visited: ReadonlySet<string>): string {
	if (hop >= CLAUDE_IMPORT_MAX_HOPS) return content;
	const masked = maskCode(content);
	const dir = dirname(path);
	let result = "";
	let last = 0;
	for (const match of masked.matchAll(CLAUDE_IMPORT_PATTERN)) {
		const [, lead = "", token = ""] = match;
		const start = (match.index ?? 0) + lead.length;
		const end = start + 1 + token.length;
		const targetPath = resolveImportTarget(token, dir);
		if (!isFile(targetPath)) continue;
		const real = realPath(targetPath);
		if (visited.has(real)) continue;
		const importedText = readText(targetPath);
		if (importedText === undefined) continue;
		const expanded = expandClaudeImportsFrom(targetPath, importedText, hop + 1, new Set([...visited, real]));
		result += content.slice(last, start) + expanded.trim();
		last = end;
	}
	return result + content.slice(last);
}

/** Expands `@path` imports of a CLAUDE.md's content; any other file (AGENTS.md included) is returned unchanged. */
export function expandClaudeImports(path: string, content: string): string {
	if (basename(path) !== "CLAUDE.md") return content;
	return expandClaudeImportsFrom(path, content, 0, new Set([realPath(path)]));
}

/** The first of a directory's context files that exists, read as it goes into the prompt, imports expanded. */
export function readContextFile(dir: string): Omit<ContextFile, "scope" | "kind"> | undefined {
	for (const name of CONTEXT_FILE_NAMES) {
		const path = join(dir, name);
		if (!isFile(path)) continue;
		const content = readText(path);
		if (content === undefined) continue;
		return { path, content: expandClaudeImports(path, content.replace(/^\uFEFF/, "")) };
	}
	return undefined;
}

/** A file as it goes into the prompt: its text verbatim, with a BOM dropped; symlinks are followed by the read. */
function readPromptFile(
	path: string,
	kind: ContextFileKind,
	scope: ContextFile["scope"],
): ContextFile | undefined {
	const content = readText(path);
	if (content === undefined) return undefined;
	return { path, scope, kind, content: content.replace(/^\uFEFF/, "") };
}

/**
 * The harness's rule for the two system prompt files: of `<cwd>/.aiki/SYSTEM.md` and
 * `<configDir>/SYSTEM.md` the project's wins, and the two are never combined; the same for APPEND_SYSTEM.md. Only the
 * conversation's own cwd is looked at — unlike AGENTS.md, these are configuration for the directory the conversation runs
 * in, not instructions inherited from a parent. pi's own agent directory and `.pi` files are not read at all.
 */
function readPromptFiles(options: { configDir: string; cwd: string }): {
	system: ContextFile | undefined;
	append: ContextFile | undefined;
} {
	const projectDir = join(options.cwd, PROJECT_HARNESS_DIR);
	return {
		system:
			readPromptFile(join(projectDir, SYSTEM_FILE_NAME), "system", "project") ??
			readPromptFile(join(options.configDir, SYSTEM_FILE_NAME), "system", "global"),
		append:
			readPromptFile(join(projectDir, APPEND_SYSTEM_FILE_NAME), "append", "project") ??
			readPromptFile(join(options.configDir, APPEND_SYSTEM_FILE_NAME), "append", "global"),
	};
}

/** Whether a notes file's name (without `.md`) matches `provider/modelId`: `--` stands for `/`, `*` for anything. */
export function modelNotesMatch(fileBase: string, model: { provider: string; modelId: string }): boolean {
	const pattern = fileBase.split("--").join("/");
	const expression = pattern
		.split("*")
		.map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
		.join(".*");
	return new RegExp(`^${expression}$`).test(`${model.provider}/${model.modelId}`);
}

/** The notes files in `<configDir>/models/` whose name matches the model, sorted by name. */
export function readModelNotes(
	configDir: string,
	model: { provider: string; modelId: string } | undefined,
): ContextFile[] {
	if (model === undefined) return [];
	const directory = join(configDir, MODEL_NOTES_DIR_NAME);
	const names = readDirSorted(directory)
		.map((entry) => entry.name)
		.filter((name) => name.endsWith(".md") && modelNotesMatch(name.slice(0, -".md".length), model));
	return names
		.map((name) => readPromptFile(join(directory, name), "model", "global"))
		.filter((file): file is ContextFile => file !== undefined);
}

/** The model notes as a prompt section: one tagged block per file, in name order. */
export function renderModelNotes(files: readonly ContextFile[]): string | undefined {
	const notes = files.filter((file) => file.kind === "model" && file.content.trim().length > 0);
	if (notes.length === 0) return undefined;
	return [
		"Notes for the model you run on:",
		...notes.map((file) => `<model_note path="${escapeXml(file.path)}">\n${file.content.trim()}\n</model_note>`),
	].join("\n\n");
}

/** Every ancestor of `cwd` from the filesystem root down to `cwd` itself. */
function directoriesFromRoot(cwd: string): string[] {
	const directories: string[] = [];
	let current = resolve(cwd);
	while (true) {
		directories.push(current);
		const parent = dirname(current);
		if (parent === current) break;
		current = parent;
	}
	return directories.reverse();
}

/** One skill from `<dir>/<name>/SKILL.md`; a directory without a name and description is not a skill. */
function readSkill(
	directory: string,
	scope: LoadedSkill["scope"],
	source: SkillSource,
): LoadedSkill | undefined {
	const path = join(directory, SKILL_FILE_NAME);
	if (!isFile(path)) return undefined;
	const text = readText(path);
	if (text === undefined) return undefined;
	const { frontmatter } = parseFrontmatter(text);
	const description = (frontmatter["description"] ?? "").trim();
	if (description.length === 0) return undefined;
	const name = (frontmatter["name"] ?? "").trim() || basename(directory);
	if (name.length === 0) return undefined;
	return { name, description, path, scope, source };
}

/** A directory's entries by name, or none when it cannot be listed (it usually does not exist). */
function readDirSorted(directory: string): Dirent[] {
	try {
		return readdirSync(directory, { withFileTypes: true, encoding: "utf8" }).sort((left, right) =>
			left.name.localeCompare(right.name),
		);
	} catch {
		return [];
	}
}

/**
 * The skills in one skills directory: a `SKILL.md` per direct subdirectory, symlinks followed. Dot entries are skipped,
 * and so is any directory name in `skip` (Claude Code's reserved `synced/`).
 */
function readSkillsDir(
	directory: string,
	scope: LoadedSkill["scope"],
	source: SkillSource,
	options: { skip?: ReadonlySet<string> } = {},
): LoadedSkill[] {
	const entries = readDirSorted(directory);
	const skills: LoadedSkill[] = [];
	for (const entry of entries) {
		if (entry.name.startsWith(".") || options.skip?.has(entry.name) === true) continue;
		const path = join(directory, entry.name);
		const isSkillDir = entry.isSymbolicLink() ? isDirectory(path) : entry.isDirectory();
		if (!isSkillDir) continue;
		const skill = readSkill(path, scope, source);
		if (skill !== undefined) skills.push(skill);
	}
	return skills;
}

/** A path with its symlinks resolved, or the path itself when it cannot be (a broken link, no permission). */
export function realPath(path: string): string {
	try {
		return realpathSync(path);
	} catch {
		return path;
	}
}

/** Whether `path` is `directory` or below it; both are resolved so a relative project path still matches. */
export function isInside(path: string, directory: string): boolean {
	const full = resolve(path);
	const parent = resolve(directory);
	return full === parent || full.startsWith(`${parent}/`);
}

/** One install record of Claude Code's `installed_plugins.json`: v1 has one per plugin, v2 an array of them. */
type ClaudePluginInstall = {
	installPath: string;
	/** `user` and `managed` installs are global, `project` and `local` ones belong to one project. */
	scope: "user" | "project" | "local" | "managed";
	projectPath?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The plugins Claude Code records as installed, by `plugin@marketplace`; a missing or invalid file means none. */
function readInstalledPlugins(claudeDir: string): Map<string, ClaudePluginInstall[]> {
	const installed = new Map<string, ClaudePluginInstall[]>();
	const text = readText(join(claudeDir, CLAUDE_PLUGINS_DIR, CLAUDE_INSTALLED_PLUGINS_FILE));
	if (text === undefined) return installed;
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch {
		return installed;
	}
	if (!isRecord(parsed) || !isRecord(parsed["plugins"])) return installed;
	for (const [id, value] of Object.entries(parsed["plugins"])) {
		const entries = Array.isArray(value) ? value : [value];
		const records: ClaudePluginInstall[] = [];
		for (const entry of entries) {
			if (!isRecord(entry)) continue;
			const installPath = entry["installPath"];
			if (typeof installPath !== "string" || installPath.length === 0) continue;
			const scope = entry["scope"];
			const projectPath = entry["projectPath"];
			records.push({
				installPath,
				scope: scope === "project" || scope === "local" || scope === "managed" ? scope : "user",
				...(typeof projectPath === "string" ? { projectPath } : {}),
			});
		}
		if (records.length > 0) installed.set(id, records);
	}
	return installed;
}

/**
 * Whether each plugin is enabled, from the `enabledPlugins` maps of Claude Code's settings: the user's, the project's
 * shared `.claude/settings.json` and its `.claude/settings.local.json`, later files winning. A plugin no setting
 * mentions follows its manifest's `defaultEnabled`, true unless the manifest says otherwise.
 */
function readEnabledPlugins(claudeDir: string, cwd: string): Map<string, boolean> {
	const enabled = new Map<string, boolean>();
	for (const path of [
		join(claudeDir, CLAUDE_SETTINGS_FILE),
		join(cwd, PROJECT_CLAUDE_DIR, CLAUDE_SETTINGS_FILE),
		join(cwd, PROJECT_CLAUDE_DIR, CLAUDE_LOCAL_SETTINGS_FILE),
	]) {
		const text = readText(path);
		if (text === undefined) continue;
		let settings: unknown;
		try {
			settings = JSON.parse(text);
		} catch {
			continue;
		}
		if (!isRecord(settings) || !isRecord(settings["enabledPlugins"])) continue;
		for (const [id, value] of Object.entries(settings["enabledPlugins"])) {
			if (typeof value === "boolean") enabled.set(id, value);
		}
	}
	return enabled;
}

/** A plugin's manifest: the name that namespaces its skills, extra `skills` paths, and whether it starts enabled. */
function readClaudePluginManifest(installPath: string): {
	name?: string;
	skills: string[];
	defaultEnabled?: boolean;
} {
	const text = readText(join(installPath, CLAUDE_PLUGIN_MANIFEST_DIR, CLAUDE_PLUGIN_MANIFEST_FILE));
	if (text === undefined) return { skills: [] };
	let manifest: unknown;
	try {
		manifest = JSON.parse(text);
	} catch {
		return { skills: [] };
	}
	if (!isRecord(manifest)) return { skills: [] };
	const rawName = manifest["name"];
	const name = typeof rawName === "string" && rawName.trim().length > 0 ? rawName.trim() : undefined;
	const rawSkills = manifest["skills"];
	const skills =
		typeof rawSkills === "string"
			? [rawSkills]
			: Array.isArray(rawSkills)
				? rawSkills.filter((path): path is string => typeof path === "string")
				: [];
	const defaultEnabled = typeof manifest["defaultEnabled"] === "boolean" ? manifest["defaultEnabled"] : undefined;
	return {
		skills,
		...(name === undefined ? {} : { name }),
		...(defaultEnabled === undefined ? {} : { defaultEnabled }),
	};
}

/**
 * The skills at one path a plugin declares: a directory of `<name>/SKILL.md` folders, or one folder holding `SKILL.md`
 * itself. Claude Code namespaces them as `plugin:skill`, so a plugin's skill never hides a personal or project one.
 */
function readPluginSkillsDir(directory: string, scope: LoadedSkill["scope"], plugin: string): LoadedSkill[] {
	const direct = readSkill(directory, scope, "claude");
	const skills = direct === undefined ? readSkillsDir(directory, scope, "claude") : [direct];
	return skills.map((skill) => ({ ...skill, name: `${plugin}:${skill.name}` }));
}

/**
 * The skills of the plugins Claude Code has installed and left enabled, for one scope: a plugin installed for the user
 * (or by managed settings) is global, one installed for a project is that project's and needs the path it was installed
 * for. The default `skills/` scan and the manifest's own `skills` paths both count, and a plugin with a `SKILL.md` at
 * its root and no skills is one skill.
 */
function readClaudePluginSkills(options: {
	installed: ReadonlyMap<string, ClaudePluginInstall[]>;
	enabled: ReadonlyMap<string, boolean>;
	cwd: string;
	scope: LoadedSkill["scope"];
}): LoadedSkill[] {
	const skills: LoadedSkill[] = [];
	for (const id of [...options.installed.keys()].sort((left, right) => left.localeCompare(right))) {
		const pluginName = id.split("@")[0] ?? id;
		for (const record of options.installed.get(id) ?? []) {
			const global = record.scope === "user" || record.scope === "managed";
			if (global !== (options.scope === "global")) continue;
			if (!global && (record.projectPath === undefined || !isInside(options.cwd, record.projectPath))) continue;
			const manifest = readClaudePluginManifest(record.installPath);
			const setting = options.enabled.get(id);
			if (setting === false) continue;
			if (setting === undefined && manifest.defaultEnabled === false) continue;
			const name = manifest.name ?? pluginName;
			const found: LoadedSkill[] = [];
			for (const directory of [
				join(record.installPath, CLAUDE_PLUGIN_SKILLS_DIR),
				...manifest.skills.map((path) => resolve(record.installPath, path)),
			]) {
				found.push(...readPluginSkillsDir(directory, options.scope, name));
			}
			if (found.length === 0) {
				const single = readSkill(record.installPath, options.scope, "claude");
				if (single !== undefined) found.push({ ...single, name: `${name}:${single.name}` });
			}
			skills.push(...found);
		}
	}
	return skills;
}

/** The candidates in order, dropping a repeated name and a skill whose `SKILL.md` real path is already loaded. */
function uniqueSkills(candidates: readonly LoadedSkill[]): LoadedSkill[] {
	const skills: LoadedSkill[] = [];
	const names = new Set<string>();
	const realPaths = new Set<string>();
	for (const skill of candidates) {
		if (names.has(skill.name)) continue;
		const real = realPath(skill.path);
		if (realPaths.has(real)) continue;
		names.add(skill.name);
		realPaths.add(real);
		skills.push(skill);
	}
	return skills;
}

/**
 * The context files and skills of one working directory: the harness's SYSTEM.md and APPEND_SYSTEM.md first (the
 * project's or the config directory's), then the agent directory's AGENTS.md, then the ones from the filesystem root down
 * to `cwd`, so the nearest file is last and wins.
 *
 * Skills come from three places, in this order: the harness's own (`<configDir>/skills`, then
 * `<cwd>/.aiki/skills`), pi's (`<agentDir>/skills`, then `<cwd>/.pi/skills`), and Claude Code's
 * (`<claudeDir>/skills` with its enabled plugins' skills, then `<cwd>/.claude/skills`). Within a source the global
 * directory comes before the project's, and a name keeps its first skill: harness over pi over Claude, then global over
 * project. A skill whose `SKILL.md` real path was already loaded is dropped too, so the same skill symlinked into two
 * places is offered once. Claude Code's `skills/synced/` (downloaded from claude.ai) and `.trash/` are not read.
 *
 * Read fresh on every call, and synchronously: it runs inside the request that renders the prompt, where a handful of
 * small reads costs less than the awaits that would let other work in between.
 *
 * Everything the returned prompt text depends on is file content and absolute paths, in a fixed order: no timestamps,
 * sizes or counts, and nothing about this conversation. A turn whose files did not change therefore renders the same
 * section text as the last one, the harness finds nothing to patch, and the provider's prompt cache still hits.
 */
export function loadAgentContext(options: {
	agentDir: string;
	configDir: string;
	claudeDir: string;
	cwd: string;
	/** The conversation's model, whose notes are read too; none without one. */
	model?: { provider: string; modelId: string } | undefined;
}): LoadedAgentContext {
	const prompt = readPromptFiles(options);
	const files: ContextFile[] = [prompt.system, prompt.append].filter(
		(file): file is ContextFile => file !== undefined,
	);
	const global = readContextFile(options.agentDir);
	if (global !== undefined) files.push({ ...global, scope: "global", kind: "agents" });
	for (const directory of directoriesFromRoot(options.cwd)) {
		const file = readContextFile(directory);
		if (file === undefined) continue;
		if (files.some((known) => known.path === file.path)) continue;
		files.push({ ...file, scope: "project", kind: "agents" });
	}
	files.push(...readModelNotes(options.configDir, options.model));

	// Claude Code's plugin records and settings are read once for both scopes; both are missing on most machines.
	const installedPlugins = readInstalledPlugins(options.claudeDir);
	const enabledPlugins =
		installedPlugins.size === 0 ? new Map<string, boolean>() : readEnabledPlugins(options.claudeDir, options.cwd);
	const claudePluginSkills = (scope: LoadedSkill["scope"]): LoadedSkill[] =>
		installedPlugins.size === 0
			? []
			: readClaudePluginSkills({ installed: installedPlugins, enabled: enabledPlugins, cwd: options.cwd, scope });
	const skills = uniqueSkills([
		...readSkillsDir(join(options.configDir, SKILLS_DIR_NAME), "global", "harness"),
		...readSkillsDir(join(options.cwd, PROJECT_HARNESS_DIR, SKILLS_DIR_NAME), "project", "harness"),
		...readSkillsDir(join(options.agentDir, SKILLS_DIR_NAME), "global", "pi"),
		...readSkillsDir(join(options.cwd, PROJECT_CONFIG_DIR, SKILLS_DIR_NAME), "project", "pi"),
		...readSkillsDir(join(options.claudeDir, SKILLS_DIR_NAME), "global", "claude", {
			skip: CLAUDE_SKIPPED_SKILL_DIRS,
		}),
		...claudePluginSkills("global"),
		...readSkillsDir(join(options.cwd, PROJECT_CLAUDE_DIR, SKILLS_DIR_NAME), "project", "claude", {
			skip: CLAUDE_SKIPPED_SKILL_DIRS,
		}),
		...claudePluginSkills("project"),
	]);
	return { files, skills };
}

/** The AGENTS.md files as a prompt section: one tagged block per file, in order. */
export function renderContextFiles(files: readonly ContextFile[]): string | undefined {
	const instructions = files.filter((file) => file.kind === "agents");
	if (instructions.length === 0) return undefined;
	return [
		"Project-specific instructions and guidelines:",
		...instructions.map(
			(file) => `<project_instructions path="${escapeXml(file.path)}">\n${file.content.trim()}\n</project_instructions>`,
		),
	].join("\n\n");
}

/**
 * SYSTEM.md or APPEND_SYSTEM.md as prompt text: verbatim apart from surrounding whitespace, and nothing at all when the
 * file is missing or empty (an empty SYSTEM.md leaves the harness without a preamble, as it would be without the file).
 */
export function renderSystemPromptFile(file: ContextFile | undefined): string | undefined {
	if (file === undefined) return undefined;
	const text = file.content.trim();
	return text.length === 0 ? undefined : text;
}

/** The skills as a prompt section: name, description and path; the model reads the file itself when a task matches. */
export function renderSkills(skills: readonly LoadedSkill[]): string | undefined {
	if (skills.length === 0) return undefined;
	const lines = [
		"The following skills provide specialized instructions for specific tasks.",
		"Use the read tool to load a skill's file when the task matches its description.",
		"When a skill file references a relative path, resolve it against the skill directory (parent of SKILL.md / dirname of the path) and use that absolute path in tool commands.",
		"",
		"<available_skills>",
	];
	for (const skill of skills) {
		lines.push("  <skill>");
		lines.push(`    <name>${escapeXml(skill.name)}</name>`);
		lines.push(`    <description>${escapeXml(skill.description)}</description>`);
		lines.push(`    <location>${escapeXml(skill.path)}</location>`);
		lines.push("  </skill>");
	}
	lines.push("</available_skills>");
	return lines.join("\n");
}

/**
 * The extension every conversation of a project selects: the harness's system prompt files and the context files and
 * skills of the conversation's own cwd (the harness's, pi's and Claude Code's), so a worker in its jj workspace reads
 * that checkout's files and the coordinator reads the project's.
 *
 * The sections render from the files on each request, so an edited AGENTS.md, SYSTEM.md or a new skill applies to the next
 * turn. The order is pi's: the preamble (SYSTEM.md, the leading text), the addendum (APPEND_SYSTEM.md), the project's
 * instructions, then the skills. A SYSTEM.md therefore replaces nothing but the base instructions the harness would
 * otherwise start from — never the harness's own sections (the coordinator's and a worker's), the AGENTS.md files or the
 * skills.
 *
 * Because the text is deterministic and content-only, an unchanged turn renders the same value and pi-durable writes no
 * `pi.system` entry for it: the transcript, and with it the prompt the provider caches, only changes when a file does.
 * Whether a skill has been read stays out of the prompt for the same reason; it belongs to `conversation.context`.
 */
export function createAgentContextExtension(options: {
	agentDir: string;
	configDir: string;
	claudeDir: string;
}): Extension {
	return defineExtension({
		name: AGENT_CONTEXT_EXTENSION,
		sections: [
			section(
				PREAMBLE_SECTION,
				(input) => {
					const cwd = input.agent.cwd;
					if (cwd === undefined) return undefined;
					return renderSystemPromptFile(readPromptFiles({ configDir: options.configDir, cwd }).system);
				},
				// pi sends the preamble as the prompt's leading text, not as one of its tagged sections.
				{ tag: false },
			),
			section(ADDENDUM_SECTION, (input) => {
				const cwd = input.agent.cwd;
				if (cwd === undefined) return undefined;
				return renderSystemPromptFile(readPromptFiles({ configDir: options.configDir, cwd }).append);
			}),
			section(CONTEXT_SECTION, (input) => {
				const cwd = input.agent.cwd;
				if (cwd === undefined) return undefined;
				return renderContextFiles(
					loadAgentContext({
						agentDir: options.agentDir,
						configDir: options.configDir,
						claudeDir: options.claudeDir,
						cwd,
					}).files,
				);
			}),
			section(SKILLS_SECTION, (input) => {
				const cwd = input.agent.cwd;
				if (cwd === undefined) return undefined;
				return renderSkills(
					loadAgentContext({
						agentDir: options.agentDir,
						configDir: options.configDir,
						claudeDir: options.claudeDir,
						cwd,
					}).skills,
				);
			}),
			// Last, so switching models leaves every section before it, and the provider's cache of them, untouched.
			section(MODEL_NOTES_SECTION, (input) => renderModelNotes(readModelNotes(options.configDir, input.agent.model))),
		],
	});
}

// --- what the next request is sent with --------------------------------------------------------------------------

export type ConversationContextSources = {
	project: Project;
	/** Null for the coordinator. */
	workerId: string | null;
	/** The thread the conversation is (or whose worker it is); "main" for main. */
	threadId?: string;
	conversation: Conversation;
	harness: Harness;
	registry: Registry;
	/** The directory whose AGENTS.md and skills every conversation reads. */
	agentDir: string;
	/** The directory whose SYSTEM.md and APPEND_SYSTEM.md apply unless the project's own `.aiki` has one. */
	configDir: string;
	/** Claude Code's home, whose skills, plugins' skills and `.claude/skills` the conversation is also offered. */
	claudeDir: string;
	/** Reads `usage`: how full the context is and where its model's compaction thresholds sit. Omit in tests that don't
	 * care; the server always passes it, so a client always gets the field. */
	usage?: ContextUsageReader;
};

/** A path as a tool call means it, from a conversation's cwd (the read tool expands `~` the same way). */
export function resolveToolPath(path: string, cwd: string): string {
	if (path === "~") return homedir();
	if (path.startsWith("~/")) return resolve(homedir(), path.slice(2));
	return resolve(cwd, path);
}

/** The paths this conversation's transcript has read with the `read` tool, so the client can mark a skill as read. */
export function readPaths(messages: readonly Message[], cwd: string): Set<string> {
	const paths = new Set<string>();
	for (const message of messages) {
		if (message.role !== "assistant") continue;
		const content = (message as { content?: unknown }).content;
		if (!Array.isArray(content)) continue;
		for (const block of content) {
			if (typeof block !== "object" || block === null) continue;
			const call = block as { type?: string; name?: string; arguments?: { path?: unknown } };
			if (call.type !== "toolCall" || call.name !== "read") continue;
			const path = call.arguments?.path;
			if (typeof path !== "string" || path.trim().length === 0) continue;
			paths.add(resolveToolPath(path.trim(), cwd));
		}
	}
	return paths;
}

/** The sections the transcript currently has in effect: set in place, `null` removes one, re-adding appends it. */
function replaySections(messages: readonly Message[]): Record<string, string> {
	const shown = new Map<string, string>();
	for (const message of messages) {
		if (message.role !== "system") continue;
		const sections = (message as { sections?: Record<string, string | null> }).sections;
		if (sections === undefined) continue;
		for (const [key, value] of Object.entries(sections)) {
			if (value === null) shown.delete(key);
			else shown.set(key, value);
		}
	}
	return Object.fromEntries(shown);
}

/** The positional text of the system prompt: what `pi.system` entries add as `content` rather than as sections. */
function systemContent(messages: readonly Message[]): string {
	const parts: string[] = [];
	for (const message of messages) {
		if (message.role !== "system") continue;
		const text = contentText(message.content);
		if (text.length > 0) parts.push(text);
	}
	return parts.join("\n\n");
}

/**
 * The `read` a section is given. The sections here read no documents; the harness answers the committed reads, and there
 * is no historical reader outside a task, so `snapshotAsOf` reports nothing.
 */
function documentReader(harness: Harness): DocumentReader {
	const reader = harness as unknown as DocumentReader;
	return { snapshot: reader.snapshot.bind(harness), snapshotAsOf: async () => undefined };
}

/**
 * The prompt a request would be sent with now: the agent's sections rendered in order, as `GenerationTask` does before
 * every request, then joined with the positional content the way pi renders the system message.
 */
async function renderSystemPrompt(options: {
	conversation: Conversation;
	harness: Harness;
	agent: Agent;
	messages: readonly Message[];
}): Promise<string> {
	const shown = replaySections(options.messages);
	const input: PromptInput = {
		conversationId: options.conversation.id,
		agent: options.agent,
		env: undefined,
		shown,
		read: documentReader(options.harness),
	};
	const sections: Record<string, string> = {};
	for (const promptSection of options.agent.sections) {
		let text: string | undefined;
		try {
			text = await promptSection.render(input, BACKGROUND_CONTEXT);
		} catch {
			// A section that throws keeps what the transcript already shows, as the harness does.
			text = shown[promptSection.key];
		}
		if (text === undefined) continue;
		sections[promptSection.key] =
			promptSection.tag === false ? text : `<${promptSection.key}>\n${text}\n</${promptSection.key}>`;
	}
	return getSystemMessageText({ role: "system", content: systemContent(options.messages), sections, timestamp: 0 });
}

/** The tools the next request offers, with the extension that registered each. */
function describeTools(agent: Agent, registry: Registry): ToolInfo[] {
	const byTool = new Map<unknown, string>();
	const byName = new Map<string, string>();
	for (const entry of registry.snapshot().tools()) {
		byTool.set(entry.tool, entry.extension.name);
		byName.set(entry.tool.name, entry.extension.name);
	}
	return agent.tools.map((tool) => ({
		name: tool.name,
		description: tool.description,
		extension: byTool.get(tool) ?? byName.get(tool.name) ?? null,
	}));
}

/**
 * A conversation's context as the next request would have it: where its tools run, the full system prompt, the tools it
 * is offered, the files folded into the prompt and the skills it is offered, with the ones it already read marked, and
 * how full that context is.
 */
export async function readConversationContext(sources: ConversationContextSources): Promise<ConversationContext> {
	const agent = await sources.conversation.agent(BACKGROUND_CONTEXT);
	const view = await sources.conversation.context(BACKGROUND_CONTEXT);
	const cwd = agent.cwd ?? sources.project.path;
	const loaded = loadAgentContext({
		agentDir: sources.agentDir,
		configDir: sources.configDir,
		claudeDir: sources.claudeDir,
		cwd,
		model: agent.model,
	});
	const systemPrompt = await renderSystemPrompt({
		conversation: sources.conversation,
		harness: sources.harness,
		agent,
		messages: view.messages,
	});
	const read = readPaths(view.messages, cwd);
	// A skill loaded from one symlink is the same file as the one read through another, so compare real paths too.
	const readRealPaths = new Set([...read].map(realPath));
	const usage =
		sources.usage === undefined
			? undefined
			: await sources.usage.read({
					conversation: sources.conversation,
					model: agent.model,
					messages: view.messages,
					live: (await sources.harness.snapshot(LiveDoc, sources.conversation.id, BACKGROUND_CONTEXT)) as
						| LiveState
						| undefined,
					newestEntryId: view.entries.at(-1)?.id,
				});
	return {
		projectId: sources.project.id,
		workerId: sources.workerId,
		...(sources.threadId === undefined ? {} : { threadId: sources.threadId }),
		cwd,
		projectPath: sources.project.path,
		homeDir: homedir(),
		systemPrompt,
		tools: describeTools(agent, sources.registry),
		contextFiles: loaded.files,
		skills: loaded.skills.map((skill) => ({
			...skill,
			read: read.has(skill.path) || readRealPaths.has(realPath(skill.path)),
		})),
		...(usage === undefined ? {} : { usage }),
	};
}
