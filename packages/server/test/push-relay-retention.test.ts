import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { PUSH_RELAY_CLEANUP_MS, PUSH_RELAY_PENDING_MS } from "../src/push-relay/store.ts";
import { relaySetup, simulatedPhone } from "./push-relay-support.ts";

test("activated operation receipts and revoked status prune at absolute expiry plus cleanup, including after restart", async () => {
	const f = await relaySetup();
	const phone = await simulatedPhone();
	phone.registration.absoluteExpiresAt = f.clock.now + 2 * PUSH_RELAY_CLEANUP_MS;
	phone.registration.leaseExpiresAt = phone.registration.absoluteExpiresAt;
	await phone.activate(f.client);
	await f.setup.server.notifications.relay!.revoke(f.credentials.sessionId);
	await f.tick(0);
	const deadline = phone.registration.absoluteExpiresAt + PUSH_RELAY_CLEANUP_MS;
	const store = () => f.setup.server.notifications.relay!.store;
	expect(store().snapshot().receipts[phone.registration.operationId]?.purgeAt).toBe(deadline);
	expect(store().snapshot().revoked[f.credentials.sessionId]?.purgeAt).toBe(deadline);
	await f.tick(PUSH_RELAY_PENDING_MS + PUSH_RELAY_CLEANUP_MS);
	expect(store().snapshot().receipts[phone.registration.operationId]).toBeDefined();
	await f.setup.restart();
	await f.tick(deadline - f.clock.now - 1);
	expect(store().snapshot().receipts[phone.registration.operationId]).toBeDefined();
	expect(store().snapshot().revoked[f.credentials.sessionId]).toBeDefined();
	await f.tick(1);
	expect(store().snapshot().receipts).toEqual({});
	expect(store().snapshot().revoked).toEqual({});
	expect(store().selected(f.credentials.sessionId)).toBe(true);
	expect(store().status(f.credentials.sessionId).cleanup).toBe("done");
});

test("never-activated operation receipt and revoked status prune at ten-minute expiry plus cleanup", async () => {
	const f = await relaySetup();
	const phone = await simulatedPhone();
	await phone.stage(f.client);
	const deadline = f.clock.now + PUSH_RELAY_PENDING_MS + PUSH_RELAY_CLEANUP_MS;
	await f.tick(PUSH_RELAY_PENDING_MS);
	const store = f.setup.server.notifications.relay!.store;
	expect(store.snapshot().routes).toHaveLength(0);
	expect(store.snapshot().receipts[phone.registration.operationId]?.purgeAt).toBe(deadline);
	expect(store.snapshot().revoked[f.credentials.sessionId]?.purgeAt).toBe(deadline);
	await f.tick(PUSH_RELAY_CLEANUP_MS - 1);
	expect(store.snapshot().receipts[phone.registration.operationId]).toBeDefined();
	expect(store.snapshot().revoked[f.credentials.sessionId]).toBeDefined();
	await f.tick(1);
	expect(store.snapshot().receipts).toEqual({});
	expect(store.snapshot().revoked).toEqual({});
	expect(f.relay.deletes()).toHaveLength(1);
});

test("wrong-secret 404 retries with capped backoff until absolute expiry plus cleanup, then erases its secret", async () => {
	const f = await relaySetup();
	const phone = await simulatedPhone();
	phone.registration.absoluteExpiresAt = f.clock.now + 60_000;
	phone.registration.leaseExpiresAt = phone.registration.absoluteExpiresAt;
	await phone.activate(f.client);
	f.relay.deleteReplies.push({ status: 404 }, { status: 404 },
		{ status: 404, retryAfter: String(2 * PUSH_RELAY_CLEANUP_MS / 1000) });
	await f.setup.server.notifications.relay!.revoke(f.credentials.sessionId);
	await f.tick(0);
	const transport = () => f.setup.server.notifications.relay!;
	expect(transport().store.snapshot().deletes[0]?.dueAt - f.clock.now).toBe(5000);
	await transport().store.transaction((draft) => { draft.deletes[0]!.attempts = 30; });
	await f.tick(5000);
	expect(transport().store.snapshot().deletes[0]?.dueAt - f.clock.now).toBe(900_000);
	const deadline = phone.registration.absoluteExpiresAt + PUSH_RELAY_CLEANUP_MS;
	await f.tick(deadline - f.clock.now - 1);
	expect(f.relay.deletes()).toHaveLength(3);
	expect(transport().status(f.credentials.sessionId).cleanup).toBe("pending");
	expect(transport().store.snapshot().deletes[0]?.deleteBearer).toBe(phone.registration.deleteBearer);
	await f.tick(1);
	expect(f.relay.deletes()).toHaveLength(3);
	expect(transport().store.snapshot().deletes).toEqual([]);
	expect(transport().store.snapshot().receipts).toEqual({});
	expect(transport().store.snapshot().revoked).toEqual({});
	expect(transport().status(f.credentials.sessionId)).toMatchObject({
		cleanup: "done", lastDelivery: "cleanup_expired",
	});
	const file = join(f.setup.dataDir, "notifications", "push-relay.json");
	expect(await readFile(file, "utf8")).not.toContain(phone.registration.deleteBearer);
	await f.setup.restart();
	await transport().flush();
	expect(transport().status(f.credentials.sessionId)).toMatchObject({
		cleanup: "done", lastDelivery: "cleanup_expired",
	});
	expect(f.relay.deletes()).toHaveLength(3);
	await f.tick(PUSH_RELAY_CLEANUP_MS);
	expect(transport().store.snapshot().cleanupExpired).toEqual({});
	expect(transport().status(f.credentials.sessionId).lastDelivery).toBeNull();
	expect(f.clock.timers).toHaveLength(0);
});
