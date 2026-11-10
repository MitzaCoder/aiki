import { beforeEach, expect } from "bun:test";
import { newRelayId, parseRelayFcmData, relayCredentialHash } from "../../../packages/protocol/src/index.ts";
import {
	authCleanup,
	authClient,
	authSetup,
	httpEnroll,
} from "../../../packages/server/test/device-auth-test-support.ts";
import { RelayClock, simulatedPhone } from "../../../packages/server/test/push-relay-support.ts";
import { capturedChallenge, fixture, functionsUrl, httpCaptures, store } from "../support.ts";
import type { FcmMessage } from "../../src/ports.ts";

export const event = {
	kind: "reply" as const,
	title: "Synthetic encrypted subject",
	body: "Synthetic encrypted preview",
	projectId: null,
	threadId: "synthetic-thread",
};

beforeEach(async () => {
	httpCaptures.length = 0;
	await store.control.doc("settings").set(
		{
			enabled: true,
			enrollmentEnabled: true,
			limits: { managementMinute: 10000, managementDay: 10000, requestMinute: 10000 },
		},
		{ merge: true },
	);
});

/** Phone management uses the real function's HTTP boundary, never the in-process core. */
export async function phoneRequest(path: string, body: unknown, identity = fixture.primary.idToken): Promise<Response> {
	return fetch(`${functionsUrl}/v1/${path}`, {
		method: "POST",
		headers: { Authorization: `Bearer ${identity}`, "Content-Type": "application/octet-stream" },
		body: JSON.stringify(body),
		signal: AbortSignal.timeout(10000),
	});
}

/** Enroll or replace a token by answering only the challenge captured by fake FCM. */
export async function enrollPhone(
	identity = fixture.primary.idToken,
	installationId = newRelayId(),
	replacing = false,
) {
	const token = `synthetic-token-${newRelayId()}`;
	const operationId = newRelayId();
	const prefix = replacing ? "installations/token" : "installations";
	const begun = await phoneRequest(`${prefix}/begin`, { installationId, operationId, token }, identity);
	expect(await begun.json()).toMatchObject({ challengeId: expect.any(String) });
	expect(begun.status).toBe(200);
	const capture = httpCaptures.findLast((message) => message.token === token);
	if (!capture) throw new Error("No FCM challenge");
	const challenge = capturedChallenge(capture);
	const confirmed = await phoneRequest(`${prefix}/confirm`, challenge, identity);
	expect(confirmed.status).toBe(200);
	return { identity, installationId, token };
}

/** A loopback fault gate forwards real requests and can lose replies without replacing the relay. */
export function relayGate() {
	const requests: { path: string; body: string; authorization: string | null }[] = [];
	let fault: "none" | "down" | "timeout" | "lost" = "none";
	const server = Bun.serve({
		hostname: "127.0.0.1",
		port: 0,
		async fetch(request) {
			const path = new URL(request.url).pathname;
			const body = await request.text();
			requests.push({ path, body, authorization: request.headers.get("authorization") });
			if (fault === "down") return new Response("", { status: 503 });
			if (fault === "timeout") {
				await Bun.sleep(600);
				return new Response("", { status: 503 });
			}
			const response = await fetch(`${functionsUrl}${path}`, {
				method: "POST",
				headers: request.headers,
				body,
				signal: AbortSignal.timeout(10000),
			});
			const bytes = await response.arrayBuffer();
			if (fault === "lost" && path.endsWith("/send")) {
				fault = "none";
				return new Response("", { status: 503 });
			}
			return new Response(response.status === 204 ? null : bytes, {
				status: response.status,
				headers: response.headers,
			});
		},
	});
	authCleanup(async () => {
		await server.stop(true);
	});
	return {
		endpoint: `http://127.0.0.1:${server.port}/v1/`,
		requests,
		setFault(next: typeof fault) {
			fault = next;
		},
		sends: () => requests.filter((request) => request.path.endsWith("/send")),
	};
}

/** Create an isolated real backend; all private directories come from createSetup through authSetup. */
export async function backend(optional = false, requestTimeoutMs = 10000) {
	const gate = relayGate();
	const clock = new RelayClock();
	clock.now = Date.now();
	const setup = await authSetup({
		auth: { mode: optional ? "optional" : "required" },
		now: () => clock.now,
		notifications: {
			fcmKeyFile: null,
			relayEndpoint: gate.endpoint,
			schedule: clock.schedule,
			relayRandom: () => 0,
			relayRequestTimeoutMs: requestTimeoutMs,
		},
	});
	const credentials = await httpEnroll(setup);
	const { client, hello } = await authClient(setup, credentials);
	return {
		setup,
		credentials,
		client,
		hello,
		gate,
		clock,
		async tick(milliseconds: number) {
			clock.advance(milliseconds);
			await setup.server.notifications.flush();
		},
		status: () => setup.server.notifications.relay!.status(credentials.sessionId),
	};
}

/** Stage route hashes, verify backend confirmation, activate remotely, then confirm to the backend. */
export async function connectPhone(
	account: Awaited<ReturnType<typeof enrollPhone>>,
	target: Awaited<ReturnType<typeof backend>>,
	predecessor?: Awaited<ReturnType<typeof simulatedPhone>>,
) {
	const phone = await simulatedPhone(predecessor?.registration.routeId);
	const registration = phone.registration;
	const create = {
		installationId: account.installationId,
		routeId: registration.routeId,
		operationId: registration.operationId,
		sendHash: Buffer.from(await relayCredentialHash(registration.sendBearer, "send")).toString("hex"),
		deleteHash: Buffer.from(await relayCredentialHash(registration.deleteBearer, "delete")).toString("hex"),
		...(predecessor ? { predecessorId: predecessor.registration.routeId } : {}),
	};
	const created = await phoneRequest("routes/create", create, account.identity);
	expect(created.status).toBe(200);
	const lease = (await created.json()) as { leaseExpiresAt: number; absoluteExpiresAt: number };
	Object.assign(registration, lease);
	const staged = await phone.stage(target.client);
	expect(
		(
			await phoneRequest(
				"routes/activate",
				{
					installationId: account.installationId,
					routeId: registration.routeId,
				},
				account.identity,
			)
		).status,
	).toBe(200);
	expect(
		await target.client.request({
			type: "notifications.confirmRelay",
			operationId: registration.operationId,
			confirmation: staged.confirmation,
		}),
	).toMatchObject({ type: "notifications.confirmRelay" });
	if (predecessor) phone.inheritAdmission(predecessor);
	let removed = false;
	return {
		...phone,
		create,
		answer: staged.answer,
		removeLocally() {
			removed = true;
		},
		async receive(message: FcmMessage, now = target.clock.now) {
			if (removed) throw new Error("route removed");
			parseRelayFcmData(JSON.stringify(message.data));
			return phone.admit(
				{
					path: "/v1/send",
					authorization: null,
					contentType: null,
					body: JSON.stringify({ envelope: message.data.aiki }),
				},
				now,
			);
		},
	};
}

/** Return only notification envelopes, not enrollment challenges. */
export function notifications(token: string): FcmMessage[] {
	return httpCaptures.filter((message) => message.token === token && !message.data.aiki.includes('"type":"challenge"'));
}
