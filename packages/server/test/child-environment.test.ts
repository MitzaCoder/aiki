import { afterEach, expect, test } from "bun:test";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { fauxAssistantMessage, fauxToolCall, type FauxResponseFactory } from "@earendil-works/pi-ai/providers/faux";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { AgentExecutionEnv } from "../src/agent-execution-env.ts";
import { childEnvironment } from "../src/child-environment.ts";
import { runHostCommand } from "../src/host-commands.ts";
import { TerminalHost } from "../src/terminals.ts";
import { createSetup, entryText, TestClient, ViewClient, type TestSetup } from "./support.ts";

const setups: TestSetup[] = [];
const clients: TestClient[] = [];
const restoredEnvironment = new Map<string, string | undefined>();
afterEach(async () => {
	for (const client of clients.splice(0)) client.close();
	for (const setup of setups.splice(0)) await setup.cleanup();
	for (const [name, value] of restoredEnvironment) {
		if (value === undefined) delete process.env[name];
		else process.env[name] = value;
	}
	restoredEnvironment.clear();
});
async function setup() {
	const s = await createSetup({ terminals: false });
	setups.push(s);
	return s;
}
function setEnvironment(name: string, value: string) {
	if (!restoredEnvironment.has(name)) restoredEnvironment.set(name, process.env[name]);
	process.env[name] = value;
}
const main = join(import.meta.dir, "../src/main.ts");
const source = (name: string) => JSON.stringify(join(import.meta.dir, `../src/${name}.ts`));
const shellQuote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
const settingNames = [
	"AIKI_DATA_DIR", "AIKI_CONFIG_DIR", "AIKI_HOST", "AIKI_PORT", "AIKI_ALLOWED_ORIGINS", "AIKI_STATE_NAMESPACE",
	"AIKI_PROJECT_CONTEXT_DIR", "AIKI_CONTEXT_EXTENSION", "AIKI_AGENT_DIR", "AIKI_CLAUDE_DIR", "AIKI_ENV_FILE",
	"AIKI_WEB_DIR", "AIKI_AUTH_MODE", "AIKI_BACKEND_ORIGINS", "AIKI_PUBLIC_URL", "AIKI_TRUSTED_PROXIES", "AIKI_WEB_APP",
	"AIKI_ARTIFACT_MAX_BYTES", "AIKI_FCM_KEY_FILE", "AIKI_VAPID_KEY_FILE", "AIKI_VAPID_SUBJECT",
	"AIKI_DISK_LOW_PERCENT", "AIKI_DISK_LOW_BYTES", "AIKI_WORK_FINISHED_MINUTES", "AIKI_TOOL_CALL_CAP_MINUTES",
	"AIKI_DEPLOY_STATUS_FILE", "AIKI_TERMINALS", "AIKI_ZELLIJ", "AIKI_TIMEZONE", "AIKI_FUTURE_SETTING", "KEMIRI_FUTURE_SETTING", "KEMIRI_DATA_DIR",
];
const printEnvironment = 'console.log(JSON.stringify(process.env))';

function expectChild(env: Record<string, string | undefined>) {
	expect(Object.keys(env).filter((name) => name.startsWith("AIKI_")).sort()).toEqual(["AIKI_CHILD_PROCESS"]);
	expect(env.AIKI_CHILD_PROCESS).toBe("1");
 expect(env.KEMIRI_CHILD_PROCESS).toBe("1");
 expect(Object.keys(env).filter(name => name.startsWith("KEMIRI_"))).toEqual(["KEMIRI_CHILD_PROCESS"]);
}

test("server settings cannot bypass the private configuration through native environment reads", async () => {
	const nativeAccess: Record<string, string[]> = {};
	const root = join(import.meta.dir, "../src");
	for (const name of (await readdir(root, { recursive: true })).sort()) {
		if (!name.endsWith(".ts")) continue;
		const lines = (await readFile(join(root, name), "utf8")).split("\n").map(line => line.trim());
		const found = lines.filter(line => !/^(?:\/\*|\*|\/\/)/.test(line) && /\b(?:process|Bun)\s*(?:\.\s*env\b|\[\s*["']env["']\s*\])/.test(line));
		if (found.length) nativeAccess[name] = found;
	}
	// Exact boundary statements only: catches direct AIKI reads, computed keys, aliases and Bun.env routes.
	expect(nativeAccess).toEqual({
		"agent-execution-env.ts": ['env: childEnvironment({ ...(options?.inheritEnv === false ? {} : process.env), ...options?.env }),'],
		"child-environment.ts": ['env: Readonly<Record<string, string | undefined>> = process.env,'],
		"server-env.ts": ['export function loadServerEnv(env: Readonly<Record<string, string | undefined>> = process.env): Record<string, string | undefined> {'],
		"server-settings.ts": [
			'export let serverSettings: Readonly<Record<string, string | undefined>> = new Proxy(process.env, { get: (env, name) => typeof name === "string" ? environmentSetting(env, name) : Reflect.get(env, name) });',
			'for (const name of Object.keys(process.env)) if (privateSetting(name)) delete process.env[name];',
			'process.env.AIKI_CHILD_PROCESS = "1";',
   'process.env.KEMIRI_CHILD_PROCESS = "1";',
		],
		"terminals.ts": ['this.#baseEnv = options.env ?? { ...process.env };'],
	});
});

test("new host-process spawn sites require an environment audit", async () => {
	const found: Record<string, number> = {};
	for (const name of await readdir(join(import.meta.dir, "../src"))) {
		if (!name.endsWith(".ts")) continue;
		const text = await readFile(join(import.meta.dir, "../src", name), "utf8");
		const count = [...text.matchAll(/\bBun\.spawn(?:Sync)?\s*\(|(?<![.\w])(?:execFile|spawn)\s*\(/g)].length;
		if (!count) continue;
		found[name] = count;
		expect(text).toContain("childEnvironment");
	}
	// Update only after reviewing every new site's explicit env. This is an inventory tripwire, not a parser.
	expect(found).toEqual({ "artifacts.ts": 1, "host-commands.ts": 1, "jj.ts": 1, "memory.ts": 1, "server.ts": 1, "task-changes.ts": 1, "terminals.ts": 2 });
});

test("one scrubber removes all current and future installation settings, retaining tooling", () => {
	const parent = Object.fromEntries(settingNames.map((name) => [name, "parent-setting"]));
	const tooling = { PATH: "/usr/bin", HOME: "/tmp/example-home", LANG: "C.UTF-8", SSH_AUTH_SOCK: "/tmp/example-agent", HARNESS_ANDROID_DEVICE: "emulator-5554", ANDROID_HOME: "/tmp/example-sdk", TOOL_TOKEN: "synthetic" };
	const child = childEnvironment({ ...parent, ...tooling, ABSENT: undefined });
	expectChild(child);
	expect(child).toMatchObject(tooling);
	expect(child.ABSENT).toBeUndefined();
	expect(parent.AIKI_DATA_DIR).toBe("parent-setting");
});

test("pi execution and host commands do not merge real installation settings back in", async () => {
	const s = await setup();
	for (const name of settingNames) setEnvironment(name, join(s.root, "parent-setting"));
	setEnvironment("HARNESS_ANDROID_DEVICE", "emulator-5554");
	const env = new AgentExecutionEnv({ cwd: s.projectDir });
	for (const inheritEnv of [true, false]) {
		let output = "";
		const result = await env.exec([process.execPath, "-e", printEnvironment], {
			inheritEnv, env: { AIKI_DATA_DIR: s.dataDir, HARNESS_ANDROID_DEVICE: "emulator-5556" },
			onOutput: (text) => { output += text; },
		}, BACKGROUND_CONTEXT);
		expect(result.ok).toBe(true);
		const child = JSON.parse(output);
		expectChild(child);
		expect(child.HARNESS_ANDROID_DEVICE).toBe("emulator-5556");
	}
	const result = await runHostCommand(process.execPath, ["-e", printEnvironment], { timeoutMs: 5000 });
	expect(result.exitCode).toBe(0);
	expectChild(JSON.parse(result.stdout));
});

test("entry point captures file and real settings privately; commands and nested entry points are isolated", async () => {
	const s = await setup();
	const xdg = join(s.root, "xdg-config");
	await mkdir(join(xdg, "aiki"), { recursive: true });
	const file = join(xdg, "aiki/server.env");
	await writeFile(file, `KEMIRI_DATA_DIR=${s.dataDir}\nKEMIRI_CONFIG_DIR=${s.configDir}\nKEMIRI_PORT=8123\nKEMIRI_STATE_NAMESPACE=synthetic\nKEMIRI_CONTEXT_EXTENSION=synthetic-context\nKEMIRI_FUTURE_SETTING=private\n`);
	const env: Record<string, string> = {
		...childEnvironment(), HOME: s.root, XDG_CONFIG_HOME: xdg, XDG_DATA_HOME: join(s.root, "xdg-data"),
		KEMIRI_AGENT_DIR: s.agentDir, KEMIRI_CLAUDE_DIR: s.claudeDir, KEMIRI_PORT: "9234", KEMIRI_ENV_FILE: file,
	};
	delete env.KEMIRI_CHILD_PROCESS; // A service, not an agent's command.
	const script = `
		import { loadServerEnv, resolvedServerConfig } from ${source("server-env")};
		import { configureServerSettings } from ${source("server-settings")};
		import { childEnvironment } from ${source("child-environment")};
		import { AgentExecutionEnv } from ${source("agent-execution-env")};
		import { BACKGROUND_CONTEXT } from ${JSON.stringify(import.meta.resolve("@earendil-works/chord/context"))};
		const loaded = loadServerEnv();
		const fileLeaked = process.env.KEMIRI_FUTURE_SETTING !== undefined;
		configureServerSettings(loaded);
		const { BoardDoc } = await import(${source("board")});
		let output = "";
		const executed = await new AgentExecutionEnv({ cwd: process.cwd() }).exec([process.execPath, "-e", ${JSON.stringify(printEnvironment)}], { onOutput: (text) => { output += text; } }, BACKGROUND_CONTEXT);
		if (!executed.ok) throw executed.error;
		const child = JSON.parse(output);
		const configs = [];
		for (const explicit of [false, true]) {
			const env = childEnvironment();
			if (explicit) { env.KEMIRI_DATA_DIR = ${JSON.stringify(join(s.root, "explicit-data"))}; env.KEMIRI_CONFIG_DIR = ${JSON.stringify(join(s.root, "explicit-config"))}; }
			const nested = Bun.spawnSync([process.execPath, ${JSON.stringify(main)}, "--print-config"], { env });
			if (nested.exitCode !== 0) throw Error(nested.stderr.toString());
			configs.push(JSON.parse(nested.stdout.toString()));
		}
		console.log(JSON.stringify({ fileLeaked, config: resolvedServerConfig(), kind: BoardDoc.definition.kind, child, processEnvironment: process.env, configs }));
	`;
	const child = Bun.spawnSync([process.execPath, "-e", script], { env, cwd: s.projectDir });
	expect(child.stderr.toString()).toBe("");
	expect(child.exitCode).toBe(0);
	const result = JSON.parse(child.stdout.toString());
	expect(result.fileLeaked).toBe(false);
	expect(result.config).toMatchObject({ dataDir: s.dataDir, configDir: s.configDir, port: 9234, stateNamespace: "synthetic", contextExtension: "synthetic-context" });
	expect(result.kind).toBe("synthetic.board");
	expectChild(result.child);
	expectChild(result.processEnvironment);
	expect(result.configs[0]).toMatchObject({ dataDir: join(s.root, "xdg-data/kemiri"), configDir: join(xdg, "aiki"), port: 7317, stateNamespace: "aiki" });
	expect(result.configs[1]).toMatchObject({ dataDir: join(s.root, "explicit-data"), configDir: join(s.root, "explicit-config"), port: 7317 });
	// Explicit opt-in still reads an env file (needed by intentional owner CLI/deploy commands).
	const explicit = Bun.spawnSync([process.execPath, main, "--print-config"], { env: { ...childEnvironment(env), KEMIRI_ENV_FILE: file } });
	expect(explicit.exitCode).toBe(0);
	expect(JSON.parse(explicit.stdout.toString())).toMatchObject({ dataDir: s.dataDir, port: 8123 });
});

test("terminal PTYs use the same child environment", async () => {
	const s = await setup();
	const host = new TerminalHost({
		multiplexer: "none", command: [process.execPath, "-e", printEnvironment],
		env: { ...process.env, AIKI_DATA_DIR: s.dataDir, AIKI_ENV_FILE: join(s.root, "parent.env"), HARNESS_ANDROID_DEVICE: "emulator-5554" },
	});
	let output = "";
	const ended = Promise.withResolvers<void>();
	try {
		await host.open({ cwd: s.projectDir, cols: 100, rows: 30 }, {
			output: (bytes) => { output += new TextDecoder().decode(bytes); },
			resync: () => {}, closed: () => ended.resolve(),
		});
		await ended.promise;
		const child = JSON.parse(output);
		expectChild(child);
		expect(child.HARNESS_ANDROID_DEVICE).toBe("emulator-5554");
	} finally { await host.stop(); }
});

for (const kind of ["worker", "thread"] as const) test(`scheduled ${kind} commands share the scrubbed pi environment`, async () => {
	const s = await setup();
	setEnvironment("AIKI_DATA_DIR", s.dataDir);
	setEnvironment("AIKI_ENV_FILE", join(s.root, "parent.env"));
	const output = join(s.root, `${kind}-environment.json`);
	const command = `${shellQuote(process.execPath)} -e ${shellQuote(printEnvironment)} > ${shellQuote(output)}`;
	const client = await TestClient.open(s.server);
	clients.push(client);
	await client.hello();
	const added = await client.request({ type: "projects.add", path: s.projectDir });
	if (added.type !== "projects.add") throw Error(JSON.stringify(added));
	const projectId = added.project.id;
	const model = { provider: "faux", modelId: "faux-1" };
	await client.request({ type: "projects.configure", projectId, coordinatorModel: model, workerModels: [model] });
	const factory: FauxResponseFactory = (request) => {
		const last = request.messages.findLast((message) => message.role !== "system");
		if (last?.role === "user") return fauxAssistantMessage([fauxToolCall("bash", { command })], { stopReason: "toolUse" });
		return fauxAssistantMessage("scheduled environment checked");
	};
	s.faux.setResponses(Array.from({ length: 20 }, () => factory));
	const saved = await client.request({ type: "schedules.save", projectId, schedule: {
		title: "Check environment", brief: "Check command environment.", kind, enabled: false,
		spec: { kind: "interval", everyMinutes: 60 }, model, thinkingLevel: "low", isolation: "shared", onReport: "record",
	} });
	if (saved.type !== "schedules.save") throw Error(JSON.stringify(saved));
	const started = await client.request({ type: "schedules.run", projectId, scheduleId: saved.schedule.id });
	if (started.type !== "schedules.run") throw Error(JSON.stringify(started));
	expect(started.run.outcome).toBe("started");
	const view = new ViewClient(client);
	await view.start(projectId, kind === "worker" ? { workerId: started.run.workerId! } : { threadId: started.run.threadId! });
	await view.waitForView((value) => value.entries.some((entry) => entry.kind === "pi.assistant" && entryText(entry).includes("scheduled environment checked")));
	expectChild(JSON.parse(await readFile(output, "utf8")));
});

for (const tool of ["bash", "codemode"] as const) test(`${tool} runs a real scrubbed command through the harness`, async () => {
	const s = await setup();
	setEnvironment("AIKI_DATA_DIR", s.dataDir);
	setEnvironment("AIKI_ENV_FILE", join(s.root, "parent.env"));
	const output = join(s.root, `${tool}-environment.json`);
	const command = `${shellQuote(process.execPath)} -e ${shellQuote(printEnvironment)} > ${shellQuote(output)}`;
	const client = await TestClient.open(s.server);
	clients.push(client);
	await client.hello();
	const added = await client.request({ type: "projects.add", path: s.projectDir });
	if (added.type !== "projects.add") throw Error(JSON.stringify(added));
	const projectId = added.project.id;
	await client.request({ type: "projects.configure", projectId, coordinatorModel: { provider: "faux", modelId: "faux-1" } });
	s.faux.setResponses([
		fauxAssistantMessage([fauxToolCall(tool, tool === "bash" ? { command } : { code: `await tools.bash({ command: ${JSON.stringify(command)} });` })], { stopReason: "toolUse" }),
		fauxAssistantMessage("environment checked"),
	]);
	const view = new ViewClient(client);
	await view.start(projectId);
	await client.request({ type: "conversation.submit", projectId, requestId: `check-${tool}`, content: "Check command environment." });
	await view.waitForView((value) => value.entries.some((entry) => entry.kind === "pi.assistant" && entryText(entry).includes("environment checked")));
	expectChild(JSON.parse(await readFile(output, "utf8")));
});
