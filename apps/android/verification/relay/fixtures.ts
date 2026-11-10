import { randomBytes } from "node:crypto";
import { resolve } from "node:path";

/** Synthetic fixture operations, pinned to the owned loopback demo stack. Never accepts project/host overrides. */
const auth = "http://127.0.0.1:19571";
const relay = "http://127.0.0.1:19573/demo-aiki-relay/us-central1/relay/v1/";
const fcm = "http://127.0.0.1:19577";
const action = process.argv[2];
const email = process.argv[3] ?? "relay@example.test";
if (!email.endsWith("@example.test")) throw new Error("Synthetic email required");
const id = () => randomBytes(16).toString("base64url");
async function json(url: string, body?: unknown, headers: Record<string, string> = {}) {
	const response = await fetch(url, {
		...(body === undefined ? {} : { method: "POST", body: JSON.stringify(body) }),
		headers: { "Content-Type": "application/json", ...headers },
		signal: AbortSignal.timeout(10000),
	});
	if (!response.ok) throw new Error(`Synthetic fixture failed (${response.status})`);
	return await response.json() as Record<string, unknown>;
}
async function fixtureAccountToken(): Promise<string> {
	if (email === "google@example.test") {
		const encode = (raw: unknown) => Buffer.from(JSON.stringify(raw)).toString("base64url");
		const credential = encode({ alg: "none", typ: "JWT" }) + "." + encode({
			sub: "demo-google-user", email, email_verified: true, iss: "https://accounts.google.com", aud: "demo-web-client",
		}) + ".";
		const user = await json(`${auth}/identitytoolkit.googleapis.com/v1/accounts:signInWithIdp?key=demo`, {
			requestUri: "https://relay.example.test", returnSecureToken: true,
			postBody: new URLSearchParams({ providerId: "google.com", id_token: credential }).toString(),
		});
		if (typeof user.idToken !== "string") throw new Error("Missing synthetic Google account token");
		return user.idToken;
	}
	await json(`${auth}/identitytoolkit.googleapis.com/v1/accounts:sendOobCode?key=demo`, {
		requestType: "EMAIL_SIGNIN", email, continueUrl: "https://relay.example.test/__/auth/links",
	});
	const codes = await json(`${auth}/emulator/v1/projects/demo-aiki-relay/oobCodes`);
	const entries = codes.oobCodes as { email: string; oobCode: string }[];
	const code = entries.filter((entry) => entry.email === email).at(-1);
	if (!code) throw new Error("Missing synthetic email code");
	const user = await json(`${auth}/identitytoolkit.googleapis.com/v1/accounts:signInWithEmailLink?key=demo`, {
		email, oobCode: code.oobCode,
	});
	if (typeof user.idToken !== "string") throw new Error("Missing synthetic account token");
	return user.idToken;
}
async function operator(...args: string[]) {
	const child = Bun.spawn([process.execPath, "--no-env-file",
		resolve(import.meta.dir, "../../../../relay/tools/operator.ts"), "--emulator", ...args, "--yes"], {
		env: {
			PATH: process.env.PATH!, RELAY_AUTH_PORT: "19571", RELAY_FIRESTORE_PORT: "19572",
			RELAY_FUNCTIONS_PORT: "19573", RELAY_HUB_PORT: "19574", RELAY_LOGGING_PORT: "19575",
			RELAY_WEBSOCKET_PORT: "19576", RELAY_FCM_PORT: "19577",
		},
		stdout: "inherit", stderr: "inherit", stdin: "ignore", timeout: 65000,
	});
	if (await child.exited !== 0) throw new Error("Synthetic operator command failed");
}
if (action === "add-phone") {
	const token = await fixtureAccountToken();
	const call = (path: string, body: unknown) => json(relay + path, body, {
		Authorization: `Bearer ${token}`, "Content-Type": "application/octet-stream",
	});
	const installationId = id();
	const operationId = id();
	const cursor = await json(`${fcm}/captured?after=0`);
	await call("installations/begin", { installationId, operationId, token: `demo-other-phone-${id()}` });
	const captures = await json(`${fcm}/captured?after=${cursor.next}`);
	const messages = captures.messages as { data: { aiki: string } }[];
	const challenge = messages.map((message) => JSON.parse(message.data.aiki) as Record<string, unknown>)
		.find((entry) => entry.installationId === installationId);
	if (!challenge) throw new Error("No captured synthetic phone challenge");
	await call("installations/confirm", { installationId, operationId,
		challengeId: challenge.challengeId, nonce: challenge.nonce });
} else if (action === "pause" || action === "resume") {
	await operator(action);
} else if (action === "restore-limits") {
	await operator("limits", "set", "accountPhones", "3");
	await operator("limits", "set", "requestMinute", "30");
} else if (action === "phone-limit" || action === "rate-limit") {
	const field = action === "phone-limit" ? "accountPhones" : "requestMinute";
	await operator("limits", "set", field, "0");
} else throw new Error("Expected add-phone, pause, resume, phone-limit, rate-limit or restore-limits");
console.log("Synthetic relay fixture updated");
