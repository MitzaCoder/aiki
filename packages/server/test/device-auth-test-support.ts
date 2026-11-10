/** Real transports and synthetic proofs for the independent device-auth acceptance tests. */
import { afterEach, expect } from "bun:test";
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { authSecret, type SessionCredentials } from "../src/device-auth.ts";
import { createSetup, TestClient, type TestSetup } from "./support.ts";

const cleanups: (() => Promise<void>)[] = [];
export function authCleanup(cleanup: () => Promise<void>) { cleanups.push(cleanup); }
afterEach(async () => {
	for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
export const claimProof = (label = "Synthetic browser", platform = "web") => ({
	claimId: randomBytes(16).toString("hex"),
	claimSecret: authSecret("aiki_c1"),
	label,
	platform,
});
export async function authSetup(options: Parameters<typeof createSetup>[0] = {}) {
	const setup = await createSetup({ terminals: false, auth: { mode: "required" }, ...options });
	cleanups.push(setup.cleanup);
	return setup;
}
export function authPost(setup: TestSetup, path: string, body: unknown, headers: Record<string, string> = {}) {
	return fetch(`${setup.server.url}${path}`, {
		method: "POST",
		headers: { "content-type": "application/json", ...headers },
		body: JSON.stringify(body),
		signal: AbortSignal.timeout(4000),
	});
}
export async function ownerControl(setup: TestSetup, args: string[]) {
	return fetch("http://localhost/", {
		unix: join(setup.dataDir, "auth.sock"),
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ args }),
		signal: AbortSignal.timeout(4000),
	});
}
export async function ownerCli(setup: TestSetup, args: string[]) {
	const process = Bun.spawn(["bun", "packages/server/src/main.ts", "auth", ...args], {
		env: { ...Bun.env, AIKI_DATA_DIR: setup.dataDir },
		stdout: "pipe", stderr: "pipe", timeout: 5000,
	});
	const [output, errors, exit] = await Promise.all([
		new Response(process.stdout).text(), new Response(process.stderr).text(), process.exited,
	]);
	expect(errors).toBe("");
	expect(exit).toBe(0);
	return JSON.parse(output);
}
export async function httpEnroll(setup: TestSetup): Promise<SessionCredentials> {
	const grant = setup.server.auth.bootstrap();
	const response = await authPost(setup, "/auth/bootstrap/redeem", {
		requestId: grant.requestId, code: grant.secret, ...claimProof(),
	});
	expect(response.status).toBe(200);
	return (await response.json() as { credentials: SessionCredentials }).credentials;
}
export async function authClient(setup: TestSetup, credentials?: Pick<SessionCredentials, "accessToken">) {
	const client = await TestClient.open(setup.server);
	cleanups.push(async () => client.close());
	const hello = await client.request({
		type: "hello", protocolVersion: 1,
		...(credentials ? { auth: { accessToken: credentials.accessToken } } : {}),
	});
	return { client, hello };
}
export async function until(predicate: () => boolean | Promise<boolean>, timeout = 3000) {
	const end = Date.now() + timeout;
	while (!await predicate()) {
		if (Date.now() >= end) throw new Error("Timed out waiting for test condition");
		await Bun.sleep(10);
	}
}
