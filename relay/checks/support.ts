import { afterAll, beforeAll, beforeEach, expect } from "bun:test";
import { randomBytes } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { initializeApp, deleteApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";
import { createRelay } from "../src/core";
import { DEFAULT_DATABASE_ID, requireDatabaseId } from "../src/database";
import { createStore } from "../src/documents";
import type { CoreRequest, CoreResponse, FcmMessage, FcmResult, Dependencies } from "../src/ports";
import { requireCondition, credentialHash } from "../src/validation";
interface AuthFixture {
	idToken: string;
	localId: string;
}
interface ChallengeFixture {
	installationId: string;
	operationId: string;
	challengeId: string;
	nonce: string;
}
export interface PendingEnrollment extends ChallengeFixture {
	token: string;
	identity: string;
	replacing: boolean;
}
const emptyIdentity = (): AuthFixture => ({ idToken: "", localId: "" });
export const projectId = "demo-aiki-relay";
export const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST!;
export const firestoreHost = process.env.FIRESTORE_EMULATOR_HOST!;
if (!/^127\.0\.0\.1:\d+$/.test(authHost) || !/^127\.0\.0\.1:\d+$/.test(firestoreHost)) {
	throw new Error("Emulators required");
}
const app = initializeApp({ projectId }, "checks");
export const databaseId = requireDatabaseId(process.env.RELAY_DATABASE_ID ?? DEFAULT_DATABASE_ID);
export const db = getFirestore(app, databaseId);
export const auth = getAuth(app);
export const store = createStore(db);
export const fixture = {
	now: Date.now(),
	captures: [] as FcmMessage[],
	monitors: [] as string[],
	fcmBehavior: async (_message: FcmMessage): Promise<FcmResult> => "accepted",
	httpFcmResult: "accepted" as FcmResult,
	primary: emptyIdentity(),
	other: emptyIdentity(),
	google: emptyIdentity(),
	anonymous: emptyIdentity(),
	unverified: emptyIdentity(),
	wrongProject: emptyIdentity(),
	custom: emptyIdentity(),
};
let handle: ReturnType<typeof createRelay>;
let secondAuthServer: Server;
let fakeServer: ReturnType<typeof Bun.serve>;
export const httpCaptures: FcmMessage[] = [];
export const functionsUrl = `http://127.0.0.1:${process.env.RELAY_FUNCTIONS_PORT}/${projectId}/us-central1/relay`;
/** Generate synthetic random protocol identifiers or secrets, never real device data. */
export function random(bytes = 16): string {
	return randomBytes(bytes).toString("base64url");
}
async function rest(path: string, body?: unknown, host = authHost): Promise<unknown> {
	const response = await fetch(`http://${host}/${path}`, {
		method: body === undefined ? "GET" : "POST",
		headers: { "Content-Type": "application/json" },
		...(body === undefined ? {} : { body: JSON.stringify(body) }),
	});
	const result: unknown = await response.json();
	if (!response.ok) throw new Error("Auth fixture failed");
	return result;
}
async function signIn(path: string, body: unknown, host = authHost): Promise<AuthFixture> {
	const result = (await rest(path + "?key=synthetic", body, host)) as Record<string, unknown>;
	requireCondition(typeof result.idToken === "string");
	const claims = JSON.parse(Buffer.from(result.idToken.split(".")[1], "base64url").toString()) as Record<
		string,
		unknown
	>;
	// Auth REST uses real wall time; keep a frozen fake relay clock from preceding a freshly issued auth_time.
	if (typeof claims.auth_time === "number") fixture.now = Math.max(fixture.now, claims.auth_time * 1000);
	const localId = result.localId ?? claims.sub;
	requireCondition(typeof localId === "string");
	return { idToken: result.idToken, localId };
}
function unsigned(payload: unknown): string {
	return (
		Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url") +
		"." +
		Buffer.from(JSON.stringify(payload)).toString("base64url") +
		"."
	);
}
async function googleUser(host = authHost): Promise<AuthFixture> {
	const identity = random();
	return signIn(
		"identitytoolkit.googleapis.com/v1/accounts:signInWithIdp",
		{
			requestUri: "http://example.com",
			returnSecureToken: true,
			postBody: new URLSearchParams({
				providerId: "google.com",
				id_token: unsigned({
					sub: identity,
					email: identity + "@example.com",
					email_verified: true,
					iss: "https://accounts.google.com",
					aud: "synthetic-client",
				}),
			}).toString(),
		},
		host,
	);
}
/** Obtain a verified email-link user's ID token from the official Auth emulator REST API. */
export async function emailUser(email = random().toLowerCase() + "@example.com"): Promise<AuthFixture> {
	await rest("identitytoolkit.googleapis.com/v1/accounts:sendOobCode?key=synthetic", {
		requestType: "EMAIL_SIGNIN",
		email,
		continueUrl: "https://example.com/finish",
	});
	const codes = (await rest(`emulator/v1/projects/${projectId}/oobCodes`)) as {
		oobCodes: {
			email: string;
			oobCode: string;
		}[];
	};
	const code = codes.oobCodes.find((entry) => entry.email === email);
	if (!code) throw new Error("Missing synthetic email link");
	return signIn("identitytoolkit.googleapis.com/v1/accounts:signInWithEmailLink", { email, oobCode: code.oobCode });
}
/** Call the pure core with valid protocol framing unless the case explicitly overrides it. */
export function call(
	path: string,
	body: unknown = {},
	identity: string | undefined = fixture.primary.idToken,
	overrides: Partial<CoreRequest> = {},
): Promise<CoreResponse> {
	return handle({
		method: "POST",
		path: "/v1/" + path,
		authorization: identity ? "Bearer " + identity : undefined,
		clientIp: "127.0.0.1",
		contentType: "application/octet-stream",
		body: JSON.stringify(body),
		...overrides,
	});
}
/** Assert a successful response without discarding its safe error code on failure. */
export function assertStatus(response: CoreResponse, status = 200): void {
	expect({ status: response.status, error: response.body?.error }).toEqual({ status, error: undefined });
}
/** Read synthetic challenge fields captured by the injected sender, not from relay storage. */
export function capturedChallenge(message: FcmMessage): ChallengeFixture {
	const record = JSON.parse(message.data.aiki) as Record<string, unknown>;
	requireCondition(
		typeof record.installationId === "string" &&
			typeof record.operationId === "string" &&
			typeof record.challengeId === "string" &&
			typeof record.nonce === "string",
	);
	return {
		installationId: record.installationId,
		operationId: record.operationId,
		challengeId: record.challengeId,
		nonce: record.nonce,
	};
}
/** Begin a synthetic installation challenge and expose its fake-sender capture for possession tests. */
export async function begin(
	installationId = random(),
	token = "synthetic-token-" + random(),
	identity = fixture.primary.idToken,
	replacing = false,
	operationId = random(),
): Promise<PendingEnrollment> {
	const response = await call(
		replacing ? "installations/token/begin" : "installations/begin",
		{ installationId, operationId, token },
		identity,
	);
	assertStatus(response);
	const captured = fixture.captures.findLast((message) => message.token === token);
	if (!captured) throw new Error("Missing synthetic challenge");
	return { ...capturedChallenge(captured), token, identity, replacing };
}
/** Confirm a captured nonce, optionally corrupting fields to exercise ownership and attempt limits. */
export async function finish(pending: PendingEnrollment, changes: Record<string, unknown> = {}): Promise<CoreResponse> {
	return call(
		pending.replacing ? "installations/token/confirm" : "installations/confirm",
		{
			installationId: pending.installationId,
			operationId: pending.operationId,
			challengeId: pending.challengeId,
			nonce: pending.nonce,
			...changes,
		},
		pending.identity,
	);
}
/** Complete a synthetic phone's possession enrollment. */
export async function enroll(
	installationId = random(),
	token?: string,
	identity = fixture.primary.idToken,
): Promise<PendingEnrollment> {
	const pending = await begin(installationId, token, identity);
	assertStatus(await finish(pending));
	return pending;
}
/** Stage independent send/delete capabilities and only their full-bearer hashes for route creation. */
export function routeCredentials(installationId: string, predecessorId?: string) {
	const routeId = random();
	const send = `aiki_push1.${routeId}.${random(32)}`;
	const deletion = `aiki_push_delete1.${routeId}.${random(32)}`;
	return {
		routeId,
		send,
		deletion,
		create: {
			installationId,
			routeId,
			operationId: random(),
			sendHash: credentialHash(send),
			deleteHash: credentialHash(deletion),
			...(predecessorId ? { predecessorId } : {}),
		},
	};
}
/** Create and optionally activate a phone-owned route. */
export async function route(
	installationId: string,
	identity = fixture.primary.idToken,
	predecessorId?: string,
	activate = true,
) {
	const credentials = routeCredentials(installationId, predecessorId);
	assertStatus(await call("routes/create", credentials.create, identity));
	if (activate) assertStatus(await call("routes/activate", { installationId, routeId: credentials.routeId }, identity));
	return credentials;
}
/** Construct a structurally valid opaque encrypted envelope without using real plaintext. */
export function payload(routeId: string, messageId = random()) {
	return {
		routeId,
		messageId,
		envelope: JSON.stringify({
			v: 1,
			r: routeId,
			k: random(),
			m: messageId,
			n: random(12),
			c: random(272),
		}),
	};
}
/** Wait for a controlled race barrier, never an unbounded sleep. */
export async function waitFor(predicate: () => boolean): Promise<void> {
	const deadline = Date.now() + 3000;
	while (!predicate()) {
		if (Date.now() > deadline) throw new Error("Timed out");
		await Bun.sleep(10);
	}
}
/** Register one suite-wide emulator lifecycle; imported case modules share this isolated state. */
export function registerEmulatorChecks(): void {
	beforeAll(async () => {
		fixture.primary = await emailUser();
		fixture.other = await emailUser();
		fixture.google = await googleUser();
		fixture.anonymous = await signIn("identitytoolkit.googleapis.com/v1/accounts:signUp", { returnSecureToken: true });
		fixture.unverified = await signIn("identitytoolkit.googleapis.com/v1/accounts:signUp", {
			email: "unverified@example.com",
			password: "synthetic-password",
			returnSecureToken: true,
		});
		fixture.custom = await signIn("identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken", {
			token: unsigned({
				uid: random(),
				aud: "https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit",
				iss: "synthetic@example.com",
				sub: "synthetic@example.com",
				claims: { email_verified: true },
			}),
			returnSecureToken: true,
		});
		// The official Auth emulator maps all API keys to its default project, so wrong-project fixtures need another app.
		const { createApp } = await import("firebase-tools/lib/emulator/auth/server.js");
		secondAuthServer = createServer(await createApp("demo-other-relay"));
		await new Promise<void>((resolve) => secondAuthServer.listen(0, "127.0.0.1", resolve));
		const secondPort = (secondAuthServer.address() as AddressInfo).port;
		fixture.wrongProject = await googleUser(`127.0.0.1:${secondPort}`);
		fakeServer = Bun.serve({
			hostname: "127.0.0.1",
			port: Number(process.env.RELAY_TEST_FCM_PORT),
			async fetch(request) {
				if (new URL(request.url).pathname !== "/send") return new Response("", { status: 404 });
				httpCaptures.push((await request.json()) as FcmMessage);
				return new Response(fixture.httpFcmResult);
			},
		});
	}, 30000);
	beforeEach(async () => {
		await fetch(`http://${firestoreHost}/emulator/v1/projects/${projectId}/databases/${databaseId}/documents`, {
			method: "DELETE",
		});
		fixture.now = Date.now();
		fixture.captures = [];
		fixture.monitors = [];
		fixture.fcmBehavior = async () => "accepted";
		fixture.httpFcmResult = "accepted";
		// Legacy protocol checks exercise semantics independently of activity quotas. Dedicated T94 cases restore defaults.
		await store.control.doc("settings").set({
			enabled: true,
			enrollmentEnabled: true,
			limits: {
				managementMinute: 10000,
				managementDay: 10000,
				requestMinute: 10000,
				accountChallengeHour: 10000,
				accountChallengeDay: 10000,
				ipChallengeHour: 10000,
				ipChallengeDay: 10000,
				enrollmentDay: 10000,
				newAccountIpDay: 10000,
			},
		});
		restartHandler();
	});
	afterAll(async () => {
		fakeServer?.stop(true);
		if (secondAuthServer) {
			secondAuthServer.closeAllConnections();
			await new Promise<void>((resolve) => secondAuthServer.close(() => resolve()));
		}
		await db.terminate();
		await deleteApp(app);
	});
}

/** Construct real emulator ports with injectable clock/failure seams, never production environment bypasses. */
export function checkDependencies(overrides: Partial<Dependencies> = {}): Dependencies {
	return {
		firestore: db,
		auth,
		projectId,
		now: () => fixture.now,
		random,
		verifyAppCheck: async () => false,
		monitor: (value) => fixture.monitors.push(value),
		send: async (message) => {
			fixture.captures.push(message);
			return fixture.fcmBehavior(message);
		},
		...overrides,
	};
}
/** Simulate an instance restart without deleting durable Firestore quotas, reservations or cleanup work. */
export function restartHandler(overrides: Partial<Dependencies> = {}): void {
	handle = createRelay(checkDependencies(overrides));
}
/** Link Google to an existing synthetic email user through Auth REST, preserving the original UID. */
export async function linkGoogleIdentity(user: AuthFixture): Promise<AuthFixture> {
	const email = (await auth.getUser(user.localId)).email!;
	return signIn("identitytoolkit.googleapis.com/v1/accounts:signInWithIdp", {
		idToken: user.idToken,
		requestUri: "http://example.com",
		returnSecureToken: true,
		postBody: new URLSearchParams({
			providerId: "google.com",
			id_token: unsigned({
				sub: random(),
				email,
				email_verified: true,
				iss: "https://accounts.google.com",
				aud: "synthetic-client",
			}),
		}).toString(),
	});
}

/** Corrupt a synthetic serialized envelope without changing the actual v1 HTTP wire type. */
export function patchEnvelope(body: { envelope: string }, patch: Record<string, unknown>): string {
	const envelope = JSON.parse(body.envelope) as Record<string, unknown>;
	return JSON.stringify({ ...envelope, ...patch });
}
/** Return synthetic ciphertext only for the no-sensitive-log assertion. */
export function fixtureCiphertext(body: { envelope: string }): string {
	return (JSON.parse(body.envelope) as { c: string }).c;
}
