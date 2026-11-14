import { afterEach, expect, it } from "bun:test";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { loadAgentContext, renderSkills } from "../src/context.ts";
import { ProjectSkillStore } from "../src/skills.ts";
import { createSetup, TestClient } from "./support.ts";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
async function skill(root: string, name: string, description = name): Promise<string> {
	const path = join(root, name, "SKILL.md");
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, `---\nname: ${name}\ndescription: ${description}\n---\n`);
	return path;
}
async function fixture() {
	const root = await mkdtemp(join(tmpdir(), "kemiri-skills-"));
	cleanups.push(() => rm(root, { recursive: true, force: true }));
	return { root, homeDir: join(root, "home"), cwd: join(root, "project"), agentDir: join(root, "pi"), configDir: join(root, "config"), claudeDir: join(root, "claude") };
}

it("reads project and home .agents after Claude, retains shadows, then filters without revealing losers", async () => {
	const dirs = await fixture();
	const global = await skill(join(dirs.homeDir, ".agents", "skills"), "global");
	const project = await skill(join(dirs.cwd, ".agents", "skills"), "project");
	const winner = await skill(join(dirs.claudeDir, "skills"), "same", "Claude winner");
	const loser = await skill(join(dirs.cwd, ".agents", "skills"), "same", "Agents loser");
	const loaded = loadAgentContext(dirs).skills;
	expect(loaded.find(s => s.name === "global")).toMatchObject({ path: global, source: "agents", origin: "global" });
	expect(loaded.find(s => s.name === "project")).toMatchObject({ path: project, source: "agents", origin: "project" });
	expect(loaded.find(s => s.name === "same")).toMatchObject({ path: winner, hides: [loser] });
	const store = new ProjectSkillStore(dirs.root);
	await store.open();
	await store.set("p", [{ name: "same", roles: ["coordinator", "background"] }]);
	expect(renderSkills(store.filter("p", "workers", loaded))).not.toContain("Claude winner");
	expect(renderSkills(store.filter("p", "workers", loaded))).not.toContain("Agents loser");
	expect(renderSkills(store.filter("p", "coordinator", loaded))).toContain("Claude winner");
	expect(renderSkills(store.filter("p", "background", loaded))).toContain("Claude winner");
	expect(renderSkills(store.filter("p", "workers", loadAgentContext(dirs).skills))).toBe(renderSkills(store.filter("p", "workers", loaded)));
	// The choices follow project identity even when the files come from an isolated workspace.
	const workspace = join(dirs.root, "workspace");
	await skill(join(workspace, ".agents", "skills"), "same", "Workspace winner");
	expect(renderSkills(store.filter("p", "workers", loadAgentContext({ ...dirs, claudeDir: join(dirs.root, "empty"), cwd: workspace }).skills))).not.toContain("Workspace winner");
});

it("validates stored decisions, keeps unknown names, resets to default, and writes private atomic JSON", async () => {
	const dirs = await fixture();
	const store = new ProjectSkillStore(dirs.root);
	await mkdir(dirname(store.path), { recursive: true });
	await writeFile(store.path, JSON.stringify({ p: { unknown: [], valid: ["workers"], garbage: 4, invalid: ["invented"], mixed: ["workers", 42] }, bad: [] }));
	await store.open();
	expect(store.roles("p", "valid")).toEqual(["workers"]);
	for (const name of ["garbage", "invalid", "mixed"]) expect(store.roles("p", name)).toBeUndefined();
	await store.set("p", [{ name: "valid", roles: null }, { name: "new", roles: [] }]);
	expect(store.roles("p", "valid")).toBeUndefined();
	expect(JSON.parse(await readFile(store.path, "utf8"))).toEqual({ p: { unknown: [], new: [] } });
	expect((await stat(store.path)).mode & 0o777).toBe(0o600);
	const reopened = new ProjectSkillStore(dirs.root);
	await reopened.open();
	expect(reopened.roles("p", "new")).toEqual([]);
	await writeFile(store.path, "not JSON");
	await reopened.open();
	expect(reopened.roles("p", "new")).toBeUndefined();
});

it("gets and sets decisions over RPC, broadcasts changes, preserves them on restart and supports null reset", async () => {
	const setup = await createSetup();
	cleanups.push(setup.cleanup);
	await skill(join(setup.projectDir, ".agents", "skills"), "testing");
	let client = await TestClient.open(setup.server);
	cleanups.push(async () => client.close());
	const hello = await client.hello();
	if (hello.type !== "hello") throw new Error("hello failed");
	expect(hello.features).toContain("project-skills");
	const add = await client.request({ type: "projects.add", path: setup.projectDir });
	if (add.type !== "projects.add") throw new Error("add failed");
	const projectId = add.project.id;
	const initial = await client.request({ type: "skills.project.get", projectId });
	if (initial.type !== "skills.project.get") throw new Error("get failed");
	expect(initial.projectId).toBe(projectId);
	expect(initial.skills.find(s => s.name === "testing")).toMatchObject({ roles: ["coordinator", "workers", "background"], decided: false, source: "agents", origin: "project" });
	expect(initial.skills.find(s => s.name === "html-artifacts")?.origin).toBe("builtin");
	const other = await TestClient.open(setup.server);
	cleanups.push(async () => other.close());
	await other.hello();
	const changed = other.waitFor(m => m.type === "skills.project.changed" && m.projectId === projectId);
	const set = await client.request({ type: "skills.project.set", projectId, changes: [{ name: "testing", roles: [] }] });
	if (set.type !== "skills.project.set") throw new Error("set failed");
	expect(set.skills.find(s => s.name === "testing")).toMatchObject({ roles: [], decided: true });
	expect((await changed).type).toBe("skills.project.changed");
	other.close(); client.close();
	await setup.restart();
	client = await TestClient.open(setup.server);
	await client.hello();
	const saved = await client.request({ type: "skills.project.get", projectId });
	if (saved.type !== "skills.project.get") throw new Error("saved get failed");
	expect(saved.skills.find(s => s.name === "testing")).toMatchObject({ roles: [], decided: true });
	const reset = await client.request({ type: "skills.project.set", projectId, changes: [{ name: "testing", roles: null }] });
	if (reset.type !== "skills.project.set") throw new Error("reset failed");
	expect(reset.skills.find(s => s.name === "testing")).toMatchObject({ roles: ["coordinator", "workers", "background"], decided: false });
	expect((await client.request({ type: "skills.project.get", projectId: "missing" })).type).toBe("error");
});

it("offers the coordinator a skill held back from a new worker and updates only the skills section on a choice", async () => {
	const setup = await createSetup();
	cleanups.push(setup.cleanup);
	const client = await TestClient.open(setup.server);
	cleanups.push(async () => client.close());
	await client.hello();
	await skill(join(setup.projectDir, ".agents", "skills"), "role-choice", "Unique role-filtered skill");
	let workerPrompt = "";
	let spawned = false;
	setup.faux.setResponses(Array.from({ length: 30 }, () => request => {
		const text = JSON.stringify(request.messages);
		if (text.includes('You are the worker')) {
			workerPrompt = text;
			return fauxAssistantMessage("## Report\nOutcome: done");
		}
		if (!spawned) {
			spawned = true;
			return fauxAssistantMessage([fauxToolCall("worker_spawn", { id: "reader", task: "Read README." })], { stopReason: "toolUse" });
		}
		return fauxAssistantMessage("Done.");
	}));
	const add = await client.request({ type: "projects.add", path: setup.projectDir });
	if (add.type !== "projects.add") throw new Error("add failed");
	const projectId = add.project.id;
	await client.request({ type: "projects.configure", projectId, coordinatorModel: { provider: "faux", modelId: "faux-1" }, workerModels: [{ provider: "faux", modelId: "faux-1" }] });
	await client.request({ type: "skills.project.set", projectId, changes: [{ name: "role-choice", roles: ["coordinator"] }] });
	await client.request({ type: "conversation.submit", projectId, requestId: "spawn", content: "Delegate." });
	const deadline = Date.now() + 15000;
	while (!workerPrompt && Date.now() < deadline) await Bun.sleep(20);
	expect(workerPrompt).not.toBe("");
	expect(workerPrompt).not.toContain("Unique role-filtered skill");
	const worker = await client.request({ type: "conversation.context", projectId, workerId: "reader" });
	if (worker.type !== "conversation.context") throw new Error("worker context failed");
	expect(worker.context.skillsHeldBack).toBe(1);
	expect(worker.context.skills.some(s => s.name === "role-choice")).toBe(false);
	const before = await client.request({ type: "conversation.context", projectId });
	const again = await client.request({ type: "conversation.context", projectId });
	if (before.type !== "conversation.context" || again.type !== "conversation.context") throw new Error("context failed");
	expect(before.context.systemPrompt).toContain("Unique role-filtered skill");
	expect(before.context.systemPrompt).toBe(again.context.systemPrompt);
	expect(before.context.skillsHeldBack).toBe(0);
	const { runtime } = await setup.server.manager.open(projectId);
	const agent = await runtime.conversation.agent(BACKGROUND_CONTEXT);
	const render = async () => Promise.all(agent.sections.map(async section => [section.key, await section.render({ conversationId: runtime.conversation.id, agent, env: undefined, shown: {}, read: { snapshot: runtime.harness.snapshot.bind(runtime.harness), snapshotAsOf: async () => undefined } }, BACKGROUND_CONTEXT)]));
	const sections = await render();
	await client.request({ type: "skills.project.set", projectId, changes: [{ name: "role-choice", roles: [] }] });
	const after = await render();
	expect(after.filter((section, i) => JSON.stringify(section) !== JSON.stringify(sections[i])).map(s => s[0])).toEqual(["skills"]);
	expect(await render()).toEqual(after);
}, 25000);
