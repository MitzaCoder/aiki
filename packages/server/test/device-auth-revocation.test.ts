import { expect, test } from "bun:test";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
import { encodePairingFragment, encodeTerminalFrame, TERMINAL_FRAME, decodeTerminalFrame, encodeTerminalAck } from "@kemiri/protocol";
import { mkdtemp, mkdir, rm, writeFile, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { authCleanup, authSetup, authPost, authClient, claimProof, httpEnroll, until } from "./device-auth-test-support.ts";
import { ViewClient, entryText } from "./support.ts";

async function artifactFixture(s: Awaited<ReturnType<typeof authSetup>>, client: Awaited<ReturnType<typeof authClient>>["client"], bytes: number) {
	const added = await client.request({ type: "projects.add", path: s.projectDir });
	if (added.type !== "projects.add") throw new Error("fixture project failed");
	const sourcePath = join(s.projectDir, "synthetic.bin");
	await writeFile(sourcePath, new Uint8Array(bytes));
	const artifact = await s.server.artifacts.save({ projectId: added.project.id, sourcePath, title: null, note: null, threadId: "main", workerId: null, taskId: null });
	const signed = await client.request({ type: "artifacts.url", projectId: added.project.id, artifactId: artifact.id });
	if (signed.type !== "artifacts.url") throw new Error("fixture URL failed");
	return signed.url;
}

test("revocation aborts a real in-flight artifact response, rejects HEAD/range and removes both push transports", async () => {
	const s = await authSetup();
	const credentials = await httpEnroll(s);
	const { client } = await authClient(s, credentials);
	const url = await artifactFixture(s, client, 32 * 1024 * 1024);
	const unused = await client.request({ type: "auth.pairings.create" });
	if (unused.type !== "auth.pairings.create") throw new Error("fixture grant failed");
	const revoker = await authClient(s, await httpEnroll(s));
	const common = { label: "Synthetic phone", backendKey: "example", preferences: { kinds: [], mutedProjects: [], quietHours: null } };
	for (const registration of [
		{ type: "notifications.registerFcm" as const, deviceId: "synthetic-fcm", token: "synthetic-fcm-token", ...common },
		{ type: "notifications.register" as const, deviceId: "synthetic-web", subscription: { endpoint: "https://push.example.com/subscription", keys: { p256dh: "synthetic-key", auth: "synthetic-auth" } }, ...common },
	]) expect((await client.request(registration)).type).toBe(registration.type);
	const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
	expect(response.status).toBe(200);
	const reader = response.body!.getReader();
	expect((await reader.read()).done).toBe(false);
	expect((await revoker.client.request({ type: "auth.devices.revoke", sessionId: credentials.sessionId })).type).toBe("auth.devices.revoke");
	let received = 0;
	let aborted = false;
	try {
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			received += value.length;
		}
	} catch { aborted = true; }
	expect(aborted).toBe(true);
	expect(received).toBeLessThan(32 * 1024 * 1024);
	for (const options of [{ method: "HEAD" }, { headers: { range: "bytes=0-3" } }])
		expect((await fetch(url, { ...options, signal: AbortSignal.timeout(3000) })).status).toBe(403);
	for (const deviceId of ["synthetic-fcm", "synthetic-web"]) expect(s.server.notifications.device(deviceId)).toBeNull();
	expect((await authPost(s, "/auth/pairings/redeem", { grantId: unused.pairing.id, secret: unused.secret, ...claimProof() })).status).toBe(409);
	// Service-level assertion supplements the closed-socket black-box assertion: no late registration race can restore it.
	await expect(s.server.notifications.register({ deviceId: "synthetic-fcm", sessionId: credentials.sessionId, fcmToken: "synthetic-fcm-token", ...common })).rejects.toThrow("auth_revoked");
	expect((await authClient(s, credentials)).hello).toMatchObject({ type: "error", error: { code: "auth_revoked" } });
});

test("required cutover refuses legacy artifact URLs minted by an anonymous optional client", async () => {
	const s = await authSetup({ auth: { mode: "optional" } });
	const { client } = await authClient(s);
	const url = await artifactFixture(s, client, 64);
	expect((await fetch(url, { method: "HEAD" })).status).toBe(200);
	s.server.auth.setMode("required");
	expect((await fetch(url, { method: "HEAD" })).status).toBe(403);
});

test("revocation cancels queued device inputs without cancelling the already running host turn", async () => {
	const s = await authSetup();
	const targetCredentials = await httpEnroll(s);
	const target = await authClient(s, targetCredentials);
	const observer = await authClient(s, await httpEnroll(s));
	const added = await observer.client.request({ type: "projects.add", path: s.projectDir });
	if (added.type !== "projects.add") throw new Error("fixture project failed");
	const projectId = added.project.id;
	await observer.client.request({ type: "projects.configure", projectId, coordinatorModel: { provider: "faux", modelId: "faux-1" }, coordinatorThinkingLevel: "low" });
	let release = () => {};
	const held = new Promise<void>(resolve => { release = resolve; });
	let reached = false;
	s.faux.setResponses([
		async () => { reached = true; await held; return fauxAssistantMessage([fauxToolCall("bash", { command: "echo synthetic" })], { stopReason: "toolUse" }); },
		fauxAssistantMessage("Host turn completed."),
	]);
	const view = new ViewClient(observer.client);
	await view.start(projectId);
	try {
		expect(await target.client.request({ type: "conversation.submit", projectId, requestId: "started", content: "Host turn" })).toMatchObject({ status: "placed" });
		await until(() => reached);
		expect(await target.client.request({ type: "conversation.submit", projectId, requestId: "withdraw-on-revoke", content: "Must not run", whenBusy: "steer" })).toMatchObject({ status: "queued" });
		await view.waitForView(v => v.queued?.length === 1);
		await s.server.auth.revoke(targetCredentials.sessionId);
		await target.client.closed();
		await view.waitForView(v => v.queued === undefined);
		release();
		const finished = await view.waitForView(v => v.entries.some(e => entryText(e) === "Host turn completed."));
		expect(finished.entries.filter(e => e.kind === "pi.user").map(entryText)).toEqual(["Host turn"]);
		expect((await observer.client.request({ type: "projects.list" })).type).toBe("projects.list");
	} finally { release(); }
});

test("full auth, pairing, refresh, signed artifact and revocation flow never logs secrets", async () => {
	const logs: string[] = [];
	const s = await authSetup({ log: line => logs.push(line) });
	const bootstrap = s.server.auth.bootstrap();
	const firstClaim = claimProof();
	const enrolled = await authPost(s, "/auth/bootstrap/redeem", { requestId: bootstrap.requestId, code: bootstrap.secret, ...firstClaim });
	const { credentials } = await enrolled.json() as { credentials: Awaited<ReturnType<typeof httpEnroll>> };
	const { client } = await authClient(s, credentials);
	const pairing = await client.request({ type: "auth.pairings.create" });
	if (pairing.type !== "auth.pairings.create") throw new Error("fixture grant failed");
	const fragment = encodePairingFragment({ backendId: s.server.auth.backendId, backendOrigin: "https://backend.example.com", grantId: pairing.pairing.id, secret: pairing.secret });
	const secondClaim = claimProof();
	expect((await authPost(s, "/auth/pairings/redeem", { grantId: pairing.pairing.id, secret: pairing.secret, ...secondClaim })).status).toBe(200);
	await client.request({ type: "auth.pairings.approve", grantId: pairing.pairing.id, claimId: secondClaim.claimId });
	const delivered = await (await authPost(s, "/auth/claims/poll", secondClaim)).json() as { credentials: typeof credentials };
	expect((await authPost(s, "/auth/claims/ack", secondClaim)).status).toBe(200);
	const refreshed = await (await authPost(s, "/auth/session/refresh", {}, { authorization: `Bearer ${credentials.sessionToken}` })).json() as { accessToken: string };
	await client.request({ type: "auth.renew", accessToken: refreshed.accessToken });
	const url = await artifactFixture(s, client, 64);
	expect((await fetch(url, { method: "HEAD" })).status).toBe(200);
	await s.server.auth.revoke(credentials.sessionId);
	const output = logs.join("\n");
	expect(output).toContain("auth: revoke");
	for (const secret of [bootstrap.secret, firstClaim.claimSecret, secondClaim.claimSecret, credentials.sessionToken, credentials.accessToken, delivered.credentials.sessionToken, delivered.credentials.accessToken, refreshed.accessToken, pairing.secret, fragment, url, new URL(url).search]) expect(output).not.toContain(secret);
});

test.skipIf(Bun.which("zellij") === null)("live revocation stops binary output and detaches, but the zellij host job survives", async () => {
	const root = await mkdtemp(join(tmpdir(), "aiki-auth-pty-"));
	await mkdir(join(root, "home"));
	authCleanup(async () => {
		// Only test-owned zellij processes name this unique socket directory.
		for (const entry of await readdir("/proc")) {
			if (!/^\d+$/.test(entry) || Number(entry) === process.pid) continue;
			try { if ((await readFile(`/proc/${entry}/cmdline`, "utf8")).includes(root)) process.kill(Number(entry), "SIGKILL"); } catch {}
		}
		await rm(root, { recursive: true, force: true });
	});
	const s = await authSetup({ terminals: {
		multiplexer: "zellij", survive: "off", configFile: join(root, "zellij.kdl"),
		env: { PATH: process.env.PATH, HOME: join(root, "home"), SHELL: Bun.which("bash")!, ZELLIJ_SOCKET_DIR: join(root, "sock"), XDG_CACHE_HOME: join(root, "cache"), XDG_CONFIG_HOME: join(root, "config"), PS1: "$ " },
	} });
	const credentials = await httpEnroll(s);
	const target = await authClient(s, credentials);
	const observer = await authClient(s, await httpEnroll(s));
	const terminal = await target.client.request({ type: "terminal.open", session: "auth-revoke", cols: 80, rows: 24 });
	if (terminal.type !== "terminal.open") throw new Error("fixture terminal failed");
	const input = (command: string) => encodeTerminalFrame(TERMINAL_FRAME.input, terminal.terminalId, new TextEncoder().encode(command));
	target.client.onBinary(raw => {
		const frame = decodeTerminalFrame(raw);
		if (frame?.kind === TERMINAL_FRAME.output) target.client.sendBinary(encodeTerminalAck(frame.terminalId, frame.payload.length));
	});
	const marker = join(root, "host-alive");
	target.client.sendBinary(input(`while true; do date +%s%N > '${marker}'; printf tick; sleep 0.1; done\r`));
	await until(async () => { try { return (await readFile(marker)).length > 0; } catch { return false; } }, 20_000);
	await s.server.auth.revoke(credentials.sessionId);
	await target.client.closed();
	await until(() => s.server.terminals?.attachedCount === 0);
	const frames = target.client.binaryFrames.length;
	const before = await readFile(marker, "utf8");
	await until(async () => (await readFile(marker, "utf8")) !== before);
	expect(target.client.binaryFrames.length).toBe(frames);
	const listed = await observer.client.request({ type: "terminal.list" });
	expect(listed).toMatchObject({ sessions: [expect.objectContaining({ name: "auth-revoke", exited: false, attached: false })] });
	expect((await observer.client.request({ type: "terminal.kill", session: "auth-revoke" })).type).toBe("terminal.kill");
}, 30_000);
