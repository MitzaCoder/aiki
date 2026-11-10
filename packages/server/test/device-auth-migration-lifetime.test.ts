import { expect, test } from "bun:test";
import { authSetup, claimProof, ownerCli } from "./device-auth-test-support.ts";

const MINUTE = 60_000, DAY = 86400_000;

test("migration keeps its ID and code after 11 minutes, two hours and three days; last seen writes are throttled", async () => {
	let now = Date.now();
	const s = await authSetup({ auth: { mode: "optional" }, now: () => now });
	const auth = s.server.auth, proof = claimProof();
	const first = await auth.migration(proof, "loopback");
	const created = now;
	for (const elapsed of [11 * MINUTE, 120 * MINUTE, 3 * DAY]) {
		now = created + elapsed;
		expect(auth.poll(proof.claimId, proof.claimSecret)).toEqual(first);
		expect((await ownerCli(s, ["migration", "list", "--pending", "--json"])).claims).toMatchObject([
			{ claimId: proof.claimId, state: "pending", lastSeenAt: new Date(now).toISOString() },
		]);
	}
	now += 1000;
	auth.poll(proof.claimId, proof.claimSecret);
	expect(auth.inventory()[0]!.lastSeenAt).toBe(new Date(now - 1000).toISOString());
	expect(await auth.migration(proof, "loopback")).toEqual(first);
});

test("idle expiry revives the same proof, but neither wrong proofs nor the absolute cap revive it", async () => {
	let now = Date.now();
	const s = await authSetup({ auth: { mode: "optional" }, now: () => now });
	const auth = s.server.auth, proof = claimProof();
	const first = await auth.migration(proof, "loopback");
	now += 15 * DAY;
	expect(auth.poll(proof.claimId, proof.claimSecret).state).toBe("expired");
	await expect(auth.migration({ ...proof, claimSecret: claimProof().claimSecret }, "loopback")).rejects.toThrow();
	expect(await auth.migration(proof, "loopback")).toEqual(first);
	now += 13 * DAY;
	expect(auth.poll(proof.claimId, proof.claimSecret).state).toBe("pending");
	now += 3 * DAY; // Recently seen, but beyond the absolute cap.
	expect((await auth.migration(proof, "loopback")).state).toBe("expired");
	expect(() => auth.approveMigration("too-late", [proof.claimId])).toThrow("not_found");
});

test("offline approval survives restart, mints only at poll and acknowledges durable credentials", async () => {
	let now = Date.now();
	const s = await authSetup({ auth: { mode: "optional" }, now: () => now });
	const proof = claimProof("Offline phone", "android");
	await s.server.auth.migration(proof, "loopback");
	now += 2 * 3600_000;
	s.server.auth.approveMigration("offline", [proof.claimId]);
	expect(s.server.auth.devices()).toHaveLength(0);
	expect(() => s.server.auth.ack(proof.claimId, proof.claimSecret)).toThrow("claim_pending");
	expect((await ownerCli(s, ["migration", "list", "--json"])).claims).toMatchObject([{ state: "approved" }]);
	expect((await ownerCli(s, ["migration", "list", "--pending", "--json"])).claims).toHaveLength(0);
	now += 6 * 3600_000;
	s.server.auth.setMode("required");
	await s.restart();
	const auth = s.server.auth;
	auth.setMode("required");
	expect(auth.devices()).toHaveLength(0);
	const delivered = auth.poll(proof.claimId, proof.claimSecret);
	expect(delivered.state).toBe("approved");
	expect(delivered.credentials).not.toBeNull();
	now += 1000;
	expect(auth.poll(proof.claimId, proof.claimSecret)).toEqual(delivered);
	auth.ack(proof.claimId, proof.claimSecret);
	now += 2 * MINUTE;
	expect(auth.poll(proof.claimId, proof.claimSecret)).toMatchObject({ state: "acknowledged", credentials: null });
	expect(auth.authenticate(delivered.credentials!.accessToken).sessionId).toBe(delivered.credentials!.sessionId);
});

test("lost migration delivery revokes the first session before minting another; ack prevents further minting", async () => {
	let now = Date.now();
	const s = await authSetup({ auth: { mode: "optional" }, now: () => now });
	const auth = s.server.auth, proof = claimProof();
	await auth.migration(proof, "loopback");
	auth.approveMigration("retry", [proof.claimId]);
	const first = auth.poll(proof.claimId, proof.claimSecret).credentials!;
	now += MINUTE + 1;
	const second = auth.poll(proof.claimId, proof.claimSecret).credentials!;
	expect(second.sessionId).not.toBe(first.sessionId);
	expect(() => auth.authenticate(first.accessToken)).toThrow("auth_revoked");
	expect(() => auth.refresh(first.sessionToken, "loopback")).toThrow("auth_revoked");
	expect(auth.devices().map(d => d.id)).toEqual([second.sessionId]);
	auth.ack(proof.claimId, proof.claimSecret);
	now += DAY;
	expect(auth.poll(proof.claimId, proof.claimSecret).state).toBe("acknowledged");
	expect(auth.devices()).toHaveLength(1);
});

test("migration approval expires after fourteen days and explicit revocation never remints", async () => {
	let now = Date.now();
	const s = await authSetup({ auth: { mode: "optional" }, now: () => now });
	const auth = s.server.auth, proof = claimProof(), revoked = claimProof();
	await auth.migration(proof, "loopback");
	await auth.migration(revoked, "loopback");
	auth.approveMigration("window", [proof.claimId, revoked.claimId]);
	const first = auth.poll(proof.claimId, proof.claimSecret).credentials!;
	const other = auth.poll(revoked.claimId, revoked.claimSecret).credentials!;
	await auth.revoke(other.sessionId);
	now += 2 * MINUTE;
	expect(auth.poll(revoked.claimId, revoked.claimSecret)).toMatchObject({ state: "expired", credentials: null });
	now += 14 * DAY;
	expect(auth.poll(proof.claimId, proof.claimSecret)).toMatchObject({ state: "expired", credentials: null });
	expect((await auth.migration(proof, "loopback")).state).toBe("expired");
	expect(auth.active(first.sessionId)).toBe(false);
});

// This fills the real 100-row cap: 100 sequential digests and durable SQLite transactions, not a timer assertion.
// Thirty-two copies on one CPU exceed Bun's default 5 seconds; allow a loaded disk/CPU without retrying any work.
test("long-terminal migration rows are purged so churn cannot fill the global cap", async () => {
	let now = Date.now();
	const s = await authSetup({ auth: { mode: "optional" }, now: () => now });
	for (let i = 0; i < 100; i++) {
		await s.server.auth.migration(claimProof(), "loopback");
		now += MINUTE;
	}
	await expect(s.server.auth.migration(claimProof(), "loopback")).rejects.toThrow("pending_limit");
	s.server.auth.setMode("required"); // Explicitly deny this inventory.
	now += 31 * DAY;
	s.server.auth.setMode("optional");
	await s.server.auth.migration(claimProof(), "loopback");
	expect(s.server.auth.inventory()).toHaveLength(1);
}, 30_000);
