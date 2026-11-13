import { afterEach, expect, test } from "bun:test";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
import { randomBytes } from "node:crypto";
import { mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { authSecret } from "../src/device-auth.ts";
import { createSetup, entryText, TestClient, ViewClient, type TestSetup } from "./support.ts";

const main = join(import.meta.dir, "../src/main.ts");
const setups: TestSetup[] = [];
const clients: TestClient[] = [];
afterEach(async () => {
	for (const client of clients.splice(0)) client.close();
	for (const s of setups.splice(0)) await s.cleanup();
});
const proof = () => ({ claimId: randomBytes(16).toString("hex"), claimSecret: authSecret("aiki_c1"), label: "Synthetic owner", platform: "web" });
const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;

async function fixture() {
	const s = await createSetup({ auth: { mode: "optional" }, terminals: false });
	setups.push(s);
	const config = join(s.root, ".config");
	await mkdir(join(config, "aiki"), { recursive: true });
	const file = join(config, "aiki/server.env");
	await writeFile(file, `KEMIRI_DATA_DIR=${JSON.stringify(s.dataDir)}\n`, { mode: 0o600 });
	const env = { PATH: process.env.PATH, HOME: s.root, XDG_CONFIG_HOME: config, XDG_DATA_HOME: join(s.root, "xdg-data") };
	return { s, file, env };
}

async function cli(env: Record<string, string | undefined>, args: string[]) {
	const child = Bun.spawn([process.execPath, main, ...args], { env, stdout: "pipe", stderr: "pipe", timeout: 5000 });
	const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
	expect({ code, stderr }).toEqual({ code: 0, stderr: "" });
	return JSON.parse(stdout);
}

for (const session of ["normal shell", "SSH shell", "explicit agent env file", "explicit agent data dir"] as const) {
	test(`${session}: owner CLI discovers and manages only its temp backend`, async () => {
		const { s, file, env } = await fixture();
		const childEnv: Record<string, string | undefined> = { ...env };
		if (session === "SSH shell") {
			childEnv.SSH_CONNECTION = "192.0.2.1 12345 192.0.2.2 22";
			delete childEnv.XDG_CONFIG_HOME; // Exercise HOME-based discovery too.
		}
		if (session.startsWith("explicit agent")) {
			childEnv.KEMIRI_CHILD_PROCESS = "1";
			if (session === "explicit agent env file") childEnv.KEMIRI_ENV_FILE = file;
			else childEnv.KEMIRI_DATA_DIR = s.dataDir;
		}
		expect(await cli(childEnv, ["--print-config"])).toMatchObject({ dataDir: s.dataDir });
		const run = (args: string[]) => cli(childEnv, ["auth", ...args]);
		expect(await run(["status"])).toEqual(s.server.auth.status());
		const pairing = await run(["pair", "--local"]);
		const secret = new URLSearchParams(new URL(pairing.url).hash.slice(1)).get("bootstrap")!;
		const enrolled = await s.server.auth.redeem({ grantId: "local", secret, ...proof() }, "loopback", true, true);
		const id = enrolled.credentials!.sessionId;
		expect(await run(["devices", "list"])).toMatchObject({ devices: [{ id }] });
		expect(await run(["devices", "revoke", id])).toEqual({ ok: true });
		expect(await run(["devices", "list"])).toEqual({ devices: [] });
		const claim = proof();
		await s.server.auth.migration(claim, "loopback");
		expect(await run(["migration", "list", "--pending", "--json"])).toMatchObject({ claims: [{ claimId: claim.claimId, state: "pending" }] });
		expect(await run(["migration", "approve", "--batch", "synthetic-batch", claim.claimId])).toEqual({ ok: true });
		expect(await run(["migration", "list", "--json"])).toMatchObject({ claims: [{ claimId: claim.claimId, state: "approved" }] });
		expect(await run(["mode", "required"])).toMatchObject({ mode: "required", backendId: s.server.auth.backendId });
		expect(await run(["mode", "optional"])).toMatchObject({ mode: "optional" });
	}, 15000);
}

test("real bash tool: marker-only owner CLI refuses even a live default data path; explicit routes succeed", async () => {
	const { s, file, env } = await fixture();
	// If the CLI silently falls back to its same-user defaults, this alias really reaches the fixture's owner socket.
	await mkdir(env.XDG_DATA_HOME, { recursive: true });
	await symlink(s.dataDir, join(env.XDG_DATA_HOME, "aiki"));
	const common = `HOME=${quote(s.root)} XDG_CONFIG_HOME=${quote(env.XDG_CONFIG_HOME)} XDG_DATA_HOME=${quote(env.XDG_DATA_HOME)}`;
	const routes = { marker: "", file: `KEMIRI_ENV_FILE=${quote(file)}`, directory: `KEMIRI_DATA_DIR=${quote(s.dataDir)}` };
	const command = Object.entries(routes).map(([name, explicit]) => {
		const base = join(s.root, name);
		return `${common} ${explicit} ${quote(process.execPath)} ${quote(main)} auth status >${quote(base + ".json")} 2>${quote(base + ".err")}; code=$?; printf '%s' "$code" >${quote(base + ".exit")}`;
	}).join("; ");
	const client = await TestClient.open(s.server);
	clients.push(client);
	await client.hello();
	const added = await client.request({ type: "projects.add", path: s.projectDir });
	if (added.type !== "projects.add") throw Error(JSON.stringify(added));
	const projectId = added.project.id;
	await client.request({ type: "projects.configure", projectId, coordinatorModel: { provider: "faux", modelId: "faux-1" } });
	s.faux.setResponses([
		fauxAssistantMessage([fauxToolCall("bash", { command })], { stopReason: "toolUse" }),
		fauxAssistantMessage("owner CLI routes checked"),
	]);
	const view = new ViewClient(client);
	await view.start(projectId);
	await client.request({ type: "conversation.submit", projectId, requestId: "owner-cli-routes", content: "Check deliberate owner CLI targeting." });
	await view.waitForView(value => value.entries.some(entry => entry.kind === "pi.assistant" && entryText(entry).includes("owner CLI routes checked")));
	expect(await readFile(join(s.root, "marker.exit"), "utf8")).toBe("1");
	expect(await readFile(join(s.root, "marker.err"), "utf8")).toContain("requires explicit KEMIRI_ENV_FILE or KEMIRI_DATA_DIR");
	expect(await readFile(join(s.root, "marker.json"), "utf8")).toBe("");
	for (const name of ["file", "directory"]) {
		expect(await readFile(join(s.root, name + ".exit"), "utf8")).toBe("0");
		expect(JSON.parse(await readFile(join(s.root, name + ".json"), "utf8"))).toEqual(s.server.auth.status());
	}
});
