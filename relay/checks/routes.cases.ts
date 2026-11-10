import { expect, test } from "bun:test";
import { fixture, random, call, assertStatus, enroll, route, routeCredentials, payload } from "./support";
import { DAY } from "../src/ports";
test("pending cannot send; eight per phone; one bounded successor atomically replaces predecessor", async () => {
	const phone = await enroll();
	const pending = await route(phone.installationId, fixture.primary.idToken, undefined, false);
	expect((await call("send", payload(pending.routeId), pending.send)).status).toBe(410);
	assertStatus(await call("routes/activate", { installationId: phone.installationId, routeId: pending.routeId }));
	for (let count = 1; count < 8; count++) await route(phone.installationId);
	expect((await call("routes/create", routeCredentials(phone.installationId).create)).body?.error).toBe("route_limit");
	const successor = await route(phone.installationId, fixture.primary.idToken, pending.routeId, false);
	expect((await call("routes/create", routeCredentials(phone.installationId, pending.routeId).create)).status).toBe(
		409,
	);
	assertStatus(await call("routes/activate", { installationId: phone.installationId, routeId: successor.routeId }));
	assertStatus(await call("routes/activate", { installationId: phone.installationId, routeId: successor.routeId }));
	expect((await call("send", payload(pending.routeId), pending.send)).status).toBe(410);
	expect((await call("send", payload(successor.routeId), successor.send)).body?.state).toBe("accepted");
});
test("pending route reservations expire in ten minutes and account route cap is twenty-four", async () => {
	const phones = [await enroll(), await enroll(), await enroll()];
	for (const phone of phones)
		for (let count = 0; count < 8; count++)
			await route(phone.installationId, fixture.primary.idToken, undefined, false);
	expect((await call("accounts/status")).body?.routes).toBe(24);
	expect((await call("routes/create", routeCredentials(phones[0].installationId).create)).status).toBe(409);
	fixture.now += 600001;
	expect((await call("accounts/status")).body?.routes).toBe(0);
	await route(phones[0].installationId);
});
test("renew only under seven days, bounded by absolute ninety days; expiry enforced without TTL", async () => {
	const phone = await enroll();
	const credentials = await route(phone.installationId);
	const body = { installationId: phone.installationId, routeId: credentials.routeId };
	const initial = (await call("routes/renew", body)).body!;
	fixture.now += 24 * DAY;
	const renewed = (await call("routes/renew", body)).body!;
	expect(renewed.leaseExpiresAt).toBe(fixture.now + 30 * DAY);
	expect(renewed.leaseExpiresAt).toBeGreaterThan(initial.leaseExpiresAt!);
	fixture.now += 24 * DAY;
	assertStatus(await call("routes/renew", body));
	fixture.now += 24 * DAY;
	expect((await call("routes/renew", body)).body?.leaseExpiresAt).toBe(initial.absoluteExpiresAt);
	fixture.now = initial.absoluteExpiresAt! + 1;
	expect((await call("send", payload(credentials.routeId), credentials.send)).body?.error).toBe("route_expired");
	expect((await call("routes/renew", body)).status).toBe(410);
	assertStatus(await call("delete", { routeId: credentials.routeId }, credentials.deletion), 204);
	assertStatus(await call("delete", { routeId: credentials.routeId }, credentials.deletion), 204);
});
test("capability A cannot send B or manage routes, or choose token/project/topic/priority; disjoint schemes", async () => {
	const phone = await enroll();
	const a = await route(phone.installationId);
	const b = await route(phone.installationId);
	expect((await call("send", payload(b.routeId), a.send)).status).toBe(404);
	for (const path of ["routes/renew", "routes/create", "installations/list"])
		expect((await call(path, { installationId: phone.installationId, routeId: a.routeId }, a.send)).status).toBe(401);
	for (const field of ["token", "project", "topic", "priority", "android", "notification"])
		expect((await call("send", { ...payload(a.routeId), [field]: "synthetic" }, a.send)).status).toBe(400);
	expect((await call("send", payload(a.routeId), a.deletion)).status).toBe(404);
	expect((await call("delete", { routeId: a.routeId }, a.send)).status).toBe(404);
	expect((await call("delete", { routeId: b.routeId }, a.deletion)).status).toBe(404);
	expect((await call("send", payload(a.routeId), `aiki_push1.${a.routeId}.${random(32)}`)).body).toEqual({
		error: "not_found",
	});
	const absent = random();
	expect((await call("send", payload(absent), `aiki_push1.${absent}.${random(32)}`)).body).toEqual({
		error: "not_found",
	});
});
