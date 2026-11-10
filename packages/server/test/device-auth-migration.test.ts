/** Reusable rollout dry run: fixed inventory, one batch, three independently restarted backends. */
import { expect, test } from "bun:test";
import type { SessionCredentials } from "../src/device-auth.ts";
import { authSetup, authPost, authClient, claimProof, ownerCli, ownerControl } from "./device-auth-test-support.ts";

test("three-backend migration approves exactly two browsers and Android, never the stranger", async () => {
	let now = Date.now();
	const backends = await Promise.all(Array.from({ length: 3 }, () => authSetup({ auth: {}, now: () => now })));
	const inventory = [claimProof("Browser one"), claimProof("Browser two"), claimProof("Phone", "android"), claimProof("Stranger")];
	const enrolled = new Map<string, SessionCredentials[]>();
	const anonymous = [];
	for (const backend of backends) {
		expect((await ownerControl(backend, ["mode", "optional"])).status).toBe(200);
		anonymous.push((await authClient(backend)).client);
		for (const claim of inventory) {
			const response = await authPost(backend, "/auth/migration/claims", claim);
			expect(response.status).toBe(200);
			expect(await response.json()).toMatchObject({ state: "pending", credentials: null });
		}
		// The owner reviews hours later, and the phone is offline during approval.
		now += 2 * 3600_000;
		const listed = await ownerCli(backend, ["migration", "list", "--json"]);
		expect(listed.claims.map((claim: { claimId: string }) => claim.claimId)).toEqual(inventory.map(c => c.claimId));
		expect(listed.claims.map((claim: { state: string }) => claim.state)).toEqual(Array(4).fill("pending"));
		const approve = ["migration", "approve", "--batch", "synthetic-rollout", ...inventory.slice(0, 3).map(c => c.claimId)];
		expect(await ownerCli(backend, approve)).toEqual({ ok: true });
		expect(await ownerCli(backend, approve)).toEqual({ ok: true });
		const altered = await ownerControl(backend, [...approve.slice(0, -1), inventory[3]!.claimId]);
		expect(altered.status).toBe(409);
		expect(await altered.json()).toMatchObject({ error: { code: "batch_mismatch" } });
		expect(backend.server.auth.devices()).toHaveLength(0);
		expect((await ownerCli(backend, ["migration", "list", "--json"])).claims.map((c: { state: string }) => c.state)).toEqual(["approved", "approved", "approved", "pending"]);
		now += 3 * 3600_000;
		const credentials: SessionCredentials[] = [];
		for (const claim of inventory.slice(0, 3)) {
			const delivered = await authPost(backend, "/auth/claims/poll", claim);
			expect(delivered.status).toBe(200);
			const result = await delivered.json() as { credentials: SessionCredentials };
			credentials.push(result.credentials);
			expect((await authPost(backend, "/auth/claims/ack", claim)).status).toBe(200);
			now += 1000;
			expect(await (await authPost(backend, "/auth/claims/poll", claim)).json()).toMatchObject({ state: "acknowledged", credentials: null });
			const { client, hello } = await authClient(backend, result.credentials);
			expect(hello).toMatchObject({ type: "hello", auth: { sessionId: result.credentials.sessionId } });
			expect((await client.request({ type: "projects.list" })).type).toBe("projects.list");
		}
		enrolled.set(backend.server.auth.backendId, credentials);
		const stranger = await authPost(backend, "/auth/claims/poll", inventory[3]);
		expect(await stranger.json()).toMatchObject({ state: "pending", credentials: null });
	}
	now += 10 * 60_000 + 1;
	for (const [index, backend] of backends.entries()) {
		const stranger = await authPost(backend, "/auth/claims/poll", inventory[3]);
		expect(await stranger.json()).toMatchObject({ state: "pending", credentials: null });
		const listed = await ownerCli(backend, ["migration", "list", "--json"]);
		expect(listed.claims.map((claim: { state: string }) => claim.state)).toEqual([
			"acknowledged", "acknowledged", "acknowledged", "pending",
		]);
		expect((await ownerControl(backend, ["mode", "required"])).status).toBe(200);
		await anonymous[index]!.closed();
		expect((await authPost(backend, "/auth/migration/claims", inventory[3])).status).toBe(403);
		const strangerSocket = await authClient(backend);
		expect(strangerSocket.hello).toMatchObject({ type: "error", error: { code: "auth_required" } });
		await strangerSocket.client.closed();
		const backendId = backend.server.auth.backendId;
		await backend.restart();
		expect(backend.server.auth.backendId).toBe(backendId);
		expect(backend.server.auth.mode).toBe("required");
		for (const credentials of enrolled.get(backendId)!) {
			const access = backend.server.auth.refresh(credentials.sessionToken, "loopback");
			const { client, hello } = await authClient(backend, access);
			expect(hello).toMatchObject({ type: "hello", auth: { mode: "required", sessionId: credentials.sessionId } });
			expect((await client.request({ type: "projects.list" })).type).toBe("projects.list");
		}
		expect((await authClient(backend)).hello).toMatchObject({ type: "error", error: { code: "auth_required" } });
	}
}, 30_000);
