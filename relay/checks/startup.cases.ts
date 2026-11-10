import { expect, test } from "bun:test";
import { runtimeMode } from "../src/startup";
import { projectId, authHost, firestoreHost } from "./support";
test("production refuses every emulator/bypass flag and demo emulator requires local fake FCM", () => {
	expect(runtimeMode({ GCLOUD_PROJECT: "synthetic-production" }).emulator).toBe(false);
	for (const key of [
		"FIREBASE_AUTH_EMULATOR_HOST",
		"FIRESTORE_EMULATOR_HOST",
		"FIREBASE_APPCHECK_EMULATOR_HOST",
		"RELAY_TEST_FCM_PORT",
		"RELAY_APP_CHECK_BYPASS",
	])
		expect(() => runtimeMode({ GCLOUD_PROJECT: "synthetic-production", [key]: "1" })).toThrow();
	expect(() => runtimeMode({ FUNCTIONS_EMULATOR: "true", GCLOUD_PROJECT: "synthetic-production" })).toThrow();
	expect(() =>
		runtimeMode({
			FUNCTIONS_EMULATOR: "true",
			GCLOUD_PROJECT: projectId,
			FIREBASE_AUTH_EMULATOR_HOST: "example.com:1234",
			FIRESTORE_EMULATOR_HOST: firestoreHost,
			RELAY_TEST_FCM_PORT: "19377",
		}),
	).toThrow();
	expect(
		runtimeMode({
			FUNCTIONS_EMULATOR: "true",
			GCLOUD_PROJECT: projectId,
			FIREBASE_AUTH_EMULATOR_HOST: authHost,
			FIRESTORE_EMULATOR_HOST: firestoreHost,
		}).fakeFcmPort,
	).toBe(19377);
});
test("trusted client address uses only the GFE suffix; malformed metadata fails closed", async () => {
	const { trustedClientAddress } = await import("../src/client-address");
	expect(trustedClientAddress("192.0.2.8, 198.51.100.7", "127.0.0.1", false)).toBe("198.51.100.7");
	expect(trustedClientAddress("attacker, 192.0.2.8, 2001:db8::7", "127.0.0.1", false)).toBe("2001:db8::7");
	expect(trustedClientAddress("192.0.2.8, invalid", "127.0.0.1", false)).toBe("");
	expect(trustedClientAddress("192.0.2.8,", "127.0.0.1", false)).toBe("");
	expect(trustedClientAddress(undefined, "127.0.0.1", false)).toBe("");
	expect(trustedClientAddress("192.0.2.8", "127.0.0.1", true)).toBe("127.0.0.1");
	expect(trustedClientAddress("192.0.2.8", "198.51.100.7", true)).toBe("");
});
