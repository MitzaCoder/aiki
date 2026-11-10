import { onSchedule } from "firebase-functions/v2/scheduler";
import { reconcileRelay } from "./reconciliation";
import type { Dependencies } from "./ports";
import { onRequest } from "firebase-functions/v2/https";
import { initializeApp, applicationDefault } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";
import { getAppCheck } from "firebase-admin/app-check";
import { getMessaging } from "firebase-admin/messaging";
import { randomBytes } from "node:crypto";
import { createRelay, type FcmMessage, type FcmResult } from "./core";
import { runtimeMode } from "./startup";
import { trustedClientAddress } from "./client-address";
import { relayDatabase, relayMaxInstances, relayRegion, runtimeServiceAccount } from "./deployment";
import { requireDatabaseId } from "./database";
const mode = runtimeMode({
	FUNCTIONS_EMULATOR: process.env.FUNCTIONS_EMULATOR,
	FIREBASE_AUTH_EMULATOR_HOST: process.env.FIREBASE_AUTH_EMULATOR_HOST,
	FIRESTORE_EMULATOR_HOST: process.env.FIRESTORE_EMULATOR_HOST,
	FIREBASE_APPCHECK_EMULATOR_HOST: process.env.FIREBASE_APPCHECK_EMULATOR_HOST,
	RELAY_TEST_FCM_PORT: process.env.RELAY_TEST_FCM_PORT,
	RELAY_APP_CHECK_BYPASS: process.env.RELAY_APP_CHECK_BYPASS,
	GCLOUD_PROJECT: process.env.GCLOUD_PROJECT,
});
const app = initializeApp({
	projectId: mode.projectId,
	...(!mode.emulator ? { credential: applicationDefault() } : {}),
});
/** Deliver only stored FCM options, with a deadline and no provider text in results or logs. */
async function sender(message: FcmMessage): Promise<FcmResult> {
	if (mode.emulator) {
		try {
			const reply = await fetch(`http://127.0.0.1:${mode.fakeFcmPort}/send`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(message),
				signal: AbortSignal.timeout(10000),
			});
			if (!reply.ok) return "unavailable";
			const result = await reply.text();
			return ["accepted", "unregistered", "rate_limited", "unavailable", "timeout"].includes(result)
				? (result as FcmResult)
				: "unavailable";
		} catch (error) {
			const name = error instanceof Error ? error.name : "";
			return name === "TimeoutError" || name === "AbortError" ? "timeout" : "unavailable";
		}
	}
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		const accepted = getMessaging(app)
			.send({ token: message.token, data: message.data, android: { priority: message.priority, ttl: message.ttlMs } })
			.then(() => "accepted" as const);
		const deadline = new Promise<"timeout">((resolve) => {
			timer = setTimeout(() => resolve("timeout"), 10000);
		});
		return await Promise.race([accepted, deadline]);
	} catch (error) {
		const code = (
			error as {
				code?: string;
			}
		).code;
		if (code === "messaging/registration-token-not-registered") return "unregistered";
		if (code === "messaging/message-rate-exceeded" || code === "messaging/quota-exceeded") return "rate_limited";
		return "unavailable";
	} finally {
		clearTimeout(timer);
	}
}
let dependencies: Dependencies | undefined;
/** Resolve the database only at invocation, after the CLI has supplied parameter values. */
function runtimeDependencies(): Dependencies {
	return (dependencies ??= {
		firestore: getFirestore(app, requireDatabaseId(relayDatabase.value())),
		auth: getAuth(app),
		projectId: mode.projectId,
		send: sender,
		now: Date.now,
		random: (size) => randomBytes(size).toString("base64url"),
		verifyAppCheck: async (token) => {
			if (!token) return false;
			await getAppCheck(app).verifyToken(token);
			return true;
		},
		monitor: (outcome) => {
			console.info("app_check", outcome);
		},
	});
}
let handle: ReturnType<typeof createRelay> | undefined;
/** One production v2 HTTPS export; protocol clients send JSON bytes as application/octet-stream. */
export const relay = onRequest(
	{
		region: relayRegion,
		serviceAccount: runtimeServiceAccount,
		timeoutSeconds: 30,
		minInstances: 0,
		maxInstances: relayMaxInstances,
		memory: "256MiB",
		invoker: "public",
		cors: false,
	},
	async (request, response) => {
		handle ??= createRelay(runtimeDependencies());
		const result = await handle({
			method: request.method,
			path: request.path,
			authorization: request.get("Authorization"),
			appCheck: request.get("X-Firebase-AppCheck"),
			body: request.rawBody?.toString("utf8") ?? "",
			// The loopback-only Functions emulator serializes requests without a real peer socket.
			clientIp: mode.emulator
				? "127.0.0.1"
				: trustedClientAddress(request.get("X-Forwarded-For"), request.socket.remoteAddress, false),
			contentType: request.get("Content-Type"),
			contentEncoding: request.get("Content-Encoding"),
		});
		for (const [key, value] of Object.entries(result.headers)) response.setHeader(key, value);
		response.status(result.status);
		if (result.body) response.json(result.body);
		else response.end();
	},
);

/** Hourly repair uses the same plain durable reconciliation core exercised by the emulator checks. */
export const reconcile = onSchedule(
	{
		region: relayRegion,
		serviceAccount: runtimeServiceAccount,
		schedule: "every 60 minutes",
		timeoutSeconds: 540,
		maxInstances: 1,
	},
	async () => {
		try {
			await reconcileRelay(runtimeDependencies());
		} catch {
			throw new Error("relay_reconciliation_failed");
		}
	},
);
