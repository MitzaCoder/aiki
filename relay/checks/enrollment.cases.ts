import { expect, test } from "bun:test";
import { sha256 as hash } from "../src/validation";
import { fixture, store, random, call, assertStatus, begin, finish, enroll, routeCredentials } from "./support";
test("challenge has 256-bit nonce, normal priority, hashes only; begin and confirm are idempotent", async () => {
	const pending = await begin();
	expect(Buffer.from(pending.nonce, "base64url").length).toBe(32);
	expect(fixture.captures[0].priority).toBe("normal");
	expect(fixture.captures[0].ttlMs).toBe(300000);
	const stored = (await store.challenges.get()).docs[0].data();
	expect(Object.hasOwn(stored, "nonce")).toBe(false);
	expect(stored.nonceHash).toBe(hash(pending.nonce));
	const duplicate = await call("installations/begin", {
		installationId: pending.installationId,
		operationId: pending.operationId,
		token: pending.token,
	});
	expect(duplicate.body?.challengeId).toBe(pending.challengeId);
	expect(fixture.captures.length).toBe(1);
	assertStatus(await finish(pending));
	assertStatus(await finish(pending));
	expect((await store.challenges.get()).size).toBe(0);
});
test("wrong UID, installation and challenge fail; knowing token cannot answer; five replies maximum", async () => {
	const pending = await begin();
	const request = {
		installationId: pending.installationId,
		operationId: pending.operationId,
		challengeId: pending.challengeId,
		nonce: pending.nonce,
	};
	expect((await call("installations/confirm", request, fixture.other.idToken)).status).toBe(403);
	expect((await finish(pending, { installationId: random() })).status).toBe(404);
	expect((await finish(pending, { challengeId: random() })).status).toBe(409);
	for (let attempt = 0; attempt < 4; attempt++)
		expect((await finish(pending, { nonce: random(32) })).body?.error).toBe("challenge_invalid");
	expect((await finish(pending)).body?.error).toBe("challenge_expired");
	expect((await store.installations.doc(pending.installationId).get()).data()?.state).toBe("pending");
});
test("concurrent last phone slot has exactly one winner and expiry releases reservations", async () => {
	await enroll();
	await enroll();
	const ids = [random(), random()];
	const responses = await Promise.all(
		ids.map((installationId) =>
			call("installations/begin", { installationId, operationId: random(), token: "synthetic-" + installationId }),
		),
	);
	expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
	fixture.now += 300001;
	assertStatus(
		await call("installations/begin", {
			installationId: random(),
			operationId: random(),
			token: "synthetic-replacement",
		}),
	);
	expect((await call("accounts/status")).body?.phones).toBe(3);
});
test("token replacement is atomic, old confirm cannot revert it; only completed challenge transfers ownership", async () => {
	const first = await enroll();
	const second = await enroll(random(), undefined, fixture.other.idToken);
	const pending = await begin(second.installationId, first.token, fixture.other.idToken, true);
	expect((await store.installations.doc(first.installationId).get()).data()?.state).toBe("active");
	assertStatus(await finish(pending));
	expect((await store.installations.doc(first.installationId).get()).data()?.token).toBeNull();
	expect((await store.installations.doc(second.installationId).get()).data()?.token).toBe(first.token);
	expect((await finish(first)).status).toBe(200); // Receipt only; never restores ownership or token.
	expect((await store.installations.doc(first.installationId).get()).data()?.token).toBeNull();
	const replacement = await begin(second.installationId, "synthetic-new-token", fixture.other.idToken, true);
	assertStatus(await finish(replacement));
	expect((await finish(pending)).status).toBe(409);
	expect((await store.installations.doc(second.installationId).get()).data()?.token).toBe("synthetic-new-token");
});
test("delete racing confirm or creation cannot revive installation or authorize routes", async () => {
	const pending = await begin();
	const outcomes = await Promise.all([
		finish(pending),
		call("installations/delete", { installationId: pending.installationId }),
	]);
	expect(outcomes[1].status).toBe(204);
	expect([200, 409]).toContain(outcomes[0].status);
	expect((await store.installations.doc(pending.installationId).get()).data()?.state).toBe("deleted");
	expect((await finish(pending)).status).toBe(409);
	const active = await enroll();
	const credentials = routeCredentials(active.installationId);
	await Promise.all([
		call("routes/create", credentials.create),
		call("installations/delete", { installationId: active.installationId }),
	]);
	expect(
		(await call("routes/activate", { installationId: active.installationId, routeId: credentials.routeId })).status,
	).not.toBe(200);
}, 20000);
test("new operation replaces a lost enrollment challenge; old begin retries do not redeliver or confirm", async () => {
	const first = await begin();
	const second = await begin(first.installationId, first.token);
	expect(second.challengeId).not.toBe(first.challengeId);
	expect(fixture.captures.length).toBe(2);
	expect((await store.challenges.doc(first.installationId + "_" + first.operationId).get()).exists).toBe(false);
	expect((await store.challenges.get()).size).toBe(1);
	const replay = await call("installations/begin", {
		installationId: first.installationId,
		operationId: first.operationId,
		token: first.token,
	});
	expect(replay.body).toEqual({ challengeId: first.challengeId, deadline: fixture.now + 300000 });
	expect(fixture.captures.length).toBe(2);
	expect((await finish(first)).status).toBe(409);
	assertStatus(await finish(second));
	expect((await call("accounts/status")).body?.phones).toBe(1);
});
test("new token operation replaces a lost replacement challenge without moving the active token", async () => {
	const phone = await enroll();
	const first = await begin(phone.installationId, "synthetic-replacement-one", fixture.primary.idToken, true);
	const second = await begin(phone.installationId, "synthetic-replacement-two", fixture.primary.idToken, true);
	expect((await store.challenges.get()).size).toBe(1);
	expect((await store.installations.doc(phone.installationId).get()).data()?.token).toBe(phone.token);
	expect((await finish(first)).status).toBe(409);
	assertStatus(await finish(second));
	expect((await store.installations.doc(phone.installationId).get()).data()?.token).toBe(second.token);
	const count = fixture.captures.length;
	const retry = await call("installations/token/begin", {
		installationId: second.installationId,
		operationId: second.operationId,
		token: second.token,
	});
	assertStatus(retry);
	expect(fixture.captures.length).toBe(count);
});
