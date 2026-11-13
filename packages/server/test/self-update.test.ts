import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ReleaseUpdateState, SelfUpdateState } from "@kemiri/protocol";
import { ToolCallDrain } from "../src/drain.ts";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { SelfUpdate, selfUpdateDisabledReason } from "../src/self-update.ts";
import { createSetup, TestClient } from "./support.ts";
import { authSecret } from "../src/device-auth.ts";
import { applySelfUpdate } from "../../../scripts/installed-supervisor.ts";

const cleanup: (() => void)[] = [];
afterEach(() => { for (const close of cleanup.splice(0)) close(); });
const updates: ReleaseUpdateState = { schemaVersion: 1, enabled: true, installedVersion: "v0.1.0-pilot.2", channel: "pilot", available: { version: "v0.1.0-pilot.3", notesUrl: "https://example.test/notes" }, dismissedVersion: null };
async function settle(predicate: () => boolean) { for (let i = 0; i < 100 && !predicate(); i++) await Bun.sleep(5); expect(predicate()).toBe(true); }
function fixture(stage: () => Promise<void> = async () => {}) {
	const root = mkdtempSync(join(tmpdir(), "aiki-self-update-"));
	let busy = { conversations: 1, workers: 1, toolCalls: 1 };
	let now = 0;
	const drain = new ToolCallDrain({ log: () => {} });
	Object.defineProperty(drain, "toolCalls", { get: () => busy.toolCalls });
	Object.defineProperty(drain, "runningCommands", { get: () => busy.toolCalls ? [{ label: "bun test", started: 0 }] : [] });
	const log: string[] = [];
	const service = new SelfUpdate({ root, disabledReason: null, updates: () => updates, drain, now: () => now, stage, onChange: () => {}, log: line => log.push(line) });
	cleanup.push(() => { service.stop(); drain.end(); rmSync(root, { recursive: true, force: true }); });
	return { service, log, drain, advance: (ms: number) => { now += ms; }, setBusy: (value: typeof busy) => { busy = value; } };
}
const start = { action: "start" as const, version: updates.available!.version };

test("holds new calls as soon as ready; only executing calls delay the restart, never turns/workers", async () => {
	const { service, setBusy, log, drain } = fixture();
	await service.request(start, "synthetic-owner");
	await settle(() => service.state.message.includes("bun test"));
	expect(service.state.message).toBe("Waiting for 1 running command (bun test, 0s)…");
	let released = false;
	void drain.hold(BACKGROUND_CONTEXT).then(() => { released = true; });
	await Bun.sleep(10); expect(released).toBe(false);
	await expect(service.request(start, "another-owner")).rejects.toThrow("already");
	setBusy({ conversations: 7, workers: 9, toolCalls: 0 }); await service.tick();
	expect(service.state.phase).toBe("restarting"); expect(released).toBe(false);
	expect(log[0]).toContain("synthetic-owner");
});
test("no running calls restarts immediately, even with active turns", async () => {
	const { service, setBusy } = fixture();
	setBusy({ conversations: 3, workers: 2, toolCalls: 0 });
	await service.request(start, "owner"); await settle(() => service.state.phase === "restarting");
});
test("cap prompts without releasing calls; cancel releases; force is separate and capped", async () => {
	const { service, drain, advance } = fixture();
	await service.request(start, "owner"); await settle(() => service.state.message.includes("bun test"));
	await expect(service.request({ ...start, action: "force" }, "owner")).rejects.toThrow("wait limit");
	let released = false;
	const held = drain.hold(BACKGROUND_CONTEXT).then(() => { released = true; });
	advance(180_000); await service.tick();
	expect(service.state.message).toContain("bun test, 3m"); expect(service.state.restartAllowed).toBe(false);
	advance(120_000); await service.tick(); expect(service.state.restartAllowed).toBe(true);
	expect(service.state.phase).toBe("waiting"); expect(released).toBe(false);
	await service.request({ ...start, action: "cancel" }, "owner"); await held;
	expect(service.state.phase).toBe("cancelled"); expect(released).toBe(true);
	await service.request(start, "owner"); await settle(() => service.state.phase === "waiting");
	advance(300_000); await service.tick();
	await service.request({ ...start, action: "force" }, "owner"); expect(service.state.phase).toBe("restarting");
});
test("verification failure never requests a restart", async () => {
	const { service } = fixture(async () => { throw new Error("SHA256SUMS mismatch"); });
	await service.request(start, "owner"); await settle(() => service.state.phase === "failed");
	expect(service.state.message).toContain("SHA256SUMS mismatch");
});
test("stale target, source and watcher installs fail closed", async () => {
	const { service } = fixture();
	await expect(service.request({ ...start, version: "v99.0.0" }, "owner")).rejects.toThrow("changed");
	expect(selfUpdateDisabledReason({}, false)).toContain("development");
	expect(selfUpdateDisabledReason({ KEMIRI_INSTALL_DIR: "/synthetic" }, true)).toContain("deploy watcher");
});
for (const failure of ["none", "health", "activate"] as const) test(`supervisor transaction: ${failure}`, async () => {
	const { service } = fixture(); const events: string[] = []; const states: SelfUpdateState[] = [];
	let checks = 0;
	await applySelfUpdate({ state: { ...service.state, toVersion: "v0.1.0-pilot.3" }, publish: state => states.push(state),
		stop: async () => { events.push("stop"); }, activate: async () => { events.push("activate"); if (failure === "activate") throw new Error("activation failed"); },
		start: () => { events.push("start"); }, health: async () => { events.push("health"); return ++checks > 1 || failure !== "health"; },
		rollback: async () => { events.push("rollback"); },
	});
	expect(states.at(-1)?.phase).toBe(failure === "none" ? "succeeded" : "rolled_back");
	if (failure === "none") expect(events).toEqual(["stop", "activate", "start", "health"]);
	else expect(events).toContain("rollback");
});
test("the final admission hold prevents a read from opening/resuming another project", async () => {
	const setup = await createSetup({ terminals: false });
	try {
		const project = await setup.server.manager.add(setup.projectDir);
		setup.server.manager.restartHolding = true;
		await expect(setup.server.manager.open(project.id)).rejects.toThrow("restarting for an update");
		setup.server.manager.restartHolding = false;
		expect((await setup.server.manager.open(project.id)).project.id).toBe(project.id);
	} finally { await setup.cleanup(); }
});

test("network update requests require a paired owner, even with authentication off", async () => {
	const setup = await createSetup({ terminals: false });
	const client = await TestClient.open(setup.server);
	try {
		await client.hello();
		const answer = await client.request({ type: "server.update", ...start });
		expect(answer.type).toBe("error");
		if (answer.type === "error") expect(answer.error.code).toBe("auth_required");
	} finally { client.close(); await setup.cleanup(); }
});

test("a paired owner receives the explicit checkout restriction, not an install attempt", async () => {
	const setup = await createSetup({ auth: { mode: "required" }, terminals: false });
	const grant = setup.server.auth.bootstrap();
	const enrolled = await setup.server.auth.redeem({ grantId: grant.requestId, secret: grant.secret, claimId: crypto.randomUUID(), claimSecret: authSecret("aiki_c1"), label: "Synthetic owner", platform: "web" }, "loopback", true);
	const client = await TestClient.open(setup.server);
	try {
		await client.request({ type: "hello", protocolVersion: 1, auth: { accessToken: enrolled.credentials!.accessToken } });
		const answer = await client.request({ type: "server.update", ...start });
		expect(answer.type).toBe("error");
		if (answer.type === "error") expect(answer.error.message).toContain("development checkouts");
	} finally { client.close(); await setup.cleanup(); }
});

test("rollback health failure is not reported as success", async () => {
	const { service } = fixture(); let last: SelfUpdateState | undefined;
	await applySelfUpdate({ state: service.state, publish: state => { last = state; }, stop: async () => {}, activate: async () => {}, start: () => {}, health: async () => false, rollback: async () => {} });
	expect(last?.phase).toBe("failed"); expect(last?.message).toContain("not healthy");
});
