import { expect, test } from "bun:test";
import { fixture, db, store, auth, projectId, random, call, assertStatus, enroll, route, payload } from "./support";
test("three backend routes on one phone are independent and deletion blocks subsequent sends", async () => {
	const phone = await enroll();
	const routes = [
		await route(phone.installationId),
		await route(phone.installationId),
		await route(phone.installationId),
	];
	assertStatus(await call("delete", { routeId: routes[0].routeId }, routes[0].deletion), 204);
	assertStatus(await call("routes/delete", { installationId: phone.installationId, routeId: routes[0].routeId }), 204);
	expect((await call("send", payload(routes[0].routeId), routes[0].send)).status).toBe(404);
	for (const credentials of routes.slice(1))
		expect((await call("send", payload(credentials.routeId), credentials.send)).body?.state).toBe("accepted");
	expect((await store.installations.doc(phone.installationId).get()).data()?.token).toBe(phone.token);
});
test("absent delete returns 204 forever, but existing routes require the correct delete scheme and secret", async () => {
	const absent = random();
	const unknownDelete = "aiki_push_delete1." + absent + "." + random(32);
	assertStatus(await call("delete", { routeId: absent }, unknownDelete), 204);
	expect((await store.routeRevocations.get()).size).toBe(0);
	expect((await call("delete", { routeId: absent }, "aiki_push1." + absent + "." + random(32))).status).toBe(404);
	const phone = await enroll();
	const credentials = await route(phone.installationId);
	const wrong = "aiki_push_delete1." + credentials.routeId + "." + random(32);
	expect((await call("delete", { routeId: credentials.routeId }, wrong)).status).toBe(404);
	assertStatus(await call("delete", { routeId: credentials.routeId }, credentials.deletion), 204);
	expect((await store.routes.doc(credentials.routeId).get()).exists).toBe(false);
	assertStatus(await call("delete", { routeId: credentials.routeId }, wrong), 204);
	assertStatus(
		await call("routes/delete", { installationId: phone.installationId, routeId: credentials.routeId }),
		204,
	);
	const marker = (await store.routeRevocations.doc(credentials.routeId).get()).data()!;
	expect(Object.keys(marker)).toEqual(["purgeAt"]);
	expect((await call("routes/create", credentials.create)).body?.error).toBe("route_inactive");
	await store.routeRevocations.doc(credentials.routeId).delete();
	assertStatus(await call("delete", { routeId: credentials.routeId }, credentials.deletion), 204);
});
test("delete scheme is rejected before any Firestore lookup, even for an absent route", async () => {
	const { deleteByCapability } = await import("../src/delete");
	const poisonedStore = new Proxy(store, {
		get() {
			throw new Error("Unexpected lookup");
		},
	});
	const request = {
		method: "POST",
		path: "/v1/delete",
		body: "{}",
		clientIp: "127.0.0.1",
		authorization: "Bearer aiki_push1." + random() + "." + random(32),
	};
	await expect(
		deleteByCapability(
			{
				firestore: db,
				auth,
				projectId,
				now: () => fixture.now,
				random,
				send: async () => "accepted",
				monitor() {},
				verifyAppCheck: async () => false,
			},
			poisonedStore,
			request,
			{ routeId: random() },
		),
	).rejects.toMatchObject({ status: 404, code: "not_found" });
});

test("create retry and activation racing a revoke cannot restore a deleted route", async () => {
	const phone = await enroll();
	const credentials = await route(phone.installationId);
	await Promise.all([
		call("routes/create", credentials.create),
		call("delete", { routeId: credentials.routeId }, credentials.deletion),
	]);
	expect((await store.routes.doc(credentials.routeId).get()).exists).toBe(false);
	expect((await call("routes/create", credentials.create)).status).toBe(410);
	const pending = await route(phone.installationId, fixture.primary.idToken, undefined, false);
	await Promise.all([
		call("routes/activate", { installationId: phone.installationId, routeId: pending.routeId }),
		call("delete", { routeId: pending.routeId }, pending.deletion),
	]);
	expect((await store.routes.doc(pending.routeId).get()).exists).toBe(false);
	expect((await call("send", payload(pending.routeId), pending.send)).status).toBe(404);
}, 20_000);
