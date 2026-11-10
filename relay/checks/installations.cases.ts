import { expect, test } from "bun:test";
import { fixture, db, projectId, firestoreHost, random, call, assertStatus, enroll, route, payload } from "./support";
test("cross-account management denied; two phones are separately scoped and list exposes no token", async () => {
	const first = await enroll();
	const second = await enroll();
	await enroll(random(), undefined, fixture.other.idToken);
	const firstRoute = await route(first.installationId);
	const secondRoute = await route(second.installationId);
	const listed = await call("installations/list");
	expect(listed.body?.installations?.length).toBe(2);
	expect(JSON.stringify(listed.body)).not.toContain(first.token);
	for (const path of ["installations/delete", "installations/token/begin"]) {
		const body = path.endsWith("begin")
			? { installationId: first.installationId, operationId: random(), token: "synthetic-stolen" }
			: { installationId: first.installationId };
		expect((await call(path, body, fixture.other.idToken)).status).toBe(404);
	}
	expect(
		(await call("routes/activate", { installationId: second.installationId, routeId: firstRoute.routeId })).status,
	).toBe(404);
	expect(
		(
			await call(
				"routes/renew",
				{ installationId: first.installationId, routeId: firstRoute.routeId },
				fixture.other.idToken,
			)
		).status,
	).toBe(404);
	assertStatus(await call("installations/delete", { installationId: first.installationId }), 204);
	expect((await call("send", payload(firstRoute.routeId), firstRoute.send)).status).toBe(404);
	expect((await call("send", payload(secondRoute.routeId), secondRoute.send)).body?.state).toBe("accepted");
});
test("direct client Firestore reads and writes denied", async () => {
	await enroll();
	const base = `http://${firestoreHost}/v1/projects/${projectId}/databases/(default)/documents`;
	const url = base + "/accounts/" + fixture.primary.localId;
	expect((await fetch(url)).status).toBe(403);
	expect((await fetch(url, { headers: { Authorization: "Bearer " + fixture.primary.idToken } })).status).toBe(403);
	expect(
		(
			await fetch(url, {
				method: "PATCH",
				headers: { "Content-Type": "application/json", Authorization: "Bearer " + fixture.primary.idToken },
				body: JSON.stringify({ fields: { state: { stringValue: "active" } } }),
			})
		).status,
	).toBe(403);
});
test("Firestore converters fail closed on malformed typed documents", async () => {
	await enroll();
	await db
		.collection("relayAccounts")
		.doc(fixture.primary.localId)
		.update({ phones: { invalid: { deadline: "not a number" } } });
	expect((await call("accounts/status")).body).toEqual({ error: "relay_unavailable" });
});
