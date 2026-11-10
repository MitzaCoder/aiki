import { expect, test } from "bun:test";
import { createRelay, type AuthPort } from "../src/core";
import {
	fixture,
	db,
	store,
	auth,
	projectId,
	random,
	call,
	assertStatus,
	enroll,
	route,
	payload,
	emailUser,
} from "./support";
test("verified email-link and Google enroll without approval; minimal account and no copied profile", async () => {
	await enroll();
	await enroll(random(), undefined, fixture.google.idToken);
	const accounts = await store.accounts.get();
	expect(accounts.size).toBe(2);
	expect(JSON.stringify(accounts.docs.map((doc) => doc.data()))).not.toContain("@example.com");
	expect(fixture.monitors).toContain("invalid");
});
test("missing, anonymous, custom, unverified, wrong-project and revoked credentials fail closed", async () => {
	for (const identity of [
		undefined,
		fixture.anonymous.idToken,
		fixture.unverified.idToken,
		fixture.wrongProject.idToken,
		fixture.custom.idToken,
		"invalid",
	]) {
		const response = await call(
			"installations/begin",
			{ installationId: random(), operationId: random(), token: "synthetic-token" },
			identity,
			identity === undefined ? { authorization: undefined } : {},
		);
		expect([401, 403]).toContain(response.status);
	}
	const claims = await auth.verifyIdToken(fixture.primary.idToken);
	expect(claims.firebase.sign_in_provider).toBe("password");
	const revokedAuth: AuthPort = {
		...auth,
		getUser: (uid) => auth.getUser(uid),
		updateUser: (uid, properties) => auth.updateUser(uid, properties),
		revokeRefreshTokens: (uid) => auth.revokeRefreshTokens(uid),
		deleteUser: (uid) => auth.deleteUser(uid),
		verifyIdToken: async (_token, revoked) => {
			expect(revoked).toBe(true);
			throw new Error("synthetic revoked");
		},
	};
	const revoked = createRelay({
		firestore: db,
		auth: revokedAuth,
		projectId,
		now: () => fixture.now,
		random,
		verifyAppCheck: async () => false,
		monitor() {},
		send: async () => "accepted",
	});
	expect(
		(
			await revoked({
				method: "POST",
				path: "/v1/accounts/status",
				authorization: "Bearer synthetic",
				body: "{}",
				clientIp: "127.0.0.1",
				contentType: "application/octet-stream",
			})
		).status,
	).toBe(401);
	expect((await store.accounts.get()).size).toBe(0);
});
test("Auth disable/delete outside relay blocks next send and challenge; account state always checked", async () => {
	const user = await emailUser();
	const phone = await enroll(random(), undefined, user.idToken);
	const credentials = await route(phone.installationId, user.idToken);
	fixture.captures = [];
	await auth.updateUser(user.localId, { disabled: true });
	expect((await call("send", payload(credentials.routeId), credentials.send)).status).toBe(403);
	expect(fixture.captures.length).toBe(0);
	expect(
		(
			await call(
				"installations/token/begin",
				{ installationId: phone.installationId, operationId: random(), token: "synthetic-new" },
				user.idToken,
			)
		).status,
	).not.toBe(200);
	await auth.updateUser(user.localId, { disabled: false });
	await auth.deleteUser(user.localId);
	expect((await call("send", payload(credentials.routeId), credentials.send)).status).toBe(410);
	const active = await enroll();
	const activeRoute = await route(active.installationId);
	await store.accounts.doc(fixture.primary.localId).update({ state: "disabled" });
	expect((await call("send", payload(activeRoute.routeId), activeRoute.send)).status).toBe(403);
	assertStatus(await call("delete", { routeId: activeRoute.routeId }, activeRoute.deletion), 204);
});
