/**
 * How a conversation's context reads in the Info tab: human paths, the system prompt files,
 * the AGENTS.md files, skills and tools in scannable groups, the system prompt's size, and
 * the numbers in the overview. Pure functions, so the panel only lays them out.
 */
import type {
	ContextFileKind,
	ConversationContext,
	ContextFile,
	SkillInfo,
	SkillSource,
	ToolInfo,
} from "@aiki/protocol";

/** What the path helpers need to shorten an absolute path; `homeDir` may be absent from an older backend. */
export type PathRoots = {
	homeDir?: string;
	projectPath: string;
};

/** A path as the panel shows it: shortened for reading, the absolute path kept for titles and copying. */
export type HumanPath = {
	short: string;
	full: string;
};

/** One directory row: the project's path, and the working directory when it differs (a worker's workspace). */
export type ContextPath = HumanPath & {
	label: string;
};

function withoutTrailingSlash(path: string): string {
	return path.length > 1 ? path.replace(/\/+$/, "") : path;
}

function isInside(path: string, directory: string): boolean {
	return path === directory || path.startsWith(`${directory}/`);
}

/**
 * A path a person can read: relative to the project when it is inside it, `~` instead
 * of the home directory, absolute otherwise. `full` is always what the server said, so
 * a title or a copy stays exact.
 */
export function humanPath(path: string, roots: PathRoots): HumanPath {
	const full = withoutTrailingSlash(path);
	const project = withoutTrailingSlash(roots.projectPath);
	if (full !== project && isInside(full, project)) {
		return { short: full.slice(project.length + 1), full: path };
	}
	const home = roots.homeDir === undefined ? "" : withoutTrailingSlash(roots.homeDir);
	if (home.length > 1) {
		if (full === home) return { short: "~", full: path };
		if (isInside(full, home)) return { short: `~/${full.slice(home.length + 1)}`, full: path };
	}
	return { short: full, full: path };
}

/**
 * Where the conversation works. A coordinator's cwd is the project; a worker in its
 * own workspace runs somewhere else, and then both paths matter.
 */
export function contextPaths(context: ConversationContext): ContextPath[] {
	const project: ContextPath = { label: "Project", ...humanPath(context.projectPath, context) };
	if (context.cwd === context.projectPath) return [project];
	return [project, { label: "Working directory", ...humanPath(context.cwd, context) }];
}

/**
 * Where a context file comes from: the harness's own config directory, pi's agent directory, the project itself, or one
 * of its ancestor folders.
 */
export type ContextFileOrigin = "config" | "global" | "project" | "parent";

/**
 * What a context file is. An older backend sends no kind and knows only AGENTS.md files,
 * so a missing kind reads as one.
 */
export function contextFileKind(file: Pick<ContextFile, "kind">): ContextFileKind {
	return file.kind ?? "agents";
}

const CONTEXT_FILE_KIND_LABELS: Record<ContextFileKind, string> = {
	system: "System prompt override",
	append: "Appended instructions",
	agents: "AGENTS.md",
	model: "Model notes",
};

/**
 * How a kind of context file reads in the panel: pi's SYSTEM.md, its APPEND_SYSTEM.md, an AGENTS.md, or the notes for
 * the conversation's model from the harness config's `models/` folder.
 */
export function contextFileKindLabel(kind: ContextFileKind): string {
	return CONTEXT_FILE_KIND_LABELS[kind];
}

/** The prompt files of one kind, in prompt order; the kinds are the protocol's, each list possibly empty. */
export function contextFilesByKind(files: readonly ContextFile[]): Record<ContextFileKind, ContextFile[]> {
	const grouped: Record<ContextFileKind, ContextFile[]> = { system: [], append: [], agents: [], model: [] };
	for (const file of files) grouped[contextFileKind(file)].push(file);
	return grouped;
}

const CONTEXT_FILE_ORIGIN_LABELS: Record<ContextFileOrigin, string> = {
	config: "harness config",
	global: "global",
	project: "project",
	parent: "parent folder",
};

function parentDirectory(path: string): string {
	const full = withoutTrailingSlash(path);
	const slash = full.lastIndexOf("/");
	return slash <= 0 ? "/" : full.slice(0, slash);
}

/**
 * The origin of a context file. A system prompt file is the harness's own config directory or the project's
 * `.aiki`; an AGENTS.md comes from pi's agent directory, the project or one of its parents.
 */
export function contextFileOrigin(
	file: Pick<ContextFile, "path" | "scope" | "kind">,
	projectPath: string
): ContextFileOrigin {
	if (contextFileKind(file) !== "agents") return file.scope === "global" ? "config" : "project";
	if (file.scope === "global") return "global";
	return parentDirectory(file.path) === withoutTrailingSlash(projectPath) ? "project" : "parent";
}

/** The badge an origin reads as: "harness config", "global", "project" or "parent folder". */
export function contextFileOriginLabel(origin: ContextFileOrigin): string {
	return CONTEXT_FILE_ORIGIN_LABELS[origin];
}

/** One context file row: what it is, where it comes from, how its path reads, and how big it is. */
export type ContextFileRow = {
	file: ContextFile;
	kind: ContextFileKind;
	kindLabel: string;
	origin: ContextFileOrigin;
	originLabel: string;
	short: string;
	full: string;
	/** The file's own name, e.g. the model pattern `openai-codex--gpt-*.md` a model notes file matched by. */
	name: string;
	size: string;
};

/** The context file rows in prompt order, each labelled by its kind and origin and sized. */
export function contextFileRows(files: readonly ContextFile[], roots: PathRoots): ContextFileRow[] {
	return files.map((file) => {
		const origin = contextFileOrigin(file, roots.projectPath);
		const shown = humanPath(file.path, roots);
		const kind = contextFileKind(file);
		return {
			file,
			kind,
			kindLabel: contextFileKindLabel(kind),
			origin,
			originLabel: contextFileOriginLabel(origin),
			short: shown.short,
			full: shown.full,
			name: withoutTrailingSlash(file.path).split("/").pop() ?? file.path,
			size: formatBytes(textBytes(file.content)),
		};
	});
}

export type SkillGroups = {
	/** The skills this conversation has read, which shaped it: shown first and visibly. */
	read: SkillInfo[];
	/** The ones still on offer, by name. */
	available: SkillInfo[];
};

/** Split skills into the ones this conversation read and the ones it has not, each sorted by name. */
export function skillGroups(skills: readonly SkillInfo[]): SkillGroups {
	const byName = (left: SkillInfo, right: SkillInfo): number => left.name.localeCompare(right.name);
	return {
		read: skills.filter((skill) => skill.read).sort(byName),
		available: skills.filter((skill) => !skill.read).sort(byName),
	};
}

/** One scope's skills inside a read or available group. */
export type SkillScopeGroup = {
	scope: SkillInfo["scope"];
	label: string;
	skills: SkillInfo[];
};

const SKILL_SCOPE_LABELS: Record<SkillInfo["scope"], string> = {
	global: "Global",
	project: "Project",
};

/** Skills split by scope, global first, each by name; empty scopes are left out. */
export function skillScopeGroups(skills: readonly SkillInfo[]): SkillScopeGroup[] {
	const byName = (left: SkillInfo, right: SkillInfo): number => left.name.localeCompare(right.name);
	return (["global", "project"] as const)
		.map((scope) => ({
			scope,
			label: SKILL_SCOPE_LABELS[scope],
			skills: skills.filter((skill) => skill.scope === scope).sort(byName),
		}))
		.filter((group) => group.skills.length > 0);
}

const SKILL_SOURCE_LABELS: Record<SkillSource, string> = {
	harness: "Harness",
	pi: "pi",
	claude: "Claude",
};

/** Where a skill came from; an older backend sends no source, and every skill it knew was pi's. */
export function skillSource(skill: Pick<SkillInfo, "source">): SkillSource {
	return skill.source ?? "pi";
}

/** How a source reads in the panel: "Harness", "pi" or "Claude". */
export function skillSourceLabel(source: SkillSource): string {
	return SKILL_SOURCE_LABELS[source];
}

/** One source's skills inside a read or available group, its global ones before its project ones. */
export type SkillSourceGroup = {
	source: SkillSource;
	label: string;
	skills: SkillInfo[];
	scopes: SkillScopeGroup[];
};

/**
 * The skills split by where they come from — the harness, pi or Claude — in that order, each source by scope and name;
 * a source with no skills is left out.
 */
export function skillSourceGroups(skills: readonly SkillInfo[]): SkillSourceGroup[] {
	const byName = (left: SkillInfo, right: SkillInfo): number => left.name.localeCompare(right.name);
	return (["harness", "pi", "claude"] as const)
		.map((source) => {
			const ofSource = skills.filter((skill) => skillSource(skill) === source);
			return {
				source,
				label: skillSourceLabel(source),
				skills: [...ofSource].sort(byName),
				scopes: skillScopeGroups(ofSource),
			};
		})
		.filter((group) => group.skills.length > 0);
}

/** What pi's own tools are grouped under; they have no extension. */
export const BUILT_IN_TOOLS_LABEL = "Built-in";

/** Friendly names for the extensions that register tools; anything else is prettified from its ID. */
const TOOL_GROUP_LABELS: Record<string, string> = {
	"coding-tools": "Coding",
	"worker-tools": "Workers",
	"aiki-agent-context": "Context",
};

/** How an extension's tools are headed: "Coding", "Workers", or a readable form of an unknown ID. */
export function toolGroupLabel(extension: string): string {
	const known = TOOL_GROUP_LABELS[extension];
	if (known !== undefined) return known;
	const words = extension.replace(/[._-]+/g, " ").trim();
	if (words.length === 0) return extension;
	return words.charAt(0).toUpperCase() + words.slice(1);
}

function matchesQuery(fields: readonly string[], query: string): boolean {
	const needle = query.trim().toLowerCase();
	if (needle.length === 0) return true;
	return fields.some((field) => field.toLowerCase().includes(needle));
}

/** The skills whose name, description, scope or source contains the filter text. */
export function filterSkills(skills: readonly SkillInfo[], query: string): SkillInfo[] {
	return skills.filter((skill) =>
		matchesQuery([skill.name, skill.description, skill.scope, skillSourceLabel(skillSource(skill))], query),
	);
}

/** The tools whose name, description or group contains the filter text. */
export function filterTools(tools: readonly ToolInfo[], query: string): ToolInfo[] {
	return tools.filter((tool) =>
		matchesQuery([tool.name, tool.description, tool.extension ?? BUILT_IN_TOOLS_LABEL], query),
	);
}

/** One group of tools: pi's own, or those one extension registered. */
export type ToolGroup = {
	key: string;
	label: string;
	extension: string | null;
	tools: ToolInfo[];
};

/** Tools grouped by the extension that registered them, built-ins first, names sorted inside each group. */
export function groupTools(tools: readonly ToolInfo[]): ToolGroup[] {
	const groups = new Map<string, ToolGroup>();
	for (const tool of tools) {
		const key = tool.extension === null ? "built-in" : `extension:${tool.extension}`;
		let group = groups.get(key);
		if (group === undefined) {
			group = {
				key,
				label: tool.extension === null ? BUILT_IN_TOOLS_LABEL : toolGroupLabel(tool.extension),
				extension: tool.extension,
				tools: [],
			};
			groups.set(key, group);
		}
		group.tools.push(tool);
	}
	const ordered = [...groups.values()];
	for (const group of ordered) group.tools.sort((left, right) => left.name.localeCompare(right.name));
	const rank = (group: ToolGroup): number => (group.extension === null ? 0 : 1);
	return ordered.sort((left, right) => rank(left) - rank(right) || left.label.localeCompare(right.label));
}

const encoder = new TextEncoder();

/** A text's size in bytes, the unit a file's size is shown in. */
export function textBytes(text: string): number {
	return encoder.encode(text).length;
}

/** A size as it reads in the panel: 840 B, 2.4 KB, 15.2 KB, 120 KB. */
export function formatBytes(bytes: number): string {
	if (bytes < 1000) return `${bytes} B`;
	const kilobytes = bytes / 1000;
	return kilobytes < 100 ? `${kilobytes.toFixed(1)} KB` : `${Math.round(kilobytes)} KB`;
}

/** A rough token count: about four characters per token, rounded up. */
export function estimateTokens(text: string): number {
	return Math.ceil(text.length / 4);
}

/** A token estimate as it reads: ~840 tokens, ~3.8k tokens. */
export function formatTokens(tokens: number): string {
	if (tokens < 1000) return `~${tokens} token${tokens === 1 ? "" : "s"}`;
	return `~${(tokens / 1000).toFixed(1)}k tokens`;
}

export type SystemPromptStats = {
	size: string;
	tokens: string;
};

/** How big the system prompt is, as the section header and the overview show it. */
export function systemPromptStats(prompt: string): SystemPromptStats {
	return {
		size: formatBytes(textBytes(prompt)),
		tokens: formatTokens(estimateTokens(prompt)),
	};
}

export type ContextCounts = {
	/** The AGENTS.md files; SYSTEM.md and APPEND_SYSTEM.md have their own section. */
	contextFiles: number;
	skills: number;
	readSkills: number;
	tools: number;
};

/** The numbers behind the overview. */
export function contextCounts(context: ConversationContext): ContextCounts {
	return {
		contextFiles: context.contextFiles.filter((file) => contextFileKind(file) === "agents").length,
		skills: context.skills.length,
		readSkills: context.skills.filter((skill) => skill.read).length,
		tools: context.tools.length,
	};
}

/** The sections the overview jumps to, which are also the panel's sections. */
export const CONTEXT_SECTIONS = ["agents", "skills", "tools", "prompt"] as const;
export type ContextSection = (typeof CONTEXT_SECTIONS)[number];

/** One number in the overview: a short value, its label, and an optional hint. */
export type ContextOverviewItem = {
	section: ContextSection;
	label: string;
	value: string;
	detail?: string;
};

/** The four numbers worth seeing before scrolling: AGENTS.md files, skills, tools, the prompt. */
export function contextOverview(context: ConversationContext): ContextOverviewItem[] {
	const counts = contextCounts(context);
	const prompt = systemPromptStats(context.systemPrompt);
	const groups = groupTools(context.tools).length;
	return [
		{
			section: "agents",
			label: "AGENTS.md files",
			value: String(counts.contextFiles),
		},
		{
			section: "skills",
			label: "skills read",
			value: counts.skills === 0 ? "0" : `${counts.readSkills}/${counts.skills}`,
		},
		{
			section: "tools",
			label: "tools",
			value: String(counts.tools),
			...(groups === 0 ? {} : { detail: groups === 1 ? "1 group" : `${groups} groups` }),
		},
		{
			section: "prompt",
			label: "system prompt",
			value: prompt.size,
			detail: prompt.tokens,
		},
	];
}

/**
 * Whether a `conversation.context` answer still describes the newest state. A
 * `conversation.context.changed` push for the same conversation that arrived after the request
 * was sent carries a later state than the answer, so the answer is dropped instead of
 * overwriting it.
 */
export function contextAnswerIsCurrent(pushesAtRequest: number, pushesNow: number): boolean {
	return pushesNow === pushesAtRequest;
}
