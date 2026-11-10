import { expect } from "bun:test";
import {
	type NotificationPreferences,
	type RelayContext,
	type RelayKeys,
	RelayAdmission,
	buildRelayBearer,
	decryptRelay,
	deriveRelayKeys,
	exportRelayPublicKey,
	generateRelayKeyPair,
	newRelayId,
	newRelaySecret,
	relayConfirmation,
	relaySharedSecret,
	relayTranscript,
	verifyRelayConfirmation,
} from "@aiki/protocol";
import { authCleanup, authClient, authSetup, httpEnroll, until } from "./device-auth-test-support.ts";
import type { TestClient } from "./support.ts";
import type { RelayRegistration } from "../src/push-relay/store.ts";

export type FakeRelayReply = { status: number; code?: string; state?: string; retryAfter?: string;
	lost?: boolean; timeout?: boolean; redirect?: string };
export type CapturedRelayRequest = { path: string; body: string; authorization: string | null; contentType: string | null };

/** Real loopback HTTP fake, scriptable at the same boundary as the relay Functions endpoint. */
export function fakeRelay() {
	const requests: CapturedRelayRequest[] = [];
	const replies: FakeRelayReply[] = [];
	const deleteReplies: FakeRelayReply[] = [];
	const accepted = new Set<string>();
	let held: Array<() => void> = [];
	const server = Bun.serve({ port: 0, hostname: "127.0.0.1", async fetch(request) {
		const path = new URL(request.url).pathname;
		const body = await request.text();
		requests.push({ path, body, authorization: request.headers.get("authorization"),
			contentType: request.headers.get("content-type") });
		const reply = (path === "/v1/delete" ? deleteReplies : replies).shift() ??
			(path === "/v1/delete" ? { status: 204 } : { status: 200, state: "accepted" });
		if (reply.timeout) await new Promise<void>((resolve) => held.push(resolve));
		if (reply.lost) {
			accepted.add(body);
			return new Response("", { status: 503 });
		}
		if (reply.status === 200 && reply.state === "accepted") accepted.add(body);
		if (reply.status === 204) return new Response(null, { status: 204 });
		return Response.json(reply.status >= 400 ? { error: reply.code } : { state: reply.state, code: reply.code }, { status: reply.status,
			headers: { ...(reply.retryAfter ? { "Retry-After": reply.retryAfter } : {}),
				...(reply.redirect ? { Location: reply.redirect } : {}) } });
	} });
	authCleanup(async () => { for (const release of held) release(); held = []; await server.stop(true); });
	return { endpoint: `http://127.0.0.1:${server.port}/v1/`, requests, replies, deleteReplies, accepted,
		sends: () => requests.filter((r) => r.path === "/v1/send"),
		deletes: () => requests.filter((r) => r.path === "/v1/delete") };
}

/** Fake-clock scheduler: one bounded advance runs due callbacks, leaving I/O to transport.flush. */
export class RelayClock {
	now = Date.UTC(2026, 0, 1, 12);
	readonly timers = new Set<{ due: number; run: () => void }>();
	readonly schedule = (run: () => void, delay: number) => {
		const timer = { due: this.now + delay, run };
		this.timers.add(timer);
		return () => { this.timers.delete(timer); };
	};
	advance(ms: number): void {
		this.now += ms;
		for (const timer of [...this.timers]) if (timer.due <= this.now) {
			this.timers.delete(timer);
			timer.run();
		}
	}
}

export const relayPreferences = (): NotificationPreferences => ({ kinds: ["reply", "worker_failed"],
	mutedProjects: [], quietHours: null });

/** Simulated phone uses only the shared crypto/admission library, not server-internal derived keys. */
export async function simulatedPhone(predecessorRouteId?: string) {
	const pair = await generateRelayKeyPair();
	const routeId = newRelayId();
	const registration: RelayRegistration = { operationId: newRelayId(), routeId, keyId: newRelayId(),
		sendBearer: buildRelayBearer("send", routeId), deleteBearer: buildRelayBearer("delete", routeId),
		leaseExpiresAt: Date.UTC(2026, 0, 31), absoluteExpiresAt: Date.UTC(2026, 3, 1),
		phonePublicKey: await exportRelayPublicKey(pair.publicKey), salt: newRelaySecret(),
		label: "Synthetic phone", backendKey: "synthetic-backend", preferences: relayPreferences(),
		...(predecessorRouteId ? { predecessorRouteId } : {}) };
	let context: RelayContext;
	let keys: RelayKeys;
	let admission = new RelayAdmission();
	return { registration,
		async stage(client: TestClient) {
			const answer = await client.request({ type: "notifications.registerRelay", ...registration });
			if (answer.type !== "notifications.registerRelay") throw new Error(`Registration failed: ${JSON.stringify(answer)}`);
			context = { backendId: answer.backendId, sessionId: answer.sessionId, routeId, keyId: registration.keyId };
			keys = await deriveRelayKeys(await relaySharedSecret(pair.privateKey, answer.backendPublicKey), registration.salt, context);
			const transcript = await relayTranscript(context, registration.salt, registration.phonePublicKey, answer.backendPublicKey);
			await verifyRelayConfirmation(keys["backend-confirm"], transcript, answer.confirmation);
			return { answer, confirmation: await relayConfirmation(keys["phone-confirm"], transcript) };
		},
		async activate(client: TestClient) {
			const staged = await this.stage(client);
			expect(await client.request({ type: "notifications.confirmRelay", operationId: registration.operationId,
				confirmation: staged.confirmation })).toMatchObject({ type: "notifications.confirmRelay", device: { transport: "fcm-relay" } });
			return staged.answer;
		},
		async decrypt(request: CapturedRelayRequest) {
			const body = JSON.parse(request.body) as { envelope: string };
			return await decryptRelay(keys.notification, context, body.envelope);
		},
		async admit(request: CapturedRelayRequest, now: number) {
			const plaintext = await this.decrypt(request);
			admission.admit(context.keyId, plaintext, now, () => undefined);
			return plaintext;
		},
		inheritAdmission(phone: { admission(): RelayAdmission }) { admission = phone.admission(); },
		admission: () => admission,
	};
}

/** Every Aiki server here is created by createSetup with explicit relay and FCM overrides. */
export async function relaySetup(options: Parameters<typeof authSetup>[0] = {}) {
	const relay = fakeRelay();
	const clock = new RelayClock();
	const logs: string[] = [];
	const setup = await authSetup({ ...options, now: () => clock.now,
		log: (line) => logs.push(line), notifications: { fcmKeyFile: null, relayEndpoint: relay.endpoint,
			schedule: clock.schedule, relayRandom: () => 0, relayRequestTimeoutMs: 500, ...options?.notifications } });
	const credentials = await httpEnroll(setup);
	const { client, hello } = await authClient(setup, credentials);
	return { setup, relay, clock, client, hello, logs, credentials,
		async tick(ms: number) { clock.advance(ms); await setup.server.notifications.flush(); },
		async reconnect() { return (await authClient(setup, credentials)).client; },
	};
}

/** Wait for an HTTP capture before inspecting state; assertions never race the real socket. */
export async function waitForRelayCapture(relay: ReturnType<typeof fakeRelay>, count: number): Promise<void> {
	await until(() => relay.sends().length >= count);
}
