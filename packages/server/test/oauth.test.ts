import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type { AuthLogin, ServerMessage } from "@aiki/protocol";
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadOrCreateDeviceId } from "../src/device-id.ts";
import {
	FAKE_ACCESS_TOKEN,
	FAKE_GOOD_CODE,
	FAKE_PROVIDER_ID,
	FAKE_REFRESH_TOKEN,
	fakeOAuthProvider,
	type FakeOAuthControls,
} from "./fake-oauth-provider.ts";
import { TestClient, createSetup, errorOf, type TestSetup } from "./support.ts";

const DEVICE_ID = "1c0e2f7a-3b46-4d4f-8f4a-2d9f9c0a1b2c";

function loginOf(message: ServerMessage): AuthLogin | undefined {
	return message.type === "credentials.login" ? message.login : undefined;
}

async function waitForLogin(
	client: TestClient,
	loginId: string,
	predicate: (login: AuthLogin) => boolean,
): Promise<AuthLogin> {
	const message = await client.waitFor((candidate) => {
		const login = loginOf(candidate);
		return login !== undefined && login.id === loginId && predicate(login);
	});
	return loginOf(message)!;
}

async function startLogin(client: TestClient, providerId = FAKE_PROVIDER_ID): Promise<AuthLogin> {
	const response = await client.request({ type: "credentials.loginStart", providerId });
	if (response.type !== "credentials.loginStart") throw new Error(`loginStart failed: ${response.type}`);
	return response.login;
}

async function answer(client: TestClient, loginId: string, promptId: string, value: string): Promise<void> {
	const response = await client.request({ type: "credentials.loginAnswer", loginId, promptId, value });
	if (response.type !== "credentials.loginAnswer") throw errorOf(response);
}

async function completeLogin(client: TestClient): Promise<AuthLogin> {
	const started = await startLogin(client);
	const select = await waitForLogin(client, started.id, (login) => login.prompt?.type === "select");
	await answer(client, started.id, select.prompt!.id, "browser");
	const manual = await waitForLogin(client, started.id, (login) => login.prompt?.type === "manual_code");
	await answer(client, started.id, manual.prompt!.id, FAKE_GOOD_CODE);
	return waitForLogin(client, started.id, (login) => login.status === "succeeded");
}

describe("OAuth subscription logins", () => {
	let setup: TestSetup;
	let controls: FakeOAuthControls;
	let client: TestClient;
	let logs: string[];

	beforeEach(async () => {
		logs = [];
		const fake = fakeOAuthProvider();
		controls = fake.controls;
		setup = await createSetup({
			configureModels: (models) => models.setProvider(fake.provider),
			logins: { deviceId: () => DEVICE_ID, agentName: "aiki-test", idleTimeoutMs: 0 },
			log: (message) => logs.push(message),
		});
		client = await TestClient.open(setup.server);
		await client.hello();
	});

	afterEach(async () => {
		client.close();
		await setup.cleanup();
	});

	it("relays prompts and notifications, then stores the credential", async () => {
		const started = await startLogin(client);
		expect(started.providerId).toBe(FAKE_PROVIDER_ID);
		expect(started.status).toBe("working");
		expect(started.events).toEqual([]);

		const select = await waitForLogin(client, started.id, (login) => login.prompt?.type === "select");
		expect(select.prompt?.message).toContain("Select a fake login method");
		expect(select.prompt?.options?.map((option) => option.id)).toEqual(["browser", "fail"]);

		await answer(client, started.id, select.prompt!.id, "browser");

		const manual = await waitForLogin(client, started.id, (login) => login.prompt?.type === "manual_code");
		expect(manual.prompt?.placeholder).toContain("callback");
		expect(manual.events.map((event) => event.type)).toEqual(["info", "auth_url"]);
		const authUrl = manual.events.find((event) => event.type === "auth_url");
		expect(authUrl?.type === "auth_url" ? authUrl.url : "").toContain("code_challenge");
		const info = manual.events.find((event) => event.type === "info");
		expect(info?.type === "info" ? info.links?.[0]?.label : undefined).toBe("Fake help");

		await answer(client, started.id, manual.prompt!.id, FAKE_GOOD_CODE);
		const done = await waitForLogin(client, started.id, (login) => login.status === "succeeded");
		expect(done.prompt).toBeUndefined();
		expect(done.error).toBeUndefined();
		expect(done.events.map((event) => event.type)).toEqual(["info", "auth_url", "progress"]);

		const stored = await setup.credentials.read(FAKE_PROVIDER_ID);
		expect(stored?.type).toBe("oauth");
		expect(stored?.type === "oauth" ? stored.access : undefined).toBe(FAKE_ACCESS_TOKEN);
		expect(stored?.type === "oauth" ? stored.refresh : undefined).toBe(FAKE_REFRESH_TOKEN);

		const listed = await client.request({ type: "credentials.list" });
		if (listed.type !== "credentials.list") throw new Error(`unexpected ${listed.type}`);
		expect(listed.credentials).toEqual([{ providerId: FAKE_PROVIDER_ID, type: "oauth" }]);

		const catalog = await client.request({ type: "models.list" });
		if (catalog.type !== "models.list") throw new Error(`unexpected ${catalog.type}`);
		const provider = catalog.providers.find((entry) => entry.id === FAKE_PROVIDER_ID);
		expect(provider?.configured).toBe(true);
		expect(provider?.authType).toBe("oauth");
		expect(provider?.oauth).toEqual({
			name: "Fake Subscription (OAuth)",
			loginLabel: "Sign in with Fake",
			isSubscription: true,
		});

		// The device ID and agent name reach flows that identify the installation, like Sign in with ChatGPT.
		expect(controls.lastDeviceId).toBe(DEVICE_ID);
		expect(controls.lastAgentName).toBe("aiki-test");

		// Secrets stay on the server: neither tokens nor the pasted code appear on the wire or in the log.
		const transcript = JSON.stringify(client.messages);
		expect(transcript).not.toContain(FAKE_ACCESS_TOKEN);
		expect(transcript).not.toContain(FAKE_REFRESH_TOKEN);
		expect(transcript).not.toContain(FAKE_GOOD_CODE);
		expect(logs.join("\n")).not.toContain(FAKE_ACCESS_TOKEN);
		expect(logs.join("\n")).not.toContain(FAKE_REFRESH_TOKEN);
		expect(logs.join("\n")).not.toContain(FAKE_GOOD_CODE);
	});

	it("rejoins a running login from a reloaded client, with its prompt and history", async () => {
		const started = await startLogin(client);
		const select = await waitForLogin(client, started.id, (login) => login.prompt?.type === "select");
		await answer(client, started.id, select.prompt!.id, "browser");
		const manual = await waitForLogin(client, started.id, (login) => login.prompt?.type === "manual_code");

		// A page reload: the socket goes away and a new one arrives with no local state.
		client.close();
		const reloaded = await TestClient.open(setup.server);
		try {
			await reloaded.hello();
			const response = await reloaded.request({ type: "credentials.logins" });
			if (response.type !== "credentials.logins") throw new Error(`unexpected ${response.type}`);
			expect(response.logins.map((login) => login.id)).toEqual([started.id]);
			const resumed = response.logins[0]!;
			expect(resumed.status).toBe("prompt");
			expect(resumed.prompt?.id).toBe(manual.prompt!.id);
			expect(resumed.events.map((event) => event.type)).toEqual(["info", "auth_url"]);

			await answer(reloaded, resumed.id, resumed.prompt!.id, FAKE_GOOD_CODE);
			await waitForLogin(reloaded, resumed.id, (login) => login.status === "succeeded");
		} finally {
			reloaded.close();
		}
		expect((await setup.credentials.read(FAKE_PROVIDER_ID))?.type).toBe("oauth");
	});

	it("cancels a running login without storing anything", async () => {
		const started = await startLogin(client);
		const select = await waitForLogin(client, started.id, (login) => login.prompt?.type === "select");

		const response = await client.request({ type: "credentials.loginCancel", loginId: started.id });
		if (response.type !== "credentials.loginCancel") throw new Error(`unexpected ${response.type}`);
		expect(response.cancelled).toBe(true);
		await waitForLogin(client, started.id, (login) => login.status === "cancelled");

		expect(controls.aborts).toBeGreaterThan(0);
		expect(await setup.credentials.read(FAKE_PROVIDER_ID)).toBeUndefined();
		expect(await client.request({ type: "credentials.logins" })).toMatchObject({
			logins: [{ id: started.id, status: "cancelled" }],
		});

		// The prompt is gone, so a late answer is refused instead of reaching the provider.
		const late = await client.request({
			type: "credentials.loginAnswer",
			loginId: started.id,
			promptId: select.prompt!.id,
			value: FAKE_GOOD_CODE,
		});
		expect(errorOf(late).code).toBe("bad_request");

		const again = await client.request({ type: "credentials.loginCancel", loginId: started.id });
		expect(again.type === "credentials.loginCancel" ? again.cancelled : undefined).toBe(false);
	});

	it("reports a failed login, keeps the secret out of the error, and lets a retry start", async () => {
		const started = await startLogin(client);
		const select = await waitForLogin(client, started.id, (login) => login.prompt?.type === "select");
		await answer(client, started.id, select.prompt!.id, "fail");
		const manual = await waitForLogin(client, started.id, (login) => login.prompt?.type === "manual_code");

		await answer(client, started.id, manual.prompt!.id, FAKE_GOOD_CODE);
		const failed = await waitForLogin(client, started.id, (login) => login.status === "failed");
		expect(failed.error).toContain("rejected");
		expect(failed.error).not.toContain(FAKE_GOOD_CODE);
		expect(await setup.credentials.read(FAKE_PROVIDER_ID)).toBeUndefined();
		expect(JSON.stringify(client.messages)).not.toContain(FAKE_GOOD_CODE);

		const retried = await startLogin(client);
		expect(retried.id).not.toBe(started.id);
		const listed = await client.request({ type: "credentials.logins" });
		if (listed.type !== "credentials.logins") throw new Error(`unexpected ${listed.type}`);
		expect(listed.logins.map((login) => login.id)).toEqual([retried.id]);
	});

	it("answers the same running login instead of starting another", async () => {
		const first = await startLogin(client);
		await waitForLogin(client, first.id, (login) => login.prompt !== undefined);
		const second = await startLogin(client);
		expect(second.id).toBe(first.id);
		expect(controls.loginCalls).toBe(1);
	});

	it("logs out, and a logout cancels a running login", async () => {
		await completeLogin(client);

		const started = await startLogin(client);
		await waitForLogin(client, started.id, (login) => login.prompt?.type === "select");
		const removedWhileRunning = await client.request({
			type: "credentials.delete",
			providerId: FAKE_PROVIDER_ID,
		});
		if (removedWhileRunning.type !== "credentials.delete") throw new Error(`unexpected ${removedWhileRunning.type}`);
		expect(removedWhileRunning.deleted).toBe(true);
		await waitForLogin(client, started.id, (login) => login.status === "cancelled");
		expect(await setup.credentials.read(FAKE_PROVIDER_ID)).toBeUndefined();

		const removed = await client.request({ type: "credentials.delete", providerId: FAKE_PROVIDER_ID });
		if (removed.type !== "credentials.delete") throw new Error(`unexpected ${removed.type}`);
		expect(removed.deleted).toBe(false);
	});

	it("refuses a provider without OAuth, and an unknown provider", async () => {
		const noOAuth = await client.request({ type: "credentials.loginStart", providerId: "faux" });
		expect(errorOf(noOAuth).code).toBe("bad_request");
		expect(errorOf(noOAuth).message).toContain("OAuth");

		const unknown = await client.request({ type: "credentials.loginStart", providerId: "nope" });
		expect(errorOf(unknown).code).toBe("unknown_provider");
	});

	it("refuses an answer for a login or prompt that is not waiting", async () => {
		const unknown = await client.request({
			type: "credentials.loginAnswer",
			loginId: "login-999",
			promptId: "p1",
			value: "x",
		});
		expect(errorOf(unknown).code).toBe("unknown_login");

		const started = await startLogin(client);
		await waitForLogin(client, started.id, (login) => login.prompt !== undefined);
		const stale = await client.request({
			type: "credentials.loginAnswer",
			loginId: started.id,
			promptId: "prompt-from-another-login",
			value: "x",
		});
		expect(errorOf(stale).code).toBe("bad_request");
	});
});

describe("device ID", () => {
	it("creates a private stable ID and replaces a malformed one", async () => {
		const root = await mkdtemp(join(tmpdir(), "mh-device-id-"));
		const path = join(root, "device-id");
		try {
			const created = await loadOrCreateDeviceId(path);
			expect(created).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
			expect(await loadOrCreateDeviceId(path)).toBe(created);
			expect((await stat(path)).mode & 0o777).toBe(0o600);

			await writeFile(path, "not-a-uuid\n");
			const replaced = await loadOrCreateDeviceId(path);
			expect(replaced).not.toBe(created);
			expect(await loadOrCreateDeviceId(path)).toBe(replaced);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
});

describe("OAuth login idle timeout", () => {
	it("abandons a login nobody answers", async () => {
		const fake = fakeOAuthProvider();
		const setup = await createSetup({
			configureModels: (models) => models.setProvider(fake.provider),
			logins: { deviceId: () => DEVICE_ID, idleTimeoutMs: 100 },
		});
		const client = await TestClient.open(setup.server);
		try {
			await client.hello();
			const started = await startLogin(client);
			await waitForLogin(client, started.id, (login) => login.prompt !== undefined);
			const failed = await waitForLogin(client, started.id, (login) => login.status === "failed");
			expect(failed.error).toContain("timed out");
			expect(await setup.credentials.read(FAKE_PROVIDER_ID)).toBeUndefined();
			expect(fake.controls.aborts).toBeGreaterThan(0);
		} finally {
			client.close();
			await setup.cleanup();
		}
	});
});
