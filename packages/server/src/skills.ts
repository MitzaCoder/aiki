/** Backend-owned per-project choices, never written into a checkout. */
import type { ProjectSkill, SkillRole, SkillsProjectSetRequest } from "@kemiri/protocol";
import { join } from "node:path";
import type { LoadedSkill } from "./context.ts";
import { readJsonFile, writeJsonFile } from "./fs-json.ts";
import { MCP_ROLES } from "./mcp.ts";

type Choices = Record<string, Record<string, SkillRole[]>>;
const record = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

export class ProjectSkillStore {
	readonly path: string;
	#choices: Choices = Object.create(null);
	#chain: Promise<unknown> = Promise.resolve();
	constructor(dataDir: string, readonly changed: (projectId: string) => void = () => {}) {
		this.path = join(dataDir, "skills", "projects.json");
	}
	async open(): Promise<void> {
		let stored: unknown;
		try { stored = await readJsonFile(this.path); } catch (error) {
			if (!(error instanceof SyntaxError)) throw error;
		}
		this.#choices = Object.create(null);
		if (!record(stored)) return;
		for (const [projectId, entries] of Object.entries(stored)) {
			if (!record(entries)) continue;
			const choices: Record<string, SkillRole[]> = Object.create(null);
			for (const [name, roles] of Object.entries(entries)) {
				if (!name || !Array.isArray(roles) || !roles.every(role => MCP_ROLES.includes(role))) continue;
				choices[name] = MCP_ROLES.filter(role => roles.includes(role));
			}
			this.#choices[projectId] = choices;
		}
	}
	roles(projectId: string, name: string): SkillRole[] | undefined {
		const roles = this.#choices[projectId]?.[name];
		return roles === undefined ? undefined : [...roles];
	}
	list(projectId: string, skills: readonly LoadedSkill[]): ProjectSkill[] {
		return skills.map(skill => {
			const roles = this.roles(projectId, skill.name);
			return { name: skill.name, description: skill.description, path: skill.path, origin: skill.origin,
				source: skill.source, hides: [...skill.hides], roles: roles ?? [...MCP_ROLES], decided: roles !== undefined };
		});
	}
	filter(projectId: string, role: SkillRole, skills: readonly LoadedSkill[]): LoadedSkill[] {
		return skills.filter(skill => this.roles(projectId, skill.name)?.includes(role) ?? true);
	}
	async set(projectId: string, changes: SkillsProjectSetRequest["changes"]): Promise<void> {
		const run = this.#chain.then(async () => {
			const entries = Object.assign(Object.create(null), this.#choices[projectId]) as Record<string, SkillRole[]>;
			for (const { name, roles } of changes) {
				if (roles === null) delete entries[name];
				else entries[name] = MCP_ROLES.filter(role => roles.includes(role));
			}
			const next = Object.assign(Object.create(null), this.#choices, { [projectId]: entries }) as Choices;
			await writeJsonFile(this.path, next, 0o600);
			this.#choices = next;
			this.changed(projectId);
		});
		this.#chain = run.catch(() => undefined);
		await run;
	}
}
