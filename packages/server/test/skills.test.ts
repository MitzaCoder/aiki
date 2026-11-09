import { afterEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { basename, join } from "node:path";
import { loadAgentContext } from "../src/context.ts";
import { CLAUDE_DIR_ENV, resolveClaudeDir } from "../src/data-dir.ts";

const cleanups: (() => Promise<void>)[] = [];

/** A fresh directory, removed after the test. */
async function tempDir(): Promise<string> {
	const directory = await mkdtemp(join(tmpdir(), "mihai-harness-skills-"));
	cleanups.push(() => rm(directory, { recursive: true, force: true }));
	return directory;
}

afterEach(async () => {
	for (const cleanup of cleanups.splice(0)) await cleanup();
});

/** One skill directory under `root`, with a description; its frontmatter names it unless `name` says otherwise. */
async function writeSkill(
	root: string,
	folder: string,
	description: string,
	options: { name?: string; path?: string } = {},
): Promise<string> {
	const directory = join(root, folder);
	await mkdir(directory, { recursive: true });
	const path = options.path ?? join(directory, "SKILL.md");
	await writeFile(
		path,
		`---\nname: ${options.name ?? basename(folder)}\ndescription: ${description}\n---\n\n# ${folder}\n`,
	);
	return path;
}

function sources(loaded: ReturnType<typeof loadAgentContext>): [string, string, string][] {
	return loaded.skills.map((skill) => [skill.name, skill.source, skill.scope]);
}

describe("skill sources", () => {
	it("offers the harness's, pi's and Claude Code's skills, each source global before project", async () => {
		const root = await tempDir();
		const agentDir = join(root, "agent");
		const configDir = join(root, "config");
		const claudeDir = join(root, "claude");
		const cwd = join(root, "project");
		await mkdir(cwd, { recursive: true });

		await writeSkill(join(configDir, "skills"), "harness-global", "Harness global.");
		await writeSkill(join(cwd, ".mihai-harness", "skills"), "harness-project", "Harness project.");
		await writeSkill(join(agentDir, "skills"), "pi-global", "pi global.");
		await writeSkill(join(cwd, ".pi", "skills"), "pi-project", "pi project.");
		await writeSkill(join(claudeDir, "skills"), "claude-global", "Claude global.");
		await writeSkill(join(cwd, ".claude", "skills"), "claude-project", "Claude project.");

		const loaded = loadAgentContext({ agentDir, configDir, claudeDir, cwd });
		expect(sources(loaded)).toEqual([
			["harness-global", "harness", "global"],
			["harness-project", "harness", "project"],
			["pi-global", "pi", "global"],
			["pi-project", "pi", "project"],
			["claude-global", "claude", "global"],
			["claude-project", "claude", "project"],
		]);
		expect(loaded.skills[0]?.path).toBe(join(configDir, "skills", "harness-global", "SKILL.md"));
		expect(loaded.skills[4]?.path).toBe(join(claudeDir, "skills", "claude-global", "SKILL.md"));
	});

	it("keeps the first skill of a name: harness over pi over Claude, and a source's global over its project", async () => {
		const root = await tempDir();
		const agentDir = join(root, "agent");
		const configDir = join(root, "config");
		const claudeDir = join(root, "claude");
		const cwd = join(root, "project");
		await mkdir(cwd, { recursive: true });

		// The same name in all three sources: the harness's wins.
		await writeSkill(join(configDir, "skills"), "deploy", "Harness deploy.");
		await writeSkill(join(agentDir, "skills"), "deploy", "pi deploy.");
		await writeSkill(join(claudeDir, "skills"), "deploy", "Claude deploy.");
		// pi's source comes before Claude's, so pi's project skill still wins over a Claude global one.
		await writeSkill(join(cwd, ".pi", "skills"), "review", "pi review.");
		await writeSkill(join(claudeDir, "skills"), "review", "Claude review.");
		// A source's own global directory wins over its project directory.
		await writeSkill(join(claudeDir, "skills"), "docs", "Claude global docs.");
		await writeSkill(join(cwd, ".claude", "skills"), "docs", "Claude project docs.");
		// The harness's project directory is still the harness's, ahead of pi and Claude.
		await writeSkill(join(cwd, ".mihai-harness", "skills"), "ship", "Harness project ship.");
		await writeSkill(join(agentDir, "skills"), "ship", "pi ship.");

		const loaded = loadAgentContext({ agentDir, configDir, claudeDir, cwd });
		expect(sources(loaded)).toEqual([
			["deploy", "harness", "global"],
			["ship", "harness", "project"],
			["review", "pi", "project"],
			["docs", "claude", "global"],
		]);
		expect(loaded.skills.map((skill) => skill.description)).toEqual([
			"Harness deploy.",
			"Harness project ship.",
			"pi review.",
			"Claude global docs.",
		]);
	});

	it("offers a skill once when its SKILL.md real path was already loaded, even under another name", async () => {
		const root = await tempDir();
		const agentDir = join(root, "agent");
		const configDir = join(root, "config");
		const claudeDir = join(root, "claude");
		const cwd = join(root, "project");
		await mkdir(cwd, { recursive: true });

		// Without a frontmatter name the folder names the skill, so each symlink would be its own skill without the check.
		const shared = join(root, "shared-skill");
		await mkdir(shared, { recursive: true });
		await writeFile(join(shared, "SKILL.md"), "---\ndescription: The same file twice.\n---\n");
		await mkdir(join(agentDir, "skills"), { recursive: true });
		await symlink(shared, join(agentDir, "skills", "alpha"), "dir");
		await mkdir(join(claudeDir, "skills"), { recursive: true });
		await symlink(shared, join(claudeDir, "skills", "beta"), "dir");

		const loaded = loadAgentContext({ agentDir, configDir, claudeDir, cwd });
		expect(sources(loaded)).toEqual([["alpha", "pi", "global"]]);
		expect(loaded.skills[0]?.path).toBe(join(agentDir, "skills", "alpha", "SKILL.md"));
	});

	it("skips Claude Code's synced skills, its trash and its dot directories", async () => {
		const root = await tempDir();
		const agentDir = join(root, "agent");
		const configDir = join(root, "config");
		const claudeDir = join(root, "claude");
		const cwd = join(root, "project");
		await mkdir(cwd, { recursive: true });

		const claudeSkills = join(claudeDir, "skills");
		await writeSkill(claudeSkills, "kept", "A personal skill.");
		await writeSkill(claudeSkills, "synced/account-uuid/from-claude-ai", "Synced from claude.ai.");
		await writeSkill(claudeSkills, ".trash/1791669122718/deleted", "A deleted skill.");
		await writeSkill(claudeSkills, ".staging/pending", "A staged skill.");
		await writeSkill(join(cwd, ".claude", "skills"), "synced/account-uuid/project-synced", "Project synced.");
		await writeSkill(join(cwd, ".claude", "skills"), "project-kept", "A project skill.");

		const loaded = loadAgentContext({ agentDir, configDir, claudeDir, cwd });
		expect(sources(loaded)).toEqual([
			["kept", "claude", "global"],
			["project-kept", "claude", "project"],
		]);
	});
});

describe("Claude Code plugins", () => {
	it("offers the skills of enabled plugins, namespaced by plugin, and leaves disabled ones out", async () => {
		const root = await tempDir();
		const agentDir = join(root, "agent");
		const configDir = join(root, "config");
		const claudeDir = join(root, "claude");
		const cwd = join(root, "project");
		await mkdir(cwd, { recursive: true });

		const demo = join(root, "plugin-demo");
		await mkdir(join(demo, ".claude-plugin"), { recursive: true });
		await writeFile(
			join(demo, ".claude-plugin", "plugin.json"),
			JSON.stringify({ name: "demo", skills: ["./extra"] }),
		);
		await writeSkill(demo, "skills/helper", "A plugin helper.");
		await writeSkill(demo, "extra/extra-skill", "A plugin extra skill.");

		const off = join(root, "plugin-off");
		await writeSkill(off, "skills/off", "A disabled plugin's skill.");

		const projectPlugin = join(root, "plugin-project");
		await writeSkill(projectPlugin, "skills/local", "A project plugin's skill.");

		const pluginsDir = join(claudeDir, "plugins");
		await mkdir(pluginsDir, { recursive: true });
		await writeFile(
			join(pluginsDir, "installed_plugins.json"),
			JSON.stringify({
				version: 2,
				plugins: {
					"demo@market": [{ scope: "user", installPath: demo }],
					"off@market": [{ scope: "user", installPath: off }],
					"proj@market": [{ scope: "project", projectPath: cwd, installPath: projectPlugin }],
				},
			}),
		);
		await writeFile(
			join(claudeDir, "settings.json"),
			JSON.stringify({ enabledPlugins: { "demo@market": true, "off@market": false, "proj@market": true } }),
		);

		const loaded = loadAgentContext({ agentDir, configDir, claudeDir, cwd });
		expect(sources(loaded)).toEqual([
			["demo:helper", "claude", "global"],
			["demo:extra-skill", "claude", "global"],
			["proj:local", "claude", "project"],
		]);
		expect(loaded.skills[0]?.path).toBe(join(demo, "skills", "helper", "SKILL.md"));

		// A project-scoped plugin belongs to its project only.
		const elsewhere = join(root, "elsewhere");
		await mkdir(elsewhere, { recursive: true });
		expect(sources(loadAgentContext({ agentDir, configDir, claudeDir, cwd: elsewhere }))).toEqual([
			["demo:helper", "claude", "global"],
			["demo:extra-skill", "claude", "global"],
		]);
	});

	it("reads the old single-record file, and a manifest's defaultEnabled", async () => {
		const root = await tempDir();
		const agentDir = join(root, "agent");
		const configDir = join(root, "config");
		const claudeDir = join(root, "claude");
		const cwd = join(root, "project");
		await mkdir(cwd, { recursive: true });

		const legacy = join(root, "plugin-legacy");
		await writeSkill(legacy, "skills/legacy", "An old install record.");
		const offByDefault = join(root, "plugin-default-off");
		await mkdir(join(offByDefault, ".claude-plugin"), { recursive: true });
		await writeFile(
			join(offByDefault, ".claude-plugin", "plugin.json"),
			JSON.stringify({ name: "quiet", defaultEnabled: false }),
		);
		await writeSkill(offByDefault, "skills/quiet", "Off unless enabled.");

		const pluginsDir = join(claudeDir, "plugins");
		await mkdir(pluginsDir, { recursive: true });
		await writeFile(
			join(pluginsDir, "installed_plugins.json"),
			JSON.stringify({
				version: 1,
				plugins: {
					"legacy@market": { installPath: legacy },
					"quiet@market": { installPath: offByDefault },
				},
			}),
		);

		expect(sources(loadAgentContext({ agentDir, configDir, claudeDir, cwd }))).toEqual([
			["legacy:legacy", "claude", "global"],
		]);
	});
});

describe("claude directory", () => {
	it("defaults to ~/.claude of the server's user and takes an override", () => {
		expect(resolveClaudeDir({})).toBe(join(homedir(), ".claude"));
		expect(resolveClaudeDir({ [CLAUDE_DIR_ENV]: "  " })).toBe(join(homedir(), ".claude"));
		expect(resolveClaudeDir({ [CLAUDE_DIR_ENV]: "/srv/claude" })).toBe("/srv/claude");
		expect(resolveClaudeDir({ [CLAUDE_DIR_ENV]: "~/elsewhere" })).toBe(join(homedir(), "elsewhere"));
	});
});
