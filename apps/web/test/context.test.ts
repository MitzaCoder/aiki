/**
 * How the Info tab reads a conversation's context: human paths, AGENTS.md origins,
 * the read and remaining skills, tools by extension, the prompt's size and the
 * overview's numbers. Pure functions, tested here.
 */
import { describe, expect, test } from "bun:test";
import type { ConversationContext, SkillInfo, ToolInfo } from "@mihai-harness/protocol";
import {
	contextAnswerIsCurrent,
	contextCounts,
	contextFileKind,
	contextFileKindLabel,
	contextFileOrigin,
	contextFileOriginLabel,
	contextFileRows,
	contextFilesByKind,
	contextOverview,
	contextPaths,
	estimateTokens,
	filterSkills,
	filterTools,
	formatBytes,
	formatTokens,
	groupTools,
	humanPath,
	skillGroups,
	skillScopeGroups,
	skillSource,
	skillSourceGroups,
	skillSourceLabel,
	systemPromptStats,
	textBytes,
	toolGroupLabel,
} from "../src/lib/context.ts";

function skill(overrides: Partial<SkillInfo> & { name: string }): SkillInfo {
	return {
		name: overrides.name,
		description: `${overrides.name} does something.`,
		path: `/home/user/.pi/agent/skills/${overrides.name}/SKILL.md`,
		scope: "global",
		read: false,
		...overrides,
	};
}

function tool(overrides: Partial<ToolInfo> & { name: string }): ToolInfo {
	return {
		name: overrides.name,
		description: `${overrides.name} does something.`,
		extension: null,
		...overrides,
	};
}

function context(overrides: Partial<ConversationContext> = {}): ConversationContext {
	return {
		projectId: "demo",
		workerId: null,
		cwd: "/home/user/repos/demo",
		projectPath: "/home/user/repos/demo",
		homeDir: "/home/user",
		systemPrompt: "You are the coordinator.",
		tools: [tool({ name: "read" })],
		contextFiles: [],
		skills: [],
		...overrides,
	};
}

const roots = { homeDir: "/home/user", projectPath: "/home/user/repos/demo" };

describe("humanPath", () => {
	test("is project-relative inside the project", () => {
		expect(humanPath("/home/user/repos/demo/AGENTS.md", roots)).toEqual({
			short: "AGENTS.md",
			full: "/home/user/repos/demo/AGENTS.md",
		});
		expect(humanPath("/home/user/repos/demo/.pi/skills/deploy/SKILL.md", roots)).toEqual({
			short: ".pi/skills/deploy/SKILL.md",
			full: "/home/user/repos/demo/.pi/skills/deploy/SKILL.md",
		});
	});

	test("uses ~ for the home directory and everything below it", () => {
		expect(humanPath("/home/user", roots).short).toBe("~");
		expect(humanPath("/home/user/.pi/agent/skills/adb/SKILL.md", roots).short).toBe(
			"~/.pi/agent/skills/adb/SKILL.md",
		);
	});

	test("shows the project itself with ~ when it lives under home, and absolute when it does not", () => {
		expect(humanPath("/home/user/repos/demo", roots).short).toBe("~/repos/demo");
		expect(humanPath("/srv/demo", { homeDir: "/home/user", projectPath: "/srv/demo" }).short).toBe("/srv/demo");
	});

	test("falls back to the absolute path without a home directory", () => {
		expect(humanPath("/home/user/repos/demo/AGENTS.md", { projectPath: "/repos/demo" }).short).toBe(
			"/home/user/repos/demo/AGENTS.md",
		);
	});

	test("keeps the absolute path for the title and the copy, trailing slash and all", () => {
		expect(humanPath("/home/user/repos/demo/AGENTS.md/", roots)).toEqual({
			short: "AGENTS.md",
			full: "/home/user/repos/demo/AGENTS.md/",
		});
	});
});

describe("contextPaths", () => {
	test("shows the project alone when the conversation works in it", () => {
		expect(contextPaths(context())).toEqual([
			{ label: "Project", short: "~/repos/demo", full: "/home/user/repos/demo" },
		]);
	});

	test("adds the working directory when it differs, as in a worker's workspace", () => {
		const worker = context({
			workerId: "alpha",
			cwd: "/var/lib/harness/projects/demo/workspaces/alpha",
		});
		expect(contextPaths(worker)).toEqual([
			{ label: "Project", short: "~/repos/demo", full: "/home/user/repos/demo" },
			{
				label: "Working directory",
				short: "/var/lib/harness/projects/demo/workspaces/alpha",
				full: "/var/lib/harness/projects/demo/workspaces/alpha",
			},
		]);
	});
});

describe("context files", () => {
	test("labels a file by its scope and where it sits: global, project or a parent folder", () => {
		expect(contextFileOrigin({ path: "/home/user/.pi/AGENTS.md", scope: "global" }, roots.projectPath)).toBe(
			"global",
		);
		expect(contextFileOrigin({ path: "/home/user/repos/demo/AGENTS.md", scope: "project" }, roots.projectPath)).toBe(
			"project",
		);
		expect(contextFileOrigin({ path: "/home/user/repos/AGENTS.md", scope: "project" }, roots.projectPath)).toBe(
			"parent",
		);
		expect(contextFileOriginLabel("global")).toBe("global");
		expect(contextFileOriginLabel("project")).toBe("project");
		expect(contextFileOriginLabel("parent")).toBe("parent folder");
	});

	test("labels a system prompt file by its scope: the harness's config directory or the project", () => {
		expect(
			contextFileOrigin(
				{ path: "/home/user/.config/mihai-harness/APPEND_SYSTEM.md", scope: "global", kind: "append" },
				roots.projectPath,
			)
		).toBe("config");
		expect(
			contextFileOrigin(
				{ path: "/home/user/repos/demo/.mihai-harness/SYSTEM.md", scope: "project", kind: "system" },
				roots.projectPath,
			)
		).toBe("project");
		expect(contextFileOriginLabel("config")).toBe("harness config");
	});

	test("sizes each file, keeps the prompt order and shortens its path", () => {
		const rows = contextFileRows(
			[
				{ path: "/home/user/.pi/CLAUDE.md", scope: "global", content: "a".repeat(2048) },
				{ path: "/home/user/repos/demo/AGENTS.md", scope: "project", content: "project rules" },
			],
			roots,
		);
		expect(rows.map((row) => [row.originLabel, row.short, row.size, row.full])).toEqual([
			["global", "~/.pi/CLAUDE.md", "2.0 KB", "/home/user/.pi/CLAUDE.md"],
			["project", "AGENTS.md", "13 B", "/home/user/repos/demo/AGENTS.md"],
		]);
	});
});

describe("context file kinds", () => {
	test("reads a missing kind as an AGENTS.md, since that is all an older backend sent", () => {
		expect(contextFileKind({ kind: undefined })).toBe("agents");
		expect(contextFileKind({ kind: "system" })).toBe("system");
		expect(contextFileKind({ kind: "append" })).toBe("append");
	});

	test("labels pi's two system prompt files clearly", () => {
		expect(contextFileKindLabel("system")).toBe("System prompt override");
		expect(contextFileKindLabel("append")).toBe("Appended instructions");
		expect(contextFileKindLabel("agents")).toBe("AGENTS.md");
	});

	test("groups the prompt files by kind, keeping prompt order inside each group", () => {
		const files = [
			{ path: "/home/user/repos/demo/.mihai-harness/SYSTEM.md", scope: "project" as const, kind: "system" as const, content: "s" },
			{ path: "/home/user/.config/mihai-harness/APPEND_SYSTEM.md", scope: "global" as const, kind: "append" as const, content: "a" },
			{ path: "/home/user/.pi/agent/AGENTS.md", scope: "global" as const, kind: "agents" as const, content: "g" },
			{ path: "/home/user/repos/demo/AGENTS.md", scope: "project" as const, kind: "agents" as const, content: "p" },
		];
		const grouped = contextFilesByKind(files);
		expect(grouped.system.map((file) => file.path)).toEqual(["/home/user/repos/demo/.mihai-harness/SYSTEM.md"]);
		expect(grouped.append.map((file) => file.path)).toEqual(["/home/user/.config/mihai-harness/APPEND_SYSTEM.md"]);
		expect(grouped.agents.map((file) => file.path)).toEqual([
			"/home/user/.pi/agent/AGENTS.md",
			"/home/user/repos/demo/AGENTS.md",
		]);
		expect(contextFilesByKind([])).toEqual({ system: [], append: [], agents: [], model: [] });
	});

	test("labels model notes and names the pattern file they matched by", () => {
		expect(contextFileKindLabel("model")).toBe("Model notes");
		const file = {
			path: "/home/user/.config/mihai-harness/models/openai-codex--gpt-*.md",
			scope: "global" as const,
			kind: "model" as const,
			content: "Short sentences.",
		};
		expect(contextFilesByKind([file]).model).toEqual([file]);
		const [row] = contextFileRows([file], roots);
		expect(row).toMatchObject({ kind: "model", kindLabel: "Model notes", name: "openai-codex--gpt-*.md", originLabel: "harness config" });
	});

	test("sizes and labels a system prompt file like any other, with its origin", () => {
		const rows = contextFileRows(
			[
				{ path: "/home/user/repos/demo/.mihai-harness/SYSTEM.md", scope: "project", kind: "system", content: "Be terse." },
				{ path: "/home/user/.config/mihai-harness/APPEND_SYSTEM.md", scope: "global", kind: "append", content: "Use rg." },
			],
			roots,
		);
		expect(rows.map((row) => [row.kind, row.kindLabel, row.originLabel, row.short, row.size])).toEqual([
			["system", "System prompt override", "project", ".mihai-harness/SYSTEM.md", "9 B"],
			["append", "Appended instructions", "harness config", "~/.config/mihai-harness/APPEND_SYSTEM.md", "7 B"],
		]);
	});

	test("counts only AGENTS.md files in the overview's file count", () => {
		const withPromptFiles = context({
			contextFiles: [
				{ path: "/home/user/.config/mihai-harness/SYSTEM.md", scope: "global", kind: "system", content: "s" },
				{ path: "/home/user/.config/mihai-harness/APPEND_SYSTEM.md", scope: "global", kind: "append", content: "a" },
				{ path: "/home/user/repos/demo/AGENTS.md", scope: "project", kind: "agents", content: "p" },
			],
		});
		expect(contextCounts(withPromptFiles).contextFiles).toBe(1);
		expect(contextOverview(withPromptFiles)[0]).toEqual({ section: "agents", label: "AGENTS.md files", value: "1" });
	});
});

describe("skillGroups", () => {
	const readB = skill({ name: "zebra", read: true });
	const readA = skill({ name: "alpha", read: true });
	const unreadB = skill({ name: "beta" });
	const unreadA = skill({ name: "alpha-skill" });

	test("separates the read skills from the rest, each by name", () => {
		const groups = skillGroups([unreadB, readB, unreadA, readA]);
		expect(groups.read.map((entry) => entry.name)).toEqual(["alpha", "zebra"]);
		expect(groups.available.map((entry) => entry.name)).toEqual(["alpha-skill", "beta"]);
	});

	test("does not reorder the array it was given", () => {
		const skills = [unreadB, readB];
		skillGroups(skills);
		expect(skills.map((entry) => entry.name)).toEqual(["beta", "zebra"]);
	});
});

describe("skillScopeGroups", () => {
	const globalB = skill({ name: "zeta" });
	const globalA = skill({ name: "alpha" });
	const project = skill({ name: "deploy", scope: "project" });

	test("puts global before project, sorts by name and leaves out an empty scope", () => {
		expect(skillScopeGroups([globalB, project, globalA]).map((group) => [group.label, group.skills.map((entry) => entry.name)])).toEqual([
			["Global", ["alpha", "zeta"]],
			["Project", ["deploy"]],
		]);
		expect(skillScopeGroups([project]).map((group) => group.label)).toEqual(["Project"]);
	});

	test("does not reorder the array it was given", () => {
		const skills = [globalB, globalA];
		skillScopeGroups(skills);
		expect(skills.map((entry) => entry.name)).toEqual(["zeta", "alpha"]);
	});
});

describe("skill sources", () => {
	test("reads a missing source as pi's, since that is all an older backend sent", () => {
		expect(skillSource({ source: undefined })).toBe("pi");
		expect(skillSource({ source: "harness" })).toBe("harness");
		expect(skillSource({ source: "claude" })).toBe("claude");
		expect(skillSourceLabel("harness")).toBe("Harness");
		expect(skillSourceLabel("pi")).toBe("pi");
		expect(skillSourceLabel("claude")).toBe("Claude");
	});

	test("groups by source, harness then pi then Claude, each global before project", () => {
		const groups = skillSourceGroups([
			skill({ name: "claude-project", source: "claude", scope: "project" }),
			skill({ name: "pi-global", source: "pi" }),
			skill({ name: "claude-global", source: "claude" }),
			skill({ name: "harness-project", source: "harness", scope: "project" }),
			skill({ name: "pi-project", source: "pi", scope: "project" }),
		]);
		expect(
			groups.map((group) => [
				group.label,
				group.skills.map((entry) => entry.name),
				group.scopes.map((scope) => [scope.label, scope.skills.map((entry) => entry.name)]),
			])
		).toEqual([
			["Harness", ["harness-project"], [["Project", ["harness-project"]]]],
			[
				"pi",
				["pi-global", "pi-project"],
				[
					["Global", ["pi-global"]],
					["Project", ["pi-project"]],
				],
			],
			[
				"Claude",
				["claude-global", "claude-project"],
				[
					["Global", ["claude-global"]],
					["Project", ["claude-project"]],
				],
			],
		]);
	});

	test("leaves out a source with no skills and keeps the array it was given", () => {
		const sourceSkills = [skill({ name: "b", source: "claude" }), skill({ name: "a", source: "claude" })];
		expect(skillSourceGroups(sourceSkills).map((group) => group.label)).toEqual(["Claude"]);
		expect(sourceSkills.map((entry) => entry.name)).toEqual(["b", "a"]);
	});

	test("matches skills on their source as well as name, description and scope", () => {
		expect(
			filterSkills(
				[
					skill({ name: "one", source: "harness", description: "Harness skill." }),
					skill({ name: "two", source: "claude", description: "Claude skill.", scope: "project" }),
				],
				"claude"
			).map((entry) => entry.name)
		).toEqual(["two"]);
	});
});

describe("filtering", () => {
	const skills = [
		skill({ name: "deploy", description: "Ship the app." }),
		skill({ name: "jira", description: "Work with tickets.", scope: "project" }),
		skill({ name: "chrome-cdp", description: "Debug Chrome." }),
	];

	test("matches skills on name, description and scope, case-insensitively", () => {
		expect(filterSkills(skills, "chro").map((entry) => entry.name)).toEqual(["chrome-cdp"]);
		expect(filterSkills(skills, "TICKETS").map((entry) => entry.name)).toEqual(["jira"]);
		expect(filterSkills(skills, "project").map((entry) => entry.name)).toEqual(["jira"]);
		expect(filterSkills(skills, "  ")).toHaveLength(3);
	});

	test("matches tools on name, description and their group", () => {
		const tools = [
			tool({ name: "read", description: "Read a file." }),
			tool({ name: "worker_spawn", description: "Start a worker.", extension: "worker-tools" }),
			tool({ name: "worker_stop", description: "Stop one.", extension: "worker-tools" }),
		];
		expect(filterTools(tools, "spawn").map((entry) => entry.name)).toEqual(["worker_spawn"]);
		expect(filterTools(tools, "worker").map((entry) => entry.name)).toEqual(["worker_spawn", "worker_stop"]);
		expect(filterTools(tools, "built-in").map((entry) => entry.name)).toEqual(["read"]);
		expect(filterTools(tools, "")).toHaveLength(3);
	});
});

describe("groupTools", () => {
	test("puts pi's built-ins first, then extensions by name, tools sorted inside each group", () => {
		const groups = groupTools([
			tool({ name: "worker_stop", extension: "worker-tools" }),
			tool({ name: "read" }),
			tool({ name: "worker_spawn", extension: "worker-tools" }),
			tool({ name: "apply_patch" }),
			tool({ name: "memory_search", extension: "memory" }),
		]);
		expect(groups.map((group) => [group.label, group.tools.map((entry) => entry.name)])).toEqual([
			["Built-in", ["apply_patch", "read"]],
			["Memory", ["memory_search"]],
			["Workers", ["worker_spawn", "worker_stop"]],
		]);
	});

	test("has no group for a conversation without tools", () => {
		expect(groupTools([])).toEqual([]);
	});
});

describe("toolGroupLabel", () => {
	test("uses a friendly name for the known extensions", () => {
		expect(toolGroupLabel("coding-tools")).toBe("Coding");
		expect(toolGroupLabel("worker-tools")).toBe("Workers");
		expect(toolGroupLabel("mihai-agent-context")).toBe("Context");
	});

	test("prettifies an unknown extension ID", () => {
		expect(toolGroupLabel("memory-search")).toBe("Memory search");
		expect(toolGroupLabel("acme.ticket_worker")).toBe("Acme ticket worker");
	});
});

describe("sizes and token estimates", () => {
	test("counts a text's bytes and formats them", () => {
		expect(textBytes("abc")).toBe(3);
		expect(textBytes("é")).toBe(2);
		expect(formatBytes(840)).toBe("840 B");
		expect(formatBytes(2048)).toBe("2.0 KB");
		expect(formatBytes(15_234)).toBe("15.2 KB");
		expect(formatBytes(120_400)).toBe("120 KB");
	});

	test("estimates about four characters per token and formats the estimate", () => {
		expect(estimateTokens("")).toBe(0);
		expect(estimateTokens("one two three")).toBe(4);
		expect(formatTokens(0)).toBe("~0 tokens");
		expect(formatTokens(1)).toBe("~1 token");
		expect(formatTokens(840)).toBe("~840 tokens");
		expect(formatTokens(3809)).toBe("~3.8k tokens");
	});

	test("describes a system prompt by size and token estimate", () => {
		expect(systemPromptStats("a".repeat(15_000))).toEqual({ size: "15.0 KB", tokens: "~3.8k tokens" });
	});
});

describe("overview", () => {
	test("counts files, skills (read ones too) and tools", () => {
		const full = context({
			contextFiles: [
				{ path: "/home/user/.pi/AGENTS.md", scope: "global", content: "global" },
				{ path: "/home/user/repos/demo/AGENTS.md", scope: "project", content: "project" },
			],
			skills: [skill({ name: "a", read: true }), skill({ name: "b" })],
			tools: [tool({ name: "read" }), tool({ name: "worker_spawn", extension: "worker-tools" })],
		});
		expect(contextCounts(full)).toEqual({ contextFiles: 2, skills: 2, readSkills: 1, tools: 2 });
	});

	test("shows the numbers that matter, each pointing at its section", () => {
		const full = context({
			contextFiles: [{ path: "/home/user/repos/demo/AGENTS.md", scope: "project", content: "rules" }],
			skills: [skill({ name: "a", read: true }), skill({ name: "b" })],
			tools: [tool({ name: "read" }), tool({ name: "worker_spawn", extension: "worker-tools" })],
			systemPrompt: "a".repeat(15_234),
		});
		expect(contextOverview(full)).toEqual([
			{ section: "agents", label: "AGENTS.md files", value: "1" },
			{ section: "skills", label: "skills read", value: "1/2" },
			{ section: "tools", label: "tools", value: "2", detail: "2 groups" },
			{ section: "prompt", label: "system prompt", value: "15.2 KB", detail: "~3.8k tokens" },
		]);
	});

	test("a conversation with no skills reads 0, not 0/0", () => {
		expect(contextOverview(context())[1]).toEqual({ section: "skills", label: "skills read", value: "0" });
	});
});

describe("contextAnswerIsCurrent", () => {
	test("keeps an answer unless a pushed context arrived after the request", () => {
		expect(contextAnswerIsCurrent(0, 0)).toBe(true);
		expect(contextAnswerIsCurrent(3, 3)).toBe(true);
		expect(contextAnswerIsCurrent(0, 1)).toBe(false);
		expect(contextAnswerIsCurrent(2, 3)).toBe(false);
	});
});
